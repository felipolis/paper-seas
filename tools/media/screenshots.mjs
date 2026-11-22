// The README's screenshots (docs/media): plays the dev build headless and photographs a few scenes of one world.
//
//   npm run dev                                  (in another terminal)
//   node tools/media/screenshots.mjs [scene...]  e.g. node tools/media/screenshots.mjs hero night
//
// Every scene is seed 865510: the ship held still with all sails set in open water just below the place it looks at
// (mode 'ship'), or the captain ashore there (mode 'walk'), at a camera framing (dist) and a clock hour; the HUD is
// hidden, and the chart or the shipyard opened over the scene when it asks for them (ui).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.SHOT_URL ?? 'http://localhost:5180/';
const SEED = '865510';
const out = join(dirname(fileURLToPath(import.meta.url)), '../../docs/media');
const SCENES = [
  { name: 'hero', mode: 'ship', at: [-55, -82], dist: 19, hour: 16.5 },
  { name: 'market', mode: 'walk', at: [-47.8, -382.1], dist: 14, hour: 11 },
  { name: 'pine-stream', mode: 'walk', at: [117.5, 93], dist: 13, hour: 11 },
  { name: 'meadow', mode: 'walk', at: [-60, -122], dist: 13, hour: 10 },
  { name: 'jungle', mode: 'walk', at: [-89, -116], dist: 13, hour: 9.5 },
  { name: 'night', mode: 'walk', at: [-49, -70], dist: 13, hour: 22 },
  { name: 'port', mode: 'ship', at: [-115.7, 10.4], dist: 16, hour: 15 },
  // (the chart: a round sailed first, so it has lands to show)
  { name: 'chart', mode: 'ship', at: [-55, -82], dist: 19, hour: 11, ui: 'chart', tour: [[-44, -60], [-30, -95], [-61, -133], [-99, -124], [-89, -116], [-131, 9], [-115, 10], [-70, -30], [-20, -60], [-55, -82]] },
  { name: 'shipyard', mode: 'ship', at: [-55, -82], dist: 19, hour: 11, ui: 'shipyard' },
];
const only = process.argv.slice(2);

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
for (const scene of SCENES.filter((s) => !only.length || only.includes(s.name))) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript((seed) => localStorage.setItem('paper-seas:seed', seed), SEED);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.game && window.game.frames > 2, null, { timeout: 90000 });
  await page.evaluate(stage, scene);
  // (the chart and the shipyard open on CSS transitions, in real time)
  if (scene.ui) await page.waitForTimeout(3000);
  await page.addStyleTag({ content: '.hud { display: none !important; }' });
  await page.screenshot({ path: join(out, `${scene.name}.jpg`), type: 'jpeg', quality: 88 });
  console.log(`docs/media/${scene.name}.jpg`);
  await page.close();
}
await browser.close();

/** Runs in the page (window.game is the dev build's handle): sets the scene up and lets it stand. */
function stage(sc) {
  const g = window.game;
  g.stop();
  const L = g.world.land;
  const s = g.ship.physics;
  const [tx, tz] = sc.at;
  // open water 1.8-3.5 off the shore, below the place on screen
  let spot = null;
  for (let r = 1; r < 90 && !spot; r += 0.5) {
    for (let a = 0; a < 64; a++) {
      const x = tx + Math.cos((a / 64) * 6.283) * r;
      const z = tz + Math.sin((a / 64) * 6.283) * r;
      if (z < tz && L.distance(x, z) > 1.8 && L.distance(x, z) < 3.5) { spot = [x, z]; break; }
    }
  }
  const hold = () => { s.x = spot[0]; s.z = spot[1]; s.vx = s.vz = 0; };
  for (const [px, pz] of sc.tour ?? []) {
    s.x = px; s.z = pz;
    for (let i = 0; i < 40; i++) g.step(1 / 60);
  }
  hold();
  g.view.initialised = false;
  if (sc.mode === 'ship') {
    g.ship.sailIndex = 2;
    g.ship.model.setSails(g.ship.sailLevel);
    g.world.prime(s.x, s.z);
  } else {
    g.world.prime(tx, tz);
    g.walker.land(tx, tz, g.walkWorld);
  }
  g.distanceMap.prime(s.x, s.z);
  for (let i = 0; i < 540; i++) {
    g.view.targetDistance = sc.dist;
    g.dayNight.hour = sc.hour;
    if (sc.mode === 'ship') hold();
    g.step(1 / 60);
  }
  if (sc.ui === 'chart') g.chart.toggle();
  if (sc.ui === 'shipyard') g.shipyard.show();
  if (sc.ui) g.start();
}
