// Mock data for TradeSelect — the Springpadwealth clone.
// Two product pillars: AlphaPad (trade ideas) + BullsAi (algo trading) + subscription plans.

// ───────────────────────── Trade Ideas (AlphaPad) ─────────────────────────
export type Segment =
  | "Equity"     // positional equity cash
  | "Intraday"
  | "Swing"
  | "BTST"
  | "Positional"
  | "Futures"
  | "Options"
  | "MCX";

export type CallStatus = "Active" | "Target Hit" | "SL Hit" | "Closed" | "Expired";

export type TradeCall = {
  id: string;
  segment: Segment;
  symbol: string;
  displayName?: string;
  side: "BUY" | "SELL";
  entry: number;
  entryLow?: number;
  entryHigh?: number;
  target1: number;
  target2?: number;
  target3?: number;
  stopLoss: number;
  horizon: string;
  status: CallStatus;
  issuedAt: string;      // ISO
  analyst: string;
  rationale: string;
  ltp: number;
  closedPrice?: number;
  closedAt?: string;
  /** Conviction score 0–100, set by generator; undefined on human-published. */
  score?: number;
  // ── Data-analyst attribution fields (added 2026-04-27 for next-week analytics) ──
  /** Strategy id from STRATEGIES (e.g. "breakout-52wh"). Stable across renames. */
  strategyId?: string;
  /** Market regime at the moment the signal fired. */
  regimeAtSignal?: "TRENDING-UP" | "TRENDING-DOWN" | "CHOPPY";
  /** NSE-reported industry/sector at signal time. */
  sector?: string;
  /** % change vs prev close at signal time (entry-day momentum context). */
  snapshotPChange?: number;
  /** Total traded volume (shares) at signal time. */
  snapshotVolume?: number;
  /** Total traded value in lakhs at signal time (turnover/liquidity tag). */
  snapshotTurnoverLakhs?: number;
  /** True if signal fired within 24h of a known market-moving event (RBI / earnings / expiry / budget). */
  isWithinEventWindow?: boolean;
  /** Specific event name if isWithinEventWindow is true. */
  eventName?: string;
};

