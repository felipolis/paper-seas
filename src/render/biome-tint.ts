/**
 * papertrails' biome tints (config/world.js biomeTint, world/book.js biomeTintUniforms there): its page has one ground
 * colour and one set of prints, and each biome turns them its own way with a colour transform (a hue turn, a
 * saturation, a tint mixed in with a gain and a lift). heartland is the identity. Ours take its rows: the meadow its
 * blossom, the pine woods its pinewood, the jungle and the rocks its heartland. (Its desert and snow have no biome of
 * ours; the beach is the coast's fringe of the biome inland, world/land.ts biomeInland.)
 *
 *   ground  the printed land (world/terrain.ts bakes it into the ground print)
 *   prop    every standing card and model of the biome (a material variant per biome, tintMaterial)
 *   path    the tone the trodden roads take there (world/ground-shader.ts)
 *   water   the streams' colours there (world/stream-mesh.ts)
 */
import * as THREE from 'three';
import type { Biome } from '../world/land';
import { paperCopy } from './paper-material';

type Row = 'heartland' | 'blossom' | 'pinewood';

interface Transform {
  hue?: number;
  sat?: number;
  tint?: string;
  amount?: number;
  gain?: number;
  lift?: number;
  mul?: number;
  keepWater?: number;
}

/** papertrails' table, as it is. */
const TINTS: Record<Exclude<Row, 'heartland'>, { ground: Transform; prop: Transform; path: { color: string; amount: number } }> = {
  blossom: {
    ground: { hue: 14, sat: 1.15, tint: '#9cc468', amount: 0.3, gain: 1.6, lift: 0.55, keepWater: 0.9 },
    prop: { hue: -5, sat: 1.04, tint: '#f7bfcd', amount: 0.07, gain: 1.0, lift: 0.35, keepWater: 0.9 },
    path: { color: '#f1e3c2', amount: 0.6 },
  },
  pinewood: {
    ground: { hue: 10, sat: 0.9, tint: '#55766a', amount: 0.62, gain: 1.6, lift: 0.5, keepWater: 0.7 },
    prop: { hue: 34, sat: 0.85, tint: '#4d7468', amount: 0.36, gain: 1.5, lift: 0.4, mul: 0.92, keepWater: 0.7 },
    path: { color: '#c2b187', amount: 0.75 },
  },
};

/** papertrails' water per biome (render/water.js WATER_DEFAULTS.palette there): shallow, deep, rim, river floater. */
const WATER: Record<Row, [string, string, string, string]> = {
  heartland: ['#6fc4b0', '#1f8f8a', '#f6e6bc', '#dc9440'],
  blossom: ['#72c2ae', '#218a82', '#f6e4cc', '#f4a3b3'],
  pinewood: ['#58988a', '#1f5f5c', '#cfc49c', '#c7933d'],
};
const WATER_ROWS: readonly Row[] = ['heartland', 'blossom', 'pinewood'];

/** Which of papertrails' biomes each of ours takes. */
const ROWS: Record<Biome, Row> = { jungle: 'heartland', rocky: 'heartland', meadow: 'blossom', pine: 'pinewood', beach: 'heartland' };

/**
 * papertrails' biomeTintKeep: in the blossom the prop tint passes over reeds, rocks, haystacks, fences, roofs and logs
 * (they keep their own colours).
 */
const BLOSSOM_KEEP = /^(cattails|papyrus|rock-|crag-|hay$|fence-|log$|stump$|woodpile$)/;

/** A colour transform: three rows (r, g, b) of [x, y, z, w] (rgb = rows · c + w), in linear colour. */
export type TintRows = [number, number, number, number][];

