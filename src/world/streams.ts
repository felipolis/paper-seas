/**
 * Streams (papertrails' rivers): narrow printed water that rises at a spring well inland and runs down to the sea,
 * cutting the land in two. A pure function of the seed: the world is cut into REGION squares, and a region may hold
 * one spring (well inland); from it the stream walks downhill (toward the nearest shore, the gradient of the shore
 * distance) with a slow meander, until it pours into the sea. A stream rises in a little round pool among stones and
 * ends in an inlet the sea cuts up its bed (world/terrain.ts); it stops the feet (the roads cross it on bridges).
 */
import { WORLD } from '../config/world';
import { hash01 } from '../core/rng';
import { valueNoise } from './noise';
import { boundsOf, overlaps, polylineDistance, type Box, type Pt } from './polyline';
import type { LandField } from './land';
import { cellKey } from '../core/grid';

const SEED = WORLD.seed;
/** One spring at most per REGION x REGION square, with this chance. */
const REGION = 26;
const SPRING_CHANCE = 0.75;
/** A spring lies at least this far inland. */
const SPRING_INLAND = 4.5;
const STEP = 0.35;
/** A stream runs at most this many steps (about 100 units): a spring further from the sea has no stream. */
const MAX_STEPS = 300;
/** Width (world units) at the spring and at the mouth (papertrails' river: 0.7). */
const WIDTH_SPRING = 0.5;
const WIDTH_MOUTH = 0.8;
/** How far the farthest stream can reach from its spring (bounds the search for streams near a point). */
const MAX_REACH = STEP * MAX_STEPS;

export interface Stream {
  id: number;
  pts: Pt[];
  box: Box;
}

export class Streams {
  private readonly cache = new Map<number, Stream | null>();

  constructor(private readonly land: LandField) {}

  /** The width of a stream at index i of its points. */
  static widthAt(s: Stream, i: number): number {
    return WIDTH_SPRING + (WIDTH_MOUTH - WIDTH_SPRING) * Math.min(1, i / Math.max(1, s.pts.length - 1));
  }

  /** Streams that come within the box. */
  near(box: Box): Stream[] {
    const out: Stream[] = [];
    const r = Math.ceil(MAX_REACH / REGION);
    const ci = Math.floor((box[0] + box[2]) / 2 / REGION);
    const cj = Math.floor((box[1] + box[3]) / 2 / REGION);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        const s = this.stream(i, j);
        if (s && overlaps(s.box, box)) out.push(s);
      }
    }
    return out;
  }

  /** True if (x, z) lies on the water of a stream (inside its banks, plus `margin`). */
  waterAt(x: number, z: number, margin = 0): boolean {
    return this.bankDistance(x, z) < margin;
  }

  /** Distance from (x, z) to the nearest stream's bank (negative on the water; large when none is near). */
  bankDistance(x: number, z: number): number {
    let best = Infinity;
    for (const s of this.near([x - 1, z - 1, x + 1, z + 1])) {
      const [d, at] = polylineDistance(s.pts, x, z);
      best = Math.min(best, d - Streams.widthAt(s, at) / 2);
    }
    return best;
  }

  private stream(i: number, j: number): Stream | null {
    const key = cellKey(i, j);
    let s = this.cache.get(key);
    if (s === undefined) {
      s = this.trace(i, j);
      this.cache.set(key, s);
    }
    return s;
  }

  private trace(i: number, j: number): Stream | null {
    if (hash01(SEED + 401, i, j) >= SPRING_CHANCE) return null;
    let x = (i + 0.15 + 0.7 * hash01(SEED + 403, i, j)) * REGION;
    let z = (j + 0.15 + 0.7 * hash01(SEED + 409, i, j)) * REGION;
    if (this.land.distance(x, z) > -SPRING_INLAND) return null;
    const land = this.land;
    const grad = (px: number, pz: number): Pt => {
      const e = 0.5;
      const gx = land.distance(px + e, pz) - land.distance(px - e, pz);
      const gz = land.distance(px, pz + e) - land.distance(px, pz - e);
      const l = Math.hypot(gx, gz) || 1;
      return [gx / l, gz / l];
    };
    let [dx, dz] = grad(x, z);
    const pts: Pt[] = [[x, z]];
    const phase = hash01(SEED + 419, i, j) * 100;
    let best = land.distance(x, z);
    let sinceBetter = 0;
    for (let n = 0; n < MAX_STEPS; n++) {
      const [gx, gz] = grad(x, z);
      // a slow meander across the way down
      const m = (valueNoise(SEED + 421, x / 7 + phase, z / 7) - 0.5) * 1.6;
      const nx = dx * 0.6 + gx * 0.4 - gz * m * 0.35;
      const nz = dz * 0.6 + gz * 0.4 + gx * m * 0.35;
      const l = Math.hypot(nx, nz) || 1;
      dx = nx / l;
      dz = nz / l;
      x += dx * STEP;
      z += dz * STEP;
      pts.push([x, z]);
      const d = land.distance(x, z);
      if (d > 0.5) return { id: i * 100003 + j, pts, box: boundsOf(pts, WIDTH_MOUTH) };
      // never circling: it must keep getting closer to the shore
      if (d > best + 0.05) {
        best = d;
        sinceBetter = 0;
      } else if (++sinceBetter > 40) return null;
    }
    return null;
  }
}
