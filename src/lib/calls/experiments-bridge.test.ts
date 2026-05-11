import { describe, it, expect } from "vitest";
import {
  bridgeExperimentsToOverrides,
  applyBridgeDecisions,
  isHoldConsistent,
  formatBridgeDecisions,
  type ExperimentCandidate,
} from "./experiments-bridge";
import type { Strategy } from "./strategies/types";
import type { StrategyOverride } from "./strategy-overrides";

const stratIntraday: Strategy = {
  id: "intra",
  name: "Intraday Momentum",
  description: "",
  productType: "INTRADAY",
  apply: () => null,
};

const stratCnc: Strategy = {
  id: "swing",
  name: "Oversold 52w-low bounce",
  description: "",
  productType: "CNC",
  apply: () => null,
};

const baseCandidate = (overrides: Partial<ExperimentCandidate> = {}): ExperimentCandidate => ({
  strategy: "Oversold 52w-low bounce",
  holdDays: 3,
  range: "6mo",
  trades: 22,
  winRate: 72.7,
  sharpeNet: 1.5,
  avgReturnNet: 1.0,
  ...overrides,
});

const culled = (id: string): StrategyOverride => ({
  id,
  disabled: true,
  reason: `auto-cull: trades=20, sharpe=-0.30`,
  at: "2026-04-01T00:00:00Z",
});

describe("isHoldConsistent — productType↔holdDays gate", () => {
  it("INTRADAY allows hold=0 and hold=1 only", () => {
    expect(isHoldConsistent(stratIntraday, 0)).toBe(true);
    expect(isHoldConsistent(stratIntraday, 1)).toBe(true);
    expect(isHoldConsistent(stratIntraday, 2)).toBe(false);
    expect(isHoldConsistent(stratIntraday, 5)).toBe(false);
  });
  it("CNC requires hold≥2", () => {
    expect(isHoldConsistent(stratCnc, 1)).toBe(false);
    expect(isHoldConsistent(stratCnc, 2)).toBe(true);
    expect(isHoldConsistent(stratCnc, 3)).toBe(true);
  });
});

