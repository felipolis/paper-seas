/**
 * Rare sights of the Paper Seas (easter eggs). Where and when they can be met is fixed (Atlantis by the world seed,
 * the Phantom by the clock), so they are always there to be found again; the Leviathan is a chance meeting, and small
 * details (which side a sight passes on, how the tentacles stand) are dealt at random each time:
 *
 *   the Phantom Galleon   between 23:30 and 01:00 a ghost ship sails past, glowing green, once a night
 *   Atlantis              here and there (one region in many) a ring of drowned temples lies under the sea; sail
 *                         over it and its pillars and arches rise out of the water around the ship
 *   the Leviathan         at night, very rarely, a huge sea serpent coils past
 *   the Kraken's Garden   near Atlantis by night, tentacles stand up all round the ruins
 */
import * as THREE from 'three';
import { bus } from '../core/events';
import { hash01, stream } from '../core/rng';
import { FoldGroup } from '../popup/fold-group';
import { createCard } from '../popup/card';
import { spriteArt } from '../art/sprites';
import { WORLD } from '../config/world';
import { mirrorFor } from '../art/facing';
import { cellKey } from '../core/grid';

/** This module's seeded randomness (core/rng.ts stream). */
const random = stream('marvels');

/** World hashes are salted with the voyage seed: every voyage places its own villages, ruins, chests... */
const SEED = WORLD.seed;

type Water = (x: number, z: number, margin: number) => boolean;

/** Atlantis sites: one per REGION square, if its hash says so, at a hashed point in it. */
const REGION = 260;
const ATLANTIS_CHANCE = 0.35;
const ATLANTIS_REACH = 9;

function card(name: string, height: number, fold: FoldGroup, delay: number, flip = false): THREE.Group {
  const hinge = new THREE.Group();
  hinge.add(createCard(spriteArt(name, { height }), { flipX: flip }));
  fold.add(hinge, { size: height, seed: random(), delay, wobble: 1.2 });
  return hinge;
}

class Atlantis {
  readonly group = new THREE.Group();
  readonly fold = new FoldGroup(1.6);
  private glow: THREE.Mesh;

  constructor(readonly x: number, readonly z: number) {
    this.group.position.set(x, 0.006, z);
    const ring: Array<[string, number]> = [['pillars', 1.6], ['ruin-arch', 1.9], ['pillars', 1.3], ['sea-arch', 1.5], ['tiki', 1.2], ['ruin-arch', 1.6], ['pillars', 1.5], ['rock-pillar', 1.4]];
    ring.forEach(([name, h], i) => {
      const a = (i / ring.length) * Math.PI * 2;
      const r = 4.2 + (i % 2) * 0.9;
      const c = card(name, h, this.fold, i / ring.length, i % 3 === 0);
      c.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      this.group.add(c);
    });
    // the drowned city glimmering under the water: a pale ring of light on the sea
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const cx = cv.getContext('2d')!;
    const grad = cx.createRadialGradient(64, 64, 10, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 128, 128);
    const g = new THREE.PlaneGeometry(13, 13);
    g.rotateX(-Math.PI / 2);
    this.glow = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), color: '#bff6e6', transparent: true, opacity: 0, depthWrite: false }));
    this.glow.position.y = 0.01;
    this.group.add(this.glow);
    this.fold.snap(0);
    this.group.visible = false;
  }

  update(dt: number, d: number, time: number): void {
    this.fold.setTarget(d < ATLANTIS_REACH ? 1 : 0);
    this.fold.update(dt);
    const up = this.fold.progress;
    this.group.visible = !this.fold.isDown || d < ATLANTIS_REACH * 2.5;
    (this.glow.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.05 - d / 600) + up * 0.05 * (0.7 + 0.3 * Math.sin(time * 1.5));
  }
}

class Phantom {
  readonly group = new THREE.Group();
  readonly fold = new FoldGroup();
  private t = 0;

