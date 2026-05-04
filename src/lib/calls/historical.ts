// Historical OHLC fetcher. Uses NSE India primary (cookie-seeded, same as our live feed)
// with Yahoo v8 chart as fallback. NSE returns ~250 trading days/year per call.

import type { SymbolSnapshot } from "./strategies/types";

const NSE_BASE = "https://www.nseindia.com";
const YH_BASE  = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120";

export type HistoricalBar = {
  t: number;     // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

// Cookie jar shared across calls (same pattern as universe.ts).
let cookieJar: string | null = null;
let cookieAt = 0;
const COOKIE_TTL_MS = 8 * 60 * 1000;
let seedInFlight: Promise<void> | null = null;

async function seedNseCookies() {
  if (seedInFlight) return seedInFlight;
  seedInFlight = (async () => {
    try {
      const r = await fetch(`${NSE_BASE}/option-chain`, {
        headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow",
        cache: "no-store",
      });
      const setCookie = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      if (setCookie.length > 0) cookieJar = setCookie.map(c => c.split(";")[0]).join("; ");
    } finally {
      seedInFlight = null;
    }
  })();
  return seedInFlight;
}

async function ensureNseCookies() {
  if (!cookieJar || Date.now() - cookieAt > COOKIE_TTL_MS) {
    await seedNseCookies();
    cookieAt = Date.now();
  }
}

function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}-${mm}-${yy}`;
}

type NseHistRow = {
  CH_TIMESTAMP: string;
  CH_OPENING_PRICE?: number;
  CH_TRADE_HIGH_PRICE?: number;
  CH_TRADE_LOW_PRICE?: number;
  CH_CLOSING_PRICE?: number;
  CH_TOT_TRADED_QTY?: number;
};

async function fetchNseHistorical(symbol: string, days: number): Promise<HistoricalBar[]> {
  await ensureNseCookies();
  const to = new Date();
  const from = new Date(Date.now() - days * 24 * 3600 * 1000);
  // Current NSE historical endpoint (changed from /api/historical/cm/equity in 2025).
  const url = `${NSE_BASE}/api/historicalOR/cm/equity?symbol=${encodeURIComponent(symbol)}&series=%5B%22EQ%22%5D&from=${ddmmyyyy(from)}&to=${ddmmyyyy(to)}`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
        "Referer": `${NSE_BASE}/market-data/securities-available-for-trading`,
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": cookieJar ?? "",
      },
      cache: "no-store",
    });
    if (!r.ok) return [];
    const json = await r.json() as { data?: NseHistRow[] };
    const raw = (json.data ?? []).filter(row => row.CH_CLOSING_PRICE && row.CH_TIMESTAMP);
    // Sort ascending by date
    raw.sort((a, b) => a.CH_TIMESTAMP.localeCompare(b.CH_TIMESTAMP));
    return raw.map(row => ({
      t: Math.floor(Date.parse(row.CH_TIMESTAMP) / 1000),
      o: Number(row.CH_OPENING_PRICE) || Number(row.CH_CLOSING_PRICE) || 0,
      h: Number(row.CH_TRADE_HIGH_PRICE) || Number(row.CH_CLOSING_PRICE) || 0,
      l: Number(row.CH_TRADE_LOW_PRICE)  || Number(row.CH_CLOSING_PRICE) || 0,
      c: Number(row.CH_CLOSING_PRICE) || 0,
      v: Number(row.CH_TOT_TRADED_QTY) || 0,
    }));
  } catch {
    return [];
  }
}

async function fetchYahooHistorical(symbol: string, range: string): Promise<HistoricalBar[]> {
  const psym = symbol.includes(".") ? symbol : `${symbol}.NS`;
  const url = `${YH_BASE}/${encodeURIComponent(psym)}?range=${range}&interval=1d`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json() as any;
    const result = j?.chart?.result?.[0];
    const ts = result?.timestamp as number[] | undefined;
    const q  = result?.indicators?.quote?.[0];
    if (!ts || !q) return [];
    const bars: HistoricalBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = q.close?.[i];
      if (c == null) continue;
      bars.push({
        t: ts[i], o: q.open?.[i] ?? c, h: q.high?.[i] ?? c, l: q.low?.[i] ?? c, c,
        v: q.volume?.[i] ?? 0,
      });
    }
    return bars;
  } catch {
    return [];
  }
}

/**
 * Fetches daily OHLC bars for `range` months. NSE primary, Yahoo fallback.
 */
export async function fetchDailyBars(symbol: string, range = "3mo"): Promise<HistoricalBar[]> {
  const months = range === "1mo" ? 1 : range === "3mo" ? 3 : range === "6mo" ? 6 : range === "1y" ? 12 : 3;
  const days = months * 31;

  // Try NSE first
  const nseBars = await fetchNseHistorical(symbol, days);
  if (nseBars.length >= 10) return nseBars;

  // Fallback to Yahoo
  const yBars = await fetchYahooHistorical(symbol, range);
  return yBars;
}

/**
 * Build a SymbolSnapshot for a historical bar `i` (as if we stood there on that day).
 */
export function barToSnapshot(symbol: string, bars: HistoricalBar[], i: number): SymbolSnapshot | null {
  if (i < 1 || i >= bars.length) return null;
  const cur  = bars[i];
  const prev = bars[i - 1];
  const from = Math.max(0, i - 252);
  const window = bars.slice(from, i + 1);
  const yearHigh = Math.max(...window.map(b => b.h));
  const yearLow  = Math.min(...window.map(b => b.l));
  const totalTradedValue = cur.v * cur.c;

  // 20-day relative volume (RVOL). Used by NSE-veteran strategies to detect
  // institutional accumulation. Falls back to 1.0 if insufficient history.
  const volWindow = bars.slice(Math.max(0, i - 20), i);
  let volumeRel20d: number | undefined;
  if (volWindow.length >= 5) {
    const avgVol = volWindow.reduce((s, b) => s + b.v, 0) / volWindow.length;
    if (avgVol > 0) volumeRel20d = cur.v / avgVol;
  }

  // Range contraction detection — feeds Volatility-Contraction Breakout strategy.
  // NR4/NR7 = today's high-low is the narrowest of the last 4/7 trading days.
  // rangeRel7d = today's range / median of prior 7 days' ranges. <0.6 = strong contraction.
  const todayRange = cur.h - cur.l;
  let isNR4: boolean | undefined;
  let isNR7: boolean | undefined;
  let rangeRel7d: number | undefined;
  if (i >= 7) {
    const last7Ranges = bars.slice(i - 7, i).map(b => b.h - b.l);
    const last4Ranges = bars.slice(i - 4, i).map(b => b.h - b.l);
    isNR4 = last4Ranges.every(r => todayRange <= r);
    isNR7 = last7Ranges.every(r => todayRange <= r);
    const sortedRanges = [...last7Ranges].sort((a, b) => a - b);
    const median = sortedRanges[Math.floor(sortedRanges.length / 2)];
    if (median > 0) rangeRel7d = todayRange / median;
  }

  return {
    symbol,
    open: cur.o,
    dayHigh: cur.h,
    dayLow: cur.l,
    lastPrice: cur.c,
    previousClose: prev.c,
    change: cur.c - prev.c,
    pChange: ((cur.c - prev.c) / prev.c) * 100,
    totalTradedVolume: cur.v,
    totalTradedValue,
    yearHigh,
    yearLow,
    volumeRel20d,
    rangeRel7d,
    isNR4,
    isNR7,
  };
}

export async function withLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
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
