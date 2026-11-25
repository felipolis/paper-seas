// Cuts the die-cut cards out of the generated sprite sheets (assets-src/flow) into trimmed PNGs with alpha
// (public/art/<name>.png) plus public/art/manifest.json.
//
//   node tools/art/cut-sprites.mjs [config]
//
// config defaults to tools/art/sprite-sheets.json (the game's sprites); tools/art/model-sheets.json holds the
// printed faces of the Blender-built models (cut to assets-src/models/faces, then packed into their atlas) and
// tools/art/ship-sheets.json the ship's printed wood and details (public/models/tex) and the terrain swatches the
// mountains are painted over (assets-src/models/swatches: that sheet's own "out").
//
// How: each sheet is processed in a headless Edge page (canvas); its background is taken away, the remaining connected
// components are the cards, sorted in reading order (rows by vertical overlap, then left to right) and named from the
// config (a null name skips a piece nobody uses). Cards go to the config's "out" folder, or to the sheet's own "out";
// the manifest ({ name: { w, h } }) of the cards in the config's folder is written there unless the config says
// "manifest": false.
//
// Per sheet: "key" (keyed sheets, below), "tears" (keyed: torn cloth, below), "merge" (pieces of one item cut apart
// by a narrow gap, below), "clean" ({ name: "open" }: a white-sheet piece whose cream opens onto the outside, see
// clearCream). Per config: "keepPale" (white-sheet pieces whose pale areas reach the edge by design, see peelFringe).
//
// For comparing a cut with and without its cleanup: ART_OUT=<dir> writes every card there instead, ART_NOCLEAN=1 skips
// the "clean" pass, ART_NOFRINGE=1 the fringe peel.
//
// Two kinds of sheet:
//   keyed ("key": "#rrggbb", per sheet or for the whole config; the game's sprites): the papercraft skill's sheets, on
//     one flat key colour that appears in no piece. Every pixel near the key is background, enclosed openings included,
//     and the key is un-mixed out of the soft cut. The pieces come with their cut edge printed (a thin dark line, a pale
//     highlight on the lit side), so nothing is added to it.
//   white (the models' and the ship's printed faces): the plain white background is flood-filled from the image border,
//     white pockets ringed by the generator's cream margin are background too, the margin is peeled and the pale fringe
//     trimmed; edge pixels get a soft alpha from their whiteness.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(readFileSync(resolve(root, process.argv[2] ?? 'tools/art/sprite-sheets.json'), 'utf8'));
const outDir = (folder) => process.env.ART_OUT ?? join(root, folder);
mkdirSync(outDir(config.out), { recursive: true });

const browser = await launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

const manifest = {};
for (const sheet of config.sheets) {
  const bytes = readFileSync(resolve(root, config.source, sheet.file));
  const mime = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
  const key = sheet.key ?? config.key;
  let sprites = await page.evaluate(cutSheet, { dataUrl, merge: sheet.merge ?? 0, key, tears: sheet.tears ?? 0 });
  // per-piece cleanup: plain cream the generator left as card stock where it opens onto the outside (an arch's opening)
  for (const [k, name] of sheet.names.entries()) {
    if (!name || !sprites[k] || (sheet.clean ?? {})[name] !== 'open' || process.env.ART_NOCLEAN) continue;
    sprites[k] = { ...sprites[k], png: await page.evaluate(clearCream, { dataUrl: sprites[k].png }) };
  }
  // last: peel the pale fringe the cut left outside the ink (cream specks in the notches of pines, palms...)
  for (const [k, name] of sheet.names.entries()) {
    if (key || !name || !sprites[k] || (config.keepPale ?? []).includes(name) || process.env.ART_NOFRINGE) continue;
    sprites[k] = { ...sprites[k], png: await page.evaluate(peelFringe, { dataUrl: sprites[k].png }) };
  }
  if (sprites.length !== sheet.names.length) {
    console.warn(`${sheet.file}: found ${sprites.length} cards, expected ${sheet.names.length}`);
  }
  const dir = outDir(sheet.out ?? config.out);
  mkdirSync(dir, { recursive: true });
  sprites.slice(0, sheet.names.length).forEach((s, i) => {
    const name = sheet.names[i];
    if (!name) return; // a piece of the sheet nobody uses (or a broken one)
    writeFileSync(join(dir, `${name}.png`), Buffer.from(s.png.split(',')[1], 'base64'));
    if (!sheet.out) manifest[name] = { w: s.w, h: s.h };
    console.log(`${sheet.file} -> ${name}.png ${s.w}x${s.h}`);
  });
}
if (config.manifest !== false) writeFileSync(join(outDir(config.out), 'manifest.json'), JSON.stringify(manifest, null, 1));
await browser.close();

