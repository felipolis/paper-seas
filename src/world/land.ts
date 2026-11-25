/**
 * The land of the world as one continuous field (a pure function of the seed):
 *
 *   continents  domain-warped fBm above a threshold: big landmasses with ragged coasts, bays and peninsulas
 *   channels    two families of winding noise "valleys" carved through the land: wide sounds and narrow rivers the
 *               ship can sail into, so a continent is a maze of waterways rather than a wall
 *   islands     the hand-shaped islands of IslandLayout (atolls, twins, crescents...) stamped into open sea
 *
 * distance(x, z) is an approximate signed distance to the shore in world units (< 0 on land). The land is one flat
 * sheet (LAND_TOP); inland it is printed in bands that change with the distance from the coast (and a highland noise),
 * and biomes vary with two more noises.
 */
import { WORLD } from '../config/world';
import { clamp, smoothstep } from '../core/math';
import { fbm, valueNoise } from './noise';
import { IslandLayout, shoreDistance, type IslandSpec } from './island-layout';
import { BoundedCache } from '../core/bounded-cache';

export type Biome = 'beach' | 'jungle' | 'pine' | 'meadow' | 'rocky';
/** Every biome. */
export const BIOMES: readonly Biome[] = ['beach', 'jungle', 'pine', 'meadow', 'rocky'];

/**
 * The land is one sheet of paper laid on the sea page, this thick (papertrails' page is flat: the relief is all in
 * the standing cards). Inland it is printed in bands (sand, grass, hills, heights: terraceAt) that only choose what
 * is printed and planted there.
 */
export const LAND_TOP = 0.1;

const SEED = WORLD.seed;
const CONTINENT_SCALE = 1 / 115;
const CONTINENT_LEVEL = 0.57;
/** Approximate world units per unit of noise across a coast (turns noise values into distances). */
const CONTINENT_DIST = 80;
const SOUND_SCALE = 1 / 60;
const SOUND_WIDTH = 0.052;
const RIVER_SCALE = 1 / 42;
const RIVER_WIDTH = 0.05;

export class LandField {
  readonly layout = new IslandLayout();
  private readonly stampCache = new BoundedCache<number, boolean>();
  private readonly scratch: IslandSpec[] = [];

  /** Continental field only (no stamped islands), world units, < 0 on land. */
  continent(x: number, z: number): number {
    const wx = (fbm(SEED + 31, x / 90, z / 90, 2) - 0.5) * 2.2;
    const wz = (fbm(SEED + 37, x / 90 + 7.1, z / 90 - 3.4, 2) - 0.5) * 2.2;
    const n = fbm(SEED + 11, x * CONTINENT_SCALE + wx, z * CONTINENT_SCALE + wz, 5, 0.52);
    let d = (CONTINENT_LEVEL - n) * CONTINENT_DIST;
    // sounds: wide winding waterways
    const s = fbm(SEED + 53, x * SOUND_SCALE + wz * 0.5, z * SOUND_SCALE + wx * 0.5, 3);
    // sounds and rivers only cut through some regions (masks), so big unbroken interiors remain elsewhere
    const soundMask = smoothstep(0.42, 0.58, fbm(SEED + 79, x / 140, z / 140, 2));
    const ds = (Math.abs(s - 0.5) - SOUND_WIDTH) * 50 + (1 - soundMask) * 60;
    // rivers: narrower, they only cut the land further inland
    const r = fbm(SEED + 71, x * RIVER_SCALE - wx * 0.4, z * RIVER_SCALE + wz * 0.4, 3);
    const riverMask = smoothstep(0.5, 0.62, fbm(SEED + 83, x / 110, z / 110, 2));
    const dr = (Math.abs(r - 0.5) - RIVER_WIDTH) * 25 + (1 - riverMask) * 60;
    // (fading in smoothly with the distance from the coast, so rivers never nick the shoreline)
    d = Math.max(d, -ds, -dr - Math.max(0, d + 6) * 2.5);
    return d;
  }

