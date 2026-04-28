/**
 * Manual intraday squareoff trigger — emergency / deploy-near-window backup.
 *
 * The scheduler runs squareoff automatically in the 15:15–15:25 IST window, gated
 * by a date-stamp so it fires once per day. If a deploy-restart happens too close
 * to or past that window, today's run can be missed. This endpoint lets the user
 * (or AI) force-trigger the squareoff at any time, bypassing both the time window
 * and the date-stamp.
 *
 * Auth-gated. Returns the squareoff result so caller can verify.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { maybeRunIntradaySquareoff } from "@/lib/calls/intraday-squareoff";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await maybeRunIntradaySquareoff(true);
  return NextResponse.json(r);
}
