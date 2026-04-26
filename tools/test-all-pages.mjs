// Walks every authenticated route in TradeAuto, checks for runtime errors.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const ROUTES = [
  '/dashboard',
  '/portfolio',
  '/book/trade',
  '/book/fund',
  '/book/pl',
  '/broking',
  '/wallet',
  '/vault',
  '/settings',
  '/profiling',
  '/myplans',
  '/pricing',
  '/marketplace',
  '/marketplace/category/retail',
  '/marketplace/category/premium',
  '/marketplace/category/hni',
  '/algo/marketplace',
  '/genie',
  '/genie/splash',
  '/genie/splash/studio',
  '/genie/saved-strategies',
  '/genie/MyAllStrategy',
  '/phoenix/splash',
  '/phoenix/classicBuild/select',
  '/phoenix/saved-strategies',
  '/phoenix/MyAllStrategy',
  '/pythonbuild',
  '/pythonbuild/splash',
  '/pythonbuild/MyAllStrategy',
  '/socialbuild',
  '/odyssey',
  '/help',
  '/user/register',
  '/user/brokerlogin',
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// seed auth
await page.goto('http://localhost:8201/user/login', { waitUntil: 'networkidle' });
await page.click('text=Demo account');
await page.click('button:has-text("Login")');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);

const results = [];
for (const r of ROUTES) {
  const errs = [];
  const http404 = [];
  const pageErrListener = (e) => errs.push(e.message);
  const respListener = (resp) => {
    if (resp.url().includes('/api/') && resp.status() >= 400 && resp.status() !== 404) {
      http404.push(`${resp.status()} ${resp.url().slice(resp.url().indexOf('/api/'))}`);
    }
  };
  page.on('pageerror', pageErrListener);
  page.on('response', respListener);
  try {
    await page.goto(`http://localhost:8201${r}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(400);
  } catch (e) {
    errs.push(`goto: ${e.message}`);
  }
  page.off('pageerror', pageErrListener);
  page.off('response', respListener);
  const hasErrorBanner = await page.locator('.ant-alert-error').count();
  const hasEmpty = await page.locator('.ant-empty').count();
  results.push({
    route: r,
    url: page.url(),
    pageErrors: errs.length,
    pageErrorMsgs: errs.slice(0, 2),
    apiErrors: http404,
    errorBanners: hasErrorBanner,
    emptyStates: hasEmpty,
  });
}

await browser.close();

// Report
let ok = 0, bad = 0;
for (const r of results) {
  const status = r.pageErrors === 0 && r.apiErrors.length === 0 ? '✓' : '✗';
  if (status === '✓') ok++; else bad++;
  console.log(`${status} ${r.route.padEnd(38)} pageErr=${r.pageErrors} apiErr=${r.apiErrors.length} banners=${r.errorBanners} empty=${r.emptyStates}`);
  if (r.pageErrorMsgs.length) console.log('    ', r.pageErrorMsgs[0]);
  if (r.apiErrors.length) r.apiErrors.forEach((a) => console.log('    ', a));
}
console.log(`\n${ok}/${ok+bad} pages clean`);
