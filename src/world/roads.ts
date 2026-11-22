/**
 * Roads between the places where people live (papertrails' road network, world/wfc.js there): every settlement is
 * joined to its two nearest neighbours within MAX_LINK (and every ruin to its nearest settlement), so the roads make
 * a network that always leads somewhere. Each road is routed over the land on a 1-unit grid by A* with papertrails'
 * costs: a little noise so it wanders, a price on every turn so it runs in long gentle stretches, the hills dear and
 * the heights barred, other villages avoided; it never goes into the sea, and crosses a stream only straight over
 * (a bridge). The route is then rounded off (Chaikin) and resampled.
 */
import { WORLD } from '../config/world';
import { valueNoise } from './noise';
import { boundsOf, chaikin, polylineDistance, resample, segmentCross, type Box, type Pt } from './polyline';
import type { LandField } from './land';
import type { Site } from './sites';
import type { Stream } from './streams';

const SEED = WORLD.seed;
/** Longest road between two settlements, and from a ruin to its settlement. */
export const MAX_LINK = 46;
export const MAX_RUINS_LINK = 32;
const GRID = 1;
/** The route is searched within the box of its two ends grown by this much (the road never leaves it). */
export const ROUTE_PAD = 10;
/** Costs per cell: noise amplitude, a 45-degree turn, a hill, crossing a stream, near another village. */
const NOISE = 1.6;
const TURN = 0.6;
const HILL = 5;
const BRIDGE = 0.6;
const ALONG_STREAM = 6;
const VILLAGE = 6;
/** Stays this far inland (shore distance), so the rounded road never touches the water. */
const INLAND = 0.8;
/** Road width on the print (papertrails: 0.5). */
export const ROAD_WIDTH = 0.5;

export interface Bridge {
  x: number;
  z: number;
  /** Unit direction of the road across it. */
  dx: number;
  dz: number;
}

export interface Road {
  id: string;
  pts: Pt[];
  bridges: Bridge[];
  box: Box;
}

const DIRS: Array<[number, number]> = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** A small binary min-heap of (key, value). */
class Heap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(k: number, v: number): void {
    const K = this.keys;
    const V = this.vals;
    let i = K.length;
    K.push(k);
    V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p];
      V[i] = V[p];
      i = p;
    }
    K[i] = k;
    V[i] = v;
  }
  pop(): number {
    const K = this.keys;
    const V = this.vals;
    const top = V[0];
    const k = K.pop()!;
    const v = V.pop()!;
    if (K.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= K.length) break;
        const c = l + 1 < K.length && K[l + 1] < K[l] ? l + 1 : l;
        if (K[c] >= k) break;
        K[i] = K[c];
        V[i] = V[c];
        i = c;
      }
      K[i] = k;
      V[i] = v;
    }
    return top;
  }
}

/**
 * Routes a road from a to b, or returns null when they are not joined by land. others: the squares of other
 * settlements (avoided); streams: the streams round the way.
 */
