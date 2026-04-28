// Minimal NSE India price fetcher for paper-mode fills.
// Used only to get LTP so paper orders fill at something realistic.
// For F&O / MCX symbols not on NSE equity, we return null and the
// engine falls back to the order's reference price.

const BASE = "https://www.nseindia.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

let cookieJar: string | null = null;
let cookieAt  = 0;
const COOKIE_TTL_MS = 8 * 60 * 1000;
let seedInFlight: Promise<void> | null = null;

async function seed() {
  if (seedInFlight) return seedInFlight;
  seedInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/option-chain`, {
        headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow",
        cache: "no-store",
      });
      const setCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      if (setCookie.length > 0) {
        cookieJar = setCookie.map(c => c.split(";")[0]).join("; ");
      } else {
        const raw = res.headers.get("set-cookie");
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

export async function nseGet<T>(path: string): Promise<T | null> {
  await ensureCookies();
  const doFetch = () => fetch(`${BASE}${path}`, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/plain, */*",
      "Referer": `${BASE}/market-data/live-equity-market`,
      "X-Requested-With": "XMLHttpRequest",
      "Cookie": cookieJar ?? "",
    },
    cache: "no-store",
  });
  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    cookieJar = null;
    await seed();
    res = await doFetch();
  }
  if (!res.ok) return null;
  try { return await res.json() as T; } catch { return null; }
}

type QuoteEquityResp = {
  priceInfo?: {
    lastPrice: number;
    open: number;
    close: number;
    previousClose: number;
    intraDayHighLow?: { min: number; max: number };
    weekHighLow?: { min: number; max: number };
    change: number;
    pChange: number;
  };
  info?: { symbol: string; companyName?: string };
};

// Cache per symbol for a short TTL to avoid hammering NSE.
const quoteCache = new Map<string, { at: number; ltp: number }>();
const QUOTE_TTL_MS = 5_000;

/**
 * Returns the last traded price for an NSE equity symbol (e.g. "RELIANCE"),
 * or null if NSE returns nothing / the symbol isn't an NSE equity.
 */
export async function getLtp(displaySymbol: string): Promise<number | null> {
  // Strip any exchange prefix / -EQ suffix the caller might pass.
  const sym = displaySymbol.replace(/^(NSE|BSE|NFO|MCX):/, "").replace(/-EQ$/i, "").toUpperCase();

  const cached = quoteCache.get(sym);
  if (cached && Date.now() - cached.at < QUOTE_TTL_MS) return cached.ltp;

  const resp = await nseGet<QuoteEquityResp>(`/api/quote-equity?symbol=${encodeURIComponent(sym)}`);
  const ltp = resp?.priceInfo?.lastPrice;
  if (typeof ltp !== "number" || !Number.isFinite(ltp) || ltp <= 0) return null;

  quoteCache.set(sym, { at: Date.now(), ltp });
  return ltp;
}

/**
 * Returns a best-effort price: NSE LTP if available, otherwise the fallback.
 * Callers use this when placing MARKET orders — if NSE can't be reached
 * (network / F&O / MCX), we fall back to the provided reference.
 */
export async function getFillPrice(displaySymbol: string, fallback: number): Promise<number> {
  const ltp = await getLtp(displaySymbol);
  return ltp ?? fallback;
}
