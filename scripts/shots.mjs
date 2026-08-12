import { chromium } from 'playwright';
import fs from 'node:fs';

const pages = process.argv[2]
  ? [process.argv[2]]
  : ['/', '/training', '/explorer', '/nutrition', '/recovery', '/labs', '/coach', '/connections'];

fs.mkdirSync('/tmp/shots', { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));

for (const p of pages) {
  await page.goto(`http://localhost:3000${p}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1400); // let recharts finish its entry animation
  const name = p === '/' ? 'dashboard' : p.slice(1).replace(/\//g, '-');
  await page.screenshot({ path: `/tmp/shots/${name}.png`, fullPage: true });
  console.log(`${p} → /tmp/shots/${name}.png`);
}

await browser.close();
if (problems.length) {
  console.log('\nBrowser problems:');
  for (const p of [...new Set(problems)]) console.log(' ', p);
} else {
  console.log('\nNo console errors.');
}
