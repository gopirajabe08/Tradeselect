import { NextRequest, NextResponse } from "next/server";
import type { PlaceOrderInput } from "@/lib/broker/types";
import { placeOrderInternal } from "@/lib/broker/place-internal";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

function validate(body: any): PlaceOrderInput | string {
  if (!body || typeof body !== "object") return "invalid body";
  if (!body.symbol || typeof body.symbol !== "string") return "missing symbol (e.g. NSE:RELIANCE-EQ)";
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
    orderTag: body.orderTag ? String(body.orderTag).slice(0, 20) : undefined,
    ocoGroup: body.ocoGroup ? String(body.ocoGroup).slice(0, 32) : undefined,
  };
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const v = validate(body);
  if (typeof v === "string") return NextResponse.json({ error: v }, { status: 400 });

  const force = req.nextUrl.searchParams.get("force") === "1";
  const r = await placeOrderInternal(v, { forceOffHours: force, source: "ui" });
  if (r.ok) {
    return NextResponse.json({ ok: true, order_id: r.order_id, message: r.message, broker: r.broker, latencyMs: r.latencyMs, idempotent: r.idempotent });
  }
  return NextResponse.json({ error: r.error }, { status: r.status });
}
