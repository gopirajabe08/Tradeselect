import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => console.log('[console]', m.type(), m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));

console.log('== 1. Visit /dashboard (unauth) - should redirect to login ==');
await page.goto('http://localhost:8201/dashboard', { waitUntil: 'networkidle' });
console.log('URL after:', page.url());

console.log('\n== 2. Fill demo creds and submit ==');
await page.click('text=Demo account');
await page.waitForTimeout(300);
await page.click('button:has-text("Login")');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);
console.log('URL after login:', page.url());
await page.screenshot({ path: '/Users/vgopiraja/TradeAuto/_capture/post-login.png', fullPage: false });
console.log('Saved post-login.png');

console.log('\n== 3. Visit /portfolio (authed) - should not redirect ==');
await page.goto('http://localhost:8201/portfolio', { waitUntil: 'networkidle' });
console.log('URL after:', page.url());

await browser.close();
