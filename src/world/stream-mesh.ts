/**
 * The streams as water (papertrails' river, render/water.js there), in the sea's own colours and paper: a ribbon
 * laid on the land along each stream, shaded per pixel from its flow frame (s along the stream, c across it):
 *
 *   depth      shallow at the banks, deep in the middle, in three soft printed steps, mottled
 *   light net  the sea's slow caustic net
 *   dashes     cream lens-shaped dashes in staggered rows, carried along by the current, gathering by the banks
 *   banks      a dark waterline just inside the water, a thin broken cream cut line outside it, then a band of sand
 *   mirror     the world mirrored in the water as on the sea, read from the sea's image at the water's own height
 *              (sea/mirror.ts): papertrails mirrors its rivers too
 *
 * The ribbon is a little wider than the water so its bank fits on it; beyond the bank the ribbon is cut away. Its colours
 * are papertrails' water of the biome it runs through (render/biome-tint.ts waterPalettes), blended along the stream: a
 * pinewood stream runs darker, a blossom one carries petals instead of leaves.
 */
import * as THREE from 'three';
import { WATER_GLSL, waterUniforms } from '../sea/water';
import { MIRROR_APPLY, MIRROR_GLSL, mirrorUniforms } from '../sea/mirror';
import { mirrorSkip } from '../render/reflection';
import { waterPalettes, waterRow } from '../render/biome-tint';
import { LAND_TOP, type Biome } from './land';
import { Streams, type Stream } from './streams';

/** Height of the streams' water: just above the land, so it never fights it for depth. */
const STREAM_Y = LAND_TOP + 0.004;
/** Width of the bank band (world units) laid outside the water on each side. */
const BANK = 0.14;
/** Segments of the round pool at either end of a stream. */
const POOL_SEGMENTS = 8;
/** A stream's water blends from one biome's to the next over this many points either side. */
const BLEND = 4;

let material: THREE.MeshLambertMaterial | null = null;

