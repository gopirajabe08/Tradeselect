import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));

// Seed auth
await page.goto('http://localhost:8201/user/login', { waitUntil: 'networkidle' });
await page.click('text=Demo account');
await page.waitForTimeout(200);
await page.click('button:has-text("Login")');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);
console.log('URL after login:', page.url());

// Snap dashboard
await page.screenshot({ path: '/Users/vgopiraja/TradeAuto/_capture/dashboard-clone.png', fullPage: false });
console.log('Saved dashboard-clone.png');

// Report visible cards
const visibleTitles = await page.$$eval('.ant-card-head-title, [class*="ant-card"] strong', els => els.map(e => e.textContent?.trim()).filter(Boolean));
console.log('Card/sections visible:', visibleTitles);

// Check for errors on page
const errorBanners = await page.$$eval('.ant-alert-error', els => els.map(e => e.textContent?.trim()).filter(Boolean));
if (errorBanners.length) console.log('ERRORS ON PAGE:', errorBanners);
else console.log('No error banners ✓');

await browser.close();
