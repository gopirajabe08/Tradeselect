import type { TradeCall } from "@/lib/mock/seed";
import { readCalls, writeCalls } from "./store";
import { fetchUniverse, fetchMarketIndices } from "./universe";
import { STRATEGIES, type StrategyIdea } from "./strategies";
import { buildContext, scoreIdea, SCORE_THRESHOLD } from "./scoring";
import { classifyRegime, type RegimeReading } from "./regime";
import { notifyCallsGenerated } from "@/lib/notify/telegram";
import { readOverrides, isDisabled } from "./strategy-overrides";
import { eventWindowFor } from "./event-calendar";
import { enrichWithBarStats } from "./live-bars";
import { promises as fs } from "fs";
import path from "path";

/** Disk-backed regime snapshot so API routes (different module instances in Next.js
 *  dev/standalone) can read the same value the scheduler module wrote. */
const REGIME_FILE = path.join(process.cwd(), ".local-data", "last-regime.json");

let lastRegime: RegimeReading | null = null;
export function getLastRegime(): RegimeReading | null { return lastRegime; }
export async function readLastRegime(): Promise<RegimeReading | null> {
  if (lastRegime) return lastRegime;
  try {
    const raw = await fs.readFile(REGIME_FILE, "utf8");
    lastRegime = JSON.parse(raw) as RegimeReading;
    return lastRegime;
  } catch { return null; }
}
async function persistRegime(r: RegimeReading): Promise<void> {
  try {
    await fs.mkdir(path.dirname(REGIME_FILE), { recursive: true });
    await fs.writeFile(REGIME_FILE, JSON.stringify(r), { mode: 0o600 });
  } catch {}
}
export function setLastRegime(r: RegimeReading) {
  lastRegime = r;
  persistRegime(r).catch(() => {});
}

/**
 * One pass of the auto-generator:
 *   1. Fetch Nifty 500 universe + Nifty 50 % change + INDIA VIX (2 NSE calls)
 *   2. Classify market regime from breadth + VIX
 *   3. Run only strategies whose allowedRegimes include the current regime
 *   4. Score each idea 0-100; drop below SCORE_THRESHOLD
 *   5. Dedup against existing Active ideas
 *   6. Persist with analyst = strategy name + "(BullsAi Auto)", score attached
 */
