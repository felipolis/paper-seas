// The dead-code check: what nothing uses. Lists, and exits 1 if it finds any:
//   - a module of src/ that the game never loads: not reached by following the imports from its entry points
//     (src/main.ts and its workers, and the in-page checks of tools/qa/*.ts, which the dev build loads);
//   - a value exported from src/ (a const, function or class) that no other module imports; an exported type may
//     serve only its own module's signatures;
//   - a file of public/ the game never names: as a quoted name, a path, an object key, or by the prefix of a
//     spritesWithPrefix('…') call or of a template (`ship-${id}.glb`);
//   - a tool script that nothing runs: no other tool imports it, and no npm script, workflow or doc names it.
// It reads files only (no dev server): node tools/qa/dead-code.mjs (or npm run check, after the type check).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/** Every file under dir (repo-relative) whose name keep accepts, as repo-relative paths with forward slashes. */
function list(dir, keep = () => true, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) list(p, keep, out);
    else if (keep(e.name)) out.push(p);
  }
  return out;
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const findings = [];

// ---- the modules: what loads what ----

const modules = new Map([...list('src', (n) => n.endsWith('.ts')), ...list('tools/qa', (n) => n.endsWith('.ts'))].map((f) => [f, read(f)]));
/** A module's text with its comments taken out (a name in a comment uses nothing). */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const bare = new Map([...modules].map(([f, t]) => [f, code(t)]));

/** The module a specifier names from a file (repo-relative), or null if it is not one of ours. */
function resolve(from, spec) {
  const target = spec.startsWith('/') ? spec.slice(1) : rel(path.resolve(ROOT, path.dirname(from), spec));
  const clean = target.replace(/\?.*$/, '');
  for (const f of [clean, `${clean}.ts`]) if (modules.has(f)) return f;
  return null;
}

/** What each module imports: the modules it loads, and the names it takes from each. */
const imports = new Map();
for (const [f, text] of bare) {
  const loads = new Map();
  const take = (spec, names) => {
    const m = resolve(f, spec);
    if (!m) return;
    if (!loads.has(m)) loads.set(m, new Set());
    for (const n of names) loads.get(m).add(n);
  };
  for (const m of text.matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = m[2];
    const names = [];
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces) for (const part of braces[1].split(',')) { const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]; if (name) names.push(name); }
    if (/\*\s+as\s+\w+/.test(clause)) names.push('*');
    take(m[3], names);
  }
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) take(m[2], m[1].split(',').map((p) => p.trim().split(/\s+as\s+/)[0]).filter(Boolean));
  for (const m of text.matchAll(/import\(\s*['"`]([^'"`$]+)['"`]\s*\)/g)) take(m[1], ['*']);
  for (const m of text.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)) take(m[1], ['*']);
  imports.set(f, loads);
}

// the tools load modules too: statically, or into the dev build's page or Vite's server by a root path
// (`const { CHUNK } = await import('/src/world/terrain.ts')`, `server.ssrLoadModule('/src/…')`)
const toolScripts = list('tools', (n) => /\.(mjs|ts|py|sh)$/.test(n));
const toolText = new Map(toolScripts.map((f) => [f, read(f)]));
const toolLoads = new Set();
for (const [f, text] of toolText) {
  if (modules.has(f)) continue;
  const loads = new Map();
  const take = (m, names) => {
    if (!m) return;
    toolLoads.add(m);
    if (!loads.has(m)) loads.set(m, new Set());
    for (const n of names) loads.get(m).add(n);
  };
  for (const m of text.matchAll(/import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) take(resolve(f, m[2]), m[1].split(',').map((p) => p.trim().split(/\s+as\s+/)[0]));
  for (const m of text.matchAll(/(?:const\s*\{([^}]*)\}\s*=\s*)?\(?\s*await\s+(?:import|[\w.]+\.ssrLoadModule)\(\s*['"](\/[^'"]+)['"]\s*\)\s*\)?(?:\.(\w+))?/g)) {
    take(resolve(f, m[2]), m[1] ? m[1].split(',').map((p) => p.trim().split(/\s*:\s*/)[0]) : m[3] ? [m[3]] : ['*']);
  }
  imports.set(f, loads);
}

// the entry points: the game's, and whatever the tools load
const entries = ['src/main.ts', ...toolLoads];
const reached = new Set();
const stack = [...entries];
while (stack.length) {
  const f = stack.pop();
  if (reached.has(f)) continue;
  reached.add(f);
  for (const m of imports.get(f).keys()) stack.push(m);
}
for (const f of modules.keys()) if (!reached.has(f)) findings.push(`${f}: never loaded (no import reaches it from an entry point)`);

// ---- the exports: a value someone imports ----

for (const [f, text] of bare) {
  if (!f.startsWith('src/')) continue;
  const values = [];
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:const|let|function\*?|class|abstract\s+class|enum)\s+([A-Za-z_$][\w$]*)/g)) values.push(m[1]);
  for (const m of text.matchAll(/export\s+const\s+\{([^}]*)\}\s*=/g)) for (const part of m[1].split(',')) { const name = part.trim().split(/\s*:\s*/).pop(); if (name) values.push(name); }
  for (const name of values) {
    const used = [...imports].some(([g, loads]) => g !== f && (loads.get(f)?.has(name) || loads.get(f)?.has('*')));
    if (!used) findings.push(`${f}: export ${name} is imported nowhere${new RegExp(`\\b${escape(name)}\\b`, 'g').test(text.replace(/export[^\n]*/, '')) ? ' (used in its own module only: drop the export)' : ''}`);
  }
}

// ---- the game's files: one the game names ----

const gameText = [...modules].filter(([f]) => f.startsWith('src/')).map(([, t]) => t).join('\n') + read('index.html');
const prefixes = [
  ...[...gameText.matchAll(/spritesWithPrefix\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ...[...gameText.matchAll(/([\w-]+-)\$\{/g)].map((m) => m[1]),
];
for (const p of list('public')) {
  const file = path.basename(p);
  const name = file.replace(/\.[^.]+$/, '');
  const named = new RegExp(`['"\`]${escape(name)}['"\`]|(?<![\\w-])${escape(file)}|(^|[{,\\s])${escape(name)}\\s*:`, 'm').test(gameText);
  if (!named && !prefixes.some((x) => name.startsWith(x))) findings.push(`${p}: the game never names it`);
}

// ---- the tools: one something runs ----

const docs = ['README.md', 'AGENTS.md', ...list('docs', (n) => n.endsWith('.md'))].filter((f) => fs.existsSync(path.join(ROOT, f))).map(read).join('\n');
const runners = [read('package.json'), read('.github/workflows/deploy.yml'), docs].join('\n');
for (const f of toolScripts) {
  if (modules.has(f)) continue; // (an in-page check: the module graph above)
  const file = path.basename(f);
  const imported = [...toolText].some(([g, t]) => g !== f && new RegExp(`['"/]${escape(file)}['"]|/${escape(file.replace(/\.\w+$/, ''))}['"]`).test(t));
  if (!imported && !runners.includes(file) && !runners.includes(f)) findings.push(`${f}: nothing runs it (no tool imports it; no npm script, workflow or doc names ${file})`);
}

if (findings.length) {
  console.log(`${findings.length} unused:`);
  for (const line of findings) console.log(`  ${line}`);
  process.exitCode = 1;
} else console.log('nothing unused');
