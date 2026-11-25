/**
 * Bird flocks crossing the view (papertrails' birds(), life/life.js there): up to five flocks of three to five paper
 * birds in a V. Flock f crosses once every period * (1 + 0.23 f) s, taking `cross` s over `span` units, on a heading of
 * its own each crossing, just above the treetops (higher up the tilt-shift would blur them away). A crossing is aimed
 * at the point above the ground the camera sees over the focus (so it passes through the frame, not over its top) and
 * latched there when it starts. Each bird is one creased card, its crease the body: the crease deepens and flattens
 * with the wing beat. Their soft shadows lie on the ground, cast along the key light, gone at night.
 */
import * as THREE from 'three';
import { AMBIENT } from '../config/life';
import { hash01 } from '../core/rng';
import type { LifeFrame } from './life-frame';
import { Bits } from './paper-bits';
import { SoftQuads } from './soft-quads';
import { HALF_PI, TAU } from '../core/math';

export class Flocks {
  readonly group = new THREE.Group();
  private readonly birds: Bits;
  private readonly shadows: SoftQuads;
  /** Per flock: the crossing it flies and the point it is aimed at. */
  private readonly cycle = new Float64Array(AMBIENT.birds.flocks).fill(-1e9);
  private readonly cx = new Float32Array(AMBIENT.birds.flocks);
  private readonly cz = new Float32Array(AMBIENT.birds.flocks);
  private readonly shadowColor = new THREE.Color(AMBIENT.birds.shadowColor);

  /** ground: the height of the ground at a point. */
  constructor(private readonly ground: (x: number, z: number) => number) {
    const B = AMBIENT.birds;
    const n = B.flocks * B.flockSize;
    this.birds = new Bits(n, ['bird'], B.colors, 0xb12d);
    this.shadows = new SoftQuads(n, (i) => hash01(0xb13, i, 0));
    this.group.add(this.birds.group, this.shadows.mesh);
  }

  update(f: LifeFrame): void {
    const B = AMBIENT.birds;
    const NF = B.flocks;
    const FS = B.flockSize;
    const { t, fx, fz } = f;
    const dens = f.share('birds');
    for (let k = 0; k < NF; k++) {
      const period = B.period * (1 + 0.23 * k);
      const ph = t / period + 0.37 * k + 0.12;
      const cyc = Math.floor(ph);
      const u = (ph - cyc) * period;
      const active = u < B.cross && dens > ((k + 0.4) / NF) * 0.9;
      if (active && (this.cycle[k] !== cyc || Math.abs(this.cx[k] - fx) + Math.abs(this.cz[k] - fz) > 30)) {
        const h = B.height + 0.35 * k;
        this.cycle[k] = cyc;
        this.cx[k] = fx + f.camHX * h;
        this.cz[k] = fz + f.camHZ * h;
      }
      const ang = hash01(5, k, cyc) * TAU;
      const dirx = Math.cos(ang);
      const dirz = Math.sin(ang);
      const s = u / B.cross;
      const along = (s - 0.5) * B.span;
      const lat = (hash01(7, k, cyc) - 0.5) * 5 + Math.sin(s * 5 + k) * 0.8;
      const bx = this.cx[k] + dirx * along - dirz * lat;
      const bz = this.cz[k] + dirz * along + dirx * lat;
      const count = 3 + Math.floor(hash01(9, k, cyc) * (FS - 2));
      for (let j = 0; j < FS; j++) {
        const i = k * FS + j;
        if (!active || j >= count) {
          this.birds.hide(i);
          this.shadows.hide(i);
          continue;
        }
        // the V: rows behind the leader, alternating sides
        const row = (j + 1) >> 1;
        const side = j % 2 ? 1 : -1;
        const px = bx - dirx * row * 0.55 - dirz * side * row * 0.45;
        const pz = bz - dirz * row * 0.55 + dirx * side * row * 0.45;
        const py = B.height + 0.35 * k + 0.12 * Math.sin(t * 1.3 + j * 1.7);
        const beat = Math.sin(t * B.flap + j * 0.9 + k);
        const sp = B.wing * 2;
        // nose along the heading (dirx, dirz), wings across it, the crease up; on the downbeat the crease turns over,
        // which mirrors the card: mirrored across its body too (the bird is symmetric) it still faces up and is lit so
        const depth = sp * (1.1 + 2.3 * beat);
        const span = sp * (0.92 - 0.1 * beat) * (depth < 0 ? -1 : 1);
        this.birds.putBasis(i, px, py, pz, -dirz, 0, dirx, dirx, 0, dirz, span, sp, depth);
        const sa = B.shadow * (1 - f.night);
        if (sa <= 0.003) {
          this.shadows.hide(i);
          continue;
        }
        const gx = px - f.lightX * py;
        const gz = pz - f.lightZ * py;
        this.shadows.put(i, gx, 0.03 + this.ground(gx, gz), gz, 0, -HALF_PI, 0.6, 0.46, this.shadowColor, sa, 1, 1, 1);
      }
    }
    this.birds.commit();
    this.shadows.commit();
  }
}
