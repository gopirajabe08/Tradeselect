/**
 * Contract validation rules: tick size + F&O / MCX lot size.
 *
 *   Tick size — price must be a multiple of the exchange's minimum price increment.
 *               Most NSE equity and F&O = ₹0.05. Low-priced stocks sometimes ₹0.01.
 *               We apply the conservative ₹0.05 default; override per symbol if needed.
 *
 *   Lot size  — for F&O and MCX, quantity must be a multiple of the contract's lot size.
 *               NSE publishes this per symbol; we maintain a subset for the big names we call on.
 *               Unknown → skip check (user's responsibility).
 */

export const DEFAULT_TICK = 0.05;

/** Per-symbol tick overrides (rare — mostly for stocks under ₹100 with ₹0.01 tick). */
export const TICK_OVERRIDES: Record<string, number> = {
  // Example: "NSE:IDEA-EQ": 0.01
};

/**
 * F&O / MCX lot sizes — snapshot for the liquid contracts we publish ideas on.
 * Update quarterly from the NSE / MCX contract specs.
 *
 * Key is a symbol substring match (case-insensitive). We check if the order's
 * tradingsymbol contains the key.
 */
export const LOT_SIZES: Record<string, number> = {
  // NSE indices (F&O)
  "NIFTY":      25,
  "BANKNIFTY":  15,
  "FINNIFTY":   40,

  // NSE F&O single stocks — high-turnover names
  "RELIANCE":   250,
  "TCS":        150,
  "HDFCBANK":   550,
  "INFY":       400,
  "ICICIBANK":  700,
  "LT":         150,
  "SBIN":       750,
  "ITC":        1600,
  "AXISBANK":   625,
  "KOTAKBANK":  400,
  "BHARTIARTL": 475,
  "MARUTI":     50,
  "ASIANPAINT": 200,
  "SUNPHARMA":  350,
  "ULTRACEMCO": 100,
  "TITAN":      175,
  "HCLTECH":    350,
  "WIPRO":      1800,

  // MCX commodities
  "CRUDEOIL":   100,
  "GOLD":       100,
  "GOLDM":      10,
  "SILVER":     30,
  "SILVERM":    5,
  "NATURALGAS": 1250,
  "COPPER":     2500,
};

/** Returns the tick size for a symbol. Default ₹0.05. */
export function tickSizeFor(symbol: string): number {
  return TICK_OVERRIDES[symbol] ?? DEFAULT_TICK;
}

/** Returns lot size if we know it; null for equity (no lot) or unknown. */
export function lotSizeFor(symbol: string, isFnoOrMcx: boolean): number | null {
  if (!isFnoOrMcx) return null;
  const upper = symbol.toUpperCase();
  for (const key of Object.keys(LOT_SIZES)) {
    if (upper.includes(key)) return LOT_SIZES[key];
  }
  return null;
}

/** Symbol belongs to a segment where lot size applies. */
export function isFnoOrMcxSymbol(fyersSymbol: string): boolean {
  const upper = fyersSymbol.toUpperCase();
  return upper.startsWith("NFO:") || upper.startsWith("BFO:") || upper.startsWith("MCX:") || upper.startsWith("CDS:");
}

/** True when `value` is a multiple of `step` within a small epsilon. */
export function isMultipleOf(value: number, step: number): boolean {
  if (step <= 0) return true;
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
}

export type RuleError = { field: "price" | "qty" | "symbol"; message: string };

/** Validates tick + lot rules. Returns array of errors (empty = ok). */
export function validateContractRules(input: {
  symbol: string;
  qty: number;
  price?: number;          // ignored if market order
  isMarketOrder: boolean;
}): RuleError[] {
  const errs: RuleError[] = [];
  const fnoMcx = isFnoOrMcxSymbol(input.symbol);

  // Tick size on limit price
  if (!input.isMarketOrder && input.price != null && input.price > 0) {
    const tick = tickSizeFor(input.symbol);
    if (!isMultipleOf(input.price, tick)) {
      errs.push({
        field: "price",
        message: `Price ₹${input.price} is not a multiple of the tick size ₹${tick}. Use nearest valid tick (e.g. ₹${(Math.round(input.price / tick) * tick).toFixed(2)}).`,
      });
    }
  }

  // Lot size for F&O / MCX
  if (fnoMcx) {
    const lot = lotSizeFor(input.symbol, true);
    if (lot !== null && !isMultipleOf(input.qty, lot)) {
      errs.push({
        field: "qty",
        message: `Quantity ${input.qty} is not a multiple of the lot size ${lot} for ${input.symbol}. Use ${lot}, ${lot*2}, ${lot*3}, etc.`,
      });
    }
  }

  return errs;
}
