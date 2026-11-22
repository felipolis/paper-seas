/**
 * Things adrift: barrels, crates, buoys, broken masts, an empty rowing boat and the odd message in a bottle. They sit
 * on a sparse world grid (deterministic, like the waves), pop up and fold away by the same ring as the land and the
 * waves (world/reveal.ts), and bob in the swell. Sail over a bottle to pick it up and read its message.
 */
import * as THREE from 'three';
import { WORLD } from '../config/world';
import { DEG } from '../core/math';
import { bus } from '../core/events';
import { hash01, mulberry32 } from '../core/rng';
import { FoldGroup } from '../popup/fold-group';
import { createCard } from '../popup/card';
import { spriteArt } from '../art/sprites';
import type { Reveal } from '../world/reveal';

const CELL = 8;
const CHANCE = 0.3;
const SPAWN_RADIUS = 20;
const PICKUP_RADIUS = 1.3;
const STORAGE_KEY = 'paper-seas:bottles:v1';

const KINDS: ReadonlyArray<{ sprite: string; height: number; weight: number }> = [
  { sprite: 'barrel-float', height: 0.42, weight: 0.26 },
  { sprite: 'crate-float', height: 0.4, weight: 0.16 },
  { sprite: 'buoy', height: 0.62, weight: 0.14 },
  { sprite: 'wreck-mast', height: 0.95, weight: 0.12 },
  { sprite: 'rowboat', height: 0.42, weight: 0.12 },
  { sprite: 'bottle', height: 0.42, weight: 0.2 },
];

const MESSAGES = [
  'Three palms and a skull. Dig where the shadow falls at noon.',
  'Whoever reads this: the kraken sleeps by day.',
  'Saltwind owes me forty doubloons. Collect them for me.',
  'The ghost ship only sails when the lanterns are lit.',
  'Left at the lighthouse, then follow the gulls.',
  'Not all who wander the paper seas are lost.',
  'Our cook fed the sea serpent. We regret nothing.',
  'If found, return this bottle to the sea. It likes it there.',
  'Seven islands west, a lagoon as round as a coin.',
  'The tide folds everything flat in the end.',
];

interface Item {
  key: number;
  x: number;
  z: number;
  sprite: string;
  node: THREE.Group;
  bob: THREE.Group;
  fold: FoldGroup;
  phase: number;
}

export class Flotsam {
  readonly group = new THREE.Group();
  private readonly items = new Map<number, Item>();
  private readonly found = new Set<number>();
  private lastI = Number.NaN;
  private lastJ = Number.NaN;
  private t = 0;
  private spawnR = SPAWN_RADIUS;

  constructor(private readonly isOpenWater: (x: number, z: number, margin: number) => boolean) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) (JSON.parse(raw) as number[]).forEach((k) => this.found.add(k));
    } catch {
      // storage unavailable
    }
  }

  /** Forgets every bottle read. */
  reset(): void {
    this.found.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  get bottlesFound(): number {
    return this.found.size;
  }

  /** reveal: the ring the land rises in (what is adrift keeps to it); viewReach: how far the camera sees. */
  update(dt: number, shipX: number, shipZ: number, reveal: Reveal, viewReach: number): void {
    this.t += dt;
    const spawnR = Math.max(SPAWN_RADIUS, Math.min(40, viewReach + 4));
    if (Math.abs(spawnR - this.spawnR) > 1) this.lastI = Number.NaN;
    this.spawnR = spawnR;
    this.stream(shipX, shipZ);
    for (const it of this.items.values()) {
      const d = Math.hypot(it.x - shipX, it.z - shipZ);
      if (reveal.wantsUp(it.x, it.z)) it.fold.setTarget(1, it.phase * 0.3);
      else if (reveal.wantsDown(it.x, it.z)) it.fold.setTarget(0);
      it.fold.update(dt);
      // bob and roll in the swell
      it.bob.position.y = 0.03 * Math.sin(this.t * 1.7 + it.phase * 6);
      it.bob.rotation.z = 0.09 * Math.sin(this.t * 1.1 + it.phase * 9);
      if (it.sprite === 'bottle' && it.fold.currentTarget === 1 && d < PICKUP_RADIUS) this.pickUp(it);
    }
  }

  private pickUp(it: Item): void {
    this.found.add(it.key);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.found]));
    } catch {
      // ignore
    }
    const message = MESSAGES[Math.floor(mulberry32(it.key)() * MESSAGES.length)];
    bus.emit('bottle', { message, total: this.found.size });
    this.drop(it);
  }

  private stream(sx: number, sz: number): void {
    const ci = Math.floor(sx / CELL);
    const cj = Math.floor(sz / CELL);
    if (ci === this.lastI && cj === this.lastJ) return;
    this.lastI = ci;
    this.lastJ = cj;
    const rc = Math.ceil(this.spawnR / CELL);
    const seed = WORLD.seed ^ 0xf107;
    for (let j = cj - rc; j <= cj + rc; j++) {
      for (let i = ci - rc; i <= ci + rc; i++) {
        const key = (i + 32768) * 65536 + (j + 32768);
        if (this.items.has(key) || this.found.has(key)) continue;
        if (hash01(seed, i, j) > CHANCE) continue;
        const x = (i + 0.2 + 0.6 * hash01(seed + 1, i, j)) * CELL;
        const z = (j + 0.2 + 0.6 * hash01(seed + 2, i, j)) * CELL;
        if (Math.hypot(x - sx, z - sz) > this.spawnR || Math.hypot(x, z) < 4) continue;
        if (!this.isOpenWater(x, z, 0.6)) continue;
        let pick = hash01(seed + 3, i, j);
        let kind = KINDS[0];
        for (const k of KINDS) {
          if ((pick -= k.weight) <= 0) { kind = k; break; }
        }
        this.spawn(key, x, z, kind.sprite, kind.height, hash01(seed + 4, i, j));
      }
    }
    for (const it of this.items.values()) {
      if (Math.hypot(it.x - sx, it.z - sz) > this.spawnR + CELL && it.fold.isDown) this.drop(it);
    }
  }

  private spawn(key: number, x: number, z: number, sprite: string, height: number, r: number): void {
    const node = new THREE.Group();
    node.position.set(x, 0.006, z);
    node.rotation.y = (r - 0.5) * 30 * DEG;
    const bob = new THREE.Group();
    bob.add(createCard(spriteArt(sprite, { height: height * (0.85 + 0.3 * r), bottom: -0.04 }), { flipX: r > 0.5 }));
    node.add(bob);
    const fold = new FoldGroup();
    fold.add(node, { size: height, seed: r, wobble: 1.4 });
    this.group.add(node);
    this.items.set(key, { key, x, z, sprite, node, bob, fold, phase: r });
  }

  private drop(it: Item): void {
    this.group.remove(it.node);
    it.node.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.items.delete(it.key);
  }
}
