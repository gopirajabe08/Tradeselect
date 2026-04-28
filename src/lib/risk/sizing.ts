import { promises as fs } from "fs";
import path from "path";
import { lotSizeFor, isFnoOrMcxSymbol } from "@/lib/broker/contract-rules";

/**
 * Position sizing using the risk-parity rule: every trade risks the same % of your account.
 *
 *   maxLoss    = accountSize × riskPct
 *   slDistance = |entry − stopLoss|
 *   qty        = floor(maxLoss / slDistance)
 *
 * For F&O / MCX: qty is floored to the nearest lot-size multiple.
 */

export type RiskConfig = {
  accountSize: number;         // ₹
  riskPct: number;             // e.g. 1 = 1 % of account per trade
  /** Halt trading after this much daily loss (% of day-start cash). 0 disables. */
  dailyMaxLossPct: number;     // e.g. 2 = halt after −2 % day
};

const DEFAULT: RiskConfig = {
  accountSize: Number(process.env.PAPER_STARTING_CASH ?? 100_000),
  riskPct: 1,
  dailyMaxLossPct: 2,
};
const FILE = path.join(process.cwd(), ".local-data", "risk-config.json");

let cache: RiskConfig | null = null;
let cachedAt = 0;

async function ensureDir() {
  try { await fs.mkdir(path.dirname(FILE), { recursive: true }); } catch {}
}

export async function readRiskConfig(): Promise<RiskConfig> {
  if (cache && Date.now() - cachedAt < 2_000) return cache;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    cache = { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    cache = DEFAULT;
  }
  cachedAt = Date.now();
  return cache!;
}

export async function writeRiskConfig(cfg: Partial<RiskConfig>): Promise<RiskConfig> {
  await ensureDir();
  const merged = { ...await readRiskConfig(), ...cfg };
  await fs.writeFile(FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
  cache = merged;
  cachedAt = Date.now();
  return merged;
}

export type SizingInput = {
  symbol: string;          // Fyers-format, e.g. "NSE:RELIANCE-EQ"
  entry: number;
  stopLoss: number;
  accountSize?: number;    // override risk-config
  riskPct?: number;
};

export type SizingResult = {
  recommendedQty: number;
  slDistance: number;
  maxLossRs: number;
  notional: number;
  lotSize: number | null;
  reason?: string;         // non-empty when sizing was constrained (e.g. "rounded down to lot size")
};

export function computeSizing(input: SizingInput, cfg: RiskConfig): SizingResult {
  const accountSize = input.accountSize ?? cfg.accountSize;
  const riskPct     = input.riskPct     ?? cfg.riskPct;
  const maxLossRs   = (accountSize * riskPct) / 100;
  const slDistance  = Math.abs(input.entry - input.stopLoss);

  if (slDistance <= 0 || input.entry <= 0) {
    return { recommendedQty: 0, slDistance, maxLossRs, notional: 0, lotSize: null, reason: "invalid entry/SL" };
  }

  let qty = Math.floor(maxLossRs / slDistance);
  const isFno = isFnoOrMcxSymbol(input.symbol);
  const lot = lotSizeFor(input.symbol, isFno);

  let reason: string | undefined;
  if (lot !== null) {
    const lots = Math.floor(qty / lot);
    if (lots < 1) {
      reason = `Risk budget ₹${maxLossRs.toFixed(0)} is below one lot (${lot}) × SL distance ₹${slDistance.toFixed(2)}. Increase risk % or widen SL.`;
      qty = 0;
    } else {
      const adjusted = lots * lot;
      if (adjusted !== qty) reason = `Rounded to ${lots} lot${lots>1?"s":""} (${adjusted} shares)`;
      qty = adjusted;
    }
  }

  return {
    recommendedQty: Math.max(0, qty),
    slDistance,
    maxLossRs,
    notional: qty * input.entry,
    lotSize: lot,
    reason,
  };
}