// Equity-side calls rebased to live NSE prices on 2026-04-24. % distances to
// target1 / target2 / stopLoss preserved from each analyst's original thesis so
// R:R and horizon semantics still hold. F&O / MCX entries kept as-is — no free
// live feed to rebase against; they'll refresh when Fyers goes live.
export const calls: TradeCall[] = [
  // Equity
  { id: "AP-2101", segment: "Equity", symbol: "RELIANCE", side: "BUY", entry: 1331, entryLow: 1326.45, entryHigh: 1335.55, target1: 1369.6, target2: 1396.75, stopLoss: 1306.1,
    horizon: "2–4 weeks", status: "Active", issuedAt: "2026-04-24T09:22:00Z", analyst: "Aditi Rao", rationale: "Reclaim above 20-DMA with rising volume; retail margins improving.",
    ltp: 1331 },
  { id: "AP-2099", segment: "Equity", symbol: "LT", side: "BUY", entry: 4012, target1: 4145.6, target2: 4257.15, stopLoss: 3922.95,
    horizon: "3–6 weeks", status: "Active", issuedAt: "2026-04-23T10:00:00Z", analyst: "Rahul Shetty", rationale: "Order book at record; infra capex tailwind intact.",
    ltp: 4012 },
  { id: "AP-2088", segment: "Equity", symbol: "ASIANPAINT", side: "SELL", entry: 2483.7, target1: 2397.5, target2: 2345.6, stopLoss: 2526.9,
    horizon: "2–3 weeks", status: "Active", issuedAt: "2026-04-22T14:10:00Z", analyst: "Aditi Rao", rationale: "Margin pressure from raw material + weak rural offtake.",
    ltp: 2483.7 },

  // Intraday
  { id: "AP-2110", segment: "Intraday", symbol: "ICICIBANK", side: "BUY", entry: 1325.8, target1: 1338.4, target2: 1345.7, stopLoss: 1317.45,
    horizon: "Intraday", status: "Target Hit", issuedAt: "2026-04-24T09:30:00Z", analyst: "Kunal Mehta", rationale: "Breakout above morning high, financials leading.",
    ltp: 1325.8, closedPrice: 1339.95, closedAt: "2026-04-24T12:05:00Z" },
  { id: "AP-2111", segment: "Intraday", symbol: "SBIN", side: "BUY", entry: 1100.95, target1: 1111.85, target2: 1119.9, stopLoss: 1094.1,
    horizon: "Intraday", status: "Active", issuedAt: "2026-04-24T10:02:00Z", analyst: "Kunal Mehta", rationale: "Flag breakout on 15m chart with strong volume.",
    ltp: 1100.95 },
  { id: "AP-2112", segment: "Intraday", symbol: "ITC", side: "SELL", entry: 301.45, target1: 298.25, target2: 296.35, stopLoss: 303.4,
    horizon: "Intraday", status: "SL Hit", issuedAt: "2026-04-24T09:45:00Z", analyst: "Priya Nair", rationale: "Rejection at supply zone; expected mean-revert.",
    ltp: 301.45, closedPrice: 303.45, closedAt: "2026-04-24T11:20:00Z" },

  // Swing
  { id: "AP-2075", segment: "Swing", symbol: "INFY", side: "BUY", entry: 1154.8, target1: 1195, target2: 1222.7, stopLoss: 1130.1,
    horizon: "1–2 weeks", status: "Active", issuedAt: "2026-04-23T11:00:00Z", analyst: "Rahul Shetty", rationale: "Bullish engulfing on daily; IT basket showing strength.",
    ltp: 1154.8 },
  { id: "AP-2070", segment: "Swing", symbol: "MARUTI", side: "BUY", entry: 13060, target1: 13342.1, target2: 13552.35, stopLoss: 12871.95,
    horizon: "1–2 weeks", status: "Active", issuedAt: "2026-04-22T09:45:00Z", analyst: "Aditi Rao", rationale: "Auto sector rotation; strong Apr volume data.",
    ltp: 13060 },

  // BTST
  { id: "AP-2120", segment: "BTST", symbol: "HDFCBANK", side: "BUY", entry: 785.15, target1: 794.35, stopLoss: 779.2,
    horizon: "Next session", status: "Active", issuedAt: "2026-04-24T15:10:00Z", analyst: "Kunal Mehta", rationale: "Closing near day's high; expecting gap-up follow-through.",
    ltp: 785.15 },
  { id: "AP-2105", segment: "BTST", symbol: "TCS", side: "BUY", entry: 2401, target1: 2436.3, stopLoss: 2383.45,
    horizon: "Next session", status: "Closed", issuedAt: "2026-04-23T15:15:00Z", analyst: "Priya Nair", rationale: "Post-results momentum setup.",
    ltp: 2401, closedPrice: 2423.3, closedAt: "2026-04-24T10:40:00Z" },

  // Positional
  { id: "AP-2060", segment: "Positional", symbol: "HDFCBANK", side: "BUY", entry: 785.15, target1: 838.05, target2: 874.95, stopLoss: 755.25,
    horizon: "2–3 months", status: "Active", issuedAt: "2026-04-15T10:00:00Z", analyst: "Aditi Rao", rationale: "Credit growth re-accelerating; NIMs stabilising.",
    ltp: 785.15 },
  { id: "AP-2055", segment: "Positional", symbol: "ICICIBANK", side: "BUY", entry: 1325.8, target1: 1443.4, target2: 1518.3, stopLoss: 1272.35,
    horizon: "2–3 months", status: "Active", issuedAt: "2026-04-10T10:00:00Z", analyst: "Rahul Shetty", rationale: "Best-in-class ROA, digital lead.",
    ltp: 1325.8 },

  // Futures
  { id: "AP-2130", segment: "Futures",   symbol: "NIFTY APR FUT",     displayName: "NIFTY APR FUT", side: "BUY", entry: 24510, target1: 24680, target2: 24800, stopLoss: 24380,
    horizon: "This week", status: "Active", issuedAt: "2026-04-24T09:20:00Z", analyst: "Kunal Mehta", rationale: "Index holding above 20-EMA; breadth improving.",
    ltp: 24545 },
  { id: "AP-2131", segment: "Futures",   symbol: "BANKNIFTY APR FUT", displayName: "BANKNIFTY APR FUT", side: "SELL", entry: 52200, target1: 51800, target2: 51550, stopLoss: 52450,
    horizon: "This week", status: "Target Hit", issuedAt: "2026-04-23T10:00:00Z", analyst: "Priya Nair", rationale: "Rejection at supply, PSU-bank weakness.",
    ltp: 51750, closedPrice: 51790, closedAt: "2026-04-24T11:10:00Z" },
  { id: "AP-2132", segment: "Futures",   symbol: "RELIANCE APR FUT",  displayName: "RELIANCE APR FUT", side: "BUY", entry: 2940, target1: 3025, stopLoss: 2895,
    horizon: "This week", status: "Active", issuedAt: "2026-04-24T10:15:00Z", analyst: "Aditi Rao", rationale: "Cash-side breakout confirmation.",
    ltp: 2945 },

  // Options
  { id: "AP-2140", segment: "Options",   symbol: "NIFTY 24500 CE APR",     displayName: "NIFTY 24500 CE (APR)", side: "BUY", entry: 145, target1: 185, target2: 220, stopLoss: 120,
    horizon: "2–3 days", status: "Active", issuedAt: "2026-04-24T09:25:00Z", analyst: "Kunal Mehta", rationale: "OI unwinding on calls + spot above 24500.",
    ltp: 152 },
  { id: "AP-2141", segment: "Options",   symbol: "BANKNIFTY 52000 PE APR", displayName: "BANKNIFTY 52000 PE (APR)", side: "BUY", entry: 210, target1: 280, target2: 340, stopLoss: 170,
    horizon: "Intraday", status: "Target Hit", issuedAt: "2026-04-23T10:10:00Z", analyst: "Priya Nair", rationale: "Supply zone reject; expected 400-pt fall.",
    ltp: 265, closedPrice: 292, closedAt: "2026-04-24T11:05:00Z" },
  { id: "AP-2142", segment: "Options",   symbol: "RELIANCE 2960 CE APR",   displayName: "RELIANCE 2960 CE (APR)", side: "BUY", entry: 28, target1: 45, stopLoss: 20,
    horizon: "2–3 days", status: "Active", issuedAt: "2026-04-24T10:30:00Z", analyst: "Aditi Rao", rationale: "IV low, gamma favourable near spot.",
    ltp: 31 },
  { id: "AP-2143", segment: "Options",   symbol: "HDFCBANK 1720 CE APR",   displayName: "HDFCBANK 1720 CE (APR)", side: "BUY", entry: 18, target1: 32, stopLoss: 12,
    horizon: "1–2 days", status: "Active", issuedAt: "2026-04-24T11:00:00Z", analyst: "Kunal Mehta", rationale: "Bullish cont. pattern; near ATM premium cheap.",
    ltp: 19 },

  // MCX
  { id: "AP-2150", segment: "MCX",       symbol: "CRUDEOIL APR FUT",   displayName: "CRUDEOIL APR FUT", side: "BUY", entry: 6780, target1: 6880, target2: 6950, stopLoss: 6720,
    horizon: "1–2 days", status: "Active", issuedAt: "2026-04-24T09:35:00Z", analyst: "Rahul Shetty", rationale: "Inventory draw + geopolitical risk bid.",
    ltp: 6802 },
  { id: "AP-2151", segment: "MCX",       symbol: "GOLD APR FUT",       displayName: "GOLD APR FUT",    side: "BUY", entry: 71200, target1: 71650, target2: 71950, stopLoss: 70900,
    horizon: "3–5 days", status: "Active", issuedAt: "2026-04-23T10:45:00Z", analyst: "Priya Nair", rationale: "Weaker DXY, ETF inflows resuming.",
    ltp: 71340 },
  { id: "AP-2152", segment: "MCX",       symbol: "SILVER APR FUT",     displayName: "SILVER APR FUT",  side: "BUY", entry: 84500, target1: 85400, stopLoss: 83900,
    horizon: "2–3 days", status: "SL Hit", issuedAt: "2026-04-21T11:00:00Z", analyst: "Rahul Shetty", rationale: "Industrial demand + precious metal leadership.",
    ltp: 84100, closedPrice: 83880, closedAt: "2026-04-23T14:00:00Z" },
];

