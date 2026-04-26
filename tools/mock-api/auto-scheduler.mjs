// Auto-launches strategies hands-free.
// Runs every minute. For each catalog entry whose window is today and not
// yet finished, ensures one RUNNING instance exists. Skips weekends and
// NSE holidays. End-of-day, marks any leftover RUNNING instance as STOPPED
// (defense-in-depth — strategies should self-exit at window-close, but if
// one didn't, we close it cleanly here).

import { CATALOG, isInWindow, nowISTHHMM, nowISTDayOfWeek } from './catalog.mjs';
import { getState, save, createInstance, stopInstance } from './state.mjs';
import { notifyLaunched, notifyClosed, notifyDailySummary } from './telegram.mjs';

// NSE equity-segment trading holidays. **VERIFY THIS LIST BEFORE TRADING.**
// Source: https://www.nseindia.com/resources/exchange-communication-holidays
// NOTE: lunar-calendar holidays (Eid, Holi, Diwali, Ram Navami) shift each
// year; refresh in December. Dates below are best-effort 2026 estimates and
// must be cross-checked against the official NSE annual circular.
const NSE_HOLIDAYS_2026 = new Set([
  '2026-01-26', // Republic Day
  '2026-03-04', // Holi
  '2026-03-20', // Eid-ul-Fitr (lunar — verify)
  '2026-03-26', // Ram Navami
  '2026-03-31', // Mahavir Jayanti
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-27', // Eid-ul-Adha (lunar — verify)
  '2026-06-25', // Muharram (lunar — verify)
  '2026-08-26', // Ganesh Chaturthi
  '2026-10-02', // Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-09', // Diwali Laxmi Pujan (regular session closed; muhurat-only)
  '2026-11-10', // Balipratipada
  '2026-11-24', // Guru Nanak Jayanti
  '2026-12-25', // Christmas
]);

// Min minutes that must remain in a window before auto-launching. Below
// this, the strategy would barely place one trade and immediately get force-
// exited at window-close, eating both legs of costs for nothing.
const MIN_WINDOW_REMAINING_MIN = 5;

