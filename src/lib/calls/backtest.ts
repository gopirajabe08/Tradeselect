import { STRATEGIES } from "./strategies";
import type { Strategy, StrategyIdea, SymbolSnapshot } from "./strategies/types";
import { barToSnapshot, fetchDailyBars, withLimit, type HistoricalBar } from "./historical";
import { scoreIdea, type ScoringContext } from "./scoring";
import { computeRoundTripCosts, inferSegment } from "@/lib/risk/costs";
import { classifyRegime, type RegimeReading } from "./regime";

/**
 * Historical backtest engine.
 *
 *   1. For a given symbol universe and date range, fetch daily bars.
 *   2. For each day d (after enough lookback), synthesise a snapshot and run every strategy.
 *   3. If a strategy fires → simulate the trade forward up to `holdDays`:
 *        - if high[d+k] >= target1 first  → Target Hit at target1 (conservative fill)
 *        - if low[d+k]  <= stopLoss first → SL Hit at stopLoss
 *        - if both in same bar            → assume SL first (pessimistic)
 *        - if neither by d+holdDays       → Time Stop at close[d+holdDays]
 *   4. Aggregate per strategy: trades, wins, losses, avg return %, win rate, Sharpe (approx).
 */

const DEFAULT_UNIVERSE = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","ITC","SBIN","BHARTIARTL","KOTAKBANK",
  "LT","HCLTECH","AXISBANK","ASIANPAINT","MARUTI","M&M","SUNPHARMA","TITAN","ULTRACEMCO","BAJFINANCE",
  "WIPRO","ONGC","NTPC","POWERGRID","NESTLEIND","ADANIENT","ADANIPORTS","COALINDIA","JSWSTEEL","TATASTEEL",
  "TATAMOTORS","TECHM","BAJAJFINSV","HDFCLIFE","SBILIFE","BRITANNIA","DIVISLAB","CIPLA","DRREDDY","APOLLOHOSP",
  "GRASIM","HINDALCO","EICHERMOT","HEROMOTOCO","BAJAJ-AUTO","TATACONSUM","BPCL","UPL","SHREECEM","LTIM",
];

export type TradeResult = {
  strategy: string;
  symbol: string;
  entryDate: string;     // YYYY-MM-DD
  entry: number;
  target1: number;
  stopLoss: number;
  exitDate?: string;
  exitPrice?: number;
  returnPct: number;
  outcome: "Target Hit" | "SL Hit" | "Time Stop";
  score: number;         // conviction score at the time the idea fired
};

export type BucketPerformance = {
  bucket: string;         // "<60", "60-69", "70-79", "80-89", "90-100"
  trades: number;
  wins: number;
  winRate: number;
  avgReturn: number;       // gross — before costs
  avgReturnNet: number;    // net of realistic Indian transaction costs
  bestReturn: number;
  worstReturn: number;
  sharpe: number;
  sharpeNet: number;
};

export type StrategyPerformance = {
  strategyId: string;
  strategyName: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgReturn: number;       // gross
  avgReturnNet: number;    // post-cost
  bestReturn: number;
  worstReturn: number;
  totalReturn: number;
  sharpe: number;          // gross
  sharpeNet: number;       // post-cost
  avgCostPct: number;      // round-trip cost as % of notional, per trade avg
  avgScore: number;
  sampleTrades: TradeResult[];
};

/**
 * Score buckets for backtest. Note: backtest scores top out around ~80 because
 * historical NSE data doesn't include per-stock industry → sector component
 * (worth 20 pts live) always returns 0. So we bucket at lower thresholds than live.
 * Live "80+" ≈ backtest "65+"; live "70+" ≈ backtest "55+".
 */
function bucketOf(score: number): string {
  if (score >= 70) return "70+";
  if (score >= 60) return "60-69";
  if (score >= 50) return "50-59";
  if (score >= 40) return "40-49";
  return "<40";
}

function isWin(t: TradeResult): boolean {
  return t.outcome === "Target Hit" || (t.outcome === "Time Stop" && t.returnPct > 0);
}

