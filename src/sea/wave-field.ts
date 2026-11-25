/**
 * The standing paper waves. Wave cards sit on a fixed world grid (hash per cell, so a stretch of sea always has
 * the same waves). They rise and fold by the same ring as the land (world/reveal.ts: ahead of the ship, inside the
 * picture), with the same springs as every other card, rock with a travelling swell while upright, and the bow
 * presses them down as it passes: they spring back up in the wake with a paper wobble.
 *
 * Rendering: one InstancedMesh per wave variant; instance matrices are rewritten every frame (a few hundred).
 */
import * as THREE from 'three';
import { WORLD } from '../config/world';
import { POPUP } from '../config/popup';
import { PALETTE } from '../config/palette';
import { hash01 } from '../core/rng';
import { DEG, clamp } from '../core/math';
import { distanceToSegment } from '../world/polyline';
import { Flap, FixedStepper, flapConstants } from '../popup/spring';
import { bus } from '../core/events';
import { cardGeometry, thickCardGeometry, thickMaterial } from '../popup/card';
import { createPaperMaterial } from '../render/paper-material';
import { spriteArt, spriteInfo, spritesWithPrefix } from '../art/sprites';
import type { CardArt } from '../art/card-painter';
import type { Reveal } from '../world/reveal';
import { cellKey } from '../core/grid';

/** Wave cards are about this wide (world units), but never taller than WAVE_MAX_HEIGHT. */
const WAVE_WIDTH = 1.3;
const WAVE_MAX_HEIGHT = 0.7;
function waveArt(name: string): CardArt {
  const { w, h } = spriteInfo(name);
  return spriteArt(name, { height: Math.min(WAVE_MAX_HEIGHT, (WAVE_WIDTH * h) / w) });
}

const CAPACITY = 900;
const FOLD_ANGLE = -Math.PI / 2;
/** Waves rising in one patch this wide (world units) are one gesture: one flap speaks for them. */
const WAVE_PATCH = 6;

/** The sound gesture of a wave: its patch. */
function waveGesture(w: { x: number; z: number }): string {
  return `w${Math.floor(w.x / WAVE_PATCH)},${Math.floor(w.z / WAVE_PATCH)}`;
}

interface Wave {
  x: number;
  z: number;
  yaw: number;
  scale: number;
  variant: number;
  phase: number;
  flap: Flap;
  /** Time until which the hull keeps this wave pressed flat. */
  pressedUntil: number;
}

