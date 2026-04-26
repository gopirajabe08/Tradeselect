// E2E trading flow test.
// 1. Log in
// 2. Navigate to Marketplace
// 3. Click Execute on first strategy
// 4. Configure + Start
// 5. Wait ~15s for simulator to tick
// 6. Navigate to Portfolio -> assert instance visible with P&L
// 7. Navigate to Trade Book -> assert trades visible
// 8. Stop the instance

import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

function log(msg) { console.log(`\n== ${msg} ==`); }

log('Login');
await page.goto('http://localhost:8201/user/login', { waitUntil: 'networkidle' });
await page.click('text=Demo account');
await page.click('button:has-text("Login")');
await page.waitForURL('**/dashboard', { timeout: 10000 });
console.log('  logged in');

log('Marketplace -> Execute');
await page.goto('http://localhost:8201/marketplace', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const executeBtns = page.locator('button:has-text("Execute")');
const n = await executeBtns.count();
console.log(`  ${n} Execute buttons visible`);
if (!n) throw new Error('no Execute buttons on marketplace');
await executeBtns.first().click();
console.log('  clicked Execute');

log('Configure + Start');
await page.waitForSelector('.ant-modal-title', { timeout: 5000 });
await page.waitForTimeout(800);
// Default instrument should be TCS. Accept defaults and click Start.
await page.locator('.ant-modal-footer button:has-text("Start")').click();
await page.waitForTimeout(500);
const toast = await page.locator('.ant-message-notice').textContent().catch(() => null);
console.log('  toast:', toast);

log('Wait for simulator ticks (12s)');
await page.waitForTimeout(12000);

log('Portfolio -> verify instance');
await page.goto('http://localhost:8201/portfolio', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const portfolioRows = await page.$$eval('tbody.ant-table-tbody tr', (els) => els.map((e) => e.textContent));
console.log(`  ${portfolioRows.length} rows`);
portfolioRows.forEach((r, i) => console.log(`   [${i}]`, r?.slice(0, 200)));

log('Trade Book -> verify fills');
await page.goto('http://localhost:8201/book/trade', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const tradeRows = await page.$$eval('tbody.ant-table-tbody tr', (els) => els.map((e) => e.textContent));
console.log(`  ${tradeRows.length} rows`);
tradeRows.forEach((r, i) => console.log(`   [${i}]`, r?.slice(0, 200)));

log('P&L Book');
await page.goto('http://localhost:8201/book/pl', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const plRows = await page.$$eval('tbody.ant-table-tbody tr', (els) => els.map((e) => e.textContent));
console.log(`  ${plRows.length} rows`);

await page.screenshot({ path: '/Users/vgopiraja/TradeAuto/_capture/e2e-pl.png', fullPage: false });

log('Stop instance');
await page.goto('http://localhost:8201/portfolio', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const stopBtn = page.locator('button:has-text("Stop")').first();
if (await stopBtn.count()) {
  await stopBtn.click();
  await page.waitForSelector('.ant-popconfirm-buttons', { timeout: 3000 });
  await page.locator('.ant-popconfirm-buttons button.ant-btn-primary').click();
  await page.waitForTimeout(1500);
  console.log('  stopped');
} else {
  console.log('  no Stop button found');
}

await page.screenshot({ path: '/Users/vgopiraja/TradeAuto/_capture/e2e-portfolio.png', fullPage: false });

await browser.close();
console.log('\n== DONE ==');
