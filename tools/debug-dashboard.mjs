import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => {
  if (m.type() === 'error' || m.text().includes('ERR') || m.text().includes('Request')) {
    console.log('[console]', m.type(), m.text());
  }
});
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('response', r => {
  const url = r.url();
  if (url.includes('/api/')) console.log(`[http ${r.status()}]`, r.request().method(), url);
});

await page.goto('http://localhost:8201/user/login', { waitUntil: 'networkidle' });
await page.click('text=Demo account');
await page.click('button:has-text("Login")');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3000);

await browser.close();
