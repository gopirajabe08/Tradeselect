import { runGenerator, setLastRegime } from "./generator";
import { isNseHoliday, istDateString } from "@/lib/market/holidays";
import { fetchUniverse, fetchMarketIndices } from "./universe";
import { classifyRegime } from "./regime";
import { runAutoFollow } from "./auto-follow";
import { maybeRunAutoCull } from "./auto-cull";
import { startAutoFollowMonitor } from "./auto-follow-monitor";
import { maybeSendMorningBriefing, maybeSendMiddayBriefing, maybeSendEodBriefing, maybeSendWeeklyDigest } from "./daily-briefing";
import { maybeRunIntradaySquareoff } from "./intraday-squareoff";
import { maybeRunMaxHoldExit } from "./max-hold-exit";
import { promises as fs } from "fs";
import path from "path";

/** Persist heartbeat to disk so any module instance — incl. API routes that
 *  load in a separate Next.js dev-mode context — can read the same value.
 *  In production this is also more robust: heartbeat survives module reload. */
const HEARTBEAT_FILE = path.join(process.cwd(), ".local-data", "scheduler-heartbeat.json");
async function persistHeartbeat() {
  try {
    await fs.mkdir(path.dirname(HEARTBEAT_FILE), { recursive: true });
    await fs.writeFile(HEARTBEAT_FILE, JSON.stringify({ lastTickAt, lastTickStatus, lastTickReason, intervalMs: TICK_MS }), { mode: 0o600 });
  } catch {}
}
async function readHeartbeatFile(): Promise<{ lastTickAt: number | null; lastTickStatus: string | null; lastTickReason: string | null; intervalMs: number } | null> {
  try {
    const raw = await fs.readFile(HEARTBEAT_FILE, "utf8");
    return JSON.parse(raw);
  } catch { return null; }
}

// Generator tick cadence — env-overridable. Default 5 min: fast enough to catch
// momentum / breakout setups before they decay, slow enough that NSE batch fetches
// don't rate-limit. Auto-follow's max-open + score-gate caps over-trading.
const TICK_MS = Number(process.env.SCHEDULER_TICK_MS ?? 5 * 60 * 1000);
let ticker: NodeJS.Timeout | null = null;
let started = false;
let lastTickAt: number | null = null;
let lastTickStatus: "ran" | "skipped-market-closed" | "skipped-holiday" | "boot-regime-only" | "error" | null = null;
let lastTickReason: string | null = null;
export function getSchedulerHeartbeat() {
  return { lastTickAt, lastTickStatus, lastTickReason, intervalMs: TICK_MS };
}

/** Read heartbeat from disk — tolerant of cross-module-instance inconsistency in dev. */
export async function readSchedulerHeartbeat() {
  const onDisk = await readHeartbeatFile();
  if (onDisk) return onDisk;
  return { lastTickAt, lastTickStatus, lastTickReason, intervalMs: TICK_MS };
}

/** NSE cash market open: Mon–Fri 09:15–15:30 IST, excluding declared trading holidays. */
export function isMarketOpen(now = new Date()): boolean {
  const day = now.getUTCDay();                    // Sun=0, Sat=6
  if (day === 0 || day === 6) return false;
  // Holiday check (IST date)
  if (isNseHoliday(istDateString(now))) return false;
  // 09:15 IST = 03:45 UTC, 15:30 IST = 10:00 UTC
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return mins >= (3 * 60 + 45) && mins <= (10 * 60);
}

async function tick() {
  lastTickAt = Date.now();

  // Daily Telegram briefings — self-gate by IST time-window + sent-stamp; call on
  // every tick regardless of market state so EOD briefing fires post-close (when
  // the rest of tick() short-circuits via "market closed").
  maybeSendMorningBriefing().catch(e => console.warn("[briefing] morning failed:", (e as Error).message));
  maybeSendMiddayBriefing().catch(e => console.warn("[briefing] midday failed:", (e as Error).message));
  maybeSendEodBriefing().catch(e => console.warn("[briefing] eod failed:", (e as Error).message));
  maybeSendWeeklyDigest().catch(e => console.warn("[briefing] weekly failed:", (e as Error).message));

  // Intraday squareoff — fires once per day at 15:15–15:25 IST, mirrors broker behavior.
  maybeRunIntradaySquareoff().catch(e => console.warn("[squareoff] failed:", (e as Error).message));

  // Max-hold exit — every tick during market hours, closes CNC positions aged ≥ strategy.maxHoldDays.
  // Critical for backtest-live alignment: strategy edges are at specific hold horizons; without this,
  // CNC swing positions carry indefinitely and the supposed edge is fictional.
  if (isMarketOpen()) {
    maybeRunMaxHoldExit().catch(e => console.warn("[max-hold-exit] failed:", (e as Error).message));
  }

  try {
    const today = istDateString();
    if (isNseHoliday(today)) {
      lastTickStatus = "skipped-holiday";
      lastTickReason = `NSE holiday ${today} — generator paused.`;
      console.log(`[generator] skipped tick (holiday: ${today})`);
      await persistHeartbeat();
      return;
    }
    if (!isMarketOpen()) {
      lastTickStatus = "skipped-market-closed";
      lastTickReason = `Market closed (NSE 09:15–15:30 IST Mon–Fri). Will retry in ${TICK_MS / 60000}m.`;
      console.log(`[generator] skipped tick (market closed)`);
      await persistHeartbeat();
      return;
    }
    const result = await runGenerator();
    lastTickStatus = "ran";
    lastTickReason = `Scanned ${result.scanned}, generated ${result.generated}, regime ${result.regime?.regime ?? "?"}`;
    if (result.generated > 0) {
      console.log(`[generator] +${result.generated} new ideas (scanned ${result.scanned}, regime ${result.regime?.regime})`);
    } else {
      console.log(`[generator] tick ran — no new ideas (regime ${result.regime?.regime}, scanned ${result.scanned})`);
    }

    // Auto-follow: place orders + brackets for new high-conviction ideas (no-op if AUTO_FOLLOW_ENABLED!=1).
    if (result.added && result.added.length > 0) {
      try {
        const af = await runAutoFollow(result.added);
        if (af.enabled) {
          console.log(`[auto-follow] attempted=${af.attempted} placed=${af.placed} skipped=${af.skipped.length} errors=${af.errors.length}`);
          if (af.errors.length > 0) console.warn(`[auto-follow] errors:`, af.errors.slice(0, 5));
        }
      } catch (e) {
        console.warn("[auto-follow] crashed:", (e as Error).message);
      }
    }

    // Auto-cull: weekly (gated internally by RUN_INTERVAL) — disable strategies with sharpe<0.
    try {
      const cull = await maybeRunAutoCull();
      if (cull.ran) {
        console.log(`[auto-cull] ran — ${cull.disabled?.length ?? 0} strategies newly disabled${(cull.disabled ?? []).length ? ": " + (cull.disabled ?? []).join(", ") : ""}`);
      }
    } catch (e) {
      console.warn("[auto-cull] crashed:", (e as Error).message);
    }
  } catch (e) {
    lastTickStatus = "error";
    lastTickReason = (e as Error).message;
    console.warn("[generator] tick failed:", (e as Error).message);
  } finally {
    await persistHeartbeat();
  }
}

