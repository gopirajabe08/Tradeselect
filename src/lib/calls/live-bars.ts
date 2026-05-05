/**
 * Live-bars enrichment — fetches recent daily bars per symbol at scan time and
 * populates `volumeRel20d`, `isNR4`, `isNR7`, `rangeRel7d` on live snapshots.
 *
 * WHY THIS EXISTS:
 *   The NSE batch endpoint (used by `fetchUniverse`) returns ONLY today's snapshot data.
 *   It does NOT include historical context (20-day avg volume, 7-day range distribution).
 *   Strategies that need that context (HRVM requires volumeRel20d) silently produce zero
 *   ideas in live paper mode — they only fire in backtests where `barToSnapshot` populates
 *   these fields.
 *
 *   This module bridges the gap: after the universe is filtered to liquid stocks, we
 *   fetch the last ~25 daily bars per symbol (parallel-bounded, 6-hour cached) and run
 *   the same enrichment math the backtester uses. After this, HRVM behaves identically
 *   in live and backtest.
 *
 * COST PROFILE:
 *   - First scan after boot: ~50 stocks × 1 fetch = ~6s with concurrency=8
 *   - Subsequent scans (5-min cadence): cache hits, ~0 fetch time
 *   - Cache TTL 6h → first scan after market open re-populates daily
 *   - Failure mode: if all fetches fail, snapshots return without enrichment fields
 *     and HRVM/VCB skip those symbols (degrades to RSWD/reversal-52wl-only)
 *
 * Decision 2026-05-05 EOD: shipped after the user complained about HRVM never firing in
 * live paper. Combined with RSWD (no-history-needed) ship the previous evening, this
 * gives the equity-cash engine its full strategy book in actual live paper.
 */
import type { SymbolSnapshot } from "./strategies/types";
import { fetchDailyBars, type HistoricalBar } from "./historical";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;            // 6 hours — daily bars are stable intraday
const MAX_CONCURRENT_FETCHES = 8;
const BARS_LOOKBACK_DAYS_TO_FETCH = "1mo";          // ~25 trading days, enough for 20-day avg + NR7

type CachedBars = { bars: HistoricalBar[]; fetchedAt: number };
const cache = new Map<string, CachedBars>();

/** Compute enrichment fields from bar history and mutate the snapshot in place. */
function applyEnrichment(snap: SymbolSnapshot, bars: HistoricalBar[]): void {
  if (bars.length < 5) return;       // insufficient history; leave fields undefined

  // The most recent bar is "today" (or yesterday's close if market just opened).
  // We use prior-N bars (excluding today) for the historical baseline.
  const today = bars[bars.length - 1];
  const todayRange = today.h - today.l;

  // 20-day relative volume — today.v / mean(prior 20 days' volumes)
  const volWindowSize = Math.min(20, bars.length - 1);
  if (volWindowSize >= 5) {
    const volWindow = bars.slice(-1 - volWindowSize, -1);
    const avgVol = volWindow.reduce((s, b) => s + b.v, 0) / volWindow.length;
    if (avgVol > 0) snap.volumeRel20d = today.v / avgVol;
  }

  // NR4 / NR7 + rangeRel7d
  if (bars.length >= 8) {                            // need at least 7 prior bars
    const last7 = bars.slice(-8, -1).map(b => b.h - b.l);
    const last4 = bars.slice(-5, -1).map(b => b.h - b.l);
    snap.isNR4 = last4.every(r => todayRange <= r);
    snap.isNR7 = last7.every(r => todayRange <= r);
    const sorted = [...last7].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > 0) snap.rangeRel7d = todayRange / median;
  }
}

async function fetchBarsCached(symbol: string): Promise<HistoricalBar[]> {
  const now = Date.now();
  const cached = cache.get(symbol);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.bars;
  }
  try {
    const bars = await fetchDailyBars(symbol, BARS_LOOKBACK_DAYS_TO_FETCH);
    cache.set(symbol, { bars, fetchedAt: now });
    return bars;
  } catch {
    // Negative cache for short period to avoid hammering the failed source
    cache.set(symbol, { bars: [], fetchedAt: now - CACHE_TTL_MS + 30 * 60 * 1000 });
    return [];
  }
}

/** Bounded-parallel iteration. */
async function pmap<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Enrich each snapshot with bar-derived fields. Returns the SAME array reference
 * (snapshots mutated in place) so callers don't need to swap. Failures degrade
 * silently — strategies needing those fields will skip those symbols.
 */
export async function enrichWithBarStats(snapshots: SymbolSnapshot[]): Promise<SymbolSnapshot[]> {
  if (snapshots.length === 0) return snapshots;
  const t0 = Date.now();
  let cacheHits = 0;
  let fetched = 0;

  await pmap(snapshots, MAX_CONCURRENT_FETCHES, async snap => {
    const cached = cache.get(snap.symbol);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      cacheHits += 1;
      applyEnrichment(snap, cached.bars);
      return;
    }
    const bars = await fetchBarsCached(snap.symbol);
    if (bars.length > 0) fetched += 1;
    applyEnrichment(snap, bars);
  });

  const elapsedMs = Date.now() - t0;
  console.log(`[live-bars] enriched ${snapshots.length} snapshots in ${elapsedMs}ms (cache hits: ${cacheHits}, network: ${fetched})`);
  return snapshots;
}

/** Test-only: clear the cache. */
export function _clearLiveBarsCache(): void {
  cache.clear();
}
