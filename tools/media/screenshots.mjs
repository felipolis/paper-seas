// The README's screenshots (docs/media): plays the dev build headless and photographs a few scenes of one world.
//
//   npm run dev                                  (in another terminal)
//   node tools/media/screenshots.mjs [scene...]  e.g. node tools/media/screenshots.mjs hero night
//
// Every scene is seed 865510: the ship held still with all sails set in open water just below the place it looks at
// (mode 'ship'), or the captain ashore there (mode 'walk'), at a camera framing (dist) and a clock hour; the HUD is
// hidden, and the chart or the shipyard opened over the scene when it asks for them (ui).
import { GAME_URL, launch } from '../browser.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const browser = await launch({ gpu: true });
for (const scene of SCENES.filter((s) => !only.length || only.includes(s.name))) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript((seed) => localStorage.setItem('paper-seas:seed', seed), SEED);
  await page.goto(GAME_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.game && window.game.frames > 2, null, { timeout: 90000 });
  await page.evaluate(stage, scene);
  // (the chart and the shipyard open on CSS transitions, in real time: the chart has settled and no transition runs)
  if (scene.ui === 'chart') await page.waitForFunction(() => window.game.chartSettled);
  if (scene.ui) await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await page.addStyleTag({ content: '.hud, #loading { display: none !important; }' });
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
  // open water 1.8-3.5 off the shore, below the place on screen, and clear of every pier (the ship is held there, past
  // her collisions): the candidates in order, the first whose surroundings, once built, have no pier within reach
  const candidates = [];
  for (let r = 1; r < 90 && candidates.length < 40; r += 0.5) {
    for (let a = 0; a < 64; a++) {
      const x = tx + Math.cos((a / 64) * 6.283) * r;
      const z = tz + Math.sin((a / 64) * 6.283) * r;
      if (z < tz && L.distance(x, z) > 1.8 && L.distance(x, z) < 3.5) { candidates.push([x, z]); break; }
    }
  }
  const HULL = 1.6;
  let spot = candidates[0];
  for (const [x, z] of candidates) {
    g.moveShip(x, z);
    for (let i = 0; i < 30; i++) g.step(1 / 60);
    if (!g.world.terrain.pierPush(x, z, HULL)) { spot = [x, z]; break; }
  }
  const hold = () => { s.x = spot[0]; s.z = spot[1]; s.vx = s.vz = 0; };
  // (simulated time, not waiting: TOUR_STEPS per point of a tour, STAND_STEPS for the place to rise and settle,
  // papertrails' rise of a cell taking about 2 s after its ripple delay)
  const TOUR_STEPS = 40;
  const STAND_STEPS = 540;
  for (const [px, pz] of sc.tour ?? []) {
    g.moveShip(px, pz);
    for (let i = 0; i < TOUR_STEPS; i++) g.step(1 / 60);
  }
  g.moveShip(spot[0], spot[1]);
  if (sc.mode === 'ship') g.ship.setSailSetting(2);
  else g.landCaptain(tx, tz);
  for (let i = 0; i < STAND_STEPS; i++) {
    g.view.targetDistance = sc.dist;
    g.dayNight.hour = sc.hour;
    if (sc.mode === 'ship') hold();
    g.step(1 / 60);
  }
  if (sc.ui === 'chart') g.openChart();
  if (sc.ui === 'shipyard') g.shipyard.show();
  if (sc.ui) g.start();
}
