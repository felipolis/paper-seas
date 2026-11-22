// Large audit pages: every sprite at a big size on a dark magenta ground, 8 per page, so any white or cream
// residue (margins, pockets between branches or roots) is visible.
//
//   node tools/art/audit-pages.mjs  -> assets-src/audit/page-NN.png
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'public/art');
const outDir = join(root, 'assets-src/audit');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const PER_PAGE = 8;

const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (let p = 0; p * PER_PAGE < files.length; p++) {
  const batch = files.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
  const cells = batch
    .map((f) => `<div style="display:inline-block;width:390px;height:430px;margin:4px;text-align:center;color:#fd8;font:13px sans-serif;vertical-align:top">
      <div style="height:405px;display:flex;align-items:center;justify-content:center"><img src="data:image/png;base64,${readFileSync(join(dir, f)).toString('base64')}" style="max-width:380px;max-height:400px"></div>${f.replace('.png', '')}</div>`)
    .join('');
  // (setContent resolves once the page has loaded, its images with it)
  await page.setContent(`<body style="margin:0;background:#2a0d26">${cells}</body>`, { waitUntil: 'load' });
  await page.screenshot({ path: join(outDir, `page-${String(p + 1).padStart(2, '0')}.png`), fullPage: true });
}
console.log(`${files.length} sprites, ${Math.ceil(files.length / PER_PAGE)} pages -> ${outDir}`);
await browser.close();
