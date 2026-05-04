"use client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useBrokerResource, useBrokerStatus } from "@/lib/broker/hooks";
import { classForChange, formatINR, formatNumber } from "@/lib/utils";
import type { FyersPosition } from "@/lib/broker/types";
import { RefreshCw } from "lucide-react";

export default function PositionsPage() {
  const { data, loading, error, status, lastUpdated, refresh } =
    useBrokerResource<{ positions: { netPositions: FyersPosition[]; overall?: any } }>("/api/broker/positions", 15_000);
  const { status: brokerStatus } = useBrokerStatus(15_000);
  const isPaper = !brokerStatus || brokerStatus.brokerId === "paper";

  return (
    <>
      <PageHeader
        title={isPaper ? "Positions — Paper" : "Positions — LIVE"}
        subtitle={isPaper ? "Simulated positions in paper account." : `Real positions on ${brokerStatus?.brokerId?.toUpperCase()} account.`}
        actions={<button className="btn-outline" onClick={refresh}><RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh</button>}
      />

      {status === 401 ? (
        <NotConnected />
      ) : error ? (
        <div className="card"><div className="card-body text-sm text-[hsl(var(--danger))]">Error: {error}</div></div>
      ) : (
        <>
          <PositionsTable
            title="Open positions"
            rows={(data?.positions.netPositions ?? []).filter(p => (p.netQty ?? 0) !== 0)}
            loading={loading && !data}
            lastUpdated={lastUpdated}
          />
          <PositionsTable
            title="Today's closed (realized P&L)"
            rows={(data?.positions.netPositions ?? []).filter(p => (p.netQty ?? 0) === 0 && (p.realized_profit ?? 0) !== 0)}
            loading={loading && !data}
            lastUpdated={lastUpdated}
          />
        </>
      )}
    </>
  );
}

function PositionsTable({ title, rows, loading, lastUpdated }: { title: string; rows: FyersPosition[]; loading: boolean; lastUpdated?: number | null }) {
  const totalPnl = rows.reduce((s, r) => s + (r.pl ?? 0), 0);
  return (
    <section className="card">
      <div className="card-header flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-medium">{title}</span>
          <span className={"text-sm " + classForChange(totalPnl)}>{formatINR(totalPnl)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {loading ? "Loading…" : lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString("en-IN")}` : ""}
        </div>
      </div>
      <div className="card-body overflow-x-auto">
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">No open positions.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Symbol</th><th>Product</th>
                <th className="text-right">Net qty</th>
                <th className="text-right">Avg</th>
                <th className="text-right">LTP</th>
                <th className="text-right">Realised</th>
                <th className="text-right">Unrealised</th>
                <th className="text-right">Total P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td className="font-medium">{p.symbol}</td>
                  <td className="text-xs">{p.productType}</td>
                  <td className="text-right">{formatNumber(p.netQty)}</td>
                  <td className="text-right">{formatINR(p.netAvg ?? 0)}</td>
                  <td className="text-right">{formatINR(p.ltp ?? 0)}</td>
                  <td className={"text-right " + classForChange(p.realized_profit ?? 0)}>{formatINR(p.realized_profit ?? 0)}</td>
                  <td className={"text-right " + classForChange(p.unrealized_profit ?? 0)}>{formatINR(p.unrealized_profit ?? 0)}</td>
                  <td className={"text-right font-medium " + classForChange(p.pl ?? 0)}>{formatINR(p.pl ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function NotConnected() {
  return (
    <div className="card">
      <div className="card-body text-sm space-y-2">
        <div className="font-medium">Not connected to Fyers</div>
        <Link className="btn-primary inline-flex" href="/broker">Open Broker settings</Link>
      </div>
    </div>
  );
}
