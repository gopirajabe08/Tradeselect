/**
 * NSE F&O ban-list — daily-refreshed list of stocks that have crossed the
 * 95% market-wide position limit. Trading-veteran's #1 rule: never carry
 * a fresh F&O position on a ban-list stock; the broker will force-exit at
 * penalty. INTRADAY equity is allowed but bracket exits get unreliable.
 *
 * Source: NSE publishes via /api/quote-equity? — but the most reliable feed
 * is /api/secBan or /api/marketStatus. For paper-mode safety, we fetch
 * once per IST day and cache to disk.
 *
 * If the fetch fails (NSE rate-limits etc), we fall back to the cached
 * list. Empty list = treat as "no bans known" — auto-follow proceeds.
 *
 * For day-1 deployment we ship with empty cache; the daily fetcher fires on
 * first scheduler tick of the day. Auto-follow consults `isOnBanList()`
 * before placing.
 */
import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), ".local-data", "fno-ban-list.json");

type BanCache = { fetchedAt: string; date: string; symbols: string[] };

let cache: BanCache | null = null;

export async function readBanList(): Promise<BanCache> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    cache = JSON.parse(raw) as BanCache;
    return cache;
  } catch {
    return { fetchedAt: new Date(0).toISOString(), date: "", symbols: [] };
  }
}

async function writeBanList(c: BanCache): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
  cache = c;
}

/** Strips `NSE:` prefix and `-EQ` suffix to get the core symbol (e.g. RELIANCE). */
function normalize(symbol: string): string {
  return symbol.replace(/^(NSE|BSE|NFO):/, "").replace(/-EQ$/i, "").toUpperCase();
}

export async function isOnBanList(symbol: string): Promise<boolean> {
  const list = await readBanList();
  return list.symbols.includes(normalize(symbol));
}

/** Refreshes the ban list from NSE if today's hasn't been fetched yet. */
export async function refreshBanList(): Promise<{ refreshed: boolean; count: number; reason?: string }> {
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const cached = await readBanList();
  if (cached.date === today) return { refreshed: false, count: cached.symbols.length, reason: "already fetched today" };

  // NSE F&O ban list endpoint. Falls back to empty on failure.
  try {
    const { nseGet } = await import("@/lib/broker/paper/quotes");
    const resp = await nseGet<any>("/api/equity-stockIndices?index=SECURITIES%20IN%20BAN");
    const symbols: string[] = (resp?.data ?? [])
      .map((d: any) => normalize(String(d.symbol ?? "")))
      .filter(Boolean);
    await writeBanList({ fetchedAt: new Date().toISOString(), date: today, symbols });
    console.log(`[ban-list] refreshed: ${symbols.length} symbols on F&O ban for ${today}`);
    return { refreshed: true, count: symbols.length };
  } catch (e) {
    // Fall back to whatever's cached
    console.warn(`[ban-list] refresh failed (will use stale cache): ${(e as Error).message}`);
    return { refreshed: false, count: cached.symbols.length, reason: (e as Error).message };
  }
}
