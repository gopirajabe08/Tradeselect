import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { maybeSendMorningBriefing, maybeSendMiddayBriefing, maybeSendEodBriefing, maybeSendWeeklyDigest } from "@/lib/calls/daily-briefing";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const morning = await maybeSendMorningBriefing(true);
  const midday = await maybeSendMiddayBriefing(true);
  const eod = await maybeSendEodBriefing(true);
  const weekly = await maybeSendWeeklyDigest(true);
  return NextResponse.json({ morning, midday, eod, weekly });
}
