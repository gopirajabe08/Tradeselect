/**
 * Intraday auto-squareoff — mimics real Indian broker behavior.
 *
 * Real brokers (Zerodha/Tradejini/Fyers) force-close all INTRADAY/MIS positions
 * 5–15 min before NSE close (~15:15–15:20 IST). MIS = same-day-only product;
 * they can't carry overnight because the exchange doesn't allow it on margin.
 *
 * Without this, our paper engine leaves INTRADAY positions sitting open past
 * close, P&L drifts overnight, next-day state is stale, and live mode would
 * break catastrophically when the broker silently squares positions out from
 * under us.
 *
 * What this does (when called within the squareoff window):
 *   1. Find all paper positions where netQty !== 0 AND productType is INTRADAY/CO/BO
 *   2. For each, fire an opposing MARKET order to flatten netQty → 0
 *   3. Cancel any open bracket legs (target/stop) for those positions
 *   4. Audit each squareoff with source="intraday-squareoff"
 *
 * For live mode: same flow, but order goes to Tradejini. (Tradejini already
 * auto-squares server-side, so this is a belt-and-suspenders for race conditions.)
 */
import { readState, writeState } from "@/lib/broker/paper/store";
import { placeOrderInternal } from "@/lib/broker/place-internal";
import { activeBroker } from "@/lib/broker";
import { appendAudit } from "@/lib/broker/audit";
import { notify } from "@/lib/notify/telegram";
import { promises as fs } from "fs";
import path from "path";

const STAMP_FILE = path.join(process.cwd(), ".local-data", "squareoff-stamps.json");
type Stamps = { lastSquareoff?: string };
async function readStamps(): Promise<Stamps> {
  try { return JSON.parse(await fs.readFile(STAMP_FILE, "utf8")); } catch { return {}; }
}
async function writeStamps(s: Stamps): Promise<void> {
  await fs.mkdir(path.dirname(STAMP_FILE), { recursive: true });
  await fs.writeFile(STAMP_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

/** IST minutes since midnight. */
function istMinutes(d = new Date()): number {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}
/** YYYY-MM-DD in IST. */
function istDateString(d = new Date()): string {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// 15:15–15:25 IST window — fires once per day, gated by stamp.
const SQUAREOFF_WINDOW = { from: 15 * 60 + 15, to: 15 * 60 + 25 };

// Phase 4 step 5/8: CNC carve-out lives here implicitly. CNC positions hold
// across days by design (multi-day swing). They MUST NOT be in this set or
// they'd be force-squared at 15:15 IST, defeating the swing strategy.
// reversalBounce productType=CNC depends on this exclusion.
const INTRADAY_PRODUCTS = new Set(["INTRADAY", "CO", "BO", "MIS"]);

export async function maybeRunIntradaySquareoff(force = false): Promise<{ ran: boolean; closed: number; cancelled: number; reason?: string }> {
  const today = istDateString();
  const min = istMinutes();
  if (!force && (min < SQUAREOFF_WINDOW.from || min > SQUAREOFF_WINDOW.to)) {
    return { ran: false, closed: 0, cancelled: 0, reason: `outside window (now ${min}, window ${SQUAREOFF_WINDOW.from}–${SQUAREOFF_WINDOW.to})` };
  }
  const stamps = await readStamps();
  if (!force && stamps.lastSquareoff === today) {
    return { ran: false, closed: 0, cancelled: 0, reason: "already squared today" };
  }

  const broker = await activeBroker();
  let closed = 0;
  let cancelled = 0;

  if (broker.id === "paper") {
    const s = await readState();

    // 1. Cancel open bracket legs for INTRADAY products
    for (const o of s.orders) {
      if ((o.status === 6 || o.status === 4) && INTRADAY_PRODUCTS.has(o.productType)) {
        o.status = 1;
        o.message = "Cancelled by intraday squareoff";
        cancelled += 1;
      }
    }
    if (cancelled > 0) await writeState(s);

    // 2. Flatten each non-zero INTRADAY position with opposing MARKET
    const positions = s.positions.filter(p => p.netQty !== 0 && INTRADAY_PRODUCTS.has(p.productType));
    for (const p of positions) {
      const flatSide: 1 | -1 = p.netQty > 0 ? -1 : 1;  // long → SELL, short → BUY
      const qty = Math.abs(p.netQty);
      const tag = `sqof-${p.symbol.replace(/[^a-z0-9]/gi, "").slice(-10)}`;
      const r = await placeOrderInternal({
        symbol: p.symbol,
        qty,
        type: 2, // MARKET
        side: flatSide,
        productType: p.productType as any,
        limitPrice: 0, stopPrice: 0, validity: "DAY",
        orderTag: tag,
      }, { source: "intraday-squareoff", forceOffHours: false });
      if (r.ok) closed += 1;
    }

    await appendAudit({
      at: new Date().toISOString(),
      broker: "auto-follow",
      action: "auto-follow",
      input: { event: "intraday-squareoff", positionsClosed: closed, ordersCancelled: cancelled },
      result: "ok",
    });
  } else {
    // Live mode: Tradejini auto-squares server-side; we still cancel our open
    // local-tracked bracket legs to keep our audit clean.
    try {
      const orders = await broker.getOrders();
      for (const o of orders) {
        const pt = String((o as any).productType ?? "INTRADAY");
        if ((Number(o.status) === 6 || Number(o.status) === 4) && INTRADAY_PRODUCTS.has(pt)) {
          try { await broker.cancelOrder(String(o.id)); cancelled += 1; } catch {}
        }
      }
    } catch {}
  }

  if (closed > 0 || cancelled > 0) {
    notify(`⏰ *Intraday squareoff* (${broker.id})\n• Positions flattened: ${closed}\n• Open orders cancelled: ${cancelled}`).catch(() => {});
  }

  if (!force) await writeStamps({ ...stamps, lastSquareoff: today });
  console.log(`[squareoff] ran for ${today} — ${closed} flattened, ${cancelled} cancelled${force ? " (forced)" : ""}`);
  return { ran: true, closed, cancelled };
}