/** What the wave field needs to know about the ship this frame. */
export interface WakeSource {
  /** Stern and bow points of the hull on the water (world xz). */
  sternX: number;
  sternZ: number;
  bowX: number;
  bowZ: number;
  halfBeam: number;
  speed: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qFold = new THREE.Quaternion();
const _qTwist = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class WaveField {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly byVariant: Wave[][] = [];
  private readonly heights: number[] = [];
  private readonly waves = new Map<number, Wave>();
  private readonly stepper = new FixedStepper();
  private lastCellI = Number.NaN;
  private lastCellJ = Number.NaN;
  private time = 0;
  /** How far round the focus waves exist (lying flat until the ring raises them): the view's reach. */
  private reach = 0;

  constructor(private readonly isOpenWater: (x: number, z: number, margin: number) => boolean) {
    for (const name of spritesWithPrefix('wave-')) {
      const art = waveArt(name);
      this.heights.push(art.top - art.bottom);
      const material = createPaperMaterial({ map: art.texture, back: PALETTE.seaDeep });
      // thick die-cut cardstock like every other card (falls back to a plane if the print has no silhouette)
      const thick = thickCardGeometry(art);
      const mesh = thick
        ? new THREE.InstancedMesh(thick, thickMaterial(material), CAPACITY)
        : new THREE.InstancedMesh(cardGeometry(art), material, CAPACITY);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.byVariant.push([]);
      this.group.add(mesh);
    }
  }

  /** reveal: the ring the land rises in (the waves keep to it); viewReach: how far the camera sees round the focus. */
  update(dt: number, focusX: number, focusZ: number, ship: WakeSource, reveal: Reveal, viewReach: number): void {
    this.time += dt;
    const reach = Math.max(WORLD.waveSpawnRadius, Math.min(40, viewReach + 2));
    if (Math.abs(reach - this.reach) > 1) this.lastCellI = Number.NaN; // re-stream with the new reach
    this.reach = reach;
    this.stream(focusX, focusZ);

    const W = WORLD;
    const shipX = (ship.sternX + ship.bowX) / 2;
    const shipZ = (ship.sternZ + ship.bowZ) / 2;
    const wakeR = ship.halfBeam + W.wakeHalfWidth;
    const steps = this.stepper.advance(dt);
    const h = POPUP.step;
    const swayAmp = W.swayDeg * DEG;
    const swayW = 2 * Math.PI * W.swayHz;
    const swayK = (2 * Math.PI) / W.swayLength;

    for (let v = 0; v < this.byVariant.length; v++) {
      const list = this.byVariant[v];
      const mesh = this.meshes[v];
      let drawn = 0;
      for (let i = 0; i < list.length; i++) {
        const wave = list[i];
        const flap = wave.flap;
        // the hull presses waves flat; they come back up after it has passed
        if (distanceToSegment(wave.x, wave.z, ship.sternX, ship.sternZ, ship.bowX, ship.bowZ) < wakeR + 0.45 * wave.scale) {
          // (a standing wave is knocked down; one still lying flat, waiting to rise, just stays down)
          if (flap.target === 1) flap.impulse(-2.5 - ship.speed * 0.8);
          // (a rise still waiting is called off, its flap with it)
          if (flap.target === 0 && flap.pendingTarget === 1) bus.emit('paperCancel', { key: waveGesture(wave) });
          if (flap.target === 1 || flap.pendingTarget === 1) flap.setTarget(0);
          wave.pressedUntil = this.time + W.waveHold;
        } else if (this.time >= wave.pressedUntil) {
          if (reveal.wantsUp(wave.x, wave.z)) {
            const sx = wave.x - shipX;
            const sz = wave.z - shipZ;
            const sd = Math.sqrt(sx * sx + sz * sz);
            const delay = sd * W.waveRipple + wave.phase * 0.12;
            // (a patch of waves rising together is one gesture: one sound for it, not a rustle while the ship sails)
            if (flap.target === 0 && flap.pendingTarget !== 1 && sd < 7) {
              bus.emit('paper', { x: wave.x, z: wave.z, height: this.heights[v] * wave.scale, up: true, delay, key: waveGesture(wave) });
            }
            flap.setTarget(1, flap.target === 1 ? 0 : delay);
          } else if (reveal.wantsDown(wave.x, wave.z)) {
            flap.setTarget(0, wave.phase * 0.2);
          }
        }

        if (flap.active) for (let s = 0; s < steps; s++) flap.step(h);
        flap.interpolate(this.stepper.alpha);
        // (lying flat, a wave is drawn face up on the sea: the folded flaps of a pop-up page, seen from afar)
        // pose: yaw * fold about the bottom edge (+ swell sway while standing) * flutter twist
        const p = flap.p;
        const upright = clamp(p, 0, 1);
        const sway = swayAmp * upright * Math.sin(swayW * this.time - swayK * (wave.x * 0.8 + wave.z * 0.6) + wave.phase * 2.1);
        _qFold.setFromAxisAngle(X_AXIS, FOLD_ANGLE * (1 - p) + sway);
        _q.setFromAxisAngle(Y_AXIS, wave.yaw).multiply(_qFold);
        const twist = flap.twist;
        if (twist !== 0) _q.multiply(_qTwist.setFromAxisAngle(Y_AXIS, twist));
        _p.set(wave.x, POPUP.layerGap * (1 + v), wave.z);
        _s.setScalar(wave.scale);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(drawn++, _m);
      }
      mesh.count = drawn;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Spawns waves entering the spawn radius and drops those that left it (once lying flat). */
  private stream(fx: number, fz: number): void {
    const W = WORLD;
    const cell = W.waveCell;
    const ci = Math.floor(fx / cell);
    const cj = Math.floor(fz / cell);
    if (ci === this.lastCellI && cj === this.lastCellJ) return;
    this.lastCellI = ci;
    this.lastCellJ = cj;

    const r = this.reach;
    const rc = Math.ceil(r / cell);
    for (let j = cj - rc; j <= cj + rc; j++) {
      for (let i = ci - rc; i <= ci + rc; i++) {
        const key = cellKey(i, j);
        if (this.waves.has(key)) continue;
        const seed = W.seed ^ 0x5a17;
        if (hash01(seed, i, j) > W.waveChance) continue;
        const x = (i + 0.15 + 0.7 * hash01(seed + 1, i, j)) * cell;
        const z = (j + 0.15 + 0.7 * hash01(seed + 2, i, j)) * cell;
        if ((x - fx) ** 2 + (z - fz) ** 2 > r * r) continue;
        if (!this.isOpenWater(x, z, 0.9)) continue;
        this.spawn(key, x, z, hash01(seed + 3, i, j), hash01(seed + 4, i, j));
      }
    }
    const far = (r + cell * 1.5) ** 2;
    for (const [key, wave] of this.waves) {
      const d2 = (wave.x - fx) ** 2 + (wave.z - fz) ** 2;
      if (d2 > far && (!wave.flap.active || d2 > far * 1.6)) this.despawn(key, wave);
    }
  }

  private spawn(key: number, x: number, z: number, a: number, b: number): void {
    const variants = this.byVariant.length;
    const variant = Math.floor(a * variants) % variants;
    const list = this.byVariant[variant];
    if (list.length >= CAPACITY) return;
    const scale = 0.8 + 0.35 * b;
    const wave: Wave = {
      x,
      z,
      yaw: (b - 0.5) * 30 * DEG,
      scale,
      variant,
      phase: (a * 17.3) % 1,
      flap: new Flap(flapConstants({ size: this.heights[variant] * scale, seed: (a * 31.7) % 1, wobble: 1.3 })),
      pressedUntil: 0,
    };
    list.push(wave);
    this.waves.set(key, wave);
  }

  private despawn(key: number, wave: Wave): void {
    const list = this.byVariant[wave.variant];
    const i = list.indexOf(wave);
    if (i >= 0) {
      list[i] = list[list.length - 1];
      list.pop();
    }
    this.waves.delete(key);
  }
}
