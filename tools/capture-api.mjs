// TradeAuto — API capture from bullsai.io.
// Loads saved session (_capture/session.json), walks every authenticated route,
// and logs every XHR/fetch request+response into _capture/api/.
//
// Output:
//   _capture/api/<route>.jsonl   — one record per API call on that route
//   _capture/api/_index.json     — flat index: all unique {method, path} pairs
//   _capture/api/_catalog.json   — grouped: path -> methods -> request/response samples
//
// A "record" looks like:
//   { ts, route, method, url, path, query, reqHeaders, reqBody,
//     status, resHeaders, resBody, contentType, durationMs }

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, '_capture');
const API = path.join(OUT, 'api');
const SESSION = path.join(OUT, 'session.json');
await fs.mkdir(API, { recursive: true });

// All post-auth routes worth walking. Mirrors AUTH_ROUTES from capture-auth.mjs.
const AUTH_ROUTES = [
  ['dashboard', '/dashboard'],
  ['portfolio', '/portfolio'],
  ['book-trade', '/book/trade'],
  ['book-fund', '/book/fund'],
  ['book-pl', '/book/pl'],
  ['broking', '/broking'],
  ['wallet', '/wallet'],
  ['vault', '/vault'],
  ['settings', '/settings'],
  ['profiling', '/profiling'],
  ['myplans', '/myplans'],
  ['pricing-auth', '/pricing'],
  ['algo-marketplace', '/algo/marketplace'],
  ['marketplace-auth', '/marketplace'],
  ['marketplace-retail-auth', '/marketplace/category/retail'],
  ['marketplace-premium-auth', '/marketplace/category/premium'],
  ['marketplace-hni-auth', '/marketplace/category/hni'],
  ['genie', '/genie'],
  ['genie-splash', '/genie/splash'],
  ['genie-splash-studio', '/genie/splash/studio'],
  ['genie-studio-select', '/genie/studio/select'],
  ['genie-saved', '/genie/saved-strategies'],
  ['genie-myall', '/genie/MyAllStrategy'],
  ['phoenix-splash', '/phoenix/splash'],
  ['phoenix-classic', '/phoenix/classicBuild/select'],
  ['phoenix-saved', '/phoenix/saved-strategies'],
  ['phoenix-myall', '/phoenix/MyAllStrategy'],
  ['pythonbuild', '/pythonbuild'],
  ['pythonbuild-splash', '/pythonbuild/splash'],
  ['pythonbuild-myall', '/pythonbuild/MyAllStrategy'],
  ['socialbuild', '/socialbuild'],
  ['odyssey', '/odyssey'],
  ['help-auth', '/help'],
];

const BASE = 'https://bullsai.io';
// All hosts whose API calls we want to record. Third-party telemetry
// (analytics, sentry, google, etc.) is skipped.
const API_HOSTS = [
  /^cojoznsr10\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/,
  /^(.*\.)?bullsai\.io$/,
];
const MAX_BODY_BYTES = 1024 * 256; // clip huge responses

