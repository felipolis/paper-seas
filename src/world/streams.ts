/**
 * Streams (papertrails' rivers): long narrow printed water that winds across the land and never reaches the sea. A pure
 * function of the seed: the world is cut into REGION squares (papertrails' rivers lie about as far apart), and a
 * region may hold one river, which stays inside its square (so two rivers never meet). It rises at a spring well
 * inland, sets off the way with the most land ahead and winds on with a slow meander, turning away from the beach and
 * from its square's edges, until it has run its length or has nowhere left to go. Both ends are papertrails'
 * river_source, a little round pool among stones (world/terrain.ts); the river stops the feet, and it is crossed on
 * its own footbridges as well as where the roads bridge it.
 */
import { WORLD } from '../config/world';
import { hash01 } from '../core/rng';
import { clamp } from '../core/math';
import { valueNoise } from './noise';
import { boundsOf, overlaps, polylineDistance, type Box, type Pt } from './polyline';
import type { LandField } from './land';
import type { Bridge } from './roads';
import { cellKey } from '../core/grid';
import { BoundedCache } from '../core/bounded-cache';

const SEED = WORLD.seed;
/** One river at most per REGION x REGION square, with this chance (papertrails' rivers: about 43 units apart). */
const REGION = 48;
const RIVER_CHANCE = 0.8;
/** A river keeps this far inside its square's edges, and starts turning away from them this far off. */
const BORDER = 1.5;
const BORDER_TURN = 6;
/** Places tried for a spring in a square: the first well inland whose river runs long enough is the one. */
const SPRING_TRIES = 4;
/** A spring lies at least this far inland. */
const SPRING_INLAND = 4.5;
/** A river turns away from the beach once it comes this far inland, and ends if it comes within SINK_INLAND. */
const KEEP_INLAND = 3.5;
const SINK_INLAND = 2;
const STEP = 0.35;
/** A river runs between MIN_STEPS and MAX_STEPS steps (about 25 to 100 units; papertrails' rivers run on for chunks). */
const MIN_STEPS = 70;
const MAX_STEPS = 280;
/** The most a river turns in one step: its meander, and its turning away from the beach and its square's edges. */
const MEANDER = 0.12;
const TURN = 0.25;
/** A river ends rather than come back within this of its own water (points this many steps back and more). */
const SELF_CLEAR = 4;
const SELF_SKIP = 14;
/** A river ends rather than curl round: it may turn at most this much (radians, either way) over CURL_SPAN steps. */
const CURL = Math.PI;
const CURL_SPAN = 40;
/** How far ahead (and in how many ways) a spring looks for the way with the most land. */
const LOOK_AHEAD = 24;
const HEADINGS = 12;
/** Width (world units) at the spring, widening to its full width over its first WIDEN points (papertrails' river: 0.7). */
const WIDTH_SPRING = 0.5;
const WIDTH_FULL = 0.8;
const WIDEN = 40;
/** A footbridge every this many units along a river, the first half that from its spring, none this near its end. */
const BRIDGE_EVERY = 14;
const BRIDGE_END = 4;

export interface Stream {
  id: number;
  pts: Pt[];
  box: Box;
  /** Its footbridges (the roads that cross it bring their own). */
  bridges: Bridge[];
}

export class Streams {
  private readonly cache = new BoundedCache<number, Stream | null>();

  constructor(private readonly land: LandField) {}

  /** The width of a stream at index i of its points (i may fall between two). */
  static widthAt(i: number): number {
    return WIDTH_SPRING + (WIDTH_FULL - WIDTH_SPRING) * Math.min(1, i / WIDEN);
  }

  /** Streams that come within the box (each keeps inside its own square). */
  near(box: Box): Stream[] {
    const out: Stream[] = [];
    for (let j = Math.floor(box[1] / REGION); j <= Math.floor(box[3] / REGION); j++) {
      for (let i = Math.floor(box[0] / REGION); i <= Math.floor(box[2] / REGION); i++) {
        const s = this.stream(i, j);
        if (s && overlaps(s.box, box)) out.push(s);
      }
    }
    return out;
  }

  /** True if (x, z) lies on the water of a stream (inside its banks, plus `margin`). */
  waterAt(x: number, z: number, margin = 0): boolean {
    return this.bankDistance(x, z, margin + 1) < margin;
  }

  /**
   * Distance from (x, z) to the nearest stream's bank (negative on the water). Only the streams that come within reach
   * of the point are measured: with none there it is Infinity.
   */
  bankDistance(x: number, z: number, reach = 1): number {
    let best = Infinity;
    for (const s of this.near([x - reach, z - reach, x + reach, z + reach])) {
      const [d, at] = polylineDistance(s.pts, x, z);
      best = Math.min(best, d - Streams.widthAt(at) / 2);
    }
    return best;
  }

  private stream(i: number, j: number): Stream | null {
    return this.cache.get(cellKey(i, j), () => this.river(i, j));
  }

