// Crops one card out of a generated sheet by hand (for a card the sprite cutter cannot separate from the white
// sheet, like a snow swatch), inside its ink frame, and adds it to the target folder's manifest.
//   node tools/art/crop-card.mjs <sheet.png> <out.png> <x0> <y0> <x1> <y1>   (fractions of the sheet)
import { launch } from '../browser.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
const [src, out, x0, y0, x1, y1] = process.argv.slice(2);
const b = await launch();
const p = await b.newPage();
const url = await p.evaluate(async ({ data, r }) => {
  const i = new Image();
  i.src = data;
  await i.decode();
  const c = document.createElement('canvas');
  const w = Math.round((r[2] - r[0]) * i.width);
  const h = Math.round((r[3] - r[1]) * i.height);
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(i, r[0] * i.width, r[1] * i.height, w, h, 0, 0, w, h);
  return { png: c.toDataURL('image/png'), w, h };
}, { data: `data:image/png;base64,${readFileSync(src).toString('base64')}`, r: [+x0, +y0, +x1, +y1] });
await b.close();
writeFileSync(out, Buffer.from(url.png.split(',')[1], 'base64'));
const mf = join(dirname(out), 'manifest.json');
const m = existsSync(mf) ? JSON.parse(readFileSync(mf, 'utf8')) : {};
m[basename(out, '.png')] = { w: url.w, h: url.h };
writeFileSync(mf, JSON.stringify(m, null, 1));
console.log(out, url.w, url.h);
