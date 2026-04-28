import { NextRequest, NextResponse } from "next/server";
import { getLoginUrl } from "@/lib/broker/fyers";
import type { BrokerId } from "@/lib/broker/adapter";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(req: NextRequest) {
  const broker = (req.nextUrl.searchParams.get("broker") as BrokerId) ?? "fyers";
  const fb = new URL("/broker", req.nextUrl.origin);
  try {
    if (broker === "fyers") return NextResponse.redirect(getLoginUrl());
    if (broker === "tradejini") {
      // Individual-mode TradeJini is headless TOTP — no OAuth redirect.
      // The session is created on first API call via the adapter's lazy login.
      fb.searchParams.set("broker_error", "TradeJini Individual mode connects automatically on first call (no OAuth login flow needed). Set BROKER=tradejini in server .env to activate.");
      return NextResponse.redirect(fb);
    }
    fb.searchParams.set("broker_error", `No OAuth flow for broker=${broker}`);
    return NextResponse.redirect(fb);
  } catch (e) {
    fb.searchParams.set("broker_error", (e as Error).message);
    return NextResponse.redirect(fb);
  }
}
