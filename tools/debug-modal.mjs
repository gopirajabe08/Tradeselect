import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console-err]', m.text()); });
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/') || u.includes('/_sim/')) {
    console.log(`[http ${r.status()}] ${r.request().method()} ${u.slice(u.indexOf('/', 8))}`);
  }
});

await page.goto('http://localhost:8201/user/login', { waitUntil: 'networkidle' });
await page.click('text=Demo account');
await page.click('button:has-text("Login")');
await page.waitForURL('**/dashboard');
await page.goto('http://localhost:8201/marketplace', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.locator('button:has-text("Execute")').first().click();
await page.waitForSelector('.ant-modal-title', { timeout: 5000 });
await page.waitForTimeout(1500); // let modal fields populate
const modalHtml = await page.locator('.ant-modal-body').innerHTML();
console.log('modal body length:', modalHtml.length);
const startBtn = page.locator('.ant-modal-footer button:has-text("Start")');
console.log('start button count:', await startBtn.count());
await startBtn.click();
await page.waitForTimeout(3000);
const modalStillOpen = await page.locator('.ant-modal-wrap').isVisible();
console.log('modal still open after start:', modalStillOpen);

await browser.close();
