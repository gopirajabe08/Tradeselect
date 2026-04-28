/**
 * End-to-end paper-mode signoff endpoint.
 *
 * Runs every scenario hands-free trading depends on. Bypasses market-hours so it
 * can run any time, but otherwise exercises the SAME production code paths the
 * scheduler will hit on Monday at 09:15 IST.
 *
 * Each scenario returns { name, pass, detail }. Top-level returns the array.
 * Auth-gated to the logged-in user.
 */
import { NextResponse } from "next/server";
import { promises as fs, existsSync } from "fs";
import path from "path";
import { getSession } from "@/lib/auth";
import { resetState, readState, writeState, type PaperState } from "@/lib/broker/paper/store";
import { placeOrderInternal } from "@/lib/broker/place-internal";
import { runAutoFollow } from "@/lib/calls/auto-follow";
import { readMode } from "@/lib/broker/mode";
import { readOverrides, writeOverrides } from "@/lib/calls/strategy-overrides";
import { computeStrategyStats, maybeRunAutoCull } from "@/lib/calls/auto-cull";
import { getLtp } from "@/lib/broker/paper/quotes";
import { notify } from "@/lib/notify/telegram";
import { readCalls, writeCalls } from "@/lib/calls/store";
import type { TradeCall } from "@/lib/mock/seed";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

type Scenario = { name: string; pass: boolean; detail: string };

const HALT_FLAG = path.join(process.cwd(), ".local-data", "halt.flag");
const AUDIT_LOG = path.join(process.cwd(), ".local-data", "order-audit.log");

async function setHalt(on: boolean) {
  if (on) await fs.writeFile(HALT_FLAG, "halt", { mode: 0o600 });
  else { try { await fs.unlink(HALT_FLAG); } catch {} }
}

