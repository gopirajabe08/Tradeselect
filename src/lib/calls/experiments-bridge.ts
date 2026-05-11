/**
 * Layer 2 — Backtest experiments → strategy-overrides bridge.
 *
 * The daily backtest experiments runner (`/api/admin/experiments`) sweeps
 * (range, holdDays) combinations across the surviving strategy book and
 * reports candidates. Layer 1 (`daily-self-improvement.ts`) only acts on
 * LIVE PAPER data and requires ≥30 closed trades per strategy — at current
 * fire rate (~0.5 trades/day combined book) that's months away.
 *
 * This bridge gives backtest evidence a bounded path back to live config,
 * so a strategy that was auto-culled but now backtests positive over enough
 * samples can be re-enabled without a human in the loop.
 *
 * Safety rails (the auto-promoter cannot violate these):
 *   - Can only PROMOTE (disabled=true → disabled=false). Never disables.
 *     Cull authority stays with live-paper Layer 1 — backtest evidence
 *     cannot override an active live signal.
 *   - Can only re-enable strategies currently auto-culled (override.reason
 *     starts with "auto-cull:"). Manual disables ("manual: ...") are NEVER
 *     auto-undone. New strategies still require code merge into STRATEGIES.
 *   - holdDays must be consistent with strategy.productType:
 *       INTRADAY → backtest holdDays ≤ 1   (multi-day backtest doesn't
 *                                            represent live force-squareoff)
 *       CNC      → backtest holdDays ≥ 2   (single-day hold gives no edge
 *                                            for a swing-designed strategy)
 *   - Bar: trades ≥ MIN_TRADES, sharpeNet ≥ MIN_SHARPE, winRate ≥ MIN_WIN.
 *     If the same strategy appears in multiple top candidates, the BEST
 *     (highest sharpe) productType-consistent candidate wins.
 */
import type { Strategy } from "./strategies/types";
import type { StrategyOverride } from "./strategy-overrides";

export type ExperimentCandidate = {
  strategy: string;       // strategy NAME as written in backtest output (matches Strategy.name)
  holdDays: number;
  range: string;
  trades: number;
  winRate: number;
  sharpeNet: number;
  avgReturnNet: number;
};

export type BridgeDecision =
  | {
      kind: "auto_promote";
      strategyId: string;
      reason: string;
      evidence: { sharpe: number; trades: number; winRate: number; holdDays: number; range: string };
    }
  | { kind: "skipped"; strategyId: string; reason: string };

const MIN_TRADES = Number(process.env.EXPERIMENTS_BRIDGE_MIN_TRADES ?? 15);
const MIN_SHARPE = Number(process.env.EXPERIMENTS_BRIDGE_MIN_SHARPE ?? 0.3);
const MIN_WIN_RATE = Number(process.env.EXPERIMENTS_BRIDGE_MIN_WIN ?? 50);

/** Returns whether a candidate's holdDays is consistent with the strategy's productType. */
export function isHoldConsistent(strategy: Strategy, holdDays: number): boolean {
  const productType = strategy.productType ?? "INTRADAY";
  if (productType === "INTRADAY") return holdDays <= 1;
  return holdDays >= 2;
}

/** Pure function: emit decisions from candidates + existing overrides + strategy registry. */
export function bridgeExperimentsToOverrides(args: {
  candidates: ExperimentCandidate[];
  existingOverrides: StrategyOverride[];
  strategies: Strategy[];
}): BridgeDecision[] {
  const decisions: BridgeDecision[] = [];
  // Group candidates by strategy name → keep best (highest sharpe) productType-consistent candidate
  const byStrategy = new Map<string, ExperimentCandidate>();
  for (const c of args.candidates) {
    const strat = args.strategies.find(s => s.name === c.strategy);
    if (!strat) continue;
    if (!isHoldConsistent(strat, c.holdDays)) continue;
    const prev = byStrategy.get(strat.id);
    if (!prev || c.sharpeNet > prev.sharpeNet) byStrategy.set(strat.id, c);
  }

  for (const [strategyId, c] of byStrategy.entries()) {
    const override = args.existingOverrides.find(o => o.id === strategyId);
    // Can only re-enable currently auto-culled strategies
    if (!override?.disabled) {
      decisions.push({ kind: "skipped", strategyId, reason: "not auto-culled (already enabled or no override)" });
      continue;
    }
    if (!override.reason.startsWith("auto-cull")) {
      decisions.push({ kind: "skipped", strategyId, reason: `disabled by ${override.reason.split(":")[0]} — bridge cannot override` });
      continue;
    }
    // Bar check
    if (c.trades < MIN_TRADES) {
      decisions.push({ kind: "skipped", strategyId, reason: `trades ${c.trades} < min ${MIN_TRADES}` });
      continue;
    }
    if (c.sharpeNet < MIN_SHARPE) {
      decisions.push({ kind: "skipped", strategyId, reason: `sharpe ${c.sharpeNet.toFixed(2)} < min ${MIN_SHARPE}` });
      continue;
    }
    if (c.winRate < MIN_WIN_RATE) {
      decisions.push({ kind: "skipped", strategyId, reason: `winRate ${c.winRate.toFixed(1)}% < min ${MIN_WIN_RATE}%` });
      continue;
    }
    decisions.push({
      kind: "auto_promote",
      strategyId,
      reason: `auto-promote (L2): backtest sharpe ${c.sharpeNet.toFixed(2)} over ${c.trades} trades, winRate ${c.winRate.toFixed(1)}%, hold=${c.holdDays}d range=${c.range}`,
      evidence: { sharpe: c.sharpeNet, trades: c.trades, winRate: c.winRate, holdDays: c.holdDays, range: c.range },
    });
  }

  return decisions;
}

/** Apply promote decisions to an override list, returning the updated list. */
export function applyBridgeDecisions(
  existing: StrategyOverride[],
  decisions: BridgeDecision[],
  now: string = new Date().toISOString(),
): { next: StrategyOverride[]; promoted: number } {
  const next = [...existing];
  let promoted = 0;
  for (const d of decisions) {
    if (d.kind !== "auto_promote") continue;
    const idx = next.findIndex(o => o.id === d.strategyId);
    if (idx < 0) continue;
    next[idx] = { ...next[idx], disabled: false, reason: d.reason, at: now };
    promoted++;
  }
  return { next, promoted };
}

/** Format decisions for inclusion in the experiments Telegram summary. */
export function formatBridgeDecisions(decisions: BridgeDecision[]): string {
  const promotions = decisions.filter(d => d.kind === "auto_promote");
  if (promotions.length === 0) {
    const culledSkips = decisions.filter(d => d.kind === "skipped" && !d.reason.startsWith("not auto-culled")).length;
    return culledSkips > 0
      ? `\n🔁 *L2 auto-promote*: 0 promoted (${culledSkips} auto-culled candidate(s) below bar).`
      : ``;
  }
  const lines: string[] = [`\n🔁 *L2 auto-promote* — ${promotions.length} strategy(ies) re-enabled from backtest evidence:`];
  for (const d of promotions) {
    if (d.kind === "auto_promote") {
      lines.push(`  • ${d.strategyId} — sharpe ${d.evidence.sharpe.toFixed(2)} over ${d.evidence.trades} trades (hold=${d.evidence.holdDays}d ${d.evidence.range})`);
    }
  }
  return lines.join("\n");
}
