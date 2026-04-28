import { readCalls, writeCalls } from "./store";
import { getLtp } from "@/lib/broker/paper/quotes";
import { notifyCallMatched } from "@/lib/notify/telegram";

// Segments that have live NSE equity prices we can rebase against.
// F&O / Options / MCX need a broker feed; those calls stay Active until manually closed.
const LIVE_SEGMENTS = new Set(["Equity", "Intraday", "Swing", "BTST", "Positional"]);

let inFlight: Promise<void> | null = null;
let lastAt = 0;
const MATCH_TTL_MS = 15_000;

/** Forces the next matcher call to actually run, bypassing the TTL. */
export function invalidateCallMatcher() {
  lastAt = 0;
}

/**
 * Fire-and-forget call matcher. Returns immediately; background job fetches live
 * NSE LTPs for all Active equity-style calls and transitions status when target1
 * or stopLoss is crossed. Next read sees the updated state.
 */
export function triggerCallMatcher() {
  if (inFlight || Date.now() - lastAt < MATCH_TTL_MS) return;
  inFlight = runMatch()
    .catch(e => console.warn("[calls] matcher failed:", (e as Error).message))
    .finally(() => { inFlight = null; });
}

/** For callers that want to await the latest snapshot (e.g. tests). */
export async function awaitCallMatch(): Promise<void> {
  if (inFlight) { await inFlight; return; }
  if (Date.now() - lastAt >= MATCH_TTL_MS) {
    inFlight = runMatch()
      .catch(e => console.warn("[calls] matcher failed:", (e as Error).message))
      .finally(() => { inFlight = null; });
    await inFlight;
  }
}

async function runMatch(): Promise<void> {
  const calls = await readCalls();
  const active = calls.filter(c => c.status === "Active" && LIVE_SEGMENTS.has(c.segment));
  if (active.length === 0) { lastAt = Date.now(); return; }

  const symbols = Array.from(new Set(active.map(c => c.symbol)));
  const ltps = await Promise.all(symbols.map(s => getLtp(s).catch(() => null)));
  const ltpMap = new Map<string, number>();
  symbols.forEach((s, i) => { const v = ltps[i]; if (typeof v === "number") ltpMap.set(s, v); });

  const now = new Date().toISOString();
  let mutated = false;
  const transitions: Array<{ symbol: string; outcome: "TARGET_HIT" | "STOP_HIT"; entry?: number; exit?: number; pnlPct?: number }> = [];

  for (const c of calls) {
    if (c.status !== "Active") continue;
    if (!LIVE_SEGMENTS.has(c.segment)) continue;
    const ltp = ltpMap.get(c.symbol);
    if (ltp == null) continue;

    // Mark-to-market every call we have a price for
    if (c.ltp !== ltp) { c.ltp = ltp; mutated = true; }

    if (c.side === "BUY") {
      if (ltp >= c.target1) {
        c.status = "Target Hit";
        c.closedPrice = c.target1;    // conservative fill at target
        c.closedAt = now;
        mutated = true;
        transitions.push({ symbol: c.symbol, outcome: "TARGET_HIT", entry: c.entry, exit: c.target1, pnlPct: c.entry ? ((c.target1 - c.entry) / c.entry) * 100 : undefined });
      } else if (ltp <= c.stopLoss) {
        c.status = "SL Hit";
        c.closedPrice = c.stopLoss;
        c.closedAt = now;
        mutated = true;
        transitions.push({ symbol: c.symbol, outcome: "STOP_HIT", entry: c.entry, exit: c.stopLoss, pnlPct: c.entry ? ((c.stopLoss - c.entry) / c.entry) * 100 : undefined });
      }
    } else { // SELL
      if (ltp <= c.target1) {
        c.status = "Target Hit";
        c.closedPrice = c.target1;
        c.closedAt = now;
        mutated = true;
        transitions.push({ symbol: c.symbol, outcome: "TARGET_HIT", entry: c.entry, exit: c.target1, pnlPct: c.entry ? ((c.entry - c.target1) / c.entry) * 100 : undefined });
      } else if (ltp >= c.stopLoss) {
        c.status = "SL Hit";
        c.closedPrice = c.stopLoss;
        c.closedAt = now;
        mutated = true;
        transitions.push({ symbol: c.symbol, outcome: "STOP_HIT", entry: c.entry, exit: c.stopLoss, pnlPct: c.entry ? ((c.entry - c.stopLoss) / c.entry) * 100 : undefined });
      }
    }
  }

  if (mutated) await writeCalls(calls);
  lastAt = Date.now();

  // Fire-and-forget Telegram pings — never block the matcher.
  for (const t of transitions) {
    notifyCallMatched(t).catch(() => {});
  }
}
