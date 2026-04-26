import { chromium } from 'playwright';

const routes = ['/dashboard', '/portfolio', '/book/trade', '/book/pl', '/marketplace', '/phoenix/splash', '/wallet', '/myplans'];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto('http://localhost:8201/user/login', { waitUntil: 'networkidle' });
await page.click('text=Demo account');
await page.click('button:has-text("Login")');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);

for (const r of routes) {
  await page.goto(`http://localhost:8201${r}`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(500);
  const slug = r.replace(/\//g, '_').replace(/^_/, '');
  await page.screenshot({ path: `/Users/vgopiraja/TradeAuto/_capture/clone-${slug}.png`, fullPage: false });
  console.log('shot', slug);
}
await browser.close();
