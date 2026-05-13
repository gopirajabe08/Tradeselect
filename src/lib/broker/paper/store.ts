import { promises as fs } from "fs";
import path from "path";

// Default (legacy) paper state path — equity-intraday account.
// Multi-instrument support: callers pass an explicit path via readStateAt / writeStateAt.
// See src/lib/instruments/registry.ts for per-instrument paths.
const LEGACY_DATA_DIR = path.join(process.cwd(), ".local-data", "paper");
const LEGACY_FILE = path.join(LEGACY_DATA_DIR, "state.json");

/** Resolve a paper-state file path from an instrument's `paperStatePath` config field. */
function resolveStatePath(relPath?: string): { dir: string; file: string } {
  if (!relPath) return { dir: LEGACY_DATA_DIR, file: LEGACY_FILE };
  const file = path.join(process.cwd(), ".local-data", relPath);
  const dir = path.dirname(file);
  return { dir, file };
}

export type PaperOrder = {
  id: string;
  createdAt: number;
  symbol: string;            // e.g. "NSE:RELIANCE-EQ"
  side: 1 | -1;              // 1 buy, -1 sell
  type: 1 | 2 | 3 | 4;       // 1 Limit, 2 Market, 3 SL-M, 4 SL
  productType: "CNC" | "INTRADAY" | "MARGIN" | "CO" | "BO" | "MTF";
  qty: number;
  limitPrice: number;
  stopPrice: number;
  validity: "DAY" | "IOC";
  orderTag?: string;
  /** OCO group: when one order in the group fills, all other open orders in the same group are auto-cancelled.
   *  Used by auto-follow to bracket an entry with paired SL-M + LIMIT exit legs. */
  ocoGroup?: string;
  /** Strategy that originated this order. Stamped at place time so engine can flow it through to position
   *  on fill. Enables max-hold-days enforcement and per-strategy attribution. */
  strategyId?: string;
  /** Max holding days for the resulting position. Copied to PaperPosition on opening fill.
   *  Frozen at place time so live changes to the strategy don't retroactively change open positions. */
  maxHoldDays?: number;
  status: 1 | 2 | 3 | 4 | 6; // 2 filled, 6 open, 4 transit, 1 cancelled, 3 rejected (Fyers-compatible)
  filledQty: number;
  tradedPrice: number;       // average fill
  message?: string;
  filledAt?: number;
};

export type PaperPosition = {
  id: string;
  symbol: string;
  productType: PaperOrder["productType"];
  netQty: number;            // +ve long, -ve short
  netAvg: number;            // avg price across fills (open side)
  buyQty: number;
  buyAvg: number;
  sellQty: number;
  sellAvg: number;
  realized: number;          // P&L locked in
  ltp: number;               // last seen market price
  /** Strategy that opened this position. Set on the opening fill; PRESERVED across close
   *  for per-strategy P&L analysis (was cleared previously, broke analysis — fix 2026-05-09). */
  strategyId?: string;
  /** ms timestamp of the fill that opened the current direction. Used by max-hold-exit + analysis. */
  openedAt?: number;
  /** Max holding days frozen at open time. Max-hold-exit closes the position when (now - openedAt) ≥ this value. */
  maxHoldDays?: number;
  /** ms timestamp when netQty returned to 0 (position fully closed). For per-period P&L attribution. */
  closedAt?: number;
  /** Average exit price (sellAvg for long-closes, buyAvg for short-closes). Computed at close. */
  closedPrice?: number;
  /** How the position closed: "target" / "stop" / "max-hold-exit" / "intraday-squareoff" / "manual" */
  closedReason?: string;
};

export type PaperHolding = {
  id: number;
  symbol: string;
  quantity: number;
  costPrice: number;
  ltp: number;
  marketVal: number;
  pl: number;
};

export type PaperState = {
  startingCash: number;
  cash: number;
  orders: PaperOrder[];
  positions: PaperPosition[];
  holdings: PaperHolding[];
  lastOrderSeq: number;
  createdAt: number;
  /** Cash at start of the current IST trading day. Used by daily-loss circuit breaker.
   *  Rolls forward on first activity each day. */
  dayStartCash?: number;
  dayStartIstDate?: string;       // YYYY-MM-DD in IST
  /** Cumulative paper-mode transaction costs since last reset (₹).
   *  Lets the user see what real-broker fees would have eaten. */
  totalCosts?: number;
  /** Realized P&L credited TODAY only (resets at IST midnight rollover via ensureDayStart).
   *  Distinct from per-position cumulative `realized` — that field never resets, so summing
   *  it gives lifetime P&L, not today's. EOD briefing should use this for "today's P&L". */
  dayRealized?: number;
  /** Costs incurred TODAY only — same reset cycle. Lets briefings show today's drag. */
  dayCosts?: number;
};

const DEFAULT_STARTING_CASH = Number(process.env.PAPER_STARTING_CASH ?? 1_000_000);

