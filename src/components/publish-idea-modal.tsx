"use client";
import { useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";

type Segment = "Equity" | "Intraday" | "Swing" | "BTST" | "Positional" | "Futures" | "Options" | "MCX";

const SEGMENTS: Segment[] = ["Equity","Intraday","Swing","BTST","Positional","Futures","Options","MCX"];
const HORIZON_HINT: Record<Segment, string> = {
  "Equity":     "e.g. 2–4 weeks",
  "Intraday":   "Intraday",
  "Swing":      "e.g. 1–2 weeks",
  "BTST":       "Next session",
  "Positional": "e.g. 2–3 months",
  "Futures":    "e.g. This week",
  "Options":    "e.g. 2–3 days",
  "MCX":        "e.g. 1–2 days",
};
const ANALYST_SUGGESTIONS = ["Aditi Rao", "Rahul Shetty", "Kunal Mehta", "Priya Nair"];

export function PublishIdeaModal({
  open, onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    segment: "Equity" as Segment,
    symbol: "",
    side: "BUY" as "BUY" | "SELL",
    entry: "" as string,
    target1: "" as string,
    target2: "" as string,
    stopLoss: "" as string,
    horizon: "2–4 weeks",
    analyst: "",
    rationale: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string } | null>(null);

  if (!open) return null;

  // Auto-fill horizon placeholder when segment changes
  function setSegment(s: Segment) {
    setF(prev => ({ ...prev, segment: s, horizon: HORIZON_HINT[s] }));
  }

  function reset() {
    setF({
      segment: "Equity", symbol: "", side: "BUY",
      entry: "", target1: "", target2: "", stopLoss: "",
      horizon: "2–4 weeks", analyst: "", rationale: "",
    });
    setError(null); setResult(null);
  }

  async function submit() {
    setError(null);
    const required = ["symbol","entry","target1","stopLoss","horizon","analyst","rationale"];
    for (const k of required) {
      if (!(f as any)[k] || String((f as any)[k]).trim() === "") {
        setError(`Missing: ${k}`); return;
      }
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: f.segment,
          symbol: f.symbol,
          side: f.side,
          entry: Number(f.entry),
          target1: Number(f.target1),
          target2: f.target2 ? Number(f.target2) : undefined,
          stopLoss: Number(f.stopLoss),
          horizon: f.horizon,
          analyst: f.analyst,
          rationale: f.rationale,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j?.error ?? `HTTP ${r.status}`); return; }
      setResult({ id: j.call.id });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const entry = Number(f.entry), t1 = Number(f.target1), sl = Number(f.stopLoss);
  const showRR = Number.isFinite(entry) && Number.isFinite(t1) && Number.isFinite(sl) && entry > 0;
  const rewardPct = showRR ? ((f.side === "BUY" ? (t1 - entry) : (entry - t1)) / entry) * 100 : 0;
  const riskPct   = showRR ? ((f.side === "BUY" ? (entry - sl) : (sl - entry)) / entry) * 100 : 0;
  const rr = showRR && riskPct > 0 ? rewardPct / riskPct : 0;
  const directionOK = showRR &&
    ((f.side === "BUY"  && t1 > entry && sl < entry) ||
     (f.side === "SELL" && t1 < entry && sl > entry));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-2xl" onClick={e => e.stopPropagation()}>
        <div className="card-header flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4 text-primary" /> Publish new trade idea
          </div>
          <button className="btn-ghost" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>

        {result ? (
          <div className="card-body space-y-3 text-sm">
            <div className="rounded-md border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] p-3">
              Idea published as <code>{result.id}</code>.
            </div>
            <p className="text-xs text-muted-foreground">
              The auto-matcher will compare live NSE price against your target / SL and transition the status
              when thresholds are crossed (equity segments only).
            </p>
            <div className="flex gap-2">
              <button className="btn-outline" onClick={() => { reset(); }}>Publish another</button>
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <div className="card-body space-y-3 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Field label="Segment">
                <select className="input" value={f.segment} onChange={e => setSegment(e.target.value as Segment)}>
                  {SEGMENTS.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Side">
                <div className="grid grid-cols-2 gap-1">
                  {(["BUY","SELL"] as const).map(s => (
                    <button key={s} className={
                      "btn " + (f.side === s
                        ? (s === "BUY" ? "bg-[hsl(var(--success))] text-white" : "bg-[hsl(var(--danger))] text-white")
                        : "btn-outline")
                    } onClick={() => setF(prev => ({ ...prev, side: s }))}>{s}</button>
                  ))}
                </div>
              </Field>
              <Field label="Symbol">
                <input className="input" placeholder="e.g. RELIANCE" value={f.symbol}
                  onChange={e => setF(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))} />
              </Field>
              <Field label="Analyst">
                <input className="input" list="ts-analyst-list" placeholder="e.g. Aditi Rao" value={f.analyst}
                  onChange={e => setF(prev => ({ ...prev, analyst: e.target.value }))} />
                <datalist id="ts-analyst-list">
                  {ANALYST_SUGGESTIONS.map(a => <option key={a} value={a} />)}
                </datalist>
              </Field>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Field label="Entry">
                <input className="input" type="number" step="0.05" value={f.entry}
                  onChange={e => setF(prev => ({ ...prev, entry: e.target.value }))} />
              </Field>
              <Field label="Target 1">
                <input className="input" type="number" step="0.05" value={f.target1}
                  onChange={e => setF(prev => ({ ...prev, target1: e.target.value }))} />
              </Field>
              <Field label="Target 2 (optional)">
                <input className="input" type="number" step="0.05" value={f.target2}
                  onChange={e => setF(prev => ({ ...prev, target2: e.target.value }))} />
              </Field>
              <Field label="Stop-loss">
                <input className="input" type="number" step="0.05" value={f.stopLoss}
                  onChange={e => setF(prev => ({ ...prev, stopLoss: e.target.value }))} />
              </Field>
            </div>

            <Field label="Horizon">
              <input className="input" value={f.horizon}
                placeholder={HORIZON_HINT[f.segment]}
                onChange={e => setF(prev => ({ ...prev, horizon: e.target.value }))} />
            </Field>

            <Field label="Rationale (public on the idea card)">
              <textarea className="input min-h-[80px]" placeholder="Why this trade? 1-3 sentences."
                value={f.rationale}
                onChange={e => setF(prev => ({ ...prev, rationale: e.target.value }))} />
            </Field>

            {/* R:R preview */}
            {showRR && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reward (to T1)</span>
                  <span className="text-[hsl(var(--success))]">+{rewardPct.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Risk (to SL)</span>
                  <span className="text-[hsl(var(--danger))]">−{riskPct.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>R:R</span>
                  <span className={rr >= 1.5 ? "text-[hsl(var(--success))]" : rr >= 1 ? "text-foreground" : "text-[hsl(var(--danger))]"}>
                    1 : {rr.toFixed(2)}
                  </span>
                </div>
                {!directionOK && (
                  <div className="text-[hsl(var(--danger))] pt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {f.side === "BUY"
                      ? "BUY requires target > entry and SL < entry"
                      : "SELL requires target < entry and SL > entry"}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))] p-2 text-xs flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5" /><span>{error}</span>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Once published, the idea appears on Trade Ideas and Dashboard. Auto-matcher will transition it to
              Target Hit or SL Hit when NSE price crosses your thresholds (Equity / Intraday / Swing / BTST / Positional only).
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button className="btn-outline" onClick={onClose} disabled={submitting}>Cancel</button>
              <button className="btn-primary" onClick={submit} disabled={submitting || !directionOK}>
                {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Publish idea
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="text-xs block">
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
