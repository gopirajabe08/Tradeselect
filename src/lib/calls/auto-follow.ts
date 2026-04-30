/**
 * Auto-follow: place an entry + bracket exit pair for every fresh high-conviction idea.
 *
 * Why: ideas without action are theatre. Hands-free workflow means the system places
 * orders on its own signals; the user watches Telegram. Live trading is gated behind
 * a triple env opt-in to keep the discipline rails honest (see `feedback_live_autofire_decision.md`).
 *
 * For each new idea passed in:
 *   1. Skip if score < min-score (paper or live threshold)
 *   2. Skip if symbol+side already has an open position or pending order
 *   3. Skip if open auto-follow position count >= max-open
 *   4. Compute qty = floor(riskCash / |entry - stopLoss|), riskCash = cash * risk-pct
 *   5. Live mode: enforce per-trade + daily notional caps before placing
 *   6. Place MARKET entry with orderTag=auto-<idea.id>
 *   7. Place SL-M exit + LIMIT target with same ocoGroup. On paper, engine cancels
 *      the sibling on fill. On live, `auto-follow-monitor.ts` polls Tradejini every 30s
 *      and cancels the orphan sibling.
 *
 * All guard rails (kill-switch, halt, daily-loss, market-hours, contract validation,
 * notional cap, idempotency, audit) are enforced via `placeOrderInternal` — same path
 * the UI uses. Drift between auto and manual is impossible.
 */
import type { TradeCall } from "@/lib/mock/seed";
import { activeBroker } from "@/lib/broker";
import { placeOrderInternal } from "@/lib/broker/place-internal";
import { tickSizeFor } from "@/lib/broker/contract-rules";
import { appendAudit, readAudit, NOTIONAL_HARD_CAP } from "@/lib/broker/audit";
import { readRiskConfig } from "@/lib/risk/sizing";
import { readState as readPaperState } from "@/lib/broker/paper/store";
import { readCalls } from "./store";
import { readLastRegime } from "./generator";
import { eventWindowFor } from "./event-calendar";
import { isOnBanList, refreshBanList } from "./nse-ban-list";
import { STRATEGIES } from "./strategies";
import type { BrokerAdapter } from "@/lib/broker/adapter";

/** Look up a strategy's productType from its id. Falls back to INTRADAY if not declared. */
function productTypeFor(strategyId: string | undefined): "INTRADAY" | "CNC" {
  if (!strategyId) return "INTRADAY";
  const strat = STRATEGIES.find(s => s.id === strategyId);
  return strat?.productType ?? "INTRADAY";
}

/** Look up a strategy's maxHoldDays. Returns undefined when not declared (no enforcement). */
function maxHoldDaysFor(strategyId: string | undefined): number | undefined {
  if (!strategyId) return undefined;
  const strat = STRATEGIES.find(s => s.id === strategyId);
  return strat?.maxHoldDays;
}

// ── NSE-veteran time-window gates ──────────────────────────────────────
// "Don't trade the first 15 min — opening volatility = false breakouts.
//  Don't trade 12:00–13:30 lunch lull — thin liquidity, slippage worse.
//  Don't open new positions 15:15–15:30 — squareoff cascades, exits at bad fills."
function istMinutes(): number {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}
const VETERAN_OPENING_END    = 9 * 60 + 30;   // 09:30 IST
const VETERAN_LUNCH_FROM     = 12 * 60 + 0;
const VETERAN_LUNCH_TO       = 13 * 60 + 30;
const VETERAN_CLOSING_FROM   = 15 * 60 + 15;

// ── Paper-mode config ───────────────────────────────────────────────────
const AUTO_FOLLOW_ENABLED    = process.env.AUTO_FOLLOW_ENABLED === "1";
const AUTO_FOLLOW_MIN_SCORE  = Number(process.env.AUTO_FOLLOW_MIN_SCORE ?? 70);
const AUTO_FOLLOW_RISK_PCT   = Number(process.env.AUTO_FOLLOW_RISK_PCT  ?? 1.0);
const AUTO_FOLLOW_MAX_OPEN   = Number(process.env.AUTO_FOLLOW_MAX_OPEN  ?? 5);

