/**
 * Ambient life round the focus (after papertrails' life, life/life.js there): small cut-paper pieces that make the
 * diorama feel alive and calm. How much of each kind is out follows the biome and the night (life-frame.ts).
 *
 *   leaves      drift down from high up with the wind, rocking and tumbling, rest on the ground a while and shrink away
 *   petals      the same, pink
 *   dust        specks drifting along the wind through the sunlight
 *   butterflies by day: two hinged paper wings each, in five colours, roaming a loop round a home over the land
 *   fireflies   by night: small warm sparks pulsing slowly, gathered over river banks and the shore
 *   weather     rain and mist in the pine woods (weather.ts)
 *   flocks      birds crossing the view in a V, their shadows on the ground (flocks.ts)
 *
 * Leaves, petals and dust are pure functions of the clock, wrapped in papertrails' weather box round the focus; as
 * there, a kind comes in and out by rank instead of all at once, and a piece fades out where it would come between the
 * camera and the captain or near the lens (the shared clear line). papertrails' page has no sea: what falls or drifts
 * keeps to the land.
 */
import * as THREE from 'three';
import { AMBIENT } from '../config/life';
import { stream } from '../core/rng';
import { createPaperMaterial } from '../render/paper-material';
import { LAND_TOP, type Biome } from '../world/land';
import type { ClearLine } from './clear-line';
import { fallerCycle, LandingCache, type FallerCycle } from './fallers';
import { Flocks } from './flocks';
import { LifeFrame, randomTable } from './life-frame';
import { Bits } from './paper-bits';
import { Weather } from './weather';
import { HALF_PI, rankGate, smoothstep, TAU, mixRange } from '../core/math';

/** This module's seeded randomness (core/rng.ts stream). */
const random = stream('ambience');

export interface AmbienceWorld {
  /** Signed distance to the coast (negative inland). */
  distance: (x: number, z: number) => number;
  /** Distance to the nearest stream's bank (negative in the water). */
  bank: (x: number, z: number) => number;
  /** The flower nearest (x, z) within r (a flowering card's foot), or null. */
  flower: (x: number, z: number, r: number) => [number, number] | null;
  biome: (x: number, z: number) => Biome;
}

/** A roamer (butterfly, firefly) loops round its home; r holds its own six random numbers. */
interface Roamer {
  home: boolean;
  hx: number;
  hz: number;
  /**
   * Its home was drawn to what its kind seeks (water for a firefly, a flower for a butterfly: it then flies whatever its
   * rank), and whether its home was searched yet.
   */
  drawn: boolean;
  sought: boolean;
  r: number[];
}

/** A faller kind (leaves, petals): its pool, its six random numbers per piece and what lies where each piece lands. */
interface Fallers {
  kind: 'leaves' | 'petals';
  bits: Bits;
  r: Float32Array;
  salt: number;
  land: LandingCache;
}

/** What lies where a piece lands. */
const GROUND = 0;
const WATER = 1;
const SEA = 2;

/** A falling piece's cycle, this frame (fallers.ts). */
const _piece: FallerCycle = { u: 0, tFall: 0, dx: 0, dz: 0 };
const RADIUS = 9;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _yaw = new THREE.Quaternion();
const _roll = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * papertrails' floor (life/life.js there): a leaf or a speck faded below this size is not drawn at all. A card shrunk
 * to a speck still rasterises a pixel now and then, and its lighting there can come out invalid: a black dot the
 * bokeh spreads into a white disc.
 */
const MIN_SIZE = 0.0005;