/** Runs in the page. */
async function cutSheet({ dataUrl, merge, key, tears }) {
  /** white sheet: how bright and neutral a pixel is to be the sheet (whiteness, 255 = pure white). */
  const WHITE = 232;
  /** white sheet: how deep the cream die-cut margin is peeled, in px of a 1376-px-wide sheet. */
  const PEEL_DEPTH = 22;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const W = img.width;
  const H = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;

  const N = W * H;
  const BG = 1, FG = 2;
  const label = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  // ---- keyed sheet: the background is one flat key colour that appears in no piece, so every pixel near it is
  // background, enclosed pockets included; a pixel's opacity is how far its colour stands from the key. The key is the
  // mean of the image's outer frame where it is near the asked colour (the generator drifts, to a duller magenta say).
  // The soft edge round each cut is a mix of the cut line and the key (and the JPEG smears the key's hue into the line
  // itself): within SPILL px of the background, or anywhere the tint is strong (a speck of key in a narrow notch), a
  // pixel whose key tint shows (its strong channels standing above its weak ones by t, out of the key's own span) is
  // 1 - t / span opaque and takes the sheet's cut-line colour (the mean of the clean dark pixels at its cuts); the dark
  // line pixels at the cut are re-inked in that colour too, so every cut is one warm brown ----
  let keyed = null;
  if (key) {
    const asked = [1, 3, 5].map((k) => parseInt(key.slice(k, k + 2), 16));
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < N; i++) {
      const x = i % W, y = (i / W) | 0;
      if (x > 2 && y > 2 && x < W - 3 && y < H - 3) continue;
      const c = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
      if (Math.hypot(c[0] - asked[0], c[1] - asked[1], c[2] - asked[2]) > 160) continue;
      for (let k = 0; k < 3; k++) sum[k] += c[k];
      n++;
    }
    keyed = n ? sum.map((v) => v / n) : asked;
  }
  const opacity = new Float32Array(N).fill(1);
  if (keyed) {
    const [near, far] = [70, 170];
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(data[i * 4] - keyed[0], data[i * 4 + 1] - keyed[1], data[i * 4 + 2] - keyed[2]);
      opacity[i] = Math.min(1, Math.max(0, (d - near) / (far - near)));
      if (opacity[i] < 0.5) label[i] = BG;
    }
    const SPILL = 4;
    const hi = [0, 1, 2].filter((k) => keyed[k] > 128);
    const lo = [0, 1, 2].filter((k) => keyed[k] <= 128);
    const span = Math.min(...hi.map((k) => keyed[k])) - Math.max(0, ...lo.map((k) => keyed[k]));
    const tint = (i) => Math.min(...hi.map((k) => data[i * 4 + k])) - Math.max(0, ...lo.map((k) => data[i * 4 + k]));
    // torn cloth ("tears": a share of the key's span): slits too narrow to show the key cleanly come out as a dark mix
    // of cloth and key; any pixel whose key tint reaches the share is the key showing through a tear: a hole
    if (tears > 0) for (let i = 0; i < N; i++) if (tint(i) >= tears * span) [label[i], opacity[i]] = [BG, 0];
    const near4 = (i) => { const x = i % W; return [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < N - W ? i + W : -1]; };
    const ring = new Uint8Array(N).fill(255);
    const queue = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) if (label[i] === BG) { ring[i] = 0; queue[qt++] = i; }
    while (qh < qt) {
      const i = queue[qh++];
      if (ring[i] >= SPILL) continue;
      for (const j of near4(i)) if (j >= 0 && ring[j] === 255) { ring[j] = ring[i] + 1; queue[qt++] = j; }
    }
    const line = [0, 0, 0];
    let lineN = 0;
    for (let q = 0; q < qt; q++) {
      const i = queue[q];
      if (ring[i] === 0 || tint(i) > 0 || data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] > 330) continue;
      for (let k = 0; k < 3; k++) line[k] += data[i * 4 + k];
      lineN++;
    }
    // (mostly the skill's cut-line brown #4a2812, P.rim's: the measured line is lightened by its own soft edge and
    // reddened by the key's hue smeared into it)
    const lineColour = [74, 40, 18].map((v, k) => (lineN ? 0.3 * (line[k] / lineN) + 0.7 * v : v));
    const lineSum = lineColour[0] + lineColour[1] + lineColour[2];
    // a two-channel key (magenta) is a hue the prompt keeps out of every piece, so even a faint tint of it is the key's;
    // a one-channel key (green) is natural in leaves, so only a strong tint away from the cut is
    const STRONG = (hi.length === 2 ? 0.12 : 0.3) * span;
    for (let i = 0; i < N; i++) {
      if (label[i] === BG) continue;
      const t = tint(i);
      const sum = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2];
      const atCut = ring[i] <= SPILL;
      if (t > 0 && (atCut || t >= STRONG)) {
        opacity[i] = Math.min(opacity[i], Math.max(0.05, 1 - t / span));
        for (let k = 0; k < 3; k++) data[i * 4 + k] = lineColour[k];
      } else if (atCut && sum < 330) {
        // the dark cut line itself, re-inked in the one brown, keeping its own light and shade
        const lift = Math.min(1.6, Math.max(0.4, sum / lineSum));
        for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.min(255, lineColour[k] * lift);
      }
    }
  }
  // ---- white sheet: the background is near-white, low-saturation pixels connected to the border ----
  const whiteness = new Uint8Array(N); // 255 = pure white
  for (let i = 0; i < N; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    whiteness[i] = mx - mn < 18 ? mn : 0;
  }
  const pushBg = (i) => { if (label[i] === 0 && whiteness[i] >= WHITE) { label[i] = BG; stack[sp++] = i; } };
  if (!keyed) for (let x = 0; x < W; x++) { pushBg(x); pushBg((H - 1) * W + x); }
  if (!keyed) for (let y = 0; y < H; y++) { pushBg(y * W); pushBg(y * W + W - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % W;
    if (x > 0) pushBg(i - 1);
    if (x < W - 1) pushBg(i + 1);
    if (i >= W) pushBg(i - W);
    if (i < N - W) pushBg(i + W);
  }

  // colour of the sheet itself (flat white), measured on the border-connected background
  let bgN = 0, bgR = 0, bgG = 0, bgB = 0;
  for (let i = 0; i < N; i += 7) if (label[i] === BG) { bgN++; bgR += data[i * 4]; bgG += data[i * 4 + 1]; bgB += data[i * 4 + 2]; }
  bgR /= Math.max(1, bgN); bgG /= Math.max(1, bgN); bgB /= Math.max(1, bgN);

  // ---- enclosed background: white pockets the border flood cannot reach (between branches, under roots, inside
  // arches). Every such pocket on the sheet is ringed by the generator's cream margin, while a white area of the art
  // (a gull's body, a foam crest) is ringed by ink: a white pocket whose rim is mostly pale is background.
  if (!keyed) {
    const pale = (i) => {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      return Math.min(r, g, b) > 150 && (r + g + b) / 3 > 185;
    };
    const seen = new Uint8Array(N);
    const region = new Int32Array(N);
    for (let start = 0; start < N; start++) {
      if (label[start] !== 0 || seen[start] || whiteness[start] < WHITE) continue;
      // flood one white pocket
      let n = 0;
      sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      while (sp > 0) {
        const i = stack[--sp];
        region[n++] = i;
        const x = i % W;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < N - W ? i + W : -1];
        for (const j of nb) {
          if (j < 0 || seen[j] || label[j] !== 0 || whiteness[j] < WHITE) continue;
          seen[j] = 1;
          stack[sp++] = j;
        }
      }
      if (n < 6) continue;
      // the sheet is flat: a true pocket of background has the sheet's colour and almost no texture
      let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0;
      for (let k = 0; k < n; k++) {
        const i = region[k];
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        sr += r; sg += g; sb += b;
        const l = (r + g + b) / 3;
        sl += l; sl2 += l * l;
      }
      const mean = [sr / n, sg / n, sb / n];
      const std = Math.sqrt(Math.max(0, sl2 / n - (sl / n) ** 2));
      const off = Math.max(Math.abs(mean[0] - bgR), Math.abs(mean[1] - bgG), Math.abs(mean[2] - bgB));
      if (std > 6 || off > 12) continue;
      // inspect the rim just outside the pocket (2 px out)
      let rim = 0;
      let paleRim = 0;
      let creamRim = 0;
      for (let k = 0; k < n; k++) {
        const i = region[k];
        const x = i % W;
        for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const xx = x + dx;
          const j = i + dx + dy * W;
          if (xx < 0 || xx >= W || j < 0 || j >= N || seen[j]) continue;
          rim++;
          if (pale(j)) paleRim++;
          if (pale(j) && data[j * 4] - data[j * 4 + 2] > 12) creamRim++;
        }
      }
      // the generator's margin is warm cream; a white area of the art is ringed by ink and cool white
      if (rim > 0 && (creamRim / rim > 0.4 || (paleRim / rim > 0.55 && std < 3 && off < 6))) for (let k = 0; k < n; k++) label[region[k]] = BG;
    }
  }

  // ---- peel the cream die-cut margin: pale warm pixels reachable from the background within a few pixels ----
  // (the generator prints every card with an even cream border; the game's own cut edge replaces it, so the card
  // ends at its ink outline like a real hand-cut piece). The depth limit keeps cream areas inside the art safe.
  if (!keyed) {
    const limit = Math.max(4, Math.round((PEEL_DEPTH * W) / 1376));
    const depth = new Int16Array(N).fill(-1);
    const queue = new Int32Array(N);
    let qh = 0;
    let qt = 0;
    for (let i = 0; i < N; i++) if (label[i] === BG) { depth[i] = 0; queue[qt++] = i; }
    const cream = (i) => {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      // everything outside the ink outline that is not saturated art: the cream margin, and the grey shadow line the
      // generator draws around it. The dark ink stops the peel; the depth limit bounds any leak through a gap.
      const avg = (r + g + b) / 3;
      return (mn > 150 && mx - mn < 85 && avg > 185) || (mx - mn < 55 && avg > 118);
    };
    while (qh < qt) {
      const i = queue[qh++];
      const dd = depth[i];
      if (dd >= limit) continue;
      const x = i % W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < N - W ? i + W : -1];
      for (const j of nb) {
        if (j < 0 || depth[j] >= 0 || !cream(j)) continue;
        depth[j] = dd + 1;
        label[j] = BG;
        whiteness[j] = 255;
        queue[qt++] = j;
      }
    }
  }

  // ---- components of the foreground ----
  const comp = new Int32Array(N).fill(-1);
  const boxes = [];
  for (let start = 0; start < N; start++) {
    if (label[start] === BG || comp[start] >= 0) continue;
    const id = boxes.length;
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;
    sp = 0;
    stack[sp++] = start;
    comp[start] = id;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % W, y = (i / W) | 0;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < N - W ? i + W : -1];
      for (const j of nb) if (j >= 0 && label[j] !== BG && comp[j] < 0) { comp[j] = id; stack[sp++] = j; }
    }
    boxes.push({ id, minX, minY, maxX, maxY, area });
  }
  // drop leftover scraps that are almost all pale (a margin fragment that came loose: over PALE_MAX of it pale)
  const PALE_MAX = 0.8;
  const paleShare = (b) => {
    let pale = 0;
    let n = 0;
    for (let y = b.minY; y <= b.maxY; y += 2) for (let x = b.minX; x <= b.maxX; x += 2) {
      const i = y * W + x;
      if (comp[i] !== b.id) continue;
      n++;
      if (Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) > 185) pale++;
    }
    return pale / Math.max(1, n);
  };
  // (a keyed sheet has no loose margin, and its pale pieces, a gull or a sail, are pale all through; but a generator may
  // rule lines between its pieces: thin strips, or a lattice that fills little of its box)
  const ruled = (b) => Math.min(b.maxX - b.minX, b.maxY - b.minY) < 0.02 * Math.min(W, H) || b.area < 0.05 * (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1);
  const solid = (b) => (keyed ? !ruled(b) : paleShare(b) < PALE_MAX);
  let cards = boxes.filter((b) => b.area > N * 0.002 && solid(b));

  // ---- merge: pieces of one item cut apart by a narrow gap (shells and a starfish, a heap of stones) join into one
  // card when their boxes come within merge x the sheet's width of each other (the items themselves stand far apart)
  if (merge > 0) {
    const gap = merge * W;
    const near = (a, b) => a.minX - gap <= b.maxX && b.minX - gap <= a.maxX && a.minY - gap <= b.maxY && b.minY - gap <= a.maxY;
    const pieces = boxes.filter((b) => b.area > N * 0.0004 && solid(b));
    const parent = new Map(pieces.map((b) => [b.id, b.id]));
    const find = (id) => { while (parent.get(id) !== id) id = parent.get(id); return id; };
    for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) if (near(pieces[a], pieces[b])) parent.set(find(pieces[a].id), find(pieces[b].id));
    const groups = new Map();
    for (const b of pieces) {
      const r = find(b.id);
      const g = groups.get(r) ?? { id: r, minX: W, minY: H, maxX: 0, maxY: 0, area: 0 };
      g.minX = Math.min(g.minX, b.minX); g.minY = Math.min(g.minY, b.minY); g.maxX = Math.max(g.maxX, b.maxX); g.maxY = Math.max(g.maxY, b.maxY);
      g.area += b.area;
      groups.set(r, g);
    }
    const into = new Map(pieces.map((b) => [b.id, find(b.id)]));
    for (let i = 0; i < N; i++) if (comp[i] >= 0 && into.has(comp[i])) comp[i] = into.get(comp[i]);
    cards = [...groups.values()].filter((g) => g.area > N * 0.002);
  }

  // ---- reading order: rows by vertical overlap, then left to right ----
  cards.sort((a, b) => a.minY - b.minY);
  const rows = [];
  for (const c of cards) {
    const row = rows.find((r) => c.minY < r.maxY && c.maxY > r.minY && Math.min(c.maxY, r.maxY) - Math.max(c.minY, r.minY) > 0.3 * Math.min(c.maxY - c.minY, r.maxY - r.minY));
    if (row) { row.items.push(c); row.minY = Math.min(row.minY, c.minY); row.maxY = Math.max(row.maxY, c.maxY); }
    else rows.push({ minY: c.minY, maxY: c.maxY, items: [c] });
  }
  rows.sort((a, b) => a.minY - b.minY);
  const ordered = rows.flatMap((r) => r.items.sort((a, b) => a.minX - b.minX));

  // ---- export each card trimmed, with soft alpha on its outer edge ----
  return ordered.map((c) => {
    const pad = 2;
    const x0 = Math.max(0, c.minX - pad), y0 = Math.max(0, c.minY - pad);
    const x1 = Math.min(W - 1, c.maxX + pad), y1 = Math.min(H - 1, c.maxY + pad);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    const od = octx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y0 + y) * W + (x0 + x);
        const o = (y * w + x) * 4;
        if (comp[i] !== c.id) continue;
        if (keyed) {
          for (let k = 0; k < 3; k++) od.data[o + k] = data[i * 4 + k];
          od.data[o + 3] = Math.round(255 * opacity[i]);
          continue;
        }
        let a = 255;
        // soften the outermost pixels that are still whitish (anti-aliased cut against the white sheet)
        const gx = (y0 + y) * W + (x0 + x);
        const edge = (x0 + x > 0 && label[gx - 1] === BG) || (x0 + x < W - 1 && label[gx + 1] === BG) || (gx >= W && label[gx - W] === BG) || (gx < N - W && label[gx + W] === BG);
        if (edge && whiteness[i] > 200) a = Math.round(255 * Math.min(1, (255 - whiteness[i]) / 40));
        od.data[o] = data[i * 4];
        od.data[o + 1] = data[i * 4 + 1];
        od.data[o + 2] = data[i * 4 + 2];
        od.data[o + 3] = a;
      }
    }
    octx.putImageData(od, 0, 0);
    return { png: out.toDataURL('image/png'), w, h };
  });
}

