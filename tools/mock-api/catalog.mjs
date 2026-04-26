// TradeAuto's own strategy catalog. Every entry:
//   - maps to a REAL indicator algorithm in ./strategies.mjs
//   - specifies the TIME WINDOW during which it should run (IST)
//   - names the strategy after what it DOES in the market, not the algorithm
//
// The simulator's auto-scheduler uses the window to gate entries/exits so
// users don't have to manually watch the market.

export const STRATEGIST = {
  key: 1,
  name: 'TradeAuto Research',
  icon: null,
  userCount: '—',
};

// Window format: { start: 'HH:MM', end: 'HH:MM', tz: 'IST', days: 'Mon-Fri' }
// All times in IST (Asia/Kolkata, UTC+5:30). Market is 09:15-15:30 IST Mon-Fri.
export const CATALOG = [
  {
    code: 'TA001',
    name: 'NIFTY Morning Trend',
    algoKey: 'ma_crossover',
    description: 'Catches the first hour trend on NIFTY using a 5/20 moving-average crossover. Best for days with clear directional bias after the opening auction.',
    instrument: 'NIFTY',
    exchange: 'NSE | IDX | INTRADAY',
    minimumCapital: 50000,
    window: { start: '09:30', end: '11:00', tz: 'IST', days: 'Mon-Fri' },
    tags: ['Intraday', 'Morning', 'Trend Following'],
    marketConditions: ['Trending', 'Normal Volatility'],
    category: 'trend',
    tier: 'retail',
  },
  {
    code: 'TA002',
    name: 'RELIANCE Midday Reversion',
    algoKey: 'rsi_reversion',
    description: 'Fades overbought/oversold RSI moves on RELIANCE during the low-volatility midday window. Enters long on RSI < 30, exits on RSI > 70.',
    instrument: 'RELIANCE',
    exchange: 'NSE | EQ | INTRADAY',
    minimumCapital: 25000,
    window: { start: '10:30', end: '14:00', tz: 'IST', days: 'Mon-Fri' },
    tags: ['Intraday', 'Midday', 'Mean Reversion'],
    marketConditions: ['Sideways', 'Low Volatility'],
    category: 'reversion',
    tier: 'retail',
  },
  {
    code: 'TA003',
    name: 'TCS Opening Range Breakout',
    algoKey: 'bollinger_breakout',
    description: 'Watches TCS for a breakout above the first 15-min range after open. Enters on close above upper Bollinger band, exits at midline.',
    instrument: 'TCS',
    exchange: 'NSE | EQ | INTRADAY',
    minimumCapital: 50000,
    window: { start: '09:15', end: '10:30', tz: 'IST', days: 'Mon-Fri' },
    tags: ['Intraday', 'Opening', 'Breakout'],
    marketConditions: ['Volatile Markets', 'Breakout'],
    category: 'breakout',
    tier: 'premium',
  },
  {
    code: 'TA004',
    name: 'BANKNIFTY Whole-Day Volatility',
    algoKey: 'atr_trend',
    description: 'Captures directional moves on BANKNIFTY whenever price extends > 1.5× ATR from baseline. ATR-adaptive stops and take-profits. Runs the full session.',
    instrument: 'BANKNIFTY',
    exchange: 'NSE | IDX | INTRADAY',
    minimumCapital: 100000,
    window: { start: '09:15', end: '15:15', tz: 'IST', days: 'Mon-Fri' },
    tags: ['Full-Day', 'Volatility', 'Index'],
    marketConditions: ['Volatile Markets', 'Trending', 'Bi-Directional'],
    category: 'trend',
    tier: 'premium',
  },
  {
    code: 'TA005',
    name: 'INFY Closing Hour Swing',
    algoKey: 'macd_momentum',
    description: 'Uses the MACD crossover to enter INFY in the last hour for overnight swings (carried forward if EOD signal is still bullish).',
    instrument: 'INFY',
    exchange: 'NSE | EQ | INTRADAY',
    minimumCapital: 25000,
    window: { start: '14:15', end: '15:20', tz: 'IST', days: 'Mon-Fri' },
    tags: ['EOD', 'Swing', 'Momentum'],
    marketConditions: ['Trending', 'Normal Volatility'],
    category: 'momentum',
    tier: 'retail',
  },
  {
    code: 'TA006',
    name: 'HDFCBANK Afternoon Trend',
    algoKey: 'ma_crossover',
    description: 'MA crossover on HDFCBANK during the afternoon session when banking names tend to pick a direction and hold it into close.',
    instrument: 'HDFCBANK',
    exchange: 'NSE | EQ | INTRADAY',
    minimumCapital: 50000,
    window: { start: '13:00', end: '15:15', tz: 'IST', days: 'Mon-Fri' },
    tags: ['Afternoon', 'Banking', 'Trend Following'],
    marketConditions: ['Trending', 'Normal Volatility'],
    category: 'trend',
    tier: 'retail',
  },
  {
    code: 'TA007',
    name: 'NIFTY Midday Reversal Play',
    algoKey: 'rsi_reversion',
    description: 'Looks for index pullbacks during the 11:00-14:00 IST window when intraday breadth often mean-reverts. Enters on deep index RSI dips.',
    instrument: 'NIFTY',
    exchange: 'NSE | IDX | INTRADAY',
    minimumCapital: 100000,
    window: { start: '11:00', end: '14:00', tz: 'IST', days: 'Mon-Fri' },
    tags: ['Midday', 'Index', 'Counter-Trend'],
    marketConditions: ['Sideways', 'Low Volatility', 'Mean Reversion'],
    category: 'reversion',
    tier: 'premium',
  },
  {
    code: 'TA008',
    name: 'BANKNIFTY Lunch Breakout',
    algoKey: 'bollinger_breakout',
    description: 'Targets breakouts out of the lunch-hour range on BANKNIFTY. Higher capital floor reflects index tick value.',
    instrument: 'BANKNIFTY',
    exchange: 'NSE | IDX | INTRADAY',
    minimumCapital: 200000,
    window: { start: '12:30', end: '14:30', tz: 'IST', days: 'Mon-Fri' },
    tags: ['Lunch', 'Banking Index', 'Breakout'],
    marketConditions: ['Volatile Markets', 'Breakout', 'Bi-Directional'],
    category: 'breakout',
    tier: 'hni',
  },
  {
    code: 'TA009',
    name: 'RELIANCE Opening Volatility',
    algoKey: 'atr_trend',
    description: 'Rides opening-session volatility on RELIANCE when the energy sector often has pronounced moves from gap reactions.',
    instrument: 'RELIANCE',
    exchange: 'NSE | EQ | INTRADAY',
    minimumCapital: 75000,
    window: { start: '09:15', end: '11:00', tz: 'IST', days: 'Mon-Fri' },
    tags: ['Opening', 'Energy', 'Volatility'],
    marketConditions: ['Volatile Markets', 'Trending'],
    category: 'trend',
    tier: 'premium',
  },
  {
    code: 'TA010',
    name: 'TCS Closing Swing',
    algoKey: 'macd_momentum',
    description: 'MACD swing on TCS in the final 45 minutes, positioning for next-day continuation.',
    instrument: 'TCS',
    exchange: 'NSE | EQ | INTRADAY',
    minimumCapital: 40000,
    window: { start: '14:30', end: '15:15', tz: 'IST', days: 'Mon-Fri' },
    tags: ['EOD', 'IT', 'Swing'],
    marketConditions: ['Trending', 'Normal Volatility'],
    category: 'momentum',
    tier: 'retail',
  },
  {
    code: 'TA011',
    name: 'INFY Mid-Session Scalp',
    algoKey: 'rsi_reversion',
    description: 'Aggressive RSI thresholds (25/75) for faster scalps on INFY during the mid-session when IT rotates on global cues.',
    instrument: 'INFY',
    exchange: 'NSE | EQ | INTRADAY',
    minimumCapital: 30000,
    window: { start: '11:30', end: '13:30', tz: 'IST', days: 'Mon-Fri' },
    tags: ['Scalp', 'Mid-Session', 'Mean Reversion'],
    marketConditions: ['Sideways', 'Low Volatility', 'Mean Reversion'],
    category: 'reversion',
    tier: 'hni',
  },
  {
    code: 'TA012',
    name: 'TCS Positional Trend',
    algoKey: 'ma_crossover',
    description: 'Conservative 10/50 MA crossover on TCS for whole-day positional moves. Lower turnover, designed to avoid whipsaws.',
    instrument: 'TCS',
    exchange: 'NSE | EQ | INTRADAY',
    minimumCapital: 40000,
    window: { start: '09:15', end: '15:15', tz: 'IST', days: 'Mon-Fri' },
    tags: ['Full-Day', 'Positional', 'Trend Following'],
    marketConditions: ['Trending', 'Low Volatility', 'Positional'],
    category: 'trend',
    tier: 'retail',
  },
];

