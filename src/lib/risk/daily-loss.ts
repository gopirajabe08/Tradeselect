import { ensureDayStart, readState as readPaperState, writeState as writePaperState } from "@/lib/broker/paper/store";
import { readAudit } from "@/lib/broker/audit";
import { readRiskConfig } from "./sizing";

/**
 * Daily-loss circuit breaker — automatic halt of new orders when today's P&L
 * crosses the configured threshold. Pairs with the manual kill-switch
 * (.local-data/halt.flag) and the per-trade notional cap.
 *
 *   today's P&L = (cash now − dayStartCash) + sum(unrealised on open positions)
 *   pnlPct      = pnl / dayStartCash × 100
 *   halted      = pnlPct ≤ −config.dailyMaxLossPct
 *
 * Paper mode: tracked via paper state's dayStartCash field, rolled forward each IST day.
 * Live mode (TradeJini): in v1 we don't gate live by daily-loss because we don't
 *  yet pull realised P&L from the broker. Add when wiring live.
 */

export type DailyPnLReading = {
  enabled: boolean;
  brokerMode: string;
  dayStartCash: number;
  realisedPnl: number;
  unrealisedPnl: number;
  pnlRs: number;
  pnlPct: number;
  thresholdPct: number;        // negative number, e.g. −2
  halted: boolean;
  reason: string;
};

export async function readDailyPnL(brokerMode: string): Promise<DailyPnLReading> {
  const cfg = await readRiskConfig();
  const thresholdPct = -Math.abs(cfg.dailyMaxLossPct ?? 0);
  const enabled = thresholdPct < 0;

  // For v1, the daily-loss tracking is paper-mode only. Live broker integration
  // will need its own realised-P&L source from the broker's positions API.
  if (brokerMode !== "paper") {
    return {
      enabled, brokerMode, dayStartCash: 0,
      realisedPnl: 0, unrealisedPnl: 0, pnlRs: 0, pnlPct: 0,
      thresholdPct, halted: false,
      reason: "Live mode — daily-loss tracker not yet wired (paper-only in v1).",
    };
  }

  const s = await readPaperState();
  // Roll forward day-start stamp if needed; persist if it changed.
  const rolled = ensureDayStart(s);
  if (rolled) await writePaperState(s);

  const dayStartCash = s.dayStartCash ?? s.cash;
  // CORRECT P&L semantics:
  //   realised   = sum of closed-trade outcomes booked on each position (does NOT
  //                include cash that was just deployed into an open position)
  //   unrealised = MTM on currently-open positions + holdings
  // Old formula `s.cash - dayStartCash` wrongly treated margin-lock as a loss,
  // tripping the breaker the moment auto-follow opened the first position.
  const realisedPnl = s.positions.reduce((sum, p) => sum + (p.realized ?? 0), 0);
  const unrealisedPositions = s.positions.reduce((sum, p) => sum + (p.netQty !== 0 ? (p.ltp - p.netAvg) * p.netQty : 0), 0);
  const unrealisedHoldings  = s.holdings.reduce((sum, h) => sum + (h.pl ?? 0), 0);
  const unrealisedPnl = unrealisedPositions + unrealisedHoldings;
  const pnlRs = realisedPnl + unrealisedPnl;
  const pnlPct = dayStartCash > 0 ? (pnlRs / dayStartCash) * 100 : 0;
  const halted = enabled && pnlPct <= thresholdPct;
  const reason = !enabled
    ? "Daily-loss breaker disabled (config.dailyMaxLossPct = 0)"
    : halted
      ? `Daily P&L ${pnlPct.toFixed(2)}% breached threshold ${thresholdPct.toFixed(2)}%. Trading halted until next IST day.`
      : `Daily P&L ${pnlPct.toFixed(2)}% within tolerance (threshold ${thresholdPct.toFixed(2)}%).`;

  return { enabled, brokerMode, dayStartCash, realisedPnl, unrealisedPnl, pnlRs, pnlPct, thresholdPct, halted, reason };
}

