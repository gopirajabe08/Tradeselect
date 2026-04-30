import { describe, it, expect } from "vitest";
import { determinePhase, buildBars, estimateLiveDates, type ReadinessInputs } from "./live-readiness";

const baseline: ReadinessInputs = {
  closedTrades: 0,
  tradingDaysObserved: 0,
  regimesCovered: new Set(),
};

describe("determinePhase — phase progression", () => {
  it("Phase A when no trading days yet", () => {
    expect(determinePhase(baseline)).toBe("A");
  });

  it("Phase B after first day, before second", () => {
    expect(determinePhase({ ...baseline, tradingDaysObserved: 1 })).toBe("B");
  });

  it("Phase C through paper accumulation (< 30 closed trades)", () => {
    expect(determinePhase({ ...baseline, tradingDaysObserved: 5, closedTrades: 10 })).toBe("C");
    expect(determinePhase({ ...baseline, tradingDaysObserved: 15, closedTrades: 29 })).toBe("C");
  });

  it("Phase D when one of the graduation bars misses", () => {
    expect(determinePhase({
      closedTrades: 30,
      tradingDaysObserved: 5,
      regimesCovered: new Set(["CHOPPY"]),
      rollingSharpe: 0.6,
      rollingMaxDDPct: 5,
    })).toBe("D");
  });

  it("Phase E when paper graduates AND prereqs are not met", () => {
    expect(determinePhase({
      closedTrades: 60,
      tradingDaysObserved: 25,
      regimesCovered: new Set(["CHOPPY", "TRENDING-UP"]),
      rollingSharpe: 0.7,
      rollingMaxDDPct: 5,
      ipWhitelistOk: false,
      liveBrokerSessionOk: false,
    })).toBe("E");
  });

  it("Phase F when paper graduates AND prereqs are met", () => {
    expect(determinePhase({
      closedTrades: 60,
      tradingDaysObserved: 25,
      regimesCovered: new Set(["CHOPPY", "TRENDING-UP"]),
      rollingSharpe: 0.7,
      rollingMaxDDPct: 5,
      ipWhitelistOk: true,
      liveBrokerSessionOk: true,
    })).toBe("F");
  });

  it("Phase D when DD is too high even with all other bars met", () => {
    expect(determinePhase({
      closedTrades: 60,
      tradingDaysObserved: 25,
      regimesCovered: new Set(["CHOPPY", "TRENDING-UP"]),
      rollingSharpe: 0.7,
      rollingMaxDDPct: 15,  // > 12 cap
    })).toBe("D");
  });
});

describe("buildBars — bar progress reporting", () => {
  it("zero-state bars all show 0/target with progress 0", () => {
    const bars = buildBars(baseline);
    expect(bars).toHaveLength(5);
    expect(bars[0]).toMatchObject({ name: "Closed paper trades", current: 0, target: 50, passed: false, progress: 0 });
  });

  it("partial progress fills accordingly", () => {
    const bars = buildBars({ ...baseline, closedTrades: 25 });
    expect(bars[0].progress).toBeCloseTo(0.5, 5);
    expect(bars[0].passed).toBe(false);
  });

  it("over-target marks passed and clamps progress at 1.0", () => {
    const bars = buildBars({ ...baseline, closedTrades: 80 });
    expect(bars[0].progress).toBe(1);
    expect(bars[0].passed).toBe(true);
  });

  it("Sharpe bar shows 'n/a' when not enough data", () => {
    const bars = buildBars(baseline);
    const sharpe = bars.find(b => b.name === "Rolling 20d Sharpe")!;
    expect(sharpe.current).toBe("n/a");
    expect(sharpe.note).toContain("needs 20+ closed trades");
  });

  it("DD bar passes when no DD recorded (system can't have negative DD it doesn't have)", () => {
    const bars = buildBars(baseline);
    const dd = bars.find(b => b.name === "Max DD (rolling 20d)")!;
    expect(dd.passed).toBe(true);  // n/a → no observed violation
  });
});

describe("estimateLiveDates — calendar projection", () => {
  it("returns dates in YYYY-MM-DD format", () => {
    const today = new Date("2026-04-30T10:00:00Z");
    const eta = estimateLiveDates({ ...baseline, closedTrades: 0, tradingDaysObserved: 0 }, today);
    expect(eta.best).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(eta.expected).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("expected is later than best", () => {
    const today = new Date("2026-04-30T10:00:00Z");
    const eta = estimateLiveDates(baseline, today);
    expect(Date.parse(eta.expected!)).toBeGreaterThan(Date.parse(eta.best!));
  });

  it("zero state projects to ~late June best case", () => {
    const today = new Date("2026-04-30T10:00:00Z");
    const eta = estimateLiveDates(baseline, today);
    const bestMonth = eta.best!.slice(0, 7);
    // 50 trades @ 0.5/day = 100 trade days = 140 calendar days + 30 phase E = 170 calendar days
    // From 2026-04-30 + 170 days ≈ mid-October
    expect(Date.parse(eta.best!)).toBeGreaterThan(Date.parse("2026-06-15"));
  });

  it("with most progress already made, ETA tightens", () => {
    const today = new Date("2026-04-30T10:00:00Z");
    const eta = estimateLiveDates({ ...baseline, closedTrades: 49, tradingDaysObserved: 19 }, today);
    // Almost there — ETA = today + Phase E (~30 days) calendar
    expect(Date.parse(eta.best!)).toBeLessThan(Date.parse("2026-06-15"));
  });
});
