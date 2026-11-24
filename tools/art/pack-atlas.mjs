// Packs the printed faces of the Blender-built models (assets-src/models/faces, cut by cut-sprites with
// tools/art/model-sheets.json) into one texture atlas, and measures each face for the Blender build.
//
//   node tools/art/pack-atlas.mjs
//
// Writes public/models/atlas-glow.png (the night glow of the lit windows and lantern glass) and
// public/models/atlas.png (sRGB, the faces with their alpha, each ringed by its own edge colour so mipmaps
// never pull in a neighbour) and assets-src/models/atlas.json:
//   size                [w, h] of the atlas
//   faces[name]         rect [x, y, w, h] in atlas pixels (top-left origin) and, for gable fronts (*-front),
//                       gable { wallL, wallR, eave, apex } in 0..1 of the face (x from the left, y from the bottom):
//                       the wall's vertical edges, the height where the gable starts and the apex height; every
//                       face also has spans { top, bottom }: [left, right] of its print near the top and bottom;
//                       a cut-out face (CUT_OUT) has outline: its print's traced outline (tools/art/outline.mjs)
//   patches[name]       rect of a plain swatch (kraft back, card core, wood) for unprinted surfaces
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../browser.mjs';
import { OUTLINE_GRID, alphaGrid, traceOutline } from './outline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const facesDir = join(root, 'assets-src/models/faces');
const SIZE = 2048;
const PAD = 8;
const PATCHES = {
  kraft: '#d8bf94', core: '#a8957c', wood: '#6a4428', stone: '#8f877a',
};

// printed swatches shared with the ship (public/models/tex) that the models print too
const EXTRA = { 'pier-plank': 'public/models/tex/plank-oak.png' };
// faces printed as a darker copy of another (name: [face, brightness]): the bridge's outer side card
const DERIVED = { 'pier-plank-dark': ['pier-plank', 0.8] };
// faces whose card is cut to the print's own outline (tools/art/outline.mjs), not to a rectangle or measured spans
const CUT_OUT = ['cottage-chimney', 'tavern-sign'];
const sources = [
  ...readdirSync(facesDir).filter((f) => f.endsWith('.png')).map((f) => ({ name: f.replace(/\.png$/, ''), file: join(facesDir, f) })),
  ...Object.entries(EXTRA).map(([name, file]) => ({ name, file: join(root, file) })),
].map(({ name, file }) => ({ name, url: `data:image/png;base64,${readFileSync(file).toString('base64')}` }));
const faces = [...sources, ...Object.entries(DERIVED).map(([name, [from, shade]]) => ({ name, url: sources.find((f) => f.name === from).url, shade }))];

