/**
 * Backtest sweep for Relative Strength on Weak Day (RSWD).
 * Decision bar: Sharpe ≥ 0.30, tStat ≥ 1.5, trades ≥ 15.
 *
 * Run: npx tsx scripts/explore-rswd.ts
 */
import { runBacktest } from "../src/lib/calls/backtest";
import type { Strategy, SymbolSnapshot, StrategyIdea } from "../src/lib/calls/strategies/types";

function rswdVariant(opts: { pChangeMin: number; closePosMin: number; yearHighMin: number; label: string }): Strategy {
  return {
    id: `rswd-${opts.label}`,
    name: `RSWD ${opts.label}`,
    allowedRegimes: ["CHOPPY"],
    productType: "CNC",
    maxHoldDays: 3,
    description: `RSWD variant: ${JSON.stringify(opts)}`,
    apply(s: SymbolSnapshot): StrategyIdea | null {
      if (s.lastPrice <= 0) return null;
      if (s.pChange < opts.pChangeMin) return null;
      const range = s.dayHigh - s.dayLow;
      const closePos = range <= 0 ? 50 : ((s.lastPrice - s.dayLow) / range) * 100;
      if (closePos < opts.closePosMin) return null;
      if (s.dayHigh <= s.previousClose) return null;
      const annualR = s.yearLow > 0 ? s.yearHigh / s.yearLow : 0;
      if (annualR < 1.3) return null;
      if (s.yearHigh > 0 && s.lastPrice < s.yearHigh * opts.yearHighMin) return null;
      const entry    = +s.lastPrice.toFixed(2);
      const target1  = +(entry * 1.025).toFixed(2);
      const target2  = +(entry * 1.045).toFixed(2);
      const stopLoss = +Math.max(s.dayLow * 0.99, entry * 0.985).toFixed(2);
      return { strategyId: this.id, strategyName: this.name, segment: "Swing", side: "BUY", symbol: s.symbol, entry, target1, target2, stopLoss, horizon: "1–3 days", rationale: `+${s.pChange.toFixed(2)}% close ${closePos.toFixed(0)}%` };
    },
  };
}

async function main() {
  const variants: Strategy[] = [
    rswdVariant({ pChangeMin: 1.5, closePosMin: 80, yearHighMin: 0.80, label: "strict"   }),
    rswdVariant({ pChangeMin: 1.0, closePosMin: 70, yearHighMin: 0.70, label: "default"  }),
    rswdVariant({ pChangeMin: 1.0, closePosMin: 60, yearHighMin: 0.60, label: "moderate" }),
    rswdVariant({ pChangeMin: 0.5, closePosMin: 50, yearHighMin: 0.50, label: "loose"    }),
    rswdVariant({ pChangeMin: 2.0, closePosMin: 80, yearHighMin: 0.80, label: "high-conv" }),
  ];

  console.log("=".repeat(105));
  console.log("RSWD variants — backtest sweep, 6mo, hold=3");
  console.log("Bar: Sharpe ≥ 0.30, tStat ≥ 1.5, trades ≥ 15");
  console.log("=".repeat(105));
  console.log("variant            | trades | win%  | NetR%/trade | Sharpe | tStat | Pass?");
  console.log("-------------------|--------|-------|-------------|--------|-------|-------");

  let bestPass: { label: string; sharpe: number; tStat: number; trades: number; netR: number } | null = null;

  for (const v of variants) {
    try {
      const r = await runBacktest({ strategies: [v], holdDays: 3, range: "6mo", applyRegimeFilter: true });
      const s = r.byStrategy[0];
      const label = v.id.replace("rswd-", "");
      const passSharpe = s.sharpeNet >= 0.30;
      const passTStat = s.tStatNet >= 1.5;
      const passTrades = s.trades >= 15;
      const passes = passSharpe && passTStat && passTrades;
      const status = passes ? "✓ SHIP" : `✗ ${[!passSharpe && "Sh", !passTStat && "tS", !passTrades && "n"].filter(Boolean).join(",")}`;
      console.log(
        `${label.padEnd(18)} | ${String(s.trades).padStart(6)} | ${s.winRate.toFixed(1).padStart(5)} | ${s.avgReturnNet.toFixed(2).padStart(11)} | ${s.sharpeNet.toFixed(2).padStart(6)} | ${s.tStatNet.toFixed(2).padStart(5)} | ${status}`,
      );
      if (passes && (!bestPass || s.sharpeNet > bestPass.sharpe)) {
        bestPass = { label, sharpe: s.sharpeNet, tStat: s.tStatNet, trades: s.trades, netR: s.avgReturnNet };
      }
    } catch (e) {
      console.log(`FAILED: ${(e as Error).message}`);
    }
  }

  console.log("");
  if (bestPass) {
    console.log(`✅ DECISION: Ship RSWD-${bestPass.label} (Sharpe ${bestPass.sharpe.toFixed(2)}, tStat ${bestPass.tStat.toFixed(2)}, ${bestPass.trades} trades, NetR ${bestPass.netR.toFixed(2)}%).`);
  } else {
    console.log("❌ DECISION: No RSWD variant clears the bar. Both CHOPPY hypotheses (VCB + RSWD) failed — strategy book is structurally limited; need different approach (mid-cap universe, F&O, or broader trend-following).");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
