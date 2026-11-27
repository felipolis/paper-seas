/**
 * The walk field: what stops the feet, worked out once into a grid of
 * distances instead of measured against every piece each frame. A field covers a square of land and the pieces it was
 * given (the blocking segments of its cards and buildings, world/blockers.ts); each point of the grid holds the
 * distance to the nearest of them, so asking how much room there is anywhere is one bilinear read, whatever stands
 * round it.
 *
 *   grid      STEP apart, over the square and every piece's reach past it
 *   distance  exact, to each segment, up to REACH (no query looks further; beyond, the room is REACH)
 *   closing   a morphological closing: the ground within CLOSE_RADIUS of the pieces is grown, then shrunk
 *             by as much; what the shrinking leaves (a nook between two pieces, the inside of a bend) is filled, so
 *             no pocket is left for the feet to be wedged in, while a convex piece stays as it is
 */
import type { Segment } from './blockers';
import type { Box } from '../core/polyline';

/** Grid spacing (world units). */
const STEP = 0.05;
/**
 * How far the field measures: no one reads further (the walker up to its radius plus padding, 0.18; the animals up to
 * their room past the padding, 0.13) and the closing grows by CLOSE_RADIUS; beyond, the room is REACH.
 */
export const REACH = 0.3;
/** The closing's radius (world units). */
const CLOSE_RADIUS = 0.2;
/** Grid points worked through between two yields while a field is made (a slice of a chunk's build). */
const SLICE = 40000;

export class ClearanceField {
  private readonly x0: number;
  private readonly z0: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly d: Float32Array;

  /**
   * Makes the field of a square of land (square) and the blocking segments of each piece standing on it (pieces), a
   * slice at a time: it yields between slices of about SLICE grid points' work (a chunk is built over several frames),
   * and returns the field once done.
   */
  static *make(square: Box, pieces: Segment[][]): Generator<void, ClearanceField> {
    const f = new ClearanceField(square, pieces);
    let work = 0;
    for (const piece of pieces) {
      for (const s of piece) {
        work += f.stamp(s);
        if (work > SLICE) {
          work = 0;
          yield;
        }
      }
    }
    yield* f.close();
    return f;
  }

  /** The field made at once (see make). */
  static now(square: Box, pieces: Segment[][]): ClearanceField {
    const it = ClearanceField.make(square, pieces);
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
    }
  }

  private constructor(square: Box, pieces: Segment[][]) {
    let [x0, z0, x1, z1] = square;
    for (const piece of pieces) {
      for (const [ax, az, bx, bz] of piece) {
        x0 = Math.min(x0, ax - REACH, bx - REACH);
        z0 = Math.min(z0, az - REACH, bz - REACH);
        x1 = Math.max(x1, ax + REACH, bx + REACH);
        z1 = Math.max(z1, az + REACH, bz + REACH);
      }
    }
    this.x0 = x0;
    this.z0 = z0;
    this.nx = Math.ceil((x1 - x0) / STEP) + 1;
    this.nz = Math.ceil((z1 - z0) / STEP) + 1;
    this.d = new Float32Array(this.nx * this.nz).fill(REACH);
  }

  /** Distance from (x, z) to the nearest piece (REACH at most), bilinear between the grid points. */
  distance(x: number, z: number): number {
    const fx = (x - this.x0) / STEP;
    const fz = (z - this.z0) / STEP;
    const i = Math.min(this.nx - 2, Math.max(0, Math.floor(fx)));
    const j = Math.min(this.nz - 2, Math.max(0, Math.floor(fz)));
    const ax = Math.min(1, Math.max(0, fx - i));
    const az = Math.min(1, Math.max(0, fz - j));
    const d = this.d;
    const k = j * this.nx + i;
    return (d[k] * (1 - ax) + d[k + 1] * ax) * (1 - az) + (d[k + this.nx] * (1 - ax) + d[k + this.nx + 1] * ax) * az;
  }

  /**
   * Every grid point within REACH of the segment takes its distance to it, if nearer than what it holds (polyline.ts
   * distanceToSegment, written out: this runs for every point round every piece of a chunk). Returns the points done.
   */
  private stamp([ax, az, bx, bz]: Segment): number {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - REACH - this.x0) / STEP));
    const i1 = Math.min(this.nx - 1, Math.ceil((Math.max(ax, bx) + REACH - this.x0) / STEP));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - REACH - this.z0) / STEP));
    const j1 = Math.min(this.nz - 1, Math.ceil((Math.max(az, bz) + REACH - this.z0) / STEP));
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const d = this.d;
    for (let j = j0; j <= j1; j++) {
      const pz = this.z0 + j * STEP - az;
      for (let i = i0; i <= i1; i++) {
        const px = this.x0 + i * STEP - ax;
        const u = l2 > 1e-12 ? Math.min(1, Math.max(0, (px * dx + pz * dz) / l2)) : 0;
        const ex = px - dx * u;
        const ez = pz - dz * u;
        const s = Math.sqrt(ex * ex + ez * ez);
        const k = j * this.nx + i;
        if (s < d[k]) d[k] = s;
      }
    }
    return (i1 - i0 + 1) * (j1 - j0 + 1);
  }

  /**
   * The closing: the grown ground is every point within CLOSE_RADIUS of a piece; a grown point further than
   * CLOSE_RADIUS from any ground the growing left free is a pocket, and the pockets block like the pieces.
   */
  private *close(): Generator<void> {
    const n = this.nx * this.nz;
    const free = new Float32Array(n);
    let grown = false;
    for (let k = 0; k < n; k++) {
      free[k] = this.d[k] > CLOSE_RADIUS ? 0 : Infinity;
      if (free[k] !== 0) grown = true;
    }
    if (!grown) return;
    yield* this.chamfer(free);
    const pocket = new Float32Array(n);
    let any = false;
    for (let k = 0; k < n; k++) {
      const filled = free[k] > CLOSE_RADIUS + 1e-4 && this.d[k] > STEP * 0.5;
      pocket[k] = filled ? 0 : Infinity;
      if (filled) any = true;
    }
    if (!any) return;
    yield* this.chamfer(pocket);
    for (let k = 0; k < n; k++) if (pocket[k] < this.d[k]) this.d[k] = pocket[k];
  }

  /**
   * A chamfer distance transform (two passes, 8 neighbours) over the grid, in world units, in place; it
   * yields every SLICE grid points.
   */
  private *chamfer(f: Float32Array): Generator<void> {
    const { nx, nz } = this;
    const s1 = STEP;
    const s2 = STEP * Math.SQRT2;
    const rows = Math.max(1, Math.floor(SLICE / nx));
    for (let j = 0; j < nz; j++) {
      if (j % rows === rows - 1) yield;
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        let v = f[k];
        if (i > 0) v = Math.min(v, f[k - 1] + s1);
        if (j > 0) {
          v = Math.min(v, f[k - nx] + s1);
          if (i > 0) v = Math.min(v, f[k - nx - 1] + s2);
          if (i < nx - 1) v = Math.min(v, f[k - nx + 1] + s2);
        }
        f[k] = v;
      }
    }
    for (let j = nz - 1; j >= 0; j--) {
      if (j % rows === 0) yield;
      for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i;
        let v = f[k];
        if (i < nx - 1) v = Math.min(v, f[k + 1] + s1);
        if (j < nz - 1) {
          v = Math.min(v, f[k + nx] + s1);
          if (i < nx - 1) v = Math.min(v, f[k + nx + 1] + s2);
          if (i > 0) v = Math.min(v, f[k + nx - 1] + s2);
        }
        f[k] = v;
      }
    }
  }
}