/** Round-trip cost % for a trade — used to derive net returns. */
function tradeCostPct(t: TradeResult): number {
  const segment = inferSegment(t.symbol, "CNC");           // backtest universe is equity delivery
  const cost = computeRoundTripCosts({ productType: "CNC", qty: 1, price: t.entry, segment });
  return cost.asPctOfNotional;
}

function aggregateBucket(trades: TradeResult[]): Omit<BucketPerformance, "bucket"> {
  const wins = trades.filter(isWin).length;
  const returns = trades.map(t => t.returnPct);
  const netReturns = trades.map(t => t.returnPct - tradeCostPct(t));
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const meanNet = netReturns.length ? netReturns.reduce((a, b) => a + b, 0) / netReturns.length : 0;
  const sd = stddev(returns);
  const sdNet = stddev(netReturns);
  return {
    trades: trades.length,
    wins,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    avgReturn: mean,
    avgReturnNet: meanNet,
    bestReturn: returns.length ? Math.max(...returns) : 0,
    worstReturn: returns.length ? Math.min(...returns) : 0,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(returns.length) : 0,
    sharpeNet: sdNet > 0 ? (meanNet / sdNet) * Math.sqrt(netReturns.length) : 0,
  };
}

function stddev(xs: number[]): number {
  if (xs.length <= 1) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function simulateForward(idea: StrategyIdea, bars: HistoricalBar[], i: number, holdDays: number, score: number): TradeResult {
  const entry = idea.entry;
  const stopLoss = idea.stopLoss;
  const target = idea.target1;
  const isBuy = idea.side === "BUY";
  const entryDate = new Date(bars[i].t * 1000).toISOString().slice(0, 10);

  for (let k = 1; k <= holdDays && i + k < bars.length; k++) {
    const b = bars[i + k];
    const targetHit = isBuy ? b.h >= target : b.l <= target;
    const slHit     = isBuy ? b.l <= stopLoss : b.h >= stopLoss;

    if (targetHit && slHit) {
      // Both in same bar — pessimistic assumption: SL triggered first
      return {
        strategy: idea.strategyName, symbol: idea.symbol, entryDate, entry,
        target1: target, stopLoss,
        exitDate: new Date(b.t * 1000).toISOString().slice(0, 10),
        exitPrice: stopLoss,
        returnPct: ((isBuy ? stopLoss - entry : entry - stopLoss) / entry) * 100,
        outcome: "SL Hit",
        score,
      };
    }
    if (targetHit) {
      return {
        strategy: idea.strategyName, symbol: idea.symbol, entryDate, entry,
        target1: target, stopLoss,
        exitDate: new Date(b.t * 1000).toISOString().slice(0, 10),
        exitPrice: target,
        returnPct: ((isBuy ? target - entry : entry - target) / entry) * 100,
        outcome: "Target Hit",
        score,
      };
    }
    if (slHit) {
      return {
        strategy: idea.strategyName, symbol: idea.symbol, entryDate, entry,
        target1: target, stopLoss,
        exitDate: new Date(b.t * 1000).toISOString().slice(0, 10),
        exitPrice: stopLoss,
        returnPct: ((isBuy ? stopLoss - entry : entry - stopLoss) / entry) * 100,
        outcome: "SL Hit",
        score,
      };
    }
  }

  // Time stop: close at the final bar in the hold window
  const exitIdx = Math.min(i + holdDays, bars.length - 1);
  const exitBar = bars[exitIdx];
  const exitPrice = exitBar.c;
  return {
    strategy: idea.strategyName, symbol: idea.symbol, entryDate, entry,
    target1: target, stopLoss,
    exitDate: new Date(exitBar.t * 1000).toISOString().slice(0, 10),
    exitPrice,
    returnPct: ((isBuy ? exitPrice - entry : entry - exitPrice) / entry) * 100,
    outcome: "Time Stop",
    score,
  };
}

export async function runBacktest(opts?: {
  universe?: string[];
  range?: string;         // Yahoo range: "1mo", "3mo", "6mo", "1y"
  holdDays?: number;
  strategies?: Strategy[];
  /** When true (default), strategies are filtered by allowedRegimes against the
   *  classified regime for each historical day — matches live behavior. Set false
   *  to fire every strategy on every day (legacy behavior). */
  applyRegimeFilter?: boolean;
  /** Fixed VIX assumption (no historical VIX feed). Default 18 = NSE long-run median. */
  assumedVix?: number;
}): Promise<{
  universe: string[];
  range: string;
  totalTrades: number;
  regimeFilterApplied: boolean;
  byStrategy: StrategyPerformance[];
  byBucket: BucketPerformance[];
  byRegime: { regime: string; days: number; trades: number; winRate: number; avgReturnNet: number; sharpeNet: number }[];
}> {
  const universe   = opts?.universe ?? DEFAULT_UNIVERSE;
  const range      = opts?.range    ?? "3mo";
  const holdDays   = opts?.holdDays ?? 10;
  const strategies = opts?.strategies ?? STRATEGIES;
  const applyRegimeFilter = opts?.applyRegimeFilter ?? true;
  const assumedVix = opts?.assumedVix ?? 18;

  // Fetch bars for every symbol in parallel (bounded).
  const bySymbol = await withLimit(universe, 8, async sym => ({ sym, bars: await fetchDailyBars(sym, range) }));

  const allTrades: TradeResult[] = [];
  // Track regime per trade so we can aggregate by regime in the output
  const tradeToRegime: string[] = [];

  // Build a per-day median % change across the universe — used as the RS baseline
  // (we don't fetch Nifty 50 separately; the universe median is a reasonable proxy).
  const dayMedianPct = new Map<number, number>();
  const dayToPcts = new Map<number, number[]>();
  for (const { bars } of bySymbol) {
    for (let k = 1; k < bars.length; k++) {
      const day = Math.floor(bars[k].t / 86400) * 86400;
      const pct = ((bars[k].c - bars[k - 1].c) / bars[k - 1].c) * 100;
      const arr = dayToPcts.get(day) ?? [];
      arr.push(pct);
      dayToPcts.set(day, arr);
    }
  }
  dayToPcts.forEach((arr, day) => {
    arr.sort((a, b) => a - b);
    dayMedianPct.set(day, arr[Math.floor(arr.length / 2)] ?? 0);
  });

  const MIN_LOOKBACK = 10;

  // ── Pre-compute regime per day (matches live regime filter) ──
  // Build a snapshot collection per day across the universe, then classify regime once.
  const dayToSnapshots = new Map<number, SymbolSnapshot[]>();
  for (const { sym, bars } of bySymbol) {
    for (let i = MIN_LOOKBACK; i < bars.length; i++) {
      const snap = barToSnapshot(sym, bars, i);
      if (!snap) continue;
      const day = Math.floor(bars[i].t / 86400) * 86400;
      const arr = dayToSnapshots.get(day) ?? [];
      arr.push(snap);
      dayToSnapshots.set(day, arr);
    }
  }
  const dayToRegime = new Map<number, RegimeReading>();
  if (applyRegimeFilter) {
    dayToSnapshots.forEach((snaps, day) => {
      try {
        dayToRegime.set(day, classifyRegime(snaps, assumedVix));
      } catch { /* skip days where regime classifier errors */ }
    });
  }

  for (const { sym, bars } of bySymbol) {
    if (bars.length < MIN_LOOKBACK + 2) continue;
    for (let i = MIN_LOOKBACK; i < bars.length - 1; i++) {
      const snap = barToSnapshot(sym, bars, i);
      if (!snap) continue;
      const day = Math.floor(bars[i].t / 86400) * 86400;
      const dayRegime = dayToRegime.get(day);
      const ctx: ScoringContext = {
        niftyPctChange: dayMedianPct.get(day) ?? 0,
        industryAvgPct: new Map(),       // not available from historical NSE endpoint
      };
      for (const strat of strategies) {
        try {
          // Regime filter — match live behavior. Strategies without allowedRegimes fire in any regime.
          if (applyRegimeFilter && strat.allowedRegimes && dayRegime && !strat.allowedRegimes.includes(dayRegime.regime)) {
            continue;
          }
          const idea = strat.apply(snap);
          if (!idea) continue;
          const score = scoreIdea(idea, snap, ctx).total;
          allTrades.push(simulateForward(idea, bars, i, holdDays, score));
          tradeToRegime.push(dayRegime?.regime ?? "UNKNOWN");
        } catch { /* one bad fire shouldn't kill the run */ }
      }
    }
  }

  // Aggregate per strategy
  const byStrategy: StrategyPerformance[] = strategies.map(strat => {
    const trades = allTrades.filter(t => t.strategy === strat.name);
    const wins = trades.filter(isWin).length;
    const losses = trades.length - wins;
    const returns = trades.map(t => t.returnPct);
    const costPcts = trades.map(tradeCostPct);
    const netReturns = trades.map((t, i) => t.returnPct - costPcts[i]);
    const avgCostPct = costPcts.length ? costPcts.reduce((a, b) => a + b, 0) / costPcts.length : 0;
    const avgReturn = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const avgReturnNet = netReturns.length ? netReturns.reduce((a, b) => a + b, 0) / netReturns.length : 0;
    const sd = stddev(returns);
    const sdNet = stddev(netReturns);
    const avgScore = trades.length ? trades.reduce((a, b) => a + b.score, 0) / trades.length : 0;
    return {
      strategyId:   strat.id,
      strategyName: strat.name,
      trades:       trades.length,
      wins,
      losses,
      winRate:      trades.length ? (wins / trades.length) * 100 : 0,
      avgReturn,
      avgReturnNet,
      bestReturn:   returns.length ? Math.max(...returns) : 0,
      worstReturn:  returns.length ? Math.min(...returns) : 0,
      totalReturn:  returns.reduce((a, b) => a + b, 0),
      sharpe:       sd    > 0 ? (avgReturn    / sd)    * Math.sqrt(returns.length) : 0,
      sharpeNet:    sdNet > 0 ? (avgReturnNet / sdNet) * Math.sqrt(netReturns.length) : 0,
      avgCostPct,
      avgScore,
      sampleTrades: trades.slice(-10),
    };
  });

  // Aggregate per score bucket (THE answer to "is 80+ actually better?")
  const bucketOrder = ["<40", "40-49", "50-59", "60-69", "70+"];
  const byBucket: BucketPerformance[] = bucketOrder.map(b => {
    const trades = allTrades.filter(t => bucketOf(t.score) === b);
    return { bucket: b, ...aggregateBucket(trades) };
  });

  // Aggregate per regime (which regime days produced the best/worst trades)
  const regimeOrder = ["TRENDING-UP", "CHOPPY", "TRENDING-DOWN", "UNKNOWN"];
  const byRegime = regimeOrder.map(regime => {
    const idxs = tradeToRegime.map((r, i) => r === regime ? i : -1).filter(i => i >= 0);
    const trades = idxs.map(i => allTrades[i]);
    const wins = trades.filter(isWin).length;
    const returns = trades.map(t => t.returnPct);
    const netReturns = trades.map(t => t.returnPct - tradeCostPct(t));
    const meanNet = netReturns.length ? netReturns.reduce((a, b) => a + b, 0) / netReturns.length : 0;
    const sdNet = stddev(netReturns);
    const days = new Set<number>();
    for (const [day, regimeReading] of dayToRegime.entries()) {
      if (regimeReading.regime === regime) days.add(day);
    }
    return {
      regime,
      days: days.size,
      trades: trades.length,
      winRate: trades.length ? (wins / trades.length) * 100 : 0,
      avgReturnNet: meanNet,
      sharpeNet: sdNet > 0 ? (meanNet / sdNet) * Math.sqrt(netReturns.length) : 0,
    };
  }).filter(r => r.trades > 0 || r.days > 0);

  return {
    universe,
    range,
    totalTrades: allTrades.length,
    regimeFilterApplied: applyRegimeFilter,
    byStrategy,
    byBucket,
    byRegime,
  };
}
