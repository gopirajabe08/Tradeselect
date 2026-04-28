import { NextResponse } from "next/server";
import { runGenerator } from "@/lib/calls/generator";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

/**
 * Manual trigger. Bypasses the market-hours guard so you can test any time.
 * Runs the scanner synchronously and returns the ideas it just created.
 */
export async function POST() {
  try {
    const result = await runGenerator();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
