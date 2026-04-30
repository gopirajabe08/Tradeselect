import { describe, it, expect } from "vitest";
import { findExpiredPositions } from "./max-hold-exit";
import type { PaperPosition } from "@/lib/broker/paper/store";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function position(overrides: Partial<PaperPosition>): PaperPosition {
  return {
    id: "X|CNC",
    symbol: "NSE:RELIANCE-EQ",
    productType: "CNC",
    netQty: 100,
    netAvg: 1500,
    buyQty: 100,
    buyAvg: 1500,
    sellQty: 0,
    sellAvg: 0,
    realized: 0,
    ltp: 1500,
    ...overrides,
  };
}

describe("findExpiredPositions — the gate that decides if max-hold-exit fires", () => {
  const now = Date.parse("2026-04-30T10:00:00Z");

  it("flags a CNC position aged equal to maxHoldDays as expired", () => {
    const p = position({ openedAt: now - 3 * MS_PER_DAY, maxHoldDays: 3, strategyId: "reversal-52wl" });
    const expired = findExpiredPositions([p], now);
    expect(expired).toHaveLength(1);
    expect(expired[0].position.symbol).toBe("NSE:RELIANCE-EQ");
    expect(expired[0].ageDays).toBeCloseTo(3.0, 5);
  });

  it("flags a CNC position aged BEYOND maxHoldDays as expired", () => {
    const p = position({ openedAt: now - 7 * MS_PER_DAY, maxHoldDays: 3 });
    const expired = findExpiredPositions([p], now);
    expect(expired).toHaveLength(1);
    expect(expired[0].ageDays).toBeCloseTo(7.0, 5);
  });

  it("does NOT flag a CNC position younger than maxHoldDays", () => {
    const p = position({ openedAt: now - 1 * MS_PER_DAY, maxHoldDays: 3 });
    const expired = findExpiredPositions([p], now);
    expect(expired).toHaveLength(0);
  });

  it("does NOT flag a flat position (netQty = 0) even if openedAt is stale", () => {
    const p = position({ openedAt: now - 30 * MS_PER_DAY, maxHoldDays: 3, netQty: 0 });
    const expired = findExpiredPositions([p], now);
    expect(expired).toHaveLength(0);
  });

  it("does NOT flag a position without openedAt (legacy, pre-attribution)", () => {
    const p = position({ openedAt: undefined, maxHoldDays: 3 });
    const expired = findExpiredPositions([p], now);
    expect(expired).toHaveLength(0);
  });

  it("does NOT flag a position without maxHoldDays (strategy didn't declare hold horizon)", () => {
    const p = position({ openedAt: now - 30 * MS_PER_DAY, maxHoldDays: undefined });
    const expired = findExpiredPositions([p], now);
    expect(expired).toHaveLength(0);
  });

  it("does NOT flag an INTRADAY position — that's intraday-squareoff's job", () => {
    const p = position({ openedAt: now - 5 * MS_PER_DAY, maxHoldDays: 3, productType: "INTRADAY" });
    const expired = findExpiredPositions([p], now);
    expect(expired).toHaveLength(0);
  });

  it("flags multiple positions in one pass (paper portfolio realism)", () => {
    const portfolio = [
      position({ symbol: "NSE:RELIANCE-EQ", openedAt: now - 4 * MS_PER_DAY, maxHoldDays: 3 }),
      position({ symbol: "NSE:TCS-EQ", openedAt: now - 1 * MS_PER_DAY, maxHoldDays: 3 }),
      position({ symbol: "NSE:HDFC-EQ", openedAt: now - 5 * MS_PER_DAY, maxHoldDays: 3 }),
      position({ symbol: "NSE:ITC-EQ", openedAt: now - 10 * MS_PER_DAY, maxHoldDays: 30 }),  // long horizon, not expired
    ];
    const expired = findExpiredPositions(portfolio, now);
    expect(expired.map(e => e.position.symbol).sort()).toEqual(["NSE:HDFC-EQ", "NSE:RELIANCE-EQ"]);
  });

  it("handles edge: position aged exactly at maxHoldDays (inclusive boundary)", () => {
    const p = position({ openedAt: now - 3 * MS_PER_DAY, maxHoldDays: 3 });
    const expired = findExpiredPositions([p], now);
    expect(expired).toHaveLength(1);
  });

  it("handles edge: position 1ms shy of maxHoldDays (does NOT fire yet)", () => {
    const p = position({ openedAt: now - 3 * MS_PER_DAY + 1, maxHoldDays: 3 });
    const expired = findExpiredPositions([p], now);
    expect(expired).toHaveLength(0);
  });
});
