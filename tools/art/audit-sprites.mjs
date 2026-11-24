// Audits the cut sprites for leftovers of the generator's white sheet and cream margin.
//
//   node tools/art/audit-sprites.mjs [out.png]
//
// For every sprite it measures the "pale rim": opaque pixels within 3 px of transparency that are near-white or
// cream. A clean cut ends at the ink outline, so the share should be small (light art such as foam, sails or gulls
// legitimately touches it a little). It also writes a contact sheet of every sprite on a dark magenta ground, where
// any white or cream residue stands out.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'public/art');
const out = process.argv[2] ?? join(root, 'assets-src/audit-contact.png');
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
await page.setContent('<html><body style="margin:0;background:#3a1030"></body></html>');
const sprites = files.map((f) => ({ name: f.replace('.png', ''), url: `data:image/png;base64,${readFileSync(join(dir, f)).toString('base64')}` }));

const report = await page.evaluate(async (list) => {
  const results = [];
  const cols = 10;
  const cell = 170;
  const sheet = document.createElement('canvas');
  sheet.width = cols * cell;
  sheet.height = Math.ceil(list.length / cols) * (cell + 18);
  const sctx = sheet.getContext('2d');
  sctx.fillStyle = '#3a1030';
  sctx.fillRect(0, 0, sheet.width, sheet.height);
  sctx.font = '12px sans-serif';
  for (let k = 0; k < list.length; k++) {
    const img = new Image();
    img.src = list[k].url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const W = c.width;
    const H = c.height;
    const alpha = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[(y * W + x) * 4 + 3]);
    let rim = 0;
    let pale = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (d[i + 3] < 128) continue;
        let edge = false;
        for (let r = 1; r <= 3 && !edge; r++) if (alpha(x - r, y) < 128 || alpha(x + r, y) < 128 || alpha(x, y - r) < 128 || alpha(x, y + r) < 128) edge = true;
        if (!edge) continue;
        rim++;
        const mn = Math.min(d[i], d[i + 1], d[i + 2]);
        if (mn > 200) pale++;
      }
    }
    results.push({ name: list[k].name, paleRim: +(pale / Math.max(1, rim)).toFixed(3) });
    const s = Math.min((cell - 10) / img.width, (cell - 10) / img.height);
    const cx = (k % cols) * cell;
    const cy = Math.floor(k / cols) * (cell + 18);
    sctx.drawImage(img, cx + (cell - img.width * s) / 2, cy + (cell - img.height * s) / 2, img.width * s, img.height * s);
    sctx.fillStyle = '#ffd';
    sctx.fillText(list[k].name, cx + 4, cy + cell + 12);
  }
  return { results, png: sheet.toDataURL('image/png') };
}, sprites);

const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(report.png.split(',')[1], 'base64'));
const bad = report.results.filter((r) => r.paleRim > 0.04).sort((a, b) => b.paleRim - a.paleRim);
console.log(`audited ${report.results.length} sprites -> ${out}`);
console.log('pale rim > 4%:', bad.length ? bad.map((r) => `${r.name} ${(r.paleRim * 100).toFixed(1)}%`).join(', ') : 'none');
await browser.close();
