// AutoTrade — BullsAI reference-capture script.
// Usage:  BULLSAI_USER=... BULLSAI_PASS=... node tools/capture.mjs
// Opens a visible Chromium, logs in (pausing for reCAPTCHA if needed),
// walks every target route, and saves a screenshot + DOM snapshot + a
// list of network requests for each page under _capture/.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const USER = process.env.BULLSAI_USER;
const PASS = process.env.BULLSAI_PASS;
if (!USER || !PASS) {
  console.error('Set BULLSAI_USER and BULLSAI_PASS in the env.');
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, '_capture');
const SCREENS = path.join(OUT, 'screens');
const DOM = path.join(OUT, 'dom');
const LOGS = path.join(OUT, 'logs');
await fs.mkdir(SCREENS, { recursive: true });
await fs.mkdir(DOM, { recursive: true });
await fs.mkdir(LOGS, { recursive: true });

// Routes discovered from the JS bundle. Public/auth pages first; everything
// else requires a logged-in session.
const PUBLIC_ROUTES = [
  ['login', '/user/login'],
  ['register', '/user/register'],
  ['brokerlogin', '/user/brokerlogin'],
  ['pricing', '/pricing'],
  ['marketplace', '/marketplace'],
  ['marketplace-retail', '/marketplace/category/retail'],
  ['marketplace-premium', '/marketplace/category/premium'],
  ['marketplace-hni', '/marketplace/category/hni'],
  ['doc-disclaimer', '/documents/disclaimer'],
  ['doc-privacy', '/documents/privacy-policy'],
  ['doc-terms', '/documents/terms-conditions-of-use'],
  ['doc-refund', '/documents/refund-policy'],
];

const AUTH_ROUTES = [
  ['dashboard', '/dashboard'],
  ['portfolio', '/portfolio'],
  ['book', '/book'],
  ['book-fund', '/book/fund'],
  ['book-pl', '/book/pl'],
  ['book-trade', '/book/trade'],
  ['broking', '/broking'],
  ['wallet', '/wallet'],
  ['vault', '/vault'],
  ['settings', '/settings'],
  ['profiling', '/profiling'],
  ['myplans', '/myplans'],
  ['algo-marketplace', '/algo/marketplace'],
  ['genie', '/genie'],
  ['genie-splash', '/genie/splash'],
  ['genie-saved', '/genie/saved-strategies'],
  ['phoenix-splash', '/phoenix/splash'],
  ['phoenix-saved', '/phoenix/saved-strategies'],
  ['phoenix-classic', '/phoenix/classicBuild/select'],
  ['pythonbuild', '/pythonbuild'],
  ['pythonbuild-splash', '/pythonbuild/splash'],
  ['socialbuild', '/socialbuild'],
  ['odyssey', '/odyssey'],
  ['help', '/help'],
];

const BASE = 'https://bullsai.io';

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function capture(page, [name, routePath]) {
  const url = BASE + routePath;
  const reqs = [];
  const listener = (req) => {
    if (req.url().startsWith(BASE) === false && req.resourceType() !== 'xhr' && req.resourceType() !== 'fetch') return;
    reqs.push({ method: req.method(), url: req.url(), type: req.resourceType() });
  };
  page.on('request', listener);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  } catch (e) {
    console.warn(`[${name}] goto warning: ${e.message}`);
  }
  await delay(1500); // let animations settle
  const shotPath = path.join(SCREENS, `${name}.png`);
  const domPath = path.join(DOM, `${name}.html`);
  const logPath = path.join(LOGS, `${name}.json`);
  try {
    await page.screenshot({ path: shotPath, fullPage: true });
  } catch (e) {
    console.warn(`[${name}] screenshot failed: ${e.message}`);
  }
  const html = await page.content();
  await fs.writeFile(domPath, html, 'utf8');
  await fs.writeFile(logPath, JSON.stringify(reqs, null, 2), 'utf8');
  page.off('request', listener);
  console.log(`[${name}] captured  (${reqs.length} reqs)`);
}

async function login(page) {
  console.log('Navigating to login...');
  await page.goto(`${BASE}/user/login`, { waitUntil: 'networkidle', timeout: 45_000 });
  await delay(1500);

  // Try common Ant Design input selectors.
  const userSel = 'input[type="email"], input[id*="mail" i], input[placeholder*="mail" i], input[placeholder*="mobile" i], input[id*="username" i]';
  const passSel = 'input[type="password"]';

  try {
    await page.waitForSelector(userSel, { timeout: 10_000 });
    await page.fill(userSel, USER);
  } catch (e) {
    console.warn('Could not auto-fill username; please fill manually in the window.');
  }
  try {
    await page.fill(passSel, PASS);
  } catch {}

  // Click the primary button (login).
  const btnSel = 'button.ant-btn-primary, button[type="submit"]';
  try { await page.click(btnSel, { timeout: 5000 }); } catch {}

  console.log('Submitted. If reCAPTCHA appears, solve it in the window.');
  console.log('Waiting up to 120s for navigation to /dashboard...');

  const start = Date.now();
  while (Date.now() - start < 120_000) {
    const u = page.url();
    if (u.includes('/dashboard') || u.includes('/loading') || u.includes('/profiling')) {
      console.log(`Login reached: ${u}`);
      await delay(2000);
      return true;
    }
    await delay(1000);
  }
  console.warn('Login timeout — continuing anyway.');
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  // 1. Capture public routes first (no login needed).
  console.log('\n=== PUBLIC ROUTES ===');
  for (const r of PUBLIC_ROUTES) {
    try { await capture(page, r); } catch (e) { console.warn(e); }
  }

  // 2. Log in.
  console.log('\n=== LOGIN ===');
  await login(page);

  // 3. Save storage state so we could reuse it later.
  await ctx.storageState({ path: path.join(OUT, 'session.json') });

  // 4. Capture authenticated routes.
  console.log('\n=== AUTHENTICATED ROUTES ===');
  for (const r of AUTH_ROUTES) {
    try { await capture(page, r); } catch (e) { console.warn(e); }
  }

  await browser.close();
  console.log('\nDone. Output in _capture/');
})();
