import { NextResponse } from "next/server";
import { fetchUniverse, fetchMarketIndices } from "@/lib/calls/universe";
import { classifyRegime } from "@/lib/calls/regime";
import { readLastRegime } from "@/lib/calls/generator";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  // Prefer the cached reading from the last generator run (cheap).
  const cached = await readLastRegime();
  if (cached) return NextResponse.json({ ...cached, source: "cached" });

  // Cold path: compute fresh from a single Nifty 500 fetch + indices call.
  try {
    const [snapshots, indices] = await Promise.all([fetchUniverse(), fetchMarketIndices()]);
    if (snapshots.length === 0) {
      return NextResponse.json({ error: "Universe data unavailable (NSE down or rate-limited)" }, { status: 502 });
    }
    const reading = classifyRegime(snapshots, indices.vix ?? 16);
    return NextResponse.json({ ...reading, source: "fresh" });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
