import { PageHeader } from "@/components/page-header";
import { readCalls } from "@/lib/calls/store";
import { triggerCallMatcher } from "@/lib/calls/matcher";
import { callMetrics, callStats, segmentPerformance } from "@/lib/mock/derive";
import { classForChange, formatNumber, formatPct } from "@/lib/utils";
import { Award, CheckCircle2, Clock, Percent, TrendingUp, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TrackRecordPage() {
  triggerCallMatcher();
  const calls = await readCalls();
  const stats = callStats(calls);
  const bySeg = segmentPerformance(calls);
  const closed = calls.filter(c => c.status !== "Active")
    .sort((a, b) => (b.closedAt ?? b.issuedAt).localeCompare(a.closedAt ?? a.issuedAt));

  return (
    <>
      <PageHeader
        title="Track Record"
        subtitle="Transparent performance of all published calls — active, hit, stop-loss triggered and closed."
      />

      {/* KPI row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<TrendingUp className="h-4 w-4" />} label="Total calls"  value={String(stats.total)} />
        <Stat icon={<Clock       className="h-4 w-4" />} label="Active"       value={String(stats.active)}  tone="primary" />
        <Stat icon={<CheckCircle2 className="h-4 w-4" />} label="Target Hit"  value={String(stats.hits)}    tone="success" />
        <Stat icon={<Percent     className="h-4 w-4" />} label="Win rate"    value={`${stats.winRate.toFixed(1)}%`} tone="success" />
      </section>

      {/* Segment-wise performance */}
      <section className="card">
        <div className="card-header flex items-center gap-2">
          <Award className="h-4 w-4" />
          <span className="font-medium">Performance by segment</span>
        </div>
        <div className="card-body">
          <table className="table-base">
            <thead>
              <tr>
                <th>Segment</th><th>Total</th><th>Decided</th>
                <th>Win rate</th><th>Avg return</th><th className="w-[30%]">Distribution</th>
              </tr>
            </thead>
            <tbody>
              {bySeg.map(r => (
                <tr key={r.segment}>
                  <td className="font-medium">{r.segment}</td>
                  <td>{r.total}</td>
                  <td>{r.decided}</td>
                  <td className={r.winRate >= 50 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--danger))]"}>
                    {r.winRate.toFixed(0)}%
                  </td>
                  <td className={classForChange(r.avgReturn)}>{formatPct(r.avgReturn, 1)}</td>
                  <td>
                    <div className="h-2 w-full rounded bg-muted overflow-hidden">
                      <div
                        className="h-full bg-[hsl(var(--success))]"
                        style={{ width: `${Math.max(0, Math.min(100, r.winRate))}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Historical calls log */}
      <section className="card">
        <div className="card-header font-medium">Closed calls — recent history</div>
        <div className="card-body">
          <table className="table-base">
            <thead>
              <tr>
                <th>ID</th><th>Segment</th><th>Symbol</th><th>Side</th>
                <th>Entry</th><th>Target</th><th>Stop-loss</th>
                <th>Closed @</th><th>Return</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {closed.map(c => {
                const m = callMetrics(c);
                return (
                  <tr key={c.id}>
                    <td className="text-xs text-muted-foreground">{c.id}</td>
                    <td>{c.segment}</td>
                    <td className="font-medium">{c.displayName ?? c.symbol}</td>
                    <td className={c.side === "BUY" ? "text-[hsl(var(--success))]" : "text-[hsl(var(--danger))]"}>{c.side}</td>
                    <td>{formatNumber(c.entry)}</td>
                    <td>{formatNumber(c.target1)}</td>
                    <td>{formatNumber(c.stopLoss)}</td>
                    <td>{c.closedPrice ? formatNumber(c.closedPrice) : "—"}</td>
                    <td className={classForChange(m.pnlPct)}>{formatPct(m.pnlPct, 1)}</td>
                    <td>
                      {c.status === "Target Hit" && <span className="text-[hsl(var(--success))] inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />{c.status}</span>}
                      {c.status === "SL Hit"     && <span className="text-[hsl(var(--danger))] inline-flex items-center gap-1"><XCircle className="h-3.5 w-3.5" />{c.status}</span>}
                      {c.status === "Closed"     && <span className="text-muted-foreground">{c.status}</span>}
                      {c.status === "Expired"    && <span className="text-muted-foreground">{c.status}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "success" | "primary" }) {
  const toneCls = tone === "success" ? "text-[hsl(var(--success))]" : tone === "primary" ? "text-primary" : "text-foreground";
  return (
    <div className="card">
      <div className="card-body">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className={"text-2xl font-semibold mt-1 " + toneCls}>{value}</div>
      </div>
    </div>
  );
}
