/**
 * The land's printed top, finished in its shader the way papertrails finishes its page (render/water.js
 * `groundBodyGLSL` and world/book.js there): the chunk's base print gives the colours (sand, the biome's ground); a
 * small data texture gives the roads (a crisp and a soft mask of every road, lane and square) and where the grass grows;
 * and per pixel, in world space, the shader lays on
 *
 *   wobble     every printed edge read through a fine hand-cut wobble and a slow one
 *   roads      papertrails' trodden path: a grainy feathered cut (no outline), a faint pale halo and a darker fringe
 *              outside it, a darker worn middle, fine grit, pebbles biting the margin
 *   mottle     the ground in broad lighter / darker, warmer / cooler patches (3 octaves)
 *   contact    a soft darker patch under what stands on the ground (papertrails' groundPrint.contact)
 *   tufts      grass tufts of three tapered blades, in drifts, leaning on the road's fringe
 *   flowers    five-petalled flowers in drifts of one colour, each with its own heart
 *   unpainted  far from the focus (render/paper-material.ts setPageFocus) the land is the book's unpainted part: a pale
 *              cream wash with pencil outlines and a little hatching
 *   seams      the cover tiles' scored creases (world/reveal.ts CELL)
 *   page stock papertrails' rougher page paper: fine tooth and coarse clouding on the albedo, its tooth on the normal
 *
 * Every term is a function of the world position, so the land runs on unbroken across chunks. The land's cut edge is
 * papertrails' stacked sheets (landEdgeMaterial).
 */
import * as THREE from 'three';
import { edgeStrip, pageFibre } from '../art/paper-maps';
import { createPaperMaterial } from '../render/paper-material';
import type { Pt } from './polyline';
import { CELL } from './reveal';

/** Data texture resolution (pixels per world unit) and the two blurs of the road mask (world units). */
export const DATA_PPU = 22;
const BLUR_CRISP = 0.03;
const BLUR_SOFT = 0.125;
/**
 * papertrails' contact patch (render/water.js groundBodyGLSL, groundPrint.contact there): its baked print is darkest
 * under the props of a tile, and a little of that stays as a soft darker patch on open ground; ours is drawn from the
 * props themselves (addContact), a disc under each standing piece, this much of its width, blurred this far.
 */
const CONTACT = { strength: 0.13, reach: 0.42, blur: 0.09 };

/** papertrails' page (config/world.js `book` and the texture manifest there). */
const PAGE = {
  /** World units per tile of the page stock's maps, and of their second, coarser read. */
  tile: 2.5,
  tile2: 7.3,
  /** Albedo and normal strength of the page stock's fibre. */
  albedo: 0.8,
  normal: 0.55,
  /** Full colour within fadeNear world units of the focus, the unpainted book beyond fadeFar. */
  fadeNear: 8,
  fadeFar: 13.5,
  /** Tile seam crease: width (world), darkness and emboss, at `seam` of their strength (`groundPrint.seam`). */
  creaseWidth: 0.012,
  creaseDark: 0.04,
  creaseEmboss: 0.5,
  seam: 0.06,
};

/**
 * papertrails' stacked-sheet edge (world/book.js `blockMat` there): the cut core's cream, the edge strip's band of
 * sheets (v from the top of the block to its foot) at the band's pitch on the book's 0.25-unit block, and world units
 * per repeat along the edge.
 */
const SHEETS = { core: '#fbf6ea', v: [0.99, 0.325], block: 0.25, repeat: 2 } as const;

export interface GroundShapes {
  /** Roads and lanes: points and width. */
  strips: Array<{ pts: readonly Pt[]; width: number }>;
  /** Village squares: centre and radius. */
  squares: Array<[number, number, number]>;
}

/**
 * The chunk's data texture: R the crisp road mask, G the soft one, B where grass grows (1) rather than sand (0), A the
 * contact patch under the props (filled in by addContact once they are placed). grass(x, z) answers for a world point.
 * Rows run from z0 at v = 1 (the canvas convention gUv reads), kept in a data texture so A holds any value.
 */
