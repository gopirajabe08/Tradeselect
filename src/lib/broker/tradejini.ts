import type {
  FyersProfile, FyersFunds, FyersHolding, FyersPosition, FyersOrder, FyersQuoteRow,
  PlaceOrderInput,
} from "./types";
import {
  readBrokerSession, writeBrokerSession, clearBrokerSession, isLikelyExpired,
} from "./session";
import type { BrokerAdapter } from "./adapter";
import { BrokerApiError, BrokerNotConnectedError } from "./fyers";
import { totp } from "./totp";

/**
 * TradeJini Individual-mode adapter (CubePlus v2).
 *
 * Uses headless TOTP-based auth (no OAuth redirect):
 *   POST /v2/api-gw/oauth/individual-token-v2
 *     Authorization: Bearer ${API_KEY}
 *     body (form-encoded): password=${PIN}&twoFa=${TOTP_CODE}&twoFaTyp=totp
 *
 * All other API calls:
 *   Authorization: Bearer ${API_KEY}:${access_token}
 *   Reads via JSON GET, writes via form-encoded POST/DELETE.
 *
 * Response envelope is `{s, d}` (or `{s, data}`); we unwrap `.d`.
 *
 * Reference for endpoint shapes: LuckyNavi's working Python broker_client.py.
 * Each endpoint here was line-matched against that working production code.
 */

const BASE = process.env.TRADEJINI_API_BASE ?? "https://api.tradejini.com/v2";

function env() {
  const apiKey = process.env.TRADEJINI_API_KEY;
  const clientId = process.env.TRADEJINI_CLIENT_ID;
  const pin = process.env.TRADEJINI_PIN;
  const totpSecret = process.env.TRADEJINI_TOTP_SECRET;
  if (!apiKey || !clientId || !pin || !totpSecret) {
    throw new BrokerApiError(
      "TradeJini Individual-mode credentials missing. Required env: TRADEJINI_API_KEY, TRADEJINI_CLIENT_ID, TRADEJINI_PIN, TRADEJINI_TOTP_SECRET",
      0,
    );
  }
  return { apiKey, clientId, pin, totpSecret };
}

// ── Headless login ────────────────────────────────────────────────────────

/**
 * Distinct error types so the UI / caller can choose to retry vs alert.
 */
export class InvalidTotpError extends BrokerApiError {
  constructor(msg: string) { super(msg, 401); this.name = "InvalidTotpError"; }
}
export class InvalidPinError extends BrokerApiError {
  constructor(msg: string) { super(msg, 401); this.name = "InvalidPinError"; }
}

async function headlessLogin(): Promise<string> {
  const { apiKey, pin, totpSecret } = env();
  const code = totp(totpSecret);
  const body = new URLSearchParams({ password: pin, twoFa: code, twoFaTyp: "totp" });

  const res = await fetch(`${BASE}/api-gw/oauth/individual-token-v2`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    // Best-effort error classification. If TOTP/2FA is wrong the user can
    // retry; if PIN is wrong they need to update creds.
    const lower = text.toLowerCase();
    if (lower.includes("totp") || lower.includes("twofa") || lower.includes("otp") || lower.includes("two-factor")) {
      throw new InvalidTotpError(`TradeJini TOTP rejected: ${text.slice(0, 200)}`);
    }
    if (lower.includes("password") || lower.includes("pin") || lower.includes("invalid_credentials")) {
      throw new InvalidPinError(`TradeJini PIN rejected: ${text.slice(0, 200)}`);
    }
    throw new BrokerApiError(`TradeJini login failed (HTTP ${res.status}): ${text.slice(0, 200)}`, res.status);
  }
  let json: { access_token?: string; refresh_token?: string };
  try { json = JSON.parse(text); } catch { throw new BrokerApiError(`TradeJini login: non-JSON response: ${text.slice(0, 200)}`, 0); }
  if (!json.access_token) {
    throw new BrokerApiError(`TradeJini login: no access_token in response`, 0);
  }
  return json.access_token;
}

