import { NextResponse } from "next/server";
import { runBacktest } from "@/lib/calls/backtest";
import { STRATEGIES } from "@/lib/calls/strategies";
import { notify } from "@/lib/notify/telegram";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Autonomous Phase 1 backtest experiment runner.
 *
 * Sweeps parameters for the surviving (non-culled) strategies and reports findings.
 * Designed to be triggered by AWS cron (or systemd timer) once daily at ~16:00 IST,
 * inside the live window so the live runtime is up.
 *
 * Does NOT auto-apply changes. Just reports. Humans/agents review and decide
 * which winners to promote into the strategy book.
 *
 * Output:
 *   - Markdown summary written to /var/log/tsapp/experiments-YYYY-MM-DD.md
 *   - Telegram summary delivered (Top 3 candidates by Sharpe)
 *   - JSON response with full results
 */
type ExperimentResult = {
  label: string;
  range: string;
  holdDays: number;
  totalTrades: number;
  surviving: { strategy: string; trades: number; winRate: number; sharpeNet: number; avgReturnNet: number }[];
};

async function runExperiment(label: string, range: string, holdDays: number): Promise<ExperimentResult> {
  const result = await runBacktest({ range, holdDays, applyRegimeFilter: true });
  return {
    label,
    range,
    holdDays,
    totalTrades: result.totalTrades,
    surviving: result.byStrategy
      .filter(s => s.trades > 0)
      .map(s => ({
        strategy: s.strategyName,
        trades: s.trades,
        winRate: s.winRate,
        sharpeNet: s.sharpeNet,
        avgReturnNet: s.avgReturnNet,
      })),
  };
}

