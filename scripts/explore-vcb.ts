/**
 * Backtest sweep for Volatility Contraction Breakout (VCB).
 * Decision bar: corrected-math Sharpe ≥ 0.30 AND tStat ≥ 1.5 AND ≥ 15 trades in 6mo.
 *
 * Run: npx tsx scripts/explore-vcb.ts
 */
import { runBacktest } from "../src/lib/calls/backtest";
import type { Strategy, SymbolSnapshot, StrategyIdea } from "../src/lib/calls/strategies/types";

/** Build a VCB variant with overridable filter knobs. */
function vcbVariant(opts: { yearHighMin?: number; rangeRel7dMax?: number; closePosMin?: number; useNR4?: boolean; label: string }): Strategy {
  return {
    id: `vcb-${opts.label}`,
    name: `VCB ${opts.label}`,
    allowedRegimes: ["CHOPPY"],
    productType: "CNC",
    maxHoldDays: 3,
    description: `VCB variant: ${JSON.stringify(opts)}`,
    apply(s: SymbolSnapshot): StrategyIdea | null {
      if (s.lastPrice <= 0) return null;
      if (opts.useNR4 !== false && !s.isNR4) return null;
      if (opts.rangeRel7dMax != null && (s.rangeRel7d === undefined || s.rangeRel7d > opts.rangeRel7dMax)) return null;
      const range = s.dayHigh - s.dayLow;
      const closePos = range <= 0 ? 50 : ((s.lastPrice - s.dayLow) / range) * 100;
      if (opts.closePosMin != null && closePos < opts.closePosMin) return null;
      if (s.pChange < -0.5) return null;
      const annualR = s.yearLow > 0 ? s.yearHigh / s.yearLow : 0;
      if (annualR < 1.3) return null;
      if (opts.yearHighMin != null && s.yearHigh > 0 && s.lastPrice < s.yearHigh * opts.yearHighMin) return null;
      const entry    = +s.lastPrice.toFixed(2);
      const target1  = +(entry * 1.030).toFixed(2);
      const target2  = +(entry * 1.055).toFixed(2);
      const stopLoss = +(s.dayLow * 0.99).toFixed(2);
      return { strategyId: this.id, strategyName: this.name, segment: "Swing", side: "BUY", symbol: s.symbol, entry, target1, target2, stopLoss, horizon: "1–3 days", rationale: `VCB ${opts.label}` };
    },
  };
}

async function main() {
  const variants: Strategy[] = [
    vcbVariant({ yearHighMin: 0.80, rangeRel7dMax: 0.65, closePosMin: 50, useNR4: true,  label: "strict" }),
    vcbVariant({ yearHighMin: 0.70, rangeRel7dMax: 0.70, closePosMin: 50, useNR4: true,  label: "loose" }),
    vcbVariant({ yearHighMin: 0.60, rangeRel7dMax: 0.80, closePosMin: 40, useNR4: true,  label: "wider" }),
    vcbVariant({                                                useNR4: true,            label: "NR4-only" }),
    vcbVariant({                                                useNR4: false, rangeRel7dMax: 0.50, label: "tightRange-only" }),
  ];

  console.log("=".repeat(105));
  console.log("VCB variants — backtest sweep, 6mo, hold=3");
  console.log("Bar: Sharpe ≥ 0.30, tStat ≥ 1.5, trades ≥ 15");
  console.log("=".repeat(105));
  console.log("variant            | trades | win%  | NetR%/trade | Sharpe | tStat | Pass?");
  console.log("-------------------|--------|-------|-------------|--------|-------|-------");

  let bestPass: { label: string; sharpe: number; tStat: number; trades: number } | null = null;

  for (const v of variants) {
      try {
        const r = await runBacktest({ strategies: [v], holdDays: 3, range: "6mo", applyRegimeFilter: true });
        const s = r.byStrategy[0];
        const label = v.id.replace("vcb-", "");
        const passSharpe = s.sharpeNet >= 0.30;
        const passTStat = s.tStatNet >= 1.5;
        const passTrades = s.trades >= 15;
        const passes = passSharpe && passTStat && passTrades;
        const status = passes ? "✓ SHIP" : `✗ ${[!passSharpe && "Sh", !passTStat && "tS", !passTrades && "n"].filter(Boolean).join(",")}`;
        console.log(
          `${label.padEnd(18)} | ${String(s.trades).padStart(6)} | ${s.winRate.toFixed(1).padStart(5)} | ${s.avgReturnNet.toFixed(2).padStart(11)} | ${s.sharpeNet.toFixed(2).padStart(6)} | ${s.tStatNet.toFixed(2).padStart(5)} | ${status}`,
        );
        if (passes && (!bestPass || s.sharpeNet > bestPass.sharpe)) {
          bestPass = { label, sharpe: s.sharpeNet, tStat: s.tStatNet, trades: s.trades };
        }
      } catch (e) {
        console.log(`FAILED: ${(e as Error).message}`);
      }
  }

  console.log("");
  if (bestPass) {
    console.log(`✅ DECISION: Ship VCB-${bestPass.label} (Sharpe ${bestPass.sharpe.toFixed(2)}, tStat ${bestPass.tStat.toFixed(2)}, ${bestPass.trades} trades over 6mo).`);
  } else {
    console.log("❌ DECISION: No VCB variant clears the bar. Strategy hypothesis needs rework.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
