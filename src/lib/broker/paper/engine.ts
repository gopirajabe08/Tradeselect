import type {
  FyersProfile, FyersFunds, FyersHolding, FyersPosition, FyersOrder, FyersQuoteRow,
  PlaceOrderInput,
} from "../types";
import { readState, writeState, newOrderId, type PaperOrder, type PaperPosition, type PaperState } from "./store";
import { getLtp } from "./quotes";
import { computeCosts, inferSegment } from "@/lib/risk/costs";

// ─── Slippage model ───
// Real Indian equity MARKET orders fill at ASK on BUY, BID on SELL — not at LTP.
// Without modelling this, paper P&L looks ~0.05-0.20% better per round-trip than
// real money would deliver. SL-M orders also trigger to MARKET, so same cost applies.
// LIMIT orders that get hit pay no extra slippage (you got your price), but spread
// cost is implicit in the fact that they fill only when price crosses you.
const SLIPPAGE_BPS = Number(process.env.PAPER_SLIPPAGE_BPS ?? 5); // 5 bps = 0.05% default
const SLIPPAGE_FACTOR = SLIPPAGE_BPS / 10000;
function applySlippage(rawPrice: number, side: 1 | -1, isMarketLike: boolean): number {
  if (!isMarketLike || SLIPPAGE_FACTOR === 0) return rawPrice;
  return side === 1
    ? rawPrice * (1 + SLIPPAGE_FACTOR)   // BUY fills at ask = LTP + spread/2 + impact
    : rawPrice * (1 - SLIPPAGE_FACTOR);  // SELL fills at bid = LTP - spread/2 - impact
}

// ─── Helpers ───

function findPosition(s: PaperState, symbol: string, productType: PaperOrder["productType"]): PaperPosition | undefined {
  return s.positions.find(p => p.symbol === symbol && p.productType === productType);
}

/**
 * Approximate margin required for a BUY order — matches how real Indian brokers block cash.
 *   CNC / MTF         → full notional (pay for delivery)
 *   INTRADAY          → ~20% (5x leverage) — matches Indian broker MIS norms (Zerodha/Tradejini)
 *   MARGIN / CO / BO  → ~20% of notional (span + exposure for F&O / MCX)
 * SELL orders that close an existing long position don't need fresh cash — handled in canAfford().
 *
 * Recalibrated 2026-04-27: was full-notional (mult=1) — under-sized auto-follow on
 * a 10-position day, only 2 ideas could fund. Real INTRADAY trading uses MIS leverage
 * so paper should match.
 */
function marginMultiplier(productType: PaperOrder["productType"]): number {
  switch (productType) {
    case "MARGIN":
    case "CO":
    case "BO":
    case "INTRADAY": return 0.20;
    case "CNC":
    case "MTF":
    default:         return 1.00;
  }
}

/** Returns { ok, required, reason } — rejects the order before fill if cash is short. */
function canAfford(
  s: PaperState,
  side: 1 | -1,
  productType: PaperOrder["productType"],
  symbol: string,
  qty: number,
  fillPrice: number,
): { ok: true } | { ok: false; required: number; available: number; reason: string } {
  const available = s.cash;
  if (side === -1) {
    // SELL: free if closing an existing long of at least qty; else treat like short (needs margin).
    const existing = s.positions.find(p => p.symbol === symbol && p.productType === productType);
    const hold = s.holdings.find(h => h.symbol === symbol);
    const longQty = Math.max(existing?.netQty ?? 0, 0) + (hold?.quantity ?? 0);
    if (longQty >= qty) return { ok: true };
    // Shorting — paper rule: require MARGIN-style 20% even for equity (matches real MIS short margin)
    const required = qty * fillPrice * 0.20;
    if (required > available) {
      return { ok: false, required, available,
        reason: `Short requires ~₹${required.toFixed(0)} margin, have ₹${available.toFixed(0)}` };
    }
    return { ok: true };
  }
  // BUY
  const required = qty * fillPrice * marginMultiplier(productType);
  if (required > available) {
    return {
      ok: false, required, available,
      reason: `Insufficient cash: need ₹${required.toFixed(0)} (${productType === "MARGIN" || productType === "CO" || productType === "BO" ? "≈20% margin" : "full notional"}), have ₹${available.toFixed(0)}`,
    };
  }
  return { ok: true };
}

