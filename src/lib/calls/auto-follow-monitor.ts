/**
 * Live OCO bracket monitor.
 *
 * Tradejini does not auto-cancel sibling orders when one bracket leg fills (the way
 * the paper engine does). Without this monitor, a stop-loss could fire long after
 * the target was hit, accidentally shorting the user's account.
 *
 * Polls active orders every TICK_MS during market hours. Auto-follow places exit
 * legs with tags `auto-<id>-s` (stop) and `auto-<id>-t` (target). When one filles,
 * we cancel the other.
 *
 * Paper does its OCO inline in the match loop (see paper/engine.ts), so this
 * monitor is a no-op when broker=paper.
 */
import { activeBroker } from "@/lib/broker";
import { isMarketOpen } from "./scheduler";
import { appendAudit } from "@/lib/broker/audit";

const TICK_MS = 30 * 1000;
let timer: NodeJS.Timeout | null = null;
let started = false;
let lastTickAt: number | null = null;
let lastTickStatus: "ran" | "skipped" | "error" | null = null;
let lastCancelCount = 0;

export function getMonitorHeartbeat() {
  return { lastTickAt, lastTickStatus, lastCancelCount, intervalMs: TICK_MS };
}

async function tick() {
  lastTickAt = Date.now();
  if (!isMarketOpen()) { lastTickStatus = "skipped"; return; }
  try {
    const broker = await activeBroker();
    if (broker.id === "paper") { lastTickStatus = "skipped"; return; }
    const orders = await broker.getOrders();

    // Group by idea-id encoded in tag prefix `auto-<id>-(s|t)`.
    type Pair = { stop?: any; target?: any; entry?: any };
    const pairs = new Map<string, Pair>();
    for (const o of orders) {
      const tag = (o as any).orderTag ?? (o as any).tag ?? "";
      // Matches af-<cid> / af-<cid>-s / af-<cid>-t (cid is alphanumeric, up to 12 chars)
      const m = /^af-([a-z0-9]+)(?:-([st]))?$/i.exec(String(tag));
      if (!m) continue;
      const ideaId = m[1];
      const role = m[2];
      const p = pairs.get(ideaId) ?? {};
      if (role === "s") p.stop = o;
      else if (role === "t") p.target = o;
      else p.entry = o;
      pairs.set(ideaId, p);
    }

    let cancelled = 0;
    for (const [ideaId, p] of pairs.entries()) {
      // status mapping: 2=filled, 6=open, 4=transit, 1=cancelled, 3=rejected
      const stopFilled = p.stop && Number(p.stop.status) === 2;
      const tgtFilled  = p.target && Number(p.target.status) === 2;
      const stopOpen   = p.stop && (Number(p.stop.status) === 6 || Number(p.stop.status) === 4);
      const tgtOpen    = p.target && (Number(p.target.status) === 6 || Number(p.target.status) === 4);

      if (stopFilled && tgtOpen) {
        try {
          await broker.cancelOrder(String(p.target.id));
          cancelled += 1;
          await appendAudit({
            at: new Date().toISOString(),
            broker: "auto-follow",
            action: "cancel",
            input: { ideaId, leg: "target", reason: "OCO sibling stop filled" },
            result: "ok",
            resultDetail: { cancelledOrderId: p.target.id },
          });
        } catch (e) {
          await appendAudit({
            at: new Date().toISOString(),
            broker: "auto-follow",
            action: "cancel",
            input: { ideaId, leg: "target" },
            result: "error",
            errorMessage: (e as Error).message,
          });
        }
      } else if (tgtFilled && stopOpen) {
        try {
          await broker.cancelOrder(String(p.stop.id));
          cancelled += 1;
          await appendAudit({
            at: new Date().toISOString(),
            broker: "auto-follow",
            action: "cancel",
            input: { ideaId, leg: "stop", reason: "OCO sibling target filled" },
            result: "ok",
            resultDetail: { cancelledOrderId: p.stop.id },
          });
        } catch (e) {
          await appendAudit({
            at: new Date().toISOString(),
            broker: "auto-follow",
            action: "cancel",
            input: { ideaId, leg: "stop" },
            result: "error",
            errorMessage: (e as Error).message,
          });
        }
      }
    }
    lastCancelCount = cancelled;
    lastTickStatus = "ran";
    if (cancelled > 0) console.log(`[auto-follow-monitor] cancelled ${cancelled} orphan bracket legs`);
  } catch (e) {
    lastTickStatus = "error";
    console.warn("[auto-follow-monitor] tick failed:", (e as Error).message);
  }
}

export function startAutoFollowMonitor() {
  if (started) return;
  started = true;
  console.log(`[auto-follow-monitor] starting (every ${TICK_MS / 1000}s, live mode only)`);
  // First tick after a small delay so the system is fully booted
  setTimeout(() => { tick().catch(() => {}); }, 5_000);
  timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
}

export function stopAutoFollowMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
