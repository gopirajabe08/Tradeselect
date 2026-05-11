/**
 * Max-hold-days auto-exit — closes CNC swing positions whose holding period
 * has reached the strategy's `maxHoldDays`.
 *
 * Why this exists: strategies declare `maxHoldDays` (e.g. reversal-52wl hold=3,
 * HRVM hold=3) because their backtested edge assumes a specific exit horizon.
 * Without enforcement, paper positions drift past the horizon → live behavior
 * diverges from backtest assumptions → the supposed +Sharpe edge is fictional.
 *
 * Mirror of intraday-squareoff but time-window is per-position, not global:
 *   - intraday-squareoff: ONCE/day at 15:15 IST, closes ALL intraday positions
 *   - max-hold-exit:      EVERY tick, closes any CNC position aged ≥ its maxHoldDays
 *
 * What this does (when called within market hours):
 *   1. For each CNC paper position with netQty != 0 AND openedAt set AND maxHoldDays set:
 *      compute ageDays = (now - openedAt) / day
 *   2. If ageDays >= maxHoldDays: fire opposing MARKET order to flatten netQty → 0
 *   3. Cancel any open OCO bracket legs for that position
 *   4. Audit each exit with source="max-hold-exit"
 *
 * Live mode: same flow against the live broker; uses position metadata from auto-follow
 * audit if the broker doesn't surface openedAt natively (deferred — paper-first).
 */
import { readState, writeState, type PaperPosition } from "@/lib/broker/paper/store";
import { placeOrderInternal } from "@/lib/broker/place-internal";
import { activeBroker } from "@/lib/broker";
import { appendAudit } from "@/lib/broker/audit";
import { notify } from "@/lib/notify/telegram";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type MaxHoldExitResult = {
  ran: boolean;
  closed: number;
  cancelled: number;
  reason?: string;
  details?: { symbol: string; ageDays: number; maxHoldDays: number; strategyId: string | undefined }[];
};

/** Pure helper — exposed for test. Returns the positions that should be exited. */
export function findExpiredPositions(
  positions: PaperPosition[],
  now: number = Date.now(),
): { position: PaperPosition; ageDays: number }[] {
  const out: { position: PaperPosition; ageDays: number }[] = [];
  for (const p of positions) {
    if (p.netQty === 0) continue;
    if (p.productType !== "CNC" && p.productType !== "MTF") continue;  // intraday handled by intraday-squareoff
    if (p.openedAt == null || p.maxHoldDays == null || p.maxHoldDays <= 0) continue;
    const ageDays = (now - p.openedAt) / MS_PER_DAY;
    if (ageDays >= p.maxHoldDays) {
      out.push({ position: p, ageDays });
    }
  }
  return out;
}