/** papertrails' transform matrix (hue rotation about the luma axis, then saturation, then the tint). */
function rowsOf(t: Transform): TintRows {
  const L = [0.2126, 0.7152, 0.0722];
  const amount = t.amount ?? 0;
  const sat = t.sat ?? 1;
  const mul = t.mul ?? 1;
  const gain = t.gain ?? 1;
  const lift = t.lift ?? 0;
  const h = ((t.hue ?? 0) * Math.PI) / 180;
  const tint = new THREE.Color(t.tint ?? '#ffffff');
  const tc = [tint.r, tint.g, tint.b];
  const c = Math.cos(h);
  const s = Math.sin(h);
  const H = [
    [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
    [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283],
    [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
  ];
  return [0, 1, 2].map((i) => {
    const row: [number, number, number, number] = [0, 0, 0, mul * amount * tc[i] * lift];
    for (let j = 0; j < 3; j++) {
      let sh = 0;
      for (let k = 0; k < 3; k++) sh += ((i === k ? sat : 0) + (1 - sat) * L[k]) * H[k][j];
      row[j] = mul * ((1 - amount) * sh + amount * tc[i] * gain * L[j]);
    }
    return row;
  });
}

const groundRows = new Map<Row, TintRows | null>();

/** The ground transform of a biome (null: the identity). */
export function groundTint(biome: Biome): TintRows | null {
  const row = ROWS[biome];
  if (!groundRows.has(row)) groundRows.set(row, row === 'heartland' ? null : rowsOf(TINTS[row].ground));
  return groundRows.get(row)!;
}

/** Applies a transform to a linear colour in place (papertrails' biomeTintGround: clamped at 0). */
export function applyTint(rows: TintRows, c: [number, number, number]): void {
  const [r, g, b] = c;
  for (let i = 0; i < 3; i++) c[i] = Math.max(0, rows[i][0] * r + rows[i][1] * g + rows[i][2] * b + rows[i][3]);
}

/** The tone a road takes in a biome (linear rgb) and how much of it (papertrails' min(amount, 0.9)); null: none. */
export function pathTone(biome: Biome): [number, number, number, number] | null {
  const row = ROWS[biome];
  if (row === 'heartland') return null;
  const t = TINTS[row].path;
  const c = new THREE.Color(t.color);
  return [c.r, c.g, c.b, Math.min(t.amount, 0.9)];
}

const variants = new WeakMap<THREE.Material, Map<Row, THREE.Material>>();

/**
 * The material of a piece standing in a biome: the paper material itself in a heartland, else a variant carrying the
 * biome's prop transform (paper-material.ts PAPER_TINT). sprite: the piece's name (the blossom keeps some as they are).
 */
export function tintMaterial<M extends THREE.Material>(mat: M, biome: Biome, sprite = ''): M {
  const row = ROWS[biome];
  if (row === 'heartland' || (row === 'blossom' && BLOSSOM_KEEP.test(sprite))) return mat;
  let byRow = variants.get(mat);
  if (!byRow) variants.set(mat, (byRow = new Map()));
  let v = byRow.get(row);
  if (!v) {
    const t = TINTS[row].prop;
    const rows = rowsOf(t);
    const vec = (r: number[]) => `vec4(${r.map((x) => x.toFixed(5)).join(', ')})`;
    v = paperCopy(mat);
    v.defines = { ...v.defines, PAPER_TINT: '', PAPER_TINT_R: vec(rows[0]), PAPER_TINT_G: vec(rows[1]), PAPER_TINT_B: vec(rows[2]), PAPER_TINT_KEEP: (t.keepWater ?? 0).toFixed(3) };
    byRow.set(row, v);
  }
  return v as M;
}

/** The water palettes (linear), row after row in waterRow's order: shallow, deep, rim and floater of each. */
export function waterPalettes(): THREE.Color[] {
  return WATER_ROWS.flatMap((row) => WATER[row].map((hex) => new THREE.Color(hex)));
}

/** Which water row a biome takes (0 heartland, 1 blossom, 2 pinewood). */
export function waterRow(biome: Biome): number {
  return WATER_ROWS.indexOf(ROWS[biome]);
}
