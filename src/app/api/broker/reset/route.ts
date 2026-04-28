import { NextRequest, NextResponse } from "next/server";
import { readMode } from "@/lib/broker/mode";
import { resetState } from "@/lib/broker/paper/store";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST(req: NextRequest) {
  const mode = await readMode();
  if (mode !== "paper") {
    return NextResponse.json({ error: `Reset only available in paper mode (current: ${mode})` }, { status: 400 });
  }
  let startingCash = Number(process.env.PAPER_STARTING_CASH ?? 1_000_000);
  try {
    const body = await req.json();
    if (body?.startingCash && Number(body.startingCash) > 0) startingCash = Number(body.startingCash);
  } catch {}
  const s = await resetState(startingCash);
  return NextResponse.json({ ok: true, cash: s.cash, startingCash: s.startingCash });
}
