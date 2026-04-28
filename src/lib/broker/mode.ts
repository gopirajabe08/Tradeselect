import { promises as fs } from "fs";
import path from "path";
import type { BrokerId } from "./adapter";

const FILE = path.join(process.cwd(), ".local-data", "broker-mode.json");

type ModeConfig = { mode: BrokerId };

let cache: ModeConfig | null = null;
let cachedAt = 0;
const CACHE_MS = 1_000;

async function ensureDir() {
  try { await fs.mkdir(path.dirname(FILE), { recursive: true }); } catch {}
}

function defaultFromEnv(): BrokerId {
  const v = (process.env.BROKER ?? "paper").toLowerCase();
  if (v === "fyers" || v === "tradejini") return v;
  return "paper";
}

export async function readMode(): Promise<BrokerId> {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_MS) return cache.mode;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    cache = JSON.parse(raw) as ModeConfig;
  } catch {
    cache = { mode: defaultFromEnv() };
    await writeMode(cache.mode);
  }
  cachedAt = now;
  return cache.mode;
}

export async function writeMode(mode: BrokerId): Promise<void> {
  await ensureDir();
  await fs.writeFile(FILE, JSON.stringify({ mode }, null, 2), { mode: 0o600 });
  cache = { mode };
  cachedAt = Date.now();
}
