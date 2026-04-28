import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { readCalls } from "@/lib/calls/store";
import { triggerCallMatcher } from "@/lib/calls/matcher";
import { performanceByAnalyst } from "@/lib/mock/derive";
import { classForChange, formatPct } from "@/lib/utils";
import { ArrowRight, Award, Bot, User, Zap } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  triggerCallMatcher();
  const calls = await readCalls();
  const rows  = performanceByAnalyst(calls);

  const decided = rows.filter(r => r.decided > 0);
  const best    = decided[0];                                         // already sorted by win rate
  const worst   = decided[decided.length - 1];
  const totalIdeas    = rows.reduce((s, r) => s + r.total, 0);
  const totalDecided  = rows.reduce((s, r) => s + r.decided, 0);
  const totalTargets  = rows.reduce((s, r) => s + r.targetHits, 0);
  const overallWinRate= totalDecided === 0 ? 0 : (totalTargets / totalDecided) * 100;

  return (
    <>
      <PageHeader
        title="Strategy Performance"
        subtitle="Which idea sources actually make money. Auto-strategies flagged separately from human analysts."
        actions={
          <Link href="/calls" className="btn-outline"><Zap className="h-3.5 w-3.5 mr-1" />Trade Ideas</Link>
        }
      />

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Overall win rate" value={totalDecided ? `${overallWinRate.toFixed(1)}%` : "—"}
                 footer={`${totalTargets} target hits / ${totalDecided} decided`} accent="success" />
        <KpiCard label="Best source"      value={best ? best.analyst.split(" ").slice(0, 3).join(" ") : "—"}
                 footer={best ? `${best.winRate.toFixed(0)}% win rate · ${formatPct(best.avgReturn, 1)}` : "Not enough data yet"}
                 accent="success" />
        <KpiCard label="Weakest source"   value={worst && worst !== best ? worst.analyst.split(" ").slice(0, 3).join(" ") : "—"}
                 footer={worst && worst !== best ? `${worst.winRate.toFixed(0)}% win rate · ${formatPct(worst.avgReturn, 1)}` : "—"}
                 accent="warning" />
        <KpiCard label="Total ideas published" value={String(totalIdeas)} footer={`${totalDecided} closed so far`} />
      </section>

      {/* Main per-source table */}
      <section className="card">
        <div className="card-header flex items-center gap-2">
          <Award className="h-4 w-4" />
          <span className="font-medium">Per-source performance</span>
          <span className="text-xs text-muted-foreground ml-2">sorted by win rate; undecided sources at bottom</span>
        </div>
        <div className="card-body overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th className="text-right">Total</th>
                <th className="text-right">Active</th>
                <th className="text-right">Decided</th>
                <th className="text-right">Target</th>
                <th className="text-right">SL</th>
                <th className="text-right">Win rate</th>
                <th className="text-right">Avg return</th>
                <th className="text-right">Best / Worst</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const hasData = r.decided > 0;
                const winCls = !hasData ? "text-muted-foreground"
                  : r.winRate >= 60 ? "text-[hsl(var(--success))]"
                  : r.winRate >= 40 ? "text-foreground"
                                    : "text-[hsl(var(--danger))]";
                return (
                  <tr key={r.analyst} className="hover:bg-accent/40">
                    <td>
                      <div className="font-medium">{r.analyst}</div>
                      <div className="text-[10px] text-muted-foreground">Latest {new Date(r.latestAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div>
                    </td>
                    <td>
                      {r.kind === "Auto" ? (
                        <span className="inline-flex items-center gap-1 text-xs text-primary">
                          <Bot className="h-3 w-3" /> Auto
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" /> Human
                        </span>
                      )}
                    </td>
                    <td className="text-right">{r.total}</td>
                    <td className="text-right">{r.active}</td>
                    <td className="text-right">{r.decided}</td>
                    <td className="text-right text-[hsl(var(--success))]">{r.targetHits}</td>
                    <td className="text-right text-[hsl(var(--danger))]">{r.slHits}</td>
                    <td className={"text-right font-medium " + winCls}>
                      {hasData ? `${r.winRate.toFixed(0)}%` : "—"}
                    </td>
                    <td className={"text-right " + (hasData ? classForChange(r.avgReturn) : "text-muted-foreground")}>
                      {hasData ? formatPct(r.avgReturn, 1) : "—"}
                    </td>
                    <td className="text-right text-xs">
                      {hasData ? (
                        <>
                          <span className="text-[hsl(var(--success))]">{formatPct(r.bestReturn, 1)}</span>
                          <span className="text-muted-foreground"> / </span>
                          <span className="text-[hsl(var(--danger))]">{formatPct(r.worstReturn, 1)}</span>
                        </>
                      ) : "—"}
                    </td>
                    <td className="text-right">
                      <Link href={`/calls?analyst=${encodeURIComponent(r.analyst)}`}
                            className="text-xs text-primary hover:underline inline-flex items-center gap-0.5">
                        View ideas <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Sources with no closed trades yet show <code>—</code>. Win rate ≥ 60 % (green) is the quality bar; &lt; 40 % (red) suggests cutting the source.
        Auto-strategies generate ideas every 30 minutes from the Nifty 500 scanner; human analysts are manually published.
      </p>
    </>
  );
}
