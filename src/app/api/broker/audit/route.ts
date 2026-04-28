import { NextResponse } from "next/server";
import { readAudit } from "@/lib/broker/audit";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET() {
  return NextResponse.json({ entries: await readAudit(200) });
}