// ───────────────────────── Option Chain (near-month) ─────────────────────────
export type OptionRow = {
  strike: number;
  ceLtp: number; ceChg: number; ceIv: number; ceOi: number; ceVol: number;
  peLtp: number; peChg: number; peIv: number; peOi: number; peVol: number;
};

export const optionChain: Record<"NIFTY" | "BANKNIFTY", { spot: number; expiry: string; rows: OptionRow[] }> = {
  NIFTY: {
    spot: 24545,
    expiry: "30-Apr-2026",
    rows: [
      { strike: 24300, ceLtp: 285, ceChg:  12, ceIv: 14.2, ceOi: 48200, ceVol: 22100, peLtp:  55, peChg:  -4, peIv: 13.8, peOi: 61300, peVol: 19400 },
      { strike: 24400, ceLtp: 210, ceChg:  10, ceIv: 13.9, ceOi: 72400, ceVol: 29800, peLtp:  80, peChg:  -6, peIv: 13.6, peOi: 78500, peVol: 24700 },
      { strike: 24500, ceLtp: 152, ceChg:   8, ceIv: 13.7, ceOi: 98100, ceVol: 41200, peLtp: 118, peChg: -10, peIv: 13.5, peOi: 92200, peVol: 30100 },
      { strike: 24600, ceLtp: 108, ceChg:   5, ceIv: 13.5, ceOi: 85300, ceVol: 35800, peLtp: 172, peChg: -14, peIv: 13.4, peOi: 68700, peVol: 21500 },
      { strike: 24700, ceLtp:  72, ceChg:   3, ceIv: 13.4, ceOi: 62100, ceVol: 28400, peLtp: 235, peChg: -18, peIv: 13.3, peOi: 45100, peVol: 15200 },
      { strike: 24800, ceLtp:  46, ceChg:   2, ceIv: 13.3, ceOi: 41200, ceVol: 19100, peLtp: 309, peChg: -22, peIv: 13.2, peOi: 29800, peVol: 10400 },
    ],
  },
  BANKNIFTY: {
    spot: 51790,
    expiry: "30-Apr-2026",
    rows: [
      { strike: 51500, ceLtp: 410, ceChg: -18, ceIv: 15.2, ceOi: 28100, ceVol: 11200, peLtp: 130, peChg:  12, peIv: 14.8, peOi: 36500, peVol: 14800 },
      { strike: 51700, ceLtp: 295, ceChg: -12, ceIv: 14.9, ceOi: 41300, ceVol: 17100, peLtp: 215, peChg:  18, peIv: 14.6, peOi: 44200, peVol: 16200 },
      { strike: 51800, ceLtp: 248, ceChg:  -8, ceIv: 14.8, ceOi: 52400, ceVol: 21800, peLtp: 265, peChg:  22, peIv: 14.5, peOi: 49100, peVol: 18400 },
      { strike: 52000, ceLtp: 172, ceChg:  -4, ceIv: 14.6, ceOi: 61200, ceVol: 25600, peLtp: 384, peChg:  30, peIv: 14.4, peOi: 42800, peVol: 15700 },
      { strike: 52200, ceLtp: 115, ceChg:  -2, ceIv: 14.5, ceOi: 48800, ceVol: 19400, peLtp: 525, peChg:  38, peIv: 14.3, peOi: 31500, peVol: 11300 },
      { strike: 52500, ceLtp:  62, ceChg:  -1, ceIv: 14.3, ceOi: 29700, ceVol: 11900, peLtp: 770, peChg:  48, peIv: 14.2, peOi: 19200, peVol:  7200 },
    ],
  },
};

