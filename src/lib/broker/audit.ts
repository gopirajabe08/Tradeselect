import { promises as fs } from "fs";
import path from "path";
import type { BrokerId } from "./adapter";
import type { PlaceOrderInput } from "./types";

/**
 * Append-only audit log for every place + cancel attempt.
 * Lives at .local-data/order-audit.log (JSON lines).
 * Used for: forensics, circuit breaker (daily order count), user-facing history.
 */

const FILE = path.join(process.cwd(), ".local-data", "order-audit.log");

export type AuditEntry = {
  at: string;                     // ISO timestamp
  broker: BrokerId | "auto-follow" | "auto-cull";
  action: "place" | "cancel" | "auto-follow" | "auto-cull";
  input: unknown;
  result: "ok" | "error";
  resultDetail?: unknown;
  errorMessage?: string;
};

async function ensureDir() {
  try { await fs.mkdir(path.dirname(FILE), { recursive: true }); } catch {}
}

export async function appendAudit(entry: AuditEntry): Promise<void> {
  await ensureDir();
  await fs.appendFile(FILE, JSON.stringify(entry) + "\n", { mode: 0o600 });
}

export async function readAudit(limit = 200): Promise<AuditEntry[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const tail = lines.slice(-limit);
    return tail.map(l => JSON.parse(l) as AuditEntry).reverse();
  } catch {
    return [];
  }
}

// ─── Circuit breaker: cap daily orders across all brokers ─────────────
const DAILY_ORDER_LIMIT = Number(process.env.DAILY_ORDER_LIMIT ?? 60);

export async function checkCircuitBreaker(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const recent = await readAudit(2000);
  const todayIso = new Date().toISOString().slice(0, 10);
  const todaysPlaces = recent.filter(e => e.action === "place" && e.at.startsWith(todayIso));
  if (todaysPlaces.length >= DAILY_ORDER_LIMIT) {
    return {
      ok: false,
      reason: `Daily order limit reached (${DAILY_ORDER_LIMIT}/day). Safety cap against runaway automation.`,
    };
  }
  return { ok: true };
}

// ─── Notional cap — hard stop on abnormally large orders ──────────────
// Env-driven so it scales with paper starting cash. With ₹1L cash, a ₹5L cap is
// useless; better to scale to ~50% of cash so a single order can't blow the account.
export const NOTIONAL_HARD_CAP = Number(process.env.NOTIONAL_HARD_CAP ?? 50_000);
export const NOTIONAL_WARN     = Number(process.env.NOTIONAL_WARN ?? 25_000);

export function computeNotional(input: PlaceOrderInput): number {
  const px = input.type === 2 ? 0 : (input.limitPrice ?? 0);       // MARKET has no price
  return px > 0 ? px * input.qty : 0;
}
