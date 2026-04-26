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

// Trim trades array to keep _state.json from unbounded growth that would
// slow per-tick saves. 5000 trades ≈ 2MB serialized — comfortably below
// per-tick save latency thresholds, and well past anything one user trades.
const MAX_TRADES = 5000;

// All trades go through this. NewTrade is now a pure recorder — caller
// computes pnl + costs explicitly so semantics differ between entry (no
// realization yet) and exit (round-trip net realized).
//   - BUY trade: caller passes pnl=0; entry-leg costs are still recorded
//     on the trade for transparency, but realizedPnl is unchanged.
//   - SELL trade: caller passes pnl = round-trip NET (gross - both legs'
//     costs). That number flows into realizedPnl.
function newTrade(state, { instanceId, instrument, side, price, quantity, reason, pnl, costs, grossPnl = 0 }) {
  const fillPrice = costs?.fillPrice ?? Number(price.toFixed(2));
  const trade = {
    id: state.nextTradeId++,
    instanceId,
    instrument,
    side,
    price: Number(price.toFixed(2)),
    fillPrice,
    quantity,
    value: Number((fillPrice * quantity).toFixed(2)),
    pnl: Number(pnl.toFixed(2)),                  // net (round-trip) on SELL; 0 on BUY
    grossPnl: Number(grossPnl.toFixed(2)),        // pre-cost gross on SELL; 0 on BUY
    costs: costs ? {
      brokerage: costs.brokerage,
      stt: costs.stt,
      exchangeTxn: costs.exchangeTxn,
      sebi: costs.sebi,
      stampDuty: costs.stampDuty,
      gst: costs.gst,
      slippage: costs.slippage,
      total: costs.total,
    } : null,
    reason,
    timestamp: new Date().toISOString(),
  };
  state.trades.push(trade);
  if (state.trades.length > MAX_TRADES) {
    state.trades.splice(0, state.trades.length - MAX_TRADES);
  }
  return trade;
}

// Shared close-position logic. Both the in-tick exit (window close, SELL
// signal) and stopInstance() route through here so cost accounting is
// consistent. Mutates inst (clears position, updates pnl), pushes a trade
// to state.trades, returns the trade for caller to track tradeIds.
export function closePositionWithCosts(state, inst, price, reason) {
  const grossPnl = (price - inst.position.entryPrice) * inst.position.quantity;
  const sellCosts = legCosts('SELL', price, inst.position.quantity);
  const entryCost = inst.position.entryCost ?? 0;
  const netRoundTrip = Number((grossPnl - sellCosts.total - entryCost).toFixed(2));

  const trade = newTrade(state, {
    instanceId: inst.id,
    instrument: inst.instrument,
    side: 'SELL',
    price,
    quantity: inst.position.quantity,
    reason,
    pnl: netRoundTrip,
    grossPnl,
    costs: sellCosts,
  });

  inst.tradeIds.push(trade.id);
  inst.realizedPnl = Number((inst.realizedPnl + netRoundTrip).toFixed(2));
  inst.position = null;
  inst.unrealizedPnl = 0;
  return trade;
}

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
    const trade = newTrade(state, {
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
}

export function start() {
  if (timer) return;
  console.log(`[sim] live-feed + GBM jitter, ${Object.keys(STRATEGIES).length} strategies, tick ${TICK_MS}ms, live refresh ${LIVE_REFRESH_MS}ms`);
  lastLiveFetch = Date.now(); // seed was just fetched at boot — don't refetch immediately
  timer = setInterval(() => { tick().catch((e) => console.error('[sim] tick err:', e)); }, TICK_MS);
}

export function stop() { if (timer) { clearInterval(timer); timer = null; } }
