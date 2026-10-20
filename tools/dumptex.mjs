// node tools/dumptex.mjs "<query>" outPrefix  -> writes <prefix>_albedo.png and <prefix>_maps.png
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const [query = '', out = 'tex'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:8123/index.html${query}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
for (const [i, name] of [[0, 'albedo'], [1, 'maps']]) {
  const url = await page.evaluate((i) => window.app.dumpTexture(i, 1024), i);
  fs.writeFileSync(`${out}_${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
await browser.close();
