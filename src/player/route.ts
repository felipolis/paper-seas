/**
 * The click-to-walk route finder: a grid A* in a square window centred between the captain and the target, asked only
 * when the straight way there is blocked. Its cells are tested lazily (only those the search reaches), it never cuts a
 * corner, and the path it finds is string-pulled into a few straight legs. With no way to the target (across a river,
 * inside a ring of props) it leads as close as the ground allows, if that is a real gain.
 */
import { CLICK_WALK } from '../config/player';

const CELL = CLICK_WALK.routeCell;
/** Cells across the window (odd, at least 16). */
const N = Math.max(16, Math.round(CLICK_WALK.routeSpan / CELL) | 1);
const NN = N * N;
/** The eight neighbours, the straight ones first. */
const NBX = [1, -1, 0, 0, 1, 1, -1, -1];
const NBZ = [0, 0, 1, -1, 1, -1, 1, -1];
/** How far round a blocked target its stand-in is sought (cells). */
const NEAR_GOAL = 3;
/** The least gain (cells nearer) that makes a walk toward an unreachable target worth it. */
const LEAST_GAIN = 3;
/** The step a straight leg is tested at (world units). */
const SEG_STEP = 0.06;

export type Passable = (x: number, z: number) => boolean;

export class RouteFinder {
  /** Per cell: -1 not tested yet, 0 blocked, 1 open. */
  private readonly open = new Int8Array(NN);
  private readonly g = new Float32Array(NN);
  private readonly from = new Int32Array(NN);
  /** Per cell: 0 new, 1 queued, 2 done. */
  private readonly state = new Uint8Array(NN);
  private readonly heap = new Int32Array(NN * 4);
  private readonly heapF = new Float32Array(NN * 4);
  private heapN = 0;
  private x0 = 0;
  private z0 = 0;

  /** canPass: room there for the captain's body. */
  constructor(private readonly canPass: Passable) {}

  /** True if the straight way from a to b leaves room for the body all along. */
  segClear(ax: number, az: number, bx: number, bz: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SEG_STEP));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      if (!this.canPass(ax + (bx - ax) * k, az + (bz - az) * k)) return false;
    }
    return true;
  }

  /**
   * The way from (px, pz) to (tx, tz) as waypoints [x0, z0, x1, z1, ...] (its last the target itself when that is
   * reached), or null when there is none inside the window worth walking.
   */
  plan(px: number, pz: number, tx: number, tz: number): number[] | null {
    this.x0 = (px + tx) / 2 - ((N - 1) / 2) * CELL;
    this.z0 = (pz + tz) / 2 - ((N - 1) / 2) * CELL;
    const sx = Math.round((px - this.x0) / CELL);
    const sz = Math.round((pz - this.z0) / CELL);
    const gx = Math.round((tx - this.x0) / CELL);
    const gz = Math.round((tz - this.z0) / CELL);
    if (!inside(sx, sz) || !inside(gx, gz)) return null;
    this.open.fill(-1);
    this.state.fill(0);
    this.heapN = 0;
    const start = sz * N + sx;
    // (wherever he stands, he can leave)
    this.open[start] = 1;
    const target = gz * N + gx;
    let goal = this.isOpen(target) ? target : this.nearOpen(gx, gz);
    if (goal < 0) return null;
    const ggx = goal % N;
    const ggz = (goal / N) | 0;
    this.g[start] = 0;
    this.from[start] = -1;
    this.state[start] = 1;
    const startH = Math.hypot(sx - ggx, sz - ggz);
    this.push(start, startH);
    let found = false;
    let near = start;
    let nearH = startH;
    while (this.heapN > 0) {
      const i = this.pop();
      if (this.state[i] === 2) continue;
      this.state[i] = 2;
      if (i === goal) {
        found = true;
        break;
      }
      const x = i % N;
      const z = (i / N) | 0;
      const h = Math.hypot(x - ggx, z - ggz);
      if (h < nearH) {
        nearH = h;
        near = i;
      }
      for (let k = 0; k < 8; k++) {
        const nx = x + NBX[k];
        const nz = z + NBZ[k];
        if (!inside(nx, nz)) continue;
        const j = nz * N + nx;
        if (this.state[j] === 2 || !this.isOpen(j)) continue;
        // (no corner cutting)
        if (k >= 4 && (!this.isOpen(z * N + nx) || !this.isOpen(nz * N + x))) continue;
        const g = this.g[i] + (k >= 4 ? Math.SQRT2 : 1);
        if (this.state[j] === 1 && g >= this.g[j]) continue;
        this.g[j] = g;
        this.from[j] = i;
        this.state[j] = 1;
        this.push(j, g + Math.hypot(nx - ggx, nz - ggz));
      }
    }
    if (!found) {
      if (startH - nearH < LEAST_GAIN) return null;
      goal = near;
    }
    // the cells from the start to the goal, string-pulled into a few straight legs
    const cells: number[] = [];
    for (let i = goal; i >= 0; i = this.from[i]) cells.push(i);
    cells.reverse();
    const wx = (i: number) => this.x0 + (i % N) * CELL;
    const wz = (i: number) => this.z0 + ((i / N) | 0) * CELL;
    const route: number[] = [];
    let ax = px;
    let az = pz;
    for (let a = 0; a < cells.length - 1; ) {
      let b = cells.length - 1;
      while (b > a + 1 && !this.segClear(ax, az, wx(cells[b]), wz(cells[b]))) b--;
      ax = wx(cells[b]);
      az = wz(cells[b]);
      route.push(ax, az);
      a = b;
    }
    if (goal === target && this.canPass(tx, tz) && this.segClear(ax, az, tx, tz)) route.push(tx, tz);
    return route.length > 0 ? route : null;
  }

  private isOpen(i: number): boolean {
    let o = this.open[i];
    if (o < 0) {
      o = this.canPass(this.x0 + (i % N) * CELL, this.z0 + ((i / N) | 0) * CELL) ? 1 : 0;
      this.open[i] = o;
    }
    return o === 1;
  }

  /** A target in a tight spot: the nearest open cell round it (within NEAR_GOAL), or -1. */
  private nearOpen(gx: number, gz: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let dz = -NEAR_GOAL; dz <= NEAR_GOAL; dz++) {
      for (let dx = -NEAR_GOAL; dx <= NEAR_GOAL; dx++) {
        const x = gx + dx;
        const z = gz + dz;
        const d = dx * dx + dz * dz;
        if (inside(x, z) && d < bestD && this.isOpen(z * N + x)) {
          bestD = d;
          best = z * N + x;
        }
      }
    }
    return best;
  }

  private push(i: number, f: number): void {
    let k = this.heapN++;
    while (k > 0) {
      const pa = (k - 1) >> 1;
      if (this.heapF[pa] <= f) break;
      this.heap[k] = this.heap[pa];
      this.heapF[k] = this.heapF[pa];
      k = pa;
    }
    this.heap[k] = i;
    this.heapF[k] = f;
  }

  private pop(): number {
    const top = this.heap[0];
    const i = this.heap[--this.heapN];
    const f = this.heapF[this.heapN];
    let k = 0;
    for (;;) {
      let c = k * 2 + 1;
      if (c >= this.heapN) break;
      if (c + 1 < this.heapN && this.heapF[c + 1] < this.heapF[c]) c++;
      if (this.heapF[c] >= f) break;
      this.heap[k] = this.heap[c];
      this.heapF[k] = this.heapF[c];
      k = c;
    }
    this.heap[k] = i;
    this.heapF[k] = f;
    return top;
  }
}

function inside(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < N && z < N;
}
