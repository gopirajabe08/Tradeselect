import type { Strategy, SymbolSnapshot, StrategyIdea } from "./types";

/**
 * Volatility Contraction Breakout (VCB)
 *
 * NSE-veteran setup for CHOPPY regimes. When a stock's daily range tightens to its
 * narrowest of the last 4 days (NR4) AND the contraction is significant relative to
 * the 7-day median (rangeRel7d ≤ 0.6), price is "coiled". Coiled price has high
 * conditional probability of expanding within 1-3 days.
 *
 * Why CHOPPY-native:
 *   - Trend regimes don't produce contraction patterns — price keeps moving
 *   - CHOPPY regimes generate range-bound stocks; contractions PRECEDE next leg
 *   - When NIFTY breadth is 50-65 (today's typical CHOPPY day), 5-15% of stocks
 *     are in NR4 contraction at any given time
 *   - Edge: institutional positioning ahead of catalyst-driven breakouts
 *
 * Fires when:
 *   - isNR4 = true (today's range is narrowest of last 4 trading days)
 *   - rangeRel7d ≤ 0.65 (today's range is ≤ 65% of 7-day median range)
 *   - lastPrice within upper-half of dayRange (closing on the strong side, even within tight range)
 *   - pChange > -0.5 (not getting hammered; near-flat or slightly up)
 *   - Price > 80% of yearHigh (in established uptrend territory; avoid contractions in deep pullbacks)
 *   - Annual range ≥ 1.3 (skip chronic decliners)
 *
 * Position rules:
 *   - Side: BUY (we play the breakout to upside)
 *   - Entry: lastPrice (we're early — at end of contraction, before the breakout)
 *   - Target1: +3.0% (typical NR4 expansion)
 *   - Target2: +5.5% (extended)
 *   - StopLoss: dayLow × 0.99 (just below today's tight range floor)
 *   - maxHoldDays: 3 (NR4 expansions resolve within 3 sessions or fade)
 *
 * Live-mode caveat: requires `isNR4` + `rangeRel7d` populated. Backtester computes
 * these from bar history. Live NSE batch feed does NOT populate them. Strategy
 * returns null in current live paper mode until the live-bars extension lands.
 * Backtest evidence is what justifies shipping.
 */
function dayRangePosition(s: SymbolSnapshot): number {
  const range = s.dayHigh - s.dayLow;
  if (range <= 0) return 50;
  return ((s.lastPrice - s.dayLow) / range) * 100;
}

function annualRange(s: SymbolSnapshot): number {
  return s.yearLow > 0 ? s.yearHigh / s.yearLow : 0;
}

export const volatilityContractionBreakout: Strategy = {
  id: "vcb",
  name: "Volatility contraction breakout",
  description: "Long setups on stocks coiled at NR4 + ≤65% of 7-day median range, signaling pre-breakout institutional positioning.",
  allowedRegimes: ["CHOPPY"],   // CHOPPY-native — contractions form in range-bound markets
  productType: "CNC",
  maxHoldDays: 3,

  apply(s: SymbolSnapshot): StrategyIdea | null {
    if (s.lastPrice <= 0) return null;
    if (!s.isNR4) return null;
    if (s.rangeRel7d === undefined || s.rangeRel7d > 0.65) return null;

    const closePos = dayRangePosition(s);
    if (closePos < 50) return null;                       // closing in upper half of (tight) range

    if (s.pChange < -0.5) return null;                    // not getting hammered
    if (annualRange(s) < 1.3) return null;                // skip chronic decliners
    if (s.yearHigh > 0 && s.lastPrice < s.yearHigh * 0.8) return null;  // established uptrend territory

    const entry    = +s.lastPrice.toFixed(2);
    const target1  = +(entry * 1.030).toFixed(2);
    const target2  = +(entry * 1.055).toFixed(2);
    const stopLoss = +(s.dayLow * 0.99).toFixed(2);

    return {
      strategyId: this.id,
      strategyName: this.name,
      segment: "Swing",
      side: "BUY",
      symbol: s.symbol,
      entry, target1, target2, stopLoss,
      horizon: "1–3 days",
      rationale: `NR4 contraction (today's range ${(s.rangeRel7d * 100).toFixed(0)}% of 7d median), close ${closePos.toFixed(0)}% of range. Coiled for breakout from ₹${stopLoss} floor.`,
    };
  },
};
