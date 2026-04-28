import { promises as fs } from "fs";
import path from "path";
import type { BrokerId } from "./adapter";

/**
 * Per-broker session storage. Fyers and Tradejini each get their own file so
 * you can stay connected to both simultaneously; the active mode (from mode.ts)
 * decides which one routes orders.
 */

export type BrokerSession = {
  brokerId: BrokerId;
  appId?: string;                   // Fyers / Tradejini app id
  accessToken: string;
  refreshToken?: string;
  userId: string;
  userName: string;
  email?: string;
  issuedAt: number;
};

const DATA_DIR = path.join(process.cwd(), ".local-data");
function fileFor(id: BrokerId) { return path.join(DATA_DIR, `session-${id}.json`); }

// Small per-broker in-memory cache
const cache = new Map<BrokerId, { at: number; session: BrokerSession | null }>();
const CACHE_MS = 2_000;

async function ensureDir() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch {}
}

export async function readBrokerSession(id: BrokerId): Promise<BrokerSession | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.session;
  try {
    const raw = await fs.readFile(fileFor(id), "utf8");
    const s = JSON.parse(raw) as BrokerSession;
    cache.set(id, { at: Date.now(), session: s });
    return s;
  } catch {
    cache.set(id, { at: Date.now(), session: null });
    return null;
  }
}

export async function writeBrokerSession(id: BrokerId, s: BrokerSession): Promise<void> {
  await ensureDir();
  await fs.writeFile(fileFor(id), JSON.stringify(s, null, 2), { mode: 0o600 });
  cache.set(id, { at: Date.now(), session: s });
}

export async function clearBrokerSession(id: BrokerId): Promise<void> {
  try { await fs.unlink(fileFor(id)); } catch {}
  cache.set(id, { at: Date.now(), session: null });
}

/** Indian broker access tokens expire at ~06:00 IST next trading day (SEBI rule). */
export function isLikelyExpired(s: BrokerSession): boolean {
  const today6amIstUTC = Date.UTC(
    new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 0, 30, 0
  );
  if (Date.now() >= today6amIstUTC) return s.issuedAt < today6amIstUTC;
  return s.issuedAt < today6amIstUTC - 24 * 3600 * 1000;
}
