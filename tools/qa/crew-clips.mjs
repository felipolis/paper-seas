// The captains' clip check: no card of a puppet cuts into another, standing, walking, turning or at the helm.
// Runs tools/qa/crew-clips.ts in the dev build (npm run dev on port 5180) and lists every pair that does.
//   node tools/qa/crew-clips.mjs
import { launch, openGame } from '../browser.mjs';

const browser = await launch({ gpu: true });
// (an error in the page or its console fails the check as a clip does)
const errors = [];
const page = await openGame(browser, { onPageError: (m) => errors.push(m), onConsoleIssue: (m) => errors.push(m) });
const reports = await page.evaluate(async () => (await import('/tools/qa/crew-clips.ts')).checkAll());
await browser.close();
let total = 0;
for (const r of reports) {
  console.log(`${r.captain}: ${r.cards} cards, ${r.clips.length ? `${r.clips.length} pair(s) cut into each other` : 'no clips'}`);
  for (const c of r.clips) console.log(`  ${c.pair}  (${c.pose}, ${c.points} points; deepest: ${c.at})`);
  total += r.clips.length;
}
console.log(`${total} clip(s)`);
for (const e of errors) console.log(`error: ${e}`);
if (errors.length) console.log(`${errors.length} console error(s) or warning(s)`);
process.exit(total || errors.length ? 1 : 0);