// ───────────────────────── Futures Contracts ─────────────────────────
export type FuturesContract = {
  symbol: string;
  underlying: string;
  lotSize: number;
  expiry: string;
  ltp: number;
  dayChange: number;
  dayChangePct: number;
  marginPct: number;
};

export const futures: FuturesContract[] = [
  { symbol: "NIFTY APR FUT",     underlying: "NIFTY 50",        lotSize: 25,  expiry: "30-Apr-2026", ltp: 24545,  dayChange:  62,   dayChangePct:  0.25, marginPct: 13 },
  { symbol: "BANKNIFTY APR FUT", underlying: "NIFTY BANK",      lotSize: 15,  expiry: "30-Apr-2026", ltp: 51790,  dayChange: -180,  dayChangePct: -0.35, marginPct: 16 },
  { symbol: "FINNIFTY APR FUT",  underlying: "NIFTY FIN SVC",   lotSize: 40,  expiry: "30-Apr-2026", ltp: 23120,  dayChange:  35,   dayChangePct:  0.15, marginPct: 15 },
  { symbol: "RELIANCE APR FUT",  underlying: "RELIANCE",        lotSize: 250, expiry: "30-Apr-2026", ltp: 2945,   dayChange:  19,   dayChangePct:  0.65, marginPct: 20 },
  { symbol: "HDFCBANK APR FUT",  underlying: "HDFCBANK",        lotSize: 550, expiry: "30-Apr-2026", ltp: 1716,   dayChange:  -3,   dayChangePct: -0.20, marginPct: 20 },
  { symbol: "TCS APR FUT",       underlying: "TCS",             lotSize: 150, expiry: "30-Apr-2026", ltp: 4103,   dayChange: -22,   dayChangePct: -0.54, marginPct: 22 },
];