/** Apply a fill to positions — updates avg, qty, realized P&L + cash.
 *
 * Cash accounting uses a "margin-lock" model:
 *   Opening a position  (long or short)  →  cash -= qty * fillPrice * marginMult
 *   Closing a position                   →  cash += qty * entryAvg * marginMult + realizedP&L
 *
 * For CNC/INTRADAY (mult=1) this reduces to: BUY debits notional, SELL credits fillPrice*qty (full P&L).
 * For MARGIN/CO/BO (mult=0.2) only 20% of notional moves in/out, plus realized P&L.
 */
function applyFill(s: PaperState, o: PaperOrder, fillQty: number, fillPrice: number) {
  let p = findPosition(s, o.symbol, o.productType);
  if (!p) {
    p = {
      id: `${o.symbol}|${o.productType}`,
      symbol: o.symbol,
      productType: o.productType,
      netQty: 0, netAvg: 0,
      buyQty: 0, buyAvg: 0,
      sellQty: 0, sellAvg: 0,
      realized: 0,
      ltp: fillPrice,
    };
    s.positions.push(p);
  }

  const mult = marginMultiplier(o.productType);
  const notional = fillPrice * fillQty;
  const originalAvg = p.netAvg;

  // Split the fill into "closing existing" vs "opening new"
  let openQty = 0, closeQty = 0;
  if (o.side === 1) {
    if (p.netQty >= 0) { openQty = fillQty; }
    else { closeQty = Math.min(fillQty, -p.netQty); openQty = fillQty - closeQty; }
  } else {
    if (p.netQty > 0) { closeQty = Math.min(fillQty, p.netQty); openQty = fillQty - closeQty; }
    else { openQty = fillQty; }
  }

  // Cash: reserve margin on open; release margin + book P&L on close
  if (openQty > 0) {
    s.cash -= openQty * fillPrice * mult;
  }
  if (closeQty > 0) {
    const realizedPerUnit = o.side === 1
      ? (originalAvg - fillPrice)   // BUY covering short: profit when fill < entry
      : (fillPrice - originalAvg);  // SELL closing long:   profit when fill > entry
    const realizedTotal = realizedPerUnit * closeQty;
    s.cash += closeQty * originalAvg * mult + realizedTotal;
    p.realized += realizedTotal;
  }

  // Stamp position attribution on opening fills — needed for max-hold-exit and per-strategy P&L.
  // Stamps when the position transitions from flat (or was flat in this direction) to open.
  // Cleared when netQty returns to 0 below.
  const isOpeningFill = openQty > 0 && (
    (o.side === 1 && p.netQty <= 0) ||  // BUY that opens long (was flat or short)
    (o.side === -1 && p.netQty >= 0)    // SELL that opens short (was flat or long)
  );
  if (isOpeningFill && o.strategyId) {
    p.strategyId = o.strategyId;
    p.openedAt = Date.now();
    p.maxHoldDays = o.maxHoldDays;
  }

  // Apply realistic Indian-equity / F&O transaction costs to paper P&L. Without this,
  // paper-strategy returns look ~0.15 % better per round-trip than real money would deliver.
  const segment = inferSegment(o.symbol, o.productType);
  const sideLabel: "BUY" | "SELL" = o.side === 1 ? "BUY" : "SELL";
  const costs = computeCosts({
    productType: o.productType,
    side: sideLabel,
    qty: fillQty,
    price: fillPrice,
    segment,
  });
  s.cash -= costs.total;
  if (closeQty > 0) {
    // Treat costs as a realised debit when closing, so per-trade P&L reflects net.
    p.realized -= costs.total;
  }
  s.totalCosts = (s.totalCosts ?? 0) + costs.total;

  // Update position qty + avg
  if (o.side === 1) {
    if (p.netQty >= 0) {
      const newQty = p.netQty + fillQty;
      p.netAvg = newQty === 0 ? 0 : ((p.netQty * p.netAvg) + notional) / newQty;
      p.netQty = newQty;
    } else {
      p.netQty += closeQty;
      if (openQty > 0) { p.netAvg = fillPrice; p.netQty = openQty; }
      else if (p.netQty === 0) { p.netAvg = 0; }
    }
    const newBuyQty = p.buyQty + fillQty;
    p.buyAvg = newBuyQty === 0 ? 0 : ((p.buyQty * p.buyAvg) + notional) / newBuyQty;
    p.buyQty = newBuyQty;
  } else {
    if (p.netQty > 0) {
      p.netQty -= closeQty;
      if (openQty > 0) { p.netAvg = fillPrice; p.netQty = -openQty; }
      else if (p.netQty === 0) { p.netAvg = 0; }
    } else {
      const newShortQty = -p.netQty + fillQty;
      p.netAvg = ((-p.netQty * p.netAvg) + notional) / newShortQty;
      p.netQty = -newShortQty;
    }
    const newSellQty = p.sellQty + fillQty;
    p.sellAvg = newSellQty === 0 ? 0 : ((p.sellQty * p.sellAvg) + notional) / newSellQty;
    p.sellQty = newSellQty;
  }

  p.ltp = fillPrice;

  // Clear position attribution when netQty returns to flat — fresh attribution on next opening fill.
  if (p.netQty === 0) {
    p.strategyId = undefined;
    p.openedAt = undefined;
    p.maxHoldDays = undefined;
  }

  // CNC BUY → contribute to holdings
  if (o.productType === "CNC" && o.side === 1) {
    let h = s.holdings.find(h => h.symbol === o.symbol);
    if (!h) {
      h = {
        id: s.holdings.length + 1,
        symbol: o.symbol,
        quantity: 0,
        costPrice: 0,
        ltp: fillPrice,
        marketVal: 0,
        pl: 0,
      };
      s.holdings.push(h);
    }
    const newQty = h.quantity + fillQty;
    h.costPrice = newQty === 0 ? 0 : ((h.quantity * h.costPrice) + notional) / newQty;
    h.quantity = newQty;
    h.ltp = fillPrice;
    h.marketVal = h.quantity * h.ltp;
    h.pl = (h.ltp - h.costPrice) * h.quantity;
  }
  // CNC SELL → reduce holdings (if any)
  if (o.productType === "CNC" && o.side === -1) {
    const h = s.holdings.find(h => h.symbol === o.symbol);
    if (h) {
      h.quantity = Math.max(0, h.quantity - fillQty);
      h.ltp = fillPrice;
      h.marketVal = h.quantity * h.ltp;
      h.pl = (h.ltp - h.costPrice) * h.quantity;
      if (h.quantity === 0) s.holdings = s.holdings.filter(x => x !== h);
    }
  }
}