  /** The river of square (i, j), or null: from the first spring tried whose river runs at least MIN_STEPS. */
  private river(i: number, j: number): Stream | null {
    if (hash01(SEED + 401, i, j) >= RIVER_CHANCE) return null;
    for (let t = 0; t < SPRING_TRIES; t++) {
      // (well inside the square, so the river has room every way)
      const x = (i + 0.2 + 0.6 * hash01(SEED + 403 + t * 7, i, j)) * REGION;
      const z = (j + 0.2 + 0.6 * hash01(SEED + 409 + t * 7, i, j)) * REGION;
      if (this.land.distance(x, z) > -SPRING_INLAND) continue;
      const pts = this.trace(i, j, x, z);
      if (pts.length > MIN_STEPS) return { id: i * 100003 + j, pts, box: boundsOf(pts, WIDTH_FULL), bridges: footbridges(pts) };
    }
    return null;
  }

  /** A river's course from its spring at (x, z) in square (i, j). */
  private trace(i: number, j: number, x: number, z: number): Pt[] {
    const land = this.land;
    const lo: Pt = [i * REGION + BORDER, j * REGION + BORDER];
    const hi: Pt = [(i + 1) * REGION - BORDER, (j + 1) * REGION - BORDER];
    const inside = (px: number, pz: number) => px > lo[0] && px < hi[0] && pz > lo[1] && pz < hi[1];
    // the shore's outward direction (the shore distance's slope)
    const out = (px: number, pz: number): Pt => {
      const e = 0.5;
      const gx = land.distance(px + e, pz) - land.distance(px - e, pz);
      const gz = land.distance(px, pz + e) - land.distance(px, pz - e);
      const l = Math.hypot(gx, gz) || 1;
      return [gx / l, gz / l];
    };
    // it sets off the way with the most land ahead (the first of the best, from a heading of its own)
    const turn = hash01(SEED + 413, i, j) * Math.PI * 2;
    let best = -1;
    let [dx, dz] = [1, 0];
    for (let h = 0; h < HEADINGS; h++) {
      const a = turn + (h / HEADINGS) * Math.PI * 2;
      const [ux, uz] = [Math.cos(a), Math.sin(a)];
      let run = 0;
      while (run < LOOK_AHEAD && inside(x + ux * run, z + uz * run) && land.distance(x + ux * run, z + uz * run) < -KEEP_INLAND) run++;
      if (run > best) [best, dx, dz] = [run, ux, uz];
    }
    const pts: Pt[] = [[x, z]];
    const phase = hash01(SEED + 419, i, j) * 100;
    const length = MIN_STEPS + Math.floor(hash01(SEED + 421, i, j) * (MAX_STEPS - MIN_STEPS));
    // (how far it has turned at each step, to see it curl)
    const turns: number[] = [];
    while (pts.length <= length) {
      // a slow meander across the way it runs
      const m = (valueNoise(SEED + 423, x / 9 + phase, z / 9) - 0.5) * 2 * MEANDER;
      let nx = dx - dz * m;
      let nz = dz + dx * m;
      // turning away from the beach, harder the nearer it comes
      const [gx, gz] = out(x, z);
      const beach = clamp((land.distance(x, z) + KEEP_INLAND + 2) / 2, 0, 1) * TURN;
      nx -= gx * beach;
      nz -= gz * beach;
      // and from its square's edges
      nx += (clamp(1 - (x - lo[0]) / BORDER_TURN, 0, 1) - clamp(1 - (hi[0] - x) / BORDER_TURN, 0, 1)) * TURN;
      nz += (clamp(1 - (z - lo[1]) / BORDER_TURN, 0, 1) - clamp(1 - (hi[1] - z) / BORDER_TURN, 0, 1)) * TURN;
      const l = Math.hypot(nx, nz) || 1;
      turns.push(Math.atan2(dx * nz - dz * nx, dx * nx + dz * nz));
      dx = nx / l;
      dz = nz / l;
      const px = x + dx * STEP;
      const pz = z + dz * STEP;
      // nowhere left to go: the beach, its square's edge, its own water ahead, or only round in a curl
      if (!inside(px, pz) || land.distance(px, pz) > -SINK_INLAND) break;
      if (pts.some(([qx, qz], k) => k < pts.length - SELF_SKIP && Math.hypot(qx - px, qz - pz) < SELF_CLEAR)) break;
      if (Math.abs(turns.slice(-CURL_SPAN).reduce((a, t) => a + t, 0)) > CURL) break;
      x = px;
      z = pz;
      pts.push([x, z]);
    }
    return pts;
  }
}

/** A river's footbridges: one every BRIDGE_EVERY units, each where the river runs straightest near there. */
function footbridges(pts: Pt[]): Bridge[] {
  const out: Bridge[] = [];
  const every = Math.round(BRIDGE_EVERY / STEP);
  const last = pts.length - 1 - Math.round(BRIDGE_END / STEP);
  for (let at = Math.round(every / 2); at <= last; at += every) {
    // (the straightest point within a few either side: the least turn between its neighbours)
    let pick = at;
    let least = Infinity;
    for (let k = Math.max(2, at - 4); k <= Math.min(last, at + 4); k++) {
      const [a, b, c] = [pts[k - 2], pts[k], pts[k + 2]];
      const bend = Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]));
      const t = Math.min(bend, Math.PI * 2 - bend);
      if (t < least) [least, pick] = [t, k];
    }
    const [a, c] = [pts[pick - 2], pts[pick + 2]];
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    // (the deck runs across the river)
    out.push({ x: pts[pick][0], z: pts[pick][1], dx: -(c[1] - a[1]) / l, dz: (c[0] - a[0]) / l });
  }
  return out;
}
