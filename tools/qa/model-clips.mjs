// The constructions' clip check: no piece of a building, pier, bridge or height cuts into another while it unfolds.
// Runs tools/qa/model-clips.ts in the dev build (npm run dev on port 5180) and lists every pair that does.
//   node tools/qa/model-clips.mjs [model...]
import { chromium } from 'playwright-core';

const only = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto('http://localhost:5180/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.game && window.game.frames > 2, null, { timeout: 90000 });
const reports = await page.evaluate(async (only) => (await import('/tools/qa/model-clips.ts')).checkAll(only.length ? only : undefined), only);
await browser.close();
let total = 0;
for (const r of reports) {
  console.log(`${r.model}: ${r.pieces} pieces, ${r.clips.length ? `${r.clips.length} pair(s) cut into each other while it unfolds` : 'no clips while it unfolds'}; standing: ${r.standing.length ? r.standing.join(', ') : 'clear'}`);
  for (const c of r.clips) console.log(`  ${c.pair}  (at progress ${c.progress}, ${c.at.join(', ')})`);
  total += r.clips.length;
}
console.log(`${reports.length} models, ${total} clip(s)`);
process.exit(total ? 1 : 0);
