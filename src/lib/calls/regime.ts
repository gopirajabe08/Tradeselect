import type { SymbolSnapshot } from "./strategies/types";

/**
 * Market regime classification — drives strategy gating.
 *
 * Inputs:
 *   • breadth — % of universe stocks with pChange > 0 today (computed from snapshots)
 *   • vix     — INDIA VIX live value (fetched separately)
 *
 * Output regime:
 *   TRENDING-UP    : breadth ≥ 60 AND vix < 18   → momentum / breakout / gap strategies fire
 *   TRENDING-DOWN  : breadth < 40 AND vix > 18   → all BUY strategies stand down
 *   CHOPPY         : everything else             → only mean-reversion strategies fire
 *
 * Future v2: add Nifty 50 above-50DMA / above-200DMA when we have a reliable Nifty
 * historical fetcher; will tighten the classification.
 */

export type Regime = "TRENDING-UP" | "TRENDING-DOWN" | "CHOPPY";

export type RegimeReading = {
  regime: Regime;
  breadthPct: number;          // % of universe with pChange > 0
  vix: number;
  advances: number;
  declines: number;
  unchanged: number;
  reasoning: string;           // human-readable why
  computedAt: string;          // ISO timestamp
};

// Recalibrated 2026-04-27 after a strongly-bullish day (88% breadth, VIX 19.0)
// was wrongly tagged CHOPPY because VIX was just above the old 18 threshold.
// India VIX often sits 18–22 even in clear trending environments; old threshold
// was over-fitted to bear-market data. Spread BULL/BEAR thresholds so a borderline
// VIX doesn't kill obvious breadth signals.
const BREADTH_BULL = 60;
const BREADTH_BEAR = 40;
const VIX_BULL_MAX = 22;       // ≤ 22 still allows TRENDING-UP if breadth is strong
const VIX_BEAR_MIN = 26;       // > 26 needed alongside thin breadth for TRENDING-DOWN

/** Computes regime from a fresh snapshot of the live universe + VIX value. */
export function classifyRegime(snapshots: SymbolSnapshot[], vix: number): RegimeReading {
  let advances = 0, declines = 0, unchanged = 0;
  for (const s of snapshots) {
    if (s.pChange > 0.05) advances++;
    else if (s.pChange < -0.05) declines++;
    else unchanged++;
  }
  const total = advances + declines + unchanged;
  const breadthPct = total > 0 ? (advances / total) * 100 : 50;

  let regime: Regime;
  let reason: string;
  if (breadthPct >= BREADTH_BULL && vix < VIX_BULL_MAX) {
    regime = "TRENDING-UP";
    reason = `Breadth ${breadthPct.toFixed(0)}% (≥${BREADTH_BULL}) and VIX ${vix.toFixed(1)} (<${VIX_BULL_MAX}) — broad participation, manageable fear → trend-followers fire.`;
  } else if (breadthPct < BREADTH_BEAR && vix > VIX_BEAR_MIN) {
    regime = "TRENDING-DOWN";
    reason = `Breadth ${breadthPct.toFixed(0)}% (<${BREADTH_BEAR}) and VIX ${vix.toFixed(1)} (>${VIX_BEAR_MIN}) — broad selling, elevated fear → BUY strategies off.`;
  } else {
    regime = "CHOPPY";
    reason = `Breadth ${breadthPct.toFixed(0)}% / VIX ${vix.toFixed(1)} not decisive → range-bound regime, mean-reversion only.`;
  }

  return {
    regime,
    breadthPct,
    vix,
    advances, declines, unchanged,
    reasoning: reason,
    computedAt: new Date().toISOString(),
  };
}
