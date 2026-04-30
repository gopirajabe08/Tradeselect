import type { Strategy, SymbolSnapshot, StrategyIdea } from "./types";

/**
 * High Relative Volume Momentum (HRVM)
 *
 * NSE-veteran setup: when a stock trades elevated 20-day average volume AND closes
 * in the upper third of its day's range, institutions are accumulating. The buy
 * pressure typically continues 2-3 sessions.
 *
 * Indian market context:
 *   - Institutional flows drive 60%+ of NSE volume
 *   - Smart-money "block trades" show up as RVOL spikes
 *   - Retail follows the next 1-3 days, providing follow-through
 *
 * Fires when:
 *   - Today's volume / 20-day avg ≥ RVOL_THRESHOLD (institutional tell)
 *   - Close in upper 30% of day's range (strength confirmation)
 *   - pChange > 0 (positive day, not catching falling knife)
 *   - Annual range ≥ 1.3x (skip chronic decliners)
 *   - LTP ≥ 70% of yearHigh (avoid deep-pullback territory)
 *
 * Multi-day swing: holds for ~3 days.
 *
 * Threshold tuning (2026-04-30 sweep, 6mo backtest, hold=3):
 *   RVOL≥1.0  → 61 trades, Sharpe 0.10  (edge collapses, too noisy)
 *   RVOL≥1.25 → 38 trades, Sharpe 0.19  (best total P&L 17.4%, Sharpe below 0.3)
 *   RVOL≥1.5  → 20 trades, Sharpe 0.22  ★ shipped — 3.3× more fires, Sharpe holds
 *   RVOL≥1.75 → 10 trades, Sharpe 0.41  (best Sharpe, fewer fires)
 *   RVOL≥2.0  →  6 trades, Sharpe 0.40  (original — too selective for paper learning)
 * Decision: 1.5× balances frequency (paper data accumulation) vs edge (Sharpe ≥ 0.20).
 */
function dayRangePosition(s: SymbolSnapshot): number {
  const range = s.dayHigh - s.dayLow;
  if (range <= 0) return 50;
  return ((s.lastPrice - s.dayLow) / range) * 100;
}

function annualRange(s: SymbolSnapshot): number {
  return s.yearLow > 0 ? s.yearHigh / s.yearLow : 0;
}

export const highRvolMomentum: Strategy = {
  id: "hrvm",
  name: "High RVOL momentum",
  description: "Long setups on stocks with >2x 20-day avg volume closing strong — institutional accumulation tell.",
  allowedRegimes: ["TRENDING-UP", "CHOPPY"],   // works in both; strongest in trending
  productType: "CNC",
  maxHoldDays: 3,

  apply(s: SymbolSnapshot): StrategyIdea | null {
    if (s.lastPrice <= 0) return null;
    // RVOL_THRESHOLD env-overridable to allow rapid tuning without code changes
    const RVOL_MIN = Number(process.env.HRVM_RVOL_THRESHOLD ?? 1.5);
    if (s.volumeRel20d === undefined || s.volumeRel20d < RVOL_MIN) return null;

    const closePos = dayRangePosition(s);
    if (closePos < 70) return null;                      // close in upper third

    if (s.pChange < 0) return null;                       // positive day required
    if (annualRange(s) < 1.3) return null;                // skip chronic decliners
    if (s.yearHigh > 0 && s.lastPrice < s.yearHigh * 0.7) return null;  // not deep pullback

    const entry    = +s.lastPrice.toFixed(2);
    const target1  = +(entry * 1.030).toFixed(2);         // +3.0% target
    const target2  = +(entry * 1.055).toFixed(2);         // +5.5% extended
    // Stop just below day's low — institutions defended this level
    const stopLoss = +Math.max(s.dayLow * 0.995, entry * 0.98).toFixed(2);

    return {
      strategyId: this.id,
      strategyName: this.name,
      segment: "Swing",
      side: "BUY",
      symbol: s.symbol,
      entry, target1, target2, stopLoss,
      horizon: "1–3 days",
      rationale: `RVOL ${s.volumeRel20d.toFixed(1)}x (institutional buy), close ${closePos.toFixed(0)}% of day's range, +${s.pChange.toFixed(2)}% on day. Stop below day-low ₹${s.dayLow}.`,
    };
  },
};
