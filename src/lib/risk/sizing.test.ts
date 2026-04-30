import { describe, it, expect } from "vitest";
import { computeSizing, type RiskConfig } from "./sizing";
import { NOTIONAL_HARD_CAP } from "@/lib/broker/audit";

const baseConfig: RiskConfig = {
  accountSize: 100_000,
  riskPct: 2,
  dailyMaxLossPct: 2,
};

describe("computeSizing — risk-parity baseline", () => {
  it("sizes by risk budget when notional stays under cap", () => {
    // ITC at 400, SL=396, risk=2% of 100k = 2000 max loss, SL distance 4 → qty 500
    // notional 500 × 400 = ₹200,000 — below the override cap of ₹500,000
    const r = computeSizing(
      { symbol: "NSE:ITC-EQ", entry: 400, stopLoss: 396, notionalCap: 500_000 },
      baseConfig,
    );
    expect(r.recommendedQty).toBe(500);
    expect(r.notional).toBe(500 * 400);
    expect(r.cappedByNotional).toBe(false);
  });

  it("returns 0 qty when entry/SL invalid", () => {
    const r = computeSizing(
      { symbol: "NSE:FOO-EQ", entry: 100, stopLoss: 100 },
      baseConfig,
    );
    expect(r.recommendedQty).toBe(0);
    expect(r.reason).toBe("invalid entry/SL");
  });
});

describe("computeSizing — notional cap (the bug that produced ₹847k attempts)", () => {
  it("caps qty when risk-derived qty would exceed notional cap", () => {
    // Reproduce 2026-04-28 prod error: ₹8475 stock, ₹20 SL distance
    // qtyByRisk = floor(2000 / 20) = 100  → notional 100 × 8475 = ₹847,500 (above cap)
    // qtyByCap  = floor(NOTIONAL_HARD_CAP / 8475)
    const entry = 8475;
    const stopLoss = 8455;
    const r = computeSizing(
      { symbol: "NSE:RELIANCE-EQ", entry, stopLoss },
      baseConfig,
    );
    expect(r.cappedByNotional).toBe(true);
    expect(r.notional).toBeLessThanOrEqual(NOTIONAL_HARD_CAP);
    expect(r.recommendedQty).toBe(Math.floor(NOTIONAL_HARD_CAP / entry));
    expect(r.reason).toMatch(/Notional cap/);
  });

  it("respects override notionalCap parameter (more restrictive)", () => {
    const r = computeSizing(
      { symbol: "NSE:ITC-EQ", entry: 400, stopLoss: 396, notionalCap: 50_000 },
      baseConfig,
    );
    // qtyByRisk = 500, qtyByCap = floor(50000/400) = 125 → cap wins
    expect(r.recommendedQty).toBe(125);
    expect(r.cappedByNotional).toBe(true);
    expect(r.notional).toBe(125 * 400);
  });

  it("never produces qty whose notional exceeds the cap", () => {
    const cases = [
      { entry: 100, stopLoss: 99 },         // ₹1 SL: qtyByRisk = 2000 → notional 200k
      { entry: 5000, stopLoss: 4990 },      // ₹10 SL on big stock: qtyByRisk = 200 → notional 1M
      { entry: 50, stopLoss: 49.5 },        // small entry, tight SL
      { entry: 23000, stopLoss: 22950 },    // MARUTI-class price
    ];
    for (const c of cases) {
      const r = computeSizing({ symbol: "NSE:X-EQ", ...c }, baseConfig);
      expect(r.notional).toBeLessThanOrEqual(NOTIONAL_HARD_CAP);
    }
  });
});

describe("writeRiskConfig — bounded rails enforced at persistence boundary (ADV-8 fix)", () => {
  // The auto-tuner clamps before write, but this layer is defense in depth.
  // Any caller (admin route, debug, future feature) cannot bypass the rails.
  it("clamps risk_pct above 2% to ceiling 2%", async () => {
    const { writeRiskConfig, readRiskConfig } = await import("./sizing");
    const result = await writeRiskConfig({ riskPct: 5, accountSize: 100_000, dailyMaxLossPct: 2 });
    expect(result.riskPct).toBe(2);
  });

  it("clamps risk_pct below 0.25% to floor 0.25%", async () => {
    const { writeRiskConfig } = await import("./sizing");
    const result = await writeRiskConfig({ riskPct: 0.1 });
    expect(result.riskPct).toBe(0.25);
  });

  it("does not modify in-bound risk_pct values", async () => {
    const { writeRiskConfig } = await import("./sizing");
    const result = await writeRiskConfig({ riskPct: 1.5 });
    expect(result.riskPct).toBe(1.5);
  });

  it("clamps daily-loss cap to [0, 20]", async () => {
    const { writeRiskConfig } = await import("./sizing");
    const r1 = await writeRiskConfig({ dailyMaxLossPct: -5 });
    expect(r1.dailyMaxLossPct).toBe(0);
    const r2 = await writeRiskConfig({ dailyMaxLossPct: 50 });
    expect(r2.dailyMaxLossPct).toBe(20);
  });
});