function inr(n) { return `₹${n.toLocaleString('en-IN')}`; }

// Format time window as "09:30–11:00 IST" for readable UI display
export function formatWindow(w) {
  if (!w) return '';
  return `${w.start}–${w.end} ${w.tz ?? ''}`.trim();
}

export function marketplaceRow(s) {
  const windowStr = formatWindow(s.window);
  return {
    key: s.code,
    strategist: {
      ...STRATEGIST,
      strategyName: s.name,
      isLive: false,
      isNew: false,
      isFavourite: false,
    },
    odysseyStrategy: {
      code: s.name,
      value: windowStr,
      isLive: false,
      isNew: false,
      isFavourite: false,
    },
    titleDescription: {
      title: s.name,
      description: s.description,
    },
    instrument: {
      name: s.instrument,
      names: [s.instrument],
      alias: null,
      exchange: s.exchange,
    },
    minimumCapitalRequired: inr(s.minimumCapital),
    window: s.window,
    windowLabel: windowStr,
    tags: s.tags,
    marketConditions: s.marketConditions ?? [],
    category: s.category,
    executeButton: { label: 'Execute' },
  };
}

export function savedRow(s) {
  return {
    key: s.code,
    mode: { modeIcon: 'customIconPT' },
    strategy: {
      code: s.code,
      name: s.name,
      isNew: false,
      strategistId: 1,
      strategyType: s.category,
    },
    type: {
      label: s.algoKey,
      color: 'blue',
    },
    instruments: { code: s.instrument, name: s.exchange.split('|')[0].trim() },
    tag: formatWindow(s.window),
    pnl: { currency: '₹', amount: 0, volumeOfTrades: 0 },
  };
}

