import { NextRequest, NextResponse } from "next/server";
import { smokeTest as tjSmoke } from "@/lib/broker/tradejini";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(req: NextRequest) {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const broker = req.nextUrl.searchParams.get("broker");
  if (broker !== "tradejini") {
    return NextResponse.json({ error: "only tradejini smoke supported" }, { status: 400 });
  }
  const r = await tjSmoke();
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