// ── Live-mode config (TIGHTER) ──────────────────────────────────────────
const AUTO_FOLLOW_ALLOW_LIVE     = process.env.AUTO_FOLLOW_ALLOW_LIVE === "1";
/** Third gate: explicit acknowledgement that paper-validation is being skipped. */
const AUTO_FOLLOW_LIVE_CONFIRMED = process.env.AUTO_FOLLOW_LIVE_CONFIRMED === "1";
const LIVE_MIN_SCORE             = Number(process.env.AUTO_FOLLOW_LIVE_MIN_SCORE ?? 80);
const LIVE_RISK_PCT              = Number(process.env.AUTO_FOLLOW_LIVE_RISK_PCT ?? 0.25);
const LIVE_MAX_OPEN              = Number(process.env.AUTO_FOLLOW_LIVE_MAX_OPEN ?? 3);
const LIVE_MAX_DAILY_NOTIONAL    = Number(process.env.AUTO_FOLLOW_LIVE_MAX_DAILY_NOTIONAL ?? 50_000);
const LIVE_MAX_PER_TRADE_NOTIONAL = Number(process.env.AUTO_FOLLOW_LIVE_MAX_PER_TRADE_NOTIONAL ?? 15_000);
const LIVE_BRACKET_MODE          = (process.env.AUTO_FOLLOW_LIVE_BRACKET_MODE ?? "stop_target") as "stop_only" | "stop_target";

// ── Cooling-off (behavior / discipline lens) ────────────────────────────
/** After N consecutive stop-losses today, auto-follow pauses for the rest of the
 *  day. Prevents revenge-trading / over-leverage after a losing streak. */
const COOLING_OFF_AFTER_SL = Number(process.env.AUTO_FOLLOW_COOLING_OFF_AFTER_SL ?? 2);

// Patience filter — sit out CHOPPY regime entirely. Choppy markets are where
// retail loses most; not trading is alpha. Trend strategies need a trend.
const SKIP_CHOPPY_REGIME = (process.env.AUTO_FOLLOW_SKIP_CHOPPY ?? "1") === "1";

// Daily new-position cap (separate from max-open). Even on a great trend day,
// don't open more than N new positions in a single trading day. Caps attention drift.
const DAILY_NEW_POSITIONS_MAX = Number(process.env.AUTO_FOLLOW_DAILY_NEW_MAX ?? 5);

// Per-tick concentration cap. Prevents the regime-flicker disaster: if one
// tick's regime read is wrong, a system that takes EVERY qualifying idea bets
// the whole portfolio on that one read. Cap forces "best N by score" instead of
// "first N that fit cash". Combined with sort-by-score-desc below, this means
// only the highest-conviction ideas per tick get placed.
// Lesson stamped 2026-04-28: 6 positions entered in one tick on a TRENDING-UP
// flicker, regime reverted to CHOPPY same minute, lost 5.3% of paper capital.
const MAX_NEW_PER_TICK = Number(process.env.AUTO_FOLLOW_MAX_NEW_PER_TICK ?? 2);

// Per-tick margin reserve. Belt to the position-count cap's suspenders:
// caps total margin deployed in a single tick at X% of current cash, so even
// if MAX_NEW_PER_TICK is raised, no single tick can drain the account.
// Estimates margin as notional / 5 (INTRADAY MIS 5x leverage assumption).
// Default 40% leaves 60% for later ticks / better setups.
const MAX_MARGIN_PCT_PER_TICK = Number(process.env.AUTO_FOLLOW_MAX_MARGIN_PCT_PER_TICK ?? 40);
const MIS_LEVERAGE = 5;

// ── NSE-veteran size multipliers ────────────────────────────────────────
// "Expiry day, RBI day, earnings season, high VIX — half size. Stops are wider
// in vol but I keep risk constant by trading less." — veteran wisdom.
//
// Multiplicative — multiple conditions stack (e.g., expiry + earnings = 0.5×0.5 = 0.25).
// Floor at MIN_SIZE_MULTIPLIER so size never collapses to nothing.
const HIGH_VOL_VIX_THRESHOLD    = Number(process.env.SIZE_VIX_HIGH ?? 22);   // VIX > 22 → 50%
const EXTREME_VIX_THRESHOLD     = Number(process.env.SIZE_VIX_EXTREME ?? 28); // VIX > 28 → 25%
const EXPIRY_SIZE_MULTIPLIER    = Number(process.env.SIZE_EXPIRY_MULT ?? 0.5);
const EVENT_SIZE_MULTIPLIER     = Number(process.env.SIZE_EVENT_MULT ?? 0.5);
const MIN_SIZE_MULTIPLIER       = Number(process.env.SIZE_MIN_MULT ?? 0.25);

