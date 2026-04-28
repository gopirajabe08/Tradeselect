import type { Strategy, SymbolSnapshot, StrategyIdea } from "./types";

/**
 * Gap-and-go — "the opening-gap that holds through the morning".
 *
 * Rationale:
 *   Stocks that gap-up ≥1% at open AND hold above the open through the first hour
 *   tend to continue higher by another 1-3% into the close (documented pattern on
 *   NSE large caps).
 *
 * Signal fires when:
 *   • Open > previousClose by ≥ 1.2 % (real gap, not a paper open)
 *   • lastPrice ≥ open (holding the gap, not filling it)
 *   • dayHigh above open (made upward progress)
 *   • Turnover ≥ ₹150 Cr (institutional participation)
 *
 * Short horizon (intraday / BTST) — exit same session or next morning.
 */
function turnoverCr(s: SymbolSnapshot): number { return s.totalTradedValue / 10_000_000; }

export const gapAndGo: Strategy = {
  id: "gap-and-go",
  name: "Gap-and-go continuation",
  description: "Intraday/BTST on stocks that gapped up ≥1.2% at open and are holding the gap.",
  allowedRegimes: ["TRENDING-UP"],   // gap-ups fade in chop / down-markets

  apply(s: SymbolSnapshot): StrategyIdea | null {
    if (s.previousClose <= 0 || s.open <= 0) return null;
    const gapPct = ((s.open - s.previousClose) / s.previousClose) * 100;
    if (gapPct < 1.2 || gapPct > 6) return null;             // real gap, not a runaway
    if (s.lastPrice < s.open * 0.998) return null;           // holding the gap (tiny slack)
    if (s.dayHigh < s.open) return null;                     // no upward progress
    if (turnoverCr(s) < 150) return null;

    const entry   = +s.lastPrice.toFixed(2);
    const target1 = +(entry * 1.018).toFixed(2);             // +1.8 %
    const target2 = +(entry * 1.030).toFixed(2);             // +3.0 %
    const stopLoss = +Math.max(s.open * 0.995, entry * 0.991).toFixed(2);  // below gap / tight

    return {
      strategyId: this.id,
      strategyName: this.name,
      segment: "BTST",
      side: "BUY",
      symbol: s.symbol,
      entry, target1, target2, stopLoss,
      horizon: "Next session",
      rationale: `Gapped +${gapPct.toFixed(2)}% at open, holding above ₹${s.open.toFixed(2)}; day high ₹${s.dayHigh.toFixed(2)}, turnover ₹${turnoverCr(s).toFixed(0)}Cr. Continuation setup.`,
      signalStrength: Math.min(100, 60 + gapPct * 8),
    };
  },
};
