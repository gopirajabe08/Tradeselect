"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { useBrokerStatus, useBrokerResource } from "@/lib/broker/hooks";
import { formatINR } from "@/lib/utils";
import type { FyersFunds } from "@/lib/broker/types";
import {
  CheckCircle2, CircleAlert, ExternalLink, FlaskConical, History, LogOut, Plug, RefreshCw,
  RotateCcw, ShieldCheck, Wallet, Zap,
} from "lucide-react";

type FundsResp = { funds: FyersFunds };
type BrokerId = "paper" | "fyers" | "tradejini";

const BROKERS: { id: BrokerId; label: string; docs?: string; appsUrl?: string }[] = [
  { id: "paper",     label: "Paper" },
  { id: "fyers",     label: "Fyers",     docs: "https://myapi.fyers.in/docsv3",         appsUrl: "https://myapi.fyers.in/" },
  { id: "tradejini", label: "Tradejini", docs: "https://developers.tradejini.com",       appsUrl: "https://developers.tradejini.com" },
];

export default function BrokerPage() {
  const sp = useSearchParams();
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [tab, setTab] = useState<BrokerId>("paper");
  const { status, loading, refresh } = useBrokerStatus(15_000);
  const funds = useBrokerResource<FundsResp>("/api/broker/funds", 30_000);
  const audit = useBrokerResource<{ entries: any[] }>("/api/broker/audit", 0);
  const market = useBrokerResource<{ open: boolean; hours: string; nextOpen: string | null }>("/api/market/status", 60_000);

  const brokers = (status as any)?.brokers ?? {};
  const activeMode = status?.brokerId as BrokerId | undefined;

  useEffect(() => {
    const connected = sp.get("broker_connected");
    const err       = sp.get("broker_error");
    const brokerTab = sp.get("broker_tab") as BrokerId | null;
    if (brokerTab && ["paper","fyers","tradejini"].includes(brokerTab)) setTab(brokerTab);
    else if (activeMode) setTab(activeMode);

    if (connected) { setBanner({ kind: "ok", msg: `${connected} connected successfully.` }); refresh(); }
    else if (err)  { setBanner({ kind: "err", msg: err }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, activeMode]);

  async function switchMode(mode: BrokerId) {
    const r = await fetch("/api/broker/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (!r.ok) { const j = await r.json().catch(()=>({})); alert(j.error ?? "Failed to switch"); return; }
    setBanner({ kind: "ok", msg: `Active broker set to ${mode}.` });
    refresh(); funds.refresh();
  }

  async function disconnect(b: BrokerId) {
    if (!confirm(`Disconnect ${b}? You'll need to re-authenticate to place orders.`)) return;
    await fetch("/api/broker/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ broker: b }),
    });
    setBanner({ kind: "ok", msg: `${b} disconnected.` });
    refresh();
  }

  async function resetPaper() {
    const currentDefault = String(status?.startingCash ?? 100000);
    const raw = prompt("Reset paper account with how much virtual cash?", currentDefault);
    if (!raw) return;
    const startingCash = Number(raw);
    if (!Number.isFinite(startingCash) || startingCash <= 0) { alert("Invalid amount"); return; }
    if (!confirm(`This wipes all paper orders / positions and sets cash to ${formatINR(startingCash)}. Continue?`)) return;
    await fetch("/api/broker/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startingCash }),
    });
    setBanner({ kind: "ok", msg: `Paper account reset to ${formatINR(startingCash)}.` });
    refresh(); funds.refresh();
  }

  return (
    <>
      <PageHeader
        title="Broker"
        subtitle="Connect multiple brokers. Flip the active switch to route orders to Paper, Fyers, or Tradejini."
        actions={
          <button className="btn-outline" onClick={() => { refresh(); funds.refresh(); audit.refresh(); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh
          </button>
        }
      />

      {banner && (
        <div className={
          "rounded-md border px-4 py-3 text-sm " +
          (banner.kind === "ok"
            ? "border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
            : "border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]")
        }>
          {banner.msg}
        </div>
      )}

      {/* Market status strip */}
      {market.data && (
        <div className={
          "rounded-md border px-4 py-2 text-sm flex items-center gap-2 " +
          (market.data.open
            ? "border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5 text-[hsl(var(--success))]"
            : "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400")
        }>
          <span className={"inline-block h-2 w-2 rounded-full " + (market.data.open ? "bg-[hsl(var(--success))] animate-pulse" : "bg-amber-500")} />
          <span className="font-medium">
            {market.data.open ? "Market open" : "Market closed"}
          </span>
          <span className="text-xs opacity-80">· {market.data.hours}</span>
          {!market.data.open && market.data.nextOpen && (
            <span className="text-xs opacity-80 ml-auto">Opens {market.data.nextOpen}</span>
          )}
        </div>
      )}

      {/* Active mode selector */}
      <section className="card">
        <div className="card-header flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /><span className="font-medium">Active broker</span>
          {activeMode === "paper"
            ? <span className="ml-auto text-xs inline-flex items-center gap-1 text-primary"><FlaskConical className="h-3 w-3" />Paper</span>
            : <span className="ml-auto text-xs inline-flex items-center gap-1 text-[hsl(var(--danger))]"><Zap className="h-3 w-3" />Live · {activeMode}</span>}
        </div>
        <div className="card-body flex flex-wrap gap-2">
          {BROKERS.map(b => {
            const isActive = activeMode === b.id;
            const bState   = brokers[b.id] ?? {};
            // Headless / lazy brokers (TradeJini Individual mode): no OAuth → never "connected"
            // until first API call, so allow activation as soon as creds are configured.
            const canActivate = b.id === "paper"
              || bState.connected
              || (b.id === "tradejini" && bState.hasCreds);
            return (
              <button
                key={b.id}
                onClick={() => canActivate && switchMode(b.id)}
                disabled={!canActivate}
                className={
                  "px-4 py-2 rounded-md border text-sm flex items-center gap-2 transition " +
                  (isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : canActivate
                      ? "bg-card hover:bg-accent"
                      : "bg-muted/30 text-muted-foreground cursor-not-allowed")
                }
              >
                {b.id === "paper" ? <FlaskConical className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                {b.label}
                {isActive && <CheckCircle2 className="h-3.5 w-3.5" />}
                {!canActivate && <span className="text-[10px] uppercase">not connected</span>}
              </button>
            );
          })}
        </div>
      </section>

      {/* Tabs: per-broker connection detail */}
      <section className="card">
        <div className="card-header flex gap-1 border-b">
          {BROKERS.map(b => (
            <button key={b.id} onClick={() => setTab(b.id)}
              className={
                "px-3 py-2 text-sm rounded-t-md border-b-2 transition " +
                (tab === b.id
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }>
              {b.label}
            </button>
          ))}
        </div>
        <div className="card-body">
          {tab === "paper" && <PaperPanel status={brokers.paper} onReset={resetPaper} />}
          {tab === "fyers" && <OAuthPanel broker={BROKERS[1]} state={brokers.fyers} onDisconnect={() => disconnect("fyers")} />}
          {tab === "tradejini" && <OAuthPanel broker={BROKERS[2]} state={brokers.tradejini} onDisconnect={() => disconnect("tradejini")} />}
        </div>
      </section>

      {/* Funds of active broker */}
      {activeMode && brokers[activeMode]?.connected && (
        <section className="card">
          <div className="card-header flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium"><Wallet className="h-4 w-4" />Funds — active broker</div>
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={funds.refresh}>
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="card-body">
            <FundsTable resp={funds} isPaper={activeMode === "paper"} />
          </div>
        </section>
      )}

      {/* Order audit log */}
      <section className="card">
        <div className="card-header flex items-center gap-2">
          <History className="h-4 w-4" />
          <span className="font-medium">Order audit log</span>
          <span className="text-xs text-muted-foreground ml-2">every place / cancel across all brokers</span>
        </div>
        <div className="card-body overflow-x-auto">
          {audit.data?.entries?.length ? (
            <table className="table-base">
              <thead><tr><th>When</th><th>Broker</th><th>Action</th><th>Symbol</th><th>Qty</th><th>Result</th><th>Detail</th></tr></thead>
              <tbody>
                {audit.data.entries.slice(0, 50).map((e: any, i) => (
                  <tr key={i}>
                    <td className="text-xs text-muted-foreground">{new Date(e.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td>{e.broker}</td>
                    <td className="text-xs">{e.action}</td>
                    <td className="text-xs">{e.input?.symbol ?? e.input?.order_id ?? "—"}</td>
                    <td className="text-xs">{e.input?.qty ?? "—"}</td>
                    <td className={e.result === "ok" ? "text-[hsl(var(--success))]" : "text-[hsl(var(--danger))]"}>{e.result}</td>
                    <td className="text-xs text-muted-foreground max-w-[280px] truncate" title={e.errorMessage ?? JSON.stringify(e.resultDetail ?? {})}>
                      {e.errorMessage ?? (e.resultDetail?.id ? `id=${e.resultDetail.id}` : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-6">No orders placed yet.</div>
          )}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Safety: kill-switch (halt.flag) + daily-loss circuit breaker (−2%) + per-order notional cap + daily order count cap. All driven from env, see <code className="font-mono">.env.local</code>.
      </p>
    </>
  );
}

function PaperPanel({ status, onReset }: { status: any; onReset: () => void }) {
  if (!status) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
      <Field label="Mode" value={<span className="inline-flex items-center gap-1 text-primary"><FlaskConical className="h-3.5 w-3.5" />Paper</span>} />
      <Field label="Starting cash" value={formatINR(status.startingCash ?? 0)} />
      <Field label="Available cash" value={<span className="font-semibold">{formatINR(status.cash ?? 0)}</span>} />
      <Field label="Positions / Holdings / Open" value={`${status.positions ?? 0} · ${status.holdings ?? 0} · ${status.openOrders ?? 0}`} />
      <div className="md:col-span-4 pt-1">
        <button className="btn-outline text-[hsl(var(--danger))]" onClick={onReset}>
          <RotateCcw className="h-4 w-4 mr-1" />Reset paper account
        </button>
      </div>
    </div>
  );
}

function OAuthPanel({
  broker, state, onDisconnect,
}: {
  broker: { id: BrokerId; label: string; docs?: string; appsUrl?: string };
  state: any;
  onDisconnect: () => void;
}) {
  if (!state) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const envPrefix = broker.id === "fyers" ? "FYERS" : "TRADEJINI";

  if (!state.hasCreds) {
    if (broker.id === "tradejini") {
      // Individual mode (CubePlus): no Apps secret, no OAuth redirect.
      return (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 font-medium text-[hsl(var(--danger))]">
            <CircleAlert className="h-4 w-4" /> Tradejini credentials missing
          </div>
          <p className="text-muted-foreground">
            Add <code>TRADEJINI_API_KEY</code>, <code>TRADEJINI_CLIENT_ID</code>, <code>TRADEJINI_PIN</code>, and <code>TRADEJINI_TOTP_SECRET</code> to <code>.env.local</code>, then restart the service.
          </p>
          <p className="text-muted-foreground">
            Register an Individual-mode app at{" "}
            <a className="text-primary hover:underline" target="_blank" rel="noreferrer" href="https://developers.tradejini.com">
              developers.tradejini.com <ExternalLink className="inline h-3 w-3" />
            </a>. No redirect URI is needed — Individual mode uses headless TOTP login (no OAuth flow).
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            ℹ Connection is automatic on first API call once <code>BROKER=tradejini</code> is set in server <code>.env.local</code>. Default is <code>BROKER=paper</code> for safety.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 font-medium text-[hsl(var(--danger))]">
          <CircleAlert className="h-4 w-4" /> {broker.label} credentials missing
        </div>
        <p className="text-muted-foreground">
          Add <code>{envPrefix}_APP_ID</code> and <code>{envPrefix}_SECRET_KEY</code> to <code>.env.local</code>, then restart the dev server.
        </p>
        <p className="text-muted-foreground">
          Register an app at{" "}
          <a className="text-primary hover:underline" target="_blank" rel="noreferrer" href={broker.appsUrl}>
            {broker.appsUrl} <ExternalLink className="inline h-3 w-3" />
          </a> with redirect URI <code>http://localhost:2001/api/broker/callback</code>.
        </p>
      </div>
    );
  }

  if (state.connected) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
        <Field label="Status" value={
          state.expired
            ? <span className="inline-flex items-center gap-1 text-amber-500"><CircleAlert className="h-3.5 w-3.5" />Token expired</span>
            : <span className="inline-flex items-center gap-1 text-[hsl(var(--success))]"><CheckCircle2 className="h-3.5 w-3.5" />Connected</span>
        } />
        <Field label="User"  value={state.userName || "—"} sub={state.userId} />
        <Field label="Broker" value={broker.label} />
        <Field label="Token" value={state.issuedAt ? new Date(state.issuedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}
               sub="Expires ~06:00 IST next trading day" />
        <div className="md:col-span-4 flex gap-2 pt-1">
          {state.expired && (
            <a className="btn-primary" href={`/api/broker/connect?broker=${broker.id}`}>
              <RefreshCw className="h-4 w-4 mr-1" />Re-authenticate
            </a>
          )}
          <button className="btn-outline text-[hsl(var(--danger))]" onClick={onDisconnect}>
            <LogOut className="h-4 w-4 mr-1" />Disconnect
          </button>
        </div>
      </div>
    );
  }

  // Tradejini Individual mode: no OAuth flow. Connection happens automatically
  // on the first API call via headless TOTP login (when BROKER=tradejini).
  if (broker.id === "tradejini") {
    return (
      <div className="space-y-3 text-sm">
        <div className="text-muted-foreground">
          Credentials configured. TradeJini Individual mode connects automatically on the first API call — no Connect button needed.
        </div>
        <div className="text-xs text-muted-foreground">
          To activate: set <code>BROKER=tradejini</code> in <code>/opt/ts-app/.env.local</code> on the server, then restart the service. Default <code>BROKER=paper</code> stays safe until you flip.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="text-muted-foreground">
        Not connected to {broker.label} yet. Click below to log in on their site — we never see your password.
      </div>
      <a href={`/api/broker/connect?broker=${broker.id}`} className="btn-primary inline-flex">
        <Plug className="h-4 w-4 mr-1" />Connect {broker.label}
      </a>
    </div>
  );
}

function FundsTable({ resp, isPaper }: { resp: any; isPaper: boolean }) {
  const rows = resp.data?.funds?.fund_limit ?? [];
  if (resp.loading && !resp.data) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (resp.error) return <div className="text-sm text-[hsl(var(--danger))]">{resp.error}</div>;
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">No fund data.</div>;
  return (
    <table className="table-base">
      <thead><tr><th>Title</th><th className="text-right">{isPaper ? "Amount" : "Equity"}</th>{!isPaper && <th className="text-right">Commodity</th>}</tr></thead>
      <tbody>
        {rows.map((r: any) => (
          <tr key={r.id}>
            <td>{r.title}</td>
            <td className="text-right">{formatINR(r.equityAmount ?? 0)}</td>
            {!isPaper && <td className="text-right">{formatINR(r.commodityAmount ?? 0)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Field({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium mt-0.5">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
