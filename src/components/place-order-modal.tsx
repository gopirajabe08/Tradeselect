"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, FlaskConical, Loader2, ShieldCheck, X, Zap } from "lucide-react";
import type { TradeCall } from "@/lib/mock/seed";
import { formatINR } from "@/lib/utils";
import { ORDER_TYPE_LABEL } from "@/lib/broker/labels";
import { useBrokerStatus } from "@/lib/broker/hooks";

type Product  = "CNC" | "INTRADAY" | "MARGIN" | "CO" | "BO" | "MTF";
type OrderType = 1 | 2 | 3 | 4; // 1 LIMIT, 2 MARKET, 3 SL-M, 4 SL
type Side = 1 | -1;

export type OrderPrefill = {
  symbol: string;      // Fyers fully-qualified: "NSE:RELIANCE-EQ"
  qty: number;
  type: OrderType;
  side: Side;
  productType: Product;
  limitPrice?: number;
  stopPrice?: number;
  validity?: "DAY" | "IOC";
  orderTag?: string;
};

/** Map an AlphaPad call to a Fyers order payload with sensible defaults. */
export function prefillFromCall(c: TradeCall): OrderPrefill {
  const isFno  = c.segment === "Futures" || c.segment === "Options";
  const isMcx  = c.segment === "MCX";
  const isIntra = c.segment === "Intraday" || c.segment === "BTST";

  // Best-effort Fyers tradingsymbol. User should confirm/edit for F&O/MCX.
  let symbol = "";
  if (isMcx) {
    // MCX format: "MCX:CRUDEOIL24MAYFUT" (month + year not in seed).
    symbol = `MCX:${(c.displayName ?? c.symbol).replace(/\s+/g, "")}`;
  } else if (isFno) {
    // NFO format: "NFO:NIFTY24APR24500CE" or "NSE:NIFTY24APRFUT" (depends; user to verify).
    symbol = `NFO:${(c.displayName ?? c.symbol).replace(/\s+/g, "")}`;
  } else {
    symbol = `NSE:${c.symbol}-EQ`;
  }

  const product: Product = isFno || isMcx ? "MARGIN" : isIntra ? "INTRADAY" : "CNC";

  return {
    symbol,
    qty: 1,
    type: 1, // LIMIT
    side: c.side === "BUY" ? 1 : -1,
    productType: product,
    limitPrice: c.entry,
    stopPrice: 0,
    validity: "DAY",
    orderTag: c.id.slice(0, 20),
  };
}

