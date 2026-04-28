import type { SymbolSnapshot } from "./strategies/types";

// Re-uses the NSE cookie-seeding pattern from quotes.ts.
// One batch call returns up to 500 constituents + full quote info.

const BASE = "https://www.nseindia.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120";
const UNIVERSE_INDEX = "NIFTY 500";              // full tradeable universe
const MIN_VOLUME = 50_000;                        // drop illiquid smallcaps

let cookieJar: string | null = null;
let cookieAt = 0;
const COOKIE_TTL_MS = 8 * 60 * 1000;
let seedInFlight: Promise<void> | null = null;

async function seed() {
  if (seedInFlight) return seedInFlight;
  seedInFlight = (async () => {
    try {
      const r = await fetch(`${BASE}/option-chain`, {
        headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow",
        cache: "no-store",
      });
      const setCookie = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      if (setCookie.length > 0) {
        cookieJar = setCookie.map(c => c.split(";")[0]).join("; ");
      } else {
        const raw = r.headers.get("set-cookie");
        if (raw) cookieJar = raw.split(/, (?=[A-Za-z0-9_]+=)/).map(c => c.split(";")[0]).join("; ");
      }
      cookieAt = Date.now();
    } finally {
      seedInFlight = null;
    }
  })();
  return seedInFlight;
}

async function ensureCookies() {
  if (!cookieJar || Date.now() - cookieAt > COOKIE_TTL_MS) await seed();
}

type RawRow = {
  priority?: number;
  symbol: string;
  open?: number;
  dayHigh?: number;
  dayLow?: number;
  lastPrice?: number;
  previousClose?: number;
  change?: number;
  pChange?: number;
  totalTradedVolume?: number;
  totalTradedValue?: number;
  yearHigh?: number;
  yearLow?: number;
  meta?: { symbol?: string; companyName?: string; industry?: string };
};

/**
 * Fetches today's Nifty 50 % change AND INDIA VIX in one NSE call (both come from /api/allIndices).
 */
export async function fetchMarketIndices(): Promise<{ niftyPct: number | null; vix: number | null }> {
  await ensureCookies();
  const r = await fetch(`${BASE}/api/allIndices`, {
    headers: {
      "User-Agent": UA, "Accept": "application/json",
      "Referer": `${BASE}/market-data/live-equity-market`,
      "X-Requested-With": "XMLHttpRequest",
      "Cookie": cookieJar ?? "",
    },
    cache: "no-store",
  });
  if (!r.ok) return { niftyPct: null, vix: null };
  try {
    const json = await r.json() as { data?: Array<{ index?: string; indexSymbol?: string; percentChange?: number; last?: number }> };
    const rows = json.data ?? [];
    const n50 = rows.find(x => x.index === "NIFTY 50" || x.indexSymbol === "NIFTY 50");
    const vix = rows.find(x => x.index === "INDIA VIX" || x.indexSymbol === "INDIA VIX");
    return { niftyPct: n50?.percentChange ?? null, vix: vix?.last ?? null };
  } catch {
    return { niftyPct: null, vix: null };
  }
}

/** Back-compat: just the Nifty pChange. */
export async function fetchNiftyPctChange(): Promise<number | null> {
  return (await fetchMarketIndices()).niftyPct;
}

/**
 * Fetches the Nifty 500 snapshot from NSE in one call.
 * Drops the index row (priority 1 with space in symbol) and low-volume names.
 */
export async function fetchUniverse(): Promise<SymbolSnapshot[]> {
  await ensureCookies();
  const doFetch = () => fetch(`${BASE}/api/equity-stockIndices?index=${encodeURIComponent(UNIVERSE_INDEX)}`, {
    headers: {
      "User-Agent": UA, "Accept": "application/json",
      "Referer": `${BASE}/market-data/live-equity-market`,
      "X-Requested-With": "XMLHttpRequest",
      "Cookie": cookieJar ?? "",
    },
    cache: "no-store",
  });
  let r = await doFetch();
  if (r.status === 401 || r.status === 403) {
    cookieJar = null;
    await seed();
    r = await doFetch();
  }
  if (!r.ok) {
    console.warn(`[universe] NSE ${UNIVERSE_INDEX} fetch failed:`, r.status);
    return [];
  }
  const json = await r.json() as { data?: RawRow[] };
  const raw = json.data ?? [];

  const snapshots: SymbolSnapshot[] = [];
  for (const row of raw) {
    // NSE includes the index itself as priority-1 with a symbol that contains a space.
    if (row.priority === 1 || row.symbol.includes(" ")) continue;
    if (!row.symbol || !row.lastPrice) continue;
    if ((row.totalTradedVolume ?? 0) < MIN_VOLUME) continue;

    snapshots.push({
      symbol: row.symbol,
      companyName: row.meta?.companyName,
      open: row.open ?? 0,
      dayHigh: row.dayHigh ?? 0,
      dayLow: row.dayLow ?? 0,
      lastPrice: row.lastPrice,
      previousClose: row.previousClose ?? 0,
      change: row.change ?? 0,
      pChange: row.pChange ?? 0,
      totalTradedVolume: row.totalTradedVolume ?? 0,
      totalTradedValue: row.totalTradedValue ?? 0,
      yearHigh: row.yearHigh ?? 0,
      yearLow: row.yearLow ?? 0,
      industry: row.meta?.industry,
    });
  }
  return snapshots;
}
