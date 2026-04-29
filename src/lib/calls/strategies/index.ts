import type { Strategy } from "./types";
import { breakout52wHigh } from "./breakout";
import { reversalBounce } from "./reversal";
import { intradayMomentum } from "./momentum";
import { sectorLeader } from "./sector-leader";
import { gapAndGo } from "./gap-and-go";
import { intradayRangeSupport } from "./range-support";
import { highRvolMomentum } from "./high-rvol-momentum";

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
];
