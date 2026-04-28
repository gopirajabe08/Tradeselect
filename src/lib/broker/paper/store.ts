import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".local-data", "paper");
const FILE = path.join(DATA_DIR, "state.json");

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

let cached: PaperState | null = null;
let cachedAt = 0;
const CACHE_MS = 500;

async function ensureDir() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch {}
}

export async function readState(): Promise<PaperState> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_MS) return cached;
  await ensureDir();
  try {
    const raw = await fs.readFile(FILE, "utf8");
    cached = JSON.parse(raw) as PaperState;
  } catch {
    cached = initial();
    await writeState(cached);
  }
  cachedAt = now;
  return cached;
}

export async function writeState(s: PaperState): Promise<void> {
  await ensureDir();
  await fs.writeFile(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
  cached = s;
  cachedAt = Date.now();
}

export async function resetState(startingCash = DEFAULT_STARTING_CASH): Promise<PaperState> {
  const fresh: PaperState = { ...initial(), startingCash, cash: startingCash };
  await writeState(fresh);
  return fresh;
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
 * Mutates `s` in place. Caller must persist if mutated.
 * Returns true if state was rolled forward.
 */
export function ensureDayStart(s: PaperState): boolean {
  const today = istDateString();
  if (s.dayStartIstDate === today && s.dayStartCash != null) return false;
  s.dayStartIstDate = today;
  s.dayStartCash = s.cash;
  return true;
}
