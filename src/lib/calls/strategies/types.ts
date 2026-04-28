// A symbol snapshot from NSE's equity-stockIndices batch endpoint.
// Each strategy consumes this and returns either an idea or null.
export type SymbolSnapshot = {
  symbol: string;                 // e.g. "RELIANCE"
  companyName?: string;
  open: number;
  dayHigh: number;
  dayLow: number;
  lastPrice: number;
  previousClose: number;
  change: number;
  pChange: number;                // day %
  totalTradedVolume: number;      // today's volume (shares)
  totalTradedValue: number;       // in lakhs
  yearHigh: number;
  yearLow: number;
  industry?: string;
};

// What a strategy produces when it fires on a symbol.
export type StrategyIdea = {
  strategyId: string;             // e.g. "breakout-52wh"
  strategyName: string;           // human label used as analyst in the call card
  segment: "Equity" | "Intraday" | "Swing" | "BTST" | "Positional";
  side: "BUY" | "SELL";
  symbol: string;
  entry: number;                  // use current LTP
  target1: number;
  target2?: number;
  stopLoss: number;
  horizon: string;
  rationale: string;              // short human-readable explanation
  /** Strategy-native signal clarity (0–100). Scorer uses this as one input. */
  signalStrength?: number;
};

export type Regime = "TRENDING-UP" | "TRENDING-DOWN" | "CHOPPY";

export type Strategy = {
  id: string;
  name: string;
  description: string;
  /**
   * Regimes in which this strategy is allowed to fire. Generator filters using current regime.
   * Default (omitted) = all regimes — for back-compat / unproven strategies.
   */
  allowedRegimes?: Regime[];
  /** Pure function: given a symbol snapshot, optionally return an idea. */
  apply: (s: SymbolSnapshot) => StrategyIdea | null;
};
