/**
 * Chimney smoke: round paper discs cut with a spiral and a darker lip, turned to the camera, rising off every standing
 * chimney near the focus, growing as they rise, drifting with the wind and fading away. A chimney starts puffing a
 * moment after its house stands; the smoke rests at night.
 */
import * as THREE from 'three';
import { createPaperMaterial } from '../render/paper-material';
import type { ClearLine } from './clear-line';
import { stream } from '../core/rng';

/** This module's seeded randomness (core/rng.ts stream). */
const random = stream('smoke');

const EMITTERS = 10;
const PER_EMITTER = 4;
/** A puff lives 5.4 s, rises 0.78 and grows 0.085 -> 0.235; it fades in over the first 14 %, out after 68 %. */
const LIFE = 5.4;
const RISE = 0.78;
const SIZE: [number, number] = [0.085, 0.235];
const FADE_IN = 0.14;
const FADE_OUT = 0.68;
const DRIFT = 0.2;
const WOBBLE = 0.045;
const SPIN = 0.5;
/** A chimney starts this long after its house stands (s), and only within this distance of the focus. */
const START: [number, number] = [0.7, 1.7];
const REACH = 12;
/** A puff shown smaller than this (world units) is not drawn. */
const MIN_SIZE = 0.002;

const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _spin = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export interface Chimney {
  /** Identifies the house (its smoke keeps its own timing). */
  key: object;
  at: THREE.Vector3;
}

/** A puff card: a cream disc with a spiral cut into it and a darker lip round its edge. */
function puffTexture(fill: string): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.translate(s / 2, s / 2);
  ctx.fillStyle = '#d9c6a2';
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,120,86,0.55)';
  ctx.lineWidth = s * 0.025;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let t = 0; t <= 1; t += 0.01) {
    const a = t * Math.PI * 4.2;
    const r = s * (0.05 + 0.3 * t);
    if (t === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Puff {
  alive: boolean;
  age: number;
  x: number;
  y: number;
  z: number;
  spin: number;
  seed: number;
}

export class Smoke {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[];
  private readonly puffs: Puff[][] = [];
  /** When each chimney puffs next (s; set when its house is first seen standing). */
  private readonly next = new WeakMap<object, number>();
  private t = 0;

  constructor(private readonly clearLine: ClearLine) {
    const plane = new THREE.PlaneGeometry(1, 1);
    // two creams, half the puffs each
    this.meshes = ['#fff3dc', '#f8e8cb'].map((fill) => {
      const m = createPaperMaterial({ map: puffTexture(fill), back: null });
      const mesh = new THREE.InstancedMesh(plane, m, (EMITTERS * PER_EMITTER) / 2);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      this.group.add(mesh);
      return mesh;
    });
    for (let k = 0; k < this.meshes.length; k++) {
      this.puffs.push(Array.from({ length: (EMITTERS * PER_EMITTER) / 2 }, () => ({ alive: false, age: 0, x: 0, y: 0, z: 0, spin: 0, seed: 0 })));
    }
  }

  /** chimneys: the standing chimneys round the focus; night: 0..1 (the smoke rests at night). */
  update(dt: number, chimneys: Chimney[], fx: number, fz: number, windX: number, windZ: number, night: number, camera: THREE.Camera): void {
    this.t += dt;
    const near = chimneys
      .filter((c) => Math.hypot(c.at.x - fx, c.at.z - fz) < REACH)
      .sort((a, b) => Math.hypot(a.at.x - fx, a.at.z - fz) - Math.hypot(b.at.x - fx, b.at.z - fz))
      .slice(0, EMITTERS);
    if (night < 0.5) {
      for (const c of near) {
        if (!this.next.has(c.key)) this.next.set(c.key, this.t + START[0] + random() * (START[1] - START[0]));
        if (this.t >= this.next.get(c.key)!) {
          this.emit(c.at);
          this.next.set(c.key, this.t + LIFE / PER_EMITTER);
        }
      }
    }
    camera.getWorldQuaternion(_q);
    this.meshes.forEach((mesh, k) => {
      this.puffs[k].forEach((f, i) => {
        if (f.alive) f.age += dt;
        if (!f.alive || f.age >= LIFE) {
          f.alive = false;
          mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
          return;
        }
        const u = f.age / LIFE;
        const fade = Math.min(1, u / FADE_IN) * (u < FADE_OUT ? 1 : 1 - (u - FADE_OUT) / (1 - FADE_OUT));
        const size = (SIZE[0] + (SIZE[1] - SIZE[0]) * u) * fade;
        _p.set(
          f.x + windX * DRIFT * u * u + Math.sin(this.t * 1.3 + f.seed * 9) * WOBBLE * u,
          f.y + RISE * (1 - (1 - u) * (1 - u)),
          f.z + windZ * DRIFT * u * u,
        );
        const shown = size * this.clearLine.k(_p.x, _p.y, _p.z);
        // (the floor: a puff faded to a speck is not drawn; a speck can light into an invalid pixel)
        if (shown <= MIN_SIZE) {
          mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
          return;
        }
        _r.copy(_q).multiply(_spin.setFromAxisAngle(Z_AXIS, f.spin + this.t * SPIN));
        mesh.setMatrixAt(i, _m.compose(_p, _r, _s.setScalar(shown)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private emit(at: THREE.Vector3): void {
    const k = random() < 0.5 ? 0 : 1;
    const f = this.puffs[k].find((x) => !x.alive);
    if (!f) return;
    Object.assign(f, { alive: true, age: 0, x: at.x, y: at.y + 0.02, z: at.z, spin: random() * 6.28, seed: random() });
  }
}
