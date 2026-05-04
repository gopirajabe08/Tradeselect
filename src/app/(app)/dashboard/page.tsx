import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { AllocationDonut, AllocationLegend } from "@/components/allocation-donut";
import { RegimeBanner } from "@/components/regime-banner";
import { DailyLossBanner } from "@/components/daily-loss-banner";
import { callMetrics, callStats, performanceByAnalyst, segmentPerformance } from "@/lib/mock/derive";
import { algos } from "@/lib/mock/seed";
import { readCalls } from "@/lib/calls/store";
import { triggerCallMatcher } from "@/lib/calls/matcher";
import { readMode } from "@/lib/broker/mode";
import { classForChange, formatNumber, formatPct } from "@/lib/utils";
import Link from "next/link";
import {
  ArrowRight, ArrowUpRight, ArrowDownRight, Award, Bot, CheckCircle2,
  LineChart, Rocket, Trophy, User, XCircle,
} from "lucide-react";

export default async function DashboardPage() {
  triggerCallMatcher();                       // fire-and-forget: check live prices vs Active calls
  const calls = await readCalls();
  const mode = await readMode();
  const isPaper = mode === "paper";
  const stats   = callStats(calls);
  const bySeg   = segmentPerformance(calls);
  const byAnalyst = performanceByAnalyst(calls);
  const topSources = byAnalyst.filter(a => a.decided > 0).slice(0, 3);
  const segAlloc = bySeg.map(s => ({ name: s.segment, value: s.total, pct: (s.total / stats.total) * 100 }));

  const todayIso    = new Date().toISOString().slice(0, 10);
  const todaysCalls = calls
    .filter(c => c.issuedAt.slice(0, 10) === todayIso)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));

  const liveAlgos   = algos.filter(a => a.state === "Live");
  const paperAlgos  = algos.filter(a => a.state === "Paper");

  return (
    <>
      <PageHeader
        title={`Dashboard — ${isPaper ? "Paper mode" : "LIVE — real money"}`}
        subtitle={isPaper ? "Trade with research, not opinions. (Simulated trading; no real money at risk.)" : `🔴 Real-money trading via ${mode.toUpperCase()}. Every order placed is real.`}
        actions={
          <Link href="/calls" className="btn-primary">
            View all ideas <ArrowRight className="h-4 w-4" />
          </Link>
        }
      />

      <DailyLossBanner />
      <RegimeBanner />

      {/* KPI strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Active ideas"     value={String(stats.active)}              footer={`${stats.newToday} new today`}                    accent="primary" />
        <KpiCard label="Win rate"         value={`${stats.winRate.toFixed(1)}%`}    footer={`${stats.hits} target hits · ${stats.sls} SL`}    accent="success" />
        <KpiCard label="Live algos"       value={String(liveAlgos.length)}          footer={`${paperAlgos.length} in paper`}                  accent="primary" />
        <KpiCard label="Total ideas"      value={String(stats.total)}               footer="Published by analysts" />
      </section>

      {/* Today's calls + segment mix */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card xl:col-span-2">
          <div className="card-header flex items-center justify-between">
            <div>
              <div className="font-medium flex items-center gap-2">
                <Rocket className="h-4 w-4 text-primary" /> Today&apos;s trade ideas
              </div>
              <div className="text-xs text-muted-foreground">SEBI-registered analyst calls published in the current session</div>
            </div>
            <Link href="/calls" className="text-sm text-primary hover:underline">View all</Link>
          </div>
          <div className="card-body">
            {todaysCalls.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">No new ideas today.</div>
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Segment</th><th>Symbol</th><th>Side</th>
                    <th>Entry</th><th>Target</th><th>SL</th>
                    <th>LTP</th><th>P&amp;L</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {todaysCalls.map(c => {
                    const m = callMetrics(c);
                    return (
                      <tr key={c.id}>
                        <td><span className="badge-muted">{c.segment}</span></td>
                        <td>
                          <div className="font-medium">{c.displayName ?? c.symbol}</div>
                          <div className="text-xs text-muted-foreground">{c.id}</div>
                        </td>
                        <td className={c.side === "BUY" ? "text-[hsl(var(--success))]" : "text-[hsl(var(--danger))]"}>
                          {c.side === "BUY" ? <ArrowUpRight className="inline h-3.5 w-3.5" /> : <ArrowDownRight className="inline h-3.5 w-3.5" />} {c.side}
                        </td>
                        <td>{formatNumber(c.entry)}</td>
                        <td className="text-[hsl(var(--success))]">{formatNumber(c.target1)}</td>
                        <td className="text-[hsl(var(--danger))]">{formatNumber(c.stopLoss)}</td>
                        <td>{formatNumber(m.refPrice)}</td>
                        <td className={classForChange(m.pnlPct)}>{formatPct(m.pnlPct, 1)}</td>
                        <td>
                          {c.status === "Active"     && <span className="inline-flex items-center gap-1 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />Active</span>}
                          {c.status === "Target Hit" && <span className="inline-flex items-center gap-1 text-[hsl(var(--success))]"><CheckCircle2 className="h-3.5 w-3.5" />Target Hit</span>}
                          {c.status === "SL Hit"     && <span className="inline-flex items-center gap-1 text-[hsl(var(--danger))]"><XCircle className="h-3.5 w-3.5" />SL Hit</span>}
                          {c.status === "Closed"     && <span className="text-muted-foreground">Closed</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="font-medium">Segment mix</div>
            <div className="text-xs text-muted-foreground">Distribution across all ideas</div>
          </div>
          <div className="card-body space-y-4">
            <AllocationDonut data={segAlloc} />
            <AllocationLegend data={segAlloc} />
          </div>
        </div>
      </section>

      {/* Segment track record + Live algos */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div className="font-medium flex items-center gap-2">
              <Trophy className="h-4 w-4" /> Segment track record
            </div>
            <Link href="/track-record" className="text-sm text-primary hover:underline">Details</Link>
          </div>
          <div className="card-body">
            <table className="table-base">
              <thead><tr><th>Segment</th><th>Ideas</th><th>Decided</th><th>Win rate</th><th>Avg return</th></tr></thead>
              <tbody>
                {bySeg.map(r => (
                  <tr key={r.segment}>
                    <td className="font-medium">{r.segment}</td>
                    <td>{r.total}</td>
                    <td>{r.decided}</td>
                    <td className={r.winRate >= 50 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--danger))]"}>{r.winRate.toFixed(0)}%</td>
                    <td className={classForChange(r.avgReturn)}>{formatPct(r.avgReturn, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div className="font-medium flex items-center gap-2">
              <Award className="h-4 w-4" /> Top-performing sources
            </div>
            <Link href="/strategies" className="text-sm text-primary hover:underline">All</Link>
          </div>
          <div className="card-body">
            {topSources.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                Not enough closed trades yet to rank sources.
              </div>
            ) : (
              <table className="table-base">
                <thead><tr><th>Source</th><th>Type</th><th>Decided</th><th>Win rate</th><th>Avg return</th></tr></thead>
                <tbody>
                  {topSources.map(a => (
                    <tr key={a.analyst}>
                      <td className="font-medium">{a.analyst}</td>
                      <td>
                        {a.kind === "Auto"
                          ? <span className="inline-flex items-center gap-1 text-xs text-primary"><Bot className="h-3 w-3" />Auto</span>
                          : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><User className="h-3 w-3" />Human</span>}
                      </td>
                      <td>{a.decided}</td>
                      <td className={a.winRate >= 60 ? "text-[hsl(var(--success))]" : a.winRate >= 40 ? "" : "text-[hsl(var(--danger))]"}>
                        {a.winRate.toFixed(0)}%
                      </td>
                      <td className={classForChange(a.avgReturn)}>{formatPct(a.avgReturn, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
