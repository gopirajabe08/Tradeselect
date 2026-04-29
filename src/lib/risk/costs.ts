/**
 * Indian equity / F&O transaction-cost calculator.
 *
 * Real costs that erode every paper-strategy backtest if ignored:
 *   • STT (Securities Transaction Tax)
 *   • Brokerage (₹20 flat or 0.03 %, whichever lower — typical discount-broker rate)
 *   • Exchange transaction charges (NSE)
 *   • SEBI turnover fee
 *   • Stamp duty (buy side only)
 *   • GST 18 % on (brokerage + exchange + SEBI)
 *
 * Numbers as of FY2025-26. STT was simplified post Budget 2024.
 * Update annually if the regulator changes any rate.
 *
 * Returns ₹ amount per leg (buy or sell). To get round-trip cost: callers add
 * cost(BUY) + cost(SELL) themselves — sides differ in STT and stamp-duty exposure.
 */

export type CostInput = {
  productType: "CNC" | "INTRADAY" | "MARGIN" | "MTF" | "CO" | "BO" | "NRML";
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  /**
   * Segment determines tax + charge structure:
   *   EQUITY    — NSE cash equity (delivery or intraday)
   *   FUT       — NSE/BFO equity futures
   *   OPT       — NSE/BFO equity options (charges on premium)
   *   COMMODITY — MCX commodity futures/options (CTT instead of STT)
   * Default = equity.
   */
  segment?: "EQUITY" | "FUT" | "OPT" | "COMMODITY";
  /** Optional override: ₹0 to model zero-brokerage (if a particular broker offers it). */
  brokeragePerTrade?: number;
};

export type CostBreakdown = {
  notional: number;
  stt: number;
  brokerage: number;
  exchange: number;
  sebi: number;
  stampDuty: number;
  gst: number;
  total: number;
  asPctOfNotional: number;     // % so caller can compare to expected return
};

const DISCOUNT_BROKERAGE = 20;   // ₹ flat per trade (typical discount broker)
const PERCENT_BROKERAGE  = 0.0003;  // 0.03 % cap

/** Computes brokerage as min(₹20, 0.03% × notional). */
function brokerageFor(notional: number, override?: number): number {
  if (override != null) return Math.max(0, override);
  return Math.min(DISCOUNT_BROKERAGE, notional * PERCENT_BROKERAGE);
}

/** Securities Transaction Tax — varies by product + side + segment. MCX uses CTT not STT. */
function sttFor(input: CostInput, notional: number): number {
  const { side, productType, segment = "EQUITY" } = input;
  if (segment === "EQUITY") {
    // Delivery (CNC, MTF): 0.1 % both sides
    if (productType === "CNC" || productType === "MTF") return notional * 0.001;
    // Intraday (INTRADAY, MARGIN with same-day square-off): 0.025 % sell only
    if (productType === "INTRADAY" || productType === "MARGIN") {
      return side === "SELL" ? notional * 0.00025 : 0;
    }
  } else if (segment === "FUT") {
    // Futures: 0.0125 % sell only
    return side === "SELL" ? notional * 0.000125 : 0;
  } else if (segment === "OPT") {
    // Options: 0.0625 % on premium, sell only
    return side === "SELL" ? notional * 0.000625 : 0;
  } else if (segment === "COMMODITY") {
    // MCX: CTT (Commodity Transaction Tax) — 0.01 % sell side on non-agri.
    // Agri commodities are exempt; we treat all as non-agri for paper modeling.
    return side === "SELL" ? notional * 0.0001 : 0;
  }
  return 0;
}

/** Exchange transaction charge — varies by segment + exchange. */
function exchangeFor(input: CostInput, notional: number): number {
  const seg = input.segment ?? "EQUITY";
  if (seg === "EQUITY")    return notional * 0.0000297;  // NSE 0.00297 %
  if (seg === "FUT")       return notional * 0.0000173;  // NSE 0.00173 %
  if (seg === "OPT")       return notional * 0.000495;   // NSE 0.0495 % on premium
  if (seg === "COMMODITY") return notional * 0.0000026;  // MCX ~0.00026 % (varies by commodity, this is non-agri average)
  return 0;
}

/** Stamp duty — buy side only; rate varies by segment. */
function stampDutyFor(input: CostInput, notional: number): number {
  if (input.side !== "BUY") return 0;
  const { productType, segment = "EQUITY" } = input;
  if (segment === "EQUITY") {
    if (productType === "CNC" || productType === "MTF") return notional * 0.00015;     // 0.015 %
    return notional * 0.00003;                                                          // intraday: 0.003 %
  }
  if (segment === "FUT")       return notional * 0.00002;     // 0.002 %
  if (segment === "OPT")       return notional * 0.00003;     // 0.003 % on premium
  if (segment === "COMMODITY") return notional * 0.00002;     // MCX 0.002 % buy-side
  return 0;
}

export function computeCosts(input: CostInput): CostBreakdown {
  const notional = input.qty * input.price;
  if (notional <= 0) {
    return { notional: 0, stt: 0, brokerage: 0, exchange: 0, sebi: 0, stampDuty: 0, gst: 0, total: 0, asPctOfNotional: 0 };
  }
  const stt        = sttFor(input, notional);
  const brokerage  = brokerageFor(notional, input.brokeragePerTrade);
  const exchange   = exchangeFor(input, notional);
  const sebi       = notional * 0.000001;                   // 0.0001 % = ₹10 per crore
  const stampDuty  = stampDutyFor(input, notional);
  const gst        = (brokerage + exchange + sebi) * 0.18;  // 18 % GST on broker + exchange + SEBI

  const total = stt + brokerage + exchange + sebi + stampDuty + gst;
  return {
    notional,
    stt,
    brokerage,
    exchange,
    sebi,
    stampDuty,
    gst,
    total,
    asPctOfNotional: (total / notional) * 100,
  };
}

/** Round-trip cost (BUY + SELL same notional). Use when comparing strategy edge against costs. */
export function computeRoundTripCosts(opts: Omit<CostInput, "side">): CostBreakdown {
  const buy  = computeCosts({ ...opts, side: "BUY" });
  const sell = computeCosts({ ...opts, side: "SELL" });
  const total = buy.total + sell.total;
  const notional = buy.notional;     // same on both sides
  return {
    notional,
    stt:       buy.stt + sell.stt,
    brokerage: buy.brokerage + sell.brokerage,
    exchange:  buy.exchange + sell.exchange,
    sebi:      buy.sebi + sell.sebi,
    stampDuty: buy.stampDuty + sell.stampDuty,
    gst:       buy.gst + sell.gst,
    total,
    asPctOfNotional: (total / notional) * 100,
  };
}

/** Maps a broker-format symbol + product to a rough segment for cost lookup. */
export function inferSegment(symbol: string, productType: CostInput["productType"]): "EQUITY" | "FUT" | "OPT" | "COMMODITY" {
  const u = symbol.toUpperCase();
  // MCX symbols always go to COMMODITY segment regardless of CE/PE/FUT suffix
  if (u.startsWith("MCX:")) return "COMMODITY";
  if (u.endsWith("CE") || u.endsWith("PE")) return "OPT";
  if (u.includes("FUT")) return "FUT";
  // NFO / BFO / CDS without explicit suffix — default to FUT
  if (u.startsWith("NFO:") || u.startsWith("BFO:") || u.startsWith("CDS:")) {
    return "FUT";
  }
  return "EQUITY";
}