export function routeRoad(land: LandField, a: Site, b: Site, others: Site[], streams: Stream[]): Road | null {
  const x0 = Math.floor(Math.min(a.x, b.x) - ROUTE_PAD);
  const z0 = Math.floor(Math.min(a.z, b.z) - ROUTE_PAD);
  const nx = Math.ceil(Math.max(a.x, b.x) + ROUTE_PAD - x0) + 1;
  const nz = Math.ceil(Math.max(a.z, b.z) + ROUTE_PAD - z0) + 1;
  const N = nx * nz;
  // per cell: its own cost (Infinity = barred), and whether it is a stream
  const cost = new Float32Array(N);
  const water = new Uint8Array(N);
  const ia = Math.round((a.x - x0) / GRID) + Math.round((a.z - z0) / GRID) * nx;
  const ib = Math.round((b.x - x0) / GRID) + Math.round((b.z - z0) / GRID) * nx;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * GRID;
      const z = z0 + j * GRID;
      const k = j * nx + i;
      const d = land.distance(x, z);
      const t = d < 0 ? land.terraceAt(x, z, d) : -1;
      let c = 1 + NOISE * valueNoise(SEED + 511, x / 5, z / 5);
      if (d > -INLAND || t === 3) c = Infinity;
      else if (t === 2) c += HILL;
      for (const s of others) if (Math.hypot(s.x - x, s.z - z) < 4) c += VILLAGE;
      cost[k] = c;
    }
  }
  // streams marked three cells wide (no diagonal slips between their cells): crossing one costs BRIDGE once and
  // ALONG_STREAM twice, so the cheapest crossing is the shortest, straight over
  for (const s of streams) {
    for (const [px, pz] of s.pts) {
      const ci = Math.round((px - x0) / GRID);
      const cj = Math.round((pz - z0) / GRID);
      for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) if (i >= 0 && j >= 0 && i < nx && j < nz) water[j * nx + i] = 1;
    }
  }
  cost[ia] = cost[ib] = 1;
  // A* over (cell, heading)
  const S = N * 8;
  const g = new Float32Array(S).fill(Infinity);
  const from = new Int32Array(S).fill(-1);
  const heap = new Heap();
  const bx = ib % nx;
  const bz = Math.floor(ib / nx);
  const h = (k: number) => Math.hypot((k % nx) - bx, Math.floor(k / nx) - bz) * 1;
  for (let d = 0; d < 8; d++) {
    g[ia * 8 + d] = 0;
    heap.push(h(ia), ia * 8 + d);
  }
  let end = -1;
  while (heap.size) {
    const st = heap.pop();
    const k = st >> 3;
    const dir = st & 7;
    if (k === ib) {
      end = st;
      break;
    }
    const ci = k % nx;
    const cj = Math.floor(k / nx);
    const gs = g[st];
    for (let nd = 0; nd < 8; nd++) {
      const turn = Math.min((nd - dir + 8) % 8, (dir - nd + 8) % 8);
      if (turn > 2) continue;
      const ni = ci + DIRS[nd][0];
      const nj = cj + DIRS[nd][1];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const nk = nj * nx + ni;
      let c = cost[nk];
      if (c === Infinity) continue;
      if (water[nk]) c += water[k] ? ALONG_STREAM : BRIDGE;
      const step = (nd & 1 ? Math.SQRT2 : 1) * c + turn * TURN;
      const ns = nk * 8 + nd;
      if (gs + step < g[ns]) {
        g[ns] = gs + step;
        from[ns] = st;
        heap.push(gs + step + h(nk), ns);
      }
    }
  }
  if (end < 0) return null;
  const cells: Pt[] = [];
  for (let st = end; st >= 0; st = from[st]) cells.push([x0 + ((st >> 3) % nx) * GRID, z0 + Math.floor((st >> 3) / nx) * GRID]);
  cells.reverse();
  cells[0] = [a.x, a.z];
  cells[cells.length - 1] = [b.x, b.z];
  const pts = resample(chaikin(cells, 3), 0.3);
  return { id: a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`, pts, bridges: bridgesOf(pts, streams), box: boundsOf(pts, ROAD_WIDTH) };
}

/** Where the road crosses a stream: one bridge per crossing (crossings closer than 2 units are one). */
function bridgesOf(pts: Pt[], streams: Stream[]): Bridge[] {
  const out: Bridge[] = [];
  for (const s of streams) {
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let k = 0; k + 1 < s.pts.length; k++) {
        const hit = segmentCross(pts[i], pts[i + 1], s.pts[k], s.pts[k + 1]);
        if (!hit) continue;
        const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * hit[0];
        const z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * hit[0];
        if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 2)) continue;
        // the road's way across, taken over a little stretch either side
        const p0 = pts[Math.max(0, i - 2)];
        const p1 = pts[Math.min(pts.length - 1, i + 3)];
        const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
        out.push({ x, z, dx: (p1[0] - p0[0]) / l, dz: (p1[1] - p0[1]) / l });
      }
    }
  }
  return out;
}

/** True if (x, z) is within r of the road's middle line plus half its width. */
export function onRoad(road: Road, x: number, z: number, r: number): boolean {
  if (x < road.box[0] - r || x > road.box[2] + r || z < road.box[1] - r || z > road.box[3] + r) return false;
  return polylineDistance(road.pts, x, z)[0] < ROAD_WIDTH / 2 + r;
}