// ───────────────────────── BullsAi Algo Strategies ─────────────────────────
export type AlgoStrategy = {
  id: string;
  name: string;
  author: string;
  segment: "Equity" | "Options" | "Futures" | "MCX";
  kind: "Trend" | "Mean Reversion" | "Breakout" | "Arbitrage" | "Options Selling";
  description: string;
  cagr: number;
  winRate: number;
  maxDd: number;
  sharpe: number;
  subscribers: number;
  priceMonthly: number;
  state: "Live" | "Paper" | "Idle";
};

export const algos: AlgoStrategy[] = [
  { id: "algo-01", name: "Opening Range Breakout — Nifty",    author: "BullsAi Labs",    segment: "Futures", kind: "Breakout",        description: "Long/short Nifty futures based on 15m opening range breakout with volume filter.",                 cagr: 42, winRate: 58, maxDd: 11, sharpe: 1.7, subscribers: 1284, priceMonthly: 1499, state: "Live" },
  { id: "algo-02", name: "Iron Condor Weekly — BankNifty",    author: "Quant Desk",      segment: "Options", kind: "Options Selling", description: "Systematic weekly iron condor on BankNifty with dynamic wings and IV filter.",                      cagr: 28, winRate: 72, maxDd:  7, sharpe: 1.9, subscribers:  962, priceMonthly: 1999, state: "Live" },
  { id: "algo-03", name: "Supertrend Momentum — FnO Basket",  author: "Aditi Rao",       segment: "Equity",  kind: "Trend",           description: "Swing long F&O stocks on Supertrend(10,3) flip with ATR trailing stop.",                            cagr: 34, winRate: 46, maxDd: 16, sharpe: 1.4, subscribers:  538, priceMonthly:  999, state: "Paper" },
  { id: "algo-04", name: "Mean Reversion — Bank Stocks",      author: "Kunal Mehta",     segment: "Equity",  kind: "Mean Reversion",  description: "Pairs-based mean reversion across top 6 bank stocks with 2-sigma Z-score.",                         cagr: 22, winRate: 63, maxDd:  9, sharpe: 1.6, subscribers:  312, priceMonthly:  799, state: "Idle" },
  { id: "algo-05", name: "Gamma Scalper — Nifty 0DTE",        author: "BullsAi Labs",    segment: "Options", kind: "Options Selling", description: "Delta-hedged gamma scalping on Nifty weekly on expiry day.",                                       cagr: 54, winRate: 61, maxDd: 14, sharpe: 1.8, subscribers:  221, priceMonthly: 2499, state: "Live" },
  { id: "algo-06", name: "CRUDEOIL Trend Follower",            author: "Rahul Shetty",    segment: "MCX",     kind: "Trend",           description: "Donchian channel 20/10 trend-following on MCX CRUDEOIL day session.",                               cagr: 31, winRate: 44, maxDd: 18, sharpe: 1.3, subscribers:  176, priceMonthly:  899, state: "Paper" },
];

// ───────────────────────── Subscription Plans ─────────────────────────
export type Plan = {
  id: string;
  name: string;
  price: number;
  cadence: "month" | "quarter" | "year";
  tag?: string;
  features: string[];
};

export const plans: Plan[] = [
  { id: "p-m", name: "Premium Monthly",   price:  9750, cadence: "month",
    features: [
      "All segments: Equity, Intraday, Swing, BTST, Positional, F&O, MCX",
      "Real-time alerts via app + email + SMS",
      "Access to AlphaPad research community",
      "1-year historical data, backtesting support",
      "2 concurrent algo executions",
      "Up to 5 active strategies",
    ] },
  { id: "p-q", name: "Premium Quarterly", price: 25350, cadence: "quarter", tag: "Most Popular",
    features: [
      "Everything in Monthly",
      "Priority analyst support",
      "5 concurrent algo executions",
      "Up to 15 active strategies",
      "Advanced options strategy builder",
      "Saves ~₹3,900 vs monthly",
    ] },
  { id: "p-y", name: "Premium Yearly",    price: 78000, cadence: "year",
    features: [
      "Everything in Quarterly",
      "Unlimited concurrent executions",
      "Unlimited active strategies",
      "Dedicated relationship manager",
      "Exclusive quarterly portfolio review",
      "Saves ~₹39,000 vs monthly",
    ] },
];
