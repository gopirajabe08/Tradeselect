import { NextRequest, NextResponse } from "next/server";
import { addCall, readCalls, validateNewCall } from "@/lib/calls/store";
import { awaitCallMatch, invalidateCallMatcher, triggerCallMatcher } from "@/lib/calls/matcher";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  triggerCallMatcher();
  const calls = await readCalls();
  return NextResponse.json({ calls });
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const v = validateNewCall(body);
  if (typeof v === "string") return NextResponse.json({ error: v }, { status: 400 });
  const call = await addCall(v);
  // Immediately evaluate the new call against live NSE — if target / SL already crossed, status flips before we return.
  invalidateCallMatcher();
  await awaitCallMatch();
  const all = await readCalls();
  const refreshed = all.find(c => c.id === call.id) ?? call;
  return NextResponse.json({ ok: true, call: refreshed });
}
