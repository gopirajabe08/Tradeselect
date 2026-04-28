import type { Strategy, SymbolSnapshot, StrategyIdea } from "./types";

/**
 * Intraday momentum — "buy the leaders of today's session".
 *
 * Fires when:
 *   - Stock up ≥ 2 % today
 *   - Volume today is meaningfully above average (approx: totalTradedValue > ₹50 Cr)
 *   - Not so extended it's already peaked (pChange < 5 %)
 *
 * Why it works:
 *   - Strongest names tend to keep closing strong → BTST overnight gap-up
 *   - Volume confirmation separates genuine buyers from noise
 */
function turnoverCr(s: SymbolSnapshot): number {
  // NSE totalTradedValue is in RUPEES → Cr = /10_000_000
  return s.totalTradedValue / 10_000_000;
}

export const intradayMomentum: Strategy = {
  id: "momentum-intraday",
  name: "Intraday momentum leader",
  description: "Intraday/BTST on top % gainers with strong turnover.",
  allowedRegimes: ["TRENDING-UP"],   // momentum-chasers die in chop / down-trends

  apply(s: SymbolSnapshot): StrategyIdea | null {
    if (s.pChange < 2.0 || s.pChange > 5.0) return null;
    if (turnoverCr(s) < 50) return null;          // ≥ ₹50 Cr turnover = real participation
    if (s.lastPrice <= 0) return null;

    const entry    = +s.lastPrice.toFixed(2);
    const target1  = +(entry * 1.015).toFixed(2);   // +1.5 %
    const target2  = +(entry * 1.025).toFixed(2);   // +2.5 %
    const stopLoss = +(entry * 0.992).toFixed(2);   // −0.8 % (tight intraday)

    return {
      strategyId: this.id,
      strategyName: this.name,
      segment: "BTST",
      side: "BUY",
      symbol: s.symbol,
      entry, target1, target2, stopLoss,
      horizon: "Next session",
      rationale: `Up ${s.pChange.toFixed(2)}% on ₹${turnoverCr(s).toFixed(0)}Cr turnover — leading the session. Closing strong → gap-up follow-through setup.`,
    };
  },
};
