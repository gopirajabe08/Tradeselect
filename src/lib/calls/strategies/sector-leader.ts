import type { Strategy, SymbolSnapshot, StrategyIdea } from "./types";

/**
 * Sector-leader breakout — "buy the strongest stock in today's strongest sector".
 *
 * Rationale:
 *   Money rotates between sectors (IT, banks, auto, pharma, etc.) on any given day.
 *   Stocks in the leading sector tend to continue outperforming for 3-5 sessions.
 *   So: pick a stock that's rising strongly AND has consolidated recently (not extended).
 *
 * Signal fires when:
 *   • Up ≥ 1.5 % today (stock-level strength)
 *   • Not over-extended vs 52w high (≤ 95% of high → room to run; > 99% → likely peaking)
 *   • Decent turnover (≥ ₹75 Cr)
 *
 * The scoring layer then adds sector-leadership points (industry avg % change)
 * so ideas on stocks in hot sectors get top scores automatically.
 */
function turnoverCr(s: SymbolSnapshot): number { return s.totalTradedValue / 10_000_000; }
function pctOfHigh(s: SymbolSnapshot): number { return s.yearHigh > 0 ? (s.lastPrice / s.yearHigh) * 100 : 0; }

export const sectorLeader: Strategy = {
  id: "sector-leader",
  name: "Sector leader swing",
  description: "Long setups on stocks up ≥1.5% today in a strong sector, not yet extended to 52w high.",
  allowedRegimes: ["TRENDING-UP"],   // sector rotation leaders only when broad market is participating

  apply(s: SymbolSnapshot): StrategyIdea | null {
    if (s.pChange < 1.5 || s.pChange > 4.5) return null;      // strong but not extended
    const poh = pctOfHigh(s);
    if (poh < 70 || poh > 99) return null;                    // in the middle of range, not peaking
    if (turnoverCr(s) < 75) return null;
    if (s.lastPrice <= 0) return null;

    const entry   = +s.lastPrice.toFixed(2);
    const target1 = +(entry * 1.022).toFixed(2);             // +2.2 %
    const target2 = +(entry * 1.042).toFixed(2);             // +4.2 %
    const stopLoss = +(entry * 0.988).toFixed(2);            // −1.2 %

    return {
      strategyId: this.id,
      strategyName: this.name,
      segment: "Swing",
      side: "BUY",
      symbol: s.symbol,
      entry, target1, target2, stopLoss,
      horizon: "2–5 days",
      rationale: `Up ${s.pChange.toFixed(2)}% with ₹${turnoverCr(s).toFixed(0)}Cr turnover; ${poh.toFixed(0)}% of 52w high — strong without being extended. Sector leadership decides final score.`,
      signalStrength: Math.min(100, 55 + s.pChange * 10),
    };
  },
};