function initial(): PaperState {
  return {
    startingCash: DEFAULT_STARTING_CASH,
    cash: DEFAULT_STARTING_CASH,
    orders: [],
    positions: [],
    holdings: [],
    lastOrderSeq: 10000,
    createdAt: Date.now(),
  };
}

async function ensureDir(dir: string) {
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
}

/**
 * Read paper state for a specific instrument's path.
 * Always reads fresh from disk (no caching). Disk reads are ~5ms for a ~50KB state file —
 * cheap enough that we trade them for correctness.
 *
 * Why no cache: previously cached state by REFERENCE for 500ms. Two concurrent code paths
 * (e.g. auto-follow placeOrder + matcher bracket-fire) could read the same reference,
 * mutate independently, and the later `writeState` would clobber the earlier mutations
 * because both wrote the SAME ref but only the last one's content survived if they had
 * diverged via separate fresh reads in the meantime. Surfaced 2026-05-13 when NIVABUPA's
 * BUY entry order was lost — position.buyQty=0, lastOrderSeq shifted by 1, phantom short
 * created when the bracket target fired.
 *
 * Callers that need atomic read-mutate-write must use `withStateMutation` (below) which
 * serializes via a module-level lock. Read-only callers can use `readStateAt` directly.
 */
export async function readStateAt(relPath?: string): Promise<PaperState> {
  const { dir, file } = resolveStatePath(relPath);
  await ensureDir(dir);
  let state: PaperState;
  try {
    const raw = await fs.readFile(file, "utf8");
    state = JSON.parse(raw) as PaperState;
  } catch {
    state = initial();
    await writeStateAt(state, relPath);
  }
  return state;
}

/** Write paper state to a specific instrument's path. */
export async function writeStateAt(s: PaperState, relPath?: string): Promise<void> {
  const { dir, file } = resolveStatePath(relPath);
  await ensureDir(dir);
  await fs.writeFile(file, JSON.stringify(s, null, 2), { mode: 0o600 });
}

/**
 * Serialized read-mutate-write helper. The mutator gets a FRESH state snapshot,
 * mutates it in place, and the wrapper writes it back — all under a per-path mutex.
 *
 * Use this for ANY code path that needs to mutate paper state. Examples:
 *   await withStateMutation(async (s) => { s.orders.push(order); applyFill(s, ...); });
 *
 * Why: prevents the race where two concurrent paths read the same disk state, each
 * computes a divergent mutation, and the later writer overwrites the earlier writer's
 * changes. See readStateAt for the NIVABUPA-class loss this fixes.
 */
const writeLocks = new Map<string, Promise<unknown>>();

export async function withStateMutation<T>(
  mutator: (s: PaperState) => T | Promise<T>,
  relPath?: string,
): Promise<T> {
  const { file } = resolveStatePath(relPath);
  const prev = writeLocks.get(file) ?? Promise.resolve();
  let releaseFn: () => void = () => {};
  const next = new Promise<void>(resolve => { releaseFn = resolve; });
  writeLocks.set(file, next);
  try {
    await prev;
    const s = await readStateAt(relPath);
    const result = await mutator(s);
    await writeStateAt(s, relPath);
    return result;
  } finally {
    releaseFn();
    // Clean up the map entry if no further awaiters chained on — keeps the map bounded.
    if (writeLocks.get(file) === next) writeLocks.delete(file);
  }
}

/** Legacy back-compat — reads/writes equity-intraday default path. */
export async function readState(): Promise<PaperState> {
  return readStateAt();
}

export async function writeState(s: PaperState): Promise<void> {
  return writeStateAt(s);
}

/** Reset state at a specific instrument's path with given starting capital. */
export async function resetStateAt(startingCash: number, relPath?: string): Promise<PaperState> {
  const fresh: PaperState = { ...initial(), startingCash, cash: startingCash };
  await writeStateAt(fresh, relPath);
  return fresh;
}

/** Legacy back-compat — resets equity-intraday default path. */
export async function resetState(startingCash = DEFAULT_STARTING_CASH): Promise<PaperState> {
  return resetStateAt(startingCash);
}

export function newOrderId(s: PaperState): string {
  s.lastOrderSeq += 1;
  return `PAPER-${s.lastOrderSeq}`;
}

/** Returns YYYY-MM-DD in IST. */
function istDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Stamps `dayStartCash` for the current IST date if today's stamp is missing or stale.
 * Also resets `dayRealized` and `dayCosts` so per-day P&L doesn't carry over.
 * Mutates `s` in place. Caller must persist if mutated.
 * Returns true if state was rolled forward.
 */
export function ensureDayStart(s: PaperState): boolean {
  const today = istDateString();
  if (s.dayStartIstDate === today && s.dayStartCash != null) return false;
  s.dayStartIstDate = today;
  s.dayStartCash = s.cash;
  s.dayRealized = 0;
  s.dayCosts = 0;
  return true;
}
