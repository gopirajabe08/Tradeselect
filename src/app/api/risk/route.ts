import { NextRequest, NextResponse } from "next/server";
import { computeSizing, readRiskConfig, writeRiskConfig } from "@/lib/risk/sizing";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const cfg = await readRiskConfig();
  // If no ?symbol param, just return the config.
  const symbol = p.get("symbol");
  if (!symbol) return NextResponse.json({ config: cfg });

  const entry    = Number(p.get("entry") ?? NaN);
  const stopLoss = Number(p.get("stopLoss") ?? NaN);
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss)) {
    return NextResponse.json({ error: "missing entry / stopLoss" }, { status: 400 });
  }
  const override = {
    accountSize: p.get("accountSize") ? Number(p.get("accountSize")) : undefined,
    riskPct:     p.get("riskPct")     ? Number(p.get("riskPct"))     : undefined,
  };
  const result = computeSizing({ symbol, entry, stopLoss, ...override }, cfg);
  return NextResponse.json({ config: cfg, sizing: result });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const accountSize     = body?.accountSize     != null ? Number(body.accountSize)     : undefined;
  const riskPct         = body?.riskPct         != null ? Number(body.riskPct)         : undefined;
  const dailyMaxLossPct = body?.dailyMaxLossPct != null ? Number(body.dailyMaxLossPct) : undefined;
  if (accountSize != null && (!Number.isFinite(accountSize) || accountSize <= 0)) {
    return NextResponse.json({ error: "invalid accountSize" }, { status: 400 });
  }
  if (riskPct != null && (!Number.isFinite(riskPct) || riskPct <= 0 || riskPct > 10)) {
    return NextResponse.json({ error: "invalid riskPct (must be 0–10)" }, { status: 400 });
  }
  if (dailyMaxLossPct != null && (!Number.isFinite(dailyMaxLossPct) || dailyMaxLossPct < 0 || dailyMaxLossPct > 20)) {
    return NextResponse.json({ error: "invalid dailyMaxLossPct (must be 0–20; 0 disables)" }, { status: 400 });
  }
  const cfg = await writeRiskConfig({ accountSize, riskPct, dailyMaxLossPct });
  return NextResponse.json({ ok: true, config: cfg });
}