/** A small canvas texture with one piece drawn on it. */
function pieceTexture(draw: (c: CanvasRenderingContext2D, s: number) => void, size = 64): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  draw(c, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * One wing, as papertrails cuts it: the hinge on the left edge, the leading edge toward the top; a forewing and a
 * smaller hindwing in white (the instance colour tints it) with a brown edge and a spot.
 */
const wingTex = () =>
  pieceTexture((c, s) => {
    c.strokeStyle = '#4a3020';
    c.lineWidth = s * 0.035;
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(s * 0.02, s * 0.46);
    c.bezierCurveTo(s * 0.3, s * 0.02, s * 0.92, s * 0.04, s * 0.94, s * 0.26);
    c.bezierCurveTo(s * 0.96, s * 0.44, s * 0.5, s * 0.5, s * 0.02, s * 0.54);
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(s * 0.02, s * 0.54);
    c.bezierCurveTo(s * 0.4, s * 0.56, s * 0.76, s * 0.7, s * 0.6, s * 0.9);
    c.bezierCurveTo(s * 0.44, s * 1.0, s * 0.14, s * 0.8, s * 0.02, s * 0.62);
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(74,48,32,0.55)';
    c.beginPath();
    c.arc(s * 0.62, s * 0.26, s * 0.07, 0, TAU);
    c.fill();
  });

const glowTex = (inner: string, outer: string) =>
  pieceTexture((c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });

function roamers(n: number): Roamer[] {
  return Array.from({ length: n }, () => ({ home: false, hx: 0, hz: 0, drawn: false, sought: false, r: Array.from({ length: 6 }, random) }));
}

export class Ambience {
  readonly group = new THREE.Group();
  private readonly frame: LifeFrame;
  private readonly fallers: Fallers[];
  private readonly dust: Bits;
  private readonly dustR = randomTable(AMBIENT.dust.count * 6, 0xd057);
  private readonly wings: THREE.InstancedMesh;
  private readonly sparks: THREE.InstancedMesh;
  private readonly butterflies = roamers(AMBIENT.butterflies.count);
  private readonly fireflies = roamers(AMBIENT.fireflies.count);
  private readonly fireColor = new THREE.Color(AMBIENT.fireflies.color);
  private readonly camQ = new THREE.Quaternion();
  private readonly weather: Weather;
  private readonly flocks: Flocks;

  /** key: the key light (bird shadows fall along it). */
  constructor(
    private readonly world: AmbienceWorld,
    private readonly clearLine: ClearLine,
    private readonly key: THREE.DirectionalLight,
  ) {
    this.frame = new LifeFrame(world.biome);
    const ground = (x: number, z: number) => (world.distance(x, z) < 0 ? LAND_TOP : 0);
    const L = AMBIENT.leaves;
    const P = AMBIENT.petals;
    // (the sea: a piece does not fall at all)
    const lies = (x: number, z: number) => (world.distance(x, z) > 0 ? SEA : this.wet(x, z) ? WATER : GROUND);
    this.fallers = [
      { kind: 'leaves', bits: new Bits(L.count, ['leaf', 'leaf2', 'leaf'], L.colors, 0x1ea), r: randomTable(L.count * 6, 0x1ea), salt: 0x1ea, land: new LandingCache(L.count, lies) },
      { kind: 'petals', bits: new Bits(P.count, ['petal'], P.colors, 0x9e7), r: randomTable(P.count * 6, 0x9e7), salt: 0x9e7, land: new LandingCache(P.count, lies) },
    ];
    this.dust = new Bits(AMBIENT.dust.count, ['dot', 'flake'], AMBIENT.dust.colors, 0xd057);
    this.weather = new Weather(ground, clearLine);
    this.flocks = new Flocks(ground);
    this.group.add(...this.fallers.map((f) => f.bits.group), this.dust.group, this.weather.group, this.flocks.group);

    const paper = (map: THREE.Texture) => createPaperMaterial({ map, back: null });
    // a wing lies flat with its hinge at the origin and its leading edge toward +z (papertrails puts the wing's middle
    // 0.42 of the span out, so the roots overlap a little over the body)
    const B = AMBIENT.butterflies;
    const wing = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2).translate(0.42, 0, 0);
    this.wings = this.instanced(wing, paper(wingTex()), B.count * 2);
    this.butterflies.forEach((_, j) => {
      _c.set(B.colors[j % B.colors.length]);
      this.wings.setColorAt(j * 2, _c);
      this.wings.setColorAt(j * 2 + 1, _c);
    });

    const F = AMBIENT.fireflies;
    const sparkMat = new THREE.MeshBasicMaterial({ map: glowTex('rgba(255,250,220,1)', 'rgba(255,220,140,0.45)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sparks = this.instanced(new THREE.PlaneGeometry(1, 1), sparkMat, F.count);
    this.sparks.castShadow = false;
    for (let i = 0; i < F.count; i++) this.sparks.setColorAt(i, _c.setRGB(0, 0, 0));
  }

  private instanced(g: THREE.BufferGeometry, mat: THREE.Material, n: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(g, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.group.add(mesh);
    return mesh;
  }

  /** A random point over land within radius of (fx, fz), at least `inland` from the coast, or null. */
  private spot(fx: number, fz: number, inland: number, radius = RADIUS): [number, number] | null {
    for (let a = 0; a < 6; a++) {
      const r = Math.sqrt(random()) * radius;
      const ang = random() * TAU;
      const x = fx + Math.cos(ang) * r;
      const z = fz + Math.sin(ang) * r;
      if (this.world.distance(x, z) < -inland) return [x, z];
    }
    return null;
  }

  private wet(x: number, z: number): boolean {
    return this.world.distance(x, z) > -0.05 || this.world.bank(x, z) < 0;
  }

  update(dt: number, fx: number, fz: number, windX: number, windZ: number, night: number, camera: THREE.Camera): void {
    const f = this.frame;
    f.update(dt, fx, fz, windX, windZ, night, camera, this.key);
    camera.getWorldQuaternion(this.camQ);

    for (const k of this.fallers) this.fall(k);
    this.drift();
    this.updateButterflies(dt);
    this.updateFireflies(dt);
    this.weather.update(f);
    this.flocks.update(f);
  }

  /**
   * papertrails' fallers: each piece falls from the top of the box at its own speed, rocking side to side (less near
   * the ground) and tumbling about a face-up pose, so it always catches the key light; the wind carries it to where it
   * lands; it rests there `land` s and shrinks away, then starts again somewhere else. Nothing rests on water.
   */
  private fall(k: Fallers): void {
    const cfg = AMBIENT[k.kind];
    const { w: W, d: D } = AMBIENT.box;
    const f = this.frame;
    const { t, fx, fz, windX, windZ } = f;
    const R = k.r;
    for (let i = 0; i < cfg.count; i++) {
      const r = i * 6;
      const fall = mixRange(cfg.fall, R[r]);
      const { u, tFall, dx, dz } = fallerCycle(_piece, f, i, fall, cfg.land, R[r + 1], k.salt);
      const g = f.gate(k.kind, dx, dz, (i + 0.5) / cfg.count, W, D);
      // (a piece gated out is not drawn, nor one that would land on the sea: so every piece drawn lands on the land's top)
      const lt = g > 0 ? k.land.at(i, fx + dx, fz + dz) : SEA;
      if (lt === SEA) {
        k.bits.hide(i);
        continue;
      }
      const size = mixRange(cfg.size, R[r + 2]) * g;
      if (u < tFall) {
        const rem = tFall - u;
        const y = rem * fall;
        const sw = Math.sin(t * (0.8 + R[r + 3]) + R[r + 4] * TAU) * cfg.sway * (y < 1 ? y : 1);
        const px = fx + dx - windX * cfg.wind * rem - windZ * sw;
        const pz = fz + dz - windZ * cfg.wind * rem + windX * sw;
        const py = y + 0.03 + LAND_TOP;
        const s = size * smoothstep(0, 0.6, u) * this.clearLine.k(px, py, pz);
        if (s <= MIN_SIZE) k.bits.hide(i);
        else k.bits.put(i, px, py, pz, R[r + 4] * TAU + t * cfg.tumble * (0.5 + R[r + 5]), -HALF_PI + 0.8 * Math.sin(t * cfg.tumble * 0.9 + R[r + 3] * TAU), sw * 1.4, s, s * 1.15);
      } else {
        const s = lt === GROUND ? size * (1 - smoothstep(0.55, 1, (u - tFall) / cfg.land)) : 0;
        if (s <= MIN_SIZE) k.bits.hide(i);
        else k.bits.put(i, fx + dx, 0.028 + R[r + 5] * 0.012 + LAND_TOP, fz + dz, R[r + 4] * TAU, -HALF_PI + (R[r + 3] - 0.5) * 0.3, 0, s, s * 1.15);
      }
    }
    k.bits.commit();
  }

  /** papertrails' dust: specks drifting along the wind at their own speed and height, bobbing, turned to the camera. */
  private drift(): void {
    const cfg = AMBIENT.dust;
    const { w: W, d: D } = AMBIENT.box;
    const f = this.frame;
    const { t, fx, fz, windX, windZ, camYaw, camElev } = f;
    const R = this.dustR;
    for (let i = 0; i < cfg.count; i++) {
      const r = i * 6;
      const sp = mixRange(cfg.speed, R[r]);
      let dx = R[r + 1] * W + windX * sp * t - fx;
      dx -= W * Math.round(dx / W);
      let dz = R[r + 2] * D + windZ * sp * t - fz;
      dz -= D * Math.round(dz / D);
      const g = f.gate('dust', dx, dz, (i + 0.5) / cfg.count, W, D);
      if (g <= 0) {
        this.dust.hide(i);
        continue;
      }
      const x = fx + dx;
      const z = fz + dz;
      const py = mixRange(cfg.height, R[r + 3]) + 0.14 * Math.sin(t * 0.5 + R[r + 5] * TAU);
      // (fading out over the coast: it drifts over the land only)
      const s = mixRange(cfg.size, R[r + 4]) * g * this.clearLine.k(x, py, z) * smoothstep(0, -0.6, this.world.distance(x, z));
      if (s <= MIN_SIZE) this.dust.hide(i);
      else this.dust.put(i, x, py, z, camYaw + Math.sin(t * 0.7 + R[r + 5] * TAU), -camElev, t * 0.4 + R[r] * TAU, s, s);
    }
    this.dust.commit();
  }

  /** (Re)homes a roamer that has none, or whose home the focus has left behind; false if it has no home. */
  private rehome(o: Roamer, dt: number, inland: number): boolean {
    const { fx, fz } = this.frame;
    if (o.home && Math.hypot(o.hx - fx, o.hz - fz) <= RADIUS + 2) return true;
    o.home = false;
    o.drawn = false;
    o.sought = false;
    // staggered, so a new stretch of land fills gradually
    if (random() > dt * 1.5) return false;
    const s = this.spot(fx, fz, inland);
    if (!s) return false;
    [o.hx, o.hz] = s;
    o.home = true;
    return true;
  }

  /**
   * papertrails' butterflies: a Lissajous loop round the home, heading along it, wings hinged and beating. One whose home
   * has flowers within reach takes its home over them, keeps closer round them and comes out whatever its rank (its
   * flower tiles, `flowers`), so they gather over the flowers.
   */
  private updateButterflies(dt: number): void {
    const B = AMBIENT.butterflies;
    const { t } = this.frame;
    const amount = this.frame.share('butterflies');
    this.butterflies.forEach((o, j) => {
      if (amount <= 0 || !this.rehome(o, dt, 1.2)) return this.hideWings(j);
      if (!o.sought) this.seekFlower(o);
      let g = rankGate(amount, (j + 0.5) / B.count);
      if (o.drawn) g = Math.max(g, B.flowers * smoothstep(0.02, 0.2, amount));
      if (g <= 0) return this.hideWings(j);
      const [, , r2, r3, r4, r5] = o.r;
      const a = t * 0.45 + r2 * TAU;
      const b = t * 0.31 + r3 * TAU;
      const roam = o.drawn ? B.roam * B.flowerRoam : B.roam;
      const x = o.hx + roam * (Math.sin(a) + 0.4 * Math.sin(2.3 * b));
      const z = o.hz + roam * (Math.cos(1.2 * b) + 0.4 * Math.sin(1.7 * a));
      const vx = 0.45 * Math.cos(a) + 0.285 * Math.cos(2.3 * b);
      const vz = -0.372 * Math.sin(1.2 * b) + 0.306 * Math.cos(1.7 * a);
      const y = mixRange(B.height, 0.5 + 0.5 * Math.sin(t * 0.8 + r4 * TAU)) + 0.04 * Math.sin(t * B.flap);
      const k = g * this.clearLine.k(x, y, z);
      if (k <= 0.01) return this.hideWings(j);
      const flap = 0.1 + 1.05 * Math.abs(Math.sin(t * B.flap + r5 * TAU));
      _yaw.setFromAxisAngle(Y_AXIS, Math.atan2(vx, vz));
      _p.set(x, y, z);
      for (const side of [1, -1]) {
        // the right wing lifts by rolling about the body; the left is its mirror (x scaled by -1)
        _q.copy(_yaw).multiply(_roll.setFromAxisAngle(Z_AXIS, side * flap));
        _s.set(side * B.size * k, 1, B.size * 1.25 * k);
        this.wings.setMatrixAt(j * 2 + (side > 0 ? 0 : 1), _m.compose(_p, _q, _s));
      }
    });
    this.wings.instanceMatrix.needsUpdate = true;
  }

  /**
   * papertrails' fireflies: each loops slowly round its home and pulses (glow 3.6, a squared sine); one whose home has
   * water within reach moves over the bank and comes out whatever its rank, so they gather over streams and shores.
   */
  private updateFireflies(dt: number): void {
    const F = AMBIENT.fireflies;
    const { t, night } = this.frame;
    const amount = this.frame.share('fireflies');
    this.fireflies.forEach((o, j) => {
      if (night <= 0.01 || !this.rehome(o, dt, 0.3)) return this.hideSpark(j);
      if (!o.sought) this.seekWater(o);
      let g = rankGate(amount, (j + 0.5) / F.count);
      if (o.drawn) g = Math.max(g, F.water * smoothstep(0.02, 0.2, amount));
      if (g <= 0) return this.hideSpark(j);
      const [, , r2, r3, r4, r5] = o.r;
      const a = t * 0.33 + r2 * TAU;
      const b = t * 0.21 + r3 * TAU;
      const x = o.hx + F.roam * (Math.sin(a) + 0.5 * Math.sin(2.1 * b));
      const z = o.hz + F.roam * (Math.cos(1.3 * b) + 0.5 * Math.sin(1.6 * a));
      const y = mixRange(F.height, 0.5 + 0.5 * Math.sin(t * 0.4 + r2 * TAU));
      let pulse = Math.sin(t * (0.9 + r4 * 0.9) + r5 * TAU);
      pulse = pulse > 0 ? pulse * pulse : 0;
      const glow = F.glow * g * this.clearLine.k(x, y, z) * (0.12 + 0.88 * pulse);
      _s.setScalar(F.size * (0.75 + 0.5 * r4));
      this.sparks.setMatrixAt(j, _m.compose(_p.set(x, y, z), this.camQ, _s));
      this.sparks.setColorAt(j, _c.copy(this.fireColor).multiplyScalar(glow));
    });
    this.sparks.instanceMatrix.needsUpdate = true;
    this.sparks.instanceColor!.needsUpdate = true;
  }

  /** papertrails' spot search: rings of 8 out to 2.4 round the home; the first water found pulls the home 0.85 there. */
  private seekWater(o: Roamer): void {
    o.sought = true;
    for (let ri = 1; ri <= 3; ri++) {
      for (let k = 0; k < 8; k++) {
        const a = (k + o.r[0] * 8 * 0.37) * (TAU / 8);
        const ox = Math.cos(a) * ri * 0.8;
        const oz = Math.sin(a) * ri * 0.8;
        if (this.wet(o.hx + ox, o.hz + oz)) {
          o.hx += ox * 0.85;
          o.hz += oz * 0.85;
          o.drawn = true;
          return;
        }
      }
    }
  }

  /** A butterfly's home moves onto the nearest flower within reach, if any (looked up once a home). */
  private seekFlower(o: Roamer): void {
    o.sought = true;
    const f = this.world.flower(o.hx, o.hz, AMBIENT.butterflies.flowerReach);
    if (!f) return;
    [o.hx, o.hz] = f;
    o.drawn = true;
  }

  private hideWings(j: number): void {
    this.wings.setMatrixAt(j * 2, _m.makeScale(0, 0, 0));
    this.wings.setMatrixAt(j * 2 + 1, _m);
  }

  private hideSpark(j: number): void {
    this.sparks.setMatrixAt(j, _m.makeScale(0, 0, 0));
  }
}
