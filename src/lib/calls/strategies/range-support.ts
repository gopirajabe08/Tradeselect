import type { Strategy, SymbolSnapshot, StrategyIdea } from "./types";

/**
 * Intraday range-support bounce — mean reversion that works in CHOPPY regimes
 * without depending on 52-week lows.
 *
 * The 52w-low strategy fires only on deep-pullback stocks (rare in any given
 * session). This one fires on stocks that pulled back inside today's range
 * and are bouncing off intraday support — far more frequent in sideways markets.
 *
 * Fires when:
 *   - LTP is in the lower 30% of today's day-range (pulled back from high)
 *   - LTP > dayLow * 1.005           (already bouncing, not still falling)
 *   - LTP >= previousClose * 0.985   (not crashing — capped 1.5% drop)
 *   - dayRange ≥ 1.5% of LTP         (meaningful range, not a tight nothing-day)
 *   - Annual range ≥ 1.3x            (skip chronic decliners)
 *   - yearHigh > LTP * 1.08          (real upside still on the table)
 *
 * Why it works in CHOPPY:
 *   - Range-bound markets reward mean reversion
 *   - Buying near intraday lows of liquid stocks captures the "bounce off support"
 *     pattern that retail buyers create when they see stocks "on sale" mid-day
 *   - Tight stop just below dayLow caps downside at ~1.5%
 */

function dayRangePct(s: SymbolSnapshot): number {
  return s.lastPrice > 0 ? ((s.dayHigh - s.dayLow) / s.lastPrice) * 100 : 0;
}

function positionInDayRange(s: SymbolSnapshot): number {
  const range = s.dayHigh - s.dayLow;
  if (range <= 0) return 50;
  return ((s.lastPrice - s.dayLow) / range) * 100;
}

function annualRange(s: SymbolSnapshot): number {
  return s.yearLow > 0 ? s.yearHigh / s.yearLow : 0;
}

export const intradayRangeSupport: Strategy = {
  id: "range-support",
  name: "Intraday range-support bounce",
  description: "Long setups on liquid stocks pulling back to the lower third of today's range and bouncing off intraday support.",
  allowedRegimes: ["CHOPPY"],

  apply(s: SymbolSnapshot): StrategyIdea | null {
    if (s.lastPrice <= 0 || s.dayHigh <= s.dayLow) return null;

    const dayRng = dayRangePct(s);
    if (dayRng < 0.8) return null;                       // early-session friendly

    const pos = positionInDayRange(s);
    if (pos > 40) return null;                           // lower 40% of range

    if (s.lastPrice < s.previousClose * 0.98) return null; // cap 2% drop — no falling knives

    if (annualRange(s) < 1.2) return null;               // skip chronic decliners
    if (s.yearHigh <= s.lastPrice * 1.05) return null;   // need ≥ 5% upside to year-high

    const entry    = +s.lastPrice.toFixed(2);
    // Target 1: revert to mid-range. Target 2: today's high or +2.5%, whichever lower.
    const midRange = (s.dayHigh + s.dayLow) / 2;
    const target1  = +Math.max(midRange, entry * 1.012).toFixed(2);
    const target2  = +Math.min(s.dayHigh, entry * 1.025).toFixed(2);
    // Stop: just below today's low, capped at -1.5%
    const stopLoss = +Math.max(s.dayLow * 0.995, entry * 0.985).toFixed(2);

    return {
      strategyId: this.id,
      strategyName: this.name,
      segment: "Intraday",
      side: "BUY",
      symbol: s.symbol,
      entry, target1, target2, stopLoss,
      horizon: "Intraday — exit by 15:00 IST",
      rationale: `In lower ${pos.toFixed(0)}% of today's ${dayRng.toFixed(1)}% range, bouncing ${(((s.lastPrice / s.dayLow) - 1) * 100).toFixed(2)}% off intraday low ₹${s.dayLow}. Annual range ${annualRange(s).toFixed(2)}x; year-high ₹${s.yearHigh} offers headroom.`,
    };
  },
};
