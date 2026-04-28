// Shapes of Fyers v3 REST responses.
// Docs: https://myapi.fyers.in/docsv3

export type BrokerSession = {
  brokerId: "fyers";
  appId: string;
  accessToken: string;
  refreshToken?: string;
  userId: string;
  userName: string;
  email?: string;
  issuedAt: number;    // ms
};

export type FyersProfile = {
  fy_id?: string;
  name?: string;
  display_name?: string;
  email_id?: string;
  mobile_number?: string;
  pan?: string;
  pin_change_date?: string;
  image?: string;
  totp?: boolean;
};

export type FyersFunds = {
  fund_limit: Array<{
    id: number;
    title: string;       // e.g. "Total Balance", "Available Balance", "Utilized Amount"
    equityAmount: number;
    commodityAmount: number;
  }>;
};

export type FyersHolding = {
  symbol: string;          // "NSE:RELIANCE-EQ"
  id: number;
  quantity: number;
  costPrice: number;
  marketVal: number;
  ltp: number;
  pl: number;
  segment: string;         // "CM"
  isin?: string;
  fyToken?: string;
  holdingType?: string;    // "HLD" etc.
  qty_t1?: number;
  remainingQuantity?: number;
};

export type FyersPosition = {
  symbol: string;
  id: string;
  netQty: number;
  qty?: number;
  buyQty?: number;
  sellQty?: number;
  buyAvg?: number;
  sellAvg?: number;
  buyVal?: number;
  sellVal?: number;
  netAvg?: number;
  productType: string;     // CNC, INTRADAY, MARGIN, CO, BO
  side?: number;           // 1 buy, -1 sell
  realized_profit?: number;
  unrealized_profit?: number;
  pl?: number;
  ltp?: number;
  crossCurrency?: string;
  rbiRefRate?: number;
  qtyMulti_com?: number;
  segment: number;
};

export type FyersOrder = {
  id: string;
  exchOrdId?: string;
  symbol: string;
  qty: number;
  remainingQuantity?: number;
  filledQty?: number;
  status: number;          // 2=filled, 6=open, 4=transit, 5=rejected, 1=cancelled
  side: number;            // 1 buy, -1 sell
  type: number;            // 1=limit, 2=market, 3=SL-M, 4=SL
  productType: string;
  limitPrice?: number;
  stopPrice?: number;
  tradedPrice?: number;
  orderDateTime?: string;
  orderValidity?: string;
  parentId?: string | null;
  message?: string;
};

export type FyersQuoteRow = {
  n: string;               // symbol
  s: "ok" | "error";
  v: {
    ch: number;             // change
    chp: number;            // change %
    lp: number;             // last price
    spread?: number;
    bid?: number;
    ask?: number;
    open_price?: number;
    high_price?: number;
    low_price?: number;
    prev_close_price?: number;
    volume?: number;
    short_name?: string;
    exchange?: string;
    description?: string;
    original_name?: string;
    symbol?: string;
    fyToken?: string;
    tt?: number;            // timestamp
    cmd?: { bids?: any[]; ask?: any[] };
  };
};

// ── Our app-level order shape (normalised across brokers; currently Fyers) ──

export type PlaceOrderInput = {
  // Fyers symbol (e.g. "NSE:RELIANCE-EQ", "NFO:NIFTY24APRFUT", "MCX:CRUDEOIL24MAYFUT")
  symbol: string;
  qty: number;
  // 1 = Limit, 2 = Market, 3 = Stop (SL-M), 4 = Stop Limit (SL)
  type: 1 | 2 | 3 | 4;
  // 1 = Buy, -1 = Sell
  side: 1 | -1;
  // CNC, INTRADAY, MARGIN, CO, BO, MTF
  productType: "CNC" | "INTRADAY" | "MARGIN" | "CO" | "BO" | "MTF";
  limitPrice?: number;
  stopPrice?: number;
  validity?: "DAY" | "IOC";
  disclosedQty?: number;
  offlineOrder?: boolean;
  // For BO/CO:
  stopLoss?: number;       // absolute diff from entry
  takeProfit?: number;     // absolute diff from entry
  // Tag for reconciliation (Fyers field: orderTag)
  orderTag?: string;
  /** OCO group id (paper engine only). When one order in the group fills, others auto-cancel. */
  ocoGroup?: string;
};