// ── Session resolution ────────────────────────────────────────────────────

let reLoginInFlight: Promise<void> | null = null;

async function ensureSession(forceRefresh = false): Promise<{ token: string; apiKey: string }> {
  const { apiKey, clientId } = env();
  let session = await readBrokerSession("tradejini");
  if (!forceRefresh && session && !isLikelyExpired(session) && session.accessToken) {
    return { token: session.accessToken, apiKey };
  }
  // Single re-login mutex per process; concurrent callers wait on the same
  // headless login rather than dog-piling TradeJini with parallel requests.
  if (!reLoginInFlight) {
    reLoginInFlight = (async () => {
      const token = await headlessLogin();
      const newSession = {
        brokerId: "tradejini" as const,
        appId: apiKey,
        accessToken: token,
        userId: clientId,
        userName: clientId,
        issuedAt: Date.now(),
      };
      try { await writeBrokerSession("tradejini", newSession); }
      catch (err) { console.warn("[tradejini] session write failed (using in-memory token):", (err as Error).message); }
    })();
    reLoginInFlight.finally(() => { reLoginInFlight = null; }).catch(() => {});
  }
  await reLoginInFlight;
  session = await readBrokerSession("tradejini");
  if (!session?.accessToken) throw new BrokerNotConnectedError();
  return { token: session.accessToken, apiKey };
}

async function authHeader(): Promise<Record<string, string>> {
  const { token, apiKey } = await ensureSession();
  return { Authorization: `Bearer ${apiKey}:${token}` };
}

/**
 * Wrap a single fetch call so we re-login + retry exactly once on 401.
 * Auth-endpoint 401s never go through this (they bubble out of headlessLogin).
 */
async function withReauthRetry<T>(fn: () => Promise<Response>): Promise<Response> {
  let res = await fn();
  if (res.status !== 401) return res;
  // Force a fresh login then retry once.
  await clearBrokerSession("tradejini");
  await ensureSession(true);
  res = await fn();
  return res;
}

// ── Generic API helpers ──────────────────────────────────────────────────

type Envelope<T = any> = { s?: string; d?: T; data?: T; status?: string; message?: string; msg?: string; [k: string]: any };

function unwrap<T>(json: Envelope<T>): T {
  if (json.s === "error" || json.status === "error") {
    throw new BrokerApiError(json.message ?? JSON.stringify(json).slice(0, 200), 0);
  }
  // TradeJini returns `{s: "no-data", msg: "No Data Available."}` for empty
  // collections. Treat that as success-with-empty-array so callers don't
  // throw on a fresh account.
  if (json.s === "no-data" || (json as any).msg === "No Data Available.") {
    return [] as unknown as T;
  }
  return (json.d ?? json.data ?? (json as unknown as T));
}

async function tjGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await withReauthRetry(async () => fetch(url, {
    headers: { ...(await authHeader()), Accept: "application/json" },
    cache: "no-store",
  }));
  const text = await res.text();
  if (!res.ok) throw new BrokerApiError(`TradeJini GET ${path} HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
  let json: Envelope; try { json = JSON.parse(text); } catch { throw new BrokerApiError(`Non-JSON response from ${path}`, 0); }
  return unwrap<T>(json);
}

async function tjPostForm<T>(path: string, form: Record<string, string | number>): Promise<T> {
  const body = new URLSearchParams(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)])));
  const res = await withReauthRetry(async () => fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    cache: "no-store",
  }));
  const text = await res.text();
  if (!res.ok) throw new BrokerApiError(`TradeJini POST ${path} HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
  let json: Envelope; try { json = JSON.parse(text); } catch { throw new BrokerApiError(`Non-JSON response from ${path}`, 0); }
  return unwrap<T>(json);
}