/**
 * Re-check all pending orders against current LTPs, and mark-to-market positions / holdings.
 *
 * Perf design (fire-and-forget):
 *   - Read endpoints NEVER block on NSE. They return current persisted state in <50 ms.
 *   - A background refresh is triggered (if not already running and we're past the TTL).
 *   - The refresh fetches all needed symbols in parallel, applies fills/M2M, persists state.
 *   - The NEXT poll (client polls every 10–15 s) sees the fresh data. Trade-off: up to
 *     one poll-cycle of staleness for page-load instantaneity.
 *   - Stale detection lets callers that DO need fresh data (e.g. placeOrder) await the refresh.
 */
let matchInFlight: Promise<void> | null = null;
let lastMatchAt = 0;
const MATCH_TTL_MS = 10_000;

async function doMatchRefresh(): Promise<void> {
  const s = await readState();
  const open = s.orders.filter(o => o.status === 6 || o.status === 4);
  const symbols = Array.from(new Set<string>([
    ...open.map(o => o.symbol),
    ...s.positions.map(p => p.symbol),
    ...s.holdings.map(h => h.symbol),
  ]));
  if (symbols.length === 0) { lastMatchAt = Date.now(); return; }

  const ltps = await Promise.all(symbols.map(sym => getLtp(sym).catch(() => null)));
  const ltpMap = new Map<string, number | null>();
  for (let i = 0; i < symbols.length; i++) ltpMap.set(symbols[i], ltps[i]);

  let mutated = false;

  for (const o of open) {
    const mark = ltpMap.get(o.symbol) ?? null;
    if (mark == null) continue;
    let fillPrice: number | null = null;
    if (o.type === 1) {
      if (o.side === 1 && mark <= o.limitPrice)  fillPrice = Math.min(mark, o.limitPrice);
      if (o.side === -1 && mark >= o.limitPrice) fillPrice = Math.max(mark, o.limitPrice);
    } else if (o.type === 3) {
      // SL-M: triggers to MARKET on hit — apply slippage
      if (o.side === 1 && mark >= o.stopPrice)  fillPrice = applySlippage(mark, o.side, true);
      if (o.side === -1 && mark <= o.stopPrice) fillPrice = applySlippage(mark, o.side, true);
    } else if (o.type === 4) {
      const triggered =
        (o.side === 1 && mark >= o.stopPrice) ||
        (o.side === -1 && mark <= o.stopPrice);
      if (triggered) {
        if (o.side === 1 && mark <= o.limitPrice)  fillPrice = Math.min(mark, o.limitPrice);
        if (o.side === -1 && mark >= o.limitPrice) fillPrice = Math.max(mark, o.limitPrice);
      }
    }
    if (fillPrice !== null) {
      const guard = canAfford(s, o.side, o.productType, o.symbol, o.qty, fillPrice);
      if (!guard.ok) {
        o.status = 3;
        o.message = `Rejected at trigger: ${guard.reason}`;
      } else {
        applyFill(s, o, o.qty, fillPrice);
        o.status = 2;
        o.filledQty = o.qty;
        o.tradedPrice = fillPrice;
        o.filledAt = Date.now();
        o.message = `Paper fill @ ${fillPrice.toFixed(2)}`;
        // OCO: when one leg of a bracket fills, cancel any open sibling legs.
        if (o.ocoGroup) {
          for (const sib of s.orders) {
            if (sib === o) continue;
            if (sib.ocoGroup !== o.ocoGroup) continue;
            if (sib.status === 6 || sib.status === 4) {
              sib.status = 1;
              sib.message = `OCO cancel — sibling ${o.id} filled`;
            }
          }
        }
      }
      mutated = true;
    }
  }

  for (const p of s.positions) {
    const ltp = ltpMap.get(p.symbol);
    if (typeof ltp === "number" && p.ltp !== ltp) { p.ltp = ltp; mutated = true; }
  }
  for (const h of s.holdings) {
    const ltp = ltpMap.get(h.symbol);
    if (typeof ltp === "number" && h.ltp !== ltp) {
      h.ltp = ltp;
      h.marketVal = h.quantity * h.ltp;
      h.pl = (h.ltp - h.costPrice) * h.quantity;
      mutated = true;
    }
  }

  if (mutated) await writeState(s);
  lastMatchAt = Date.now();
}

