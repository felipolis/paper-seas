// World QA: plays the game headless against the dev server and checks the world for the bugs a player would see.
//
//   npm run dev                          (in another terminal)
//   node tools/qa/world-qa.mjs [seeds]   e.g. node tools/qa/world-qa.mjs 1234,7,42
//
// For every seed it visits a few places (villages with their roads, the wild interior), puts the captain ashore,
// lets the land stand up, and checks:
//   holes      land points with no ground under them (a gap in the paper)
//   floating   standing cards and models whose base hangs over lower ground or water
//   wet        land cards standing in the sea; buildings with any corner of their base in the sea (every loaded one)
//   overlap    cards standing on a road, a lane or a stream; buildings overlapping each other
//   bridges    a road crossing a stream with no standing bridge
//   stuck      the captain unable to move in any direction (blocked ahead is fine; blocked all round is not)
//   roads      the captain unable to walk along a road
//   sea        more than MAX_LAND of the world is land (the open sea matters: there is more water than land)
// The checks run in the dev build's page (tools/qa/world-qa.ts). Prints every issue with its position and exits 1 if
// there are any.
import { launch, openGame } from '../browser.mjs';

const seeds = (process.argv[2] ?? '1234,7,42').split(',').map(Number);
const browser = await launch({ gpu: true });

let total = 0;
for (const seed of seeds) {
  const errors = [];
  const keep = (m) => errors.push(m);
  const page = await openGame(browser, { viewport: { width: 960, height: 600 }, seed, onPageError: keep, onConsoleIssue: keep });
  const report = await page.evaluate(async () => (await import('/tools/qa/world-qa.ts')).checkWorld());
  const issues = [...errors.map((e) => ({ kind: 'error', note: e })), ...report.issues];
  total += issues.length;
  console.log(`\nseed ${seed}: ${report.places} places, ${report.cards} cards, ${report.buildings} models, ${report.roads} roads checked`);
  const byKind = {};
  for (const i of issues) (byKind[i.kind] ??= []).push(i);
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`  ${kind}: ${list.length}`);
    for (const i of list.slice(0, 6)) console.log(`    ${i.note ?? ''} ${i.at ? `at ${i.at.map((v) => v.toFixed(1)).join(', ')}` : ''}`);
  }
  if (!issues.length) console.log('  no issues');
  await page.close();
}
await browser.close();
console.log(`\n${total} issue(s)`);
process.exit(total ? 1 : 0);

