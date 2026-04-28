import type { SymbolSnapshot, StrategyIdea } from "./strategies/types";

/**
 * Conviction scoring for auto-generated ideas (0–100).
 *
 * Inputs are combined into a single score:
 *   • Strategy-native signal strength (entry clarity, R:R)            max 25
 *   • Relative strength vs Nifty (is the stock outperforming today?)  max 20
 *   • Sector leadership (is the stock's industry moving in our dir?)  max 20
 *   • Turnover (₹ crore; filters illiquid junk)                       max 20
 *   • Day-move alignment (price already confirming direction)         max 15
 *                                                                    ────────
 *                                                                     100
 *
 * Threshold ≥ 60 means "publish" — below that, the idea is noise and gets dropped.
 */

export const SCORE_THRESHOLD = 60;

export type ScoringContext = {
  niftyPctChange: number;
  industryAvgPct: Map<string, number>;
};

function rrScore(entry: number, target: number, sl: number): number {
  const reward = Math.abs(target - entry);
  const risk   = Math.abs(entry - sl);
  if (risk <= 0) return 0;
  const rr = reward / risk;
  // 1:1 → 6 pts, 1:2 → 12, 1:2.5 → 15, 1:3+ → 20 (cap at 25)
  return Math.min(25, rr * 8);
}

function relativeStrengthScore(stockPct: number, niftyPct: number, side: "BUY" | "SELL"): number {
  const rs = stockPct - niftyPct;
  if (side === "BUY") {
    if (rs >= 2)  return 20;
    if (rs >= 1)  return 15;
    if (rs >= 0)  return 8;
    if (rs >= -1) return 3;
    return 0;
  } else {
    const inv = -rs;   // SELL wants stock weaker than index
    if (inv >= 2)  return 20;
    if (inv >= 1)  return 15;
    if (inv >= 0)  return 8;
    if (inv >= -1) return 3;
    return 0;
  }
}

function sectorScore(industry: string | undefined, industryAvg: Map<string, number>, side: "BUY" | "SELL"): number {
  if (!industry) return 0;
  const avg = industryAvg.get(industry) ?? 0;
  const directional = side === "BUY" ? avg : -avg;
  if (directional >= 1.0) return 20;
  if (directional >= 0.5) return 12;
  if (directional >= 0)   return 5;
  return 0;
}

function turnoverScore(totalTradedValue: number): number {
  const cr = totalTradedValue / 10_000_000;  // rupees → crore
  if (cr >= 500) return 20;
  if (cr >= 200) return 15;
  if (cr >= 100) return 10;
  if (cr >= 50)  return 5;
  return 0;
}

function dayMoveScore(pChange: number, side: "BUY" | "SELL"): number {
  const aligned = side === "BUY" ? pChange : -pChange;
  if (aligned <= 0) return 0;     // move against us
  if (aligned >= 5) return 10;    // capped — beyond +5% entries often extended
  // Scales linearly 0→15 over [0, 3%]
  return Math.min(15, (aligned / 3) * 15);
}

export type ScoreBreakdown = {
  total: number;
  signal: number;
  rs: number;
  sector: number;
  turnover: number;
  dayMove: number;
};

export function scoreIdea(idea: StrategyIdea, sym: SymbolSnapshot, ctx: ScoringContext): ScoreBreakdown {
  const signal   = Math.max(rrScore(idea.entry, idea.target1, idea.stopLoss), idea.signalStrength ? (idea.signalStrength / 4) : 0);
  const rs       = relativeStrengthScore(sym.pChange, ctx.niftyPctChange, idea.side);
  const sector   = sectorScore(sym.industry, ctx.industryAvgPct, idea.side);
  const turnover = turnoverScore(sym.totalTradedValue);
  const dayMove  = dayMoveScore(sym.pChange, idea.side);
  const total    = Math.round(Math.min(100, signal + rs + sector + turnover + dayMove));
  return { total, signal: Math.round(signal), rs, sector, turnover, dayMove: Math.round(dayMove) };
}

/** Builds a ScoringContext from a full snapshot. Needs the Nifty 50 row too. */
export function buildContext(snapshots: SymbolSnapshot[], niftyPctChange: number): ScoringContext {
  const byIndustry = new Map<string, { sum: number; count: number }>();
  for (const s of snapshots) {
    if (!s.industry) continue;
    const row = byIndustry.get(s.industry) ?? { sum: 0, count: 0 };
    row.sum   += s.pChange;
    row.count += 1;
    byIndustry.set(s.industry, row);
  }
  const avgs = new Map<string, number>();
  byIndustry.forEach((v, k) => avgs.set(k, v.count > 0 ? v.sum / v.count : 0));
  return { niftyPctChange, industryAvgPct: avgs };
}