export function groundData(x0: number, z0: number, size: number, shapes: GroundShapes, grass: (x: number, z: number) => number): THREE.DataTexture {
  const px = Math.round(size * DATA_PPU);
  const draw = (blur: number): Uint8ClampedArray => {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, px, px);
    ctx.filter = `blur(${(blur * DATA_PPU).toFixed(2)}px)`;
    ctx.strokeStyle = ctx.fillStyle = '#fff';
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const { pts, width } of shapes.strips) {
      ctx.lineWidth = width * DATA_PPU;
      ctx.beginPath();
      pts.forEach(([x, z], k) => (k ? ctx.lineTo((x - x0) * DATA_PPU, (z - z0) * DATA_PPU) : ctx.moveTo((x - x0) * DATA_PPU, (z - z0) * DATA_PPU)));
      ctx.stroke();
    }
    for (const [x, z, r] of shapes.squares) {
      ctx.beginPath();
      ctx.ellipse((x - x0) * DATA_PPU, (z - z0) * DATA_PPU, r * DATA_PPU, r * 0.82 * DATA_PPU, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return ctx.getImageData(0, 0, px, px).data;
  };
  const crisp = draw(BLUR_CRISP);
  const soft = draw(BLUR_SOFT);
  const data = new Uint8Array(px * px * 4);
  for (let j = 0; j < px; j++) {
    const z = z0 + (j + 0.5) / DATA_PPU;
    for (let i = 0; i < px; i++) {
      const o = (j * px + i) * 4;
      const t = ((px - 1 - j) * px + i) * 4;
      data[t] = crisp[o];
      data[t + 1] = soft[o];
      data[t + 2] = Math.round(255 * grass(x0 + (i + 0.5) / DATA_PPU, z));
    }
  }
  const tex = new THREE.DataTexture(data, px, px, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Draws the contact patch of the chunk's standing pieces into its data texture (A): a soft disc under each, its radius
 * a share of the piece's width. props: [x, z, width] in world units.
 */
export function addContact(tex: THREE.DataTexture, x0: number, z0: number, props: ReadonlyArray<[number, number, number]>): void {
  const px = tex.image.width;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, px, px);
  ctx.filter = `blur(${(CONTACT.blur * DATA_PPU).toFixed(2)}px)`;
  ctx.fillStyle = '#fff';
  for (const [x, z, w] of props) {
    const r = w * CONTACT.reach * DATA_PPU;
    ctx.beginPath();
    ctx.ellipse((x - x0) * DATA_PPU, (z - z0) * DATA_PPU, r, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const src = ctx.getImageData(0, 0, px, px).data;
  const data = tex.image.data as Uint8Array;
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) data[((px - 1 - j) * px + i) * 4 + 3] = src[(j * px + i) * 4];
  tex.needsUpdate = true;
}

/**
 * The ground's paper material: papertrails' page (no card fibre, no per-sheet tone), its colour the chunk's base print
 * finished by papertrails' page terms.
 */
/**
 * papertrails' road tone per biome (biomeTint[b].path): over the chunk, a small grid of the tone the trodden ground
 * takes there (linear rgb) and how much of it (alpha), blended over a tile like the ground tint. tone(u, v) answers
 * for a node (0..1 across the chunk); grid: nodes per side - 1.
 */
export function pathTones(grid: number, tone: (u: number, v: number) => [number, number, number, number] | null): THREE.DataTexture {
  const n = grid + 1;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const t = tone(i / grid, j / grid);
      const o = ((n - 1 - j) * n + i) * 4;
      if (!t) continue;
      for (let k = 0; k < 4; k++) data[o + k] = Math.round(255 * Math.min(1, t[k]));
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function groundMaterial(print: THREE.Texture, data: THREE.Texture, paths: THREE.DataTexture, x0: number, z0: number, size: number): THREE.MeshLambertMaterial {
  const mat = createPaperMaterial({ back: null, fibre: 0, vary: false });
  const page = pageFibre();
  const uniforms = {
    uGroundPrint: { value: print },
    uGroundData: { value: data },
    uPathTone: { value: paths },
    uGroundBox: { value: new THREE.Vector3(x0, z0, size) },
    uPageFibre: { value: page.albedo },
    uPageFibreN: { value: page.normal },
    uPageFibreMean: { value: page.mean },
  };
  const paper = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    paper.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_COMMON}`)
      .replace('#include <normal_fragment_maps>', `${GROUND_FRAGMENT}\n#include <normal_fragment_maps>\n${GROUND_TILT}`);
  };
  mat.customProgramCacheKey = () => 'paper-v7-ground-v3';
  return mat;
}

/** The land's cut edge: papertrails' stacked sheets, cream paper with thin warm-brown gaps (UVs: edgeWallUV). */
export function landEdgeMaterial(): THREE.MeshLambertMaterial {
  const mat = createPaperMaterial({ color: SHEETS.core, back: null, vary: false });
  const uSheet = { value: edgeStrip() };
  const paper = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    paper.call(mat, shader, renderer);
    shader.uniforms.uSheet = uSheet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSheetUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSheetUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSheetUv;\nuniform sampler2D uSheet;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
diffuseColor.rgb *= mix(vec3(0.46, 0.33, 0.23), vec3(1.0), smoothstep(0.02, 0.42, texture2D(uSheet, vSheetUv).g));`,
      );
  };
  mat.customProgramCacheKey = () => 'paper-v7-land-edge-v1';
  return mat;
}

/**
 * UVs of one quad of the land's extruded edge (an ExtrudeGeometry side wall: shape x / y, depth z from the foot up to
 * `depth`): u runs along the edge in world units per strip repeat (on the wall's main axis), v down the band of sheets
 * from the top of the edge at the strip's pitch.
 */
export function edgeWallUV(vertices: ArrayLike<number>, depth: number, quad: readonly number[]): THREE.Vector2[] {
  const [a, b] = quad;
  const alongX = Math.abs(vertices[a * 3 + 1] - vertices[b * 3 + 1]) < Math.abs(vertices[a * 3] - vertices[b * 3]);
  return quad.map((k) => {
    const u = vertices[k * 3 + (alongX ? 0 : 1)] / SHEETS.repeat;
    const down = (depth - vertices[k * 3 + 2]) / SHEETS.block;
    return new THREE.Vector2(u, SHEETS.v[0] + (SHEETS.v[1] - SHEETS.v[0]) * down);
  });
}

const f = (v: number) => v.toFixed(4);

const GROUND_COMMON = /* glsl */ `
uniform sampler2D uGroundPrint;
uniform sampler2D uGroundData;
uniform sampler2D uPathTone;
uniform vec3 uGroundBox;
uniform sampler2D uPageFibre;
uniform sampler2D uPageFibreN;
uniform float uPageFibreMean;
vec2 gPageTilt;
// the chunk's textures at a world point (their v runs from south to north)
vec2 gUv(vec2 w) { return vec2((w.x - uGroundBox.x) / uGroundBox.z, 1.0 - (w.y - uGroundBox.y) / uGroundBox.z); }
vec4 gData(vec2 w) { return texture2D(uGroundData, gUv(w)); }
// the print through a cubic B-spline: four bilinear taps, each weighing two texels per axis (the print is low
// resolution and seen magnified: bilinearly its diagonal edges would show the texels as soft stair steps)
vec4 gPrint(vec2 uv) {
  vec2 ts = vec2(textureSize(uGroundPrint, 0));
  vec2 st = uv * ts - 0.5;
  vec2 fl = floor(st);
  vec2 f = st - fl;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 s0 = w0 + w1;
  vec2 s1 = w2 + w3;
  vec2 a = (fl - 1.0 + w1 / s0 + 0.5) / ts;
  vec2 b = (fl + 1.0 + w3 / s1 + 0.5) / ts;
  return s0.y * (s0.x * texture2D(uGroundPrint, vec2(a.x, a.y)) + s1.x * texture2D(uGroundPrint, vec2(b.x, a.y)))
       + s1.y * (s0.x * texture2D(uGroundPrint, vec2(a.x, b.y)) + s1.x * texture2D(uGroundPrint, vec2(b.x, b.y)));
}
`;

const GROUND_FRAGMENT = /* glsl */ `
{
  // world position on the page: x east, y = world z (south); screen-up is -z
  vec2 wq = vPaperPos.xz;
  float wpx = max(fwidth(wq.x), fwidth(wq.y));
  // ---- every printed edge read through a fine hand-cut wobble and a slow one (gentle width variation of the roads),
  // eased out at the chunk's border, where the next chunk's print takes over (papertrails eases it out at a tile's) ----
  vec2 be = min(wq - uGroundBox.xy, uGroundBox.xy + uGroundBox.z - wq);
  float ew = smoothstep(0.0, 0.28, min(be.x, be.y));
  vec2 wob = ((vec2(pageNoise(wq * 4.0 + 3.1), pageNoise(wq * 4.0 + 8.7)) - 0.5) * 0.044 + (vec2(pageNoise(wq + 1.7), pageNoise(wq + 6.3)) - 0.5) * 0.064) * ew;
  // (the print's texels past the shore are transparent black: the filtered colour is divided by its coverage)
  vec4 print = gPrint(gUv(wq + wob));
  vec3 gcol = print.rgb / max(print.a, 1e-4);
  vec4 rd = gData(wq + wob);
  float kS = rd.r, kW = rd.g, grass = rd.b;
  // ---- the road: a grainy feathered cut ----
  float n1 = pageNoise(wq * 1.5 + 3.3), n2 = pageNoise(wq * 6.0 + 9.1), n3 = pageNoise(wq * 24.0 + 2.2);
  float ef = mix(kS, kW, 0.45) + (n1 - 0.5) * 0.2 + (n2 - 0.5) * 0.15;
  float pmS = smoothstep(0.47, 0.69, ef + (n3 - 0.5) * 0.26);
  float halo = smoothstep(0.40, 0.62, ef) * (1.0 - pmS);
  float fringe = smoothstep(0.24, 0.50, ef) * (1.0 - smoothstep(0.6, 0.82, ef));
  float worn = smoothstep(0.60, 0.92, kW) * pmS;
  float open = 1.0 - pmS;
  // ---- large-scale paper mottling (three sizes), a little warmer / cooler by patch ----
  float m1 = pageNoise(wq) - 0.5, m2 = pageNoise((wq + 17.3) * 2.5) - 0.5, m3 = pageNoise((wq + 4.4) * 0.5) - 0.5;
  float mot = (m3 * 0.5 + m1 * 0.5 + m2 * 0.3) * 2.0;
  gcol *= 1.0 + 0.15 * mot * (0.45 + 0.55 * open);
  gcol *= vec3(1.0) + 0.09 * (m2 + m3) * vec3(0.9, 0.05, -1.1) * open;
  // ---- papertrails' contact patch: a little darker under what stands on open ground ----
  gcol *= 1.0 - ${CONTACT.strength.toFixed(3)} * rd.a * open * vec3(0.9, 1.0, 1.15);
  // ---- the trodden track: papertrails' peach cream (#ffd5b4), fine grit, the mottle, a darker worn middle ----
  const vec3 PC = vec3(1.0, 0.665, 0.456);
  vec3 pcol = PC * (1.0 + 0.09 * (pageHash(floor(wq * 96.0)) - 0.5)) * (1.0 + 0.075 * mot);
  // papertrails' road tone of the biome (a pine-needle track in the pine woods, a cream garden path in the blossom)
  {
    vec2 pu = gUv(wq);
    float pn = float(textureSize(uPathTone, 0).x);
    vec4 pt = texture2D(uPathTone, (pu * (pn - 1.0) + 0.5) / pn);
    pcol = mix(pcol, pt.rgb * (1.0 + 0.075 * mot), pt.a);
  }
  pcol *= 1.0 - 0.17 * worn * (0.5 + pageNoise((wq + 12.0) * 3.0)) * vec3(0.9, 1.0, 1.15);
  gcol = mix(gcol, mix(gcol, PC, 0.12), halo);
  gcol = mix(gcol, pcol, pmS);
  // darker, greener fringe outside the cut
  gcol *= 1.0 - 0.07 * fringe * open * vec3(1.0, 0.8, 1.1);
  // small pebbles biting into the margin, lit from the upper left
  {
    vec2 pg = wq * 11.0;
    vec2 pid = floor(pg);
    float phh = pageHash(pid + 13.7);
    vec2 pc = (fract(pg) - 0.5) / 11.0 - (vec2(pageHash(pid + 4.1), pageHash(pid + 19.3)) - 0.5) * 0.045;
    float pr = 0.015 + 0.016 * fract(phh * 9.7);
    float pl = length(pc * vec2(1.0, 1.45));
    float peb = (1.0 - smoothstep(pr - wpx, pr + wpx, pl)) * step(phh, 0.5 * fringe + 0.02 * pmS);
    vec3 pebC = mix(vec3(0.5, 0.4, 0.29), vec3(0.93, 0.8, 0.62), smoothstep(pr * 0.5, -pr * 0.4, pc.y + pc.x * 0.4));
    gcol = mix(gcol, pebC * mix(1.0, 0.8, smoothstep(pr * 0.75, pr, pl)), peb);
  }
  // ---- printed grass tufts and flowers, in drifts, on open grass and biting into the road's margin (papertrails'
  // ground is all grass: here they keep off the sand); at 0.7 of their full ink (papertrails' clumps) ----
  float grassy = max(grass * open, fringe * 0.85 * grass) * 0.7;
  if (grassy > 0.01) {
    vec2 cg = wq * 5.0;
    vec2 cid = floor(cg);
    float ch = pageHash(cid + 3.1), ch2 = pageHash(cid + 57.7);
    float clus = smoothstep(0.52, 0.7, pageNoise((wq + 5.1) * 0.75));
    float fdr = smoothstep(0.56, 0.72, pageNoise((wq + 88.8) * 0.75));
    // a tuft of three tapered blades: free position, size, lean and ink per cell, so they never read as a grid
    float tks = 0.72 + 0.56 * fract(ch * 17.3);
    vec2 cc = ((fract(cg) - 0.5) * 0.2 - (vec2(ch2, fract(ch2 * 13.7)) - 0.5) * 0.11) / tks;
    cc.x += (fract(ch2 * 29.1) - 0.5) * 0.7 * (0.04 - cc.y);
    float hh = 0.04 - cc.y; // height above the tuft's foot (north = up the page)
    float wd = 0.009 * (1.0 - hh / 0.095) + 0.0015;
    float inh = step(0.0, hh) * step(hh, 0.095);
    float bl = max(max(1.0 - smoothstep(wd, wd + wpx, abs(cc.x + 0.5 * hh)), 1.0 - smoothstep(wd, wd + wpx, abs(cc.x - 0.06 * hh))), 1.0 - smoothstep(wd, wd + wpx, abs(cc.x - 0.55 * hh))) * inh;
    float present = step(ch, 0.01 + 0.19 * clus + 0.24 * fringe) * grassy;
    gcol = mix(gcol, gcol * vec3(0.5, 0.7, 0.4), bl * present * (0.45 + 0.55 * fract(ch * 41.3)));
    // a small five-petalled flower in some cells of a flower drift, one colour leading per drift, its own heart
    vec2 fq = (fract(cg) - 0.5) * 0.2 - (vec2(fract(ch * 91.7), fract(ch2 * 47.3)) - 0.5) * 0.13;
    float fr0 = 0.014 + 0.006 * fract(ch * 53.0);
    float fl5 = length(fq) / (0.78 + 0.22 * cos(atan(fq.y, fq.x) * 5.0 + ch * 6.0));
    float dot_ = (1.0 - smoothstep(fr0, fr0 + wpx, fl5)) * step(fract(ch * 31.0), 0.012 + 0.36 * fdr) * grass * open * grassy;
    float fkind = step(0.5, pageNoise((wq + 55.5) * 0.5) + 0.3 * (fract(ch * 77.0) - 0.5));
    vec3 fcol = mix(mix(vec3(0.95, 0.88, 0.7), vec3(0.9, 0.42, 0.16), fkind), mix(vec3(0.9, 0.5, 0.14), vec3(0.45, 0.2, 0.08), fkind), 1.0 - smoothstep(fr0 * 0.3, fr0 * 0.3 + wpx, length(fq)));
    gcol = mix(gcol, fcol, dot_ * 0.85);
  }
  // ---- land far from the focus is the unpainted part of the book, behind a soft noise-warped rim ----
  float rim = distance(wq, uPageFocus) + 2.4 * (pageNoise((wq + 14.2) * 0.5) - 0.5) + 0.8 * (pageNoise((wq + 3.7) * 2.0) - 0.5);
  float ink = 1.0 - smoothstep(${f(PAGE.fadeNear)}, ${f(PAGE.fadeFar)}, rim);
  gcol = mix(pageUnpainted(gcol, wq, wpx, 0.0), gcol, ink * ink * (3.0 - 2.0 * ink));
  // ---- the cover tiles' seams: a scored crease (a thin dark line and a tiny V groove) ----
  vec2 sd = (wq / ${f(CELL)} - floor(wq / ${f(CELL)} + 0.5)) * ${f(CELL)}; // signed distance to the nearest seam per axis
  vec2 ad = abs(sd);
  vec2 line = 1.0 - smoothstep(vec2(${f(PAGE.creaseWidth * 0.5)}), vec2(${f(PAGE.creaseWidth * 0.5)} + wpx), ad);
  gcol *= 1.0 - ${f(PAGE.creaseDark * PAGE.seam)} * max(line.x, line.y);
  vec2 groove = (1.0 - smoothstep(vec2(0.0), vec2(${f(PAGE.creaseWidth * 3)} + wpx), ad)) * sign(sd);
  // ---- papertrails' page stock: fine tooth + coarse clouding on the albedo, a tooth normal ----
  vec2 fuv = wq * ${f(1 / PAGE.tile)};
  float fa = texture2D(uPageFibre, fuv).g / uPageFibreMean - 1.0;
  float fc = texture2D(uPageFibre, wq.yx * vec2(${f(1 / PAGE.tile2)}, ${f(-1 / PAGE.tile2)}) + vec2(0.31, 0.67)).g / uPageFibreMean - 1.0;
  gcol *= 1.0 + (fa * 0.75 + fc * 0.6) * ${f(PAGE.albedo)};
  gPageTilt = (texture2D(uPageFibreN, fuv).xy * 2.0 - 1.0) * ${f(PAGE.normal)} - groove * ${f(PAGE.creaseEmboss * PAGE.seam)};
  diffuseColor.rgb = gcol;
}
`;

/** The page stock's tooth on the normal (papertrails tilts its page's normal in world space). */
const GROUND_TILT = /* glsl */ `
normal = normalize(normal + mat3(viewMatrix) * vec3(gPageTilt.x, 0.0, gPageTilt.y));
`;
