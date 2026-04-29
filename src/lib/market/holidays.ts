// NSE Equity (CM) segment trading holidays — 2026.
// Sourced from NSE official holiday API: https://www.nseindia.com/api/holiday-master?type=trading
// Last verified: 2026-04-28
//
// Update annually. Dates that fall on weekends are excluded since the regime
// classifier already auto-skips Sat/Sun.

export const NSE_HOLIDAYS_2026 = new Set<string>([
  "2026-01-15",  // Municipal Corporation Election - Maharashtra
  "2026-01-26",  // Republic Day
  "2026-02-19",  // Chatrapati Shivaji Maharaj Jayanti
  "2026-03-03",  // Holi
  "2026-03-19",  // Gudi Padwa
  "2026-03-26",  // Shri Ram Navami
  "2026-03-31",  // Shri Mahavir Jayanti
  "2026-04-01",  // Annual Bank Closing
  "2026-04-03",  // Good Friday
  "2026-04-14",  // Dr. Baba Saheb Ambedkar Jayanti
  "2026-05-01",  // Maharashtra Day
  "2026-05-28",  // Bakri Id
  "2026-06-26",  // Muharram
  "2026-09-14",  // Ganesh Chaturthi
  "2026-10-02",  // Mahatma Gandhi Jayanti
  "2026-10-20",  // Dussehra
  "2026-11-10",  // Diwali-Balipratipada
  "2026-11-24",  // Prakash Gurpurb Sri Guru Nanak Dev
  "2026-12-25",  // Christmas

  // Weekends auto-skipped — these are reference for documentation only:
  // "2026-02-15"  Mahashivratri (Sun)
  // "2026-03-21"  Id-Ul-Fitr (Sat)
  // "2026-08-15"  Independence Day (Sat)
  // "2026-11-08"  Diwali Laxmi Pujan (Sun, Muhurat session — manual override if needed)
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
