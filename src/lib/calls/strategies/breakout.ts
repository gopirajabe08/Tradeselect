import type { Strategy, SymbolSnapshot, StrategyIdea } from "./types";

/**
 * 52-week-high breakout — "buy what's strong".
 *
 * Fires when:
 *   - LTP is within 1.5 % of the 52-week high (pctOfHigh ≥ 98.5 %)
 *   - Stock is up today (pChange > 0.3 %)
 *   - Not already above prior close by too much (avoid chasing a gap-up → enter only if chg < 4 %)
 *
 * Why it works:
 *   - Price making new highs has no overhead supply (nobody trapped above)
 *   - Momentum tends to continue for days–weeks after a fresh 52w-high breakout
 */
function pctOfHigh(s: SymbolSnapshot): number {
  return s.yearHigh > 0 ? (s.lastPrice / s.yearHigh) * 100 : 0;
}

export const breakout52wHigh: Strategy = {
  id: "breakout-52wh",
  name: "52-week-high breakout",
  description: "Long setups on stocks trading within 1.5% of their 52-week high with positive daily change.",
  allowedRegimes: ["TRENDING-UP"],   // breakouts work only when broader market is in trend

  apply(s: SymbolSnapshot): StrategyIdea | null {
    const poh = pctOfHigh(s);
    if (poh < 98.5) return null;
    if (s.pChange < 0.3 || s.pChange > 4.0) return null;   // skip gap-ups we missed
    if (s.lastPrice <= 0) return null;

    const entry   = +s.lastPrice.toFixed(2);
    const target1 = +(entry * 1.02).toFixed(2);             // +2 %
    const target2 = +(entry * 1.04).toFixed(2);             // +4 %
    const stopLoss = +(entry * 0.99).toFixed(2);            // −1 % (tight, breakout fails fast)

    return {
      strategyId: this.id,
      strategyName: this.name,
      segment: "Swing",
      side: "BUY",
      symbol: s.symbol,
      entry, target1, target2, stopLoss,
      horizon: "1–2 weeks",
      rationale: `Within ${(100 - poh).toFixed(2)}% of 52w high ₹${s.yearHigh}; up ${s.pChange.toFixed(2)}% today on ${Math.round(s.totalTradedVolume/1000)}k shares — clean breakout setup.`,
    };
  },
};
