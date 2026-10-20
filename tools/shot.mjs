// Headless screenshot helper:  node tools/shot.mjs "<query>" out.png [width height dpr]
// Expects a static server on http://localhost:8123 serving the repository root.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const [query = '', out = 'shot.png', w = '1024', h = '768', dpr = '1', wait = '0'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(`http://localhost:8123/index.html${query}`);
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
} catch (e) {
  logs.push('TIMEOUT waiting for __ready');
}
await page.waitForTimeout(+wait || 1500);
await page.screenshot({ path: out, timeout: 600000 });
console.log(logs.join('\n'));
await browser.close();
