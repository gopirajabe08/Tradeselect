import { promises as fs } from "fs";
import path from "path";
import type { TradeCall, Segment, CallStatus } from "@/lib/mock/seed";
import { calls as seedCalls } from "@/lib/mock/seed";

const FILE = path.join(process.cwd(), ".local-data", "calls.json");

let cache: TradeCall[] | null = null;
let cacheAt = 0;
const CACHE_MS = 500;

async function ensureDir() {
  try { await fs.mkdir(path.dirname(FILE), { recursive: true }); } catch {}
}

/** Reads all calls. Seeds from the static array on first run. */
export async function readCalls(): Promise<TradeCall[]> {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    cache = JSON.parse(raw) as TradeCall[];
  } catch {
    cache = [...seedCalls];
    await writeCalls(cache);
  }
  cacheAt = Date.now();
  return cache!;
}

export async function writeCalls(calls: TradeCall[]): Promise<void> {
  await ensureDir();
  await fs.writeFile(FILE, JSON.stringify(calls, null, 2), { mode: 0o600 });
  cache = calls;
  cacheAt = Date.now();
}

function nextCallId(calls: TradeCall[]): string {
  const nums = calls
    .map(c => c.id.match(/^AP-(\d+)$/)?.[1])
    .filter((n): n is string => !!n)
    .map(Number);
  const max = nums.length ? Math.max(...nums) : 2100;
  return `AP-${max + 1}`;
}

export type NewCallInput = {
  segment: Segment;
  symbol: string;                         // e.g. "RELIANCE" or "NIFTY 24500 CE APR"
  displayName?: string;
  side: "BUY" | "SELL";
  entry: number;
  entryLow?: number;
  entryHigh?: number;
  target1: number;
  target2?: number;
  target3?: number;
  stopLoss: number;
  horizon: string;
  analyst: string;
  rationale: string;
};

export function validateNewCall(input: Partial<NewCallInput>): NewCallInput | string {
  if (!input) return "invalid body";
  const req = ["segment","symbol","side","entry","target1","stopLoss","horizon","analyst","rationale"] as const;
  for (const k of req) if (input[k] == null || input[k] === "") return `missing: ${k}`;
  const segs: Segment[] = ["Equity","Intraday","Swing","BTST","Positional","Futures","Options","MCX"];
  if (!segs.includes(input.segment as Segment)) return "invalid segment";
  if (input.side !== "BUY" && input.side !== "SELL") return "side must be BUY or SELL";
  const entry = Number(input.entry);
  const t1 = Number(input.target1);
  const sl = Number(input.stopLoss);
  if (!Number.isFinite(entry) || entry <= 0) return "entry must be > 0";
  if (!Number.isFinite(t1) || t1 <= 0) return "target1 must be > 0";
  if (!Number.isFinite(sl) || sl <= 0) return "stopLoss must be > 0";

  // Direction sanity
  if (input.side === "BUY" && !(t1 > entry && sl < entry)) return "BUY: target1 must be > entry and stopLoss < entry";
  if (input.side === "SELL" && !(t1 < entry && sl > entry)) return "SELL: target1 must be < entry and stopLoss > entry";

  return {
    segment: input.segment as Segment,
    symbol: String(input.symbol).toUpperCase().trim(),
    displayName: input.displayName ? String(input.displayName).trim() : undefined,
    side: input.side,
    entry,
    entryLow:  input.entryLow  != null ? Number(input.entryLow)  : undefined,
    entryHigh: input.entryHigh != null ? Number(input.entryHigh) : undefined,
    target1: t1,
    target2: input.target2 != null ? Number(input.target2) : undefined,
    target3: input.target3 != null ? Number(input.target3) : undefined,
    stopLoss: sl,
    horizon: String(input.horizon).trim(),
    analyst: String(input.analyst).trim(),
    rationale: String(input.rationale).trim(),
  };
}

export async function addCall(input: NewCallInput): Promise<TradeCall> {
  const calls = await readCalls();
  const id = nextCallId(calls);
  const call: TradeCall = {
    id,
    segment: input.segment,
    symbol: input.symbol,
    displayName: input.displayName,
    side: input.side,
    entry: input.entry,
    entryLow: input.entryLow,
    entryHigh: input.entryHigh,
    target1: input.target1,
    target2: input.target2,
    target3: input.target3,
    stopLoss: input.stopLoss,
    horizon: input.horizon,
    status: "Active" as CallStatus,
    issuedAt: new Date().toISOString(),
    analyst: input.analyst,
    rationale: input.rationale,
    ltp: input.entry,
  };
  await writeCalls([call, ...calls]);
  return call;
}

export async function updateCall(id: string, patch: Partial<TradeCall>): Promise<TradeCall | null> {
  const calls = await readCalls();
  const idx = calls.findIndex(c => c.id === id);
  if (idx < 0) return null;
  calls[idx] = { ...calls[idx], ...patch };
  await writeCalls(calls);
  return calls[idx];
}

export async function deleteCall(id: string): Promise<boolean> {
  const calls = await readCalls();
  const next = calls.filter(c => c.id !== id);
  if (next.length === calls.length) return false;
  await writeCalls(next);
  return true;
}
