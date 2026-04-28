import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { readLastRegime } from "@/lib/calls/generator";
import { readAudit } from "@/lib/broker/audit";
import { isMarketOpen, readSchedulerHeartbeat } from "@/lib/calls/scheduler";
import { readMode } from "@/lib/broker/mode";
import { readState } from "@/lib/broker/paper/store";
import { readOverrides } from "@/lib/calls/strategy-overrides";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

async function dirSize(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0, bytes = 0;
  async function walk(p: string) {
    let entries: string[] = [];
    try { entries = await fs.readdir(p); } catch { return; }
    for (const e of entries) {
      const full = path.join(p, e);
      try {
        const st = await fs.stat(full);
        if (st.isDirectory()) await walk(full);
        else { files++; bytes += st.size; }
      } catch {}
    }
  }
  await walk(dir);
  return { files, bytes };
}

export async function GET() {
  const startedAt = process.uptime();
  const mem = process.memoryUsage();
  const mode = await readMode();
  const regime = await readLastRegime();

  // Audit-log derived stats
  const audit = await readAudit(200);
  const recent = audit.slice(0, 50);
  const placeAttempts = recent.filter(e => e.action === "place").length;
  const placeErrors   = recent.filter(e => e.action === "place" && e.result === "error").length;
  const errorRate     = placeAttempts > 0 ? (placeErrors / placeAttempts) * 100 : 0;
  const lastError     = audit.find(e => e.result === "error");
  const lastSuccess   = audit.find(e => e.result === "ok" && e.action === "place");

  // Paper engine size
  let paperOrders = 0, paperPositions = 0, paperHoldings = 0;
  try {
    const s = await readState();
    paperOrders = s.orders.length;
    paperPositions = s.positions.length;
    paperHoldings = s.holdings.length;
  } catch {}

  // Disk usage on .local-data
  const dataDir = path.join(process.cwd(), ".local-data");
  const diskStats = await dirSize(dataDir);

  // halt.flag presence
  let killSwitch = false;
  try { await fs.access(path.join(dataDir, "halt.flag")); killSwitch = true; } catch {}

  // Auto-follow + auto-cull surface
  const overrides = await readOverrides().catch(() => ({ updatedAt: new Date(0).toISOString(), overrides: [] as any[] }));
  const autoFollowAttempts = audit.filter(e => e.action === "auto-follow" && e.result === "ok").length;
  const todayIso = new Date().toISOString().slice(0, 10);
  const autoFollowToday = audit.filter(e => e.action === "auto-follow" && e.at.startsWith(todayIso) && e.result === "ok").length;
  const autoFollow = {
    enabled: process.env.AUTO_FOLLOW_ENABLED === "1",
    minScore: Number(process.env.AUTO_FOLLOW_MIN_SCORE ?? 70),
    riskPct:  Number(process.env.AUTO_FOLLOW_RISK_PCT ?? 1.0),
    maxOpen:  Number(process.env.AUTO_FOLLOW_MAX_OPEN ?? 5),
    allowLive: process.env.AUTO_FOLLOW_ALLOW_LIVE === "1",
    placedTotal: autoFollowAttempts,
    placedToday: autoFollowToday,
  };
  const autoCull = {
    lastRunAt: overrides.updatedAt,
    minTrades: Number(process.env.AUTO_CULL_MIN_TRADES ?? 20),
    intervalH: Math.round(Number(process.env.AUTO_CULL_INTERVAL_MS ?? 7 * 24 * 3600 * 1000) / 3600_000),
    disabledStrategies: overrides.overrides.filter((o: any) => o.disabled).map((o: any) => ({ id: o.id, reason: o.reason })),
  };

  const ok = errorRate < 50 && !killSwitch;       // simple healthy check

  return NextResponse.json({
    ok,
    at: new Date().toISOString(),
    process: {
      uptimeSec: Math.round(startedAt),
      memoryMB:  Math.round(mem.rss / 1024 / 1024),
      heapMB:    Math.round(mem.heapUsed / 1024 / 1024),
      nodeVersion: process.version,
    },
    market: {
      isOpen: isMarketOpen(),
    },
    scheduler: await readSchedulerHeartbeat(),
    broker: {
      mode,
      killSwitchEngaged: killSwitch,
    },
    regime: regime ? {
      regime: regime.regime,
      breadthPct: regime.breadthPct,
      vix: regime.vix,
      computedAt: regime.computedAt,
    } : null,
    paper: {
      orders: paperOrders,
      positions: paperPositions,
      holdings: paperHoldings,
    },
    audit: {
      totalEntries: audit.length,
      recentPlaceAttempts: placeAttempts,
      recentPlaceErrors: placeErrors,
      errorRatePct: Number(errorRate.toFixed(1)),
      lastErrorAt: lastError?.at ?? null,
      lastErrorMessage: lastError?.errorMessage ?? null,
      lastSuccessAt: lastSuccess?.at ?? null,
    },
    disk: {
      dataDir,
      files: diskStats.files,
      bytes: diskStats.bytes,
      mb: Math.round(diskStats.bytes / 1024 / 1024 * 10) / 10,
    },
    autoFollow,
    autoCull,
  });
}