/** Default: fire-and-forget. Returns state immediately, schedules a background refresh. */
export async function matchPendingOrders(): Promise<PaperState> {
  if (!matchInFlight && Date.now() - lastMatchAt >= MATCH_TTL_MS) {
    matchInFlight = doMatchRefresh()
      .catch(e => { console.warn("[paper] background match failed:", (e as Error).message); })
      .finally(() => { matchInFlight = null; });
  }
  return readState();
}

/** For callers that DO need a fresh snapshot (e.g. critical order-status checks). */
export async function matchPendingOrdersAwait(): Promise<PaperState> {
  if (matchInFlight) await matchInFlight;
  else if (Date.now() - lastMatchAt >= MATCH_TTL_MS) {
    matchInFlight = doMatchRefresh()
      .catch(e => { console.warn("[paper] match failed:", (e as Error).message); })
      .finally(() => { matchInFlight = null; });
    await matchInFlight;
  }
  return readState();
}

// ─── PaperBroker (matches the FyersBroker shape) ───

export const PaperBroker = {
  id: "paper" as const,

  async getProfile(): Promise<FyersProfile> {
    return { fy_id: "PAPER", name: "Paper Trader", display_name: "Paper Trader", email_id: "paper@tradeselect.local" };
  },

  async getFunds(): Promise<FyersFunds> {
    const s = await readState();
    // Utilized = actual margin locked, not full notional. INTRADAY at 5x leverage
    // locks only 20% of notional, so utilized must scale by margin multiplier
    // (matches what was actually deducted from cash on fill).
    const utilized = s.positions.reduce((u, p) =>
      u + Math.abs(p.netQty) * p.netAvg * marginMultiplier(p.productType), 0);
    return {
      fund_limit: [
        { id: 1, title: "Starting Cash",     equityAmount: s.startingCash, commodityAmount: 0 },
        { id: 2, title: "Available Balance", equityAmount: Math.max(0, s.cash), commodityAmount: 0 },
        { id: 3, title: "Utilized Amount",   equityAmount: utilized,       commodityAmount: 0 },
        { id: 4, title: "Total Balance",     equityAmount: s.cash + utilized, commodityAmount: 0 },
      ],
    };
  },

  async getHoldings(): Promise<FyersHolding[]> {
    const s = await matchPendingOrders();
    return s.holdings.map(h => ({
      symbol: h.symbol,
      id: h.id,
      quantity: h.quantity,
      costPrice: h.costPrice,
      marketVal: h.marketVal,
      ltp: h.ltp,
      pl: h.pl,
      segment: "CM",
    }));
  },

  async getPositions(): Promise<{ netPositions: FyersPosition[]; overall?: any }> {
    const s = await matchPendingOrders();
    const netPositions: FyersPosition[] = s.positions
      .filter(p => p.netQty !== 0 || p.realized !== 0)
      .map(p => ({
        symbol: p.symbol,
        id: p.id,
        netQty: p.netQty,
        buyQty: p.buyQty,
        sellQty: p.sellQty,
        buyAvg: p.buyAvg,
        sellAvg: p.sellAvg,
        netAvg: p.netAvg,
        productType: p.productType,
        side: p.netQty >= 0 ? 1 : -1,
        realized_profit: p.realized,
        unrealized_profit: p.netQty === 0 ? 0 : (p.ltp - p.netAvg) * p.netQty,
        pl: p.realized + (p.netQty === 0 ? 0 : (p.ltp - p.netAvg) * p.netQty),
        ltp: p.ltp,
        segment: 10,
      }));
    return { netPositions };
  },

  async getOrders(): Promise<FyersOrder[]> {
    const s = await matchPendingOrders();
    return s.orders.map(o => ({
      id: o.id,
      symbol: o.symbol,
      qty: o.qty,
      remainingQuantity: o.qty - o.filledQty,
      filledQty: o.filledQty,
      status: o.status,
      side: o.side,
      type: o.type,
      productType: o.productType,
      limitPrice: o.limitPrice,
      stopPrice: o.stopPrice,
      tradedPrice: o.tradedPrice,
      orderDateTime: new Date(o.createdAt).toISOString(),
      orderValidity: o.validity,
      parentId: null,
      message: o.message,
    }));
  },

  async getQuotes(symbols: string[]): Promise<FyersQuoteRow[]> {
    const out: FyersQuoteRow[] = [];
    for (const s of symbols) {
      const ltp = await getLtp(s);
      if (ltp != null) {
        out.push({
          n: s,
          s: "ok",
          v: { ch: 0, chp: 0, lp: ltp, symbol: s },
        });
      }
    }
    return out;
  },

  async placeOrder(o: PlaceOrderInput): Promise<{ id: string; message?: string }> {
    const state = await readState();
    const now = Date.now();
    const id = newOrderId(state);
    const order: PaperOrder = {
      id,
      createdAt: now,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      productType: o.productType,
      qty: o.qty,
      limitPrice: o.limitPrice ?? 0,
      stopPrice:  o.stopPrice  ?? 0,
      validity:   o.validity   ?? "DAY",
      orderTag:   o.orderTag,
      ocoGroup:   o.ocoGroup,
      strategyId:  o.strategyId,
      maxHoldDays: o.maxHoldDays,
      status: 6, // open
      filledQty: 0,
      tradedPrice: 0,
    };

    // MARKET → fill immediately at NSE LTP + slippage (BUY pays ask, SELL gets bid).
    if (o.type === 2) {
      const ltp = await getLtp(o.symbol);
      const rawPrice = ltp ?? (order.limitPrice > 0 ? order.limitPrice : null);
      const fillPrice = rawPrice == null ? null : applySlippage(rawPrice, o.side, true);
      if (fillPrice == null) {
        order.status = 3;
        order.message = "Rejected: no market data. Use LIMIT with a price.";
      } else {
        const guard = canAfford(state, o.side, o.productType, o.symbol, o.qty, fillPrice);
        if (!guard.ok) {
          order.status = 3;
          order.message = `Rejected: ${guard.reason}`;
        } else {
          applyFill(state, order, order.qty, fillPrice);
          order.status = 2;
          order.filledQty = order.qty;
          order.tradedPrice = fillPrice;
          order.filledAt = now;
          order.message = `Paper MARKET fill @ ${fillPrice.toFixed(2)}`;
        }
      }
    }
    // LIMIT → check if already crossed
    else if (o.type === 1) {
      const ltp = await getLtp(o.symbol);
      // Upfront affordability check against the worst-case fill price.
      const worstPrice = ltp != null
        ? (o.side === 1 ? Math.min(ltp, order.limitPrice) : Math.max(ltp, order.limitPrice))
        : order.limitPrice;
      const guard = canAfford(state, o.side, o.productType, o.symbol, o.qty, worstPrice);
      if (!guard.ok) {
        order.status = 3;
        order.message = `Rejected: ${guard.reason}`;
      } else if (ltp != null) {
        const crossed =
          (o.side === 1  && ltp <= order.limitPrice) ||
          (o.side === -1 && ltp >= order.limitPrice);
        if (crossed) {
          const fillPrice = o.side === 1 ? Math.min(ltp, order.limitPrice) : Math.max(ltp, order.limitPrice);
          applyFill(state, order, order.qty, fillPrice);
          order.status = 2;
          order.filledQty = order.qty;
          order.tradedPrice = fillPrice;
          order.filledAt = now;
          order.message = `Paper LIMIT fill @ ${fillPrice.toFixed(2)}`;
        } else {
          order.message = `Queued (LTP ${ltp.toFixed(2)})`;
        }
      } else if (order.limitPrice > 0) {
        // No live quote (F&O / MCX / Options) — fill at user's specified limit price so the paper demo
        // end-to-end completes. When you switch to Fyers live, real LTP replaces this.
        applyFill(state, order, order.qty, order.limitPrice);
        order.status = 2;
        order.filledQty = order.qty;
        order.tradedPrice = order.limitPrice;
        order.filledAt = now;
        order.message = `Paper LIMIT fill @ ${order.limitPrice.toFixed(2)} (no live quote, assumed fill)`;
      } else {
        order.message = "Queued (no LTP and no limit price)";
      }
    }
    // SL-M / SL → always queued, matcher triggers
    else {
      order.message = "Queued (waiting for trigger)";
    }

    state.orders.push(order);
    await writeState(state);
    return { id, message: order.message };
  },

  async cancelOrder(orderId: string): Promise<{ id: string }> {
    const state = await readState();
    const o = state.orders.find(x => x.id === orderId);
    if (!o) throw new Error(`Order ${orderId} not found`);
    if (o.status !== 6 && o.status !== 4) throw new Error(`Order ${orderId} is not open`);
    o.status = 1;
    o.message = "Cancelled by user";
    await writeState(state);
    return { id: orderId };
  },
};
