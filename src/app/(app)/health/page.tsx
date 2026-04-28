"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useBrokerResource } from "@/lib/broker/hooks";
import {
  Activity, AlertOctagon, CheckCircle2, Cpu, Database, FlaskConical,
  HardDrive, RefreshCw, Server, ShieldCheck, TrendingUp, Zap,
} from "lucide-react";

type Health = {
  ok: boolean;
  at: string;
  process: { uptimeSec: number; memoryMB: number; heapMB: number; nodeVersion: string };
  market: { isOpen: boolean };
  broker: { mode: string; killSwitchEngaged: boolean };
  regime: { regime: string; breadthPct: number; vix: number; computedAt: string } | null;
  paper: { orders: number; positions: number; holdings: number };
  audit: {
    totalEntries: number;
    recentPlaceAttempts: number;
    recentPlaceErrors: number;
    errorRatePct: number;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
    lastSuccessAt: string | null;
  };
  disk: { dataDir: string; files: number; bytes: number; mb: number };
};

function uptimeLabel(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec/60)}m ${sec%60}s`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m`;
  return `${Math.floor(sec/86400)}d ${Math.floor((sec%86400)/3600)}h`;
}

export default function HealthPage() {
  const { data, refresh, lastUpdated } = useBrokerResource<Health>("/api/health", 30_000);

  return (
    <>
      <PageHeader
        title="System health"
        subtitle="Live diagnostics for the auto-trader. Use this when something feels off — before tailing logs."
        actions={
          <button className="btn-outline" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
          </button>
        }
      />

      {!data ? (
        <div className="card"><div className="card-body text-sm text-muted-foreground">Loading…</div></div>
      ) : (
        <>
          <section className={
            "rounded-md border px-4 py-3 text-sm flex items-start gap-2 " +
            (data.ok
              ? "border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
              : "border-[hsl(var(--danger))]/40 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]")
          }>
            {data.ok
              ? <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
              : <AlertOctagon className="h-5 w-5 shrink-0 mt-0.5" />}
            <div>
              <div className="font-semibold uppercase tracking-wide text-xs">
                {data.ok ? "Healthy" : "Attention required"}
              </div>
              <div className="text-xs opacity-90 mt-0.5">
                Snapshot {lastUpdated ? new Date(lastUpdated).toLocaleTimeString("en-IN") : "now"} · auto-refreshes every 30 s
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile icon={<Server className="h-4 w-4" />} label="Process uptime"
              value={uptimeLabel(data.process.uptimeSec)}
              sub={`Node ${data.process.nodeVersion}`} />
            <Tile icon={<Cpu className="h-4 w-4" />} label="Memory"
              value={`${data.process.memoryMB} MB`}
              sub={`Heap ${data.process.heapMB} MB`} />
            <Tile icon={<TrendingUp className="h-4 w-4" />} label="Market"
              value={data.market.isOpen ? "Open" : "Closed"}
              sub={data.market.isOpen ? "NSE 09:15–15:30 IST" : "Outside trading hours"}
              tone={data.market.isOpen ? "success" : "muted"} />
            <Tile icon={data.broker.mode === "paper" ? <FlaskConical className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
              label="Active broker" value={data.broker.mode}
              sub={data.broker.killSwitchEngaged ? "⚠ kill-switch ENGAGED" : "Kill-switch off"}
              tone={data.broker.killSwitchEngaged ? "danger" : "primary"} />
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card title="Regime detector" icon={<Activity className="h-4 w-4" />}>
              {data.regime ? (
                <div className="space-y-1 text-sm">
                  <Row label="Regime" value={
                    <span className={
                      data.regime.regime === "TRENDING-UP" ? "text-[hsl(var(--success))]" :
                      data.regime.regime === "TRENDING-DOWN" ? "text-[hsl(var(--danger))]" :
                      "text-amber-600"
                    }>{data.regime.regime}</span>
                  } />
                  <Row label="Breadth" value={`${data.regime.breadthPct.toFixed(0)}%`} />
                  <Row label="VIX" value={data.regime.vix.toFixed(1)} />
                  <Row label="Computed" value={new Date(data.regime.computedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No regime computed yet — waiting for first generator run.</div>
              )}
            </Card>

            <Card title="Paper engine" icon={<Database className="h-4 w-4" />}>
              <div className="space-y-1 text-sm">
                <Row label="Orders in store" value={String(data.paper.orders)} />
                <Row label="Open positions" value={String(data.paper.positions)} />
                <Row label="Holdings" value={String(data.paper.holdings)} />
              </div>
            </Card>

            <Card title="Order audit" icon={<ShieldCheck className="h-4 w-4" />}>
              <div className="space-y-1 text-sm">
                <Row label="Total entries" value={String(data.audit.totalEntries)} />
                <Row label="Recent place attempts" value={String(data.audit.recentPlaceAttempts)} />
                <Row label="Error rate (recent)"
                  value={<span className={data.audit.errorRatePct > 30 ? "text-[hsl(var(--danger))]" : ""}>
                    {data.audit.errorRatePct}%
                  </span>} />
                <Row label="Last success" value={data.audit.lastSuccessAt ? new Date(data.audit.lastSuccessAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"} />
                <Row label="Last error" value={data.audit.lastErrorAt ? new Date(data.audit.lastErrorAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                     sub={data.audit.lastErrorMessage ? data.audit.lastErrorMessage.slice(0, 80) : undefined} />
              </div>
            </Card>

            <Card title="Disk usage" icon={<HardDrive className="h-4 w-4" />}>
              <div className="space-y-1 text-sm">
                <Row label="Data dir" value={<code className="text-xs">{data.disk.dataDir.replace("/Users/vgopiraja", "~")}</code>} />
                <Row label="Files" value={String(data.disk.files)} />
                <Row label="Size" value={`${data.disk.mb} MB`} />
              </div>
            </Card>
          </section>

          <p className="text-xs text-muted-foreground">
            Healthy = error rate &lt; 50% on recent place attempts AND kill-switch off. Add bot-side heartbeats to Telegram for off-screen visibility.
          </p>
        </>
      )}
    </>
  );
}

function Tile({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  tone?: "success" | "danger" | "primary" | "muted";
}) {
  const cls =
    tone === "success" ? "text-[hsl(var(--success))]" :
    tone === "danger"  ? "text-[hsl(var(--danger))]"  :
    tone === "primary" ? "text-primary"               :
    tone === "muted"   ? "text-muted-foreground"      : "";
  return (
    <div className="card"><div className="card-body">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className={"text-xl md:text-2xl font-semibold mt-1 " + cls}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div></div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card-header flex items-center gap-2 font-medium">{icon}{title}</div>
      <div className="card-body">{children}</div>
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="font-medium">{value}</span>
        {sub && <div className="text-xs text-muted-foreground mt-0.5 max-w-[300px] truncate">{sub}</div>}
      </div>
    </div>
  );
}