/** Fetch universe + classify regime even when market is closed, so dashboard / health
 *  endpoints have a fresh reading on boot. No ideas are generated; pure read-only. */
async function bootRegimePrime() {
  try {
    const [snapshots, indices] = await Promise.all([fetchUniverse(), fetchMarketIndices()]);
    if (snapshots.length > 0) {
      // classifyRegime mutates module state in regime.ts; generator.ts also exports getLastRegime().
      // We don't have a clean setter, so re-import is awkward. Instead, run runGenerator's first half
      // by calling fetchUniverse + classifyRegime directly here and stashing on the module-level
      // lastRegime in generator.ts via a small helper. For now, we just print so the user sees signs of life.
      const r = classifyRegime(snapshots, indices.vix ?? 16);
      setLastRegime(r);
      console.log(`[generator] boot regime probe: ${r.regime} (breadth ${r.breadthPct.toFixed(0)}%, vix ${r.vix.toFixed(1)}) — generator will start firing when market opens`);
      lastTickStatus = "boot-regime-only";
      lastTickReason = `Boot probe: regime=${r.regime}, breadth=${r.breadthPct.toFixed(0)}%`;
      lastTickAt = Date.now();
      await persistHeartbeat();
    }
  } catch (e) {
    console.warn("[generator] boot regime probe failed:", (e as Error).message);
  }
}

/**
 * Idempotent. First call starts the scheduler; subsequent calls are no-ops.
 * Called from instrumentation.ts on server boot.
 */
/** Returns ms until next 09:15 IST (NSE market open). Returns 0 if currently open. */
function msUntilNextMarketOpen(): number {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const dow = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (isMarketOpen()) return 0;
  // Today's open is later (before 09:15 IST and weekday)
  if (dow >= 1 && dow <= 5 && mins < (9 * 60 + 15)) {
    const minsUntil = (9 * 60 + 15) - mins;
    return minsUntil * 60 * 1000;
  }
  // Otherwise next weekday open
  let daysAhead = 1;
  let nextDow = (dow + 1) % 7;
  while (nextDow === 0 || nextDow === 6) {
    daysAhead += 1;
    nextDow = (dow + daysAhead) % 7;
  }
  const minsToMidnight = (24 * 60) - mins;
  const minsToOpen = minsToMidnight + (daysAhead - 1) * 24 * 60 + (9 * 60 + 15);
  return minsToOpen * 60 * 1000;
}

export function startScheduler() {
  if (started) return;
  started = true;
  console.log(`[generator] scheduler starting (every ${TICK_MS / 60000} min, market hours only)`);
  // Fire once on boot — runs generator if market open, regime-only probe if closed.
  tick().then(() => {
    if (lastTickStatus !== "ran") return bootRegimePrime();
  }).catch(() => {});

  // Align first market-hours tick to ~30s after market open if it's within reach,
  // so the user doesn't wait up to 30 min after the bell for the first generator run.
  const msToOpen = msUntilNextMarketOpen();
  if (msToOpen > 0 && msToOpen < TICK_MS) {
    const alignDelay = msToOpen + 30_000;
    console.log(`[generator] aligning first market-hours tick to ${Math.round(alignDelay / 60000)} min from now (09:15 IST + 30s)`);
    setTimeout(() => { tick().catch(() => {}); }, alignDelay);
  }

  ticker = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  // Live OCO bracket monitor — no-op for paper, polls Tradejini every 30s during market hours.
  startAutoFollowMonitor();
}

export function stopScheduler() {
  if (ticker) clearInterval(ticker);
  ticker = null;
  started = false;
}
