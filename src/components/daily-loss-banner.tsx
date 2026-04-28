"use client";
import { useEffect, useState } from "react";
import { AlertOctagon, Activity } from "lucide-react";

type DailyPnL = {
  enabled: boolean;
  brokerMode: string;
  pnlPct: number;
  pnlRs: number;
  realisedPnl: number;
  unrealisedPnl: number;
  thresholdPct: number;
  halted: boolean;
  reason: string;
};

export function DailyLossBanner() {
  const [d, setD] = useState<DailyPnL | null>(null);

  useEffect(() => {
    let live = true;
    const tick = () =>
      fetch("/api/broker/status").then(r => r.json()).then(j => {
        if (live && j?.dailyPnL) setD(j.dailyPnL as DailyPnL);
      }).catch(() => {});
    tick();
    const t = setInterval(tick, 30_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  if (!d || !d.enabled) return null;

  // Halted → red banner. Negative but within tolerance → soft warning. Otherwise hide.
  if (d.halted) {
    return (
      <div className="rounded-md border border-[hsl(var(--danger))]/40 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))] px-4 py-3 text-sm flex items-start gap-2">
        <AlertOctagon className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold uppercase tracking-wide text-xs">Trading halted — daily-loss limit reached</div>
          <div className="opacity-90 text-xs mt-0.5">{d.reason}</div>
        </div>
        <div className="text-right text-xs">
          <div className="opacity-70">Today P&L</div>
          <div className="font-semibold">{d.pnlPct.toFixed(2)}%</div>
        </div>
      </div>
    );
  }

  if (d.pnlPct < d.thresholdPct / 2) {
    // halfway to halt → soft warning
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-4 py-2 text-sm flex items-center gap-2">
        <Activity className="h-4 w-4 shrink-0" />
        <span className="text-xs">
          Daily P&L {d.pnlPct.toFixed(2)}% — approaching halt threshold {d.thresholdPct.toFixed(0)}%. Trade with extra discipline today.
        </span>
        <span className="ml-auto text-xs opacity-70">
          Realised ₹{d.realisedPnl.toFixed(0)} · Unrealised ₹{d.unrealisedPnl.toFixed(0)}
        </span>
      </div>
    );
  }

  return null;
}
