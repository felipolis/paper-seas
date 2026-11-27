/**
 * What every kind of ambient life reads each frame: the clock, the focus, the wind, where the camera and the key light
 * stand, the night, and how much of each kind is out.
 *
 * The amounts are each kind's share in the biome (config/life.ts, each biome mapped to a row), cross-faded over the
 * biome borders, times its night factor. It is known at the focus and as a gradient across the weather box (from
 * biome weights sampled GRAD units either side), so each piece takes the mix at its own spot, and the cross-fade is
 * sharpened so a little of a neighbour biome brings none of its life.
 */
import * as THREE from 'three';
import { AMBIENT, type LifeKind } from '../config/life';
import { BIOME, type LifeRow } from '../config/biomes';
import { mulberry32 } from '../core/rng';
import { SEA_WIND } from '../config/world';
import type { Biome } from '../world/land';
import { rankGate, smoothstep } from '../core/math';

/** World units between the biome samples of the gradient. */
const GRAD = 5;
/**
 * The biomes are a hard partition, so the weight of a biome at a point is the share of a 3 x 3 stencil of samples
 * this far apart (world units) that lies in it.
 */
const BLEND = 1.6;
const KINDS = Object.keys(AMBIENT.biomes.heartland) as LifeKind[];
const ROWS = Object.keys(AMBIENT.biomes) as LifeRow[];

/** n seeded random numbers in [0, 1) (a per-piece table: six per piece). */
export function randomTable(n: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng();
  return out;
}

export class LifeFrame {
  /** The clock (s), the focus, the wind's direction (unit): each set by update before anything reads it. */
  t = 0;
  fx = 0;
  fz = 0;
  windX = SEA_WIND.x;
  windZ = SEA_WIND.z;
  /**
   * The camera seen from the focus: its yaw and elevation, and its ground offset per unit of height (kept from the
   * frame before while the camera stands too low to say; these start values are the first frame's).
   */
  camYaw = 0;
  camElev = 0;
  camHX = 0;
  camHZ = 0.8;
  /** The ground offset of a shadow per unit of height (from the key light; kept likewise while it is too low). */
  lightX = 0.4;
  lightZ = 0.3;
  /** 0 day .. 1 night. */
  night = 0;
  /** Per kind: the share at the focus and its gradient (per world unit). */
  private readonly c = {} as Record<LifeKind, number>;
  private readonly gx = {} as Record<LifeKind, number>;
  private readonly gz = {} as Record<LifeKind, number>;
  private readonly cam = new THREE.Vector3();
  /** Scratch: how many of a point's biome samples fall in each life row. */
  private readonly rowCount = {} as Record<LifeRow, number>;

  constructor(private readonly biome: (x: number, z: number) => Biome) {
    for (const k of KINDS) this.c[k] = this.gx[k] = this.gz[k] = 0;
  }

  update(dt: number, fx: number, fz: number, windX: number, windZ: number, night: number, camera: THREE.Camera, key: THREE.DirectionalLight): void {
    this.t += dt;
    this.fx = fx;
    this.fz = fz;
    const wl = Math.hypot(windX, windZ) || 1;
    this.windX = windX / wl;
    this.windZ = windZ / wl;
    this.night = night;
    const cam = camera.getWorldPosition(this.cam);
    const cx = cam.x - fx;
    const cz = cam.z - fz;
    this.camYaw = Math.atan2(cx, cz);
    this.camElev = Math.atan2(cam.y, Math.hypot(cx, cz) || 1);
    if (cam.y > 0.5) {
      this.camHX = cx / cam.y;
      this.camHZ = cz / cam.y;
    }
    const ly = key.position.y - key.target.position.y;
    if (ly > 0.01) {
      this.lightX = (key.position.x - key.target.position.x) / ly;
      this.lightZ = (key.position.z - key.target.position.z) / ly;
    }
    this.densities();
  }

  /** How much of a kind is out at the focus (0..1 of its pool, night included). */
  share(kind: LifeKind): number {
    return this.c[kind];
  }

  /**
   * The gate: the piece of this rank (0..1) at (dx, dz) off the focus shows once the share there reaches its
   * rank, fading in, and fades out over the outer 14 % of a w x d box.
   */
  gate(kind: LifeKind, dx: number, dz: number, rank: number, w: number, d: number): number {
    const g = rankGate(this.c[kind] + this.gx[kind] * dx + this.gz[kind] * dz, rank);
    return g <= 0 ? 0 : g * this.edge(dx, dz, w, d);
  }

  /** 1 inside a w x d box round the focus, fading to 0 over its outer 14 %, for a piece at (dx, dz) off the focus. */
  edge(dx: number, dz: number, w: number, d: number): number {
    const e = Math.max(Math.abs(dx) / (w * 0.5), Math.abs(dz) / (d * 0.5));
    return e < 0.86 ? 1 : Math.max(0, (1 - e) / 0.14);
  }

  /** Each kind's share at a point: the rows of the biomes round it, weighted by their (sharpened) shares there. */
  private mix(x: number, z: number, out: Record<LifeKind, number>): Record<LifeKind, number> {
    const n = this.rowCount;
    for (const row of ROWS) n[row] = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n[BIOME[this.biome(x + i * BLEND, z + j * BLEND)].life]++;
    let total = 0;
    for (const k of KINDS) out[k] = 0;
    for (const row of ROWS) {
      const count = n[row];
      if (count === 0) continue;
      const w = smoothstep(0.2, 0.8, count / 9) + 1e-3;
      total += w;
      for (const k of KINDS) out[k] += AMBIENT.biomes[row][k] * w;
    }
    for (const k of KINDS) out[k] /= total;
    return out;
  }

  private readonly at = { c: {} as Record<LifeKind, number>, xp: {} as Record<LifeKind, number>, xm: {} as Record<LifeKind, number>, zp: {} as Record<LifeKind, number>, zm: {} as Record<LifeKind, number> };

  private densities(): void {
    const { fx, fz, night, at } = this;
    const c = this.mix(fx, fz, at.c);
    const xp = this.mix(fx + GRAD, fz, at.xp);
    const xm = this.mix(fx - GRAD, fz, at.xm);
    const zp = this.mix(fx, fz + GRAD, at.zp);
    const zm = this.mix(fx, fz - GRAD, at.zm);
    const N: Partial<Record<LifeKind, number>> = AMBIENT.night;
    for (const k of KINDS) {
      const nf = k === 'fireflies' ? night * (N.fireflies ?? 1) : 1 + ((N[k] ?? 1) - 1) * night;
      this.c[k] = c[k] * nf;
      this.gx[k] = ((xp[k] - xm[k]) / (2 * GRAD)) * nf;
      this.gz[k] = ((zp[k] - zm[k]) / (2 * GRAD)) * nf;
    }
    // fewer fireflies in the rain
    const dry = 1 - AMBIENT.fireflies.rainCut * Math.min(1, Math.max(0, this.c.rain) * 1.5);
    this.c.fireflies *= dry;
    this.gx.fireflies *= dry;
    this.gz.fireflies *= dry;
  }
}
