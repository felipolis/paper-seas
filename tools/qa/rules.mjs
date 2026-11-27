// The rules check: the rules of AGENTS.md a machine can see. Lists every breach, and exits 1 if it finds any:
//   - Math.random anywhere in src/ but where a new voyage draws its own seed (src/config/seed.ts);
//   - `any`, @ts-ignore or @ts-expect-error in the type-checked code;
//   - localStorage anywhere in src/ but core/storage.ts;
//   - console.log, .info or .debug left in src/ (console.warn is for a broken assumption, console.error for a failure);
//   - an easing that only approximates a decay, so its pace follows the frame rate: x += (to - x) * Math.min(1, k * dt)
//     or x *= Math.max(0, 1 - k * dt) (Math.exp(-k * dt) is the one);
//   - a material copied with .clone() (paperCopy keeps the paper shader);
//   - a TODO, FIXME, HACK or XXX left in the code or the tools;
//   - a name of the projects the game was inspired by, or of their authors (those LICENSE gives notice for), anywhere
//     but LICENSE (the art prompts may use a project's name where it is a plain word for the style).
// It reads files only: node tools/qa/rules.mjs (or npm run check).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/** A file's text with its comments blanked out, line for line (a rule about code reads code only). */
const code = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, (m, before) => before);

// every file git tracks or would track, that is text
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && fs.existsSync(path.join(ROOT, f)) && /\.(ts|mjs|js|py|sh|json|jsonc|md|txt|html|css|yml)$/.test(f));
const gameCode = files.filter((f) => f.startsWith('src/') && f.endsWith('.ts'));
const typed = [...gameCode, ...files.filter((f) => f.startsWith('tools/qa/') && f.endsWith('.ts'))];
const tools = files.filter((f) => f.startsWith('tools/') && /\.(mjs|ts|py|sh)$/.test(f));

const findings = [];
/** Every line of each file (comments blanked out if inCode) that matches re, unless allowed(file). */
function rule(name, list, re, { inCode = true, allowed = () => false } = {}) {
  for (const f of list) {
    if (allowed(f)) continue;
    const lines = (inCode ? code(read(f)) : read(f)).split('\n');
    lines.forEach((line, i) => { if (re.test(line)) findings.push(`${f}:${i + 1}: ${name}`); });
  }
}

rule('Math.random (the world is a function of the seed: core/rng.ts)', gameCode, /\bMath\.random\b/, { allowed: (f) => f === 'src/config/seed.ts' });
rule('`any` or a silenced type error', typed, /@ts-ignore|@ts-expect-error|[:<,(]\s*any\b|\bas\s+any\b/);
rule('localStorage outside core/storage.ts', gameCode, /\blocalStorage\b/, { allowed: (f) => f === 'src/core/storage.ts' });
rule('console.log / info / debug left in', gameCode, /\bconsole\.(log|info|debug)\b/);
rule('an easing whose pace follows the frame rate (use Math.exp(-k * dt))', gameCode, /\*\s*Math\.min\(\s*1\s*,\s*[^)]*\bdt\b[^)]*\)|\*=\s*Math\.max\(\s*0\s*,\s*1\s*-\s*[^)]*\bdt\b/);
rule('a material copied with .clone() (use paperCopy)', gameCode, /[Mm]aterial\b[^;\n]*\.clone\(\)/);
// (this check names the markers to find them)
rule('a TODO / FIXME / HACK / XXX left in', [...gameCode, ...tools], /\b(TODO|FIXME|HACK|XXX)\b/, { inCode: false, allowed: (f) => f === 'tools/qa/rules.mjs' });
// (the projects LICENSE gives notice for and their authors, read from its links so that no name is written here. The
// art prompts may use a project's name, where it is also a plain word for the style in the text for the image model;
// an author's name is checked there too)
const links = [...read('LICENSE').matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)/g)];
const named = (name) => new RegExp(`\\b${name}\\b`, 'i');
const isLicense = (f) => f === 'LICENSE';
for (const name of new Set(links.map((m) => m[1]))) rule('an author of a project the game was inspired by, named', files, named(name), { inCode: false, allowed: isLicense });
for (const name of new Set(links.map((m) => m[2]))) rule('a project the game was inspired by, named', files, named(name), { inCode: false, allowed: (f) => isLicense(f) || f.startsWith('assets-src/prompts/') });

if (findings.length) {
  console.log(`${findings.length} rule breach(es):`);
  for (const line of findings) console.log(`  ${line}`);
  process.exitCode = 1;
} else console.log('every rule kept');