/**
 * Runs in the page ("clean": "open"): makes transparent the flat cream (its margin's) the generator left inside a cut
 * piece where it opens onto the outside (an arch's opening), then feathers the new edges. The cream die-cut border round
 * the outside is never touched (it is not one flat patch reaching into the piece).
 */
async function clearCream({ dataUrl }) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const W = img.width;
  const H = img.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const im = ctx.getImageData(0, 0, W, H);
  const d = im.data;
  const N = W * H;
  const creamy = (i) => {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    if (d[i * 4 + 3] === 0) return false;
    return Math.min(r, g, b) > 170 && r - b > 4 && r - b < 60 && (r + g + b) / 3 > 195;
  };
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const region = new Int32Array(N);
  const minArea = Math.max(150, N * 0.004);
  for (let start = 0; start < N; start++) {
    if (seen[start] || !creamy(start)) continue;
    let n = 0;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let sl = 0, sl2 = 0, sr = 0, sg = 0, sb = 0;
    let touches = false;
    while (sp > 0) {
      const i = stack[--sp];
      region[n++] = i;
      const x = i % W;
      const y = (i / W) | 0;
      // touching the piece's outside: the sprite border, or a transparent neighbour
      if (x < 2 || y < 2 || x > W - 3 || y > H - 3) touches = true;
      else if (d[(i - 1) * 4 + 3] === 0 || d[(i + 1) * 4 + 3] === 0 || d[(i - W) * 4 + 3] === 0 || d[(i + W) * 4 + 3] === 0) touches = true;
      const l = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
      sl += l; sl2 += l * l;
      sr += d[i * 4]; sg += d[i * 4 + 1]; sb += d[i * 4 + 2];
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < N - W ? i + W : -1];
      for (const j of nb) if (j >= 0 && !seen[j] && creamy(j)) { seen[j] = 1; stack[sp++] = j; }
    }
    const std = Math.sqrt(Math.max(0, sl2 / n - (sl / n) ** 2));
    // the generator's margin has one colour signature: bright warm cream (measured: R 235-248, G 221-235, B 195-217).
    // Pale areas of the art itself do not match it: stone is darker (R < 226), bellies are green or yellow (G ~ R),
    // white plumage, foam and snow are cool (B close to R).
    const mr = sr / n, mg = sg / n, mb = sb / n;
    const marginColour = mr >= 232 && mg >= 216 && mr - mg >= 5 && mr - mg <= 24 && mr - mb >= 20 && mr - mb <= 52;
    if (n < minArea || std > 12 || !marginColour || !touches) continue;
    for (let k = 0; k < n; k++) d[region[k] * 4 + 3] = 0;
  }
  // feather: opaque pixels next to transparency get partial alpha if they are still pale
  for (let i = 0; i < N; i++) {
    if (d[i * 4 + 3] === 0) continue;
    const x = i % W;
    const edge = (x > 0 && d[(i - 1) * 4 + 3] === 0) || (x < W - 1 && d[(i + 1) * 4 + 3] === 0) || (i >= W && d[(i - W) * 4 + 3] === 0) || (i < N - W && d[(i + W) * 4 + 3] === 0);
    if (edge && Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) > 170) d[i * 4 + 3] = 90;
  }
  ctx.putImageData(im, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * Runs in the page: removes pale, unsaturated pixels that sit on the outside of a piece (reached from the
 * transparent area within a few pixels): the last cream and grey specks of the sheet caught in the notches of the
 * outline (between pine boughs, palm fronds, roots). The piece's ink outline stops it, so pale art inside the
 * outline is kept. White-sheet pieces whose pale areas reach the edge by design (a chapel's pale front, the ship's
 * gallery and windows) are listed in their config as keepPale and skip this pass. (Keyed sheets never need it.)
 */
async function peelFringe({ dataUrl }) {
  /** how many pixels in from the outside the peel reaches. */
  const DEPTH = 6;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const W = img.width;
  const H = img.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const im = ctx.getImageData(0, 0, W, H);
  const d = im.data;
  const N = W * H;
  const pale = (i) => {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    // cream, white or light grey; pale leaf greens (g well above r) are art, not paper
    return d[i * 4 + 3] > 0 && (r + g + b) / 3 > 160 && mx - mn < 75 && g <= r + 8;
  };
  const clear = (i) => i < 0 || i >= N || d[i * 4 + 3] < 40;
  for (let pass = 0; pass < DEPTH; pass++) {
    const hit = [];
    for (let i = 0; i < N; i++) {
      if (d[i * 4 + 3] < 40 || !pale(i)) continue;
      const x = i % W;
      const l = x > 0, r = x < W - 1;
      if ((l && clear(i - 1)) || (r && clear(i + 1)) || clear(i - W) || clear(i + W) ||
          (l && (clear(i - W - 1) || clear(i + W - 1))) || (r && (clear(i - W + 1) || clear(i + W + 1))) ||
          x === 0 || x === W - 1 || i < W || i >= N - W) hit.push(i);
    }
    if (!hit.length) break;
    for (const i of hit) d[i * 4 + 3] = 0;
  }
  ctx.putImageData(im, 0, 0);
  return c.toDataURL('image/png');
}
