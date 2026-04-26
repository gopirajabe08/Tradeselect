// TradeAuto mock backend with stateful trading simulator.
//
// Two layers:
//   1. REPLAY layer — returns recorded bullsai responses for every GET captured
//      in _capture/api/*.jsonl. Used for static UI data (dashboard cards,
//      marketplace grids, plan lists, etc.).
//   2. TRADING layer — stateful overrides for endpoints that must reflect
//      simulator state (portfolio, book/trade, book/pl) and new write
//      endpoints for strategy lifecycle (/strategy/start, /stop).
//
// The tick simulator (simulator.mjs) runs in-process and mutates state in
// state.mjs. All mutations are persisted to _state.json.

import express from 'express';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { load as loadState, listInstances, listTrades, createInstance, stopInstance, deleteInstance, INSTRUMENTS, currentPrice, getState, priceHistory, pnlHistory, saveUserProfile, userProfile } from './state.mjs';
import { start as startSim } from './simulator.mjs';
import { STRATEGIES, CODE_TO_ALGO } from './strategies.mjs';
import { CATALOG, BY_CATEGORY, marketplaceRow, savedRow, codeToAlgoKey, lookupByCode } from './catalog.mjs';
import { seedHistory, allDataSources, getDataSource } from './marketdata.mjs';
import { computeMarketStatus, categoryFitsNow } from './market-regime.mjs';
import { autoSchedulerStatus } from './auto-scheduler.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const API_DIR = path.join(ROOT, '_capture', 'api');
const PORT = Number(process.env.MOCK_PORT ?? 4000);

// ---------- Replay layer ----------

async function loadRecords() {
  // Replay layer is optional. Production deployments don't ship the captured
  // fixtures (`_capture/api/*.jsonl`) — those exist only for local dev and
  // are gitignored. If the dir is missing, skip replay entirely; the trading
  // layer (the only thing that matters in prod) takes over for everything.
  let files;
  try {
    files = (await fs.readdir(API_DIR)).filter((f) => f.endsWith('.jsonl'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`[mock] no replay fixtures at ${API_DIR} — replay layer disabled (this is normal in production)`);
      return [];
    }
    throw err;
  }
  const records = [];
  for (const f of files) {
    const body = await fs.readFile(path.join(API_DIR, f), 'utf8');
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* skip */ }
    }
  }
  return records;
}

function groupByEndpoint(records) {
  const table = new Map();
  for (const r of records) {
    const key = `${r.method} ${r.path}`;
    const bucket = table.get(key) ?? { method: r.method, path: r.path, samples: [] };
    bucket.samples.push(r);
    table.set(key, bucket);
  }
  return table;
}

function pickBestSample(samples, reqQuery) {
  if (samples.length === 1) return samples[0];
  const reqKeys = new Set(Object.keys(reqQuery ?? {}));
  for (const s of samples) {
    const sq = s.query ?? {};
    const sk = Object.keys(sq);
    if (sk.length !== reqKeys.size) continue;
    const same = sk.every((k) => String(reqQuery[k] ?? '') === String(sq[k]));
    if (same) return s;
  }
  let best = samples[0];
  let bestScore = -1;
  for (const s of samples) {
    const sk = Object.keys(s.query ?? {});
    const score = sk.filter((k) => reqKeys.has(k)).length;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}

function sanitize(input) {
  if (input == null) return input;
  if (typeof input === 'string') {
    return input
      .replace(/\bBullsAI\b/g, 'TradeAuto')
      .replace(/\bAlgoBulls\b/g, 'TradeAuto')
      .replace(/\bOdyssey\b/g, 'TradeAuto')
      .replace(/bullsai\.io/gi, 'tradeauto.local');
  }
  if (Array.isArray(input)) return input.map(sanitize);
  if (typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input)) out[k] = sanitize(v);
    return out;
  }
  return input;
}

function bodyToSend(resBody) {
  if (!resBody) return { contentType: 'application/json', payload: 'null' };
  if (resBody.kind === 'json') {
    return { contentType: 'application/json', payload: JSON.stringify(sanitize(resBody.value)) };
  }
  if (resBody.kind === 'text') {
    return { contentType: 'text/plain; charset=utf-8', payload: resBody.value };
  }
  if (resBody.kind === 'binary') {
    return { contentType: resBody.contentType || 'application/octet-stream', payload: '' };
  }
  return { contentType: 'application/json', payload: JSON.stringify(resBody) };
}

// ---------- Trading-layer shapes ----------
// Keep these aligned with src/components/ApiTable/renderers.tsx — the renderer
// valueTypes dictate how fields are presented. We build rows that work with
// strategy/instruments/tag/pnlColumn/progress/startButton renderers.