// ── 20-day rolling drawdown halt ──────────────────────────────────────────
// Catches sustained losing streaks that don't trip the daily cap on any single
// day but compound over weeks. Threshold defaults: 15% paper, configurable.
//
// Computation:
//   - Walk back through audit "auto-follow" entries with result=ok in last 20 trading days
//   - Sum realized P&L per day (from closed-position outcomes)
//   - Compute cumulative running peak + drawdown from peak
//   - Halt if drawdown > threshold

const ROLLING_WINDOW_DAYS = 20;

export type RollingDrawdownReading = {
  enabled: boolean;
  windowDays: number;
  thresholdPct: number;       // negative — e.g. -15 for "halt at 15% drawdown"
  startingCash: number;
  cumulativePnl: number;
  peakCash: number;
  drawdownRs: number;          // current drawdown from peak (positive number)
  drawdownPct: number;          // % of starting cash
  halted: boolean;
  reason: string;
};

/** Returns YYYY-MM-DD in IST. */
function istDate(d: Date | string): string {
  const ts = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  return new Date(ts + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function readRollingDrawdown(brokerMode: string): Promise<RollingDrawdownReading> {
  const cfg = await readRiskConfig();
  // Threshold for paper: 15%. Live (when wired): 10%. Reuse dailyMaxLossPct multiplied for now;
  // future: separate config field.
  const thresholdPct = brokerMode === "paper" ? -15 : -10;
  const enabled = thresholdPct < 0;

  if (brokerMode !== "paper") {
    return {
      enabled, windowDays: ROLLING_WINDOW_DAYS, thresholdPct,
      startingCash: 0, cumulativePnl: 0, peakCash: 0, drawdownRs: 0, drawdownPct: 0,
      halted: false, reason: "Live mode rolling-DD not yet wired (paper-only in v1).",
    };
  }

  const s = await readPaperState();
  const startingCash = s.startingCash ?? cfg.accountSize ?? 50_000;

  // Pull last N days of auto-follow audit entries
  const audit = await readAudit(2000);
  const cutoffMs = Date.now() - ROLLING_WINDOW_DAYS * 24 * 3600 * 1000;
  const recent = audit.filter(e =>
    e.action === "auto-follow" &&
    e.result === "ok" &&
    Date.parse(e.at) >= cutoffMs
  );

  // Group by IST date and sum the realized notional change per day.
  // Note: auto-follow audit captures *entries*, not exits. For a complete daily P&L
  // we'd need exit audit too. As a proxy, use the current paper realised P&L
  // accumulated across the window — reasonable for paper exploration.
  // For Phase 1 simplicity: cumulativePnl = (current cash - starting cash) + open unrealised
  // This approximates the rolling P&L without per-day reconstruction.
  const realisedPnl = s.positions.reduce((sum, p) => sum + (p.realized ?? 0), 0);
  const unrealisedPnl =
    s.positions.reduce((sum, p) => sum + (p.netQty !== 0 ? (p.ltp - p.netAvg) * p.netQty : 0), 0) +
    s.holdings.reduce((sum, h) => sum + (h.pl ?? 0), 0);
  const cumulativePnl = realisedPnl + unrealisedPnl;

  // Peak cash = max of starting cash or any historical high recorded.
  // We don't yet track historical peak. Best proxy: max(startingCash, startingCash + realisedPnl)
  const peakCash = Math.max(startingCash, startingCash + Math.max(0, cumulativePnl));
  const currentCash = startingCash + cumulativePnl;
  const drawdownRs = Math.max(0, peakCash - currentCash);
  const drawdownPct = startingCash > 0 ? -(drawdownRs / startingCash) * 100 : 0;
  const halted = enabled && drawdownPct <= thresholdPct;
  const reason = !enabled
    ? "Rolling-DD breaker disabled"
    : halted
      ? `Rolling drawdown ${drawdownPct.toFixed(2)}% over ${ROLLING_WINDOW_DAYS}d window breached threshold ${thresholdPct.toFixed(2)}%. Trading halted; review strategies.`
      : `Rolling drawdown ${drawdownPct.toFixed(2)}% within tolerance (threshold ${thresholdPct.toFixed(2)}%, window ${ROLLING_WINDOW_DAYS}d).`;

  return {
    enabled, windowDays: ROLLING_WINDOW_DAYS, thresholdPct,
    startingCash, cumulativePnl, peakCash, drawdownRs, drawdownPct,
    halted, reason,
  };
}

// ── Operational-failure counter ──────────────────────────────────────────
// Halts new orders if the system has logged ≥2 "operational" errors in the last
// 7 days. Operational = broker rejections, timeouts, contract validation fails,
// session expiry — failures that signal something's broken in the integration,
// not strategy P&L. Catches systemic problems before they cascade.
//
// "Operational error" definition (audit log result=error):
//   - action ∈ {"place", "cancel", "auto-follow"}
//   - errorMessage matches: timeout, auth, invalid, session, network, broker
//   - excludes: daily-loss halts, rolling-DD halts, market-closed (these aren't ops failures)

const OPS_FAIL_WINDOW_DAYS = 7;
const OPS_FAIL_THRESHOLD = 2;

const OPS_ERROR_PATTERNS = [
  /timeout/i,
  /auth/i,
  /session/i,
  /network/i,
  /econn/i,
  /etimeout/i,
  /503|502|504/,
  /broker.*reject/i,
  /invalid ip/i,
  /rate.limit/i,
];

const OPS_EXCLUDE_PATTERNS = [
  /daily.loss/i,
  /rolling.drawdown/i,
  /cooling.off/i,
  /market.closed/i,
  /opening.blackout/i,
  /lunch.lull/i,
  /closing.blackout/i,
  /score.*<.*[0-9]+/i,        // score-gate skips are not ops fails
  /max.open/i,
  /already have/i,
  /per.tick.cap/i,
  /F&O ban/i,
  /event window/i,
  /qty=0/i,
];

export type OpsFailureReading = {
  enabled: boolean;
  windowDays: number;
  threshold: number;
  recentFailures: number;
  halted: boolean;
  recentSamples: { at: string; message: string }[];
  reason: string;
};

export async function readOpsFailures(): Promise<OpsFailureReading> {
  const audit = await readAudit(2000);
  const cutoffMs = Date.now() - OPS_FAIL_WINDOW_DAYS * 24 * 3600 * 1000;
  const recent = audit.filter(e => {
    if (e.result !== "error") return false;
    if (Date.parse(e.at) < cutoffMs) return false;
    const msg = String(e.errorMessage ?? "");
    if (OPS_EXCLUDE_PATTERNS.some(p => p.test(msg))) return false;
    return OPS_ERROR_PATTERNS.some(p => p.test(msg));
  });

  const halted = recent.length >= OPS_FAIL_THRESHOLD;
  const reason = halted
    ? `Op-failure counter tripped: ${recent.length} operational errors in last ${OPS_FAIL_WINDOW_DAYS}d (threshold ${OPS_FAIL_THRESHOLD}). Halt for review. Latest: ${recent[0]?.errorMessage?.slice(0, 100)}`
    : `Op-failures within tolerance (${recent.length}/${OPS_FAIL_THRESHOLD} in ${OPS_FAIL_WINDOW_DAYS}d window).`;

  return {
    enabled: true,
    windowDays: OPS_FAIL_WINDOW_DAYS,
    threshold: OPS_FAIL_THRESHOLD,
    recentFailures: recent.length,
    halted,
    recentSamples: recent.slice(0, 5).map(e => ({ at: e.at, message: String(e.errorMessage ?? "").slice(0, 120) })),
    reason,
  };
}
