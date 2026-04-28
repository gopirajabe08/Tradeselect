"use client";
import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp, TrendingDown, Activity } from "lucide-react";

type RegimeData = {
  regime?: "TRENDING-UP" | "TRENDING-DOWN" | "CHOPPY";
  breadthPct?: number;
  vix?: number;
  advances?: number;
  declines?: number;
  reasoning?: string;
  source?: string;
  error?: string;
};

const STYLE: Record<string, { cls: string; label: string; Icon: any }> = {
  "TRENDING-UP":   { cls: "border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]", label: "Trending up", Icon: TrendingUp },
  "TRENDING-DOWN": { cls: "border-[hsl(var(--danger))]/40 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]",    label: "Trending down", Icon: TrendingDown },
  "CHOPPY":        { cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",                label: "Choppy / range-bound", Icon: Activity },
};

export function RegimeBanner() {
  const [data, setData] = useState<RegimeData | null>(null);

  useEffect(() => {
    fetch("/api/market/regime").then(r => r.json()).then(setData).catch(e => setData({ error: (e as Error).message }));
    const t = setInterval(() => {
      fetch("/api/market/regime").then(r => r.json()).then(setData).catch(() => {});
    }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  if (!data) {
    return (
      <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Detecting market regime…
      </div>
    );
  }
  if (data.error || !data.regime) {
    return (
      <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Regime unavailable: {data.error ?? "no data yet"}
      </div>
    );
  }
  const s = STYLE[data.regime];
  const Icon = s.Icon;
  return (
    <div className={"rounded-md border px-4 py-3 text-sm flex flex-wrap items-start gap-3 " + s.cls}>
      <Icon className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-[280px]">
        <div className="font-semibold uppercase tracking-wide text-xs">Market regime: {s.label}</div>
        <div className="opacity-90 text-xs mt-0.5">{data.reasoning}</div>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <Stat label="Breadth"    value={data.breadthPct != null ? `${data.breadthPct.toFixed(0)}%` : "—"} />
        <Stat label="VIX"        value={data.vix != null ? data.vix.toFixed(1) : "—"} />
        <Stat label="Adv / Dec"  value={`${data.advances ?? 0} / ${data.declines ?? 0}`} icon={
          (data.advances ?? 0) > (data.declines ?? 0)
            ? <ArrowUpRight className="h-3 w-3" />
            : (data.advances ?? 0) < (data.declines ?? 0)
            ? <ArrowDownRight className="h-3 w-3" />
            : <Minus className="h-3 w-3" />
        } />
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="opacity-70 text-[10px] uppercase tracking-wide">{label}</span>
      <span className="font-semibold inline-flex items-center gap-0.5">{icon}{value}</span>
    </div>
  );
}
