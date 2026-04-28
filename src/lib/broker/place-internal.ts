/**
 * Internal place-order helper. Same guards as POST /api/broker/place, but
 * callable from server-internal code (auto-follow, jobs) without going through
 * the HTTP layer or auth middleware.
 *
 * Both the API route and auto-follow call into placeOrderInternal so guards
 * cannot drift. Single source of truth for: kill-switch, market-hours,
 * idempotency, daily-loss circuit breaker, contract validation, notional cap,
 * audit logging, Telegram notification.
 */
import { existsSync } from "fs";
import path from "path";
import { activeBroker, BrokerNotConnectedError } from "@/lib/broker";
import type { PlaceOrderInput } from "@/lib/broker/types";
import {
  appendAudit, checkCircuitBreaker, computeNotional, NOTIONAL_HARD_CAP, readAudit,
} from "@/lib/broker/audit";
import { isMarketOpen } from "@/lib/calls/scheduler";
import { validateContractRules } from "@/lib/broker/contract-rules";
import { notifyOrder } from "@/lib/notify/telegram";
import { readDailyPnL } from "@/lib/risk/daily-loss";

export type PlaceResult =
  | { ok: true; order_id: string; message?: string; broker: string; latencyMs?: number; idempotent?: boolean }
  | { ok: false; status: number; error: string; reason?: string };

export interface PlaceOptions {
  /** When true, skip the market-closed guard. Use only for ops/smoke tests. */
  forceOffHours?: boolean;
  /** Caller label written to the audit log (e.g. "auto-follow", "ui"). Defaults to "internal". */
  source?: string;
}

function killSwitchEngaged(): boolean {
  return existsSync(path.join(process.cwd(), ".local-data", "halt.flag"));
}

async function findRecentByTag(tag: string | undefined, windowMs = 60_000): Promise<string | null> {
  if (!tag) return null;
  const recent = await readAudit(50);
  const since = Date.now() - windowMs;
  for (const e of recent) {
    const sameTag = (e.input as any)?.orderTag === tag;
    const recentEnough = Date.parse(e.at) >= since;
    if (sameTag && recentEnough && e.action === "place" && e.result === "ok") {
      return (e.resultDetail as any)?.id ?? null;
    }
  }
  return null;
}

export async function placeOrderInternal(
  input: PlaceOrderInput,
  opts: PlaceOptions = {},
): Promise<PlaceResult> {
  if (killSwitchEngaged()) {
    return { ok: false, status: 503, error: "Order placement halted (kill-switch active). Remove .local-data/halt.flag to resume." };
  }

  const broker = await activeBroker();

  if (broker.id === "tradejini" && !input.orderTag) {
    return { ok: false, status: 400, error: "Live broker (tradejini) requires orderTag for idempotency." };
  }

  // Idempotency
  const existing = await findRecentByTag(input.orderTag, 60_000);
  if (existing) {
    return { ok: true, order_id: existing, message: "Idempotent: returning prior order id for same orderTag", broker: broker.id, idempotent: true };
  }

  if (!isMarketOpen() && !opts.forceOffHours) {
    const msg = "Markets are closed. NSE trades 09:15–15:30 IST Mon–Fri.";
    await appendAudit({ at: new Date().toISOString(), broker: broker.id, action: "place", input, result: "error", errorMessage: msg });
    return { ok: false, status: 400, error: msg };
  }

  const ruleErrs = validateContractRules({
    symbol: input.symbol,
    qty: input.qty,
    price: input.limitPrice ?? 0,
    isMarketOrder: input.type === 2,
  });
  if (ruleErrs.length > 0) {
    const msg = ruleErrs.map(e => e.message).join("; ");
    await appendAudit({ at: new Date().toISOString(), broker: broker.id, action: "place", input, result: "error", errorMessage: msg });
    return { ok: false, status: 400, error: msg };
  }

  const notional = computeNotional(input);
  if (notional > NOTIONAL_HARD_CAP) {
    const msg = `Notional ₹${notional.toFixed(0)} exceeds hard cap ₹${NOTIONAL_HARD_CAP}.`;
    await appendAudit({ at: new Date().toISOString(), broker: broker.id, action: "place", input, result: "error", errorMessage: msg });
    return { ok: false, status: 400, error: msg };
  }

  const breaker = await checkCircuitBreaker();
  if (!breaker.ok) {
    await appendAudit({ at: new Date().toISOString(), broker: broker.id, action: "place", input, result: "error", errorMessage: breaker.reason });
    return { ok: false, status: 429, error: breaker.reason };
  }

  const daily = await readDailyPnL(broker.id);
  if (daily.halted) {
    await appendAudit({ at: new Date().toISOString(), broker: broker.id, action: "place", input, result: "error", errorMessage: daily.reason });
    return { ok: false, status: 429, error: daily.reason };
  }

  const t0 = Date.now();
  try {
    const resp = await broker.placeOrder(input);
    const latencyMs = Date.now() - t0;
    await appendAudit({
      at: new Date().toISOString(),
      broker: broker.id,
      action: "place",
      input,
      result: "ok",
      resultDetail: { ...resp, latencyMs, source: opts.source ?? "internal" },
    });
    notifyOrder({
      ok: true, symbol: input.symbol, side: input.side === 1 ? "BUY" : "SELL", qty: input.qty,
      price: input.limitPrice || undefined, brokerOrderId: resp.id, source: input.orderTag,
      isLive: broker.id !== "paper",
    }).catch(() => {});
    return { ok: true, order_id: resp.id, message: resp.message, broker: broker.id, latencyMs };
  } catch (e) {
    const msg = (e as Error).message;
    const latencyMs = Date.now() - t0;
    await appendAudit({
      at: new Date().toISOString(),
      broker: broker.id,
      action: "place",
      input,
      result: "error",
      errorMessage: msg,
      resultDetail: { latencyMs, source: opts.source ?? "internal" },
    });
    notifyOrder({
      ok: false, symbol: input.symbol, side: input.side === 1 ? "BUY" : "SELL", qty: input.qty, error: msg, source: input.orderTag,
      isLive: broker.id !== "paper",
    }).catch(() => {});
    const status = e instanceof BrokerNotConnectedError ? 401 : 502;
    return { ok: false, status, error: msg };
  }
}
