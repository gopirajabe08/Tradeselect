"use client";
import { useMemo, useState } from "react";
import { TradeCall, Segment, CallStatus } from "@/lib/mock/seed";
import { callMetrics } from "@/lib/mock/derive";
import { classForChange, formatNumber, formatPct } from "@/lib/utils";
import { PlaceOrderModal, prefillFromCall, type OrderPrefill } from "@/components/place-order-modal";
import {
  ArrowDownRight, ArrowUpRight, Check, CheckCircle2, Clock, Info,
  ShieldAlert, ShoppingCart, Target as TargetIcon, XCircle,
} from "lucide-react";

const SEGMENTS: ("All" | Segment)[] = [
  "All", "Equity", "Intraday", "Swing", "BTST", "Positional", "Futures", "Options", "MCX",
];
const STATUSES: ("All" | CallStatus)[] = ["All", "Active", "Target Hit", "SL Hit", "Closed", "Expired"];

export function CallsView({
  calls,
  initialSegment,
  initialStatus,
}: {
  calls: TradeCall[];
  initialSegment: string;
  initialStatus: string;
}) {
  const [segment, setSegment] = useState<string>(initialSegment);
  const [status, setStatus]   = useState<string>(initialStatus);
  const [taken, setTaken]     = useState<Record<string, "Taken" | "Ignored" | undefined>>({});
  const [orderModal, setOrderModal] = useState<{ open: boolean; prefill: OrderPrefill | null; callId: string | null }>({ open: false, prefill: null, callId: null });

  const filtered = useMemo(() => {
    return calls
      .filter(c =>
        (segment === "All" || c.segment === segment) &&
        (status  === "All" || c.status  === status)
      )
      // Sort: highest score first (undefined score sinks to end)
      .slice()
      .sort((a, b) => {
        const aScore = a.score ?? -1;
        const bScore = b.score ?? -1;
        if (aScore !== bScore) return bScore - aScore;
        return b.issuedAt.localeCompare(a.issuedAt);
      });
  }, [segment, status, calls]);

  const counts = useMemo(() => {
    const seg: Record<string, number> = { All: calls.length };
    for (const c of calls) seg[c.segment] = (seg[c.segment] ?? 0) + 1;
    return seg;
  }, [calls]);

  return (
    <div className="space-y-4">
      {/* Segment tabs */}
      <div className="flex flex-wrap gap-1 border-b">
        {SEGMENTS.map(s => (
          <button
            key={s}
            onClick={() => setSegment(s)}
            className={
              "px-3 py-2 text-sm rounded-t-md border-b-2 transition " +
              (segment === s
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {s}
            <span className="ml-1.5 text-xs text-muted-foreground">
              ({counts[s] ?? 0})
            </span>
          </button>
        ))}
      </div>

      {/* Status + legend bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={
                "px-2.5 py-1 text-xs rounded-full border transition " +
                (status === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent hover:bg-accent border-border text-muted-foreground")
              }
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
          Advisory only. Execute on your broker.
        </div>
      </div>

      {/* Grid of call cards */}
      {filtered.length === 0 ? (
        <div className="card"><div className="card-body text-sm text-muted-foreground text-center py-10">
          No ideas match these filters.
        </div></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(c => (
            <CallCard
              key={c.id}
              call={c}
              taken={taken[c.id]}
              onTake={() => setTaken(t => ({ ...t, [c.id]: "Taken" }))}
              onIgnore={() => setTaken(t => ({ ...t, [c.id]: "Ignored" }))}
              onPlaceOrder={() => setOrderModal({ open: true, prefill: prefillFromCall(c), callId: c.id })}
            />
          ))}
        </div>
      )}

      <PlaceOrderModal
        open={orderModal.open}
        prefill={orderModal.prefill ?? { symbol: "", qty: 1, type: 1, side: 1, productType: "CNC" }}
        calledFrom={orderModal.callId ? `Idea ${orderModal.callId}` : undefined}
        onClose={() => setOrderModal({ open: false, prefill: null, callId: null })}
      />
    </div>
  );
}

function CallCard({
  call, taken, onTake, onIgnore, onPlaceOrder,
}: {
  call: TradeCall;
  taken?: "Taken" | "Ignored";
  onTake: () => void;
  onIgnore: () => void;
  onPlaceOrder: () => void;
}) {
  const m = callMetrics(call);
  const isBuy = call.side === "BUY";
  const pnlClass = classForChange(m.pnlPct);

  return (
    <div className="card">
      <div className="card-header flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="badge-muted">{call.segment}</span>
            <StatusBadge status={call.status} />
            {taken && <TakenBadge kind={taken} />}
            {typeof call.score === "number" && (
              <span className={
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide " +
                (call.score >= 80 ? "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]" :
                 call.score >= 60 ? "bg-primary/10 text-primary" :
                                    "bg-muted text-muted-foreground")
              } title={`Conviction score ${call.score}/100`}>
                {call.score}/100
              </span>
            )}
          </div>
          <div className="font-medium mt-1 truncate">{call.displayName ?? call.symbol}</div>
          <div className="text-xs text-muted-foreground">{call.id} · {call.analyst}</div>
        </div>
        <div
          className={
            "text-xs font-semibold px-2 py-1 rounded " +
            (isBuy
              ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]"
              : "bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]")
          }
        >
          {isBuy ? <ArrowUpRight className="inline h-3.5 w-3.5 mr-0.5" /> : <ArrowDownRight className="inline h-3.5 w-3.5 mr-0.5" />}
          {call.side}
        </div>
      </div>

      <div className="card-body space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Stat label="Entry"    value={call.entryLow && call.entryHigh
            ? `${formatNumber(call.entryLow)}–${formatNumber(call.entryHigh)}`
            : formatNumber(call.entry)} />
          <Stat label="Target"
            value={<span className="text-[hsl(var(--success))]">{formatNumber(call.target1)}</span>}
            icon={<TargetIcon className="h-3 w-3" />} />
          <Stat label="Stop-loss"
            value={<span className="text-[hsl(var(--danger))]">{formatNumber(call.stopLoss)}</span>}
            icon={<ShieldAlert className="h-3 w-3" />} />
        </div>

        {(call.target2 || call.target3) && (
          <div className="flex gap-2 text-xs text-muted-foreground">
            {call.target2 && <span>T2 {formatNumber(call.target2)}</span>}
            {call.target3 && <span>T3 {formatNumber(call.target3)}</span>}
          </div>
        )}

        <p className="text-muted-foreground leading-snug">{call.rationale}</p>

        <div className="border-t pt-2 grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-muted-foreground">LTP</div>
            <div className="font-medium">{formatNumber(m.refPrice)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{m.isLive ? "Unrealised" : "Outcome"}</div>
            <div className={"font-medium " + pnlClass}>{formatPct(m.pnlPct)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">R:R</div>
            <div className="font-medium">1 : {m.riskReward.toFixed(1)}</div>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {call.horizon}
          </span>
          <span>{new Date(call.issuedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
        </div>

        {call.status === "Active" && (
          <div className="flex gap-2 pt-1">
            <button className="btn-primary flex-1" onClick={onPlaceOrder}>
              <ShoppingCart className="h-3.5 w-3.5 mr-1" /> Place Order
            </button>
            {!taken && (
              <>
                <button className="btn-outline" onClick={onTake} title="Mark as taken">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button className="btn-ghost text-xs" onClick={onIgnore}>
                  Ignore
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
      <div className="text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: CallStatus }) {
  const map: Record<CallStatus, { cls: string; icon: React.ReactNode; label: string }> = {
    "Active":     { cls: "bg-primary/10 text-primary",               icon: <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />, label: "Active" },
    "Target Hit": { cls: "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]", icon: <CheckCircle2 className="h-3 w-3" />, label: "Target Hit" },
    "SL Hit":     { cls: "bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]",   icon: <XCircle className="h-3 w-3" />,      label: "SL Hit" },
    "Closed":     { cls: "bg-muted text-muted-foreground",            icon: <Check className="h-3 w-3" />,        label: "Closed" },
    "Expired":    { cls: "bg-muted text-muted-foreground",            icon: <Clock className="h-3 w-3" />,        label: "Expired" },
  };
  const m = map[status];
  return (
    <span className={"inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide " + m.cls}>
      {m.icon}{m.label}
    </span>
  );
}

function TakenBadge({ kind }: { kind: "Taken" | "Ignored" }) {
  return (
    <span className={
      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide " +
      (kind === "Taken" ? "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]" : "bg-muted text-muted-foreground")
    }>
      <Check className="h-3 w-3" />{kind}
    </span>
  );
}
