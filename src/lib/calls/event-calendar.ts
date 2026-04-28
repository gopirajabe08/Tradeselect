/**
 * NSE event calendar — flags trading days within 24h of market-moving events.
 *
 * Veteran wisdom: trading 30 min around an earnings announcement, RBI policy,
 * F&O expiry, or budget = gambling, not trading. Auto-follow + journal should
 * tag these days so we can later separate "regular" P&L from "event-driven" P&L.
 *
 * Hard-coded for 2026 calendar. Update annually or replace with a feed.
 *
 * Includes:
 *   - F&O monthly expiry: last Thursday of each month
 *   - Budget Day: 2026-02-01 (already past in this run, kept for reference)
 *   - RBI policy meet dates (bi-monthly)
 *   - Quarterly earnings windows: Apr–May, Jul–Aug, Oct–Nov, Jan–Feb
 *   - Auto sales data: 1st of each month
 */

const FIXED_EVENTS_2026: Array<{ date: string; name: string }> = [
  // RBI policy decisions (approximate; check actual MPC schedule)
  { date: "2026-04-08", name: "RBI MPC meeting" },
  { date: "2026-06-04", name: "RBI MPC meeting" },
  { date: "2026-08-06", name: "RBI MPC meeting" },
  { date: "2026-10-08", name: "RBI MPC meeting" },
  { date: "2026-12-03", name: "RBI MPC meeting" },
  // Budget Day
  { date: "2026-02-01", name: "Union Budget" },
];

/** Returns YYYY-MM-DD in IST. */
function istDate(d: Date = new Date()): string {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Returns true if today is the first of an IST month (auto sales data day). */
function isAutoSalesDay(d: Date = new Date()): boolean {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.getUTCDate() === 1;
}

/** Returns true if today is the last Thursday of its IST month (F&O expiry). */
function isMonthlyExpiry(d: Date = new Date()): boolean {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  if (ist.getUTCDay() !== 4) return false; // not Thursday
  const next7 = new Date(ist);
  next7.setUTCDate(next7.getUTCDate() + 7);
  return next7.getUTCMonth() !== ist.getUTCMonth();
}

/** Returns true if today falls in a typical NSE earnings-results window (Apr-May, Jul-Aug, Oct-Nov, Jan-Feb). */
function isInEarningsWindow(d: Date = new Date()): boolean {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const m = ist.getUTCMonth() + 1; // 1-12
  return [1, 2, 4, 5, 7, 8, 10, 11].includes(m);
}

/** Returns event-window classification for the given timestamp (default: now). */
export function eventWindowFor(d: Date = new Date()): { isWithinEventWindow: boolean; eventName?: string } {
  const today = istDate(d);

  // Fixed-date events (within 24h of today = same day or day-before/day-after)
  const todayMs = new Date(today + "T00:00:00Z").getTime();
  for (const e of FIXED_EVENTS_2026) {
    const evMs = new Date(e.date + "T00:00:00Z").getTime();
    const diffDays = Math.abs((todayMs - evMs) / (24 * 3600 * 1000));
    if (diffDays <= 1) return { isWithinEventWindow: true, eventName: e.name };
  }

  if (isMonthlyExpiry(d)) return { isWithinEventWindow: true, eventName: "F&O monthly expiry" };
  if (isAutoSalesDay(d))  return { isWithinEventWindow: true, eventName: "Monthly auto sales data" };
  if (isInEarningsWindow(d)) return { isWithinEventWindow: true, eventName: "Quarterly earnings window" };

  return { isWithinEventWindow: false };
}
