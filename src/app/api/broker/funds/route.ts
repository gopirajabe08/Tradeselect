import { NextResponse } from "next/server";
import { activeBroker, BrokerNotConnectedError } from "@/lib/broker";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ funds: await (await activeBroker()).getFunds() });
  } catch (e) {
    const status = e instanceof BrokerNotConnectedError ? 401 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
