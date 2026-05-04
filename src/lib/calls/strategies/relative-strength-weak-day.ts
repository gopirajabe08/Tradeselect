import type { Strategy, SymbolSnapshot, StrategyIdea } from "./types";

/**
 * Relative Strength on Weak Day (RSWD)
 *
 * NSE-veteran setup for CHOPPY regimes. When the broad market is CHOPPY/weak
 * (breadth 50-65%, indecisive), stocks that are CLEARLY UP on the day are
 * demonstrating relative strength — buyers are present despite the weak tape.
 * Smart-money positioning ahead of broader rotation.
 *
 * Why CHOPPY-native:
 *   - In TRENDING-UP, "stock up 1%" is noise — most stocks are up
 *   - In CHOPPY (breadth ~55%), a stock up >1% with strong close is the SIGNAL
 *   - The setup IS the regime + relative strength combination
 *
 * Edge hypothesis:
 *   - Stock with +1% on a CHOPPY day = institutional accumulation in a weak tape
 *   - 1-3 day continuation as the broader market stays choppy and money rotates
 *     to the relative-strength names
 *
 * Critical advantage over VCB / HRVM: works with TODAY-ONLY data from NSE batch feed.
 * No bar history needed → fires in LIVE paper mode immediately.
 *
 * Fires when:
 *   - pChange ≥ +1.0 (clearly up; not noise)
 *   - close in upper 30% of dayRange (strong close, not a fade)
 *   - lastPrice ≥ 70% of yearHigh (not deep-pullback territory)
 *   - annualRange ≥ 1.3 (skip chronic decliners)
 *   - dayHigh > previousClose (made a new high vs prior close — confirms up-day momentum)
 *
 * Position rules:
 *   - Side: BUY
 *   - Entry: lastPrice
 *   - Target1: +2.5% (typical continuation magnitude)
 *   - Target2: +4.5% (extended)
 *   - StopLoss: max(dayLow * 0.99, entry * 0.985) — tight, preserve risk-reward
 *   - maxHoldDays: 3
 */
function dayRangePosition(s: SymbolSnapshot): number {
  const range = s.dayHigh - s.dayLow;
  if (range <= 0) return 50;
  return ((s.lastPrice - s.dayLow) / range) * 100;
}

function annualRange(s: SymbolSnapshot): number {
  return s.yearLow > 0 ? s.yearHigh / s.yearLow : 0;
}

export const relativeStrengthWeakDay: Strategy = {
  id: "rswd",
  name: "Relative strength on weak day",
  description: "Long setups on stocks up ≥1% with strong close while the regime is CHOPPY — institutional positioning despite weak tape.",
  allowedRegimes: ["CHOPPY"],   // CHOPPY-only; the regime IS the signal
  productType: "CNC",
  maxHoldDays: 3,

  apply(s: SymbolSnapshot): StrategyIdea | null {
    if (s.lastPrice <= 0) return null;
    if (s.pChange < 1.0) return null;                              // clearly up
    const closePos = dayRangePosition(s);
    if (closePos < 70) return null;                                // strong close (upper 30% of range)
    if (s.dayHigh <= s.previousClose) return null;                 // confirms momentum vs prior close
    if (annualRange(s) < 1.3) return null;                         // skip chronic decliners
    if (s.yearHigh > 0 && s.lastPrice < s.yearHigh * 0.7) return null;  // not deep pullback

    const entry    = +s.lastPrice.toFixed(2);
    const target1  = +(entry * 1.025).toFixed(2);                  // +2.5%
    const target2  = +(entry * 1.045).toFixed(2);                  // +4.5%
    const stopLoss = +Math.max(s.dayLow * 0.99, entry * 0.985).toFixed(2);

    return {
      strategyId: this.id,
      strategyName: this.name,
      segment: "Swing",
      side: "BUY",
      symbol: s.symbol,
      entry, target1, target2, stopLoss,
      horizon: "1–3 days",
      rationale: `+${s.pChange.toFixed(2)}% on weak tape, close ${closePos.toFixed(0)}% of range. Stop ₹${stopLoss}.`,
    };
  },
};
