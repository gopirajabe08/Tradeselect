import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SESSION = path.join(ROOT, '_capture', 'session.json');
const session = JSON.parse(await fs.readFile(SESSION, 'utf8'));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  storageState: session,
});
const page = await ctx.newPage();

const allReqs = [];
page.on('request', (r) => allReqs.push({ method: r.method(), url: r.url(), type: r.resourceType() }));

const resp = await page.goto('https://bullsai.io/dashboard', { waitUntil: 'networkidle', timeout: 45000 });
console.log('final URL:', page.url());
console.log('status:', resp?.status());
await new Promise(r => setTimeout(r, 3000));

console.log('\n== Resource types seen ==');
const byType = {};
for (const r of allReqs) byType[r.type] = (byType[r.type] || 0) + 1;
for (const [t, n] of Object.entries(byType)) console.log(`  ${t}: ${n}`);

console.log('\n== All xhr/fetch requests (any host) ==');
for (const r of allReqs.filter(r => r.type === 'xhr' || r.type === 'fetch')) {
  console.log(`  [${r.type}] ${r.method} ${r.url}`);
}

console.log('\n== Hosts seen in xhr/fetch ==');
const hosts = {};
for (const r of allReqs.filter(r => r.type === 'xhr' || r.type === 'fetch')) {
  try { const h = new URL(r.url).host; hosts[h] = (hosts[h] || 0) + 1; } catch {}
}
for (const [h, n] of Object.entries(hosts)) console.log(`  ${h}: ${n}`);

console.log('\n== Page title ==');
console.log(await page.title());

console.log('\n== Snippet of HTML (first 600 chars of body text) ==');
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600));
console.log(bodyText);

await browser.close();
