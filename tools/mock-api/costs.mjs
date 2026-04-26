// Indian intraday-equity transaction costs (TradeJini retail tariff).
// Source: TradeJini brokerage page + NSE/SEBI/stamp-duty rate cards.
//
// All rates are for INTRADAY EQUITY on NSE. Index F&O / delivery / options
// have different rates — add later if those segments are traded.
//
// Why this exists: paper-mode P&L without these costs is dishonest. A
// strategy that "works" gross can lose money net. The user must see net
// figures before deciding to commit real capital.

// Brokerage: ₹20 per executed order, or 0.03% of turnover, whichever LOWER.
const BROKERAGE_FLAT_RUPEES = 20;
const BROKERAGE_PCT = 0.0003; // 0.03%

// STT (Securities Transaction Tax): 0.025% on SELL side only for intraday.
const STT_PCT_SELL = 0.00025;

// NSE Exchange Transaction Charges: 0.00297% on both sides (revised Oct 2023).
const EXCHANGE_TXN_PCT = 0.0000297;

// SEBI Turnover Fee: ₹10 per ₹1 crore = 0.0001% on both sides.
const SEBI_PCT = 0.000001;

// Stamp Duty: 0.003% on BUY side only (intraday equity, post-2020 rules).
const STAMP_DUTY_PCT_BUY = 0.00003;

// GST: 18% on (brokerage + exchange + SEBI). Applies both sides.
const GST_PCT = 0.18;

// Slippage: 2 basis points (0.02%) adverse on each side. Reflects bid-ask
// crossing and partial-fill drift on a market order in liquid Indian equity.
// Conservative — illiquid names will be worse, very liquid index ETFs better.
const SLIPPAGE_PCT = 0.0002;

/**
 * Compute one-leg cost (a single BUY or SELL execution).
 * @param {'BUY'|'SELL'} side
 * @param {number} price - quoted price the strategy "saw" before slippage
 * @param {number} quantity
 * @returns {{
 *   fillPrice: number,    // actual fill price after slippage
 *   slippage: number,     // total slippage cost in ₹
 *   brokerage: number,
 *   stt: number,
 *   exchangeTxn: number,
 *   sebi: number,
 *   stampDuty: number,
 *   gst: number,
 *   total: number,        // sum of all fees + slippage
 *   turnover: number,
 * }}
 */
export function legCosts(side, price, quantity) {
  // Slippage moves fill against you: buy higher, sell lower.
  const slipFactor = side === 'BUY' ? 1 + SLIPPAGE_PCT : 1 - SLIPPAGE_PCT;
  const fillPrice = price * slipFactor;
  const slippage = Math.abs(fillPrice - price) * quantity;

  const turnover = fillPrice * quantity;
  const brokerage = Math.min(BROKERAGE_FLAT_RUPEES, turnover * BROKERAGE_PCT);
  const stt = side === 'SELL' ? turnover * STT_PCT_SELL : 0;
  const exchangeTxn = turnover * EXCHANGE_TXN_PCT;
  const sebi = turnover * SEBI_PCT;
  const stampDuty = side === 'BUY' ? turnover * STAMP_DUTY_PCT_BUY : 0;
  const gst = (brokerage + exchangeTxn + sebi) * GST_PCT;
  const total = brokerage + stt + exchangeTxn + sebi + stampDuty + gst + slippage;

  return {
    fillPrice: round2(fillPrice),
    slippage: round2(slippage),
    brokerage: round2(brokerage),
    stt: round2(stt),
    exchangeTxn: round2(exchangeTxn),
    sebi: round2(sebi),
    stampDuty: round2(stampDuty),
    gst: round2(gst),
    total: round2(total),
    turnover: round2(turnover),
  };
}

function round2(n) { return Number(n.toFixed(2)); }

/**
 * Round-trip cost summary for documentation / sanity checks.
 * Example: ₹100 × 100 qty (₹10K turnover) → round-trip ~₹15  (0.15% breakeven)
 * Example: HDFCBANK ₹1700 × 6 qty (~₹10.2K) → round-trip ~₹17  (0.17%)
 * Example: NIFTY ₹24500 × 4 qty (~₹98K) → round-trip ~₹120  (0.12%)
 * Slippage dominates costs at small notionals; STT+brokerage dominate at large.
 */
export function roundTripCosts(price, quantity) {
  const buy = legCosts('BUY', price, quantity);
  const sell = legCosts('SELL', price, quantity);
  return {
    buy,
    sell,
    totalCost: round2(buy.total + sell.total),
    breakeven: round2((buy.total + sell.total) / quantity), // ₹/share needed to break even
  };
}