export async function runGenerator(): Promise<{
  scanned: number;
  rawIdeas: number;
  generated: number;
  filteredOut: number;
  regime: RegimeReading | null;
  gatedStrategies: string[];          // strategies skipped because of regime
  added: TradeCall[];
}> {
  const [snapshots, indices] = await Promise.all([fetchUniverse(), fetchMarketIndices()]);
  if (snapshots.length === 0) {
    return { scanned: 0, rawIdeas: 0, generated: 0, filteredOut: 0, regime: null, gatedStrategies: [], added: [] };
  }

  // Classify regime + check confirmation against previous tick.
  // Regime-specific strategies only fire when the regime is CONFIRMED — i.e.,
  // matches the previous tick's regime. A single-tick flicker (e.g. CHOPPY → TRENDING-UP
  // → CHOPPY) does not trigger regime-specific entries. This rail is the lesson
  // stamped on 2026-04-28 when a one-tick TRENDING-UP read drained the paper account.
  // Reads previousRegime from disk so deploys/restarts don't reset confirmation.
  const previousRegime = await readLastRegime();
  const regime = classifyRegime(snapshots, indices.vix ?? 16);
  const regimeConfirmed = previousRegime?.regime === regime.regime;
  lastRegime = regime;
  persistRegime(regime).catch(() => {});

  // Filter strategies by regime + auto-cull overrides.
  // Strategies with `allowedRegimes` are GATED until regime is confirmed across 2 ticks.
  const overrides = await readOverrides();
  const activeStrategies = STRATEGIES.filter(s => {
    if (s.allowedRegimes) {
      if (!s.allowedRegimes.includes(regime.regime)) return false;
      if (!regimeConfirmed) return false;     // unconfirmed regime — wait one more tick
    }
    if (isDisabled(overrides, s.id)) return false;
    return true;
  });
  const gatedStrategies = STRATEGIES
    .filter(s => (s.allowedRegimes && !s.allowedRegimes.includes(regime.regime)) || isDisabled(overrides, s.id))
    .map(s => s.name + (isDisabled(overrides, s.id) ? " [auto-culled]" : ""));

  const transitionMsg = !regimeConfirmed
    ? (previousRegime
        ? ` — TRANSITION ${previousRegime.regime}→${regime.regime}, ALL regime-specific strategies HELD until next tick confirms`
        : ` — first tick (no previous regime), strategies HELD until next tick confirms`)
    : "";
  console.log(`[generator] regime=${regime.regime} (breadth ${regime.breadthPct.toFixed(0)}%, vix ${regime.vix.toFixed(1)}) — running ${activeStrategies.length}/${STRATEGIES.length} strategies${transitionMsg}, gating: ${gatedStrategies.join(", ") || "none"}`);

  const ctx = buildContext(snapshots, indices.niftyPct ?? 0);

  // ── NSE-veteran universe gates (turnover + circuit) ──
  // Veteran: "Below ₹50cr daily turnover, slippage eats the edge. And a stock
  // already up/down ~8% is near a circuit limit — entering there means you may
  // not be able to exit at fair price."
  const TURNOVER_FLOOR_LAKHS = Number(process.env.VETERAN_TURNOVER_FLOOR_LAKHS ?? 5000);   // ₹50cr in lakhs
  const CIRCUIT_PCHG_PCT     = Number(process.env.VETERAN_CIRCUIT_PCHG_PCT ?? 8);          // skip if |pChange| > 8%
  const liquidUniverse = snapshots.filter(s => {
    const tv = s.totalTradedValue ?? 0;          // already in lakhs
    if (tv < TURNOVER_FLOOR_LAKHS) return false;
    if (Math.abs(s.pChange ?? 0) > CIRCUIT_PCHG_PCT) return false;
    return true;
  });
  console.log(`[generator] veteran-gates filtered universe: ${snapshots.length} → ${liquidUniverse.length} (turnover ≥ ₹${TURNOVER_FLOOR_LAKHS / 100}cr, |pChange| ≤ ${CIRCUIT_PCHG_PCT}%)`);

  // Enrich liquid universe with historical-bar stats (volumeRel20d, isNR4/NR7, rangeRel7d).
  // HRVM and VCB-style strategies require these fields; the NSE batch endpoint doesn't ship
  // them. Fetches are bounded (8 concurrent) and cached 6h. First scan after boot adds ~6s;
  // subsequent scans within market hours: cache hits, ~0 cost.
  await enrichWithBarStats(liquidUniverse);

  // Run regime-allowed strategies
  const scored: { idea: StrategyIdea; score: number }[] = [];
  for (const s of liquidUniverse) {
    for (const strat of activeStrategies) {
      try {
        const idea = strat.apply(s);
        if (!idea) continue;
        const sb = scoreIdea(idea, s, ctx);
        scored.push({ idea, score: sb.total });
      } catch (e) {
        console.warn(`[generator] ${strat.id} threw on ${s.symbol}:`, (e as Error).message);
      }
    }
  }

  const rawIdeasCount = scored.length;
  scored.sort((a, b) => b.score - a.score);
  const kept = scored.filter(r => r.score >= SCORE_THRESHOLD);

  // Dedup
  const current = await readCalls();
  const activeKeys = new Set(current.filter(c => c.status === "Active").map(c => `${c.symbol}|${c.side}|${c.segment}`));
  const runKeys = new Set<string>();
  const fresh: { idea: StrategyIdea; score: number }[] = [];
  for (const r of kept) {
    const k = `${r.idea.symbol}|${r.idea.side}|${r.idea.segment}`;
    if (activeKeys.has(k) || runKeys.has(k)) continue;
    runKeys.add(k);
    fresh.push(r);
  }

  if (fresh.length === 0) {
    return { scanned: snapshots.length, rawIdeas: rawIdeasCount, generated: 0, filteredOut: rawIdeasCount, regime, gatedStrategies, added: [] };
  }

  let maxSeq = current.map(c => Number(c.id.match(/^AP-(\d+)$/)?.[1] ?? 0)).reduce((a, b) => Math.max(a, b), 2100);
  const nowIso = new Date().toISOString();
  const eventFlag = eventWindowFor(new Date());
  // Snapshot lookup: idea.symbol → SymbolSnapshot for attribution stamping
  const snapBySymbol = new Map(snapshots.map(s => [s.symbol, s]));
  const added: TradeCall[] = fresh.map(({ idea, score }) => {
    maxSeq += 1;
    const snap = snapBySymbol.get(idea.symbol);
    return {
      id: `AP-${maxSeq}`,
      segment: idea.segment,
      symbol: idea.symbol,
      side: idea.side,
      entry: idea.entry,
      target1: idea.target1,
      target2: idea.target2,
      stopLoss: idea.stopLoss,
      horizon: idea.horizon,
      status: "Active",
      issuedAt: nowIso,
      analyst: `${idea.strategyName} (BullsAi Auto)`,
      rationale: `[conviction ${score}/100 · ${regime.regime}] ${idea.rationale}`,
      ltp: idea.entry,
      score,
      // Data-analyst attribution
      strategyId: idea.strategyId,
      regimeAtSignal: regime.regime,
      sector: snap?.industry,
      snapshotPChange: snap?.pChange,
      snapshotVolume: snap?.totalTradedVolume,
      snapshotTurnoverLakhs: snap?.totalTradedValue,
      isWithinEventWindow: eventFlag.isWithinEventWindow,
      eventName: eventFlag.eventName,
    } as TradeCall;
  });

  const latest = await readCalls();
  await writeCalls([...added, ...latest]);

  // Fire-and-forget Telegram ping (doesn't block generator).
  if (added.length > 0) {
    notifyCallsGenerated({
      total: added.length,
      regime: regime?.regime ?? null,
      ideas: added.map((c: any) => ({
        symbol: c.symbol,
        side: c.side,
        entry: c.entry,
        target1: c.target1,
        stopLoss: c.stopLoss,
        analyst: c.analyst,
      })),
    }).catch(() => {});
  }

  return {
    scanned: snapshots.length, rawIdeas: rawIdeasCount, generated: added.length,
    filteredOut: rawIdeasCount - kept.length, regime, gatedStrategies, added,
  };
}