async function tjDelete<T>(path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await withReauthRetry(async () => fetch(url, {
    method: "DELETE",
    headers: { ...(await authHeader()), Accept: "application/json" },
    cache: "no-store",
  }));
  const text = await res.text();
  if (!res.ok) throw new BrokerApiError(`TradeJini DELETE ${path} HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
  let json: Envelope; try { json = JSON.parse(text); } catch { throw new BrokerApiError(`Non-JSON response from ${path}`, 0); }
  return unwrap<T>(json);
}

// ── Symbol translation ────────────────────────────────────────────────────

/**
 * Convert Fyers-style symbol ("NSE:RELIANCE-EQ") to TradeJini CubePlus
 * symId ("EQT_RELIANCE_EQ_NSE"). Equities only — F&O / MCX intentionally
 * unsupported until live equity trading is validated end-to-end.
 */
function fyersToCubeplus(symbol: string): string {
  const m = symbol.match(/^(NSE|BSE):([A-Z0-9&-]+)-(EQ|BE)$/i);
  if (m) return `EQT_${m[2].toUpperCase()}_${m[3].toUpperCase()}_${m[1].toUpperCase()}`;
  throw new BrokerApiError(
    `Symbol "${symbol}" not supported by Individual-mode adapter (cash equity only — F&O/MCX coming later)`,
    0,
  );
}

function cubeplusToFyers(symId: string): string {
  const m = symId.match(/^EQT_([A-Z0-9&-]+)_(EQ|BE)_(NSE|BSE)$/);
  if (m) return `${m[3]}:${m[1]}-${m[2]}`;
  return symId;
}

// ── Mappings (Fyers numeric → TradeJini string) ───────────────────────────

// Tradejini CubePlus API expects LOWERCASE values per official spec
// (POST /v2/api/oms/place-order — verified via search 2026-04-26 + OM06/OM07 rejection chain).
// Field name is `type` (not `orderType`). Side / product / type all lowercase.
const PRODUCT_MAP: Record<string, string> = {
  CNC:      "delivery",
  INTRADAY: "intraday",
  MARGIN:   "normal",
  MIS:      "intraday",
  NRML:     "normal",
  BO:       "bracket",
  CO:       "cover",
  MTF:      "mtf",
};
const ORDER_TYPE_MAP: Record<number, string> = { 1: "limit", 2: "market", 3: "sl-m", 4: "sl" };
const SIDE_MAP: Record<number, string> = { 1: "buy", [-1]: "sell" };

// ── BrokerAdapter implementation ──────────────────────────────────────────

export const TradejiniBroker: BrokerAdapter = {
  id: "tradejini",
  displayName: "Tradejini",
  // Individual mode is headless TOTP — no OAuth redirect.
  supportsOAuth: false,

  async getProfile(): Promise<FyersProfile> {
    const d = await tjGet<any>("/api/account/details");
    // Real TradeJini CubePlus shape (verified against MDY009):
    //   { d: { userId: "MDY009", userName: "...", mobile, email, pan, products, segments, ... } }
    return {
      fy_id: d?.userId ?? d?.clientCode ?? d?.client_id ?? env().clientId,
      name: d?.userName ?? d?.name ?? d?.clientName ?? "",
      display_name: d?.userName ?? d?.name ?? "",
      email_id: d?.email ?? "",
      mobile_number: d?.mobile ?? d?.phone ?? "",
      pan: d?.pan ?? "",
    };
  },

  async getFunds(): Promise<FyersFunds> {
    const d = await tjGet<any>("/api/oms/limits");
    const available = Number(d?.availMargin ?? d?.availCash ?? 0);
    const used = Number(d?.marginUsed ?? 0);
    const total = Number(d?.totalCredits ?? available + used);
    return {
      fund_limit: [
        { id: 1, title: "Total Balance", equityAmount: total, commodityAmount: 0 },
        { id: 10, title: "Available Balance", equityAmount: available, commodityAmount: 0 },
        { id: 7, title: "Utilized Amount", equityAmount: used, commodityAmount: 0 },
      ],
    };
  },

  async getHoldings(): Promise<FyersHolding[]> {
    const d = await tjGet<any[]>("/api/oms/holdings");
    const arr = Array.isArray(d) ? d : (d as any)?.holdings ?? [];
    return arr.map((h: any, idx: number) => ({
      symbol: h.symbol ? cubeplusToFyers(h.symbol) : `NSE:${h.tradingSymbol ?? h.symbolName ?? "UNKNOWN"}-EQ`,
      id: idx,
      quantity: Number(h.quantity ?? h.qty ?? 0),
      costPrice: Number(h.avgPrice ?? h.buyAvgPrice ?? 0),
      marketVal: Number(h.marketValue ?? h.mktValue ?? 0),
      ltp: Number(h.ltp ?? h.lastPrice ?? 0),
      pl: Number(h.pnl ?? h.pl ?? 0),
      segment: "CM",
      isin: h.isin ?? "",
    }));
  },

  async getPositions(): Promise<{ netPositions: FyersPosition[]; overall?: unknown }> {
    const d = await tjGet<any[]>("/api/oms/positions");
    const arr = Array.isArray(d) ? d : (d as any)?.netPositions ?? [];
    const netPositions = arr.map((p: any) => ({
      symbol: p.symbol ? cubeplusToFyers(p.symbol) : `NSE:${p.tradingSymbol ?? "UNKNOWN"}-EQ`,
      id: String(p.id ?? p.symbol ?? Math.random()),
      netQty: Number(p.netQty ?? p.netQuantity ?? 0),
      buyQty: Number(p.buyQty ?? p.buyQuantity ?? 0),
      sellQty: Number(p.sellQty ?? p.sellQuantity ?? 0),
      buyAvg: Number(p.buyAvg ?? p.buyAvgPrice ?? 0),
      sellAvg: Number(p.sellAvg ?? p.sellAvgPrice ?? 0),
      productType: p.productType ?? p.product ?? "INTRADAY",
      realized_profit: Number(p.realized_profit ?? p.realizedProfit ?? 0),
      unrealized_profit: Number(p.unrealized_profit ?? p.unrealizedProfit ?? 0),
      pl: Number(p.pnl ?? p.pl ?? 0),
      ltp: Number(p.ltp ?? 0),
      segment: 10, // CM
    }));
    return { netPositions };
  },

  async getOrders(): Promise<FyersOrder[]> {
    const d = await tjGet<any[]>("/api/oms/orders");
    const arr = Array.isArray(d) ? d : (d as any)?.orderBook ?? [];
    return arr.map((o: any) => ({
      id: String(o.orderId ?? o.id ?? ""),
      exchOrdId: o.exchOrderId ?? "",
      symbol: o.symbol ? cubeplusToFyers(o.symbol) : `NSE:${o.tradingSymbol ?? "UNKNOWN"}-EQ`,
      qty: Number(o.qty ?? o.quantity ?? 0),
      filledQty: Number(o.filledQty ?? o.filledQuantity ?? 0),
      remainingQuantity: Number((o.qty ?? 0) - (o.filledQty ?? 0)),
      status: mapOrderStatus(o.status ?? o.orderStatus),
      side: o.side === "BUY" || o.transactionType === "BUY" ? 1 : -1,
      type: mapOrderType(o.orderType ?? o.type),
      productType: o.productType ?? o.product ?? "INTRADAY",
      limitPrice: Number(o.limitPrice ?? o.price ?? 0),
      stopPrice: Number(o.stopPrice ?? o.triggerPrice ?? 0),
      tradedPrice: Number(o.avgFillPrice ?? o.tradedPrice ?? 0),
      orderDateTime: o.orderTime ?? o.orderDateTime ?? "",
      message: o.statusMessage ?? o.message ?? "",
    }));
  },

  async getQuotes(symbols: string[]): Promise<FyersQuoteRow[]> {
    // CubePlus Individual-mode quote API: GET /api/mkt-data/quote?symId=EQT_... per symbol.
    // Verify exact path against TradeJini docs before relying for live trading.
    const out: FyersQuoteRow[] = [];
    for (const fySym of symbols) {
      try {
        const symId = fyersToCubeplus(fySym);
        const d = await tjGet<any>("/api/mkt-data/quote", { symId });
        const lp = Number(d?.lastPrice ?? d?.ltp ?? d?.close ?? 0);
        out.push({
          n: fySym,
          s: "ok",
          v: {
            ch: Number(d?.change ?? 0),
            chp: Number(d?.changePct ?? d?.pChange ?? 0),
            lp,
            open_price: Number(d?.open ?? 0),
            high_price: Number(d?.high ?? 0),
            low_price: Number(d?.low ?? 0),
            prev_close_price: Number(d?.prevClose ?? 0),
            volume: Number(d?.volume ?? 0),
            short_name: fySym.split(":")[1]?.split("-")[0] ?? fySym,
            exchange: fySym.split(":")[0] ?? "NSE",
            symbol: fySym,
          },
        });
      } catch (err) {
        out.push({ n: fySym, s: "error", v: { ch: 0, chp: 0, lp: 0 } });
      }
    }
    return out;
  },

  async placeOrder(input: PlaceOrderInput): Promise<{ id: string; message?: string }> {
    const symId = fyersToCubeplus(input.symbol);
    const product = PRODUCT_MAP[input.productType] ?? "intraday";
    const orderType = ORDER_TYPE_MAP[input.type] ?? "limit";
    const side = SIDE_MAP[input.side] ?? "buy";

    // Tradejini CubePlus place-order spec uses field `type` (not `orderType`),
    // lowercase values, validity lowercase too.
    const form: Record<string, string | number> = {
      symId,
      qty: input.qty,
      product,
      type: orderType,
      side,
      validity: (input.validity ?? "DAY").toLowerCase(),
      mktProt: orderType === "market" ? "5" : "0",
      discQty: input.disclosedQty ?? "0",
    };
    if (orderType === "limit" || orderType === "sl") form.price = input.limitPrice ?? 0;
    if (orderType === "sl" || orderType === "sl-m") form.trigger = input.stopPrice ?? 0;
    if (input.orderTag) form.tag = input.orderTag;

    const d = await tjPostForm<any>("/api/oms/place-order", form);
    const id = String(d?.orderId ?? d?.id ?? "");
    return { id, message: d?.message };
  },

  async cancelOrder(orderId: string): Promise<{ id: string }> {
    await tjDelete<any>("/api/oms/cancel-order", { orderId });
    return { id: orderId };
  },
};

function mapOrderStatus(status: string | number | undefined): number {
  // TradeJini → Fyers status code
  // 2=filled, 6=open, 4=transit, 5=rejected, 1=cancelled
  const s = String(status ?? "").toUpperCase();
  if (s.includes("COMPLETE") || s === "FILLED" || s === "EXECUTED") return 2;
  if (s.includes("REJECTED")) return 5;
  if (s.includes("CANCEL")) return 1;
  if (s.includes("OPEN") || s.includes("PENDING")) return 6;
  return 4;
}

function mapOrderType(type: string | undefined): number {
  const t = String(type ?? "").toUpperCase();
  if (t === "MARKET") return 2;
  if (t === "LIMIT") return 1;
  if (t === "SL-M") return 4;
  if (t === "SL") return 3;
  return 1;
}

// ── Read-only smoke test (call from a one-shot script — never from request path) ──

export async function smokeTest(): Promise<{ ok: boolean; profile?: FyersProfile; funds?: FyersFunds; orders?: number; error?: string }> {
  try {
    const profile = await TradejiniBroker.getProfile();
    if (!profile.fy_id) return { ok: false, error: "profile missing fy_id (auth likely silently failed)" };
    const funds = await TradejiniBroker.getFunds();
    const orders = (await TradejiniBroker.getOrders()).length;
    return { ok: true, profile, funds, orders };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
