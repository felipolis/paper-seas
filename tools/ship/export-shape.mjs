// Samples each ship's hull from the game's own code (src/ship/hull-shape.ts on the ship's HullSpec in
// src/config/ships.ts) into assets-src/models/ship-shape-<id>.json, the single source of the shape for the Blender
// build (tools/blender/build_ship.py): stations from the keel to the rail, the deck spans, the masts, the stern
// lanterns, and the spec itself (castles, gun decks, wood, carvings). The paper model and the game's decks, masts and
// rigging always agree.
//
//   node tools/ship/export-shape.mjs [shipId]     (default: every ship)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const NT = 96; // stations along the hull

const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const { SHIP_TYPES } = await server.ssrLoadModule('/src/config/ships.ts');
const { hullShape } = await server.ssrLoadModule('/src/ship/hull-shape.ts');
const ids = process.argv[2] ? [process.argv[2]] : SHIP_TYPES.map((t) => t.id);
for (const id of ids) {
  const type = SHIP_TYPES.find((t) => t.id === id);
  const H = hullShape(type);
  const spec = type.hull;
  // rows: under the wale, the wale's two edges, the upper works up to the rail
  const rowsAt = (t) => {
    const top = H.sheer(t);
    const ys = [];
    for (let k = 0; k <= 7; k++) ys.push(-spec.draft + (spec.wale[0] + spec.draft) * (k / 7));
    ys.push(spec.wale[1]);
    for (let k = 1; k <= 8; k++) ys.push(spec.wale[1] + (top - spec.wale[1]) * (k / 8));
    return ys.map((y) => ({ y, halfBeam: H.halfBeamAt(t, y) }));
  };
  const stations = [];
  for (let i = 0; i <= NT; i++) {
    const t = i / NT;
    stations.push({ t, z: H.zOf(t), sheer: H.sheer(t), deck: H.deckHeightAt(t), plan: H.planHalfBeam(t), rows: rowsAt(t) });
  }
  const shape = {
    id,
    length: H.length,
    halfBeam: type.halfBeam,
    spec,
    stations,
    decks: H.deckSpans(),
    masts: H.masts.map((m) => ({ t: m.t, z: H.zOf(m.t), deckY: H.deckHeightAt(m.t), rig: m.rig })),
    lanterns: H.lanternSpots(),
  };
  mkdirSync(join(root, 'assets-src/models'), { recursive: true });
  writeFileSync(join(root, `assets-src/models/ship-shape-${id}.json`), JSON.stringify(shape));
  console.log(id, 'decks', shape.decks.map((d) => `${d.name}@${d.y}`).join(' '), 'top', H.hullTop().toFixed(2));
}
await server.close();
