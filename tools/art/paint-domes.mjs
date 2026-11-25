// Paints the printed faces of the mountains (after papertrails' dunes, hills and boulders): rounded dome cards and
// rounded stone slabs, each a band of colours (a pale cap hugging the top, wavy strata below, a darker foot), printed
// over the grain of a terrain swatch (assets-src/models/swatches, cut by cut-sprites with tools/art/ship-sheets.json),
// with the pale paper rim of a cut card along the outline.
//
//   node tools/art/paint-domes.mjs        (then pack-atlas and the Blender build)
//
// Writes assets-src/models/faces/dome-<kind>-<v>.png, stone-<kind>-<v>.png and assets-src/models/domes.json:
//   { <face>: { profile: [64 heights 0..1 across the face], aspect } }
// The Blender build (tools/blender/build_models.py) cuts each card to that same profile, so print and card agree.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const swatch = (n) => `data:image/png;base64,${readFileSync(join(root, 'assets-src/models/swatches', `${n}.png`)).toString('base64')}`;

// bands from the foot up; cap = the pale band along the top; grain = the swatch printed under the colour
const KINDS = {
  rock: { bands: ['#5d5850', '#77706a', '#918a80', '#a9a297'], cap: '#d6d0c4', strata: '#55504a', grain: 'rock', facets: 15, bumps: 0.035 },
  forest: { bands: ['#3f5a33', '#4f6c3c', '#62804a', '#7a9656'], cap: '#a5b46c', strata: '#3c5232', grain: 'canopy', facets: 0, bumps: 0.02 },
  snow: { bands: ['#5f5a54', '#77716b', '#8f8a84', '#aaa6a0'], cap: '#f5f2ea', strata: '#665c50', grain: 'rock', capGrain: 'snow', capDepth: 0.36, facets: 13, bumps: 0.03 },
  volcano: { bands: ['#2c2421', '#3a2f2b', '#4a3c36', '#5a4a42'], cap: '#c8542a', strata: '#241d1a', grain: 'lava', capDepth: 0.07, crater: true, facets: 11, bumps: 0.03 },
  sand: { bands: ['#b37a43', '#c98f52', '#dba766', '#e9bd7c'], cap: '#f6d79e', strata: '#a86f3c', grain: 'sandstone', facets: 0, bumps: 0.012 },
  hill: { bands: ['#6a6e35', '#828641', '#9b9d4c', '#b3b05a'], cap: '#d3c97a', strata: '#62652f', grain: 'grass', facets: 0, bumps: 0.015 },
};
// stone slabs for the outcrops round the foot of each mountain
const STONES = {
  rock: { bands: ['#5f5a52', '#79726a', '#938b80'], cap: '#cbc4b7', strata: '#524c45', grain: 'rock' },
  moss: { bands: ['#55603c', '#6a7449', '#808a57'], cap: '#a9b37a', strata: '#4a5434', grain: 'moss' },
  basalt: { bands: ['#2a2321', '#383030', '#4a403c'], cap: '#7a6a60', strata: '#1f1a18', grain: 'lava' },
  sandstone: { bands: ['#a8703f', '#c08650', '#d49e62'], cap: '#ecca8e', strata: '#94603a', grain: 'sandstone' },
};
// face variants: back (tall), middle, front (long and low)
const DOMES = [
  { v: 0, aspect: 0.86, h: 300, lo: [0.12, 0.22], e: [0.62, 0.8] },
  { v: 1, aspect: 1.05, h: 260, lo: [0.18, 0.3], e: [0.7, 0.95] },
  { v: 2, aspect: 2.6, h: 130, lo: [0.3, 0.45], e: [0.55, 0.75] },
];
const STONE_V = [
  { v: 0, aspect: 1.35, h: 130 },
  { v: 1, aspect: 1.05, h: 120 },
];

const jobs = [];
let seed = 11;
for (const [kind, k] of Object.entries(KINDS)) for (const d of DOMES.filter((v) => !(kind === 'snow' && v.v === 2))) jobs.push({ name: `dome-${kind}-${d.v}`, type: 'dome', k, d, seed: seed++ * 7919 });
for (const [kind, k] of Object.entries(STONES)) for (const d of STONE_V) jobs.push({ name: `stone-${kind}-${d.v}`, type: 'stone', k, d, seed: seed++ * 7919 });
const grains = Object.fromEntries([...new Set(jobs.flatMap((j) => [j.k.grain, j.k.capGrain].filter(Boolean)))].map((g) => [g, swatch(g)]));

