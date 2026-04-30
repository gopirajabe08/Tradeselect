import { promises as fs } from "fs";
import path from "path";
import { lotSizeFor, isFnoOrMcxSymbol } from "@/lib/broker/contract-rules";
import { NOTIONAL_HARD_CAP } from "@/lib/broker/audit";

/**
 * Position sizing using the risk-parity rule: every trade risks the same % of your account.
 *
 *   maxLoss    = accountSize × riskPct
 *   slDistance = |entry − stopLoss|
 *   qtyByRisk  = floor(maxLoss / slDistance)
 *   qtyByCap   = floor(notionalCap / entry)
 *   qty        = min(qtyByRisk, qtyByCap)
 *
 * The notional cap is the second line of defense after risk-per-trade. On high-priced
 * stocks with tight stops, risk-only sizing produces qty × entry that exceeds the
 * broker's hard cap → broker rejects the order entirely → no trade is placed.
 * Capping qty by notional here means we still place a (smaller) trade instead of none.
 *
 * For F&O / MCX: qty is floored to the nearest lot-size multiple after both caps.
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
  /** Hard cap on notional (qty × entry). Default = NOTIONAL_HARD_CAP. */
  notionalCap?: number;
};

export type SizingResult = {
  recommendedQty: number;
  slDistance: number;
  maxLossRs: number;
  notional: number;
  lotSize: number | null;
  reason?: string;         // non-empty when sizing was constrained (lot-size, notional cap, etc.)
  cappedByNotional?: boolean;
};

export function computeSizing(input: SizingInput, cfg: RiskConfig): SizingResult {
  const accountSize = input.accountSize ?? cfg.accountSize;
  const riskPct     = input.riskPct     ?? cfg.riskPct;
  const notionalCap = input.notionalCap ?? NOTIONAL_HARD_CAP;
  const maxLossRs   = (accountSize * riskPct) / 100;
  const slDistance  = Math.abs(input.entry - input.stopLoss);

  if (slDistance <= 0 || input.entry <= 0) {
    return { recommendedQty: 0, slDistance, maxLossRs, notional: 0, lotSize: null, reason: "invalid entry/SL" };
  }

  const qtyByRisk = Math.floor(maxLossRs / slDistance);
  const qtyByCap  = notionalCap > 0 ? Math.floor(notionalCap / input.entry) : qtyByRisk;
  let qty = Math.min(qtyByRisk, qtyByCap);
  const cappedByNotional = qtyByCap < qtyByRisk;

  const isFno = isFnoOrMcxSymbol(input.symbol);
  const lot = lotSizeFor(input.symbol, isFno);

  const reasons: string[] = [];
  if (cappedByNotional) {
    reasons.push(`Notional cap ₹${notionalCap} clamps qty from ${qtyByRisk} to ${qtyByCap} (entry ₹${input.entry.toFixed(2)})`);
  }

  if (lot !== null) {
    const lots = Math.floor(qty / lot);
    if (lots < 1) {
      reasons.push(`Resulting qty below one lot (${lot}). Increase risk % or widen SL.`);
      qty = 0;
    } else {
      const adjusted = lots * lot;
      if (adjusted !== qty) reasons.push(`Rounded to ${lots} lot${lots>1?"s":""} (${adjusted} shares)`);
      qty = adjusted;
    }
  }

  return {
    recommendedQty: Math.max(0, qty),
    slDistance,
    maxLossRs,
    notional: qty * input.entry,
    lotSize: lot,
    reason: reasons.length ? reasons.join("; ") : undefined,
    cappedByNotional,
  };
}