/** Returns true if today is any Thursday in IST (weekly expiry across NSE F&O). */
function isThursdayIST(d: Date = new Date()): boolean {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.getUTCDay() === 4;
}

/** Compute size multiplier from veteran filters. Stacks conditions multiplicatively. */
function computeSizeMultiplier(args: { vix: number | null; isThursday: boolean; isEventWindow: boolean }): { mult: number; reasons: string[] } {
  let m = 1.0;
  const reasons: string[] = [];

  if (args.vix !== null && args.vix >= EXTREME_VIX_THRESHOLD) {
    m *= 0.25;
    reasons.push(`extreme VIX ${args.vix.toFixed(1)} ≥ ${EXTREME_VIX_THRESHOLD} → 25%`);
  } else if (args.vix !== null && args.vix >= HIGH_VOL_VIX_THRESHOLD) {
    m *= 0.5;
    reasons.push(`high VIX ${args.vix.toFixed(1)} ≥ ${HIGH_VOL_VIX_THRESHOLD} → 50%`);
  }

  if (args.isThursday) {
    m *= EXPIRY_SIZE_MULTIPLIER;
    reasons.push(`F&O weekly expiry (Thursday) → ${(EXPIRY_SIZE_MULTIPLIER * 100).toFixed(0)}%`);
  }

  if (args.isEventWindow) {
    m *= EVENT_SIZE_MULTIPLIER;
    reasons.push(`event window → ${(EVENT_SIZE_MULTIPLIER * 100).toFixed(0)}%`);
  }

  if (m < MIN_SIZE_MULTIPLIER) m = MIN_SIZE_MULTIPLIER;
  return { mult: m, reasons };
}

export type AutoFollowOutcome = {
  enabled: boolean;
  brokerId: string;
  liveAuthorized: boolean;
  attempted: number;
  placed: number;
  skipped: { ideaId: string; reason: string }[];
  errors:  { ideaId: string; reason: string }[];
};

export interface AutoFollowOpts {
  /** For E2E only — bypasses market-hours guard inside placeOrderInternal. */
  forceOffHours?: boolean;
}

function nseSymbol(sym: string): string {
  if (sym.includes(":")) return sym.toUpperCase();
  return `NSE:${sym.toUpperCase()}-EQ`;
}

function roundToTick(price: number, tick: number): number {
  return Math.round(price / tick) * tick;
}

/** Counts consecutive most-recent SL hits among today's BullsAi-Auto calls.
 *  Returns the streak length so caller can compare against COOLING_OFF_AFTER_SL. */
async function consecutiveSlHitsToday(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const calls = await readCalls();
  // Filter to today's auto-generated calls, sort newest-first
  const todays = calls
    .filter(c => c.issuedAt.startsWith(today) && c.analyst.endsWith("(BullsAi Auto)"))
    .filter(c => c.status === "SL Hit" || c.status === "Target Hit")
    .sort((a, b) => Date.parse(b.closedAt ?? b.issuedAt) - Date.parse(a.closedAt ?? a.issuedAt));
  let streak = 0;
  for (const c of todays) {
    if (c.status === "SL Hit") streak += 1;
    else break;
  }
  return streak;
}

async function todaysLiveAutoFollowNotional(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const recent = await readAudit(500);
  let total = 0;
  for (const e of recent) {
    if (!e.at.startsWith(today)) continue;
    if (e.action !== "auto-follow") continue;
    if (e.result !== "ok") continue;
    const ix = (e.input ?? {}) as any;
    if (!ix.live) continue;
    if (!Number.isFinite(ix.notional)) continue;
    total += Number(ix.notional);
  }
  return total;
}

