"use client";
import Link from "next/link";
import { useBrokerStatus } from "@/lib/broker/hooks";
import { Plug, CheckCircle2, CircleAlert, FlaskConical } from "lucide-react";

export function BrokerStatusBadge() {
  const { status, loading } = useBrokerStatus(15_000);
  if (loading || !status) {
    return (
      <Link href="/broker" className="text-xs inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-muted-foreground">
        <Plug className="h-3 w-3" /> Broker
      </Link>
    );
  }
  if (status.brokerId === "paper") {
    return (
      <Link href="/broker" className="text-xs inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-primary/30 text-primary bg-primary/10" title="Paper trading mode">
        <FlaskConical className="h-3 w-3" /> Paper
      </Link>
    );
  }
  if (!status.hasCreds) {
    return (
      <Link href="/broker" className="text-xs inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-[hsl(var(--danger))]/30 text-[hsl(var(--danger))] bg-[hsl(var(--danger))]/10">
        <CircleAlert className="h-3 w-3" /> Setup Fyers
      </Link>
    );
  }
  if (status.connected && !status.expired) {
    // LIVE mode: alarming red, NOT success-green. The user must immediately register
    // that real money is in play. Audit 2026-05-04: success-green made live look safe.
    return (
      <Link href="/broker" className="text-xs inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-red-600 text-white bg-red-600 font-semibold animate-pulse" title={`LIVE — real money — connected as ${status.userName ?? ""}`}>
        <CheckCircle2 className="h-3 w-3" /> LIVE · {status.brokerId?.toUpperCase()}
      </Link>
    );
  }
  if (status.connected && status.expired) {
    return (
      <Link href="/broker" className="text-xs inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-amber-500/30 text-amber-600 bg-amber-500/10">
        <CircleAlert className="h-3 w-3" /> Re-auth Fyers
      </Link>
    );
  }
  return (
    <Link href="/broker" className="text-xs inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-muted-foreground hover:text-foreground">
      <Plug className="h-3 w-3" /> Connect Fyers
    </Link>
  );
}
