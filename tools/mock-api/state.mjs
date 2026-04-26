// Persistent state store for the trading simulator.
// Single JSON file at _state.json — simple, transparent, no DB.
// Read on boot, rewritten after each mutation.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
export const STATE_PATH = path.join(__dirname, '_state.json');

// Seed list — paired with base prices + annualized volatility used by
// the GBM price model. Volatilities here are rough realistic values
// for Indian blue-chip equities / indices.
export const INSTRUMENTS = [
  { code: 'TCS',       exchange: 'NSE_EQ',  basePrice: 4100,  annualVol: 0.25 },
  { code: 'RELIANCE',  exchange: 'NSE_EQ',  basePrice: 2900,  annualVol: 0.28 },
  { code: 'INFY',      exchange: 'NSE_EQ',  basePrice: 1850,  annualVol: 0.27 },
  { code: 'HDFCBANK',  exchange: 'NSE_EQ',  basePrice: 1700,  annualVol: 0.22 },
  { code: 'NIFTY',     exchange: 'NSE_IDX', basePrice: 24500, annualVol: 0.15 },
  { code: 'BANKNIFTY', exchange: 'NSE_IDX', basePrice: 51500, annualVol: 0.18 },
];

export const MAX_HISTORY = 500; // ticks kept per instrument for indicators + chart
export const MAX_PNL_POINTS = 500; // per-instance PnL samples kept

function freshState() {
  const prices = {};
  const priceHistory = {};
  for (const i of INSTRUMENTS) {
    prices[i.code] = i.basePrice;
    priceHistory[i.code] = [i.basePrice];
  }
  return {
    instances: [],
    trades: [],
    prices,
    priceHistory,   // { code: number[] } — last MAX_HISTORY closes
    pnlHistory: {}, // { instanceId: [{ t, pnl, price, unrealized }] }
    lastTickAt: null,
    nextInstanceId: 1,
    nextTradeId: 1,
    userProfile: {
      name: 'Demo Trader',
      email: 'demo.in@tradeauto.local',
      phone: '+91 99999 99999',
      country: 'India',
      riskProfile: 'Moderate',
      maxCapitalPerStrategy: 100000,
      notificationsEmail: true,
      notificationsSMS: false,
      theme: 'light',
    },
  };
}

let cached = null;

export async function load() {
  if (cached) return cached;
  let raw = null;
  try {
    raw = await fs.readFile(STATE_PATH, 'utf8');
  } catch {
    cached = freshState();
    await save();
    return cached;
  }
  try {
    cached = JSON.parse(raw);
    const def = freshState();
    for (const k of Object.keys(def)) if (cached[k] === undefined) cached[k] = def[k];
    for (const inst of INSTRUMENTS) {
      if (!cached.priceHistory[inst.code]) cached.priceHistory[inst.code] = [cached.prices[inst.code] ?? inst.basePrice];
    }
  } catch (e) {
    // The file exists but isn't valid JSON — likely interrupted save().
    // Preserve it for postmortem; do NOT silently clobber.
    const corruptPath = `${STATE_PATH}.corrupt-${Date.now()}`;
    try { await fs.rename(STATE_PATH, corruptPath); } catch {}
    console.error(`[state] _state.json was corrupt — preserved at ${corruptPath}. Starting fresh.`);
    cached = freshState();
    await save();
  }
  return cached;
}

export function loadSync() {
  if (cached) return cached;
  try {
    const raw = fsSync.readFileSync(STATE_PATH, 'utf8');
    cached = JSON.parse(raw);
    const def = freshState();
    for (const k of Object.keys(def)) if (cached[k] === undefined) cached[k] = def[k];
  } catch {
    cached = freshState();
  }
  return cached;
}

