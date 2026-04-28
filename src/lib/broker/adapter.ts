import type {
  FyersProfile, FyersFunds, FyersHolding, FyersPosition, FyersOrder, FyersQuoteRow,
  PlaceOrderInput,
} from "./types";

export type BrokerId = "paper" | "fyers" | "tradejini";

/**
 * Every broker (paper, Fyers, Tradejini, and future Upstox / Dhan) implements this.
 * The shapes are normalised to Fyers v3 types because that's what the UI was built against;
 * Tradejini and others translate to these shapes in their adapter.
 */
export interface BrokerAdapter {
  readonly id: BrokerId;
  readonly displayName: string;

  /** Whether this adapter supports real OAuth (paper returns false). */
  readonly supportsOAuth: boolean;

  /** OAuth redirect URL, or null for paper-mode brokers. */
  getLoginUrl?(): string;

  getProfile():   Promise<FyersProfile>;
  getFunds():     Promise<FyersFunds>;
  getHoldings():  Promise<FyersHolding[]>;
  getPositions(): Promise<{ netPositions: FyersPosition[]; overall?: unknown }>;
  getOrders():    Promise<FyersOrder[]>;
  getQuotes(symbols: string[]): Promise<FyersQuoteRow[]>;
  placeOrder(input: PlaceOrderInput): Promise<{ id: string; message?: string }>;
  cancelOrder(orderId: string): Promise<{ id: string }>;
}