export async function POST() {
  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Phase 1 experiment matrix.
  // Sweep: holdDays for the survivors. Range: short vs medium history.
  // Goal: find any (strategy, holdDays) combination with positive net Sharpe.
  const experiments: { label: string; range: string; holdDays: number }[] = [
    { label: "baseline 6mo / hold10", range: "6mo", holdDays: 10 },
    { label: "shorter hold 6mo / hold5", range: "6mo", holdDays: 5 },
    { label: "tightest hold 6mo / hold3", range: "6mo", holdDays: 3 },
    { label: "longer hold 6mo / hold20", range: "6mo", holdDays: 20 },
    { label: "wider history 1y / hold10", range: "1y", holdDays: 10 },
    { label: "wider history 1y / hold5", range: "1y", holdDays: 5 },
  ];

  const results: ExperimentResult[] = [];
  for (const exp of experiments) {
    try {
      results.push(await runExperiment(exp.label, exp.range, exp.holdDays));
    } catch (e) {
      console.error(`[experiments] failed: ${exp.label}: ${(e as Error).message}`);
    }
  }

  // Find the BEST (strategy, holdDays) combo by net Sharpe across all experiments.
  type Candidate = { label: string; range: string; holdDays: number; strategy: string; trades: number; winRate: number; sharpeNet: number; avgReturnNet: number };
  const allCandidates: Candidate[] = [];
  for (const r of results) {
    for (const s of r.surviving) {
      allCandidates.push({ label: r.label, range: r.range, holdDays: r.holdDays, ...s });
    }
  }
  allCandidates.sort((a, b) => b.sharpeNet - a.sharpeNet);
  const top3 = allCandidates.slice(0, 3);
  const positiveCount = allCandidates.filter(c => c.sharpeNet > 0).length;

  // Write Markdown report
  const md: string[] = [];
  md.push(`# Phase 1 Experiment Report — ${today}`);
  md.push(``);
  md.push(`Run time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  md.push(`Experiments: ${experiments.length} (${results.length} succeeded)`);
  md.push(`Total candidates evaluated: ${allCandidates.length}`);
  md.push(`Candidates with positive net Sharpe: **${positiveCount}**`);
  md.push(``);
  md.push(`## Top 3 by net Sharpe`);
  md.push(``);
  md.push(`| Rank | Strategy | hold | range | Trades | Win% | NetR% | NetSh |`);
  md.push(`|---|---|---|---|---|---|---|---|`);
  top3.forEach((c, i) => {
    md.push(`| ${i + 1} | ${c.strategy} | ${c.holdDays}d | ${c.range} | ${c.trades} | ${c.winRate.toFixed(1)}% | ${c.avgReturnNet.toFixed(2)} | ${c.sharpeNet.toFixed(2)} |`);
  });
  md.push(``);
  md.push(`## Per-experiment summary`);
  md.push(``);
  for (const r of results) {
    md.push(`### ${r.label}`);
    md.push(``);
    md.push(`Total trades: ${r.totalTrades}`);
    md.push(``);
    md.push(`| Strategy | Trades | Win% | NetR% | NetSh |`);
    md.push(`|---|---|---|---|---|`);
    for (const s of r.surviving) {
      md.push(`| ${s.strategy} | ${s.trades} | ${s.winRate.toFixed(1)}% | ${s.avgReturnNet.toFixed(2)} | ${s.sharpeNet.toFixed(2)} |`);
    }
    md.push(``);
  }
  md.push(`## Verdict`);
  md.push(``);
  if (positiveCount === 0) {
    md.push(`🛑 **No (strategy, holdDays) combination has positive net Sharpe.** Phase 1 cannot exit yet. Need new strategy hypotheses.`);
  } else if (positiveCount < 3) {
    md.push(`🟡 **${positiveCount} candidates show positive net Sharpe** — promising but thin. Recommend re-running with different universe (Nifty 100, Nifty 500) before committing.`);
  } else {
    md.push(`🟢 **${positiveCount} candidates clear positive Sharpe.** Phase 2 (validate + cull) eligible. Top candidate: ${top3[0]?.strategy} hold=${top3[0]?.holdDays}d → Sharpe ${top3[0]?.sharpeNet.toFixed(2)}.`);
  }
  md.push(``);
  md.push(`_Auto-generated by /api/admin/experiments. Does not auto-apply changes._`);

  const reportText = md.join("\n");

  // Persist Markdown report
  const reportPath = path.join("/var/log/tsapp", `experiments-${today}.md`);
  try {
    await fs.writeFile(reportPath, reportText, { mode: 0o644 });
  } catch (e) {
    console.warn(`[experiments] write failed: ${(e as Error).message}`);
  }

  // Telegram summary (short — top 3 + verdict)
  const telegramLines: string[] = [];
  telegramLines.push(`🧪 *Phase 1 backtest experiments — ${today}*`);
  telegramLines.push(``);
  telegramLines.push(`Ran ${experiments.length} experiments across ${STRATEGIES.length} strategies.`);
  telegramLines.push(`Candidates with positive net Sharpe: *${positiveCount} / ${allCandidates.length}*`);
  telegramLines.push(``);
  if (top3.length > 0) {
    telegramLines.push(`*Top 3:*`);
    for (const [i, c] of top3.entries()) {
      const verdict = c.sharpeNet > 0 ? "🟢" : c.sharpeNet > -1 ? "🟡" : "🔴";
      telegramLines.push(`  ${i + 1}. ${verdict} ${c.strategy.replace(/ /g, "_")} hold=${c.holdDays}d → NetSh *${c.sharpeNet.toFixed(2)}* (${c.winRate.toFixed(0)}% win, ${c.avgReturnNet.toFixed(2)}%/trade)`);
    }
  }
  telegramLines.push(``);
  if (positiveCount === 0) {
    telegramLines.push(`🛑 No positive-Sharpe combo. Phase 1 not yet exiting.`);
  } else {
    telegramLines.push(`🟢 ${positiveCount} positive-Sharpe candidate(s). Review report:`);
  }
  telegramLines.push(``);
  telegramLines.push(`Full report: \`${reportPath}\``);

  // Telegram delivery — plain notify() bypasses quiet mode (only the typed event helpers
  // like notifyOrder/notifyCallsGenerated check QUIET_MODE). This is exactly what we want
  // for an explicitly-requested experiment summary.
  await notify(telegramLines.join("\n")).catch(() => {});

  return NextResponse.json({
    ok: true,
    date: today,
    runtimeSec: (Date.now() - startedAt) / 1000,
    experiments: experiments.length,
    results: results.length,
    candidatesEvaluated: allCandidates.length,
    positiveNetSharpe: positiveCount,
    top3,
    reportPath,
  });
}
