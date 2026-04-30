import { describe, it, expect } from "vitest";
import { computeDecisions } from "./daily-self-improvement";

describe("computeDecisions — bounded auto-improvement rules", () => {
  it("R1: disables a strategy with significant negative edge (tStat < -2, n ≥ 30)", () => {
    const decisions = computeDecisions({
      perStrategy: [{ id: "loser", trades: 50, sharpe: -0.5, tStat: -3.5 }],
      rollingSharpe: 0,
      currentRiskPct: 1,
      existingOverrides: [],
    });
    expect(decisions.find(d => d.kind === "disable_strategy")).toBeDefined();
  });

  it("R1: does NOT disable when sample is too small even if tStat is bad", () => {
    const decisions = computeDecisions({
      perStrategy: [{ id: "small-sample", trades: 5, sharpe: -1, tStat: -5 }],
      rollingSharpe: 0,
      currentRiskPct: 1,
      existingOverrides: [],
    });
    expect(decisions.find(d => d.kind === "disable_strategy")).toBeUndefined();
  });

  it("R2: re-enables a strategy that was previously auto-culled but now shows positive significance", () => {
    const decisions = computeDecisions({
      perStrategy: [{ id: "winner", trades: 35, sharpe: 0.5, tStat: 3 }],
      rollingSharpe: 0,
      currentRiskPct: 1,
      existingOverrides: [{
        id: "winner", disabled: true, reason: "auto-cull: trades=20, sharpe=-0.30",
        at: "2026-04-01T00:00:00Z",
      }],
    });
    expect(decisions.find(d => d.kind === "enable_strategy")).toBeDefined();
  });

  it("R2: does NOT re-enable a manually-disabled strategy", () => {
    const decisions = computeDecisions({
      perStrategy: [{ id: "manually-off", trades: 35, sharpe: 0.5, tStat: 3 }],
      rollingSharpe: 0,
      currentRiskPct: 1,
      existingOverrides: [{
        id: "manually-off", disabled: true, reason: "manual: under investigation",
        at: "2026-04-01T00:00:00Z",
      }],
    });
    expect(decisions.find(d => d.kind === "enable_strategy")).toBeUndefined();
  });

  it("R3: cooling-off — halves risk_pct when portfolio rolling Sharpe < 0", () => {
    const decisions = computeDecisions({
      perStrategy: [],
      rollingSharpe: -0.5,
      currentRiskPct: 1,
      existingOverrides: [],
    });
    const d = decisions.find(d => d.kind === "set_risk_pct");
    expect(d).toBeDefined();
    if (d?.kind === "set_risk_pct") {
      expect(d.from).toBe(1);
      expect(d.to).toBe(0.5);
    }
  });

  it("R3: cooling-off floors at 0.25% — never drops below the rail", () => {
    const decisions = computeDecisions({
      perStrategy: [],
      rollingSharpe: -1,
      currentRiskPct: 0.4,    // already low
      existingOverrides: [],
    });
    const d = decisions.find(d => d.kind === "set_risk_pct");
    if (d?.kind === "set_risk_pct") {
      expect(d.to).toBeGreaterThanOrEqual(0.25);
    }
  });

  it("R4: resume — restores risk_pct to default 1.0% when portfolio Sharpe > 1.0", () => {
    const decisions = computeDecisions({
      perStrategy: [],
      rollingSharpe: 1.2,
      currentRiskPct: 0.5,
      existingOverrides: [],
    });
    const d = decisions.find(d => d.kind === "set_risk_pct");
    expect(d).toBeDefined();
    if (d?.kind === "set_risk_pct") {
      expect(d.to).toBe(1);
    }
  });

  it("R4: does NOT bump risk_pct above default — auto-tuner can never raise above 1.0% on its own", () => {
    const decisions = computeDecisions({
      perStrategy: [],
      rollingSharpe: 2,
      currentRiskPct: 1,    // already at default
      existingOverrides: [],
    });
    expect(decisions.find(d => d.kind === "set_risk_pct")).toBeUndefined();
  });

  it("emits a 'no_change' decision when nothing applies", () => {
    const decisions = computeDecisions({
      perStrategy: [],
      rollingSharpe: 0.5,
      currentRiskPct: 1,
      existingOverrides: [],
    });
    expect(decisions).toEqual([{ kind: "no_change", reason: "no rules triggered" }]);
  });
});
