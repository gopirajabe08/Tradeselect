import { NextRequest, NextResponse } from "next/server";
import { activeBroker, BrokerNotConnectedError } from "@/lib/broker";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const list = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (list.length === 0) return NextResponse.json({ error: "missing symbols" }, { status: 400 });
  try {
    const quotes = await (await activeBroker()).getQuotes(list);
    return NextResponse.json({ quotes, at: Date.now() });
  } catch (e) {
    const status = e instanceof BrokerNotConnectedError ? 401 : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