export function PlaceOrderModal({
  open, onClose, prefill, calledFrom,
}: {
  open: boolean;
  onClose: () => void;
  prefill: OrderPrefill;
  calledFrom?: string;
}) {
  const { status: brokerStatus } = useBrokerStatus(30_000);
  const [form, setForm]   = useState<OrderPrefill>(prefill);
  const [confirmArmed, setConfirmArmed] = useState(false);   // second-confirm for large orders
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ order_id: string } | null>(null);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const [sizing, setSizing] = useState<{ recommendedQty: number; maxLossRs: number; slDistance: number; lotSize: number | null; reason?: string } | null>(null);
  const [riskCfg, setRiskCfg] = useState<{ accountSize: number; riskPct: number }>({ accountSize: 500_000, riskPct: 1 });

  useEffect(() => {
    if (!open) return;
    fetch("/api/market/status").then(r => r.json()).then(j => setMarketOpen(!!j.open)).catch(() => setMarketOpen(null));
    fetch("/api/risk").then(r => r.json()).then(j => j?.config && setRiskCfg(j.config)).catch(() => {});
  }, [open]);

  // Recompute sizing whenever symbol / price / SL change.
  useEffect(() => {
    if (!open) return;
    const slFromCall = (prefill as any).stopLoss ?? undefined;
    const entry = form.limitPrice ?? 0;
    const sl = slFromCall && entry > 0 ? slFromCall : undefined;
    if (!entry || !sl) { setSizing(null); return; }
    const qs = new URLSearchParams({
      symbol: form.symbol,
      entry: String(entry),
      stopLoss: String(sl),
      accountSize: String(riskCfg.accountSize),
      riskPct: String(riskCfg.riskPct),
    });
    fetch(`/api/risk?${qs.toString()}`).then(r => r.json()).then(j => {
      if (j?.sizing) setSizing(j.sizing);
    }).catch(() => setSizing(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.symbol, form.limitPrice, riskCfg.accountSize, riskCfg.riskPct]);

  useEffect(() => {
    if (open) { setForm(prefill); setError(null); setResult(null); setConfirmArmed(false); }
  }, [open, prefill]);

  const approxValue = useMemo(() => {
    const px = form.type === 2 ? 0 : (form.limitPrice ?? 0);
    return px > 0 ? px * form.qty : 0;
  }, [form]);

  const isLive  = brokerStatus?.brokerId === "fyers" || brokerStatus?.brokerId === "tradejini";
  const isLarge = approxValue > 50_000;                        // second-confirm threshold

  if (!open) return null;

  async function submit() {
    if (!form.qty || form.qty <= 0) { setError("Quantity must be > 0"); return; }
    if ((form.type === 1 || form.type === 4) && !(form.limitPrice && form.limitPrice > 0)) {
      setError("LIMIT / SL require a limit price"); return;
    }
    if ((form.type === 3 || form.type === 4) && !(form.stopPrice && form.stopPrice > 0)) {
      setError("SL-M / SL require a stop (trigger) price"); return;
    }
    // Second-confirm guard for large live orders
    if (isLive && isLarge && !confirmArmed) {
      setConfirmArmed(true);
      setError(`Notional ₹${approxValue.toLocaleString("en-IN")} is above the ₹50,000 warning threshold. Click the button again to confirm.`);
      return;
    }
    setSubmitting(true); setError(null);
    try {
      const r = await fetch("/api/broker/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) { setError(j?.error ?? `HTTP ${r.status}`); setConfirmArmed(false); return; }
      setResult({ order_id: j.order_id });
    } catch (e) {
      setError((e as Error).message);
      setConfirmArmed(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-xl" onClick={e => e.stopPropagation()}>
        <div className="card-header flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium">
            {isLive
              ? <Zap className="h-4 w-4 text-[hsl(var(--danger))]" />
              : <FlaskConical className="h-4 w-4 text-primary" />}
            Place {isLive ? "REAL" : "paper"} order
            <span className="text-xs badge-muted">{brokerStatus?.brokerId ?? "?"}</span>
            {calledFrom && <span className="badge-muted text-[10px]">{calledFrom}</span>}
          </div>
          <button className="btn-ghost" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>

        {/* Live-mode warning banner */}
        {isLive && !result && (
          <div className="mx-4 mt-3 rounded-md border border-[hsl(var(--danger))]/40 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))] px-3 py-2 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold uppercase tracking-wide">Live mode — real money</div>
              <div className="opacity-90">This order will go to your actual {brokerStatus?.brokerId} account.</div>
            </div>
          </div>
        )}

        {/* Market-closed banner */}
        {marketOpen === false && !result && (
          <div className="mx-4 mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold uppercase tracking-wide">Market closed</div>
              <div className="opacity-90">NSE trades 09:15–15:30 IST Mon–Fri. Orders placed now will be rejected. Wait for market open.</div>
            </div>
          </div>
        )}

        {result ? (
          <div className="card-body space-y-3 text-sm">
            <div className="rounded-md border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] p-3">
              Order submitted to {brokerStatus?.brokerId ?? "broker"}.
              <div className="text-xs opacity-80 mt-1">Order ID: <code>{result.order_id}</code></div>
            </div>
            <p className="text-xs text-muted-foreground">Broker accepts / rejects / fills asynchronously. Track it in the Orderbook.</p>
            <div className="flex gap-2">
              <a className="btn-outline" href="/orderbook">Open Orderbook</a>
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <div className="card-body space-y-3 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className="col-span-2 md:col-span-3">
                <Field label="Symbol (Fyers tradingsymbol)">
                  <input className="input" value={form.symbol}
                    onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))} />
                </Field>
                <div className="text-[10px] text-muted-foreground mt-1">
                  Format: <code>NSE:RELIANCE-EQ</code>, <code>NSE:NIFTY25APRFUT</code>, <code>NFO:NIFTY2442924500CE</code>, <code>MCX:CRUDEOIL25MAYFUT</code>
                </div>
              </div>
              <Field label="Product">
                <select className="input" value={form.productType}
                  onChange={e => setForm(f => ({ ...f, productType: e.target.value as Product }))}>
                  {["CNC","INTRADAY","MARGIN","CO","BO","MTF"].map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </Field>
              <Field label="Side">
                <div className="grid grid-cols-2 gap-1">
                  {([1,-1] as Side[]).map(s => (
                    <button key={s} className={
                      "btn " + (form.side === s
                        ? (s === 1 ? "bg-[hsl(var(--success))] text-white" : "bg-[hsl(var(--danger))] text-white")
                        : "btn-outline")
                    } onClick={() => setForm(f => ({ ...f, side: s }))}>{s === 1 ? "BUY" : "SELL"}</button>
                  ))}
                </div>
              </Field>
              <Field label="Order type">
                <select className="input" value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: Number(e.target.value) as OrderType }))}>
                  {([1,2,3,4] as OrderType[]).map(t => <option key={t} value={t}>{ORDER_TYPE_LABEL[t]}</option>)}
                </select>
              </Field>
              <Field label="Quantity">
                <input className="input" type="number" min={1} value={form.qty}
                  onChange={e => setForm(f => ({ ...f, qty: Number(e.target.value) }))} />
              </Field>
              {(form.type === 1 || form.type === 4) && (
                <Field label="Limit price">
                  <input className="input" type="number" step="0.05" value={form.limitPrice ?? ""}
                    onChange={e => setForm(f => ({ ...f, limitPrice: Number(e.target.value) }))} />
                </Field>
              )}
              {(form.type === 3 || form.type === 4) && (
                <Field label="Stop / trigger price">
                  <input className="input" type="number" step="0.05" value={form.stopPrice ?? ""}
                    onChange={e => setForm(f => ({ ...f, stopPrice: Number(e.target.value) }))} />
                </Field>
              )}
              <Field label="Validity">
                <select className="input" value={form.validity ?? "DAY"}
                  onChange={e => setForm(f => ({ ...f, validity: e.target.value as "DAY" | "IOC" }))}>
                  <option value="DAY">DAY</option>
                  <option value="IOC">IOC</option>
                </select>
              </Field>
            </div>

            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
              <div className="flex justify-between">
                <span>Side</span>
                <span className={form.side === 1 ? "text-[hsl(var(--success))]" : "text-[hsl(var(--danger))]"}>
                  {form.side === 1 ? "BUY" : "SELL"}
                </span>
              </div>
              <div className={"flex justify-between " + (isLarge ? "text-amber-600 font-semibold" : "")}>
                <span>Notional</span>
                <span>{approxValue > 0 ? formatINR(approxValue) : "—"}{isLarge ? "  ⚠ large" : ""}</span>
              </div>
              <div className="flex justify-between"><span>Product · Type</span><span>{form.productType} · {ORDER_TYPE_LABEL[form.type]}</span></div>
            </div>

            {/* Position sizing recommendation */}
            {sizing && (
              <div className="rounded-md border bg-primary/5 px-3 py-2 text-xs space-y-0.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-primary">Suggested size</span>
                  <span className="text-muted-foreground">
                    Risk {riskCfg.riskPct}% × ₹{riskCfg.accountSize.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max loss if SL hits</span>
                  <span>{formatINR(sizing.maxLossRs)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SL distance / share</span>
                  <span>{formatINR(sizing.slDistance)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-foreground">Recommended qty</span>
                  <span className="flex items-center gap-2">
                    {sizing.recommendedQty > 0 ? `${sizing.recommendedQty} ${sizing.lotSize ? `(${Math.floor(sizing.recommendedQty / sizing.lotSize)} lot${sizing.recommendedQty / sizing.lotSize > 1 ? "s" : ""})` : "shares"}` : "—"}
                    {sizing.recommendedQty > 0 && sizing.recommendedQty !== form.qty && (
                      <button
                        type="button"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground"
                        onClick={() => setForm(f => ({ ...f, qty: sizing.recommendedQty }))}
                      >
                        Apply
                      </button>
                    )}
                  </span>
                </div>
                {sizing.reason && (
                  <div className="text-amber-600 text-[10px] pt-0.5">{sizing.reason}</div>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))] p-2 text-xs flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /><span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {isLive
                  ? <><AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--danger))]" /> Real order on your {brokerStatus?.brokerId} account.</>
                  : <><FlaskConical className="h-3.5 w-3.5 text-primary" /> Simulated fill against live NSE prices.</>}
              </span>
              {isLive && brokerStatus?.brokerId === "fyers" && (
                <a href="https://trade.fyers.in/" target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 text-primary hover:underline">
                  Fyers web <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button className="btn-outline" onClick={onClose} disabled={submitting}>Cancel</button>
              <button className={form.side === 1 ? "btn-success" : "btn-danger"} onClick={submit} disabled={submitting || marketOpen === false}>
                {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                {marketOpen === false ? "Market closed" : (confirmArmed ? "CONFIRM " : "") + `Place ${form.side === 1 ? "buy" : "sell"} order`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs block">
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
