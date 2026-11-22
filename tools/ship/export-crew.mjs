// Exports the captains' outfits from src/config/ships.ts to assets-src/models/crew.json for the Blender build of
// their paper puppets (tools/blender/build_crew.py).
//   node tools/ship/export-crew.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const { CAPTAINS } = await server.ssrLoadModule('/src/config/ships.ts');
await server.close();
writeFileSync(join(root, 'assets-src/models/crew.json'), JSON.stringify(CAPTAINS.map((c) => ({ id: c.id, ...c.outfit })), null, 1));
console.log(CAPTAINS.length, 'captains');