function portfolioRowFromInstance(inst) {
  const price = currentPrice(inst.instrument) ?? 0;
  const totalPnl = inst.realizedPnl + inst.unrealizedPnl;
  const volumeOfTrades = inst.position ? inst.position.entryPrice * inst.position.quantity : 0;
  const windowStr = inst.window ? `${inst.window.start}–${inst.window.end} ${inst.window.tz ?? ''}`.trim() : '';
  let statusText;
  let statusColor;
  if (inst.status !== 'RUNNING') {
    statusText = 'Stopped';
    statusColor = 'gray';
  } else if (inst.window && inst.scheduleEnabled && !inst.inWindow) {
    statusText = `Waiting for ${inst.window.start} IST`;
    statusColor = 'gold';
  } else if (inst.position) {
    statusText = 'In Position';
    statusColor = 'blue';
  } else {
    statusText = 'Scanning';
    statusColor = 'orange';
  }
  return {
    key: inst.id,
    mode: { modeIcon: `customIcon${inst.mode}` },
    strategy: {
      code: inst.strategyCode,
      name: inst.strategyName,
      isNew: false,
      strategistId: 1,
      strategyType: inst.strategyType,
    },
    instruments: { code: inst.instrument, name: inst.exchange },
    tag: windowStr || (inst.status === 'RUNNING' ? 'LIVE' : inst.status),
    pnl: {
      currency: '₹',
      amount: Number(totalPnl.toFixed(2)),
      volumeOfTrades: Number(volumeOfTrades.toFixed(2)),
    },
    progress: {
      strategy: {
        startTimestamp: inst.startedAt?.slice(0, 16).replace('T', ' | ') ?? '',
        endTimestamp: inst.stoppedAt?.slice(0, 16).replace('T', ' | ') ?? '',
      },
      notStartedYet: false,
      lastEvent: {
        timestamp: (inst.stoppedAt ?? inst.startedAt ?? '').slice(0, 16).replace('T', ' | '),
        text: statusText,
        color: statusColor,
      },
    },
    config: { instance: inst.id, capital: inst.capital, window: windowStr },
    actionStartButton: inst.status === 'RUNNING' ? 'STOP' : 'START',
    status: inst.status === 'RUNNING' ? 1 : 0,
  };
}

function tradeBookRowFromTrade(t, inst) {
  return {
    key: t.id,
    mode: { modeIcon: `customIcon${inst?.mode ?? 'PT'}` },
    strategy: {
      code: inst?.strategyCode ?? '—',
      name: inst?.strategyName ?? '—',
      strategyType: inst?.strategyType ?? 'odyssey',
    },
    broker: { name: 'Simulator', accountId: `SIM-${t.instanceId}` },
    algobullsOrderId: `TA-${t.id}`,
    transaction: `${t.side} ${t.quantity} @ ₹${t.price}`,
    timestamp: t.timestamp,
  };
}

function plBookRowFromTrade(t, inst) {
  // Only SELL trades create a closed P&L row (the entry+exit pair collapsed).
  if (t.side !== 'SELL') return null;
  const pair = {
    price: t.price,
    currency: '₹',
    timestamp: t.timestamp?.slice(0, 16).replace('T', ' | '),
    quantity: t.quantity,
  };
  return {
    key: t.id,
    mode: { modeIcon: `customIcon${inst?.mode ?? 'PT'}` },
    strategy: {
      code: inst?.strategyCode ?? '—',
      name: inst?.strategyName ?? '—',
      strategyType: inst?.strategyType ?? 'odyssey',
    },
    broker: { name: 'Simulator', accountId: `SIM-${t.instanceId}` },
    entry: pair, // best-effort — real entry price is on the previous BUY trade
    exit: pair,
    pnlPercentage: { value: inst?.position?.entryPrice ? (t.pnl / (inst.position.entryPrice * t.quantity)) * 100 : 0, currency: '%' },
    pnlAbsolute: { value: t.pnl, currency: '₹' },
  };
}

// ---------- App ----------

