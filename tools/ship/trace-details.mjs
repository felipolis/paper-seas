// Traces the cut outline of every printed detail the ships carry (public/models/tex: gun ports, galleries, windows,
// doors, crests, scrolls, gratings, eyes, figureheads) into assets-src/models/ship-details.json, so the Blender build
// (tools/blender/build_ship.py) cuts each detail to its drawing and gives it its thickness along that edge.
//
//   node tools/ship/trace-details.mjs        (run by tools/ship/build-ships.sh)
//
// ship-details.json: { name: [{ outer, holes }] } of [a, b] points in 0..1 of the print (tools/art/outline.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../browser.mjs';
import { OUTLINE_GRID, alphaGrid, traceOutline } from '../art/outline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DETAILS = ['gallery', 'windows', 'cabin-door', 'gunport', 'scroll', 'crest', 'grating', 'eye', 'figurehead', 'figurehead-lion', 'figurehead-maiden', 'figurehead-serpent'];

const prints = DETAILS.map((name) => ({ name, url: `data:image/png;base64,${readFileSync(join(root, 'public/models/tex', `${name}.png`)).toString('base64')}` }));
const browser = await launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: alphaGrid.toString() });
const grids = await page.evaluate(async ({ prints, grid }) => {
  const out = {};
  for (const { name, url } of prints) {
    const img = new Image();
    img.src = url;
    await img.decode();
    out[name] = alphaGrid(img, img.width, img.height, grid);
  }
  return out;
}, { prints, grid: OUTLINE_GRID });
await browser.close();

const outlines = Object.fromEntries(Object.entries(grids).map(([name, g]) => [name, traceOutline(g)]));
writeFileSync(join(root, 'assets-src/models/ship-details.json'), JSON.stringify(outlines, null, 1));
for (const [name, o] of Object.entries(outlines)) console.log(name.padEnd(20), o.map((p) => `${p.outer.length} points, ${p.holes.length} holes`).join('; '));
