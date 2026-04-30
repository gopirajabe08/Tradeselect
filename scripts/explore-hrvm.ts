/**
 * One-off research script — does NOT ship. Sweeps HRVM RVOL threshold to test
 * whether widening the filter (2.0× → 1.5× → 1.0×) preserves the +0.40 Sharpe
 * edge or destroys it. Decides tonight's ship/no-ship on widening.
 *
 * Run: npx tsx scripts/explore-hrvm.ts
 *
 * Date: 2026-04-30 EOD audit. User flagged near-zero trade rate. Need to widen
 * fire frequency without sacrificing edge.
 */
import { runBacktest } from "../src/lib/calls/backtest";
import { highRvolMomentum } from "../src/lib/calls/strategies/high-rvol-momentum";
import type { Strategy, SymbolSnapshot, StrategyIdea } from "../src/lib/calls/strategies/types";

/** Build a clone of HRVM with a different RVOL threshold. */
function hrvmWithThreshold(threshold: number): Strategy {
  const inner = highRvolMomentum;
  return {
    ...inner,
    id: `hrvm-rvol-${threshold.toFixed(2).replace(".", "p")}`,
    name: `HRVM rvol≥${threshold}`,
    apply(s: SymbolSnapshot): StrategyIdea | null {
      // Re-implement the filter inline with a custom threshold
      if (s.lastPrice <= 0) return null;
      if (s.volumeRel20d === undefined || s.volumeRel20d < threshold) return null;
      const range = s.dayHigh - s.dayLow;
      const closePos = range <= 0 ? 50 : ((s.lastPrice - s.dayLow) / range) * 100;
      if (closePos < 70) return null;
      if (s.pChange < 0) return null;
      const annualR = s.yearLow > 0 ? s.yearHigh / s.yearLow : 0;
      if (annualR < 1.3) return null;
      if (s.yearHigh > 0 && s.lastPrice < s.yearHigh * 0.7) return null;
      const entry    = +s.lastPrice.toFixed(2);
      const target1  = +(entry * 1.030).toFixed(2);
      const target2  = +(entry * 1.055).toFixed(2);
      const stopLoss = +Math.max(s.dayLow * 0.995, entry * 0.98).toFixed(2);
      return {
        strategyId: this.id,
        strategyName: this.name,
        segment: "Swing",
        side: "BUY",
        symbol: s.symbol,
        entry, target1, target2, stopLoss,
        horizon: "1–3 days",
        rationale: `RVOL ${s.volumeRel20d.toFixed(1)}x, close ${closePos.toFixed(0)}%, +${s.pChange.toFixed(2)}%`,
      };
    },
  };
}

async function main() {
  const thresholds = [1.0, 1.25, 1.5, 1.75, 2.0];
  const variants = thresholds.map(hrvmWithThreshold);

  console.log("=".repeat(90));
  console.log("HRVM RVOL threshold sweep — backtest 6mo, hold=3, regime-filtered");
  console.log("Goal: find the threshold that maximizes (sharpe × n_trades) — i.e. real expected P&L per period.");
  console.log("=".repeat(90));

  const results: { threshold: number; trades: number; winRate: number; avgReturnNet: number; sharpeNet: number; tStat: number }[] = [];

  for (const v of variants) {
    const threshold = parseFloat(v.id.replace("hrvm-rvol-", "").replace("p", "."));
    process.stderr.write(`Running threshold ${threshold}x ... `);
    try {
      const r = await runBacktest({ strategies: [v], holdDays: 3, range: "6mo", applyRegimeFilter: true });
      const s = r.byStrategy[0];
      results.push({
        threshold,
        trades: s.trades,
        winRate: s.winRate,
        avgReturnNet: s.avgReturnNet,
        sharpeNet: s.sharpeNet,
        tStat: s.tStatNet,
      });
      process.stderr.write(`${s.trades} trades, NetSh ${s.sharpeNet.toFixed(2)}\n`);
    } catch (e) {
      process.stderr.write(`FAILED: ${(e as Error).message}\n`);
    }
  }

  console.log("");
  console.log("Results:");
  console.log("");
  console.log("RVOL≥  | Trades | Win%  | NetR%/trade | Sharpe | tStat | Expected P&L (NetR × Trades)");
  console.log("-------|--------|-------|-------------|--------|-------|-----------------------------");
  for (const r of results) {
    const expectedPnl = r.avgReturnNet * r.trades;
    console.log(
      `${r.threshold.toFixed(2).padStart(6)} | ${String(r.trades).padStart(6)} | ${r.winRate.toFixed(1).padStart(5)} | ${r.avgReturnNet.toFixed(2).padStart(11)} | ${r.sharpeNet.toFixed(2).padStart(6)} | ${r.tStat.toFixed(2).padStart(5)} | ${expectedPnl.toFixed(2).padStart(8)}%`,
    );
  }
  console.log("");
  console.log("Decision rule:");
  console.log("  Ship the LOWEST threshold where sharpe ≥ 0.30 AND trades ≥ baseline (current 6).");
  console.log("  Higher trade count at same/better sharpe = more profit per period.");
  console.log("  If lower thresholds collapse sharpe, current 2.0× is correct — fire rate stays.");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
