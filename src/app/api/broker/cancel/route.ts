import { NextRequest, NextResponse } from "next/server";
import { activeBroker, BrokerNotConnectedError } from "@/lib/broker";
import { appendAudit } from "@/lib/broker/audit";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const orderId = body?.order_id as string;
  if (!orderId) return NextResponse.json({ error: "missing order_id" }, { status: 400 });

  const broker = await activeBroker();
  try {
    const resp = await broker.cancelOrder(orderId);
    await appendAudit({ at: new Date().toISOString(), broker: broker.id, action: "cancel", input: { order_id: orderId }, result: "ok", resultDetail: resp });
    return NextResponse.json({ ok: true, order_id: resp.id, broker: broker.id });
  } catch (e) {
    const msg = (e as Error).message;
    await appendAudit({ at: new Date().toISOString(), broker: broker.id, action: "cancel", input: { order_id: orderId }, result: "error", errorMessage: msg });
    const status = e instanceof BrokerNotConnectedError ? 401 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
