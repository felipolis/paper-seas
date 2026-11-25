/**
 * papertrails' fallers (life/life.js there): what the leaves, the petals and the rain share. Each piece falls from the
 * top of the weather box at its own speed, rests where it lands a while, then starts again at another hashed spot of
 * the box, wrapped round the focus; what lies where it lands is looked up once per cycle.
 */
import { AMBIENT } from '../config/life';
import { hash01 } from '../core/rng';
import type { LifeFrame } from './life-frame';

/** Where a faller is in its cycle. */
export interface FallerCycle {
  /** Seconds into the cycle, and the seconds of its fall (it rests after). */
  u: number;
  tFall: number;
  /** Its spot off the focus, wrapped into the box round it. */
  dx: number;
  dz: number;
}

/**
 * Piece i's cycle (written into out): it falls at `fall` units / s and rests `land` s; phase (0..1) is its own offset
 * in the clock, salt picks its kind's spots.
 */
export function fallerCycle(out: FallerCycle, f: LifeFrame, i: number, fall: number, land: number, phase: number, salt: number): FallerCycle {
  const { w: W, d: D, h: H } = AMBIENT.box;
  const tFall = H / fall;
  const period = tFall + land;
  const ph = f.t / period + phase * 7;
  const cyc = Math.floor(ph);
  out.u = (ph - cyc) * period;
  out.tFall = tFall;
  const dx = hash01(salt + 11, i, cyc) * W - f.fx;
  out.dx = dx - W * Math.round(dx / W);
  const dz = hash01(salt + 23, i, cyc) * D - f.fz;
  out.dz = dz - D * Math.round(dz / D);
  return out;
}

/** Per piece, what lies where it lands (a number `look` gives), looked up again only once its spot has moved. */
export class LandingCache {
  private readonly x: Float32Array;
  private readonly z: Float32Array;
  private readonly value: Float32Array;

  constructor(count: number, private readonly look: (x: number, z: number) => number) {
    this.x = new Float32Array(count).fill(1e9);
    this.z = new Float32Array(count).fill(1e9);
    this.value = new Float32Array(count);
  }

  /** What lies at (x, z), where piece i lands this cycle. */
  at(i: number, x: number, z: number): number {
    if (Math.abs(this.x[i] - x) >= 0.01 || Math.abs(this.z[i] - z) >= 0.01) {
      this.x[i] = x;
      this.z[i] = z;
      this.value[i] = this.look(x, z);
    }
    return this.value[i];
  }
}