async function getContext(broker: BrokerAdapter): Promise<{ cash: number; openSymbols: Set<string>; openAutoFollow: number }> {
  if (broker.id === "paper") {
    const s = await readPaperState();
    const openSymbols = new Set<string>([
      ...s.positions.filter(p => p.netQty !== 0).map(p => p.symbol),
      ...s.orders.filter(o => o.status === 6 || o.status === 4).map(o => o.symbol),
    ]);
    const openAutoFollow = s.orders.filter(o => (o.orderTag ?? "").startsWith("auto-") && (o.status === 6 || o.status === 4)).length
      + s.positions.filter(p => p.netQty !== 0).length;
    return { cash: Math.max(0, s.cash), openSymbols, openAutoFollow };
  }
  // Live
  try {
    const funds = await broker.getFunds();
    const avail = funds.fund_limit?.find((f: any) => f.title?.toLowerCase().includes("available"))?.equityAmount ?? 0;
    const positions = await broker.getPositions();
    const orders = await broker.getOrders();
    const openSymbols = new Set<string>([
      ...(positions.netPositions ?? []).filter((p: any) => Number(p.netQty ?? p.qty ?? 0) !== 0).map((p: any) => String(p.symbol)),
      ...(orders ?? []).filter((o: any) => Number(o.status) === 6 || Number(o.status) === 4).map((o: any) => String(o.symbol)),
    ]);
    return { cash: Number(avail) || 0, openSymbols, openAutoFollow: openSymbols.size };
  } catch {
    return { cash: 0, openSymbols: new Set(), openAutoFollow: 0 };
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** After placing a live MARKET entry, poll Tradejini until status flips to filled. */
async function waitForFill(broker: BrokerAdapter, orderId: string, timeoutMs = 60_000): Promise<{ filled: boolean; tradedPrice?: number; reason?: string }> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const orders = await broker.getOrders();
      const me = orders.find(o => String(o.id) === String(orderId));
      if (me) {
        if (Number(me.status) === 2) return { filled: true, tradedPrice: Number(me.tradedPrice) || undefined };
        if (Number(me.status) === 1 || Number(me.status) === 3) return { filled: false, reason: `status=${me.status} ${me.message ?? ""}` };
      }
    } catch (e) {
      // transient — retry
    }
    await sleep(3_000);
  }
  return { filled: false, reason: `not filled within ${timeoutMs / 1000}s` };
}

