import { ensureDayStart, readState as readPaperState, writeState as writePaperState } from "@/lib/broker/paper/store";
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
