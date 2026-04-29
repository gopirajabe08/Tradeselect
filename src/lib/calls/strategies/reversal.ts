import type { Strategy, SymbolSnapshot, StrategyIdea } from "./types";

/**
 * Oversold bounce — "buy strong stocks that have pulled back".
 *
 * Fires when:
 *   - LTP is within 20 % of its 52-week low (pctOfLow ≤ 120 %)
 *   - Stock is up today (pChange ≥ 0.3 %) — any positive day confirms bounce attempt
 *   - Stock was previously well above 52w low, so being near it = real sell-off, not terminal weakness
 *     (we proxy this by requiring yearHigh / yearLow > 1.4, i.e. decent annual range)
 *
 * Why it works:
 *   - Panic lows often mark cyclical turning points if fundamentals haven't broken
 *   - Tight stop just below 52w low caps the downside at ~3 %
 *
 * Thresholds widened 2026-04-28 (was pctOfLow ≤ 112, pChange ≥ 1.0) to surface more
 * setups in CHOPPY regime where the system was producing zero ideas.
 */
function pctOfLow(s: SymbolSnapshot): number {
  return s.yearLow > 0 ? (s.lastPrice / s.yearLow) * 100 : Infinity;
}
function range(s: SymbolSnapshot): number {
  return s.yearLow > 0 ? s.yearHigh / s.yearLow : 0;
}

export const reversalBounce: Strategy = {
  id: "reversal-52wl",
  name: "Oversold 52w-low bounce",
  description: "Long setups on stocks rebounding within 12% of their 52-week low with a positive daily candle. Multi-day swing — needs ~3 days for the bounce to play out.",
  allowedRegimes: ["CHOPPY"],   // mean-reversion works in range-bound markets, not in trends
  // Backtest evidence (2026-04-29):
  //   hold=3 days: +1.50 Sharpe (6mo), +0.65 Sharpe (2y) — robust positive edge
  //   hold=1 day:  -1.58 Sharpe (6mo), -2.48 Sharpe (2y) — bleeding as intraday
  // Therefore: this strategy MUST run as CNC swing, not INTRADAY.
  productType: "CNC",
  maxHoldDays: 3,

  apply(s: SymbolSnapshot): StrategyIdea | null {
    const pol = pctOfLow(s);
    if (pol > 120) return null;
    if (s.pChange < 0.3) return null;
    if (range(s) < 1.4) return null;                // skip chronic downtrenders
    if (s.lastPrice <= 0) return null;

    const entry    = +s.lastPrice.toFixed(2);
    const target1  = +(entry * 1.03).toFixed(2);    // +3 %
    const target2  = +(entry * 1.055).toFixed(2);   // +5.5 %
    const stopLoss = +Math.min(entry * 0.985, s.yearLow * 0.995).toFixed(2);  // just below 52w low

    return {
      strategyId: this.id,
      strategyName: this.name,
      segment: "Swing",
      side: "BUY",
      symbol: s.symbol,
      entry, target1, target2, stopLoss,
      horizon: "1–3 weeks",
      rationale: `Near 52w low ₹${s.yearLow} (${(pol - 100).toFixed(1)}% above); bouncing +${s.pChange.toFixed(2)}% today. Annual range ${range(s).toFixed(2)}x signals fundamental strength.`,
    };
  },
};
