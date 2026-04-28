/**
 * Strategy overrides — runtime kill-list for losing strategies.
 *
 * The auto-cull job writes here when a strategy's Sharpe goes negative over a
 * minimum sample. The generator filters STRATEGIES through `isStrategyDisabled`
 * before running, so a disabled strategy stops generating new ideas without a
 * code change. A human can edit the file to re-enable.
 */
import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), ".local-data", "strategy-overrides.json");

export type StrategyOverride = {
  /** Strategy id from STRATEGIES (e.g. "breakout-52wh"). */
  id: string;
  disabled: boolean;
  reason: string;
  /** ISO timestamp of disable decision. */
  at: string;
  stats?: {
    trades: number;
    wins: number;
    avgPct: number;
    sharpe: number;
  };
};

export type OverrideFile = {
  updatedAt: string;
  overrides: StrategyOverride[];
};

export async function readOverrides(): Promise<OverrideFile> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return JSON.parse(raw) as OverrideFile;
  } catch {
    return { updatedAt: new Date(0).toISOString(), overrides: [] };
  }
}

export async function writeOverrides(file: OverrideFile): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(file, null, 2), { mode: 0o600 });
}

/** Cheap synchronous helper after read. */
export function isDisabled(file: OverrideFile, strategyId: string): boolean {
  return file.overrides.some(o => o.id === strategyId && o.disabled);
}
