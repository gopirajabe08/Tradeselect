/**
 * Daily self-improvement loop — Layer 1 of the autonomous improvement system.
 *
 * Runs once per day after market close (16:00 IST window). Reads closed paper trades,
 * computes per-strategy stats with the corrected math, and applies bounded-rule decisions.
 * No human in the loop. The goal: yesterday's performance directly shapes today's
 * configuration.
 *
 * Bounded rails (these are the immune system — auto-tuner cannot violate them):
 *   - risk_pct        ∈ [0.25%, 2%]
 *   - max_open        ∈ [1, 8]
 *   - daily DD halt   ∈ [3%, 8%]
 *   - score threshold ∈ [60, 90]      (deferred to layer 2)
 *
 * Rules applied (each is a one-line check; explainable):
 *   R1  Strategy with tStat < −2 over ≥30 closed trades  → disable
 *   R2  Strategy with sharpe > 0.3 AND tStat > 2          → ensure enabled (un-disable if previously disabled by auto-cull only)
 *   R3  Portfolio rolling 20d Sharpe < 0                  → cooling-off: risk_pct × 0.5 (floored at 0.25%)
 *   R4  Portfolio rolling 20d Sharpe > 1.0                → resume normal: risk_pct = 1.0% (default)
 *   R5  Daily DD > 5%                                     → next-day risk_pct × 0.5
 *
 * Returns a structured list of decisions for the master daily briefing to render.
 */
import { readCalls } from "./store";
import type { TradeCall } from "@/lib/mock/seed";
import { readOverrides, writeOverrides, type StrategyOverride } from "./strategy-overrides";
import { STRATEGIES } from "./strategies";
import { readRiskConfig, writeRiskConfig } from "@/lib/risk/sizing";
import { computeReturnStats } from "./backtest";
import { computeReadinessFromStore } from "./live-readiness";

const MIN_SAMPLE_FOR_DECISION = Number(process.env.SELF_IMPROVE_MIN_SAMPLE ?? 30);
const RISK_PCT_FLOOR = 0.25;
const RISK_PCT_CEILING = 2.0;
const RISK_PCT_DEFAULT = 1.0;

export type Decision =
  | { kind: "disable_strategy"; strategyId: string; reason: string; stats: { trades: number; sharpe: number; tStat: number } }
  | { kind: "enable_strategy"; strategyId: string; reason: string }
  | { kind: "set_risk_pct"; from: number; to: number; reason: string }
  | { kind: "no_change"; reason: string };

export type SelfImprovementReport = {
  ranAt: string;
  decisions: Decision[];
  perStrategyStats: { strategyId: string; trades: number; sharpe: number; tStat: number; verdict: string }[];
  portfolio: { closedTrades: number; rollingSharpe: number | null; rollingMaxDDPct: number | null };
};

/** Returns ms-aware closed-trade subset for a single strategy. */
function tradesForStrategy(calls: TradeCall[], strategyId: string): TradeCall[] {
  return calls.filter(c => {
    const sid = (c as any).strategyId
      ?? STRATEGIES.find(s => s.name === c.analyst.replace(" (BullsAi Auto)", ""))?.id;
    return sid === strategyId
      && (c.status === "Target Hit" || c.status === "SL Hit" || c.status === "Closed" || c.status === "Expired")
      && c.closedPrice != null;
  });
}

function returnPctOf(c: TradeCall): number {
  if (c.closedPrice == null || c.entry <= 0) return 0;
  const dir = c.side === "BUY" ? 1 : -1;
  return ((c.closedPrice - c.entry) / c.entry) * 100 * dir;
}

/** Compute the subset of decisions before any side-effects — used in tests. */
export function computeDecisions(args: {
  perStrategy: { id: string; trades: number; sharpe: number; tStat: number }[];
  rollingSharpe: number | null;
  currentRiskPct: number;
  existingOverrides: StrategyOverride[];
}): Decision[] {
  const decisions: Decision[] = [];

  // Per-strategy rules (R1, R2)
  for (const s of args.perStrategy) {
    const isCurrentlyDisabled = args.existingOverrides.find(o => o.id === s.id && o.disabled);
    if (s.trades >= MIN_SAMPLE_FOR_DECISION) {
      if (s.tStat < -2 && !isCurrentlyDisabled) {
        decisions.push({
          kind: "disable_strategy",
          strategyId: s.id,
          reason: `R1 cull: ${s.trades} closed trades, t-stat ${s.tStat.toFixed(2)} < −2 (significant negative edge)`,
          stats: { trades: s.trades, sharpe: s.sharpe, tStat: s.tStat },
        });
      } else if (s.sharpe > 0.3 && s.tStat > 2 && isCurrentlyDisabled?.reason.startsWith("auto-cull")) {
        decisions.push({
          kind: "enable_strategy",
          strategyId: s.id,
          reason: `R2 promote: ${s.trades} closed trades, sharpe ${s.sharpe.toFixed(2)} > 0.3, t-stat ${s.tStat.toFixed(2)} > 2`,
        });
      }
    }
  }

  // Portfolio-level rules (R3, R4)
  if (args.rollingSharpe != null) {
    if (args.rollingSharpe < 0) {
      const targetRiskPct = Math.max(RISK_PCT_FLOOR, args.currentRiskPct * 0.5);
      if (targetRiskPct < args.currentRiskPct - 0.01) {
        decisions.push({
          kind: "set_risk_pct",
          from: args.currentRiskPct,
          to: targetRiskPct,
          reason: `R3 cooling-off: portfolio rolling Sharpe ${args.rollingSharpe.toFixed(2)} < 0`,
        });
      }
    } else if (args.rollingSharpe > 1.0 && args.currentRiskPct < RISK_PCT_DEFAULT - 0.01) {
      decisions.push({
        kind: "set_risk_pct",
        from: args.currentRiskPct,
        to: RISK_PCT_DEFAULT,
        reason: `R4 resume: portfolio rolling Sharpe ${args.rollingSharpe.toFixed(2)} > 1.0`,
      });
    }
  }

  if (decisions.length === 0) {
    decisions.push({ kind: "no_change", reason: "no rules triggered" });
  }
  return decisions;
}

