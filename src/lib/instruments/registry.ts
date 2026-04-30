/**
 * Instrument registry — single source of truth for what TradeSelect can trade.
 *
 * Each instrument is its own isolated universe: own paper account, own data
 * source, own cost model, own schedule, own strategies. Adding a new instrument
 * means adding a row here and implementing the adapter pieces — no surgery on
 * core auto-follow / scheduler.
 *
 * Phase 1 of the revised roadmap (2026-04-29) — multi-instrument paper foundation.
 * See project_phased_roadmap.md.
 */

export type InstrumentId =
  | "equity-intraday"
  | "equity-swing"
  | "mcx"
  | "options-index"
  | "futures-index"
  | "fno-stock";

export type ProductType = "INTRADAY" | "CNC" | "MIS" | "NRML" | "CO" | "BO" | "MTF";

export type DataSource =
  | "yahoo"            // Equity NSE: working today
  | "nse-bhavcopy"     // NSE archive — daily official data
  | "alpha-vantage"    // Optional fallback
  | "paid-mcx"         // MCX commodities (provider TBD)
  | "paid-options"     // Options chain (provider TBD)
  | "manual";          // CSV upload for backfill

export type CostModelKind =
  | "equity-intraday"  // STT 0.025% sell + brokerage + GST + stamp
  | "equity-cnc"       // STT 0.1% buy+sell + brokerage + GST + stamp
  | "mcx"              // CTT 0.01% sell + lot brokerage + GST
  | "options-index"    // STT 0.05% premium sell + brokerage + GST
  | "futures-index"    // CTT 0.01% sell + lot brokerage + GST
  | "fno-stock";       // STT 0.025% + brokerage + GST

/** IST hours window for trading. Used by per-instrument schedule timers. */
export type TradingHours = {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
  days: ("Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun")[];
};

export type InstrumentConfig = {
  id: InstrumentId;
  displayName: string;
  /** Paper account starting capital in INR. Realistic for the instrument. */
  paperCapital: number;
  /** Data source for backtesting + live quotes. */
  dataSource: DataSource;
  /** Cost model used for net P&L computation. */
  costModel: CostModelKind;
  /** Default broker product type for this instrument. */
  productType: ProductType;
  /** Whether positions are held across days (CNC, NRML) or auto-squared (INTRADAY). */
  multiDay: boolean;
  /** Max hold in trading days for multi-day instruments. Ignored for intraday. */
  maxHoldDays?: number;
  /** Trading hours in IST (24-hr format). */
  hours: TradingHours;
  /** Path to per-instrument paper state file (relative to .local-data/). */
  paperStatePath: string;
  /** Whether this instrument is currently enabled in production. */
  enabled: boolean;
  /** Description / notes. */
  notes?: string;
};

const ALL_WEEKDAYS: TradingHours["days"] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/**
 * The canonical instrument registry. Order matters for display.
 *
 * Status legend:
 *   enabled=true  → live in production paper trading
 *   enabled=false → registry entry exists but no strategies / data source / runtime support yet
 */
