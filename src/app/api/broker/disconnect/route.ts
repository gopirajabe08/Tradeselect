import { NextRequest, NextResponse } from "next/server";
import { clearBrokerSession } from "@/lib/broker/session";
import type { BrokerId } from "@/lib/broker/adapter";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const broker = (body?.broker as BrokerId) ?? "fyers";
  if (broker !== "fyers" && broker !== "tradejini") {
    return NextResponse.json({ error: "invalid broker — paper has no session to disconnect" }, { status: 400 });
  }
  await clearBrokerSession(broker);
  return NextResponse.json({ ok: true, broker });
}
