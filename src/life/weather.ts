/**
 * Rain and mist in the pine woods (papertrails' rain() and mist(), life/life.js there; it has no weather clock: the
 * weather belongs to the biome and cross-fades with it, see life-frame.ts).
 *
 *   rain   thin slanted streaks falling through the weather box round the focus, drifting with the wind, each ending
 *          in a small splash ring on the ground; slanted on screen by the wind across the view
 *   mist   a few large soft cards hanging low over the ground, drifting with the wind, a little denser at night
 *
 * Every piece is a pure function of the clock, wrapped in the box round the focus.
 */
import * as THREE from 'three';
import { AMBIENT } from '../config/life';
import { hash01 } from '../core/rng';
import type { ClearLine } from './clear-line';
import { randomTable, type LifeFrame } from './life-frame';
import { Bits } from './paper-bits';
import { SoftQuads } from './soft-quads';

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;
const mix = (r: readonly number[], t: number) => r[0] + (r[1] - r[0]) * t;

export class Weather {
  readonly group = new THREE.Group();
  private readonly streaks: Bits;
  private readonly rings: Bits;
  private readonly mist: SoftQuads;
  /** Six random numbers per raindrop and per mist card. */
  private readonly r = randomTable(AMBIENT.rain.count * 6, 0x5a1e);
  private readonly q = randomTable(AMBIENT.mist.count * 6, 0x3157);
  /** Where each drop of this cycle lands, and the ground's height there. */
  private readonly landX = new Float32Array(AMBIENT.rain.count).fill(1e9);
  private readonly landZ = new Float32Array(AMBIENT.rain.count).fill(1e9);
  private readonly landH = new Float32Array(AMBIENT.rain.count);
  private readonly mistDay = new THREE.Color(AMBIENT.mist.day);
  private readonly mistNight = new THREE.Color(AMBIENT.mist.night);
  private readonly mistColor = new THREE.Color();

  /** ground: the height of the ground at a point. */
  constructor(
    private readonly ground: (x: number, z: number) => number,
    private readonly clearLine: ClearLine,
  ) {
    const R = AMBIENT.rain;
    this.streaks = new Bits(R.count, ['bar'], R.colors, 0x2a1);
    this.rings = new Bits(R.count, ['ring'], R.colors, 0x2a1);
    this.mist = new SoftQuads(AMBIENT.mist.count, (i) => this.q[i * 6 + 5]);
    this.group.add(this.streaks.group, this.rings.group, this.mist.mesh);
  }

  update(f: LifeFrame): void {
    this.rain(f);
    this.updateMist(f);
  }

  private rain(f: LifeFrame): void {
    const cfg = AMBIENT.rain;
    const { w: W, d: D, h: H } = AMBIENT.box;
    const { t, fx, fz, windX, windZ, camYaw } = f;
    const R = this.r;
    const slant = Math.atan2(cfg.wind, 7) * (Math.cos(camYaw) * windX - Math.sin(camYaw) * windZ);
    for (let i = 0; i < cfg.count; i++) {
      const r = i * 6;
      const fall = mix(cfg.fall, R[r]);
      const tFall = H / fall;
      const period = tFall + cfg.land;
      const ph = t / period + R[r + 1] * 7;
      const cyc = Math.floor(ph);
      const u = (ph - cyc) * period;
      let dx = hash01(11, i, cyc) * W - fx;
      dx -= W * Math.round(dx / W);
      let dz = hash01(23, i, cyc) * D - fz;
      dz -= D * Math.round(dz / D);
      const g = f.gate('rain', dx, dz, (i + 0.5) / cfg.count, W, D);
      if (g <= 0) {
        this.streaks.hide(i);
        this.rings.hide(i);
        continue;
      }
      const landH = this.landing(i, fx + dx, fz + dz);
      if (u < tFall) {
        const rem = tFall - u;
        const len = mix(cfg.size, R[r + 2]);
        const px = fx + dx - windX * cfg.wind * rem;
        const py = rem * fall + len * 0.5 + landH;
        const pz = fz + dz - windZ * cfg.wind * rem;
        const wd = cfg.width * g * this.clearLine.k(px, py, pz);
        this.rings.hide(i);
        if (wd <= 0.0003) this.streaks.hide(i);
        else this.streaks.put(i, px, py, pz, camYaw, -0.35, -slant, wd, len);
      } else {
        const l = (u - tFall) / cfg.land;
        const s = cfg.splash * (0.3 + 0.7 * l) * g * (l > 0.8 ? (1 - l) / 0.2 : 1);
        this.streaks.hide(i);
        this.rings.put(i, fx + dx, 0.03 + landH, fz + dz, 0, -HALF_PI, 0, s, s);
      }
    }
    this.streaks.commit();
    this.rings.commit();
  }

  /** The ground's height where drop i lands (looked up once per fall). */
  private landing(i: number, x: number, z: number): number {
    if (Math.abs(this.landX[i] - x) >= 0.01 || Math.abs(this.landZ[i] - z) >= 0.01) {
      this.landX[i] = x;
      this.landZ[i] = z;
      this.landH[i] = this.ground(x, z);
    }
    return this.landH[i];
  }

  private updateMist(f: LifeFrame): void {
    const cfg = AMBIENT.mist;
    const W = AMBIENT.box.w + 4;
    const D = AMBIENT.box.d;
    const { t, fx, fz, windX, camYaw } = f;
    const Q = this.q;
    this.mistColor.copy(this.mistDay).lerp(this.mistNight, f.night);
    for (let i = 0; i < cfg.count; i++) {
      const q = i * 6;
      let dx = Q[q] * W + windX * cfg.drift * (0.6 + Q[q + 2]) * t - fx;
      dx -= W * Math.round(dx / W);
      let dz = Q[q + 1] * D - fz;
      dz -= D * Math.round(dz / D);
      const g = f.gate('mist', dx, dz, (i + 0.5) / cfg.count, W, D);
      if (g <= 0) {
        this.mist.hide(i);
        continue;
      }
      this.mist.put(i, fx + dx, cfg.y + 0.06 * Math.sin(t * 0.3 + Q[q + 3] * TAU), fz + dz, camYaw, -0.3, mix(cfg.size, Q[q + 3]), cfg.height * (0.8 + 0.4 * Q[q + 4]), this.mistColor, cfg.alpha * g, 1, 0, 1);
    }
    this.mist.commit();
  }
}