export const INSTRUMENTS: InstrumentConfig[] = [
  {
    id: "equity-intraday",
    displayName: "Equity Intraday (NSE MIS)",
    paperCapital: 50_000,  // 5× MIS leverage → ₹250k effective trading capacity, holds 4–5 positions
    dataSource: "yahoo",
    costModel: "equity-intraday",
    productType: "INTRADAY",
    multiDay: false,
    hours: { start: "09:15", end: "15:30", days: ALL_WEEKDAYS },
    paperStatePath: "paper/state.json",  // legacy single path; future: paper-equity-intraday/
    enabled: true,
    notes: "Default scope at project start. All 6 strategies originally built here. 5 of 6 culled per backtest.",
  },
  {
    id: "equity-swing",
    displayName: "Equity Swing (NSE CNC)",
    paperCapital: 95_000,  // 1× full notional. Holds 3–4 mid-cap positions @ ₹20–30k each
    dataSource: "yahoo",
    costModel: "equity-cnc",
    productType: "CNC",
    multiDay: true,
    maxHoldDays: 3,
    hours: { start: "09:15", end: "15:30", days: ALL_WEEKDAYS },
    paperStatePath: "paper-equity-swing/state.json",
    enabled: false,  // Phase 1 framework not yet supporting separate state path; still uses equity-intraday account
    notes: "Captures reversalBounce hold=3 backtest edge (+1.50 Sharpe 6mo). Needs Phase 4 GTT bracket completion before going live in paper.",
  },
  {
    id: "mcx",
    displayName: "MCX Commodities",
    paperCapital: 95_000,  // mini crude lot margin ~₹30–40k, gold mini ~₹40–50k → 1–2 concurrent lots
    dataSource: "paid-mcx",
    costModel: "mcx",
    productType: "NRML",
    multiDay: true,
    maxHoldDays: 5,
    hours: { start: "09:00", end: "23:30", days: ALL_WEEKDAYS },
    paperStatePath: "paper-mcx/state.json",
    enabled: false,
    notes: "Crude/Gold/Silver/Copper/NaturalGas. Extended hours. CTT 0.01% sell-side. Mini lots only at this capital. No strategies yet — Phase 2 research.",
  },
  {
    id: "options-index",
    displayName: "Index Options (NIFTY/BANKNIFTY)",
    paperCapital: 95_000,  // option spreads ~₹30k margin each → 2–3 concurrent positions
    dataSource: "paid-options",
    costModel: "options-index",
    productType: "NRML",
    multiDay: false,  // most index option strategies are intraday or weekly expiry
    hours: { start: "09:15", end: "15:30", days: ALL_WEEKDAYS },
    paperStatePath: "paper-options-index/state.json",
    enabled: false,
    notes: "Premium selling on weekly/monthly expiry. Theta + IV awareness required. At this capital, prefer spreads + buyers over naked sells. SEBI algo rules apply.",
  },
  {
    id: "futures-index",
    displayName: "Index Futures (BANKNIFTY mini only)",
    paperCapital: 95_000,  // NIFTY full lot needs ₹1.5L margin → CANNOT trade NIFTY futures at this capital. BANKNIFTY mini only.
    dataSource: "paid-options", // futures+options share data feeds typically
    costModel: "futures-index",
    productType: "NRML",
    multiDay: true,
    maxHoldDays: 30,  // monthly expiry-bound
    hours: { start: "09:15", end: "15:30", days: ALL_WEEKDAYS },
    paperStatePath: "paper-futures-index/state.json",
    enabled: false,
    notes: "Restricted to BANKNIFTY mini (lot=15) at this capital. NIFTY futures lot=75 needs ~₹1.5L margin and is excluded. Use for hedge against equity book + directional bets.",
  },
  {
    id: "fno-stock",
    displayName: "Stock F&O",
    paperCapital: 95_000,  // mid-cap stock futures margin ~₹50–100k → single position only
    dataSource: "nse-bhavcopy",
    costModel: "fno-stock",
    productType: "NRML",
    multiDay: true,
    maxHoldDays: 30,
    hours: { start: "09:15", end: "15:30", days: ALL_WEEKDAYS },
    paperStatePath: "paper-fno-stock/state.json",
    enabled: false,
    notes: "Lower priority — less liquid than index F&O. Phase 9 in roadmap. Single concurrent position max at this capital.",
  },
];

/** Look up an instrument by id. Returns undefined if not registered. */
export function getInstrument(id: InstrumentId): InstrumentConfig | undefined {
  return INSTRUMENTS.find(i => i.id === id);
}

/** All currently enabled instruments (for runtime iteration). */
export function enabledInstruments(): InstrumentConfig[] {
  return INSTRUMENTS.filter(i => i.enabled);
}

/** Default instrument for back-compat with single-instrument code paths. */
export const DEFAULT_INSTRUMENT_ID: InstrumentId = "equity-intraday";

/** Resolve an instrument id from a strategy productType (for legacy code that only knows productType). */
export function instrumentFromProductType(productType: ProductType, multiDay: boolean): InstrumentId {
  if (productType === "INTRADAY" || productType === "MIS" || productType === "CO" || productType === "BO") {
    return "equity-intraday";
  }
  if (productType === "CNC" && multiDay) return "equity-swing";
  if (productType === "NRML") return "futures-index";  // ambiguous; caller should pass explicit id
  return DEFAULT_INSTRUMENT_ID;
}
