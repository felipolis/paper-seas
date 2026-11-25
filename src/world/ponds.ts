/**
 * Little ponds (papertrails' pond tile: still water with reeds round it, a duck on it, lily pads), a pure function of
 * the seed: one at most per SITE_CELL square, with POND_CHANCE, at a spot well inland on level meadow, pine wood or
 * jungle ground, clear of the streams, the roads and the villages (it is placed after them, and nothing routes round
 * it). Its rim is a circle wobbled by two slow waves, so no two ponds have the same shore.
 */
import { WORLD } from '../config/world';
import { hash01, hash2, mulberry32 } from '../core/rng';
import { SITE_CELL } from './sites';
import type { LandField } from './land';

const SEED = WORLD.seed;
/** Share of the squares that hold a pond, and the spots tried in one. */
const POND_CHANCE = 0.5;
const TRIES = 10;
/** Radius range (world units: papertrails' pond tile holds about 1.4 of water across). */
const RADIUS: [number, number] = [0.75, 1.15];
/** The shore wobble: the two waves' largest share of the radius. */
const WOBBLE = [0.12, 0.08];
/** Kept this far (beyond its rim) inland, and from a stream, a road and a village. */
const INLAND = 2;
const STREAM_CLEAR = 2.5;
const ROAD_CLEAR = 1.2;
const SITE_CLEAR = 6;
/** The biomes ponds lie in. */
const BIOMES = new Set(['meadow', 'pine', 'jungle']);

export interface Pond {
  id: number;
  x: number;
  z: number;
  r: number;
  /** The shore's two waves: amplitude and phase of the 2- and 3-lobed one. */
  wave: [number, number, number, number];
}

/** What a pond keeps clear of: a stream / a road within r, a village near. */
export interface PondAvoid {
  stream(x: number, z: number, r: number): boolean;
  road(x: number, z: number, r: number): boolean;
  site(x: number, z: number, r: number): boolean;
}

/** The pond's radius toward angle a (radians from +x toward +z). */
export function pondRadius(p: Pond, a: number): number {
  return p.r * (1 + p.wave[0] * Math.sin(2 * a + p.wave[1]) + p.wave[2] * Math.sin(3 * a + p.wave[3]));
}

/** Distance from (x, z) to the pond's shore (negative on the water). */
export function pondDistance(p: Pond, x: number, z: number): number {
  const dx = x - p.x;
  const dz = z - p.z;
  return Math.hypot(dx, dz) - pondRadius(p, Math.atan2(dz, dx));
}

/** The pond of square (i, j), or null. */
export function pondIn(land: LandField, avoid: PondAvoid, i: number, j: number): Pond | null {
  if (hash01(SEED ^ 89, i, j) >= POND_CHANCE) return null;
  const rng = mulberry32(hash2(SEED ^ 97, i, j));
  for (let t = 0; t < TRIES; t++) {
    const x = (i + 0.15 + 0.7 * rng()) * SITE_CELL;
    const z = (j + 0.15 + 0.7 * rng()) * SITE_CELL;
    const r = RADIUS[0] + rng() * (RADIUS[1] - RADIUS[0]);
    const wave: Pond['wave'] = [WOBBLE[0] * rng(), rng() * Math.PI * 2, WOBBLE[1] * rng(), rng() * Math.PI * 2];
    const d = land.distance(x, z);
    if (d > -(r + INLAND) || !BIOMES.has(land.biome(x, z, d))) continue;
    // (level ground: the whole rim on the centre's band)
    const band = land.terraceAt(x, z, d);
    let level = band <= 1;
    for (let k = 0; k < 8 && level; k++) level = land.terraceAt(x + Math.cos(k * 0.785) * (r + 0.4), z + Math.sin(k * 0.785) * (r + 0.4)) === band;
    if (!level || avoid.stream(x, z, r + STREAM_CLEAR) || avoid.road(x, z, r + ROAD_CLEAR) || avoid.site(x, z, SITE_CLEAR)) continue;
    return { id: hash2(SEED ^ 101, i, j), x, z, r, wave };
  }
  return null;
}