export const BY_CATEGORY = {
  retail: CATALOG.filter((s) => s.tier === 'retail'),
  premium: CATALOG.filter((s) => s.tier === 'premium'),
  hni: CATALOG.filter((s) => s.tier === 'hni'),
};

export function codeToAlgoKey(code) {
  const s = CATALOG.find((x) => x.code === code);
  return s?.algoKey;
}

export function lookupByCode(code) {
  return CATALOG.find((x) => x.code === code);
}

// --- Time-window helpers used by the simulator ---

// Returns current IST time as "HH:MM" string.
// getTime() is always UTC epoch ms — to derive IST we just add 330*60_000 and
// read via getUTC*. No getTimezoneOffset() (host-independent).
export function nowISTHHMM() {
  const istMs = Date.now() + 330 * 60_000;
  const ist = new Date(istMs);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function nowISTDayOfWeek() {
  const istMs = Date.now() + 330 * 60_000;
  return new Date(istMs).getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
}

// Is the current IST time inside the given window?
export function isInWindow(w) {
  if (!w) return true; // no window = always eligible
  const dow = nowISTDayOfWeek();
  // Mon-Fri by default; days field is informational for UI — enforce weekdays
  if (dow === 0 || dow === 6) return false;
  const now = nowISTHHMM();
  return now >= w.start && now <= w.end;
}
