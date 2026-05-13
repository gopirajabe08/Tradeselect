import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  readStateAt,
  writeStateAt,
  withStateMutation,
  type PaperState,
} from "./store";

/**
 * The race that motivated the lock — re-creates the NIVABUPA-class data loss:
 * two concurrent placeOrder paths each read state, mutate independently, write back.
 * Without serialization, the second writer overwrites the first writer's mutations.
 * With withStateMutation, both contributions land.
 */

const TEST_REL_PATH = "paper-test-store/state.json";
const TEST_FILE = path.join(process.cwd(), ".local-data", TEST_REL_PATH);

async function reset(): Promise<void> {
  const s: PaperState = {
    startingCash: 200000,
    cash: 200000,
    orders: [],
    positions: [],
    holdings: [],
    lastOrderSeq: 10000,
    createdAt: Date.now(),
  };
  await writeStateAt(s, TEST_REL_PATH);
}

describe("withStateMutation — serializes concurrent paper-state writers", () => {
  beforeEach(reset);
  afterEach(async () => {
    try { await fs.unlink(TEST_FILE); } catch {}
  });

  it("two concurrent push-order mutations both land (no lost write)", async () => {
    // Simulate auto-follow placing a BUY entry while the matcher concurrently fires a bracket.
    // Each mutation reads fresh state, applies its push, releases.
    const ops = Promise.all([
      withStateMutation(async (s) => {
        s.lastOrderSeq += 1;
        s.orders.push({
          id: `PAPER-${s.lastOrderSeq}`,
          createdAt: Date.now(),
          symbol: "NSE:NIVABUPA-EQ",
          side: 1, type: 2, productType: "INTRADAY", qty: 825,
          limitPrice: 0, stopPrice: 0, validity: "DAY",
          orderTag: "entry-A", status: 2, filledQty: 825, tradedPrice: 83.24,
        });
      }, TEST_REL_PATH),
      withStateMutation(async (s) => {
        s.lastOrderSeq += 1;
        s.orders.push({
          id: `PAPER-${s.lastOrderSeq}`,
          createdAt: Date.now(),
          symbol: "NSE:NIVABUPA-EQ",
          side: -1, type: 3, productType: "INTRADAY", qty: 825,
          limitPrice: 0, stopPrice: 82.33, validity: "DAY",
          orderTag: "stop-A", status: 6, filledQty: 0, tradedPrice: 0,
        });
      }, TEST_REL_PATH),
    ]);
    await ops;
    const final = await readStateAt(TEST_REL_PATH);
    expect(final.orders).toHaveLength(2);
    expect(final.lastOrderSeq).toBe(10002);
    // Both IDs must be distinct (no reuse of seq)
    const ids = final.orders.map(o => o.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain("PAPER-10001");
    expect(ids).toContain("PAPER-10002");
  });

  it("10 concurrent writers each pushing one order all land", async () => {
    const ops = Array.from({ length: 10 }, (_, i) =>
      withStateMutation(async (s) => {
        s.lastOrderSeq += 1;
        s.orders.push({
          id: `PAPER-${s.lastOrderSeq}`,
          createdAt: Date.now(),
          symbol: `SYM-${i}`,
          side: 1, type: 2, productType: "INTRADAY", qty: i + 1,
          limitPrice: 0, stopPrice: 0, validity: "DAY",
          status: 2, filledQty: i + 1, tradedPrice: 100,
        });
      }, TEST_REL_PATH)
    );
    await Promise.all(ops);
    const final = await readStateAt(TEST_REL_PATH);
    expect(final.orders).toHaveLength(10);
    expect(final.lastOrderSeq).toBe(10010);
    const ids = new Set(final.orders.map(o => o.id));
    expect(ids.size).toBe(10);
  });

  it("mutator error releases the lock so subsequent writers don't deadlock", async () => {
    await expect(
      withStateMutation(async () => { throw new Error("oops"); }, TEST_REL_PATH)
    ).rejects.toThrow("oops");
    // Next writer must still succeed without timing out.
    await withStateMutation(async (s) => {
      s.lastOrderSeq += 1;
    }, TEST_REL_PATH);
    const final = await readStateAt(TEST_REL_PATH);
    expect(final.lastOrderSeq).toBe(10001);
  });

  it("mutator return value is propagated", async () => {
    const result = await withStateMutation(async (s) => {
      s.lastOrderSeq += 1;
      return { newId: `PAPER-${s.lastOrderSeq}`, cash: s.cash };
    }, TEST_REL_PATH);
    expect(result.newId).toBe("PAPER-10001");
    expect(result.cash).toBe(200000);
  });
});
