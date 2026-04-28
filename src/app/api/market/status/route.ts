import { NextResponse } from "next/server";
import { isMarketOpen } from "@/lib/calls/scheduler";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

function istNow() {
  return new Date(Date.now() + 5.5 * 3600 * 1000);
}

function nextOpenLabel(): string {
  const ist = istNow();
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (day >= 1 && day <= 5 && mins < (9 * 60 + 15)) return "today 09:15 IST";
  if (day === 5 && mins > (15 * 60 + 30))           return "Monday 09:15 IST";
  if (day === 6)                                    return "Monday 09:15 IST";
  if (day === 0)                                    return "Monday 09:15 IST";
  return "next trading session";
}

export async function GET() {
  const open = isMarketOpen();
  const ist  = istNow();
  return NextResponse.json({
    open,
    nowIST: ist.toISOString().replace("Z", ""),
    session: "NSE cash",
    hours: "09:15–15:30 IST Mon–Fri",
    nextOpen: open ? null : nextOpenLabel(),
  });
}
