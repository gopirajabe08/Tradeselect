// Tick simulator. Uses REAL prices from Yahoo Finance when available, with
// small GBM-style jitter between fetches so the price feels continuous at
// 2-second ticks. Falls back to pure GBM for any instrument where Yahoo
// failed (network down, market closed with stale data, rate-limited, etc.).
//
// Jitter model: geometric Brownian motion
//   ΔS/S = μ·Δt + σ·√Δt · N(0,1)
// with μ = 0 and σ from INSTRUMENTS[].annualVol, scaled to tick interval.

import { getState, save, INSTRUMENTS, MAX_HISTORY, MAX_PNL_POINTS } from './state.mjs';
import { STRATEGIES, resolveAlgo } from './strategies.mjs';
import { refreshLivePrices, getDataSource } from './marketdata.mjs';
import { isInWindow } from './catalog.mjs';
import { legCosts } from './costs.mjs';
import { pushTrade, closePositionWithCosts } from './positions.mjs';
import { autoSchedulerTick } from './auto-scheduler.mjs';

const TICK_MS = 2000;
const DT_PER_TICK = 1 / (252 * 6.5 * 60 * 30);
const LIVE_REFRESH_MS = 60_000; // pull fresh Yahoo quote every 60s

let timer = null;
let lastLiveFetch = 0;

// Box-Muller transform for standard normal.
function randn() {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function advancePrices(state) {
  for (const inst of INSTRUMENTS) {
    const curr = state.prices[inst.code];
    const sigma = inst.annualVol;
    const source = getDataSource(inst.code);
    // When live/delayed: 60s-cadence Yahoo fetch overrides the price
    // separately (in tick() below). Between those fetches we apply small
    // GBM jitter so the chart has motion.
    // When gbm-fallback: jitter IS the price model.
    const diffusion = sigma * Math.sqrt(DT_PER_TICK) * randn();
    const logReturn = (0 - 0.5 * sigma * sigma) * DT_PER_TICK + diffusion;
    const next = curr * Math.exp(logReturn);
    // Soft bound based on source: tighter for live (don't drift away from
    // the real quote between refreshes), looser for GBM fallback.
    const bound = source === 'gbm-fallback' ? 0.25 : 0.02;
    const min = curr * (1 - bound);
    const max = curr * (1 + bound);
    state.prices[inst.code] = Math.max(min, Math.min(max, next));

    const hist = state.priceHistory[inst.code];
    hist.push(state.prices[inst.code]);
    if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
  }
}

// Trade recording / position-close lifecycle now lives in positions.mjs
// (extracted to break the simulator ↔ state circular import).

function recordPnl(state, inst, price) {
  const arr = state.pnlHistory[inst.id] ?? (state.pnlHistory[inst.id] = []);
  arr.push({
    t: new Date().toISOString(),
    price: Number(price.toFixed(2)),
    realized: Number(inst.realizedPnl.toFixed(2)),
    unrealized: Number(inst.unrealizedPnl.toFixed(2)),
    total: Number((inst.realizedPnl + inst.unrealizedPnl).toFixed(2)),
  });
  if (arr.length > MAX_PNL_POINTS) arr.splice(0, arr.length - MAX_PNL_POINTS);
}

function tickInstance(state, inst) {
  if (inst.status !== 'RUNNING') return;
  const price = state.prices[inst.instrument];
  if (!price) return;

  // mark-to-market unrealized P&L
  inst.unrealizedPnl = inst.position
    ? Number(((price - inst.position.entryPrice) * inst.position.quantity).toFixed(2))
    : 0;

  // Auto-scheduler: when instance has a window AND scheduleEnabled, we gate
  // entries/exits by whether current IST time is inside the window.
  //   - Out of window + holding position: force-exit (auto-close), mark P&L.
  //   - Out of window + flat: skip algo entirely (no new entries).
  //   - In window: run the algo normally.
  const windowActive = inst.scheduleEnabled && inst.window ? isInWindow(inst.window) : true;
  inst.inWindow = windowActive;

  if (!windowActive) {
    if (inst.position) {
      closePositionWithCosts(state, inst, price, 'Window closed — auto-exit');
    }
    recordPnl(state, inst, price);
    return;
  }

  const algo = resolveAlgo(inst.strategyCode, inst.algoKey);
  const effectiveParams = { ...(algo.defaultParams ?? {}), ...(inst.params ?? {}) };
  const history = state.priceHistory[inst.instrument] ?? [];
  const signal = algo.tick(history, inst.position, effectiveParams);

  if (signal.action === 'BUY' && !inst.position) {
    const positionValue = inst.capital * 0.1;
    const quantity = Math.max(1, Math.floor(positionValue / price));
    const buyCosts = legCosts('BUY', price, quantity);
    const trade = pushTrade(state, {
      instanceId: inst.id, instrument: inst.instrument,
      side: 'BUY', price, quantity, reason: signal.reason,
      pnl: 0,           // no realization on entry; costs carry on position
      grossPnl: 0,
      costs: buyCosts,
    });
    inst.tradeIds.push(trade.id);
    inst.position = {
      entryPrice: Number(price.toFixed(2)),
      quantity,
      entryAt: new Date().toISOString(),
      entryCost: buyCosts.total, // realized at SELL via closePositionWithCosts
    };
  } else if (signal.action === 'SELL' && inst.position) {
    closePositionWithCosts(state, inst, price, signal.reason);
  }

  recordPnl(state, inst, price);
}

async function tick() {
  const state = getState();

  // Periodic live-price refresh. Fire-and-forget so we don't block a tick on
  // network latency — if it's slow, the next tick just uses jitter.
  const now = Date.now();
  if (now - lastLiveFetch > LIVE_REFRESH_MS) {
    lastLiveFetch = now;
    refreshLivePrices().catch((e) => console.error('[md] refresh err:', e.message));
  }

  advancePrices(state);
  for (const inst of state.instances) tickInstance(state, inst);
  state.lastTickAt = new Date().toISOString();
  try { await save(); } catch (e) { console.error('[sim] save failed:', e.message); }

  // Auto-scheduler is rate-limited internally to ~30s.
  // Gated by env so we can deploy the code path without it firing.
  if (process.env.AUTO_SCHEDULER_ENABLED === 'true') {
    try { await autoSchedulerTick(); }
    catch (e) { console.error('[auto-scheduler] err:', e.message); }
  }
}

export function start() {
  if (timer) return;
  console.log(`[sim] live-feed + GBM jitter, ${Object.keys(STRATEGIES).length} strategies, tick ${TICK_MS}ms, live refresh ${LIVE_REFRESH_MS}ms`);
  lastLiveFetch = Date.now(); // seed was just fetched at boot — don't refetch immediately
  timer = setInterval(() => { tick().catch((e) => console.error('[sim] tick err:', e)); }, TICK_MS);
}

export function stop() { if (timer) { clearInterval(timer); timer = null; } }
