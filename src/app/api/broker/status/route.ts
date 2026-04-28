import { NextResponse } from "next/server";
import { readMode } from "@/lib/broker/mode";
import { isLikelyExpired, readBrokerSession } from "@/lib/broker/session";
import { readState } from "@/lib/broker/paper/store";
import { readDailyPnL } from "@/lib/risk/daily-loss";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  const mode = await readMode();
  const fyersSession     = await readBrokerSession("fyers");
  const tradejiniSession = await readBrokerSession("tradejini");
  const paperState       = await readState();

  const brokers = {
    paper: {
      connected: true,
      userName: "Paper Trader",
      cash: paperState.cash,
      startingCash: paperState.startingCash,
      openOrders: paperState.orders.filter(o => o.status === 6 || o.status === 4).length,
      positions: paperState.positions.filter(p => p.netQty !== 0).length,
      holdings: paperState.holdings.length,
      totalCosts: paperState.totalCosts ?? 0,
    },
    fyers: fyersSession ? {
      connected: true,
      hasCreds: !!(process.env.FYERS_APP_ID && process.env.FYERS_SECRET_KEY),
      userId: fyersSession.userId,
      userName: fyersSession.userName,
      email: fyersSession.email,
      issuedAt: fyersSession.issuedAt,
      expired: isLikelyExpired(fyersSession),
    } : {
      connected: false,
      hasCreds: !!(process.env.FYERS_APP_ID && process.env.FYERS_SECRET_KEY),
    },
    tradejini: tradejiniSession ? {
      connected: true,
      hasCreds: !!(process.env.TRADEJINI_API_KEY && process.env.TRADEJINI_CLIENT_ID && process.env.TRADEJINI_PIN && process.env.TRADEJINI_TOTP_SECRET),
      userId: tradejiniSession.userId,
      userName: tradejiniSession.userName,
      email: tradejiniSession.email,
      issuedAt: tradejiniSession.issuedAt,
      expired: isLikelyExpired(tradejiniSession),
    } : {
      connected: false,
      hasCreds: !!(process.env.TRADEJINI_API_KEY && process.env.TRADEJINI_CLIENT_ID && process.env.TRADEJINI_PIN && process.env.TRADEJINI_TOTP_SECRET),
    },
  };

  const active = brokers[mode];
  const dailyPnL = await readDailyPnL(mode);
  return NextResponse.json({
    mode,
    brokerId: mode,
    dailyPnL,           // { halted, pnlPct, thresholdPct, reason, ... }
    ...("userName" in active ? { userName: active.userName } : {}),
    connected: active.connected,
    // legacy flat keys for old UI code
    hasCreds: "hasCreds" in active ? active.hasCreds : true,
    expired:  "expired"  in active ? active.expired  : false,
    userId:   "userId"   in active ? active.userId   : "",
    email:    "email"    in active ? active.email    : undefined,
    issuedAt: "issuedAt" in active ? active.issuedAt : undefined,
    cash:     "cash"     in active ? active.cash     : undefined,
    startingCash: "startingCash" in active ? active.startingCash : undefined,
    openOrders:   "openOrders"   in active ? active.openOrders   : undefined,
    positions:    "positions"    in active ? active.positions    : undefined,
    holdings:     "holdings"     in active ? active.holdings     : undefined,
    // per-broker block for the tabbed UI
    brokers,
  });
}
