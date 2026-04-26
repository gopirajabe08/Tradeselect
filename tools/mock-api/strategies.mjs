// Real indicator-based strategies. Each returns a signal for the latest tick:
//   { action: 'BUY' | 'SELL' | 'HOLD', reason: string }
//
// Strategy receives:
//   prices:   array of close prices (oldest -> newest), >= 50 ticks typical
//   position: current position {entryPrice, quantity} or null
//   params:   optional tuning (per-instance overrides)

import { sma, ema, rsi, bollingerBands, atr, macd } from './indicators.mjs';

const MIN_HISTORY = 30;

function hold(reason = 'warming up') {
  return { action: 'HOLD', reason };
}

export const STRATEGIES = {
  // --- Moving Average Crossover ---
  ma_crossover: {
    name: 'MA Crossover',
    description: 'Buy when fast SMA crosses above slow SMA; sell on opposite cross.',
    defaultParams: { fast: 5, slow: 20 },
    tick(prices, position, params = {}) {
      const { fast = 5, slow = 20 } = params;
      if (prices.length < slow + 1) return hold();
      const fastNow = sma(prices, fast);
      const slowNow = sma(prices, slow);
      const fastPrev = sma(prices.slice(0, -1), fast);
      const slowPrev = sma(prices.slice(0, -1), slow);
      if (fastNow == null || slowNow == null || fastPrev == null || slowPrev == null) return hold();
      const crossedUp = fastPrev <= slowPrev && fastNow > slowNow;
      const crossedDown = fastPrev >= slowPrev && fastNow < slowNow;
      if (!position && crossedUp) return { action: 'BUY', reason: 'MA crossover up' };
      if (position && crossedDown) return { action: 'SELL', reason: 'MA crossover down' };
      return hold(position ? 'holding (trend up)' : 'waiting for crossover');
    },
  },

  // --- RSI Mean-Reversion ---
  rsi_reversion: {
    name: 'RSI Mean-Reversion',
    description: 'Buy when RSI < 30 (oversold); sell when RSI > 70 (overbought).',
    defaultParams: { period: 14, lower: 30, upper: 70 },
    tick(prices, position, params = {}) {
      const { period = 14, lower = 30, upper = 70 } = params;
      if (prices.length < period + 1) return hold();
      const r = rsi(prices, period);
      if (r == null) return hold();
      if (!position && r < lower) return { action: 'BUY', reason: `RSI ${r.toFixed(1)} < ${lower} (oversold)` };
      if (position && r > upper) return { action: 'SELL', reason: `RSI ${r.toFixed(1)} > ${upper} (overbought)` };
      return hold(`RSI ${r.toFixed(1)}`);
    },
  },

  // --- Bollinger Band Breakout ---
  bollinger_breakout: {
    name: 'Bollinger Breakout',
    description: 'Buy on close above upper band; sell on close below mid band.',
    defaultParams: { period: 20, stdMult: 2 },
    tick(prices, position, params = {}) {
      const { period = 20, stdMult = 2 } = params;
      if (prices.length < period) return hold();
      const bb = bollingerBands(prices, period, stdMult);
      if (!bb) return hold();
      const last = prices[prices.length - 1];
      if (!position && last > bb.upper) return { action: 'BUY', reason: `price ${last.toFixed(2)} > upper ${bb.upper.toFixed(2)}` };
      if (position && last < bb.mid) return { action: 'SELL', reason: `price ${last.toFixed(2)} < mid ${bb.mid.toFixed(2)}` };
      return hold(`price ${last.toFixed(2)}, band [${bb.lower.toFixed(2)}, ${bb.upper.toFixed(2)}]`);
    },
  },

  // --- ATR Volatility Trend ---
  atr_trend: {
    name: 'ATR Volatility Trend',
    description: 'Follow trend when price moves > 1.5 ATR from entry baseline.',
    defaultParams: { period: 14, multiplier: 1.5 },
    tick(prices, position, params = {}) {
      const { period = 14, multiplier = 1.5 } = params;
      if (prices.length < period + 5) return hold();
      const a = atr(prices, period);
      if (a == null) return hold();
      const last = prices[prices.length - 1];
      const baseline = prices[prices.length - 5]; // recent reference
      const delta = last - baseline;
      const threshold = a * multiplier;
      if (!position && delta > threshold) return { action: 'BUY', reason: `+${delta.toFixed(2)} > ATR*${multiplier}` };
      if (position) {
        const entry = position.entryPrice;
        const move = last - entry;
        if (move < -threshold) return { action: 'SELL', reason: `stop (ATR*${multiplier} against)` };
        if (move > threshold * 2) return { action: 'SELL', reason: `take profit (2x ATR)` };
      }
      return hold(`ATR ${a.toFixed(2)}, delta ${delta.toFixed(2)}`);
    },
  },

  // --- MACD ---
  macd_momentum: {
    name: 'MACD Momentum',
    description: 'Buy on bullish MACD cross (MACD > signal); sell on bearish cross.',
    defaultParams: {},
    tick(prices, position) {
      if (prices.length < 40) return hold();
      const m = macd(prices);
      const mPrev = macd(prices.slice(0, -1));
      if (!m || !mPrev) return hold();
      const crossedUp = mPrev.histogram < 0 && m.histogram > 0;
      const crossedDown = mPrev.histogram > 0 && m.histogram < 0;
      if (!position && crossedUp) return { action: 'BUY', reason: 'MACD crossed above signal' };
      if (position && crossedDown) return { action: 'SELL', reason: 'MACD crossed below signal' };
      return hold(`hist ${m.histogram.toFixed(3)}`);
    },
  },
};

// NOTE: bullsai's strategy codes (BAODSYR001, BAODSYR002, ...) are names
// in a catalog — their actual entry/exit LOGIC is server-side code we
// cannot read. There is no honest mapping from a bullsai code to an
// algorithm; attempting one is guessing, not replication.
//
// Instead: the mock runs a SINGLE generic paper-trading engine for every
// started strategy, chosen by the user from the StartStrategyModal. The
// UI makes this clear.
export const CODE_TO_ALGO = {}; // intentionally empty — no guessing

export const DEFAULT_ALGO_KEY = 'ma_crossover';

export function resolveAlgo(_strategyCode, overrideKey) {
  if (overrideKey && STRATEGIES[overrideKey]) return STRATEGIES[overrideKey];
  return STRATEGIES[DEFAULT_ALGO_KEY];
}
