// The captains' clip check: no card of a puppet cuts into another, standing, walking, turning or at the helm.
// Runs tools/qa/crew-clips.ts in the dev build (npm run dev on port 5180) and lists every pair that does.
//   node tools/qa/crew-clips.mjs
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto('http://localhost:5180/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.game && window.game.frames > 2, null, { timeout: 90000 });
const reports = await page.evaluate(async () => (await import('/tools/qa/crew-clips.ts')).checkAll());
await browser.close();
let total = 0;
for (const r of reports) {
  console.log(`${r.captain}: ${r.cards} cards, ${r.clips.length ? `${r.clips.length} pair(s) cut into each other` : 'no clips'}`);
  for (const c of r.clips) console.log(`  ${c.pair}  (${c.pose}, ${c.points} points; deepest: ${c.at})`);
  total += r.clips.length;
}
console.log(`${total} clip(s)`);
process.exit(total ? 1 : 0);