  /** Signed distance to the nearest shore (world units, < 0 on land). */
  distance(x: number, z: number): number {
    let d = this.continent(x, z);
    if (d > -2) {
      for (const s of this.layout.near(x, z, 2, this.scratch)) {
        if (!this.accepts(s)) continue;
        d = Math.min(d, shoreDistance(s, x, z));
      }
    }
    return d;
  }

  /** Outward shore normal at (x, z). */
  normal(x: number, z: number): [number, number] {
    const e = 0.06;
    const gx = this.distance(x + e, z) - this.distance(x - e, z);
    const gz = this.distance(x, z + e) - this.distance(x, z - e);
    const l = Math.hypot(gx, gz) || 1;
    return [gx / l, gz / l];
  }

  /** Stamped islands only stand in open sea (well away from any continent). */
  accepts(s: IslandSpec): boolean {
    return this.stampCache.get(s.id, () => {
      const R = s.shape.extent + 7;
      for (let a = 0; a < 8; a++) {
        const x = s.x + Math.cos((a / 8) * Math.PI * 2) * R;
        const z = s.z + Math.sin((a / 8) * Math.PI * 2) * R;
        if (this.continent(x, z) < 3) return false;
      }
      return this.continent(s.x, s.z) >= s.shape.extent + 4;
    });
  }

  /** Stamped islands near a point (accepted ones). */
  islandsNear(x: number, z: number, r: number): IslandSpec[] {
    return this.layout.near(x, z, r, []).filter((s) => this.accepts(s));
  }

  /** Highland strength 0..1 (where the printed bands turn to hills and heights sooner). */
  highland(x: number, z: number): number {
    return fbm(SEED + 91, x / 40, z / 40, 3);
  }

  /** Inland distance thresholds for each terrace above the sand (grass, hill, high). */
  terraceThresholds(x: number, z: number): [number, number, number] {
    const h = this.highland(x, z);
    const w = valueNoise(SEED + 97, x / 6, z / 6);
    return [
      0.65 + 0.5 * w,
      // hills come close behind the beach even on small islands; the heights lie well inland
      2.2 + 1.5 * w - 1.2 * smoothstep(0.45, 0.75, h) + 3 * (1 - smoothstep(0.25, 0.45, h)),
      4.6 + 2 * w - 1.8 * smoothstep(0.55, 0.8, h) + 6 * (1 - smoothstep(0.38, 0.55, h)),
    ];
  }

  /** Printed band at a land point (0 sand, 1 grass, 2 hills, 3 heights), -1 in the water. */
  terraceAt(x: number, z: number, d = this.distance(x, z)): number {
    if (d >= 0) return -1;
    const inland = -d;
    const [g, hl, hi] = this.terraceThresholds(x, z);
    return inland > hi ? 3 : inland > hl ? 2 : inland > g ? 1 : 0;
  }

  /** Height of the ground at a point: the top of the land sheet, or the sea page. */
  groundHeight(x: number, z: number): number {
    return this.distance(x, z) < 0 ? LAND_TOP : 0;
  }

  /** The biome of the land a point belongs to, the coast's fringe taking the one inland of it (never 'beach'). */
  biomeInland(x: number, z: number): Biome {
    return this.biome(x, z, Math.min(-2, this.distance(x, z)));
  }

  /** The biome at a point (d: its shore distance): the beach along the coast, else by moisture and cold. */
  biome(x: number, z: number, d = this.distance(x, z)): Biome {
    if (d > -1.1) return 'beach';
    const wet = fbm(SEED + 113, x / 34, z / 34, 3);
    const cold = fbm(SEED + 127, x / 48, z / 48, 2) + 0.25 * smoothstep(0.5, 0.8, this.highland(x, z));
    if (cold > 0.66) return 'pine';
    if (wet > 0.56) return 'jungle';
    if (wet < 0.4) return clamp(cold, 0, 1) > 0.52 ? 'rocky' : 'meadow';
    return cold > 0.55 ? 'pine' : 'jungle';
  }
}