describe("bridgeExperimentsToOverrides — bounded auto-promote rules", () => {
  it("promotes a CNC strategy that's auto-culled and clears the bar", () => {
    const decisions = bridgeExperimentsToOverrides({
      candidates: [baseCandidate()],
      existingOverrides: [culled("swing")],
      strategies: [stratCnc],
    });
    const p = decisions.find(d => d.kind === "auto_promote");
    expect(p).toBeDefined();
    if (p?.kind === "auto_promote") {
      expect(p.strategyId).toBe("swing");
      expect(p.evidence.sharpe).toBe(1.5);
    }
  });

  it("skips a strategy that is not currently disabled", () => {
    const decisions = bridgeExperimentsToOverrides({
      candidates: [baseCandidate()],
      existingOverrides: [],
      strategies: [stratCnc],
    });
    expect(decisions.find(d => d.kind === "auto_promote")).toBeUndefined();
    const skip = decisions.find(d => d.kind === "skipped");
    expect(skip).toBeDefined();
  });

  it("NEVER touches a manually-disabled strategy", () => {
    const decisions = bridgeExperimentsToOverrides({
      candidates: [baseCandidate()],
      existingOverrides: [{ id: "swing", disabled: true, reason: "manual: under investigation", at: "2026-04-01T00:00:00Z" }],
      strategies: [stratCnc],
    });
    expect(decisions.find(d => d.kind === "auto_promote")).toBeUndefined();
  });

  it("rejects when sharpe < bar", () => {
    const decisions = bridgeExperimentsToOverrides({
      candidates: [baseCandidate({ sharpeNet: 0.2 })],
      existingOverrides: [culled("swing")],
      strategies: [stratCnc],
    });
    expect(decisions.find(d => d.kind === "auto_promote")).toBeUndefined();
  });

  it("rejects when trades < min sample", () => {
    const decisions = bridgeExperimentsToOverrides({
      candidates: [baseCandidate({ trades: 10 })],
      existingOverrides: [culled("swing")],
      strategies: [stratCnc],
    });
    expect(decisions.find(d => d.kind === "auto_promote")).toBeUndefined();
  });

  it("rejects when winRate < min", () => {
    const decisions = bridgeExperimentsToOverrides({
      candidates: [baseCandidate({ winRate: 40 })],
      existingOverrides: [culled("swing")],
      strategies: [stratCnc],
    });
    expect(decisions.find(d => d.kind === "auto_promote")).toBeUndefined();
  });

  it("rejects a CNC strategy promoted on a 1-day-hold candidate (productType mismatch)", () => {
    const decisions = bridgeExperimentsToOverrides({
      candidates: [baseCandidate({ holdDays: 1 })],
      existingOverrides: [culled("swing")],
      strategies: [stratCnc],
    });
    expect(decisions.find(d => d.kind === "auto_promote")).toBeUndefined();
  });

  it("rejects an INTRADAY strategy promoted on a 5-day-hold candidate", () => {
    const decisions = bridgeExperimentsToOverrides({
      candidates: [baseCandidate({ strategy: "Intraday Momentum", holdDays: 5 })],
      existingOverrides: [culled("intra")],
      strategies: [stratIntraday],
    });
    expect(decisions.find(d => d.kind === "auto_promote")).toBeUndefined();
  });

  it("picks the highest-sharpe consistent candidate when multiple exist", () => {
    const decisions = bridgeExperimentsToOverrides({
      candidates: [
        baseCandidate({ holdDays: 2, sharpeNet: 0.4 }),
        baseCandidate({ holdDays: 3, sharpeNet: 1.5 }),
        baseCandidate({ holdDays: 5, sharpeNet: 0.8 }),
      ],
      existingOverrides: [culled("swing")],
      strategies: [stratCnc],
    });
    const p = decisions.find(d => d.kind === "auto_promote");
    expect(p).toBeDefined();
    if (p?.kind === "auto_promote") expect(p.evidence.sharpe).toBe(1.5);
  });

  it("ignores candidates referencing an unknown strategy name", () => {
    const decisions = bridgeExperimentsToOverrides({
      candidates: [baseCandidate({ strategy: "Unknown Strategy Name" })],
      existingOverrides: [culled("swing")],
      strategies: [stratCnc],
    });
    expect(decisions).toEqual([]);
  });
});

describe("applyBridgeDecisions — mutate override list", () => {
  it("flips disabled=false on promoted entries, preserves others", () => {
    const existing: StrategyOverride[] = [culled("swing"), culled("other")];
    const decisions = bridgeExperimentsToOverrides({
      candidates: [baseCandidate()],
      existingOverrides: existing,
      strategies: [stratCnc],
    });
    const { next, promoted } = applyBridgeDecisions(existing, decisions, "2026-05-11T03:00:00Z");
    expect(promoted).toBe(1);
    expect(next.find(o => o.id === "swing")?.disabled).toBe(false);
    expect(next.find(o => o.id === "other")?.disabled).toBe(true);
  });

  it("returns 0 promoted when no auto_promote decisions present", () => {
    const { promoted } = applyBridgeDecisions([culled("swing")], [{ kind: "skipped", strategyId: "swing", reason: "no candidate" }]);
    expect(promoted).toBe(0);
  });
});

describe("formatBridgeDecisions — Telegram summary block", () => {
  it("emits a block listing each promotion", () => {
    const out = formatBridgeDecisions([
      { kind: "auto_promote", strategyId: "swing", reason: "L2", evidence: { sharpe: 1.5, trades: 22, winRate: 72.7, holdDays: 3, range: "6mo" } },
    ]);
    expect(out).toContain("L2 auto-promote");
    expect(out).toContain("swing");
    expect(out).toContain("1.50");
  });

  it("emits empty string when no promotions and no near-miss skips", () => {
    expect(formatBridgeDecisions([{ kind: "skipped", strategyId: "x", reason: "not auto-culled" }])).toBe("");
  });

  it("emits a near-miss summary when auto-culled candidates were below bar", () => {
    const out = formatBridgeDecisions([{ kind: "skipped", strategyId: "x", reason: "sharpe 0.20 < min 0.3" }]);
    expect(out).toContain("0 promoted");
  });
});