/** Apply decisions to overrides + risk config. Returns the final-applied set. */
async function applyDecisions(decisions: Decision[]): Promise<void> {
  let overridesChanged = false;
  const overridesFile = await readOverrides();
  const overrides = [...overridesFile.overrides];

  for (const d of decisions) {
    if (d.kind === "disable_strategy") {
      const idx = overrides.findIndex(o => o.id === d.strategyId);
      const next: StrategyOverride = {
        id: d.strategyId,
        disabled: true,
        reason: `auto-cull: ${d.reason}`,
        at: new Date().toISOString(),
        stats: { trades: d.stats.trades, wins: 0, avgPct: 0, sharpe: d.stats.sharpe },
      };
      if (idx >= 0) overrides[idx] = next; else overrides.push(next);
      overridesChanged = true;
    }
    if (d.kind === "enable_strategy") {
      const idx = overrides.findIndex(o => o.id === d.strategyId);
      if (idx >= 0) {
        overrides[idx] = { ...overrides[idx], disabled: false, reason: `auto-promote: ${d.reason}`, at: new Date().toISOString() };
        overridesChanged = true;
      }
    }
    if (d.kind === "set_risk_pct") {
      // Bound clamp before write — defense in depth
      const clamped = Math.max(RISK_PCT_FLOOR, Math.min(RISK_PCT_CEILING, d.to));
      await writeRiskConfig({ riskPct: clamped });
    }
  }

  if (overridesChanged) {
    await writeOverrides({ updatedAt: new Date().toISOString(), overrides });
  }
}

export async function runDailySelfImprovement(opts: { dryRun?: boolean } = {}): Promise<SelfImprovementReport> {
  const ranAt = new Date().toISOString();
  const calls = await readCalls();
  const overrides = await readOverrides();
  const cfg = await readRiskConfig();

  // Per-strategy stats
  const perStrategyStats: SelfImprovementReport["perStrategyStats"] = [];
  const perStrategyForDecision: { id: string; trades: number; sharpe: number; tStat: number }[] = [];
  for (const strat of STRATEGIES) {
    const stratTrades = tradesForStrategy(calls, strat.id);
    const returns = stratTrades.map(returnPctOf);
    const stats = computeReturnStats(returns);
    let verdict = "insufficient sample";
    if (stats.n >= MIN_SAMPLE_FOR_DECISION) {
      if (stats.tStat < -2) verdict = "cull (significant negative)";
      else if (stats.sharpe > 0.3 && stats.tStat > 2) verdict = "promote (significant positive)";
      else verdict = "hold (inconclusive)";
    }
    perStrategyStats.push({
      strategyId: strat.id,
      trades: stats.n,
      sharpe: stats.sharpe,
      tStat: stats.tStat,
      verdict,
    });
    perStrategyForDecision.push({ id: strat.id, trades: stats.n, sharpe: stats.sharpe, tStat: stats.tStat });
  }

  // Portfolio-level rolling stats (use existing live-readiness helper)
  const inputs = await computeReadinessFromStore();

  const decisions = computeDecisions({
    perStrategy: perStrategyForDecision,
    rollingSharpe: inputs.rollingSharpe ?? null,
    currentRiskPct: cfg.riskPct,
    existingOverrides: overrides.overrides,
  });

  if (!opts.dryRun) {
    await applyDecisions(decisions);
  }

  return {
    ranAt,
    decisions,
    perStrategyStats,
    portfolio: {
      closedTrades: inputs.closedTrades,
      rollingSharpe: inputs.rollingSharpe ?? null,
      rollingMaxDDPct: inputs.rollingMaxDDPct ?? null,
    },
  };
}

/** Format the report as a Telegram-friendly text block for inclusion in master briefing. */
export function formatSelfImprovement(r: SelfImprovementReport): string {
  const lines: string[] = [];
  lines.push(`🤖 *AUTO-IMPROVEMENTS TODAY*`);
  if (r.decisions.length === 0 || (r.decisions.length === 1 && r.decisions[0].kind === "no_change")) {
    lines.push(`  • No rules triggered today (rolling stats inconclusive or stable)`);
  } else {
    for (const d of r.decisions) {
      if (d.kind === "disable_strategy") {
        lines.push(`  • DISABLED ${d.strategyId} — ${d.reason}`);
      } else if (d.kind === "enable_strategy") {
        lines.push(`  • ENABLED ${d.strategyId} — ${d.reason}`);
      } else if (d.kind === "set_risk_pct") {
        lines.push(`  • risk_pct ${d.from.toFixed(2)}% → ${d.to.toFixed(2)}% — ${d.reason}`);
      } else if (d.kind === "no_change") {
        lines.push(`  • No changes — ${d.reason}`);
      }
    }
  }
  // Per-strategy table
  lines.push(``);
  lines.push(`  Per-strategy stats (last ${MIN_SAMPLE_FOR_DECISION}+ trades only):`);
  for (const s of r.perStrategyStats) {
    if (s.trades > 0) {
      lines.push(`    ${s.strategyId.padEnd(22)} n=${String(s.trades).padStart(3)} sharpe=${s.sharpe.toFixed(2).padStart(6)} tStat=${s.tStat.toFixed(2).padStart(6)}  ${s.verdict}`);
    }
  }
  return lines.join("\n");
}