function streamMaterial(): THREE.MeshLambertMaterial {
  if (material) return material;
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, alphaToCoverage: true, alphaTest: 0.02 });
  const uniforms = { ...waterUniforms(), ...mirrorUniforms(), uRiverPal: { value: waterPalettes() } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRiver;\nattribute vec3 aRiverMix;\nvarying vec3 vRiver;\nvarying vec3 vRiverMix;\nvarying vec3 vRiverPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiver = aRiver;\nvRiverMix = aRiverMix;\nvRiverPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WATER_GLSL}\n${MIRROR_GLSL}\n${RIVER_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb *= riverColour();\ndiffuseColor.a = gRiverCover;\n${MIRROR_APPLY.colour}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${MIRROR_APPLY.emissive}`);
  };
  m.customProgramCacheKey = () => 'river-v4';
  mirrorSkip.add(m);
  material = m;
  return m;
}

/**
 * The ribbons of the streams that pass through the square [x0, x1) x [z0, z1) (one more point either side, so
 * neighbouring chunks' ribbons meet), as one mesh, or null. A ribbon begins and ends in a little round pool (its
 * river's spring at either end); biome: the biome inland at a point (the water's colours).
 */
export function streamRibbons(streams: Stream[], x0: number, z0: number, x1: number, z1: number, biome: (x: number, z: number) => Biome): THREE.Mesh | null {
  const pos: number[] = [];
  const river: number[] = [];
  const mix: number[] = [];
  const index: number[] = [];
  for (const st of streams) {
    const pts = st.pts;
    const water = waterMix(st, biome);
    const mixAt = (i: number) => mix.push(water[i * 3], water[i * 3 + 1], water[i * 3 + 2]);
    // the arc length along the stream at every point
    const arc = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 2) {
        const base = pos.length / 3;
        for (const i of run) {
          const a = pts[Math.max(0, i - 1)];
          const b = pts[Math.min(pts.length - 1, i + 1)];
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const nx = -(b[1] - a[1]) / l;
          const nz = (b[0] - a[0]) / l;
          const hw = Streams.widthAt(i) / 2;
          const half = hw + BANK;
          for (const side of [-1, 1]) {
            pos.push(pts[i][0] + nx * half * side, STREAM_Y, pts[i][1] + nz * half * side);
            river.push(arc[i], side, hw);
            mixAt(i);
          }
        }
        for (let k = 0; k + 1 < run.length; k++) {
          const v = base + k * 2;
          // (counter-clockwise seen from above)
          index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
        // both ends: the water rises in a little round pool and sinks into another, its bank closing round each, not
        // a square cut (the ribbon's vertices on either side of the way into the river)
        const end = pts.length - 1;
        if (run[0] === 0) pool(0, 1, base + 1, base);
        const last = base + (run.length - 1) * 2;
        if (run[run.length - 1] === end) pool(end, end - 1, last, last + 1);
      }
      run = [];
    };
    // a round pool at the river's end point i, from the ribbon's vertex `left` of the way in (toward point `into`)
    // round the back of the end to the one `right` of it
    const pool = (i: number, into: number, left: number, right: number) => {
      const [px, pz] = pts[i];
      const [qx, qz] = pts[into];
      const l = Math.hypot(qx - px, qz - pz) || 1;
      const tx = (qx - px) / l;
      const tz = (qz - pz) / l;
      const hw = Streams.widthAt(i) / 2;
      const half = hw + BANK;
      const centre = pos.length / 3;
      pos.push(px, STREAM_Y, pz);
      river.push(arc[i], 0, hw);
      mixAt(i);
      const rim: number[] = [left];
      // (down the river is the way in at its spring, the way out at its other end; the ribbon's left of the way in is
      // its side +1 at the spring, -1 at the other end)
      const down = into > i ? 1 : -1;
      const rimVertex = (a: number, side: number) => {
        const ox = Math.cos(a);
        const oy = Math.sin(a);
        pos.push(px + (tx * ox - tz * oy) * half, STREAM_Y, pz + (tz * ox + tx * oy) * half);
        river.push(arc[i] + down * ox * half, side, hw);
        mixAt(i);
        rim.push(pos.length / 3 - 1);
      };
      // (a: from the left normal round behind the end to the right one, in the frame of the way in. s runs on round the
      // pool and c keeps the ribbon's side on each half, so the dashes and current lines carry on from the ribbon and
      // curve with the bank; the halves meet at the back, behind the stones, where the vertex there is laid twice)
      const back = POOL_SEGMENTS / 2;
      for (let k = 1; k < POOL_SEGMENTS; k++) {
        const a = Math.PI / 2 + (k / POOL_SEGMENTS) * Math.PI;
        if (k <= back) rimVertex(a, down);
        if (k >= back) rimVertex(a, -down);
      }
      rim.push(right);
      for (let k = 0; k + 1 < rim.length; k++) index.push(centre, rim[k + 1], rim[k]);
    };
    for (let i = 0; i < pts.length; i++) {
      const inside = (p: readonly number[]) => p[0] >= x0 && p[0] < x1 && p[1] >= z0 && p[1] < z1;
      const near = inside(pts[i]) || (i > 0 && inside(pts[i - 1])) || (i + 1 < pts.length && inside(pts[i + 1]));
      if (near) run.push(i);
      else flush();
    }
    flush();
  }
  if (!index.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRiver', new THREE.Float32BufferAttribute(river, 3));
  g.setAttribute('aRiverMix', new THREE.Float32BufferAttribute(mix, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, streamMaterial());
  mesh.receiveShadow = true;
  return mesh;
}

const mixes = new WeakMap<Stream, Float32Array>();

/**
 * How much of each water palette (heartland, blossom, pinewood) every point of a stream takes: its biome there, averaged
 * over BLEND points either side (kept per stream: every chunk it crosses reads the same).
 */
function waterMix(st: Stream, biome: (x: number, z: number) => Biome): Float32Array {
  const known = mixes.get(st);
  if (known) return known;
  const n = st.pts.length;
  const rows = st.pts.map(([x, z]) => waterRow(biome(x, z)));
  const m = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - BLEND);
    const b = Math.min(n - 1, i + BLEND);
    for (let k = a; k <= b; k++) m[i * 3 + rows[k]] += 1 / (b - a + 1);
  }
  mixes.set(st, m);
  return m;
}

const RIVER_GLSL = /* glsl */ `
varying vec3 vRiver;     // s along the stream, c across it (-1..1 over the ribbon), the water's half width
varying vec3 vRiverMix;  // how much of each water palette: heartland, blossom, pinewood
varying vec3 vRiverPos;
uniform vec3 uRiverPal[12];  // per palette: shallow, deep, rim, floater
#define RIVER_PAL(o) (vRiverMix.x * uRiverPal[o] + vRiverMix.y * uRiverPal[4 + o] + vRiverMix.z * uRiverPal[8 + o])
float gRiverCover;
vec3 gRiverRim;       // the palette's rim (the bank's cut line, the dashes)
float gRiverBlossom;  // how much of the stream is the blossom's (petals ride it, smaller and more of them)
float gRiverMarks;    // what floats on the water here (dashes, leaves): the mirror image shows round it
vec3 riverBank(vec2 p, float out_, float aa) {
  // the bank: a thin broken cream cut line, then a band of sand fading into the ground
  float line = (1.0 - smoothstep(0.012, 0.012 + aa, abs(out_ - 0.022))) * step(seaNoise(p * 1.8 + 5.0), 0.72);
  // (the sand takes the biome's rim tone, as the heartland's rim is to its own)
  vec3 sand = vec3(0.84, 0.69, 0.42) * gRiverRim / uSeaFoam;
  vec3 col = mix(sand, gRiverRim, line);
  gRiverCover = (1.0 - smoothstep(${(BANK * 0.35).toFixed(3)}, ${(BANK * 0.95).toFixed(3)}, out_ + (seaNoise(p * 9.0) - 0.5) * 0.04)) * 0.95;
  gRiverCover = max(gRiverCover, line);
  return col * (1.0 + (seaFibre(p) - 0.5) * 0.8);
}
vec3 riverWater(vec2 p, float T, float s, float hw, float across, float edge, float aa) {
  gRiverCover = 1.0;
  // ---- depth: shallow at the banks, deep in the middle, in three soft steps ----
  float ctr = 1.0 - smoothstep(0.0, 0.3, across);
  float dpt = smoothstep(0.0, hw, edge) * 0.45 + 0.7 * ctr * ctr;
  float dpn = dpt + (seaNoise(p * 2.5) - 0.5) * 0.16 + (seaNoise(p * 7.0) - 0.5) * 0.12;
  float steps = 0.3 * smoothstep(0.13, 0.2, dpn) + 0.3 * smoothstep(0.38, 0.46, dpn) + 0.36 * smoothstep(0.66, 0.76, dpn);
  vec3 col = mix(RIVER_PAL(0), RIVER_PAL(1), clamp(mix(dpt, steps, 0.62), 0.0, 1.0));
  col *= 0.94 + 0.12 * seaNoise(p * 2.5);
  // ---- the sea's light net ----
  float ca = sin(p.x * 3.1 + 1.4 * sin(p.y * 2.2 + T * 0.55)) * sin(p.y * 3.7 + 1.2 * sin(p.x * 2.6 - T * 0.4));
  col *= 1.0 + 0.07 * (smoothstep(0.3, 0.95, ca) - 0.5 * smoothstep(0.3, 0.95, -ca));
  // ---- dashes carried by the current: staggered rows across, a lens each, gathering by the banks ----
  float c = vRiver.y * (hw + ${BANK.toFixed(3)});
  vec2 q = vec2(s - T * 0.17, c) / vec2(0.5, 0.105);
  float row = floor(q.y);
  q.x += mod(row, 2.0) * 0.5;
  vec2 id = floor(q);
  float h = seaHash(id + 3.7);
  vec2 dc = (fract(q) - 0.5) * vec2(0.5, 0.105);
  float L = mix(0.11, 0.21, seaHash(id + 8.1));
  float gate = smoothstep(0.64, 0.76, seaNoise(p * 2.0) + 0.24 * (1.0 - smoothstep(0.0, hw, edge)));
  float dash = step(h, 0.6) * seaLens(dc, L, 0.0115 * (1.0 + 0.62 * clamp(dc.x / L, -1.0, 1.0)), aa) * gate;
  col = mix(col, gRiverRim, dash * 0.85);
  // ---- papertrails' river floaters and current lines (render/water.js there), riding the flow in two phases that
  // cross-fade so the pattern never shears: a leaf now and then with its shadow and midrib, faint long streaks ----
  float flo = 0.0, floSh = 0.0, floInk = 0.0, streak = 0.0;
  for (int i = 0; i < 2; i++) {
    float fph = fract(T / 7.0 + 0.5 * float(i));
    float tau = (fph - 0.5) * 7.0;
    float wgt = 1.0 - abs(2.0 * fph - 1.0);
    float sx = s - 0.17 * tau;
    float rowS = floor(c * 4.0 + 0.5 + 0.5 * float(i));
    float lnS = abs(fract(c * 4.0 + 0.5 * float(i) + 0.12 * sin(sx * 1.5708 + rowS)) - 0.5) / 4.0;
    streak += wgt * (1.0 - smoothstep(0.005, 0.005 + aa, lnS)) * smoothstep(0.35, 0.95, sin(sx * 3.1416 + rowS * 2.3));
    float fx = sx + 0.5 * float(i);
    float cls = mod(floor(fx), 4.0);
    vec2 fc = vec2(fract(fx) - 0.5, c - (mod(cls, 2.0) - 0.5) * 0.44 - (cls - 1.5) * 0.06);
    float fr = cls * 1.9 + 0.5 * sin(T * 0.5 + cls * 2.0) + float(i);
    vec2 fq = vec2(fc.x * cos(fr) - fc.y * sin(fr), fc.x * sin(fr) + fc.y * cos(fr));
    float keep = wgt * step(0.5, seaNoise(p * 0.75) + 0.25 * gRiverBlossom - 0.18 * mod(cls + float(i), 2.0));
    flo = max(flo, seaLens(fq, mix(0.1, 0.064, gRiverBlossom), mix(0.042, 0.032, gRiverBlossom), aa) * keep);
    floSh = max(floSh, seaLens(fq - vec2(0.024, 0.032), 0.11, 0.048, aa * 2.0) * keep);
    floInk = max(floInk, (1.0 - smoothstep(0.0, 0.008 + aa, abs(fq.y))) * 0.5);
  }
  col = mix(col, col * 1.1 + vec3(0.02, 0.03, 0.03), streak * 0.5 * smoothstep(0.35, 0.65, seaNoise(p * 0.75 + 50.0)) * smoothstep(0.05, 0.2, edge));
  col = mix(col, col * 0.72, floSh * 0.55);
  // (papertrails' river floater of the biome: a leaf, a petal in the blossom)
  vec3 leaf = RIVER_PAL(3);
  col = mix(col, mix(leaf, leaf * 0.62, floInk * 0.6), flo);
  gRiverMarks = clamp(dash + flo, 0.0, 1.0);
  // ---- the waterline: darker just inside the bank ----
  col *= 1.0 - 0.42 * (1.0 - smoothstep(0.0, 0.05, edge));
  col *= 1.0 + (seaFibre(p) - 0.5) * 1.1;
  return col;
}
vec3 riverColour() {
  vec2 p = vRiverPos.xz;
  gRiverRim = RIVER_PAL(2);
  gRiverBlossom = vRiverMix.y;
  float T = uTime;
  float s = vRiver.x;
  float hw = vRiver.z;
  float across = abs(vRiver.y) * (hw + ${BANK.toFixed(3)});
  // (never 0: smoothstep with equal edges is undefined and comes out NaN on some GPUs)
  float aa = max(fwidth(across) * 1.2, 1e-4);
  // the bank wobbles a little, hand cut
  float edge = hw + (seaNoise(p * 2.0) - 0.5) * 0.06 + (seaNoise(p * 7.0 + 3.0) - 0.5) * 0.025 - across;  // > 0 on the water
  if (edge < 0.0) {
    gMirror = vec3(0.0);
    gMirrorW = 0.0;
    return riverBank(p, -edge, aa);
  }
  vec3 col = riverWater(p, T, s, hw, across, edge, aa);
  mirrorImage(p, ${STREAM_Y.toFixed(3)}, col, 1.0 - gRiverMarks);
  return col;
}
`;
