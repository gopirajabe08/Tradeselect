// Auto-launches strategies hands-free.
// Runs every minute. For each catalog entry whose window is today and not
// yet finished, ensures one RUNNING instance exists. Skips weekends and
// NSE holidays. End-of-day, marks any leftover RUNNING instance as STOPPED
// (defense-in-depth — strategies should self-exit at window-close, but if
// one didn't, we close it cleanly here).

import { CATALOG, isInWindow, nowISTHHMM, nowISTDayOfWeek } from './catalog.mjs';
import { getState, save, createInstance, stopInstance } from './state.mjs';

// 2026 NSE equity-segment holiday list (Republic Day, Holi, Good Friday, etc.).
// Format: 'YYYY-MM-DD'. NSE publishes this annually; refresh each Dec.
// If the date isn't in here, we treat it as a normal trading day.
// Source: https://www.nseindia.com/resources/exchange-communication-holidays
const NSE_HOLIDAYS_2026 = new Set([
  '2026-01-26', // Republic Day
  '2026-03-03', // Holi
  '2026-03-31', // Eid-ul-Fitr
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-27', // Eid-ul-Adha
  '2026-08-15', // Independence Day
  '2026-08-25', // Ganesh Chaturthi
  '2026-10-02', // Gandhi Jayanti
  '2026-10-21', // Dussehra
  '2026-11-09', // Diwali Laxmi Pujan (Muhurat trading)
  '2026-11-10', // Balipratipada
  '2026-12-25', // Christmas
]);

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
  return nowISTHHMM() > w.end;
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

let lastTickedAt = 0;

export async function autoSchedulerTick() {
  // Cheap rate-limit: don't run more than once every 30s even if called
  // more often. The simulator's 2s tick loop is far too frequent.
  const now = Date.now();
  if (now - lastTickedAt < 30_000) return;
  lastTickedAt = now;

  if (!isTradingDay()) return;

  const state = getState();
  const launched = [];
  const closed = [];

  for (const s of CATALOG) {
    // Strategies without a window run all day — skip auto-launch (those
    // need explicit user opt-in since they consume capital indefinitely).
    if (!s.window) continue;

    // Window already passed today → don't launch a new one.
    if (windowFinished(s.window)) continue;

    // Already ran (running or stopped) today → don't re-launch.
    if (alreadyRanToday(state, s.code)) continue;

    // Window is upcoming or active. Launch with the catalog's minimum
    // capital. Paper mode means no real money risk; capital is just
    // position-sizing anchor for the strategy.
    const inst = await createInstance({
      strategyCode: s.code,
      strategyName: s.name,
      strategyType: s.category ?? 'tradeauto',
      algoKey: s.algoKey,
      instrument: s.instrument,
      exchange: 'NSE_EQ', // catalog has display strings; backend uses code
      capital: s.minimumCapital,
      mode: 'PT',
      window: s.window,
      scheduleEnabled: true,
    });
    launched.push({ code: s.code, instanceId: inst.id });
  }

  // End-of-day cleanup: after 15:35 IST, any RUNNING instance gets
  // stopped (closes any open position via shared cost-aware helper).
  if (nowISTHHMM() >= '15:35') {
    for (const inst of state.instances) {
      if (inst.status !== 'RUNNING') continue;
      await stopInstance(inst.id);
      closed.push({ code: inst.strategyCode, instanceId: inst.id });
    }
  }

  if (launched.length || closed.length) {
    console.log(`[auto-scheduler] ${nowISTHHMM()} IST: launched=${launched.length} closed=${closed.length}`,
      launched.length ? `→ ${launched.map((l) => `${l.code}#${l.instanceId}`).join(',')}` : '',
      closed.length ? `← ${closed.map((c) => `${c.code}#${c.instanceId}`).join(',')}` : '',
    );
    await save();
  }
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