  constructor(x: number, z: number, private readonly dir: number) {
    this.group.position.set(x, 0.006, z);
    const c = card('ghost-ship', 2.1, this.fold, 0, mirrorFor('ghost-ship', dir));
    // a sickly green glow about her
    c.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m && 'emissive' in m && !Array.isArray(m)) {
        const glow = m.clone();
        glow.emissive = new THREE.Color('#5dff9a');
        glow.emissiveIntensity = 0.55;
        (o as THREE.Mesh).material = glow;
      }
    });
    this.group.add(c);
    const light = new THREE.PointLight('#6dffa8', 2.2, 9, 1.2);
    light.position.set(0, 1.4, 0.4);
    this.group.add(light);
    this.fold.setTarget(1);
  }

  update(dt: number, water: Water): boolean {
    this.t += dt;
    if (this.t < 18 && !water(this.group.position.x + this.dir * 2, this.group.position.z, 1)) this.t = 18;
    if (this.t < 18) this.group.position.x += this.dir * 0.8 * dt;
    this.group.position.y = 0.006 + Math.sin(this.t * 0.9) * 0.04;
    if (this.t >= 18) this.fold.setTarget(0);
    this.fold.update(dt);
    this.group.visible = !this.fold.isDown;
    return !(this.t >= 18 && this.fold.isSettled);
  }
}

class Leviathan {
  readonly group = new THREE.Group();
  readonly fold = new FoldGroup(1.4);
  private t = 0;

  constructor(x: number, z: number, private readonly dir: number) {
    this.group.position.set(x, 0.006, z);
    const parts: Array<[string, number, boolean]> = [['serpent-tail', 1.2, dir < 0], ['serpent-hump', 1.0, false], ['serpent-hump', 1.15, true], ['serpent-hump', 1.05, false], ['serpent-head', 1.9, dir > 0]];
    parts.forEach(([name, h, flip], i) => {
      const c = card(name, h, this.fold, i / parts.length, flip);
      c.position.set((i - 2) * 1.6 * dir, 0, (i % 2) * 0.25);
      this.group.add(c);
    });
    this.fold.setTarget(1);
  }

  update(dt: number, water: Water): boolean {
    this.t += dt;
    if (this.t < 10 && !water(this.group.position.x + this.dir * 5, this.group.position.z, 1)) this.t = 10;
    if (this.t < 10) this.group.position.x += this.dir * 0.9 * dt;
    if (this.t >= 10) this.fold.setTarget(0);
    this.fold.update(dt);
    this.group.visible = !this.fold.isDown;
    return !(this.t >= 10 && this.fold.isSettled);
  }
}

class KrakenGarden {
  readonly group = new THREE.Group();
  readonly fold = new FoldGroup(1.2);
  private t = 0;

  constructor(x: number, z: number) {
    this.group.position.set(x, 0.006, z);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + random() * 0.3;
      const r = 2 + random() * 4.5;
      const c = card(i % 2 ? 'tentacle-1' : 'tentacle-0', 1.2 + random() * 0.7, this.fold, i / 9, random() < 0.5);
      c.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      this.group.add(c);
    }
    this.fold.setTarget(1);
  }

  update(dt: number): boolean {
    this.t += dt;
    this.group.children.forEach((c, i) => { c.rotation.z = Math.sin(this.t * 1.4 + i) * 0.12; });
    if (this.t > 12) this.fold.setTarget(0);
    this.fold.update(dt);
    return !(this.t > 12 && this.fold.isSettled);
  }
}

export class Marvels {
  readonly group = new THREE.Group();
  private readonly sites = new Map<number, Atlantis>();
  private readonly seen = new Set<number>();
  private phantom: Phantom | null = null;
  private phantomNight = -1;
  private leviathan: Leviathan | null = null;
  private garden: KrakenGarden | null = null;
  private gardenAt = -1;
  private time = 0;
  private days = 0;
  private lastHour = 0;

  constructor(private readonly water: Water) {}

