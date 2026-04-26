// Market regime analysis.
// Classifies each instrument's recent price action into:
//   - volatility band: 'calm' | 'normal' | 'elevated' | 'high'
//   - trend direction: 'up' | 'down' | 'sideways'
// Used by the UI so users know which kind of strategy suits the current market.
//
// Methodology (intentionally simple, so a demo user can understand it):
//   - Take the most recent N closes from priceHistory.
//   - Compute tick-to-tick log returns; take their stddev as realizedVol.
//   - Compare realizedVol to the instrument's baseline annualVol scaled to
//     per-tick terms. Simulator ticks every 2s, so ticksPerYear ≈ 1.58e7,
//     but since live Yahoo refresh also feeds prices, this is approximate.
//     We calibrate the threshold ratios empirically.
//   - Trend: compare mean of first third vs last third of the window.
//     Relative delta > 0.25% -> up, < -0.25% -> down, else sideways.

import { INSTRUMENTS } from './state.mjs';

const WINDOW = 30; // most recent ticks used for analysis

// Empirically calibrated — the simulator's GBM jitter on a 2s tick produces
// stddev-of-log-returns around 0.001 for a 15% annualVol symbol in "calm"
// conditions. These thresholds are ratios against the instrument's baseline.
const VOL_BANDS = [
  { upto: 0.70, regime: 'calm' },
  { upto: 1.30, regime: 'normal' },
  { upto: 2.20, regime: 'elevated' },
  { upto: Infinity, regime: 'high' },
];

// IntendedLabel -> what the UI shows. Kept in one place so we can tune copy.
export const REGIME_LABEL = {
  calm:     'Low Volatility',
  normal:   'Normal',
  elevated: 'Elevated Volatility',
  high:     'High Volatility',
};

export const TREND_LABEL = {
  up:       'Trending Up',
  down:     'Trending Down',
  sideways: 'Sideways',
};

// Map categories (from catalog) -> which market conditions they thrive in.
// Used to compute a "Good fit for now" hint per strategy.
export const CATEGORY_FIT = {
  trend:     { regimes: ['normal', 'elevated', 'high'], trends: ['up', 'down'] },
  momentum:  { regimes: ['normal', 'elevated', 'high'], trends: ['up', 'down'] },
  breakout:  { regimes: ['elevated', 'high'],           trends: ['up', 'down', 'sideways'] },
  reversion: { regimes: ['calm', 'normal'],             trends: ['sideways'] },
};

function stddev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length;
  return Math.sqrt(v);
}

function classifyVol(realizedStdev, baselineStdev) {
  if (baselineStdev === 0) return 'normal';
  const ratio = realizedStdev / baselineStdev;
  for (const b of VOL_BANDS) if (ratio <= b.upto) return b.regime;
  return 'high';
}

function classifyTrend(prices) {
  if (prices.length < 6) return 'sideways';
  const third = Math.floor(prices.length / 3);
  const first = prices.slice(0, third);
  const last  = prices.slice(-third);
  const mFirst = first.reduce((a, b) => a + b, 0) / first.length;
  const mLast  = last.reduce((a, b) => a + b, 0) / last.length;
  if (mFirst === 0) return 'sideways';
  const pct = (mLast - mFirst) / mFirst;
  if (pct >  0.0025) return 'up';
  if (pct < -0.0025) return 'down';
  return 'sideways';
}

export function computeInstrumentRegime(code, history, meta) {
  const recent = history.slice(-WINDOW);
  if (recent.length < 3) {
    return {
      code,
      regime: 'normal',
      trend: 'sideways',
      realizedVolPct: 0,
      sampleSize: recent.length,
    };
  }
  const returns = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    if (prev > 0) returns.push(Math.log(recent[i] / prev));
  }
  const realized = stddev(returns);

  // Baseline per-tick stddev implied by annualVol. Our tick is 2s; trading
  // year ≈ 252 * 6.25h * 3600s / 2s = 1.134e7 ticks. sqrt() that for scaling.
  const ticksPerYear = 252 * 6.25 * 3600 / 2;
  const baseline = (meta?.annualVol ?? 0.2) / Math.sqrt(ticksPerYear);

  const regime = classifyVol(realized, baseline);
  const trend = classifyTrend(recent);

  return {
    code,
    regime,
    trend,
    regimeLabel: REGIME_LABEL[regime],
    trendLabel:  TREND_LABEL[trend],
    realizedVolPct: Number((realized * 100).toFixed(3)),
    baselineVolPct: Number((baseline * 100).toFixed(3)),
    volRatio: baseline > 0 ? Number((realized / baseline).toFixed(2)) : 0,
    sampleSize: recent.length,
    lastPrice: recent[recent.length - 1],
    firstPrice: recent[0],
  };
}

export function computeMarketStatus(state) {
  const instruments = INSTRUMENTS.map((i) => {
    const hist = state.priceHistory[i.code] ?? [];
    return computeInstrumentRegime(i.code, hist, i);
  });

  // Overall regime = the worst (highest) individual regime among index
  // instruments (NIFTY, BANKNIFTY) — those drive the broader market feel.
  const indexCodes = new Set(['NIFTY', 'BANKNIFTY']);
  const indexItems = instruments.filter((i) => indexCodes.has(i.code));
  const order = ['calm', 'normal', 'elevated', 'high'];
  const peakRegime = indexItems.reduce(
    (peak, i) => (order.indexOf(i.regime) > order.indexOf(peak) ? i.regime : peak),
    'calm',
  );

  return {
    instruments,
    overall: {
      regime: peakRegime,
      regimeLabel: REGIME_LABEL[peakRegime],
      summary: summarize(indexItems),
    },
    updatedAt: new Date().toISOString(),
  };
}

function summarize(indexItems) {
  if (!indexItems.length) return 'Market data loading…';
  return indexItems
    .map((i) => `${i.code} ${REGIME_LABEL[i.regime].toLowerCase()} · ${TREND_LABEL[i.trend].toLowerCase()}`)
    .join(' · ');
}

// Given a strategy category + current regime/trend, is it a good fit?
export function categoryFitsNow(category, currentRegime, currentTrend) {
  const fit = CATEGORY_FIT[category];
  if (!fit) return false;
  return fit.regimes.includes(currentRegime) && fit.trends.includes(currentTrend);
}
