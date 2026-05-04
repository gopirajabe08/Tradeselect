"use client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useBrokerResource, useBrokerStatus } from "@/lib/broker/hooks";
import { classForChange, formatINR, formatNumber, formatPct } from "@/lib/utils";
import type { FyersHolding } from "@/lib/broker/types";
import { RefreshCw } from "lucide-react";

export default function HoldingsPage() {
  const { data, loading, error, status, lastUpdated, refresh } =
    useBrokerResource<{ holdings: FyersHolding[] }>("/api/broker/holdings", 30_000);
  const { status: brokerStatus } = useBrokerStatus(15_000);
  const isPaper = !brokerStatus || brokerStatus.brokerId === "paper";
  const rows = data?.holdings ?? [];

  const totals = rows.reduce((acc, h) => {
    const invested = h.costPrice * h.quantity;
    const value    = (h.ltp ?? 0) * h.quantity;
    acc.invested += invested;
    acc.value    += value;
    acc.pnl      += (h.pl ?? (value - invested));
    return acc;
  }, { invested: 0, value: 0, pnl: 0 });

  return (
    <>
      <PageHeader
        title={isPaper ? "Holdings — Paper" : "Holdings — LIVE"}
        subtitle={isPaper ? "Simulated long-term holdings in paper account." : `Real holdings on ${brokerStatus?.brokerId?.toUpperCase()} account.`}
        actions={<button className="btn-outline" onClick={refresh}><RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh</button>}
      />

      {status === 401 ? (
        <NotConnected />
      ) : error ? (
        <div className="card"><div className="card-body text-sm text-[hsl(var(--danger))]">Error: {error}</div></div>
      ) : (
        <>
          <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Stat label="Invested"      value={formatINR(totals.invested)} />
            <Stat label="Current value" value={formatINR(totals.value)} />
            <Stat label="Total P&L"     value={formatINR(totals.pnl)}
                  tone={totals.pnl >= 0 ? "success" : "danger"}
                  sub={totals.invested ? formatPct((totals.pnl / totals.invested) * 100) : "—"} />
          </section>

          <section className="card">
            <div className="card-header flex items-center justify-between">
              <div className="font-medium">Holdings</div>
              <div className="text-xs text-muted-foreground">
                {loading && !data ? "Loading…" : lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString("en-IN")}` : ""}
              </div>
            </div>
            <div className="card-body overflow-x-auto">
              {rows.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-10">No holdings yet.</div>
              ) : (
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Avg cost</th>
                      <th className="text-right">LTP</th>
                      <th className="text-right">Market value</th>
                      <th className="text-right">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(h => {
                      const invested = h.costPrice * h.quantity;
                      const value    = (h.ltp ?? 0) * h.quantity;
                      const pnl      = h.pl ?? (value - invested);
                      const pnlPct   = invested ? (pnl / invested) * 100 : 0;
                      return (
                        <tr key={h.symbol}>
                          <td className="font-medium">{h.symbol}</td>
                          <td className="text-right">{formatNumber(h.quantity)}</td>
                          <td className="text-right">{formatINR(h.costPrice)}</td>
                          <td className="text-right">{formatINR(h.ltp ?? 0)}</td>
                          <td className="text-right">{formatINR(value)}</td>
                          <td className={"text-right " + classForChange(pnl)}>
                            {formatINR(pnl)} <span className="text-xs">({formatPct(pnlPct)})</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function NotConnected() {
  return (
    <div className="card">
      <div className="card-body text-sm space-y-2">
        <div className="font-medium">Not connected to Fyers</div>
        <p className="text-muted-foreground">Connect your account first.</p>
        <Link className="btn-primary inline-flex" href="/broker">Open Broker settings</Link>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "success" | "danger" }) {
  const cls = tone === "success" ? "text-[hsl(var(--success))]" : tone === "danger" ? "text-[hsl(var(--danger))]" : "";
  return (
    <div className="card"><div className="card-body">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"text-xl md:text-2xl font-semibold mt-1 " + cls}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div></div>
  );
}
