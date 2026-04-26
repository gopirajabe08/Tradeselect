import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:8000/user/login';
const out = process.argv[3] || '/Users/vgopiraja/TradeAuto/_capture/login-clone.png';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.screenshot({ path: out, fullPage: false });
console.log('Saved', out);
await browser.close();
