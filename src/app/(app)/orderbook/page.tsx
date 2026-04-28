"use client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useBrokerResource } from "@/lib/broker/hooks";
import { classForChange, formatINR, formatNumber } from "@/lib/utils";
import type { FyersOrder } from "@/lib/broker/types";
import { ORDER_TYPE_LABEL, orderStatusMeta } from "@/lib/broker/labels";
import { RefreshCw, X } from "lucide-react";
import { useState } from "react";

export default function OrderbookPage() {
  const { data, loading, error, status, lastUpdated, refresh } =
    useBrokerResource<{ orders: FyersOrder[] }>("/api/broker/orders", 10_000);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  async function cancel(o: FyersOrder) {
    if (!confirm(`Cancel order ${o.id} — ${o.side === 1 ? "BUY" : "SELL"} ${o.qty} ${o.symbol}?`)) return;
    setCancelingId(o.id);
    try {
      const r = await fetch("/api/broker/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: o.id }),
      });
      const j = await r.json();
      if (!r.ok) alert(`Cancel failed: ${j?.error}`);
      else refresh();
    } finally {
      setCancelingId(null);
    }
  }

  const rows = data?.orders ?? [];
  const open = rows.filter(o => orderStatusMeta(o.status).open);
  const done = rows.filter(o => !orderStatusMeta(o.status).open);

  return (
    <>
      <PageHeader
        title="Orderbook (live)"
        subtitle="Today's orders on your Fyers account."
        actions={<button className="btn-outline" onClick={refresh}><RefreshCw className="h-3.5 w-3.5 mr-1" />Refresh</button>}
      />

      {status === 401 ? (
        <NotConnected />
      ) : error ? (
        <div className="card"><div className="card-body text-sm text-[hsl(var(--danger))]">Error: {error}</div></div>
      ) : (
        <>
          <Block title="Open / pending" rows={open} canCancel={true} onCancel={cancel} cancelingId={cancelingId}
                 loading={loading && !data} lastUpdated={lastUpdated} />
          <Block title="Completed / cancelled / rejected" rows={done} canCancel={false}
                 loading={false} />
        </>
      )}
    </>
  );
}

function Block({
  title, rows, canCancel, onCancel, cancelingId, loading, lastUpdated,
}: {
  title: string; rows: FyersOrder[]; canCancel: boolean;
  onCancel?: (o: FyersOrder) => void; cancelingId?: string | null;
  loading: boolean; lastUpdated?: number | null;
}) {
  return (
    <section className="card">
      <div className="card-header flex items-center justify-between">
        <div className="font-medium">{title} <span className="text-xs text-muted-foreground ml-1">({rows.length})</span></div>
        <div className="text-xs text-muted-foreground">
          {loading ? "Loading…" : lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString("en-IN")}` : ""}
        </div>
      </div>
      <div className="card-body overflow-x-auto">
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">None.</div>
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Time</th><th>Status</th><th>Symbol</th>
                <th>Side</th><th>Type</th><th>Product</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Filled</th>
                <th className="text-right">Price</th>
                <th className="text-right">Avg fill</th>
                {canCancel && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(o => {
                const sl = orderStatusMeta(o.status);
                return (
                  <tr key={o.id}>
                    <td className="text-xs text-muted-foreground">
                      {o.orderDateTime ? new Date(o.orderDateTime).toLocaleTimeString("en-IN") : "—"}
                    </td>
                    <td className="text-xs">
                      <span className={sl.cls}>{sl.text}</span>
                      {o.message && <div className="text-[10px] text-muted-foreground max-w-[200px] truncate" title={o.message}>{o.message}</div>}
                    </td>
                    <td className="font-medium">{o.symbol}</td>
                    <td className={o.side === 1 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--danger))]"}>{o.side === 1 ? "BUY" : "SELL"}</td>
                    <td className="text-xs">{ORDER_TYPE_LABEL[o.type] ?? o.type}</td>
                    <td className="text-xs">{o.productType}</td>
                    <td className="text-right">{formatNumber(o.qty)}</td>
                    <td className={"text-right " + classForChange((o.filledQty ?? 0) > 0 ? 1 : 0)}>{formatNumber(o.filledQty ?? 0)}</td>
                    <td className="text-right">
                      {o.type === 2 ? "MKT"
                        : (o.limitPrice ?? 0) > 0 ? formatINR(o.limitPrice!)
                        : (o.stopPrice ?? 0) > 0 ? `trg ${formatINR(o.stopPrice!)}` : "—"}
                    </td>
                    <td className="text-right">{o.tradedPrice ? formatINR(o.tradedPrice) : "—"}</td>
                    {canCancel && (
                      <td className="text-right">
                        <button className="btn-ghost text-[hsl(var(--danger))]" disabled={cancelingId === o.id}
                                onClick={() => onCancel?.(o)}>
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
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
