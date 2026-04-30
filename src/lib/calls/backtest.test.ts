import { describe, it, expect } from "vitest";
import { computeReturnStats } from "./backtest";

describe("computeReturnStats — proper Sharpe vs t-stat (the fix that ended the cull-by-mislabel era)", () => {
  it("returns zeros for an empty series", () => {
    const r = computeReturnStats([]);
    expect(r.n).toBe(0);
    expect(r.sharpe).toBe(0);
    expect(r.tStat).toBe(0);
  });

  it("computes mean/sd correctly on a known series", () => {
    // 100 trades, all +1.0% — mean=1, sd=0
    const returns = Array(100).fill(1.0);
    const r = computeReturnStats(returns);
    expect(r.n).toBe(100);
    expect(r.mean).toBeCloseTo(1.0, 6);
    expect(r.sd).toBe(0);
    expect(r.sharpe).toBe(0);  // sd=0 falls through to 0 (avoid divide-by-zero)
  });

  it("Sharpe is approximately scale-invariant (the bug we just fixed)", () => {
    // 4 trades vs 400 trades, same pattern → Sharpe stays approximately the same
    // (Bessel's correction on N-1 means tiny drift, but no √N scaling).
    // Old buggy code multiplied by √N, so old "Sharpe" with N=4 vs N=400 differed 10×.
    const small = [1.0, 0.5, 1.5, 1.0];   // mean=1
    const large = Array(100).fill([1.0, 0.5, 1.5, 1.0]).flat();  // 400 trades, same pattern
    const rs = computeReturnStats(small);
    const rl = computeReturnStats(large);
    expect(rl.mean).toBeCloseTo(rs.mean, 6);
    // Sharpe stable within ~20% (Bessel correction shrinks sample sd as N grows from 4 → 400) —
    // far from the 10× scaling that the buggy "Sharpe = mean/sd × √N" formula produced.
    expect(Math.abs(rl.sharpe - rs.sharpe) / rs.sharpe).toBeLessThan(0.20);
    // tStat scales with √N: rl is 10× more trades → tStat is roughly 10× larger.
    expect(rl.tStat / rs.tStat).toBeGreaterThan(8);
  });

  it("tStat captures statistical significance (significance grows with √N)", () => {
    // [0.5, 1.0, 1.0, 1.5]: mean=1, sample variance (N-1) = 0.5/3 ≈ 0.1667, sd ≈ 0.408
    // Sharpe ≈ 1 / 0.408 ≈ 2.449. tStat = sharpe × √N.
    const four  = [0.5, 1.0, 1.0, 1.5];
    const hundred = [...Array(25).fill([0.5, 1.0, 1.0, 1.5]).flat()];
    const r4 = computeReturnStats(four);
    const r100 = computeReturnStats(hundred);
    expect(r4.tStat).toBeCloseTo(4.9, 1);
    expect(r100.tStat).toBeGreaterThan(25);   // ~28 with Bessel correction
    // The point: same effect, much higher tStat with more samples = more confidence.
  });

  it("HRVM-shaped sample (4 trades, +1.47% mean) — exposes the original mislabel", () => {
    // From the actual commit message: "hold=3d 2y: 4 trades, 75% win, +1.47% net/trade, NetSh +1.17"
    // Reconstruct an approximate series and verify what the OLD formula was actually reporting.
    const trades = [+2.5, +1.5, +1.0, +0.9];   // mean ~= 1.475
    const r = computeReturnStats(trades);
    expect(r.mean).toBeCloseTo(1.475, 2);
    // With this small a sample, real Sharpe (per-trade) is much lower than the
    // mislabelled value (mean/sd × √N) the old code published.
    const oldBuggyValue = r.sharpe * Math.sqrt(r.n);  // what the old formula would produce
    expect(oldBuggyValue).toBeGreaterThan(r.sharpe);
    // tStat for N=4 is at most ~3 even with very strong effect; not "significant edge"
    // — the +1.17 NetSh that was claimed was actually a t-stat ≈ 1.17, p ≈ 0.32, NOT significant.
  });

  it("losing strategy: negative mean → negative Sharpe AND negative tStat", () => {
    const losses = [-1.0, -0.5, -1.5, -2.0, -0.8, -1.2];
    const r = computeReturnStats(losses);
    expect(r.mean).toBeLessThan(0);
    expect(r.sharpe).toBeLessThan(0);
    expect(r.tStat).toBeLessThan(0);
  });

  it("breakout-style culled strategy (large negative t-stat justifies culling)", () => {
    // The disabledStrategies list says "Backtest 2y: Sharpe -8.28" for sector-leader.
    // That value is most consistent with a tStat — the corresponding per-trade
    // Sharpe is much smaller. Verify both directions.
    const losers = Array(100).fill([-0.5, -1.0, -0.5, -1.5]).flat();  // 400 trades, mean -0.875, sd ~0.4
    const r = computeReturnStats(losers);
    expect(r.sharpe).toBeLessThan(-1);   // strong per-trade evidence
    expect(r.tStat).toBeLessThan(-20);   // overwhelming statistical confidence
    // Either metric flags this as "cull" — but they tell different stories.
  });
});
