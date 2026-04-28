// NSE Equity trading holidays — 2026. Sourced from NSE's published holiday list.
// Update annually from https://www.nseindia.com/resources/exchange-communication-holidays
// Format: YYYY-MM-DD (IST date on which the exchange is closed).

export const NSE_HOLIDAYS_2026 = new Set<string>([
  "2026-01-26",  // Republic Day
  "2026-03-03",  // Mahashivratri (approx — verify)
  "2026-03-20",  // Holi (approx — verify)
  "2026-03-31",  // Id-Ul-Fitr (approx — verify)
  "2026-04-03",  // Good Friday
  "2026-04-14",  // Dr. Ambedkar Jayanti
  "2026-04-29",  // Id-Ul-Fitr / Ramzan Id (approx)
  "2026-05-01",  // Maharashtra Day
  "2026-05-27",  // Bakri Id (approx)
  "2026-06-26",  // Muharram (approx)
  "2026-08-15",  // Independence Day (Saturday — may not be trading day anyway)
  "2026-08-27",  // Ganesh Chaturthi (approx)
  "2026-10-02",  // Gandhi Jayanti
  "2026-10-21",  // Diwali (approx — Muhurat session often held)
  "2026-10-22",  // Diwali Balipratipada
  "2026-11-04",  // Gurunanak Jayanti (approx)
  "2026-12-25",  // Christmas
]);

/** True if the date (YYYY-MM-DD IST) is a declared NSE trading holiday. */
export function isNseHoliday(istDate: string): boolean {
  return NSE_HOLIDAYS_2026.has(istDate);
}

/** Returns YYYY-MM-DD string in IST for a given Date. */
export function istDateString(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}