function nowISTDate() {
  const istMs = Date.now() + 330 * 60_000;
  const d = new Date(istMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isTradingDay() {
  const dow = nowISTDayOfWeek();
  if (dow === 0 || dow === 6) return false;
  if (NSE_HOLIDAYS_2026.has(nowISTDate())) return false;
  return true;
}

// Has the given window already passed for today?
function windowFinished(w) {
  if (!w) return false;
  return nowISTHHMM() >= w.end;
}

// Minutes until window-end. Negative if already past.
function minutesRemainingInWindow(w) {
  if (!w) return Infinity;
  const [eh, em] = w.end.split(':').map(Number);
  const [nh, nm] = nowISTHHMM().split(':').map(Number);
  return (eh * 60 + em) - (nh * 60 + nm);
}

// Does this strategy already have a RUNNING instance launched today?
function hasRunningInstanceToday(state, strategyCode) {
  const today = nowISTDate();
  return state.instances.some((i) =>
    i.strategyCode === strategyCode &&
    i.status === 'RUNNING' &&
    i.startedAt.slice(0, 10) === today
  );
}

// Has a STOPPED instance for this strategy already run today (so we don't
// re-launch after auto-stop / user-stop)?
function alreadyRanToday(state, strategyCode) {
  const today = nowISTDate();
  return state.instances.some((i) =>
    i.strategyCode === strategyCode &&
    i.startedAt.slice(0, 10) === today
  );
}

let isRunning = false;
let lastTickedAt = 0;

export async function autoSchedulerTick() {
  // Re-entrancy guard. setInterval ticks every 2s, but this function's
  // awaits (createInstance → save) can take seconds. A boolean lock is
  // stronger than a time-based one because it survives slow runs.
  if (isRunning) return;
  const now = Date.now();
  if (now - lastTickedAt < 30_000) return;
  isRunning = true;
  lastTickedAt = now;

  try {
    if (!isTradingDay()) return;

    const state = getState();
    const launched = [];
    const closed = [];
    const today = nowISTDate();

    for (const s of CATALOG) {
      try {
        // Strategies without a window run all day — skip auto-launch.
        if (!s.window) continue;
        // Window already passed today.
        if (windowFinished(s.window)) continue;
        // Less than N minutes remaining — don't bother launching for a single
        // round-trip that will eat costs without time to recover them.
        if (minutesRemainingInWindow(s.window) < MIN_WINDOW_REMAINING_MIN) continue;
        // Already ran (running or stopped) today.
        if (alreadyRanToday(state, s.code)) continue;

        const inst = await createInstance({
          strategyCode: s.code,
          strategyName: s.name,
          strategyType: s.category ?? 'tradeauto',
          algoKey: s.algoKey,
          instrument: s.instrument,
          exchange: 'NSE_EQ',
          capital: s.minimumCapital,
          mode: 'PT',
          window: s.window,
          scheduleEnabled: true,
        });
        launched.push({ code: s.code, instanceId: inst.id });
      } catch (err) {
        // Per-strategy launch failure must not abort the whole batch.
        console.error(`[auto-scheduler] launch failed for ${s.code}:`, err.message);
      }
    }

    // End-of-day cleanup: after 15:35 IST, stop only TODAY's auto-launched
    // instances (scheduleEnabled=true AND startedAt is today). Manual / pre-
    // existing / multi-day instances are left untouched.
    if (nowISTHHMM() >= '15:35') {
      for (const inst of state.instances) {
        if (inst.status !== 'RUNNING') continue;
        if (!inst.scheduleEnabled) continue;
        if (inst.startedAt.slice(0, 10) !== today) continue;
        try {
          const stopped = await stopInstance(inst.id);
          closed.push({
            code: inst.strategyCode,
            instanceId: inst.id,
            realizedPnl: stopped?.realizedPnl ?? 0,
          });
        } catch (err) {
          console.error(`[auto-scheduler] EOD stop failed for inst#${inst.id}:`, err.message);
        }
      }
    }

    if (launched.length || closed.length) {
      console.log(`[auto-scheduler] ${nowISTHHMM()} IST: launched=${launched.length} closed=${closed.length}`,
        launched.length ? `→ ${launched.map((l) => `${l.code}#${l.instanceId}`).join(',')}` : '',
        closed.length ? `← ${closed.map((c) => `${c.code}#${c.instanceId}`).join(',')}` : '',
      );
      await save();
      notifyLaunched(launched).catch(() => {});
      notifyClosed(closed).catch(() => {});
    }

    // Daily summary at 15:40 IST (after EOD close, once per day).
    await maybeSendDailySummary(state);
  } finally {
    // Release re-entrancy lock no matter what.
    isRunning = false;
  }
}

let lastSummarySentDate = null;

async function maybeSendDailySummary(state) {
  if (nowISTHHMM() < '15:40') return;
  const today = nowISTDate();
  if (lastSummarySentDate === today) return;
  lastSummarySentDate = today;

  const todays = state.instances.filter((i) => i.startedAt.slice(0, 10) === today);
  if (todays.length === 0) return;

  const byStrategy = todays.map((i) => ({
    code: i.strategyCode,
    name: i.strategyName,
    trades: (i.tradeIds ?? []).length,
    pnl: i.realizedPnl ?? 0,
  })).sort((a, b) => b.pnl - a.pnl);

  const totalRealized = byStrategy.reduce((sum, s) => sum + s.pnl, 0);
  const topWinner = byStrategy[0];
  const topLoser = byStrategy[byStrategy.length - 1];

  await notifyDailySummary({ date: today, totalRealized, byStrategy, topWinner, topLoser })
    .catch((err) => console.error('[auto-scheduler] summary notify failed:', err.message));
}

// Status report for the UI / health endpoint.
export function autoSchedulerStatus() {
  const state = getState();
  const today = nowISTDate();
  const runningToday = state.instances.filter((i) =>
    i.status === 'RUNNING' && i.startedAt.slice(0, 10) === today
  );
  const finishedToday = state.instances.filter((i) =>
    i.status === 'STOPPED' && i.startedAt.slice(0, 10) === today
  );
  const upcoming = isTradingDay()
    ? CATALOG.filter((s) =>
        s.window &&
        !windowFinished(s.window) &&
        !alreadyRanToday(state, s.code)
      )
    : [];

  return {
    enabled: process.env.AUTO_SCHEDULER_ENABLED === 'true',
    isTradingDay: isTradingDay(),
    nowIST: nowISTHHMM(),
    today,
    runningToday: runningToday.map((i) => ({
      id: i.id, code: i.strategyCode, instrument: i.instrument,
      window: i.window, inWindow: i.inWindow,
      realizedPnl: i.realizedPnl, unrealizedPnl: i.unrealizedPnl,
    })),
    finishedToday: finishedToday.map((i) => ({
      id: i.id, code: i.strategyCode, realizedPnl: i.realizedPnl,
    })),
    upcomingToday: upcoming.map((s) => ({
      code: s.code, name: s.name, instrument: s.instrument,
      windowStart: s.window.start, windowEnd: s.window.end,
      capital: s.minimumCapital,
    })),
  };
}