  /** The Atlantis site of a region, or null. */
  private siteOf(ri: number, rj: number): [number, number] | null {
    if (hash01((71) ^ SEED, ri, rj) >= ATLANTIS_CHANCE) return null;
    const x = (ri + 0.2 + 0.6 * hash01((73) ^ SEED, ri, rj)) * REGION;
    const z = (rj + 0.2 + 0.6 * hash01((79) ^ SEED, ri, rj)) * REGION;
    // drowned in open water, clear of every shore round the ring
    for (let a = 0; a < 8; a++) if (!this.water(x + Math.cos(a) * 7, z + Math.sin(a) * 7, 1)) return null;
    return [x, z];
  }

  update(dt: number, x: number, z: number, hour: number, night: boolean): void {
    this.time += dt;
    if (hour < this.lastHour - 12) this.days++;
    this.lastHour = hour;

    // Atlantis: keep the nearby sites, drop the far ones
    const ri = Math.floor(x / REGION);
    const rj = Math.floor(z / REGION);
    for (let j = rj - 1; j <= rj + 1; j++) {
      for (let i = ri - 1; i <= ri + 1; i++) {
        const key = cellKey(i, j);
        if (this.sites.has(key)) continue;
        const s = this.siteOf(i, j);
        if (!s) continue;
        const a = new Atlantis(s[0], s[1]);
        this.sites.set(key, a);
        this.group.add(a.group);
      }
    }
    for (const [key, a] of this.sites) {
      const d = Math.hypot(a.x - x, a.z - z);
      if (d > REGION * 2) {
        this.group.remove(a.group);
        this.sites.delete(key);
        continue;
      }
      a.update(dt, d, this.time);
      if (d < ATLANTIS_REACH && !this.seen.has(key)) {
        this.seen.add(key);
        bus.emit('marvel', { title: 'Atlantis!', line: 'The drowned city rises from the deep' });
        bus.emit('creature', { kind: 'kraken', x: a.x, z: a.z });
      }
      // by night the kraken keeps its garden there
      if (night && d < 14 && !this.garden && this.time - this.gardenAt > 90) {
        this.garden = new KrakenGarden(a.x, a.z);
        this.gardenAt = this.time;
        this.group.add(this.garden.group);
        bus.emit('marvel', { title: "The Kraken's Garden", line: 'Something stirs among the ruins' });
      }
    }
    if (this.garden && !this.garden.update(dt)) {
      this.group.remove(this.garden.group);
      this.garden = null;
    }

    // the Phantom Galleon, once a night around midnight
    const midnight = hour > 23.5 || hour < 1;
    if (midnight && !this.phantom && this.phantomNight !== this.days) {
      const side = random() < 0.5 ? 1 : -1;
      const px = x - side * 9;
      const pz = z - 5 - random() * 3;
      if (this.water(px, pz, 2)) {
        this.phantomNight = this.days;
        this.phantom = new Phantom(px, pz, side);
        this.group.add(this.phantom.group);
        bus.emit('marvel', { title: 'The Phantom Galleon', line: 'She sails at midnight, and never makes port' });
      }
    }
    if (this.phantom && !this.phantom.update(dt, this.water)) {
      this.group.remove(this.phantom.group);
      this.phantom = null;
    }

    // the Leviathan: by night, very rarely
    if (night && !this.leviathan && random() < dt / 600) {
      const side = random() < 0.5 ? 1 : -1;
      const lx = x - side * 10;
      const lz = z + (random() - 0.5) * 6;
      if (this.water(lx, lz, 3)) {
        this.leviathan = new Leviathan(lx, lz, side);
        this.group.add(this.leviathan.group);
        bus.emit('marvel', { title: 'The Leviathan', line: 'The oldest thing in the sea passes by' });
        bus.emit('creature', { kind: 'kraken', x: lx, z: lz });
      }
    }
    if (this.leviathan && !this.leviathan.update(dt, this.water)) {
      this.group.remove(this.leviathan.group);
      this.leviathan = null;
    }
  }

}
