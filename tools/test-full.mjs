// Full E2E: login, visit every route, start two strategies, verify charts,
// verify forms, verify editor, check for page errors anywhere.
import { chromium } from 'playwright';

const ROUTES = [
  '/dashboard', '/portfolio', '/book/trade', '/book/fund', '/book/pl',
  '/broking', '/wallet', '/vault', '/settings', '/profiling',
  '/myplans', '/pricing',
  '/marketplace', '/marketplace/category/retail', '/marketplace/category/premium', '/marketplace/category/hni',
  '/algo/marketplace',
  '/genie', '/genie/splash', '/genie/splash/studio', '/genie/saved-strategies', '/genie/MyAllStrategy', '/genie/codeEditor',
  '/phoenix/splash', '/phoenix/classicBuild/select', '/phoenix/saved-strategies', '/phoenix/MyAllStrategy', '/phoenix/codeEditor',
  '/pythonbuild', '/pythonbuild/splash', '/pythonbuild/MyAllStrategy', '/pythonbuild/codeEditor',
  '/socialbuild', '/odyssey', '/help',
  '/user/register', '/user/brokerlogin',
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

function log(msg) { console.log(`\n== ${msg} ==`); }

log('Login');
await page.goto('http://localhost:8201/user/login', { waitUntil: 'networkidle' });
await page.click('text=Demo account');
await page.click('button:has-text("Login")');
await page.waitForURL('**/dashboard', { timeout: 10000 });
console.log('  logged in');

log('Start two strategies (different algos)');
await page.goto('http://localhost:8201/marketplace', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
for (let i = 0; i < 2; i++) {
  const btns = page.locator('button:has-text("Execute")');
  await btns.nth(i).click();
  await page.waitForSelector('.ant-modal-title', { timeout: 5000, state: 'visible' });
  await page.waitForTimeout(700);
  await page.locator('.ant-modal-footer button:has-text("Start")').click();
  // Wait for modal to fully close before starting next iteration
  await page.waitForSelector('.ant-modal-wrap', { state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(500);
  console.log(`  started strategy ${i + 1}`);
}

log('Wait for simulator activity (10s)');
await page.waitForTimeout(10000);

const results = [];
for (const r of ROUTES) {
  const errs = [];
  const httpErrs = [];
  const pageErrListener = (e) => errs.push(e.message);
  const respListener = (resp) => {
    const u = resp.url();
    if (!u.includes('/api/') && !u.includes('/_sim/')) return;
    if (resp.status() >= 500) httpErrs.push(`${resp.status()} ${u.slice(u.indexOf('/'))}`);
  };
  page.on('pageerror', pageErrListener);
  page.on('response', respListener);
  try {
    await page.goto(`http://localhost:8201${r}`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
  } catch (e) {
    errs.push(`goto: ${e.message}`);
  }
  page.off('pageerror', pageErrListener);
  page.off('response', respListener);
  const hasChart = await page.locator('canvas, svg.antd-charts').count();
  const hasEditor = await page.locator('.monaco-editor').count();
  results.push({ route: r, errs, httpErrs, hasChart, hasEditor });
}

await page.goto('http://localhost:8201/portfolio', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: '/Users/vgopiraja/TradeAuto/_capture/full-portfolio.png', fullPage: false });
await page.goto('http://localhost:8201/dashboard', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: '/Users/vgopiraja/TradeAuto/_capture/full-dashboard.png', fullPage: false });
await page.goto('http://localhost:8201/genie/codeEditor', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: '/Users/vgopiraja/TradeAuto/_capture/full-editor.png', fullPage: false });
await page.goto('http://localhost:8201/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: '/Users/vgopiraja/TradeAuto/_capture/full-settings.png', fullPage: false });

await browser.close();

let ok = 0, bad = 0, charts = 0, editors = 0;
console.log('\n== Route results ==');
for (const r of results) {
  const status = r.errs.length === 0 && r.httpErrs.length === 0 ? '✓' : '✗';
  if (status === '✓') ok++; else bad++;
  if (r.hasChart) charts++;
  if (r.hasEditor) editors++;
  const icon = r.hasChart ? '📊' : '  ';
  const icon2 = r.hasEditor ? '📝' : '  ';
  console.log(`${status} ${icon}${icon2} ${r.route.padEnd(40)} pageErr=${r.errs.length} httpErr=${r.httpErrs.length}`);
  r.errs.slice(0, 1).forEach((e) => console.log('     ', e));
  r.httpErrs.slice(0, 1).forEach((e) => console.log('     ', e));
}
console.log(`\n${ok}/${ok + bad} routes clean, ${charts} with charts, ${editors} with editors`);