export async function runAutoFollow(addedIdeas: TradeCall[], opts: AutoFollowOpts = {}): Promise<AutoFollowOutcome> {
  const broker = await activeBroker();
  const isLive = broker.id !== "paper";
  const liveAuthorized = isLive && AUTO_FOLLOW_ALLOW_LIVE && AUTO_FOLLOW_LIVE_CONFIRMED;

  const out: AutoFollowOutcome = {
    enabled: AUTO_FOLLOW_ENABLED,
    brokerId: broker.id,
    liveAuthorized,
    attempted: 0, placed: 0, skipped: [], errors: [],
  };

  if (!AUTO_FOLLOW_ENABLED) return out;
  if (addedIdeas.length === 0) return out;

  if (isLive && !liveAuthorized) {
    const missing = [
      !AUTO_FOLLOW_ALLOW_LIVE ? "AUTO_FOLLOW_ALLOW_LIVE=1" : null,
      !AUTO_FOLLOW_LIVE_CONFIRMED ? "AUTO_FOLLOW_LIVE_CONFIRMED=1" : null,
    ].filter(Boolean).join(" + ");
    for (const c of addedIdeas) out.skipped.push({ ideaId: c.id, reason: `live auto-follow gated — missing: ${missing}` });
    return out;
  }

  const ctx = await getContext(broker);
  if (ctx.cash <= 0) {
    for (const c of addedIdeas) out.skipped.push({ ideaId: c.id, reason: `no cash available (₹${ctx.cash})` });
    return out;
  }

  // Behavior/discipline gate — cooling-off after consecutive SL hits.
  const slStreak = await consecutiveSlHitsToday();
  if (COOLING_OFF_AFTER_SL > 0 && slStreak >= COOLING_OFF_AFTER_SL) {
    for (const c of addedIdeas) out.skipped.push({ ideaId: c.id, reason: `cooling-off active: ${slStreak} consecutive SL hits today (≥ threshold ${COOLING_OFF_AFTER_SL}). Resets at next IST midnight.` });
    return out;
  }

  // Patience filter — skip CHOPPY entirely. Trend strategies need a trend; reversal
  // strategies in choppy markets get whipsawed. Sitting out is alpha.
  if (SKIP_CHOPPY_REGIME) {
    const regime = await readLastRegime();
    if (regime?.regime === "CHOPPY") {
      for (const c of addedIdeas) out.skipped.push({ ideaId: c.id, reason: `patience filter: regime CHOPPY (breadth ${regime.breadthPct.toFixed(0)}%, VIX ${regime.vix.toFixed(1)}) — sitting out` });
      return out;
    }
  }

  // ── NSE-veteran time-window gates ──
  // Skipped under forceOffHours (E2E tests, manual force) since the test rig
  // runs outside market hours and shouldn't be blocked by them.
  if (!opts.forceOffHours) {
    const minNow = istMinutes();
    if (minNow < VETERAN_OPENING_END) {
      for (const c of addedIdeas) out.skipped.push({ ideaId: c.id, reason: `veteran gate: opening blackout 09:15–09:30 IST — false breakouts likely` });
      return out;
    }
    if (minNow >= VETERAN_LUNCH_FROM && minNow < VETERAN_LUNCH_TO) {
      for (const c of addedIdeas) out.skipped.push({ ideaId: c.id, reason: `veteran gate: lunch lull 12:00–13:30 IST — thin liquidity, slippage worse` });
      return out;
    }
    if (minNow >= VETERAN_CLOSING_FROM) {
      for (const c of addedIdeas) out.skipped.push({ ideaId: c.id, reason: `veteran gate: closing blackout from 15:15 IST — squareoff cascades, no time for thesis` });
      return out;
    }
  }

  // Refresh F&O ban list once per day (cheap if already cached)
  refreshBanList().catch(e => console.warn("[ban-list] refresh failed:", (e as Error).message));

  // Daily new-position cap — count today's successful auto-follow entries
  const todayIso = new Date().toISOString().slice(0, 10);
  const todaysAutoFollowOk = (await readAudit(500)).filter(e =>
    e.action === "auto-follow" && e.result === "ok" && e.at.startsWith(todayIso)
  ).length;
  if (DAILY_NEW_POSITIONS_MAX > 0 && todaysAutoFollowOk >= DAILY_NEW_POSITIONS_MAX) {
    for (const c of addedIdeas) out.skipped.push({ ideaId: c.id, reason: `daily new-position cap reached (${todaysAutoFollowOk}/${DAILY_NEW_POSITIONS_MAX}). Resets at next IST midnight.` });
    return out;
  }

  // Mode-specific config
  // For PAPER: read riskPct from disk-backed risk-config (allows daily-self-improvement
  // R3/R4 cooling-off to actually take effect). Falls back to env var on read failure.
  // For LIVE: keep env var only — live tuning needs explicit human authorization, not
  // auto-tuner drift. Adversarial finding ADV (2026-04-30 360-review): without this,
  // R3/R4 writes were decorative.
  const minScore = isLive ? LIVE_MIN_SCORE : AUTO_FOLLOW_MIN_SCORE;
  let riskPct: number;
  if (isLive) {
    riskPct = LIVE_RISK_PCT;
  } else {
    try {
      const cfg = await readRiskConfig();
      riskPct = cfg.riskPct;
    } catch {
      riskPct = AUTO_FOLLOW_RISK_PCT;
    }
  }
  const maxOpen  = isLive ? LIVE_MAX_OPEN  : AUTO_FOLLOW_MAX_OPEN;

  // ── NSE-veteran size adjustment for this tick ──
  // Compute once per tick; same for all ideas processed below.
  const tickRegime = await readLastRegime();
  const eventFlag = eventWindowFor(new Date());
  const sizeMult = computeSizeMultiplier({
    vix: tickRegime?.vix ?? null,
    isThursday: isThursdayIST(),
    isEventWindow: eventFlag.isWithinEventWindow,
  });
  if (sizeMult.reasons.length > 0) {
    console.log(`[auto-follow] size multiplier ${(sizeMult.mult * 100).toFixed(0)}% — ${sizeMult.reasons.join("; ")}`);
  }
  const riskCashPerTrade = ctx.cash * (riskPct / 100) * sizeMult.mult;
  let openCount = ctx.openAutoFollow;
  let placedThisTick = 0;
  let marginUsedThisTick = 0;
  const marginCapThisTick = ctx.cash * (MAX_MARGIN_PCT_PER_TICK / 100);

  // Live-only: read today's deployed notional to enforce daily cap
  let dailyNotionalUsed = isLive ? await todaysLiveAutoFollowNotional() : 0;

  // Sort highest-score first so the per-tick cap takes the BEST ideas, not
  // the first-by-arrival. Without this, a flicker tick fills the cap with
  // weak ideas and starves later high-conviction setups.
  const rankedIdeas = [...addedIdeas].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  for (const idea of rankedIdeas) {
    out.attempted += 1;
    if ((idea.score ?? 0) < minScore) {
      out.skipped.push({ ideaId: idea.id, reason: `score ${idea.score ?? "?"} < ${minScore}` });
      continue;
    }
    // Per-tick concentration cap applies to LIVE only. Paper trades unrestricted
    // to maximize data collection across all ideas the system generates.
    if (isLive && MAX_NEW_PER_TICK > 0 && placedThisTick >= MAX_NEW_PER_TICK) {
      out.skipped.push({ ideaId: idea.id, reason: `per-tick cap ${MAX_NEW_PER_TICK} reached — protects against regime-flicker over-entry` });
      continue;
    }
    if (openCount >= maxOpen) {
      out.skipped.push({ ideaId: idea.id, reason: `max open positions ${maxOpen} reached` });
      continue;
    }
    const sym = nseSymbol(idea.symbol);
    if (ctx.openSymbols.has(sym)) {
      out.skipped.push({ ideaId: idea.id, reason: `already have position/order on ${sym}` });
      continue;
    }
    // Veteran gate: skip if symbol on F&O ban list (forced exits at penalty)
    if (await isOnBanList(idea.symbol)) {
      out.skipped.push({ ideaId: idea.id, reason: `veteran gate: ${idea.symbol} on F&O ban list — skip` });
      continue;
    }
    const sl = Number(idea.stopLoss);
    const entry = Number(idea.entry);
    const target1 = Number(idea.target1);
    if (!(entry > 0 && sl > 0 && target1 > 0) || sl === entry) {
      out.skipped.push({ ideaId: idea.id, reason: `invalid entry/SL/T1 (${entry}/${sl}/${target1})` });
      continue;
    }
    const stopDist = Math.abs(entry - sl);
    let qty = Math.floor(riskCashPerTrade / stopDist);
    if (qty <= 0) {
      out.skipped.push({ ideaId: idea.id, reason: `qty=0 (stopDist ₹${stopDist.toFixed(2)} too wide for risk ₹${riskCashPerTrade.toFixed(0)})` });
      continue;
    }
    // Notional hard-cap enforcement — second line of defense after risk-per-trade.
    // High-priced stocks with tight stops produce qty × entry > broker cap → broker
    // rejects the entire order (lesson stamped 2026-04-28: ₹847k attempt rejected).
    // Capping qty here means we still place a (smaller) trade instead of zero.
    const qtyByNotionalCap = Math.floor(NOTIONAL_HARD_CAP / entry);
    if (qty > qtyByNotionalCap) {
      if (qtyByNotionalCap <= 0) {
        out.skipped.push({ ideaId: idea.id, reason: `entry ₹${entry.toFixed(2)} exceeds notional hard-cap ₹${NOTIONAL_HARD_CAP} → cannot trade single share` });
        continue;
      }
      qty = qtyByNotionalCap;
    }

    // ── Phase 4 step 2-3: per-strategy productType + CNC-aware sizing ──
    // CNC needs FULL notional in cash (no MIS leverage). Cap qty so
    // qty * entry ≤ 95% of available cash. Leaves headroom for slippage.
    // INTRADAY: existing leverage-aware sizing applies (5x via paper engine).
    const stratProductType = productTypeFor((idea as any).strategyId);
    if (stratProductType === "CNC") {
      const maxCnchQty = Math.floor((ctx.cash * 0.95) / entry);
      if (maxCnchQty <= 0) {
        out.skipped.push({ ideaId: idea.id, reason: `CNC swing needs full notional in cash; entry ₹${entry.toFixed(2)} exceeds 95% of available cash ₹${ctx.cash.toFixed(0)}` });
        continue;
      }
      if (qty > maxCnchQty) {
        // Clamp qty down to fit CNC cash constraint. Risk-per-trade reduces correspondingly.
        qty = maxCnchQty;
      }
    }

    // Per-tick margin cap applies to LIVE only. Paper deploys freely — the
    // paper engine's own cash check rejects when margin runs out.
    const estMargin = (qty * entry) / MIS_LEVERAGE;
    if (isLive && MAX_MARGIN_PCT_PER_TICK > 0 && (marginUsedThisTick + estMargin) > marginCapThisTick) {
      out.skipped.push({ ideaId: idea.id, reason: `per-tick margin cap ${MAX_MARGIN_PCT_PER_TICK}% of ₹${ctx.cash.toFixed(0)} cash (₹${marginCapThisTick.toFixed(0)}) would be exceeded (used ₹${marginUsedThisTick.toFixed(0)} + ₹${estMargin.toFixed(0)})` });
      continue;
    }

    // Live caps: per-trade notional + daily notional
    if (isLive) {
      const perTradeNotional = qty * entry;
      if (perTradeNotional > LIVE_MAX_PER_TRADE_NOTIONAL) {
        const cappedQty = Math.floor(LIVE_MAX_PER_TRADE_NOTIONAL / entry);
        if (cappedQty <= 0) {
          out.skipped.push({ ideaId: idea.id, reason: `per-trade notional cap ₹${LIVE_MAX_PER_TRADE_NOTIONAL} too low for ₹${entry}/share` });
          continue;
        }
        qty = cappedQty;
      }
      const liveNotional = qty * entry;
      if (dailyNotionalUsed + liveNotional > LIVE_MAX_DAILY_NOTIONAL) {
        out.skipped.push({ ideaId: idea.id, reason: `daily notional cap ₹${LIVE_MAX_DAILY_NOTIONAL} would be exceeded (used ₹${dailyNotionalUsed.toFixed(0)} + ₹${liveNotional.toFixed(0)})` });
        continue;
      }
      dailyNotionalUsed += liveNotional;
    }

    const side: 1 | -1 = idea.side === "BUY" ? 1 : -1;
    // Tag scheme: af-<cid> / af-<cid>-t / af-<cid>-s where cid is a 12-char compact id.
    // Stays under the 20-char tag limit even with role suffix; monitor regex matches `af-{cid}(-(s|t))?`.
    const cid = idea.id.replace(/[^a-z0-9]/gi, "").slice(-12);
    const tag = `af-${cid}`;
    const ocoGroup = `oco-${cid}`;

    // 1. ENTRY — stamp strategyId + maxHoldDays so the resulting position carries them
    //    through to max-hold-exit + per-strategy attribution.
    const stratId = (idea as any).strategyId as string | undefined;
    const stratMaxHoldDays = maxHoldDaysFor(stratId);
    const entryRes = await placeOrderInternal({
      symbol: sym, qty, type: 2, side, productType: stratProductType,
      limitPrice: 0, stopPrice: 0, validity: "DAY",
      orderTag: tag,
      strategyId: stratId,
      maxHoldDays: stratMaxHoldDays,
    }, { source: "auto-follow:entry", forceOffHours: opts.forceOffHours });

    if (!entryRes.ok) {
      out.errors.push({ ideaId: idea.id, reason: `entry rejected: ${entryRes.error}` });
      continue;
    }
    // Critical guard — paper engine returns ok=true even when canAfford rejects the
    // MARKET fill (status=3 internally). The `message` carries "Rejected: ...".
    // Without this check, bracket SL-M legs get placed for non-existent positions
    // and can fire short fills when LTP crosses the stop.
    if (entryRes.message && /^Rejected/i.test(entryRes.message)) {
      out.errors.push({ ideaId: idea.id, reason: `entry not filled (paper engine rejected): ${entryRes.message}` });
      continue;
    }

    const tick = tickSizeFor(idea.symbol);
    const targetPx = roundToTick(target1, tick);
    const stopPx   = roundToTick(sl, tick);
    const exitSide: 1 | -1 = side === 1 ? -1 : 1;

    // For LIVE: wait for entry fill before placing exits (Tradejini rejects exit orders without position).
    // For PAPER: paper engine fills MARKET immediately within placeOrder; no need to wait.
    let entryFilled = true;
    if (isLive) {
      const wait = await waitForFill(broker, entryRes.order_id, 60_000);
      entryFilled = wait.filled;
      if (!wait.filled) {
        out.errors.push({ ideaId: idea.id, reason: `entry not filled: ${wait.reason ?? "unknown"}; bracket skipped` });
        continue;
      }
    }
    if (!entryFilled) continue;

    // 2. STOP — always placed (the loss-cap leg)
    const slRes = await placeOrderInternal({
      symbol: sym, qty, type: 3, side: exitSide, productType: stratProductType,
      limitPrice: 0, stopPrice: stopPx, validity: "DAY",
      orderTag: `${tag}-s`,
      ocoGroup,
    }, { source: "auto-follow:stop", forceOffHours: opts.forceOffHours });
    if (!slRes.ok) out.errors.push({ ideaId: idea.id, reason: `stop leg rejected: ${slRes.error}` });

    // 3. TARGET — placed unless live + stop_only mode
    const placeTarget = !isLive || LIVE_BRACKET_MODE === "stop_target";
    if (placeTarget) {
      const tgtRes = await placeOrderInternal({
        symbol: sym, qty, type: 1, side: exitSide, productType: stratProductType,
        limitPrice: targetPx, stopPrice: 0, validity: "DAY",
        orderTag: `${tag}-t`,
        ocoGroup,
      }, { source: "auto-follow:target", forceOffHours: opts.forceOffHours });
      if (!tgtRes.ok) out.errors.push({ ideaId: idea.id, reason: `target leg rejected: ${tgtRes.error}` });
    }

    // Capture realized slippage (paper) — fill price comes from the placeOrder
    // response message ("Paper MARKET fill @ X.XX"). For live, we'd need a fresh
    // getOrders() call; deferred until live trades are running.
    let signalPrice: number | undefined;
    let fillPrice: number | undefined;
    let slippageBps: number | undefined;
    if (!isLive && entryRes.message) {
      const m = /@\s*([\d.]+)/.exec(entryRes.message);
      if (m) {
        fillPrice = Number(m[1]);
        signalPrice = entry;
        if (signalPrice > 0 && Number.isFinite(fillPrice)) {
          slippageBps = ((fillPrice - signalPrice) / signalPrice) * 10000 * (side === 1 ? 1 : -1);
        }
      }
    }

    out.placed += 1;
    openCount += 1;
    placedThisTick += 1;
    marginUsedThisTick += estMargin;
    await appendAudit({
      at: new Date().toISOString(),
      broker: "auto-follow",
      action: "auto-follow",
      input: {
        ideaId: idea.id, symbol: sym, side: idea.side, qty, score: idea.score,
        entry, stopLoss: sl, target1, live: isLive, notional: qty * entry,
        // Data-analyst attribution stamped from the idea
        strategyId: (idea as any).strategyId,
        regimeAtSignal: (idea as any).regimeAtSignal,
        sector: (idea as any).sector,
        snapshotPChange: (idea as any).snapshotPChange,
        snapshotTurnoverLakhs: (idea as any).snapshotTurnoverLakhs,
        isWithinEventWindow: (idea as any).isWithinEventWindow,
        eventName: (idea as any).eventName,
      },
      result: "ok",
      resultDetail: {
        entryOrderId: entryRes.order_id,
        ocoGroup,
        riskCash: riskCashPerTrade,
        bracketMode: isLive ? LIVE_BRACKET_MODE : "stop_target",
        // Slippage measurement
        signalPrice, fillPrice, slippageBps,
      },
    });
  }
  return out;
}
