// The constructions' clip check: no piece of a building, pier, bridge or height cuts into another while it unfolds.
// Runs tools/qa/model-clips.ts in the dev build (npm run dev on port 5180) and lists every pair that does.
//   node tools/qa/model-clips.mjs [model...]
import { launch, openGame } from '../browser.mjs';

const only = process.argv.slice(2);
const browser = await launch({ gpu: true });
// (an error in the page or its console fails the check as a clip does)
const errors = [];
const page = await openGame(browser, { onPageError: (m) => errors.push(m), onConsoleIssue: (m) => errors.push(m) });
const reports = await page.evaluate(async (only) => (await import('/tools/qa/model-clips.ts')).checkAll(only.length ? only : undefined), only);
await browser.close();
let total = 0;
for (const r of reports) {
  console.log(`${r.model}: ${r.pieces} pieces, ${r.clips.length ? `${r.clips.length} pair(s) cut into each other while it unfolds` : 'no clips while it unfolds'}; standing: ${r.standing.length ? r.standing.join(', ') : 'clear'}`);
  for (const c of r.clips) console.log(`  ${c.pair}  (at progress ${c.progress}, ${c.at.join(', ')})`);
  total += r.clips.length;
}
console.log(`${reports.length} models, ${total} clip(s)`);
for (const e of errors) console.log(`error: ${e}`);
if (errors.length) console.log(`${errors.length} console error(s) or warning(s)`);
process.exit(total || errors.length ? 1 : 0);
