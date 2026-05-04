import type { Strategy } from "./types";
import { breakout52wHigh } from "./breakout";
import { reversalBounce } from "./reversal";
import { intradayMomentum } from "./momentum";
import { sectorLeader } from "./sector-leader";
import { gapAndGo } from "./gap-and-go";
import { intradayRangeSupport } from "./range-support";
import { highRvolMomentum } from "./high-rvol-momentum";
import { relativeStrengthWeakDay } from "./relative-strength-weak-day";
// volatilityContractionBreakout failed 2026-05-04 backtest (NR4 alone produced -0.15 Sharpe over 14 trades).
// Code stays in src/ for future iteration but not registered in active book.

export * from "./types";

/** The active strategy book. Add/remove strategies here to change what the auto-scanner generates. */
export const STRATEGIES: Strategy[] = [
  breakout52wHigh,
  reversalBounce,
  intradayMomentum,
  sectorLeader,
  gapAndGo,
  intradayRangeSupport,
  highRvolMomentum,
  relativeStrengthWeakDay,
];
