// AutoTrade — authenticated capture with manual login.
// Opens a visible Chromium at the BullsAI login page.
// You log in manually (any tab: India / US / Rest-of-World).
// When the URL leaves /user/*, the script takes over and walks every
// authenticated route, overwriting stale captures under _capture/screens.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, '_capture');
const SCREENS = path.join(OUT, 'screens');
const DOM = path.join(OUT, 'dom');
const LOGS = path.join(OUT, 'logs');
await fs.mkdir(SCREENS, { recursive: true });
await fs.mkdir(DOM, { recursive: true });
await fs.mkdir(LOGS, { recursive: true });

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

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function capture(page, [name, routePath]) {
  const url = BASE + routePath;
  const reqs = [];
  const listener = (req) => {
    reqs.push({ method: req.method(), url: req.url(), type: req.resourceType() });
  };
  page.on('request', listener);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  } catch (e) {
    console.warn(`[${name}] goto warning: ${e.message}`);
  }
  await delay(1800);
  const shotPath = path.join(SCREENS, `${name}.png`);
  const domPath = path.join(DOM, `${name}.html`);
  const logPath = path.join(LOGS, `${name}.json`);
  try {
    await page.screenshot({ path: shotPath, fullPage: true });
  } catch (e) {
    console.warn(`[${name}] screenshot failed: ${e.message}`);
  }
  try {
    const html = await page.content();
    await fs.writeFile(domPath, html, 'utf8');
  } catch {}
  await fs.writeFile(logPath, JSON.stringify(reqs, null, 2), 'utf8');
  page.off('request', listener);
  console.log(`[${name}] captured  (${reqs.length} reqs)`);
}

async function waitForLogin(page) {
  console.log('Opening login page. Please log in manually in the Chromium window.');
  await page.goto(`${BASE}/user/login`, { waitUntil: 'domcontentloaded' });
  console.log('Waiting for you to log in (up to 10 minutes)...');
  const start = Date.now();
  while (Date.now() - start < 10 * 60_000) {
    const u = page.url();
    if (!u.includes('/user/') && u.includes('bullsai.io')) {
      console.log(`Detected post-login URL: ${u}`);
      await delay(2000);
      return true;
    }
    await delay(1500);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 30 });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  const ok = await waitForLogin(page);
  if (!ok) {
    console.error('Login not detected within 10 minutes — aborting.');
    await browser.close();
    process.exit(1);
  }

  await ctx.storageState({ path: path.join(OUT, 'session.json') });
  console.log('Session saved. Walking authenticated routes...\n');

  for (const r of AUTH_ROUTES) {
    try { await capture(page, r); } catch (e) { console.warn(e); }
  }

  await browser.close();
  console.log('\nDone. Output in _capture/');
})();
