"use client";
import { useBrokerStatus } from "@/lib/broker/hooks";
import { FlaskConical, AlertTriangle } from "lucide-react";

/**
 * Persistent global mode banner — sticks at the top of every (app)/* page.
 *
 * Solves the safety-critical "is this paper or live?" question without making the
 * user hunt for a small badge. Color-coded (amber for paper, red for live) so a
 * glance is enough.
 *
 * Audit 2026-05-04 found that the only mode signal was an 11px topbar pill which
 * scrolls off attention in 5 seconds. Hard-coded "(live)" titles compounded the
 * problem. This banner is the durable fix.
 */
export function ModeBanner() {
  const { status, loading } = useBrokerStatus(15_000);

  if (loading || !status) {
    return (
      <div className="bg-muted/40 border-b border-border text-muted-foreground text-xs px-4 py-1.5 text-center">
        Checking trading mode…
      </div>
    );
  }

  if (status.brokerId === "paper") {
    return (
      <div className="bg-amber-500/15 border-b border-amber-500/40 text-amber-900 dark:text-amber-200 text-xs sm:text-sm px-4 py-2 flex items-center justify-center gap-2 font-medium">
        <FlaskConical className="h-3.5 w-3.5 shrink-0" />
        <span>
          PAPER MODE — virtual cash, simulated orders.{" "}
          <span className="opacity-80">No real money at risk.</span>
        </span>
      </div>
    );
  }

  // Live mode — alarming red
  return (
    <div className="bg-red-600 text-white text-xs sm:text-sm px-4 py-2 flex items-center justify-center gap-2 font-semibold border-b border-red-700">
      <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" />
      <span>
        🔴 LIVE TRADING — REAL MONEY · {status.brokerId?.toUpperCase()}
        {status.userName ? ` · ${status.userName}` : ""}
      </span>
      <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" />
    </div>
  );
}
