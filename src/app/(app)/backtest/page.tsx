"use client";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { classForChange, formatNumber, formatPct } from "@/lib/utils";
import { Loader2, Play, Target, Trophy } from "lucide-react";

type PerfRow = {
  strategyId: string; strategyName: string;
  trades: number; wins: number; losses: number;
  winRate: number; avgReturn: number; bestReturn: number; worstReturn: number;
  totalReturn: number; sharpe: number; avgScore: number;
  sampleTrades: Array<{ symbol: string; entryDate: string; entry: number; exitPrice?: number; returnPct: number; outcome: string; score?: number }>;
};

type BucketRow = {
  bucket: string; trades: number; wins: number;
  winRate: number; avgReturn: number; bestReturn: number; worstReturn: number; sharpe: number;
};

export default function BacktestPage() {
  const [range, setRange] = useState("3mo");
  const [holdDays, setHoldDays] = useState(10);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ universe: string[]; range: string; totalTrades: number; byStrategy: PerfRow[]; byBucket: BucketRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true); setError(null); setResult(null);
    try {
      const r = await fetch("/api/calls/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ range, holdDays }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j?.error ?? `HTTP ${r.status}`); return; }
      setResult(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const ranked = result?.byStrategy.slice().sort((a, b) => b.sharpe - a.sharpe) ?? [];

  return (
    <>
      <PageHeader
        title="Strategy Backtest"
        subtitle="Replay every strategy against last N months of Nifty 50 daily bars. Outputs win rate, avg return, Sharpe per strategy."
      />

      <section className="card">
        <div className="card-body flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="text-muted-foreground">Range</span>
            <select className="input mt-1" value={range} onChange={e => setRange(e.target.value)}>
              <option value="1mo">1 month</option>
              <option value="3mo">3 months</option>
              <option value="6mo">6 months</option>
              <option value="1y">1 year</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Max hold (days)</span>
            <input className="input mt-1" type="number" min={1} max={30} value={holdDays} onChange={e => setHoldDays(Number(e.target.value))} />
          </label>
          <button className="btn-primary" onClick={run} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
            {running ? "Running backtest…" : "Run backtest"}
          </button>
          <span className="text-xs text-muted-foreground">Takes 10–30 seconds. Fetches Yahoo historical bars for 50 liquid symbols.</span>
        </div>
      </section>

      {error && (
        <div className="card border-[hsl(var(--danger))]/30"><div className="card-body text-sm text-[hsl(var(--danger))]">{error}</div></div>
      )}

      {result && (
        <>
          {/* Score-bucket analysis — the real answer to "does score predict outcome?" */}
          <section className="card">
            <div className="card-header flex items-center gap-2">
              <Target className="h-4 w-4" />
              <span className="font-medium">Does conviction score predict outcome?</span>
              <span className="text-xs text-muted-foreground ml-2">win rate & avg return by score bucket</span>
            </div>
            <div className="card-body overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Score bucket</th>
                    <th className="text-right">Trades</th>
                    <th className="text-right">Wins</th>
                    <th className="text-right">Win rate</th>
                    <th className="text-right">Avg return</th>
                    <th className="text-right">Best / Worst</th>
                    <th className="text-right">Sharpe</th>
                  </tr>
                </thead>
                <tbody>
                  {result.byBucket.map(b => {
                    const bucketCls =
                      b.bucket === "70+"    ? "font-semibold text-[hsl(var(--success))]" :
                      b.bucket === "60-69"  ? "font-medium text-primary" :
                      b.bucket === "<40"    ? "text-muted-foreground" : "";
                    return (
                      <tr key={b.bucket}>
                        <td className={bucketCls}>{b.bucket}</td>
                        <td className="text-right">{b.trades}</td>
                        <td className="text-right text-[hsl(var(--success))]">{b.wins}</td>
                        <td className={"text-right " + (b.winRate >= 55 ? "text-[hsl(var(--success))]" : b.winRate < 40 ? "text-[hsl(var(--danger))]" : "")}>
                          {b.trades > 0 ? formatNumber(b.winRate) + "%" : "—"}
                        </td>
                        <td className={"text-right " + classForChange(b.avgReturn)}>{b.trades > 0 ? formatPct(b.avgReturn, 2) : "—"}</td>
                        <td className="text-right text-xs">
                          {b.trades > 0 ? <>
                            <span className="text-[hsl(var(--success))]">{formatPct(b.bestReturn, 1)}</span>
                            <span className="text-muted-foreground"> / </span>
                            <span className="text-[hsl(var(--danger))]">{formatPct(b.worstReturn, 1)}</span>
                          </> : "—"}
                        </td>
                        <td className={"text-right font-medium " + (b.sharpe >= 1 ? "text-[hsl(var(--success))]" : b.sharpe >= 0.3 ? "" : b.sharpe < 0 ? "text-[hsl(var(--danger))]" : "")}>
                          {b.trades > 0 ? formatNumber(b.sharpe) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-3">
                <strong>How to read this:</strong> if win-rate + Sharpe climb monotonically across buckets (&lt;40 → 70+), scoring genuinely predicts outcome.
                Backtest scores top out ~80 because historical data lacks industry info (sector component returns 0); live scoring adds those 20 points.
                So backtest "70+" is roughly equivalent to live "85+". If <strong>70+</strong> is a clear winner here, trust live ≥85.
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card-header flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              <span className="font-medium">Per-strategy results — {result.range}, {result.totalTrades} simulated trades across {result.universe.length} symbols</span>
            </div>
            <div className="card-body overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th className="text-right">Trades</th>
                    <th className="text-right">Wins</th>
                    <th className="text-right">Losses</th>
                    <th className="text-right">Win rate</th>
                    <th className="text-right">Avg return</th>
                    <th className="text-right">Avg score</th>
                    <th className="text-right">Best / Worst</th>
                    <th className="text-right">Sharpe</th>
                    <th className="text-right">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map(r => {
                    const verdict =
                      r.trades < 10 ? { txt: "Too few", cls: "text-muted-foreground" } :
                      r.winRate >= 55 && r.avgReturn > 0 && r.sharpe > 0.5 ? { txt: "Keep", cls: "text-[hsl(var(--success))]" } :
                      r.winRate < 40 || r.avgReturn < 0 ? { txt: "Cut", cls: "text-[hsl(var(--danger))]" } :
                      { txt: "Tune", cls: "text-amber-600" };
                    return (
                      <tr key={r.strategyId}>
                        <td className="font-medium">{r.strategyName}</td>
                        <td className="text-right">{r.trades}</td>
                        <td className="text-right text-[hsl(var(--success))]">{r.wins}</td>
                        <td className="text-right text-[hsl(var(--danger))]">{r.losses}</td>
                        <td className={"text-right " + (r.winRate >= 55 ? "text-[hsl(var(--success))]" : r.winRate < 40 ? "text-[hsl(var(--danger))]" : "")}>
                          {formatNumber(r.winRate)}%
                        </td>
                        <td className={"text-right " + classForChange(r.avgReturn)}>{formatPct(r.avgReturn, 2)}</td>
                        <td className="text-right text-xs">{formatNumber(r.avgScore)}</td>
                        <td className="text-right text-xs">
                          <span className="text-[hsl(var(--success))]">{formatPct(r.bestReturn, 1)}</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-[hsl(var(--danger))]">{formatPct(r.worstReturn, 1)}</span>
                        </td>
                        <td className={"text-right font-medium " + (r.sharpe >= 1 ? "text-[hsl(var(--success))]" : r.sharpe >= 0.5 ? "" : "text-[hsl(var(--danger))]")}>
                          {formatNumber(r.sharpe)}
                        </td>
                        <td className={"text-right font-medium " + verdict.cls}>{verdict.txt}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {ranked.map(r => r.sampleTrades.length === 0 ? null : (
            <section key={r.strategyId} className="card">
              <div className="card-header font-medium">{r.strategyName} — last {r.sampleTrades.length} trades</div>
              <div className="card-body overflow-x-auto">
                <table className="table-base text-xs">
                  <thead><tr><th>Entry date</th><th>Symbol</th><th>Entry</th><th>Exit</th><th>Return</th><th>Outcome</th></tr></thead>
                  <tbody>
                    {r.sampleTrades.map((t, i) => (
                      <tr key={i}>
                        <td>{t.entryDate}</td>
                        <td className="font-medium">{t.symbol}</td>
                        <td>{formatNumber(t.entry)}</td>
                        <td>{t.exitPrice ? formatNumber(t.exitPrice) : "—"}</td>
                        <td className={classForChange(t.returnPct)}>{formatPct(t.returnPct, 2)}</td>
                        <td>{t.outcome}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <p className="text-xs text-muted-foreground">
            Verdict rule: <strong>Keep</strong> = win-rate ≥ 55% AND avg return &gt; 0 AND Sharpe &gt; 0.5. <strong>Cut</strong> = win-rate &lt; 40% OR avg return &lt; 0. Otherwise <strong>Tune</strong>.
            Backtest is pessimistic (assumes SL fills first when target + SL hit same bar). Real execution may be better.
          </p>
        </>
      )}
    </>
  );
}
