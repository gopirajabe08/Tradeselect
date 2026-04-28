import { NextRequest, NextResponse } from "next/server";
import { readMode, writeMode } from "@/lib/broker/mode";
import type { BrokerId } from "@/lib/broker/adapter";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  return NextResponse.json({ mode: await readMode() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const mode = body?.mode as BrokerId;
  if (mode !== "paper" && mode !== "fyers" && mode !== "tradejini") {
    return NextResponse.json({ error: "invalid mode" }, { status: 400 });
  }
  // Safety gate: env BROKER pins the mode in production. Block UI flips that
  // would cross the paper→live boundary unless the env explicitly allows it.
  // To go live: edit .env.local on the server (BROKER=tradejini) and restart.
  const envBroker = process.env.BROKER as BrokerId | undefined;
  if (envBroker && envBroker !== "paper" && mode !== envBroker) {
    return NextResponse.json({
      error: `BROKER=${envBroker} pinned via server env. Mode-flip blocked. To change: edit /opt/ts-app/.env.local + restart service.`,
    }, { status: 403 });
  }
  if (envBroker === "paper" && mode !== "paper") {
    return NextResponse.json({
      error: `BROKER=paper pinned via server env. Switching to '${mode}' requires editing /opt/ts-app/.env.local + restarting service. This is a deliberate safety gate before live trading.`,
    }, { status: 403 });
  }
  await writeMode(mode);
  return NextResponse.json({ ok: true, mode });
}
