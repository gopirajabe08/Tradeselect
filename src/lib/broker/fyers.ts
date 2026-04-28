import crypto from "crypto";
import type {
  FyersProfile, FyersFunds, FyersHolding, FyersPosition, FyersOrder, FyersQuoteRow,
  PlaceOrderInput,
} from "./types";
import { readBrokerSession } from "./session";

const BASE = "https://api-t1.fyers.in/api/v3";

export class BrokerNotConnectedError extends Error {
  constructor() { super("Broker not connected. Complete OAuth at /broker."); this.name = "BrokerNotConnectedError"; }
}

export class BrokerApiError extends Error {
  status: number;
  code?: number;
  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "BrokerApiError";
    this.status = status;
    this.code = code;
  }
}

function env() {
  const appId       = process.env.FYERS_APP_ID;
  const secretKey   = process.env.FYERS_SECRET_KEY;
  const redirectUri = process.env.FYERS_REDIRECT_URI ?? "http://localhost:2001/api/broker/callback";
  if (!appId || !secretKey) {
    throw new Error("FYERS_APP_ID / FYERS_SECRET_KEY missing. Copy .env.local.example to .env.local and fill them in.");
  }
  return { appId, secretKey, redirectUri };
}

export function getLoginUrl(state = "ts"): string {
  const { appId, redirectUri } = env();
  const qs = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `${BASE}/generate-authcode?${qs.toString()}`;
}

export function appIdHash(): string {
  const { appId, secretKey } = env();
  return crypto.createHash("sha256").update(`${appId}:${secretKey}`).digest("hex");
}

/** Exchange auth_code for access_token (called from OAuth callback). */
export async function validateAuthCode(authCode: string): Promise<{
  access_token: string;
  refresh_token?: string;
}> {
  const body = {
    grant_type: "authorization_code",
    appIdHash: appIdHash(),
    code: authCode,
  };
  const res = await fetch(`${BASE}/validate-authcode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json() as { s?: string; code?: number; message?: string; access_token?: string; refresh_token?: string };
  if (!res.ok || json.s !== "ok" || !json.access_token) {
    throw new BrokerApiError(json.message ?? `validate-authcode failed (HTTP ${res.status})`, res.status, json.code);
  }
  return { access_token: json.access_token, refresh_token: json.refresh_token };
}

async function authHeader(): Promise<Record<string, string>> {
  const session = await readBrokerSession("fyers");
  if (!session) throw new BrokerNotConnectedError();
  // Fyers v3 auth header: `<app_id>:<access_token>`
  return { "Authorization": `${session.appId}:${session.accessToken}` };
}

async function fyGet<T>(path: string): Promise<T> {
  const headers = await authHeader();
  const res = await fetch(`${BASE}${path}`, { headers, cache: "no-store" });
  const json = await res.json() as any;
  if (res.status === 401 || json?.code === 403 || json?.message === "invalid token") {
    throw new BrokerNotConnectedError();
  }
  if (!res.ok || (json?.s && json.s !== "ok")) {
    throw new BrokerApiError(json?.message ?? `GET ${path} failed (HTTP ${res.status})`, res.status, json?.code);
  }
  return json as T;
}

async function fyPost<T>(path: string, body: unknown): Promise<T> {
  const headers = { ...(await authHeader()), "Content-Type": "application/json" };
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
  const json = await res.json() as any;
  if (res.status === 401 || json?.code === 403) throw new BrokerNotConnectedError();
  if (!res.ok || (json?.s && json.s !== "ok")) {
    throw new BrokerApiError(json?.message ?? `POST ${path} failed (HTTP ${res.status})`, res.status, json?.code);
  }
  return json as T;
}

async function fyDelete<T>(path: string, body?: unknown): Promise<T> {
  const headers = { ...(await authHeader()), "Content-Type": "application/json" };
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const json = await res.json() as any;
  if (res.status === 401 || json?.code === 403) throw new BrokerNotConnectedError();
  if (!res.ok || (json?.s && json.s !== "ok")) {
    throw new BrokerApiError(json?.message ?? `DELETE ${path} failed (HTTP ${res.status})`, res.status, json?.code);
  }
  return json as T;
}

// ───────────────── Read API ─────────────────
export const FyersBroker = {
  id: "fyers" as const,

  getProfile: async (): Promise<FyersProfile> => {
    const r = await fyGet<{ data?: FyersProfile; profile?: FyersProfile }>("/profile");
    return (r as any).data ?? (r as any).profile ?? (r as any);
  },

  getFunds: async (): Promise<FyersFunds> => {
    const r = await fyGet<FyersFunds>("/funds");
    return r;
  },

  getHoldings: async (): Promise<FyersHolding[]> => {
    const r = await fyGet<{ holdings?: FyersHolding[]; overall?: any }>("/holdings");
    return r.holdings ?? [];
  },

  getPositions: async (): Promise<{ netPositions: FyersPosition[]; overall?: any }> => {
    const r = await fyGet<{ netPositions?: FyersPosition[]; overall?: any }>("/positions");
    return { netPositions: r.netPositions ?? [], overall: r.overall };
  },

  getOrders: async (): Promise<FyersOrder[]> => {
    const r = await fyGet<{ orderBook?: FyersOrder[] }>("/orders");
    return r.orderBook ?? [];
  },

  /**
   * Live quotes for up to 50 symbols.
   * Symbols must be fully qualified Fyers tickers, e.g. "NSE:RELIANCE-EQ"
   */
  getQuotes: async (symbols: string[]): Promise<FyersQuoteRow[]> => {
    if (symbols.length === 0) return [];
    const r = await fyGet<{ d?: FyersQuoteRow[] }>(`/data/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
    return r.d ?? [];
  },

  // ───────────────── Write API ─────────────────
  placeOrder: async (o: PlaceOrderInput): Promise<{ id: string; message?: string }> => {
    const payload = {
      symbol: o.symbol,
      qty: o.qty,
      type: o.type,
      side: o.side,
      productType: o.productType,
      limitPrice: o.limitPrice ?? 0,
      stopPrice: o.stopPrice ?? 0,
      validity: o.validity ?? "DAY",
      disclosedQty: o.disclosedQty ?? 0,
      offlineOrder: o.offlineOrder ?? false,
      stopLoss: o.stopLoss ?? 0,
      takeProfit: o.takeProfit ?? 0,
      orderTag: o.orderTag,
    };
    return fyPost("/orders/sync", payload);
  },

  cancelOrder: async (orderId: string): Promise<{ id: string }> => {
    return fyDelete("/orders/sync", { id: orderId });
  },
};