// Only keep network calls that look like data, not static assets.
function isApiLike(req, resp) {
  const type = req.resourceType();
  if (type === 'xhr' || type === 'fetch') return true;
  // Some apps use EventSource/WebSocket — capture those too when present.
  if (type === 'eventsource' || type === 'websocket') return true;
  // Sometimes JSON comes back under "other" — include if content-type says so.
  const ct = (resp?.headers?.()['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) return true;
  return false;
}

function safeHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    // redact common auth-like headers so we don't commit tokens by accident
    if (/^(authorization|cookie|set-cookie|x-auth|x-csrf)/i.test(k)) {
      out[k] = '<redacted>';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function parseUrl(raw) {
  try {
    const u = new URL(raw);
    return { host: u.host, path: u.pathname, query: u.search ? Object.fromEntries(u.searchParams) : null };
  } catch {
    return { host: '', path: raw, query: null };
  }
}

function clip(text) {
  if (typeof text !== 'string') return text;
  if (text.length > MAX_BODY_BYTES) return text.slice(0, MAX_BODY_BYTES) + `\n…<clipped ${text.length - MAX_BODY_BYTES} bytes>`;
  return text;
}

async function readBody(resp) {
  try {
    const buf = await resp.body();
    const ct = (resp.headers()['content-type'] || '').toLowerCase();
    const text = buf.toString('utf8');
    if (ct.includes('application/json')) {
      try { return { kind: 'json', value: JSON.parse(text) }; }
      catch { return { kind: 'text', value: clip(text) }; }
    }
    if (buf.length < MAX_BODY_BYTES && /text|xml|html|javascript/.test(ct)) {
      return { kind: 'text', value: clip(text) };
    }
    return { kind: 'binary', bytes: buf.length, contentType: ct };
  } catch (e) {
    return { kind: 'error', error: String(e) };
  }
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

const globalIndex = new Map(); // key: `${method} ${path}` -> { samples: [] }

async function walk(page, [name, routePath]) {
  const url = BASE + routePath;
  const collected = []; // { request, startTime }
  const startTimes = new Map();

  const onRequest = (req) => {
    let host;
    try { host = new URL(req.url()).host; } catch { return; }
    if (!API_HOSTS.some((re) => re.test(host))) return;
    const type = req.resourceType();
    if (type !== 'xhr' && type !== 'fetch' && type !== 'eventsource' && type !== 'websocket') return;
    startTimes.set(req, Date.now());
    collected.push(req);
  };

  page.on('request', onRequest);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  } catch (e) {
    console.warn(`[${name}] goto warning: ${e.message}`);
  }
  // Let late XHR fire (charts, price tickers, lazy panels)
  await delay(2500);

  page.off('request', onRequest);

  // Now materialize each request's response — awaited inline so nothing races.
  const records = [];
  for (const req of collected) {
    let resp;
    try { resp = await req.response(); } catch { resp = null; }
    if (!resp) continue;

    const { host, path: urlPath, query } = parseUrl(req.url());
    const reqBody = (() => {
      const raw = req.postData();
      if (raw == null) return null;
      try { return { kind: 'json', value: JSON.parse(raw) }; }
      catch { return { kind: 'text', value: clip(raw) }; }
    })();
    const resBody = await readBody(resp);
    const started = startTimes.get(req) ?? Date.now();

    const record = {
      ts: new Date().toISOString(),
      route: name,
      method: req.method(),
      url: req.url(),
      host,
      path: urlPath,
      query,
      reqHeaders: safeHeaders(req.headers()),
      reqBody,
      status: resp.status(),
      resHeaders: safeHeaders(resp.headers()),
      resBody,
      contentType: resp.headers()['content-type'] ?? null,
      durationMs: Date.now() - started,
    };
    records.push(record);

    const key = `${record.method} ${urlPath}`;
    const bucket = globalIndex.get(key) ?? { method: record.method, path: urlPath, sampleRoutes: new Set(), samples: [] };
    bucket.sampleRoutes.add(name);
    if (bucket.samples.length < 3) {
      bucket.samples.push({ route: name, query, reqBody, status: record.status, resBody });
    }
    globalIndex.set(key, bucket);
  }

  const outPath = path.join(API, `${name}.jsonl`);
  await fs.writeFile(
    outPath,
    records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''),
    'utf8',
  );
  console.log(`[${name}] ${records.length} API calls captured (of ${collected.length} candidates)`);
}

(async () => {
  let session;
  try {
    session = JSON.parse(await fs.readFile(SESSION, 'utf8'));
  } catch (e) {
    console.error(`Cannot read ${SESSION}. Run capture-auth.mjs first. ${e.message}`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, slowMo: 0 });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    storageState: session,
  });
  const page = await ctx.newPage();

  // Sanity: hit dashboard once to confirm auth is alive.
  try {
    const probe = await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const finalUrl = page.url();
    if (finalUrl.includes('/user/login')) {
      console.error(`Session expired — got bounced to ${finalUrl}. Re-run capture-auth.mjs to refresh.`);
      await browser.close();
      process.exit(2);
    }
    console.log(`Auth OK (probe status: ${probe?.status()}). Walking routes...\n`);
  } catch (e) {
    console.error(`Auth probe failed: ${e.message}`);
    await browser.close();
    process.exit(2);
  }

  for (const r of AUTH_ROUTES) {
    try { await walk(page, r); }
    catch (e) { console.warn(`[${r[0]}] failed: ${e.message}`); }
  }

  // Write index + catalog
  const index = Array.from(globalIndex.values()).map((b) => ({
    method: b.method,
    path: b.path,
    routes: Array.from(b.sampleRoutes),
    sampleCount: b.samples.length,
  })).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  await fs.writeFile(path.join(API, '_index.json'), JSON.stringify(index, null, 2), 'utf8');

  const catalog = {};
  for (const [key, bucket] of globalIndex.entries()) {
    const k = bucket.path;
    if (!catalog[k]) catalog[k] = {};
    catalog[k][bucket.method] = {
      routes: Array.from(bucket.sampleRoutes),
      samples: bucket.samples,
    };
  }
  await fs.writeFile(path.join(API, '_catalog.json'), JSON.stringify(catalog, null, 2), 'utf8');

  await browser.close();
  console.log(`\nDone. ${index.length} unique endpoints across ${AUTH_ROUTES.length} routes.`);
  console.log(`  Records:  _capture/api/<route>.jsonl`);
  console.log(`  Index:    _capture/api/_index.json`);
  console.log(`  Catalog:  _capture/api/_catalog.json`);
})();
