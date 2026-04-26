// Technical indicators used by the strategy engine.
// All functions take an array of numbers (close prices) and return the
// indicator value at the LATEST tick. If not enough history, return null.

export function sma(series, period) {
  if (series.length < period) return null;
  let sum = 0;
  for (let i = series.length - period; i < series.length; i++) sum += series[i];
  return sum / period;
}

export function ema(series, period) {
  if (series.length < period) return null;
  const k = 2 / (period + 1);
  // seed with SMA of first `period` points
  let ema = 0;
  for (let i = 0; i < period; i++) ema += series[i];
  ema /= period;
  for (let i = period; i < series.length; i++) ema = series[i] * k + ema * (1 - k);
  return ema;
}

export function rsi(series, period = 14) {
  if (series.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = series.length - period; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function bollingerBands(series, period = 20, stdMult = 2) {
  if (series.length < period) return null;
  const slice = series.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + stdMult * sd, mid: mean, lower: mean - stdMult * sd };
}

// ATR using true range approximation from close-to-close (no OHL here).
export function atr(series, period = 14) {
  if (series.length < period + 1) return null;
  let sum = 0;
  for (let i = series.length - period; i < series.length; i++) {
    sum += Math.abs(series[i] - series[i - 1]);
  }
  return sum / period;
}

// MACD: (12-EMA − 26-EMA), signal is 9-EMA of MACD line. We return the latest.
export function macd(series, fast = 12, slow = 26, signalPeriod = 9) {
  if (series.length < slow + signalPeriod) return null;
  // compute macd value at each bar after slow
  const macdLine = [];
  const kFast = 2 / (fast + 1);
  const kSlow = 2 / (slow + 1);
  let emaFast = 0, emaSlow = 0;
  for (let i = 0; i < fast; i++) emaFast += series[i];
  emaFast /= fast;
  for (let i = 0; i < slow; i++) emaSlow += series[i];
  emaSlow /= slow;
  for (let i = slow; i < series.length; i++) {
    emaFast = series[i] * kFast + emaFast * (1 - kFast);
    emaSlow = series[i] * kSlow + emaSlow * (1 - kSlow);
    macdLine.push(emaFast - emaSlow);
  }
  if (macdLine.length < signalPeriod) return null;
  const kSignal = 2 / (signalPeriod + 1);
  let signal = 0;
  for (let i = 0; i < signalPeriod; i++) signal += macdLine[i];
  signal /= signalPeriod;
  for (let i = signalPeriod; i < macdLine.length; i++) {
    signal = macdLine[i] * kSignal + signal * (1 - kSignal);
  }
  const macdValue = macdLine[macdLine.length - 1];
  return { macd: macdValue, signal, histogram: macdValue - signal };
}
