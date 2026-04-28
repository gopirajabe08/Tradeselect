import { NextRequest, NextResponse } from "next/server";
import { FyersBroker, validateAuthCode } from "@/lib/broker/fyers";
import { writeBrokerSession } from "@/lib/broker/session";
import type { BrokerId } from "@/lib/broker/adapter";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

/**
 * OAuth callback handler. Routes to the right broker based on the `broker` query param
 * (Tradejini sends it) or `auth_code`+`s` (Fyers pattern).
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const broker = (p.get("broker") as BrokerId) ?? "fyers";
  const back = new URL("/broker", req.nextUrl.origin);
  back.searchParams.set("broker_tab", broker);

  try {
    if (broker === "tradejini") {
      // TradeJini Individual mode is headless TOTP — no OAuth callback path.
      // (The "Apps" mode path that used this callback is no longer supported here.)
      back.searchParams.set("broker_error", "Tradejini Individual mode uses headless TOTP login — no OAuth callback. Connect via /broker page.");
      return NextResponse.redirect(back);
    }

    // Fyers default
    const authCode  = p.get("auth_code");
    const s         = p.get("s");
    const errorDesc = p.get("error_description") ?? p.get("error") ?? p.get("message");
    if (!authCode || (s && s !== "ok")) {
      back.searchParams.set("broker_error", errorDesc ?? `Fyers OAuth did not succeed (s=${s})`);
      return NextResponse.redirect(back);
    }
    const appId  = process.env.FYERS_APP_ID!;
    const tokens = await validateAuthCode(authCode);
    await writeBrokerSession("fyers", {
      brokerId: "fyers", appId,
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      userId: "", userName: "", issuedAt: Date.now(),
    });
    try {
      const prof = await FyersBroker.getProfile();
      await writeBrokerSession("fyers", {
        brokerId: "fyers", appId,
        accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
        userId: (prof as any).fy_id ?? "", userName: (prof as any).name ?? (prof as any).display_name ?? "",
        email: (prof as any).email_id, issuedAt: Date.now(),
      });
    } catch { /* best effort */ }
    back.searchParams.set("broker_connected", "fyers");
    return NextResponse.redirect(back);
  } catch (e) {
    back.searchParams.set("broker_error", (e as Error).message);
    return NextResponse.redirect(back);
  }
}