// Atomic write: temp file + rename. Also serialized via a single-chain
// promise so concurrent save() callers don't interleave writes on POSIX.
// If corruption IS encountered on load (interrupted rename, etc.), load()
// preserves the corrupt file for postmortem instead of silently wiping.
let writeChain = Promise.resolve();
export function save() {
  if (!cached) return Promise.resolve();
  writeChain = writeChain.then(async () => {
    const tmp = STATE_PATH + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(cached, null, 2), 'utf8');
    await fs.rename(tmp, STATE_PATH);
  });
  return writeChain;
}

export function getState() { return cached ?? loadSync(); }

export async function createInstance(partial) {
  const s = getState();
  const now = new Date().toISOString();
  const id = s.nextInstanceId++;
  const inst = {
    id,
    strategyCode: partial.strategyCode,
    strategyName: partial.strategyName ?? partial.strategyCode,
    strategyType: partial.strategyType ?? 'odyssey',
    algoKey: partial.algoKey, // optional override of CODE_TO_ALGO mapping
    params: partial.params ?? {},
    // Window is optional. When present, auto-scheduler gates entries/exits
    // to run only within the window; outside, existing positions are
    // auto-closed and new entries are skipped.
    window: partial.window ?? null,
    scheduleEnabled: partial.scheduleEnabled !== false, // default on
    inWindow: true, // updated each tick by simulator
    instrument: partial.instrument,
    exchange: partial.exchange ?? 'NSE_EQ',
    capital: partial.capital ?? 100000,
    mode: partial.mode ?? 'PT',
    status: 'RUNNING',
    startedAt: now,
    stoppedAt: null,
    position: null,
    realizedPnl: 0,
    unrealizedPnl: 0,
    tradeIds: [],
  };
  s.instances.push(inst);
  s.pnlHistory[id] = [];
  await save();
  return inst;
}

export async function stopInstance(id) {
  const s = getState();
  const inst = s.instances.find((i) => i.id === id);
  if (!inst) return null;
  // If the instance is holding a position, close it at current price and
  // realize the P&L. Leaving position open after stop would freeze
  // unrealizedPnl forever since the tick loop skips non-RUNNING instances.
  if (inst.position) {
    const price = s.prices[inst.instrument];
    if (typeof price === 'number') {
      const pnl = (price - inst.position.entryPrice) * inst.position.quantity;
      const trade = {
        id: s.nextTradeId++,
        instanceId: inst.id,
        instrument: inst.instrument,
        side: 'SELL',
        price: Number(price.toFixed(2)),
        quantity: inst.position.quantity,
        value: Number((price * inst.position.quantity).toFixed(2)),
        pnl: Number(pnl.toFixed(2)),
        reason: 'User stopped — auto-exit',
        timestamp: new Date().toISOString(),
      };
      s.trades.push(trade);
      inst.tradeIds.push(trade.id);
      inst.realizedPnl = Number((inst.realizedPnl + pnl).toFixed(2));
      inst.position = null;
      inst.unrealizedPnl = 0;
    }
  }
  inst.status = 'STOPPED';
  inst.stoppedAt = new Date().toISOString();
  await save();
  return inst;
}

export async function deleteInstance(id) {
  const s = getState();
  const idx = s.instances.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  s.instances.splice(idx, 1);
  delete s.pnlHistory[id];
  await save();
  return true;
}

export function listInstances() { return getState().instances; }

export function listTrades({ instanceId, limit = 200 } = {}) {
  const all = getState().trades;
  const filtered = instanceId != null ? all.filter((t) => t.instanceId === instanceId) : all;
  return filtered.slice(-limit).reverse();
}

export function currentPrice(code) { return getState().prices[code]; }

export function priceHistory(code) { return getState().priceHistory[code] ?? []; }

export function pnlHistory(instanceId) { return getState().pnlHistory[instanceId] ?? []; }

export async function saveUserProfile(patch) {
  const s = getState();
  s.userProfile = { ...s.userProfile, ...patch };
  await save();
  return s.userProfile;
}

export function userProfile() { return getState().userProfile; }
