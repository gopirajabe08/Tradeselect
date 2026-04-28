import { NextRequest, NextResponse } from "next/server";
import { runBacktest } from "@/lib/calls/backtest";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";
// Backtest can take 10-30 seconds for ~50 symbols × 60 bars
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const range = body?.range ?? "3mo";
  const holdDays = body?.holdDays ?? 10;
  const applyRegimeFilter = body?.applyRegimeFilter ?? true;
  const assumedVix = body?.assumedVix ?? 18;
  try {
    const result = await runBacktest({ range, holdDays, applyRegimeFilter, assumedVix });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