/** Wipe audit log so the daily-order circuit breaker doesn't trip from prior E2E runs. */
async function clearAudit() {
  try { await fs.unlink(AUDIT_LOG); } catch {}
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function POST() {
  const sess = await getSession();
  if (!sess) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const mode = await readMode();
  if (mode !== "paper") {
    return NextResponse.json({ error: `E2E refuses to run on live broker (current mode: ${mode}). Set BROKER=paper.` }, { status: 400 });
  }

  const results: Scenario[] = [];
  const startedAt = new Date().toISOString();

  // ── 0. Pre-flight — clean state + audit ────────────────────────────────
  await setHalt(false);
  await clearAudit();
  await resetState();
  const startCash = Number(process.env.PAPER_STARTING_CASH ?? 100_000);
  results.push({ name: "0. reset paper state + audit", pass: true, detail: `₹${startCash.toLocaleString("en-IN")} starting cash; audit log cleared` });

  // ── 1. NSE LTP fetch (real network) ────────────────────────────────────
  const reliancePx = await getLtp("RELIANCE").catch(() => null);
  results.push({
    name: "1. NSE LTP fetch (RELIANCE)",
    pass: typeof reliancePx === "number" && reliancePx > 0,
    detail: reliancePx ? `₹${reliancePx}` : "FAILED — NSE LTP fetch returned null",
  });
  if (!reliancePx) {
    return NextResponse.json({ startedAt, results, summary: "ABORTED — no NSE data" });
  }

  // ── 2. Kill-switch blocks placement ────────────────────────────────────
  await setHalt(true);
  const killRes = await placeOrderInternal({
    symbol: "NSE:RELIANCE-EQ", qty: 1, type: 2, side: 1, productType: "INTRADAY",
    limitPrice: 0, stopPrice: 0, validity: "DAY", orderTag: "e2e-kill",
  }, { forceOffHours: true, source: "e2e" });
  results.push({
    name: "2. kill-switch (halt.flag) blocks placement",
    pass: !killRes.ok && killRes.error.includes("kill-switch"),
    detail: killRes.ok ? `UNEXPECTED OK: ${killRes.order_id}` : killRes.error,
  });
  await setHalt(false);

  // ── 3. Idempotency — same orderTag returns cached id ───────────────────
  const tag = `e2e-idem-${Date.now()}`;
  const first = await placeOrderInternal({
    symbol: "NSE:RELIANCE-EQ", qty: 1, type: 2, side: 1, productType: "INTRADAY",
    limitPrice: 0, stopPrice: 0, validity: "DAY", orderTag: tag,
  }, { forceOffHours: true, source: "e2e" });
  const second = await placeOrderInternal({
    symbol: "NSE:RELIANCE-EQ", qty: 1, type: 2, side: 1, productType: "INTRADAY",
    limitPrice: 0, stopPrice: 0, validity: "DAY", orderTag: tag,
  }, { forceOffHours: true, source: "e2e" });
  results.push({
    name: "3. idempotency (same orderTag dedups)",
    pass: first.ok && second.ok && (second as any).idempotent === true && first.order_id === second.order_id,
    detail: `first=${first.ok ? first.order_id : first.error}; second=${second.ok ? `${second.order_id} idempotent=${(second as any).idempotent}` : second.error}`,
  });

  // ── 4. Tick-size validation rejects bad LIMIT ──────────────────────────
  const badTick = await placeOrderInternal({
    symbol: "NSE:RELIANCE-EQ", qty: 1, type: 1, side: 1, productType: "INTRADAY",
    limitPrice: 1234.567, stopPrice: 0, validity: "DAY", orderTag: `e2e-tick-${Date.now()}`,
  }, { forceOffHours: true, source: "e2e" });
  results.push({
    name: "4. tick-size validation",
    pass: !badTick.ok && /tick/i.test(badTick.error),
    detail: badTick.ok ? `UNEXPECTED OK on bad tick price` : badTick.error.slice(0, 120),
  });

  // ── 5. Notional cap rejects oversized orders ───────────────────────────
  const { NOTIONAL_HARD_CAP } = await import("@/lib/broker/audit");
  const bigQty = Math.ceil((NOTIONAL_HARD_CAP * 1.2) / reliancePx);
  const bigOrder = await placeOrderInternal({
    symbol: "NSE:RELIANCE-EQ", qty: bigQty, type: 1, side: 1, productType: "INTRADAY",
    limitPrice: Math.round(reliancePx / 0.05) * 0.05, stopPrice: 0, validity: "DAY", orderTag: `e2e-big-${Date.now()}`,
  }, { forceOffHours: true, source: "e2e" });
  results.push({
    name: `5. notional cap (₹${NOTIONAL_HARD_CAP.toLocaleString("en-IN")}) blocks oversized`,
    pass: !bigOrder.ok && /Notional/i.test(bigOrder.error),
    detail: bigOrder.ok ? `UNEXPECTED OK qty=${bigQty}` : bigOrder.error.slice(0, 120),
  });

  // ── 6. Auto-follow happy path (paper) ──────────────────────────────────
  await resetState();
  const okIdea: TradeCall = {
    id: `e2e-${Date.now()}`,
    segment: "Intraday",
    symbol: "RELIANCE",
    side: "BUY",
    entry: reliancePx,
    // 5% target, 5% stop — wide enough that 1% risk-cash sizing keeps notional under
    // the ₹5L hard cap on a ₹500k account; tight stops on expensive stocks would
    // otherwise compute qty large enough to cross the per-order notional cap.
    target1: Math.round((reliancePx * 1.05) / 0.05) * 0.05,
    stopLoss: Math.round((reliancePx * 0.95) / 0.05) * 0.05,
    horizon: "Intraday",
    status: "Active",
    issuedAt: new Date().toISOString(),
    analyst: "E2E (BullsAi Auto)",
    rationale: "E2E happy path",
    ltp: reliancePx,
    score: 90,
  };
  const af1 = await runAutoFollow([okIdea], { forceOffHours: true });
  const stateAfter1 = await readState();
  const cid = okIdea.id.replace(/[^a-z0-9]/gi, "").slice(-12);
  const placedEntry = stateAfter1.orders.find(o => o.orderTag === `af-${cid}`);
  const placedTgt   = stateAfter1.orders.find(o => o.orderTag === `af-${cid}-t`);
  const placedStop  = stateAfter1.orders.find(o => o.orderTag === `af-${cid}-s`);
  const tagsInState = stateAfter1.orders.map(o => o.orderTag).filter(Boolean).join(",");
  results.push({
    name: "6. auto-follow places entry+target+stop with OCO group",
    pass: !!placedEntry && !!placedTgt && !!placedStop && placedTgt.ocoGroup === placedStop.ocoGroup && placedEntry.status === 2,
    detail: `placed=${af1.placed} attempted=${af1.attempted} errors=${JSON.stringify(af1.errors)} entry=${placedEntry?.id}/status=${placedEntry?.status}/fill=₹${placedEntry?.tradedPrice} tgt=${placedTgt?.id} stop=${placedStop?.id} oco=${placedTgt?.ocoGroup} tagsInState=[${tagsInState}]`,
  });

  // ── 7. OCO sibling cancellation on target fill ─────────────────────────
  // Force a fill on the target by mutating its limitPrice to be deeply favourable, then trigger match.
  // Simpler: directly synthesize state where target is filled and run the cancel logic via match cycle.
  // We replicate by writing state with target marked filled + trigger doMatchRefresh via getOrders.
  const s2 = await readState();
  const tgt = s2.orders.find(o => o.orderTag === `af-${cid}-t`);
  const sl  = s2.orders.find(o => o.orderTag === `af-${cid}-s`);
  let ocoVerdict = false; let ocoDetail = "skipped";
  if (tgt && sl) {
    // Bump the target's limitPrice up so any LTP >= limitPrice triggers fill on next match.
    // For BUY position we placed, target side=-1 (SELL LIMIT) fills when mark >= limitPrice.
    // Move the target down so it definitely fills; OCO cancel logic should then cancel the stop.
    tgt.limitPrice = 1; // 1 paise — guaranteed fill on any positive LTP
    await writeState(s2);
    // Wait & poll match: getOrders triggers doMatchRefresh
    const { PaperBroker } = await import("@/lib/broker/paper/engine");
    await PaperBroker.getOrders();
    await sleep(500);
    await PaperBroker.getOrders();
    await sleep(1500); // background refresh has TTL=10s; force a second pass
    const s3 = await readState();
    const tgtAfter = s3.orders.find(o => o.id === tgt.id);
    const slAfter  = s3.orders.find(o => o.id === sl.id);
    ocoVerdict = tgtAfter?.status === 2 && slAfter?.status === 1;
    ocoDetail  = `tgt status=${tgtAfter?.status} (expected 2=filled), stop status=${slAfter?.status} (expected 1=cancelled), msg=${slAfter?.message ?? ""}`;
  } else {
    ocoDetail = "target/stop legs not found from prior step";
  }
  results.push({ name: "7. OCO cancels sibling on fill", pass: ocoVerdict, detail: ocoDetail });

  // ── 8. Auto-follow score gate ──────────────────────────────────────────
  await resetState();
  const lowIdea: TradeCall = { ...okIdea, id: `e2e-low-${Date.now()}`, score: 50 };
  const af2 = await runAutoFollow([lowIdea], { forceOffHours: true });
  results.push({
    name: "8. auto-follow skips score < 70",
    pass: af2.placed === 0 && af2.skipped[0]?.reason.includes("score 50"),
    detail: `placed=${af2.placed} skipped=${af2.skipped[0]?.reason ?? "<none>"}`,
  });

  // ── 9. Auto-follow dedup on existing position/order ────────────────────
  await resetState();
  // Create existing open order on RELIANCE
  await placeOrderInternal({
    symbol: "NSE:RELIANCE-EQ", qty: 1, type: 1, side: 1, productType: "INTRADAY",
    limitPrice: Math.round((reliancePx * 0.5) / 0.05) * 0.05, stopPrice: 0, validity: "DAY",
    orderTag: `e2e-pre-${Date.now()}`.slice(0, 20),
  }, { forceOffHours: true, source: "e2e" });
  const dupIdea: TradeCall = { ...okIdea, id: `e2e-dup-${Date.now()}` };
  const af3 = await runAutoFollow([dupIdea], { forceOffHours: true });
  results.push({
    name: "9. auto-follow dedups on already-open symbol",
    pass: af3.placed === 0 && (af3.skipped[0]?.reason.includes("already have") ?? false),
    detail: `placed=${af3.placed} attempted=${af3.attempted} skipped=${JSON.stringify(af3.skipped)} errors=${JSON.stringify(af3.errors)}`,
  });

  // ── 10. Auto-follow qty=0 (stop too wide) ──────────────────────────────
  await resetState();
  // Stop dist must exceed riskCash (₹500k * 1% = ₹5k) to make qty=0. Use a 10-lakh stop dist
  // that no realistic risk budget could ever absorb.
  const wideIdea: TradeCall = { ...okIdea, id: `e2e-w${Date.now() % 1000}`, stopLoss: reliancePx + 1_000_000 };
  const af4 = await runAutoFollow([wideIdea], { forceOffHours: true });
  results.push({
    name: "10. auto-follow rejects qty=0 (wide stop)",
    pass: af4.placed === 0 && (af4.skipped[0]?.reason.includes("qty=0") ?? false),
    detail: `placed=${af4.placed} skipped=${af4.skipped[0]?.reason ?? "<none>"}`,
  });

  // ── 11. Auto-follow live mode is gated when not in live env ────────────
  // This stays in paper mode because mode is paper, but auto-follow still computes
  // liveAuthorized=false. We just verify the outcome shape.
  const af5 = await runAutoFollow([], { forceOffHours: true });
  results.push({
    name: "11. auto-follow live-gating shape exposed",
    pass: typeof af5.liveAuthorized === "boolean" && typeof af5.brokerId === "string",
    detail: `brokerId=${af5.brokerId} liveAuthorized=${af5.liveAuthorized}`,
  });

  // ── 12. Daily-loss circuit breaker halts placement ─────────────────────
  await resetState();
  const sLoss = await readState();
  sLoss.dayStartCash = startCash;
  sLoss.dayStartIstDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  // Synthesize -4% realized loss → past -2% threshold, regardless of capital size
  const lossAmount = startCash * 0.04;
  sLoss.positions.push({
    id: "TESTLOSS|INTRADAY",
    symbol: "TESTLOSS",
    productType: "INTRADAY",
    netQty: 0, netAvg: 0,
    buyQty: 1, buyAvg: 1000,
    sellQty: 1, sellAvg: 800,
    realized: -lossAmount,
    ltp: 800,
  });
  await writeState(sLoss);
  const lossOrder = await placeOrderInternal({
    symbol: "NSE:RELIANCE-EQ", qty: 1, type: 2, side: 1, productType: "INTRADAY",
    limitPrice: 0, stopPrice: 0, validity: "DAY", orderTag: `e2e-loss-${Date.now()}`,
  }, { forceOffHours: true, source: "e2e" });
  results.push({
    name: "12. daily-loss circuit breaker halts new orders",
    pass: !lossOrder.ok && /Daily P&L/i.test(lossOrder.error),
    detail: lossOrder.ok ? `UNEXPECTED OK` : lossOrder.error.slice(0, 200),
  });

  // ── 13. Strategy override filters generator ────────────────────────────
  const ovBefore = await readOverrides();
  await writeOverrides({
    updatedAt: new Date().toISOString(),
    overrides: [{ id: "breakout-52wh", disabled: true, reason: "e2e test", at: new Date().toISOString() }],
  });
  const ovCheck = await readOverrides();
  const isBlocked = ovCheck.overrides.find(o => o.id === "breakout-52wh")?.disabled === true;
  results.push({
    name: "13. strategy override file disables strategy",
    pass: isBlocked,
    detail: isBlocked ? "breakout-52wh marked disabled in overrides file" : "FAIL — write/read roundtrip broken",
  });
  // Restore original overrides
  await writeOverrides(ovBefore);

  // ── 14. Auto-cull math runs without throwing ───────────────────────────
  const stats = await computeStrategyStats();
  const cull = await maybeRunAutoCull(true /* force */);
  results.push({
    name: "14. auto-cull math + decision pipeline",
    pass: cull.ran === true && Array.isArray(cull.stats),
    detail: `ran=${cull.ran} stats=${stats.length} entries newDisabled=${(cull.disabled ?? []).join(",") || "<none>"}`,
  });

  // ── 15. Telegram smoke ─────────────────────────────────────────────────
  const tgOk = await notify(`✅ TradeSelect E2E signoff ran at ${new Date().toISOString()}\nIf you see this, Telegram wiring works.`).catch(() => false);
  results.push({
    name: "15. Telegram notification fires",
    pass: tgOk === true,
    detail: tgOk ? "message delivered to chat 7681408915" : "FAIL — TELEGRAM_BOT_TOKEN/CHAT_ID not loaded or API rejected",
  });

  // ── Cleanup ────────────────────────────────────────────────────────────
  await resetState();
  await setHalt(false);

  const passCount = results.filter(r => r.pass).length;
  const failCount = results.length - passCount;
  return NextResponse.json({
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: `${passCount}/${results.length} passed`,
    pass: failCount === 0,
    results,
  });
}