export async function maybeRunMaxHoldExit(opts: { forceOffHours?: boolean } = {}): Promise<MaxHoldExitResult> {
  const broker = await activeBroker();
  if (broker.id !== "paper") {
    // Live: deferred. Tradejini doesn't natively store openedAt; we'd need to
    // reconstruct from audit. Paper-first by design — when paper proves the rule,
    // live wiring follows.
    return { ran: false, closed: 0, cancelled: 0, reason: "live mode max-hold-exit not yet wired" };
  }

  const s = await readState();
  const expired = findExpiredPositions(s.positions);
  if (expired.length === 0) {
    return { ran: false, closed: 0, cancelled: 0, reason: "no positions past max-hold horizon" };
  }

  let closed = 0;
  let cancelled = 0;
  const details: MaxHoldExitResult["details"] = [];

  // 1. Cancel open bracket legs for expiring positions
  const expiringSymbols = new Set(expired.map(e => e.position.symbol));
  for (const o of s.orders) {
    if ((o.status === 6 || o.status === 4) && expiringSymbols.has(o.symbol)) {
      o.status = 1;
      o.message = "Cancelled by max-hold-exit";
      cancelled += 1;
    }
  }
  if (cancelled > 0) await writeState(s);

  // 2. Flatten each expired position with a marketable LIMIT.
  //    MARKET orders failed in the wild (APOLLOTYRE 2026-05-11) when NSE quote-equity
  //    returned null for the symbol — paper engine had no price to fill at, so the
  //    position stayed past horizon for days. Marketable LIMIT solves this two ways:
  //      a) If getLtp succeeds, paper engine fills at LTP (LIMIT always crosses since
  //         the limit is aggressive in the right direction).
  //      b) If getLtp returns null, paper engine's LIMIT-fallback branch fills at the
  //         passed limitPrice — derived from the position's own stored ltp/netAvg, so
  //         there's always a sane reference even when the live feed flaps.
  for (const { position: p, ageDays } of expired) {
    const flatSide: 1 | -1 = p.netQty > 0 ? -1 : 1;
    const qty = Math.abs(p.netQty);
    const tag = `mhx-${p.symbol.replace(/[^a-z0-9]/gi, "").slice(-12)}`;

    const refPrice = p.ltp > 0 ? p.ltp : p.netAvg;
    if (refPrice <= 0) {
      notify(`⚠️ *max-hold-exit cannot flatten* ${p.symbol} — no reference price (ltp=${p.ltp}, netAvg=${p.netAvg}). Manual intervention required.`).catch(() => {});
      continue;
    }
    const SLIP_TOLERANCE = 0.10; // 10% — wide enough to guarantee marketability without ever blocking a forced exit
    const limitPrice = flatSide === -1
      ? Math.max(0.05, refPrice * (1 - SLIP_TOLERANCE))
      : refPrice * (1 + SLIP_TOLERANCE);

    const r = await placeOrderInternal({
      symbol: p.symbol,
      qty,
      type: 1, // LIMIT (marketable)
      side: flatSide,
      productType: p.productType,
      limitPrice,
      stopPrice: 0,
      validity: "DAY",
      orderTag: tag,
    }, { source: "max-hold-exit", forceOffHours: opts.forceOffHours });
    // Critical guard — paper engine returns ok=true even when canAfford rejects fill
    // (status=3 internally, message starts with "Rejected: ..."). Without this check, the
    // position stays open past horizon and the next tick fires the same, same rejection,
    // forever. Adversarial finding ADV-11 (2026-04-30 360-review).
    const filled = r.ok && !(r.message && /^Rejected/i.test(r.message));
    if (filled) {
      closed += 1;
      details.push({ symbol: p.symbol, ageDays, maxHoldDays: p.maxHoldDays!, strategyId: p.strategyId });
    } else if (r.ok && r.message) {
      // Surface to Telegram so the operator sees the silent-stuck case rather than waiting for next tick.
      notify(`⚠️ *max-hold-exit could not flatten* ${p.symbol} (aged ${ageDays.toFixed(1)}d, maxHold=${p.maxHoldDays})\nReason: ${r.message}\nNext tick will retry. If this repeats, manual intervention needed.`).catch(() => {});
    }
  }

  await appendAudit({
    at: new Date().toISOString(),
    broker: "auto-follow",
    action: "auto-follow",
    input: { event: "max-hold-exit", positionsClosed: closed, ordersCancelled: cancelled, details },
    result: "ok",
  });

  if (closed > 0) {
    const lines = [`⏳ *Max-hold exit fired* (paper)`, ``];
    for (const d of details ?? []) {
      lines.push(`• ${d.symbol} aged ${d.ageDays.toFixed(1)}d ≥ maxHold=${d.maxHoldDays}d (strategy ${d.strategyId ?? "?"})`);
    }
    if (cancelled > 0) lines.push(``, `Open OCO legs cancelled: ${cancelled}`);
    notify(lines.join("\n")).catch(() => {});
  }

  return { ran: true, closed, cancelled, details };
}
