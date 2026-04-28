/**
 * Manual-LIVE order placement — per-order escape hatch from paper mode.
 *
 * Why: user wants the ability to act on a high-conviction idea via real money
 * even while the global mode is paper. Auto-follow stays paper-pinned (safety);
 * this endpoint requires an explicit confirmed click in the UI for ONE specific
 * order at a time.
 *
 * Hard rules vs the regular /api/broker/place endpoint:
 *   1. ALWAYS routes to TradejiniBroker regardless of activeBroker mode
 *   2. Requires `AUTO_FOLLOW_ALLOW_LIVE=1` + `AUTO_FOLLOW_LIVE_CONFIRMED=1` env (re-uses
 *      the live-mode triple-gate; user has explicitly opted in to "live can fire")
 *   3. Tighter per-order cap: ₹MANUAL_LIVE_MAX_NOTIONAL (default ₹10k) — can't be
 *      bypassed by passing a higher notional
 *   4. Daily count cap: ₹MANUAL_LIVE_DAILY_MAX (default 3 orders/day)
 *   5. Mandatory `confirmation: "i-confirm-live"` body field — prevents accidental
 *      double-clicks and naive curl tests
 *   6. Audited as `manual-live` action; Telegram alert prefixed 🔴 LIVE
 *   7. Daily-loss + kill-switch guards still apply
 */
import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import path from "path";
import { getSession } from "@/lib/auth";
import type { PlaceOrderInput } from "@/lib/broker/types";
import { TradejiniBroker } from "@/lib/broker/tradejini";
import { appendAudit, computeNotional, readAudit } from "@/lib/broker/audit";
import { isMarketOpen } from "@/lib/calls/scheduler";
import { validateContractRules } from "@/lib/broker/contract-rules";
import { notify } from "@/lib/notify/telegram";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const MANUAL_LIVE_MAX_NOTIONAL = Number(process.env.MANUAL_LIVE_MAX_NOTIONAL ?? 10_000);
const MANUAL_LIVE_DAILY_MAX    = Number(process.env.MANUAL_LIVE_DAILY_MAX ?? 3);
const ALLOW_LIVE     = process.env.AUTO_FOLLOW_ALLOW_LIVE === "1";
const LIVE_CONFIRMED = process.env.AUTO_FOLLOW_LIVE_CONFIRMED === "1";

function killSwitchEngaged(): boolean {
  return existsSync(path.join(process.cwd(), ".local-data", "halt.flag"));
}

function validate(body: any): PlaceOrderInput | string {
  if (!body || typeof body !== "object") return "invalid body";
  if (body.confirmation !== "i-confirm-live") return "missing confirmation field — pass confirmation:'i-confirm-live' to acknowledge real-money intent";
  if (!body.symbol || typeof body.symbol !== "string") return "missing symbol";
  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty <= 0) return "invalid qty";
  const type = Number(body.type);
  if (![1,2,3,4].includes(type)) return "invalid type (1=Limit, 2=Market, 3=SL-M, 4=SL)";
  const side = Number(body.side);
  if (![1,-1].includes(side)) return "invalid side (1=Buy, -1=Sell)";
  const productType = body.productType;
  if (!["CNC","INTRADAY","MARGIN","CO","BO","MTF"].includes(productType)) return "invalid productType";
  if ((type === 1 || type === 4) && !(Number(body.limitPrice) > 0)) return "Limit / SL requires limitPrice";
  if ((type === 3 || type === 4) && !(Number(body.stopPrice) > 0)) return "SL-M / SL requires stopPrice";
  if (!body.orderTag || typeof body.orderTag !== "string") return "live order requires orderTag (idempotency)";

  return {
    symbol: String(body.symbol).toUpperCase(),
    qty,
    type: type as 1 | 2 | 3 | 4,
    side: side as 1 | -1,
    productType,
    limitPrice: body.limitPrice != null ? Number(body.limitPrice) : 0,
    stopPrice: body.stopPrice != null ? Number(body.stopPrice) : 0,
    validity: body.validity === "IOC" ? "IOC" : "DAY",
    disclosedQty: body.disclosedQty != null ? Number(body.disclosedQty) : 0,
    offlineOrder: !!body.offlineOrder,
    stopLoss: body.stopLoss != null ? Number(body.stopLoss) : 0,
    takeProfit: body.takeProfit != null ? Number(body.takeProfit) : 0,
    orderTag: String(body.orderTag).slice(0, 20),
  };
}

