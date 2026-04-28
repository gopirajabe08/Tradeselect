/**
 * Auto-cull losing strategies.
 *
 * Reads all closed (BullsAi Auto) calls, groups by strategy, computes per-strategy
 * win rate / avg return / Sharpe, and disables any strategy with:
 *   - tradeCount >= MIN_SAMPLE
 *   - sharpe < 0
 *
 * Disabled strategies stop generating new ideas (filtered in generator). A human
 * can re-enable by editing .local-data/strategy-overrides.json.
 *
 * Cadence: invoked from the scheduler at most once per RUN_INTERVAL (default 7 days).
 * The "last run" timestamp lives in the override file itself.
 */
import { readCalls } from "./store";
import { STRATEGIES } from "./strategies";
import { readOverrides, writeOverrides, type StrategyOverride } from "./strategy-overrides";

const MIN_SAMPLE = Number(process.env.AUTO_CULL_MIN_TRADES ?? 20);
const RUN_INTERVAL_MS = Number(process.env.AUTO_CULL_INTERVAL_MS ?? 7 * 24 * 3600 * 1000);
const ANALYST_SUFFIX = " (BullsAi Auto)";

type Stats = { id: string; trades: number; wins: number; avgPct: number; sharpe: number };

function strategyIdFromAnalyst(analyst: string): string | null {
  if (!analyst.endsWith(ANALYST_SUFFIX)) return null;
  const name = analyst.slice(0, -ANALYST_SUFFIX.length).trim();
  return STRATEGIES.find(s => s.name === name)?.id ?? null;
}

/** Returns per-strategy stats over CLOSED auto-generated calls. */
export async function computeStrategyStats(): Promise<Stats[]> {
  const calls = await readCalls();
  type Bucket = { id: string; pcts: number[]; wins: number };
  const buckets = new Map<string, Bucket>();

  for (const c of calls) {
    if (c.status !== "Target Hit" && c.status !== "SL Hit" && c.status !== "Closed" && c.status !== "Expired") continue;
    if (c.closedPrice == null) continue;
    const sid = strategyIdFromAnalyst(c.analyst);
    if (!sid) continue;
    const dir = c.side === "BUY" ? 1 : -1;
    const pct = ((c.closedPrice - c.entry) / c.entry) * 100 * dir;
    let b = buckets.get(sid);
    if (!b) { b = { id: sid, pcts: [], wins: 0 }; buckets.set(sid, b); }
    b.pcts.push(pct);
    if (pct > 0) b.wins += 1;
  }

  const stats: Stats[] = [];
  for (const b of buckets.values()) {
    const n = b.pcts.length;
    const avg = b.pcts.reduce((a, x) => a + x, 0) / n;
    const variance = b.pcts.reduce((a, x) => a + (x - avg) ** 2, 0) / Math.max(1, n - 1);
    const stdev = Math.sqrt(variance);
    const sharpe = stdev === 0 ? 0 : avg / stdev;
    stats.push({ id: b.id, trades: n, wins: b.wins, avgPct: avg, sharpe });
  }
  return stats;
}

export async function maybeRunAutoCull(force = false): Promise<{ ran: boolean; stats?: Stats[]; disabled?: string[]; reason?: string }> {
  const file = await readOverrides();
  if (!force) {
    const lastMs = Date.parse(file.updatedAt);
    if (Number.isFinite(lastMs) && Date.now() - lastMs < RUN_INTERVAL_MS) {
      return { ran: false, reason: `last cull was ${(Math.round((Date.now() - lastMs) / 3600_000))}h ago — interval is ${Math.round(RUN_INTERVAL_MS / 3600_000)}h` };
    }
  }

  const stats = await computeStrategyStats();
  const newDisabled: string[] = [];
  const overrides: StrategyOverride[] = [];
  // Carry forward existing manual disables; refresh auto-cull verdicts based on current stats.
  for (const o of file.overrides) {
    const fresh = stats.find(s => s.id === o.id);
    if (!fresh || fresh.trades < MIN_SAMPLE || fresh.sharpe >= 0) {
      // No longer enough sample / now profitable — keep the entry but lift disable.
      overrides.push({ ...o, disabled: o.disabled && o.reason.startsWith("manual"), reason: o.disabled && o.reason.startsWith("manual") ? o.reason : `auto-cull cleared: ${fresh ? `trades=${fresh.trades}, sharpe=${fresh.sharpe.toFixed(2)}` : "no recent closed trades"}`, at: new Date().toISOString() });
    } else {
      overrides.push({ ...o, disabled: true, reason: `auto-cull: trades=${fresh.trades}, sharpe=${fresh.sharpe.toFixed(2)} (< 0)`, at: new Date().toISOString(), stats: fresh });
    }
  }
  for (const s of stats) {
    if (overrides.some(o => o.id === s.id)) continue;
    if (s.trades < MIN_SAMPLE) continue;
    if (s.sharpe < 0) {
      overrides.push({
        id: s.id,
        disabled: true,
        reason: `auto-cull: trades=${s.trades}, sharpe=${s.sharpe.toFixed(2)} (< 0)`,
        at: new Date().toISOString(),
        stats: s,
      });
      newDisabled.push(s.id);
    }
  }

  await writeOverrides({ updatedAt: new Date().toISOString(), overrides });
  return { ran: true, stats, disabled: newDisabled };
}