const browser = await launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
const out = await page.evaluate(async ({ jobs, grains }) => {
  const img = {};
  for (const [n, url] of Object.entries(grains)) {
    const i = new Image();
    i.src = url;
    await i.decode();
    img[n] = i;
  }
  const rngOf = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const N = 64;
  const res = {};
  for (const job of jobs) {
    const rnd = rngOf(job.seed);
    const R = (a, b) => a + (b - a) * rnd();
    const { k, d } = job;
    const H = d.h;
    const W = Math.round(H * d.aspect);
    // ---- the outline: a height across the face (0..1), rounded, a little lopsided, gently bumped ----
    const prof = [];
    if (job.type === 'dome') {
      const lo = R(d.lo[0], d.lo[1]);
      const e = R(d.e[0], d.e[1]);
      const skew = R(0.8, 1.25);
      const ph = [R(0, 6.28), R(0, 6.28), R(0, 6.28)];
      for (let i = 0; i < N; i++) {
        const a = i / (N - 1);
        const w = Math.pow(a, skew);
        let t = Math.pow(Math.sin(Math.PI * w), e);
        t += k.bumps * (Math.sin(a * 9 + ph[0]) + 0.6 * Math.sin(a * 17 + ph[1]) + 0.35 * Math.sin(a * 31 + ph[2])) * Math.sin(Math.PI * a);
        prof.push(lo + (1 - lo) * Math.max(0, t));
      }
      if (k.crater && d.v < 2) {
        // a flat-topped cone with a notch: the crater rim
        const top = 0.84;
        for (let i = 0; i < N; i++) {
          const a = i / (N - 1);
          prof[i] = Math.min(prof[i], top) - Math.max(0, 0.07 - Math.abs(a - 0.5) * 0.5) * (prof[i] >= top ? 1 : 0);
        }
      }
    } else {
      // a rounded stone slab: steep sides, a broad rounded top
      const lo = R(0.3, 0.5);
      const e = R(0.32, 0.5);
      const skew = R(0.85, 1.2);
      for (let i = 0; i < N; i++) {
        const a = i / (N - 1);
        prof.push(lo + (1 - lo) * Math.pow(Math.sin(Math.PI * Math.pow(a, skew)), e));
      }
    }
    // faceted kinds: the curve cut as straight runs between a few points, like a scissored card
    const facets = job.type === 'stone' ? 9 : k.facets;
    if (facets) {
      const pts = [];
      for (let f = 0; f <= facets; f++) {
        const a = Math.min(1, Math.max(0, (f + (f > 0 && f < facets ? R(-0.3, 0.3) : 0)) / facets));
        pts.push([a, prof[Math.round(a * (N - 1))]]);
      }
      for (let i = 0; i < N; i++) {
        const a = i / (N - 1);
        let s = 0;
        while (s < pts.length - 2 && pts[s + 1][0] < a) s++;
        const [a0, b0] = pts[s];
        const [a1, b1] = pts[s + 1];
        prof[i] = b0 + (b1 - b0) * ((a - a0) / Math.max(1e-6, a1 - a0));
      }
    }
    const mx = Math.max(...prof);
    for (let i = 0; i < N; i++) prof[i] = (prof[i] / mx) * 0.985;
    const topAt = (a) => {
      const f = Math.min(N - 1, Math.max(0, a * (N - 1)));
      const i = Math.floor(f);
      const j = Math.min(N - 1, i + 1);
      return prof[i] + (prof[j] - prof[i]) * (f - i);
    };

    // ---- the print ----
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    const X = (a) => a * W;
    const Y = (b) => (1 - b) * H;
    const outline = () => {
      x.beginPath();
      x.moveTo(0, H);
      for (let i = 0; i < N; i++) x.lineTo(X(i / (N - 1)), Y(prof[i]));
      x.lineTo(W, H);
      x.closePath();
    };
    x.save();
    outline();
    x.clip();
    const bands = k.bands;
    // wavy strata lines, tilted a little, from the foot up
    const tilt = R(-0.18, 0.18);
    const lines = bands.map((_, i) => {
      const h = (i / bands.length) * 0.82;
      const ph = R(0, 6.28);
      const amp = R(0.025, 0.06);
      const fr = R(5, 9);
      return (a) => h + tilt * (a - 0.5) + amp * Math.sin(a * fr + ph) + amp * 0.4 * Math.sin(a * fr * 2.3 + ph * 1.7);
    });
    const fillAbove = (fn, colour) => {
      x.beginPath();
      x.moveTo(0, -2);
      for (let i = 0; i <= 48; i++) x.lineTo(X(i / 48), Y(fn(i / 48)));
      x.lineTo(W, -2);
      x.closePath();
      x.fillStyle = colour;
      x.fill();
    };
    x.fillStyle = bands[0];
    x.fillRect(0, 0, W, H);
    for (let i = 1; i < bands.length; i++) fillAbove(lines[i], bands[i]);
    // a darker stratum between two bands (papertrails' rocks have one running across each stone)
    const si = 1 + Math.floor(rnd() * (bands.length - 1));
    const sw = R(0.04, 0.07);
    {
      const f = lines[si];
      x.beginPath();
      for (let i = 0; i <= 48; i++) x.lineTo(X(i / 48), Y(f(i / 48) + sw));
      for (let i = 48; i >= 0; i--) x.lineTo(X(i / 48), Y(f(i / 48) - sw * 0.3));
      x.closePath();
      x.globalAlpha = 0.55;
      x.fillStyle = k.strata;
      x.fill();
      x.globalAlpha = 1;
    }
    // the cap: a pale band hugging the top of the outline, its lower edge wavy (snow lies deeper)
    const capD = k.capDepth ?? (job.type === 'stone' ? 0.16 : 0.13);
    const cph = R(0, 6.28);
    const wob = (a) => 0.45 * Math.sin(a * 11 + cph) + 0.25 * Math.sin(a * 23 + cph * 2);
    const snowline = R(0.52, 0.62);
    const capLine = k.capGrain
      ? (a) => snowline + 0.07 * wob(a) + 0.08 * Math.sin(a * 40 + cph) * Math.max(0, 0.5 - Math.abs(a - 0.5))
      : (a) => topAt(a) - capD * 0.8 * (1 + wob(a));
    fillAbove(capLine, k.cap);
    // the grain of the swatch printed through the colour (soft light, its own colour left out)
    const tile = (name, clipFn) => {
      const g = img[name];
      x.save();
      if (clipFn) {
        x.beginPath();
        x.moveTo(0, -2);
        for (let i = 0; i <= 48; i++) x.lineTo(X(i / 48), Y(clipFn(i / 48)));
        x.lineTo(W, -2);
        x.closePath();
        x.clip();
      }
      x.globalCompositeOperation = 'soft-light';
      x.filter = 'grayscale(1) contrast(1.35)';
      x.globalAlpha = 0.5;
      const m = 0.08;
      const sw = g.width * (1 - 2 * m);
      const sh = g.height * (1 - 2 * m);
      const sc = Math.max(W / sw, H / sh);
      x.drawImage(g, g.width * m, g.height * m, sw, sh, (W - sw * sc) / 2, (H - sh * sc) / 2, sw * sc, sh * sc);
      x.restore();
    };
    tile(k.grain);
    if (k.capGrain) tile(k.capGrain, capLine);
    // ink: a fine darker line under each band edge and under the cap
    x.lineWidth = Math.max(1, H * 0.006);
    x.globalAlpha = 0.35;
    for (let i = 1; i < bands.length; i++) {
      x.beginPath();
      for (let j = 0; j <= 48; j++) x.lineTo(X(j / 48), Y(lines[i](j / 48)));
      x.strokeStyle = bands[i - 1];
      x.stroke();
    }
    x.beginPath();
    for (let j = 0; j <= 64; j++) x.lineTo(X(j / 64), Y(capLine(j / 64)));
    x.strokeStyle = bands[bands.length - 1];
    x.globalAlpha = 0.5;
    x.stroke();
    x.globalAlpha = 1;
    // specks
    for (let i = 0; i < W * H * 0.0012; i++) {
      const a = rnd();
      const b = rnd() * topAt(a);
      x.fillStyle = rnd() < 0.7 ? 'rgba(40,28,18,0.35)' : 'rgba(255,248,230,0.35)';
      x.beginPath();
      x.arc(X(a), Y(b), R(0.6, 1.8), 0, 6.283);
      x.fill();
    }
    // light from the upper left, a soft shadow at the foot
    const lg = x.createLinearGradient(0, 0, W, H);
    lg.addColorStop(0, 'rgba(255,246,222,0.16)');
    lg.addColorStop(0.55, 'rgba(255,246,222,0)');
    lg.addColorStop(1, 'rgba(30,20,10,0.12)');
    x.fillStyle = lg;
    x.fillRect(0, 0, W, H);
    const fg = x.createLinearGradient(0, H, 0, H * 0.62);
    fg.addColorStop(0, 'rgba(30,20,10,0.32)');
    fg.addColorStop(1, 'rgba(30,20,10,0)');
    x.fillStyle = fg;
    x.fillRect(0, 0, W, H);
    // the pale paper rim of the cut, just inside the outline
    outline();
    x.lineWidth = Math.max(3, H * 0.03);
    x.strokeStyle = 'rgba(244,234,210,0.9)';
    x.stroke();
    x.lineWidth = Math.max(1, H * 0.006);
    x.strokeStyle = 'rgba(60,44,30,0.45)';
    x.stroke();
    x.restore();
    res[job.name] = { png: c.toDataURL('image/png'), profile: prof.map((v) => +v.toFixed(4)), aspect: d.aspect };
  }
  return res;
}, { jobs, grains });
await browser.close();

const meta = {};
for (const [name, r] of Object.entries(out)) {
  writeFileSync(join(root, 'assets-src/models/faces', `${name}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
  meta[name] = { aspect: r.aspect, profile: r.profile };
}
writeFileSync(join(root, 'assets-src/models/domes.json'), JSON.stringify(meta));
console.log(`${Object.keys(meta).length} faces`);