async function main() {
  await loadState();
  const records = await loadRecords();
  const table = groupByEndpoint(records);
  console.log(`[mock] loaded ${records.length} records, ${table.size} unique endpoints`);

  console.log('[md] seeding price history from Yahoo Finance…');
  await seedHistory();
  console.log('[md] ready. Data sources:', allDataSources());

  startSim();

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => {
    if (!req.url.startsWith('/prod/v1/site/')) {
      console.log(`[mock] ${req.method} ${req.url}`);
    }
    next();
  });

  // --- Root + health + meta ---

  app.get('/', (_req, res) => {
    const endpoints = Array.from(table.values())
      .map((b) => ({ method: b.method, path: b.path, samples: b.samples.length }))
      .sort((a, b) => a.path.localeCompare(b.path));
    res.json({ ok: true, endpointCount: endpoints.length, endpoints });
  });

  app.get('/_sim/auto-scheduler', (_req, res) => {
    res.json(autoSchedulerStatus());
  });

  // Serve the built React UI for non-API paths. Only hits if request hasn't
  // matched any of the simulator/replay routes above. SPA fallback below
  // handles client-side routes like /portfolio, /marketplace, etc.
  const DIST_DIR = path.resolve(ROOT, 'dist');
  try {
    if (fsSync.existsSync(DIST_DIR)) {
      app.use(express.static(DIST_DIR, { index: false }));
      console.log(`[mock] serving UI from ${DIST_DIR}`);
    } else {
      console.log(`[mock] no UI dist/ at ${DIST_DIR} — UI routes will 404 (run "npm run build" locally and rsync to server)`);
    }
  } catch (err) {
    console.error('[mock] static UI serve setup failed:', err.message);
  }

  app.get('/_sim/status', (_req, res) => {
    const s = getState();
    res.json({
      lastTickAt: s.lastTickAt,
      prices: s.prices,
      instanceCount: s.instances.length,
      running: s.instances.filter((i) => i.status === 'RUNNING').length,
      tradeCount: s.trades.length,
    });
  });

  app.get('/_sim/instruments', (_req, res) => {
    res.json(INSTRUMENTS.map((i) => ({
      ...i,
      currentPrice: currentPrice(i.code),
      dataSource: getDataSource(i.code),
    })));
  });

  app.get('/_sim/data-sources', (_req, res) => { res.json(allDataSources()); });

  // Current volatility/trend regime per instrument + overall index-driven regime.
  // Frontend uses this to surface which strategies suit the current market.
  app.get('/_sim/market-status', (_req, res) => {
    const status = computeMarketStatus(getState());
    // Attach a per-catalog-entry "good fit" flag so marketplace can mark rows.
    const overallTrend =
      status.instruments.find((i) => i.code === 'NIFTY')?.trend ??
      status.instruments.find((i) => i.code === 'BANKNIFTY')?.trend ??
      'sideways';
    const fitMap = {};
    for (const s of CATALOG) {
      const inst = status.instruments.find((i) => i.code === s.instrument);
      const instRegime = inst?.regime ?? status.overall.regime;
      const instTrend = inst?.trend ?? overallTrend;
      fitMap[s.code] = {
        fits: categoryFitsNow(s.category, instRegime, instTrend),
        regime: instRegime,
        trend: instTrend,
      };
    }
    res.json({ ...status, fitByCode: fitMap, overallTrend });
  });

  app.get('/_sim/algos', (_req, res) => {
    res.json({
      algos: Object.entries(STRATEGIES).map(([key, a]) => ({
        key, name: a.name, description: a.description, defaultParams: a.defaultParams,
      })),
      mapping: CODE_TO_ALGO,
    });
  });

  app.get('/_sim/history/price/:instrument', (req, res) => {
    const series = priceHistory(req.params.instrument);
    res.json({ instrument: req.params.instrument, data: series.map((p, i) => ({ t: i, price: Number(p.toFixed(2)) })) });
  });

  app.get('/_sim/history/pnl/:instanceId', (req, res) => {
    const id = Number(req.params.instanceId);
    res.json({ instanceId: id, data: pnlHistory(id) });
  });

  app.get('/_sim/history/pnl-all', (req, res) => {
    const s = getState();
    const onlyRunning = String(req.query.onlyRunning ?? '') === 'true';
    const bucket = String(req.query.bucket ?? ''); // 'minute' | 'hour' | ''

    const instanceIndex = new Map(s.instances.map((i) => [i.id, i]));
    const series = {};
    for (const [id, pts] of Object.entries(s.pnlHistory)) {
      if (onlyRunning) {
        const inst = instanceIndex.get(Number(id));
        if (!inst || inst.status !== 'RUNNING') continue;
      }
      series[id] = pts;
    }

    if (!bucket) { res.json({ series }); return; }

    // Aggregate into time buckets. Key = ISO hour (YYYY-MM-DDTHH) or minute.
    // Emits one {t, pnl, realized, unrealized} per bucket per instance.
    const bucketKey = (iso) => {
      if (bucket === 'hour') return iso.slice(0, 13) + ':00';
      if (bucket === 'minute') return iso.slice(0, 16);
      return iso;
    };
    const bucketed = {};
    for (const [id, pts] of Object.entries(series)) {
      const byBucket = new Map();
      for (const p of pts) {
        const k = bucketKey(p.t);
        // keep the LAST value within each bucket (end-of-period P&L)
        byBucket.set(k, p);
      }
      bucketed[id] = Array.from(byBucket.entries()).map(([t, p]) => ({
        t,
        realized: p.realized,
        unrealized: p.unrealized,
        total: p.total,
        price: p.price,
      }));
    }
    res.json({ series: bucketed, bucket });
  });

  app.get('/_sim/profile', (_req, res) => { res.json(userProfile()); });

  app.post('/_sim/profile', async (req, res) => {
    const patch = req.body ?? {};
    const saved = await saveUserProfile(patch);
    res.json({ ok: true, profile: saved });
  });

  // --- Strategy catalog (TradeAuto's own) ---

  app.get(['/api/v4/strategy', '/prod/v4/strategy'], (req, res) => {
    const pageSize = Number(req.query.pageSize ?? 10);
    const currentPage = Number(req.query.currentPage ?? 1);
    const category = String(req.query.category ?? '').toLowerCase();
    let pool = CATALOG;
    if (['retail', 'premium', 'hni'].includes(category)) {
      pool = BY_CATEGORY[category] ?? pool;
    }
    const rows = pool.map(marketplaceRow);
    const start = (currentPage - 1) * pageSize;
    res.json({
      data: rows.slice(start, start + pageSize),
      total: rows.length,
      pageSize,
      currentPage,
    });
  });

  app.get(['/api/v5/strategy/filter', '/prod/v5/strategy/filter'], (_req, res) => {
    res.json({
      category: [{ value: 'all', label: 'All' }, { value: 'retail', label: 'Retail' }, { value: 'premium', label: 'Premium' }, { value: 'hni', label: 'HNI' }],
      algorithm: Array.from(new Set(CATALOG.map((s) => s.algoKey))).map((k) => ({ value: k, label: k })),
      instrument: Array.from(new Set(CATALOG.map((s) => s.instrument))).map((i) => ({ value: i, label: i })),
    });
  });

  // Saved / My-All strategies (currently list the whole TA catalog)
  app.get([
    '/api/v1/phoenix/saved/strategies/data', '/prod/v1/phoenix/saved/strategies/data',
  ], (req, res) => {
    const pageSize = Number(req.query.pageSize ?? 10);
    const currentPage = Number(req.query.currentPage ?? 1);
    const rows = CATALOG.map(savedRow);
    const start = (currentPage - 1) * pageSize;
    res.json({ data: rows.slice(start, start + pageSize), total: rows.length, pageSize, currentPage });
  });

  app.get(['/api/_sim/catalog', '/prod/_sim/catalog', '/_sim/catalog'], (_req, res) => {
    res.json({ catalog: CATALOG });
  });

  // --- Trading layer (overrides replay) ---

  // Live portfolio — merges simulator instances into the expected shape.
  app.get(['/api/v6/portfolio/strategies', '/prod/v6/portfolio/strategies',
           '/api/v1/dashboard/portfolio/data', '/prod/v1/dashboard/portfolio/data'], (req, res) => {
    const pageSize = Number(req.query.pageSize ?? 10);
    const currentPage = Number(req.query.currentPage ?? 1);
    const instances = listInstances();
    const rows = instances.map(portfolioRowFromInstance);
    const start = (currentPage - 1) * pageSize;
    res.json({
      data: rows.slice(start, start + pageSize),
      total: rows.length,
      pageSize,
      currentPage,
    });
  });

  // Live trade book
  app.get(['/api/v4/book/trade/data', '/prod/v4/book/trade/data'], (req, res) => {
    const pageSize = Number(req.query.pageSize ?? 10);
    const currentPage = Number(req.query.currentPage ?? 1);
    const trades = listTrades({ limit: 500 });
    const instances = listInstances();
    const rows = trades
      .map((t) => tradeBookRowFromTrade(t, instances.find((i) => i.id === t.instanceId)))
      .filter(Boolean);
    const start = (currentPage - 1) * pageSize;
    res.json({
      data: rows.slice(start, start + pageSize),
      total: rows.length,
      pageSize,
      currentPage,
    });
  });

  // Live P&L book (only SELL trades = closed positions)
  app.get(['/api/v4/book/pl/data', '/prod/v4/book/pl/data'], (req, res) => {
    const pageSize = Number(req.query.pageSize ?? 10);
    const currentPage = Number(req.query.currentPage ?? 1);
    const trades = listTrades({ limit: 500 });
    const instances = listInstances();
    const rows = trades
      .map((t) => plBookRowFromTrade(t, instances.find((i) => i.id === t.instanceId)))
      .filter(Boolean);
    const start = (currentPage - 1) * pageSize;
    res.json({
      data: rows.slice(start, start + pageSize),
      total: rows.length,
      pageSize,
      currentPage,
    });
  });

  // --- Lifecycle write endpoints ---

  app.post(['/api/_sim/strategy/start', '/prod/_sim/strategy/start'], async (req, res) => {
    const b = req.body ?? {};
    if (!b.strategyCode || !b.instrument) {
      res.status(400).json({ error: 'strategyCode and instrument required' });
      return;
    }
    // If the strategyCode matches an entry in TradeAuto's catalog, the
    // algorithm is already known — use it. If the caller overrode algoKey,
    // that wins.
    const catalogAlgo = codeToAlgoKey(b.strategyCode);
    const catalogEntry = lookupByCode(b.strategyCode);
    const inst = await createInstance({
      strategyCode: b.strategyCode,
      strategyName: b.strategyName ?? catalogEntry?.name,
      strategyType: b.strategyType ?? catalogEntry?.category,
      algoKey: b.algoKey ?? catalogAlgo,
      params: b.params,
      // Use catalog window by default; caller may override or disable.
      window: b.window ?? catalogEntry?.window ?? null,
      scheduleEnabled: b.scheduleEnabled !== false,
      instrument: b.instrument,
      exchange: b.exchange,
      capital: Number(b.capital) || 100000,
      mode: b.mode || 'PT',
    });
    res.json({ ok: true, instance: inst });
  });

  app.post(['/api/_sim/strategy/stop/:id', '/prod/_sim/strategy/stop/:id'], async (req, res) => {
    const id = Number(req.params.id);
    const inst = await stopInstance(id);
    if (!inst) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ok: true, instance: inst });
  });

  app.delete(['/api/_sim/strategy/:id', '/prod/_sim/strategy/:id'], async (req, res) => {
    const id = Number(req.params.id);
    const ok = await deleteInstance(id);
    if (!ok) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ok: true });
  });

  app.get(['/api/_sim/strategy/instances', '/prod/_sim/strategy/instances'], (_req, res) => {
    res.json({ data: listInstances() });
  });

  app.get(['/api/_sim/trades', '/prod/_sim/trades'], (req, res) => {
    const instanceId = req.query.instanceId != null ? Number(req.query.instanceId) : undefined;
    res.json({ data: listTrades({ instanceId }) });
  });

  // --- Replay catch-all (must be LAST) ---

  app.use((req, res) => {
    let pathname = req.path;
    if (pathname.startsWith('/api/')) pathname = '/prod' + pathname.slice(4);
    const bucket = table.get(`${req.method} ${pathname}`);
    if (!bucket) {
      // SPA fallback: any unmatched GET that isn't an API path → serve index.html
      // so React Router can handle client-side routes (/portfolio, /marketplace).
      if (req.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/prod/') && !pathname.startsWith('/_sim/')) {
        const indexPath = path.join(ROOT, 'dist', 'index.html');
        if (fsSync.existsSync(indexPath)) {
          res.sendFile(indexPath);
          return;
        }
      }
      res.status(404).json({
        mockError: 'endpoint not recorded',
        method: req.method,
        path: pathname,
        hint: 'Re-run tools/capture-api.mjs against bullsai to record this call.',
      });
      return;
    }
    const sample = pickBestSample(bucket.samples, req.query);
    const { contentType, payload } = bodyToSend(sample.resBody);
    res.status(sample.status || 200);
    res.setHeader('content-type', contentType);
    res.setHeader('x-mock-sample-route', sample.route || '');
    res.setHeader('x-mock-sample-count', String(bucket.samples.length));
    res.send(payload);
  });

  app.listen(PORT, () => {
    console.log(`[mock] listening on http://localhost:${PORT}`);
    const sched = autoSchedulerStatus();
    console.log(`[boot] AUTO_SCHEDULER_ENABLED=${sched.enabled} | isTradingDay=${sched.isTradingDay} | today=${sched.today} | nowIST=${sched.nowIST} | upcoming=${sched.upcomingToday.length}`);
    console.log(`[boot] TELEGRAM=${process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'OFF (notifications silent)'}`);
  });
}

main().catch((e) => {
  console.error('[mock] fatal:', e);
  process.exit(1);
});