const browser = await launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: alphaGrid.toString() });
const result = await page.evaluate(async ({ faces, SIZE, PAD, PATCHES, CUT_OUT, OUTLINE_GRID }) => {
  const imgs = await Promise.all(faces.map(async (f) => {
    const i = new Image();
    i.src = f.url;
    await i.decode();
    if (!f.shade) return { name: f.name, img: i, w: i.width, h: i.height };
    const d = document.createElement('canvas');
    d.width = i.width;
    d.height = i.height;
    const dc = d.getContext('2d');
    dc.filter = `brightness(${f.shade})`;
    dc.drawImage(i, 0, 0);
    return { name: f.name, img: d, w: i.width, h: i.height };
  }));
  // shelf packing, tallest first; the faces are drawn as large as the atlas allows (scaled down only as far as needed:
  // every measure taken from a face is a share of it, so the build does not depend on its size in pixels)
  const pack = (scale) => {
    const items = [...imgs.map((f) => ({ ...f, w: Math.round(f.w * scale), h: Math.round(f.h * scale) })), ...Object.keys(PATCHES).map((name) => ({ name, patch: true, w: 32, h: 32 }))];
    items.sort((a, b) => b.h - a.h);
    let x = PAD;
    let y = PAD;
    let shelf = 0;
    for (const it of items) {
      if (x + it.w + PAD > SIZE) {
        x = PAD;
        y += shelf + PAD * 2;
        shelf = 0;
      }
      it.x = x;
      it.y = y;
      x += it.w + PAD * 2;
      shelf = Math.max(shelf, it.h);
    }
    return y + shelf + PAD <= SIZE ? items : null;
  };
  let scale = 1;
  let items = pack(scale);
  while (!items && scale > 0.3) items = pack((scale -= 0.02));
  if (!items) throw new Error('atlas full');
  // (each face resampled to its packed size once, so every draw below is at 1:1)
  for (const it of items) {
    if (it.patch || (it.w === it.img.width && it.h === it.img.height)) continue;
    const r = document.createElement('canvas');
    r.width = it.w;
    r.height = it.h;
    const rc = r.getContext('2d');
    rc.imageSmoothingQuality = 'high';
    rc.drawImage(it.img, 0, 0, it.w, it.h);
    it.img = r;
  }
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const out = { size: [SIZE, SIZE], faces: {}, patches: {} };
  for (const it of items) {
    if (it.patch) {
      ctx.fillStyle = PATCHES[it.name];
      ctx.fillRect(it.x - PAD / 2, it.y - PAD / 2, it.w + PAD, it.h + PAD);
      out.patches[it.name] = [it.x, it.y, it.w, it.h];
      continue;
    }
    // bleed: the face drawn slightly offset in every direction underneath, then the face itself on top, then the
    // alpha restored to the face's own (so the colour runs on past the cut, the cut stays where it is)
    const t = document.createElement('canvas');
    t.width = it.w + PAD * 2;
    t.height = it.h + PAD * 2;
    const tc = t.getContext('2d', { willReadFrequently: true });
    for (let r = PAD; r >= 1; r--) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) tc.drawImage(it.img, PAD + dx, PAD + dy);
    tc.drawImage(it.img, PAD, PAD);
    const bleed = tc.getImageData(0, 0, t.width, t.height);
    const own = document.createElement('canvas');
    own.width = t.width;
    own.height = t.height;
    const oc = own.getContext('2d', { willReadFrequently: true });
    oc.drawImage(it.img, PAD, PAD);
    const alpha = oc.getImageData(0, 0, t.width, t.height).data;
    for (let i = 0; i < bleed.data.length; i += 4) bleed.data[i + 3] = alpha[i + 3];
    // straight (non-premultiplied) colour must survive under alpha 0: write through a WebGL-free path, i.e. keep the
    // colour by giving transparent pixels alpha 1 (invisible at alphaTest 0.5, but their colour is kept by the PNG)
    for (let i = 0; i < bleed.data.length; i += 4) if (bleed.data[i + 3] === 0) bleed.data[i + 3] = 1;
    ctx.putImageData(bleed, it.x - PAD, it.y - PAD);
    const face = { rect: [it.x, it.y, it.w, it.h] };
    face.spans = measureSpans(alpha, t.width, it.w, it.h, PAD);
    if (it.name.endsWith('-front')) face.gable = measureGable(alpha, t.width, it.w, it.h, PAD);
    if (CUT_OUT.includes(it.name)) face.alphaGrid = alphaGrid(it.img, it.w, it.h, OUTLINE_GRID);
    out.faces[it.name] = face;
  }
  out.png = c.toDataURL('image/png');
  // the night glow mask: the lit windows of the walls and the lantern glass only (thatch and gold paint are warm and
  // bright too, so the mask is only taken inside the faces that have lights)
  const g = document.createElement('canvas');
  g.width = g.height = SIZE;
  const gc = g.getContext('2d');
  gc.fillStyle = '#000';
  gc.fillRect(0, 0, SIZE, SIZE);
  const src = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const mask = gc.getImageData(0, 0, SIZE, SIZE);
  for (const it of items) {
    const lava = /^dome-volcano-/.test(it.name);
    if (it.patch || (!lava && (!/-(front|side|tower|glass|door)$/.test(it.name) || /^(fort|hut|warehouse)-/.test(it.name)))) continue;
    for (let y = it.y; y < it.y + it.h; y++) {
      for (let x = it.x; x < it.x + it.w; x++) {
        const i = (y * SIZE + x) * 4;
        const r = src[i], gg = src[i + 1], b = src[i + 2];
        // (the volcano's lava rim: hot orange, not window yellow)
        const warm = lava ? r > 170 && r - b > 110 && r - gg > 60 && src[i + 3] > 128 : r > 225 && gg > 170 && b < 160 && r - b > 95 && gg - b > 55 && src[i + 3] > 128;
        if (!warm) continue;
        const v = Math.min(255, (r + gg) / 2);
        mask.data[i] = v;
        mask.data[i + 1] = v * 0.85;
        mask.data[i + 2] = v * 0.6;
      }
    }
  }
  gc.putImageData(mask, 0, 0);
  out.glow = g.toDataURL('image/png');
  return out;

  /** Left / right edge (0..1) of the opaque print near the top and near the bottom (tapered faces). */
  function measureSpans(a, stride, w, h, pad) {
    const at = (row) => {
      let l = -1;
      let r = -1;
      for (let i = 0; i < w; i++) {
        if (a[((row + pad) * stride + i + pad) * 4 + 3] > 128) {
          if (l < 0) l = i;
          r = i;
        }
      }
      return [l / w, r / w];
    };
    return { top: at(Math.round(h * 0.04)), bottom: at(Math.round(h * 0.96)) };
  }

  /** Wall edges, eave and apex of a house-shaped (pentagon) face, from its alpha. */
  function measureGable(a, stride, w, h, pad) {
    const span = (row) => {
      let l = -1;
      let r = -1;
      for (let i = 0; i < w; i++) {
        if (a[((row + pad) * stride + i + pad) * 4 + 3] > 128) {
          if (l < 0) l = i;
          r = i;
        }
      }
      return [l, r];
    };
    // the wall: the median span of the lower third
    const ls = [];
    const rs = [];
    for (let row = Math.floor(h * 0.67); row < h - 2; row++) {
      const [l, r] = span(row);
      if (l >= 0) {
        ls.push(l);
        rs.push(r);
      }
    }
    ls.sort((p, q) => p - q);
    rs.sort((p, q) => p - q);
    const wl = ls[ls.length >> 1];
    const wr = rs[rs.length >> 1];
    const ww = wr - wl;
    // eave: going down from the top, the first row whose span reaches (almost) the full wall width
    let eave = h - 1;
    for (let row = 0; row < h; row++) {
      const [l, r] = span(row);
      if (l >= 0 && r - l >= ww * 0.96) {
        eave = row;
        break;
      }
    }
    let apex = 0;
    for (let row = 0; row < h; row++) {
      const [l] = span(row);
      if (l >= 0) {
        apex = row;
        break;
      }
    }
    return { wallL: wl / w, wallR: wr / w, eave: 1 - eave / h, apex: 1 - apex / h };
  }
}, { faces, SIZE, PAD, PATCHES, CUT_OUT, OUTLINE_GRID });
await browser.close();

mkdirSync(join(root, 'public/models'), { recursive: true });
writeFileSync(join(root, 'public/models/atlas.png'), Buffer.from(result.png.split(',')[1], 'base64'));
writeFileSync(join(root, 'public/models/atlas-glow.png'), Buffer.from(result.glow.split(',')[1], 'base64'));
delete result.glow;
delete result.png;
for (const f of Object.values(result.faces)) {
  if (!f.alphaGrid) continue;
  f.outline = traceOutline(f.alphaGrid);
  delete f.alphaGrid;
}
writeFileSync(join(root, 'assets-src/models/atlas.json'), JSON.stringify(result, null, 1));
for (const [n, f] of Object.entries(result.faces)) console.log(n.padEnd(18), f.rect.join(','), f.gable ? JSON.stringify(f.gable, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)) : '');

