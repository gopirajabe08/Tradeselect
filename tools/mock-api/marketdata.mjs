// Yahoo Finance market-data feed with persistent cache.
// Strategy:
//   1. On boot: if priceHistory is already populated (from a prior successful
//      seed cached in _state.json), skip the re-fetch. That's the normal case
//      for every restart after the first.
//   2. If priceHistory is empty (fresh state), attempt one slow sequential
//      seed from Yahoo. Any instrument that fails falls back to GBM with
//      known real baseline prices.
//   3. Background refresh runs every 60s from the simulator. Failures are
//      silently tolerated.
//
// Public Yahoo endpoint is rate-limited per IP; we stagger requests heavily.

import { getState, INSTRUMENTS, MAX_HISTORY, save } from './state.mjs';

const YAHOO_SYMBOL = {
  TCS:       'TCS.NS',
  RELIANCE:  'RELIANCE.NS',
  INFY:      'INFY.NS',
  HDFCBANK:  'HDFCBANK.NS',
  NIFTY:     '%5ENSEI',
  BANKNIFTY: '%5ENSEBANK',
};

// Real NSE closing prices observed on 2026-04-24. Used as initial baseline
// when Yahoo is unreachable/rate-limited at first boot. Overridden by any
// successful Yahoo fetch.
const OBSERVED_PRICES = {
  TCS:       2412.40,
  RELIANCE:  1230.00,   // rough recent close; refined by Yahoo when available
  INFY:      1169.00,
  HDFCBANK:  1770.00,   // rough recent close
  NIFTY:     23905.15,
  BANKNIFTY: 53000.00,  // rough recent close
};

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const INTER_REQUEST_MS = 3500;
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 2000;
const CACHE_HORIZON_MS = 6 * 60 * 60 * 1000; // re-seed only if older than 6 hours

const sources = Object.create(null);
for (const i of INSTRUMENTS) sources[i.code] = 'gbm-fallback';

export function getDataSource(code) { return sources[code] ?? 'gbm-fallback'; }
export function allDataSources() { return { ...sources }; }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function yahooFetch(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json,text/plain,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://finance.yahoo.com/',
        },
      });
      if (res.status === 429) {
        if (attempt === MAX_ATTEMPTS) throw new Error(`HTTP 429 after ${attempt} attempts`);
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) throw e;
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
    }
  }
  throw new Error('unreachable');
}

function extractBars(data) {
  const result = data?.chart?.result?.[0];
  if (!result) return { closes: [], lastClose: null, isMarketOpen: false };
  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter((v) => v != null);
  const meta = result.meta ?? {};
  return {
    closes,
    lastClose: meta.regularMarketPrice ?? closes[closes.length - 1] ?? null,
    isMarketOpen: (meta.marketState ?? '').toUpperCase() === 'REGULAR',
  };
}

async function seedOne(code) {
  const symbol = YAHOO_SYMBOL[code];
  if (!symbol) return false;
  const state = getState();
  try {
    const json = await yahooFetch(symbol, '1d', '1m');
    const { closes, lastClose, isMarketOpen } = extractBars(json);
    if (closes.length && lastClose != null) {
      const trimmed = closes.slice(-MAX_HISTORY).map((v) => Number(v));
      state.priceHistory[code] = trimmed;
      state.prices[code] = Number(lastClose);
      sources[code] = isMarketOpen ? 'live' : 'delayed';
      console.log(`[md] seeded ${code}: ${trimmed.length} bars, last=₹${lastClose.toFixed(2)} (${sources[code]})`);
      return true;
    }
  } catch (e) {
    console.log(`[md] ${code} fetch failed: ${e.message}`);
  }
  return false;
}

function applyObservedBaseline(code) {
  const baseline = OBSERVED_PRICES[code];
  const state = getState();
  if (baseline != null) {
    state.prices[code] = baseline;
    if (!state.priceHistory[code] || state.priceHistory[code].length <= 1) {
      // synthesize ~60 bars of small jitter around the baseline so indicators
      // have enough history to fire
      const hist = [];
      let p = baseline;
      for (let i = 0; i < 60; i++) {
        p = p * (1 + (Math.random() - 0.5) * 0.004);
        hist.push(p);
      }
      hist[hist.length - 1] = baseline;
      state.priceHistory[code] = hist;
    }
    sources[code] = 'cached-baseline';
  }
}

// Boot-time seed. Only hits Yahoo if priceHistory is empty (fresh state) or
// the cache is stale beyond CACHE_HORIZON_MS. Otherwise uses persisted data.
export async function seedHistory() {
  const state = getState();
  const lastSeed = state.mdLastSeedAt ?? 0;
  const ageMs = Date.now() - lastSeed;
  const cached = state.mdSeededCodes ?? [];
  const allCached = INSTRUMENTS.every((i) => cached.includes(i.code) && (state.priceHistory[i.code] ?? []).length > 10);

  if (allCached && ageMs < CACHE_HORIZON_MS) {
    console.log(`[md] using persisted cache from ${new Date(lastSeed).toISOString()} (${Math.round(ageMs / 60000)}min old)`);
    for (const code of cached) {
      if (state.mdSources?.[code]) sources[code] = state.mdSources[code];
    }
    return;
  }

  console.log(`[md] cache stale/empty — fetching from Yahoo…`);
  const seededCodes = [];
  for (const inst of INSTRUMENTS) {
    const ok = await seedOne(inst.code);
    if (ok) seededCodes.push(inst.code);
    else applyObservedBaseline(inst.code);
    await sleep(INTER_REQUEST_MS);
  }

  state.mdLastSeedAt = Date.now();
  state.mdSeededCodes = seededCodes;
  state.mdSources = { ...sources };
  await save();
}

// Background refresh. Tolerates failures; only updates state when successful.
// Used to bring cached-baseline instruments up to delayed/live as Yahoo
// responds, and to keep live/delayed instruments fresh.
export async function refreshLivePrices() {
  const state = getState();
  for (const inst of INSTRUMENTS) {
    const symbol = YAHOO_SYMBOL[inst.code];
    if (!symbol) continue;
    try {
      const json = await yahooFetch(symbol, '1d', '1m');
      const { lastClose, isMarketOpen } = extractBars(json);
      if (lastClose != null) {
        state.prices[inst.code] = Number(lastClose);
        sources[inst.code] = isMarketOpen ? 'live' : 'delayed';
        // opportunistic cache refresh when we succeed after prior failure
        state.mdSources = { ...sources };
      }
    } catch {
      // tolerated
    }
    await sleep(INTER_REQUEST_MS);
  }
}