async function todaysManualLiveCount(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const recent = await readAudit(500);
  return recent.filter(e => e.action === "place" && e.broker === "tradejini" && e.at.startsWith(today) && (e.resultDetail as any)?.source === "manual-live").length;
}

export async function POST(req: NextRequest) {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!ALLOW_LIVE || !LIVE_CONFIRMED) {
    return NextResponse.json({
      error: "Manual live trading not authorized. Both AUTO_FOLLOW_ALLOW_LIVE=1 and AUTO_FOLLOW_LIVE_CONFIRMED=1 must be set in env. Restart service after changes.",
    }, { status: 403 });
  }

  if (killSwitchEngaged()) {
    return NextResponse.json({ error: "Order placement halted (kill-switch active)." }, { status: 503 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const v = validate(body);
  if (typeof v === "string") return NextResponse.json({ error: v }, { status: 400 });

  // Per-order notional cap
  const notional = computeNotional(v) || (v.qty * 10000);  // for MARKET, conservatively assume ₹10k/share
  if (notional > MANUAL_LIVE_MAX_NOTIONAL) {
    const msg = `Manual live order notional ₹${notional.toFixed(0)} exceeds cap ₹${MANUAL_LIVE_MAX_NOTIONAL}. Discipline gate: keep manual live trades small.`;
    await appendAudit({ at: new Date().toISOString(), broker: "tradejini", action: "place", input: v, result: "error", errorMessage: msg, resultDetail: { source: "manual-live" } });
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Daily count cap
  const todays = await todaysManualLiveCount();
  if (todays >= MANUAL_LIVE_DAILY_MAX) {
    const msg = `Daily manual-live cap reached (${todays}/${MANUAL_LIVE_DAILY_MAX}). Discipline gate: more than this in a day is overtrading.`;
    await appendAudit({ at: new Date().toISOString(), broker: "tradejini", action: "place", input: v, result: "error", errorMessage: msg, resultDetail: { source: "manual-live" } });
    return NextResponse.json({ error: msg }, { status: 429 });
  }

  // Market-hours guard (force=1 explicitly NOT supported on manual-live)
  if (!isMarketOpen()) {
    const msg = "Markets closed. Manual live orders only during NSE 09:15–15:30 IST Mon–Fri.";
    await appendAudit({ at: new Date().toISOString(), broker: "tradejini", action: "place", input: v, result: "error", errorMessage: msg, resultDetail: { source: "manual-live" } });
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Contract validation
  const ruleErrs = validateContractRules({ symbol: v.symbol, qty: v.qty, price: v.limitPrice ?? 0, isMarketOrder: v.type === 2 });
  if (ruleErrs.length > 0) {
    const msg = ruleErrs.map(e => e.message).join("; ");
    await appendAudit({ at: new Date().toISOString(), broker: "tradejini", action: "place", input: v, result: "error", errorMessage: msg, resultDetail: { source: "manual-live" } });
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // FIRE — directly through Tradejini, bypassing activeBroker mode selector
  const t0 = Date.now();
  try {
    const resp = await TradejiniBroker.placeOrder(v);
    const latencyMs = Date.now() - t0;
    await appendAudit({
      at: new Date().toISOString(),
      broker: "tradejini",
      action: "place",
      input: v,
      result: "ok",
      resultDetail: { ...resp, latencyMs, source: "manual-live", user: sess.email },
    });
    notify(`🔴 *LIVE ORDER PLACED* (manual)\n${v.side === 1 ? "BUY" : "SELL"} ${v.qty} ${v.symbol}${v.limitPrice ? ` @ ₹${v.limitPrice}` : ""}\nBroker order: \`${resp.id}\`\nUser: ${sess.email}`).catch(() => {});
    return NextResponse.json({ ok: true, order_id: resp.id, message: resp.message, broker: "tradejini", latencyMs, mode: "manual-live" });
  } catch (e) {
    const msg = (e as Error).message;
    const latencyMs = Date.now() - t0;
    await appendAudit({
      at: new Date().toISOString(),
      broker: "tradejini",
      action: "place",
      input: v,
      result: "error",
      errorMessage: msg,
      resultDetail: { latencyMs, source: "manual-live", user: sess.email },
    });
    notify(`🔴 *LIVE ORDER FAILED* (manual)\n${v.side === 1 ? "BUY" : "SELL"} ${v.qty} ${v.symbol}\n\`${msg}\``).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
