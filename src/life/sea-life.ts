/**
 * Sea life around the ship. Every few seconds an encounter pops up near the ship, on the side it is heading to:
 *   whale     surfaces (pop-up), swims, blows a spout, dives and waves its tail
 *   dolphins  a small pod leaping alongside (they come up through the sea page, no hinge)
 *   turtle    paddles by
 *   shark     a fin circling
 *   kraken    tentacles rise around a point, sway, and sink again
 * Gulls circle over the ship all the time. Every card faces the camera; creatures heading left use a mirrored print.
 */
import * as THREE from 'three';
import { LIFE } from '../config/life';
import { DEG } from '../core/math';
import { bus } from '../core/events';
import { pickWeighted } from '../core/rng';
import { FoldGroup } from '../popup/fold-group';
import { createCard } from '../popup/card';
import { spriteArt } from '../art/sprites';
import type { ClearLine } from './clear-line';
import { mirrorFor } from '../art/facing';

/** Open water test (set by SeaLife): every creature keeps to it, and nothing that moves ever crosses land. */
let water: (x: number, z: number, margin: number) => boolean = () => true;
/** True when moving a group by (dx, dz) would bring it within `margin` of a shore. */
const blocked = (g: THREE.Object3D, dx: number, dz: number, margin: number): boolean => !water(g.position.x + dx, g.position.z + dz, margin);

interface Encounter {
  readonly group: THREE.Group;
  /** Returns false once finished (then it is removed). */
  update(dt: number, ship: ShipState): boolean;
}

export interface ShipState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  fx: number;
  fz: number;
}

/** A hinged card that pops up out of the sea page. */
function popCard(name: string, height: number, flip: boolean, fold: FoldGroup, delay = 0): THREE.Group {
  const hinge = new THREE.Group();
  hinge.add(createCard(spriteArt(name, { height }), { flipX: flip }));
  hinge.rotation.y = (Math.random() - 0.5) * 10 * DEG;
  fold.add(hinge, { size: height, seed: Math.random(), delay, wobble: 1.4 });
  return hinge;
}

/** A creature card lying flat on the sea would read as a print of it: hide every card of a group that is down. */
function showWhileUp(fold: FoldGroup, node: THREE.Object3D): void {
  node.visible = !fold.isDown;
}

/** Timeline helper: true exactly once when t crosses `at`. */
function crossed(t0: number, t1: number, at: number): boolean {
  return t0 < at && t1 >= at;
}

/**
 * Whale: surfaces (pop-up), swims, blows; then dives (the body folds away and is gone) and only then, a little
 * further on where the head went down, the tail flukes rise, wave and slip under.
 */
class Whale implements Encounter {
  readonly group = new THREE.Group();
  private readonly bodyFold = new FoldGroup();
  private readonly spoutFold = new FoldGroup();
  private readonly tailFold = new FoldGroup();
  private readonly body: THREE.Group;
  private readonly spout: THREE.Group;
  private readonly tail: THREE.Group;
  private readonly tailSway = new THREE.Group();
  private t = 0;
  private tailShown = false;

  constructor(x: number, z: number, private readonly dir: number) {
    this.group.position.set(x, 0.006, z);
    const flip = mirrorFor('whale', dir);
    this.body = popCard('whale', 1.1, flip, this.bodyFold);
    this.spout = popCard('spout', 0.9, false, this.spoutFold);
    this.spout.position.set(0.8 * dir, 0.4, 0.03);
    this.tail = new THREE.Group();
    this.tailSway.add(createCard(spriteArt('whale-tail', { height: 1.2 }), { flipX: flip }));
    this.tail.add(this.tailSway);
    this.tailFold.add(this.tail, { size: 1.2, seed: Math.random(), wobble: 1.6 });
    this.group.add(this.body, this.spout, this.tail);
  }

  update(dt: number): boolean {
    const t0 = this.t;
    this.t += dt;
    const t = this.t;
    if (crossed(t0, t, 0)) this.bodyFold.setTarget(1);
    if (t < 6.8 && !blocked(this.group, this.dir * 1.6, 0, 0.6)) this.group.position.x += this.dir * 0.45 * dt;
    if (crossed(t0, t, 2.2)) {
      this.spoutFold.setTarget(1);
      bus.emit('creature', { kind: 'spout', x: this.group.position.x, z: this.group.position.z });
    }
    if (crossed(t0, t, 3.6)) this.spoutFold.setTarget(0);
    if (crossed(t0, t, 6.2)) this.bodyFold.setTarget(0);
    // the flukes come up only once the body is gone, ahead of where it dived
    if (!this.tailShown && t > 6.2 && this.bodyFold.isDown) {
      this.tailShown = true;
      this.tail.position.set(0.55 * this.dir, 0, 0);
      this.tailFold.setTarget(1);
      bus.emit('creature', { kind: 'splash', x: this.group.position.x, z: this.group.position.z });
    }
    if (this.tailShown) this.tailSway.rotation.z = 0.12 * Math.sin((t - 6) * 3.1) * this.dir;
    if (crossed(t0, t, 10.2)) this.tailFold.setTarget(0);
    this.bodyFold.update(dt);
    this.spoutFold.update(dt);
    this.tailFold.update(dt);
    showWhileUp(this.bodyFold, this.body);
    showWhileUp(this.spoutFold, this.spout);
    showWhileUp(this.tailFold, this.tail);
    return t < 12;
  }
}

class Swimmer implements Encounter {
  readonly group = new THREE.Group();
  private readonly fold = new FoldGroup();
  private t = 0;

  constructor(x: number, z: number, private vx: number, private vz: number, name: string, height: number, private life: number) {
    this.group.position.set(x, 0.006, z);
    this.card = popCard(name, height, mirrorFor(name, vx), this.fold);
    this.group.add(this.card);
    this.fold.setTarget(1);
  }

  private readonly card: THREE.Group;

  update(dt: number): boolean {
    this.t += dt;
    // a shore ahead: it stops and dives
    if ((this.vx || this.vz) && blocked(this.group, Math.sign(this.vx) * 0.9, Math.sign(this.vz) * 0.9, 0.4)) {
      this.vx = this.vz = 0;
      this.life = Math.min(this.life, this.t);
    }
    this.group.position.x += this.vx * dt;
    this.group.position.z += this.vz * dt;
    if (this.t > this.life) this.fold.setTarget(0);
    this.fold.update(dt);
    showWhileUp(this.fold, this.card);
    return !(this.t > this.life && this.fold.isSettled);
  }
}

class Shark implements Encounter {
  readonly group = new THREE.Group();
  private readonly fold = new FoldGroup();
  private readonly fins: THREE.Group[];
  private t = 0;
  private readonly phase = Math.random() * Math.PI * 2;

  constructor(private readonly cx: number, private readonly cz: number) {
    // two hinged fins (one mirrored) on the same spot: the visible one matches the swimming direction
    const right = popCard('shark-fin', 0.42, mirrorFor('shark-fin', 1), this.fold);
    const left = popCard('shark-fin', 0.42, mirrorFor('shark-fin', -1), this.fold);
    this.fins = [right, left];
    this.group.add(right, left);
    this.fold.setTarget(1);
  }

  update(dt: number): boolean {
    this.t += dt;
    const a = this.phase + this.t * 0.75;
    const R = 2.2;
    this.group.position.set(this.cx + Math.cos(a) * R, 0.006, this.cz + Math.sin(a) * R);
    const vx = -Math.sin(a);
    this.fins[0].visible = vx >= 0;
    this.fins[1].visible = vx < 0;
    if (this.t > 11) this.fold.setTarget(0);
    this.fold.update(dt);
    showWhileUp(this.fold, this.group);
    return !(this.t > 11 && this.fold.isSettled);
  }
}

class Kraken implements Encounter {
  readonly group = new THREE.Group();
  private readonly fold = new FoldGroup(0.6);
  private readonly sways: THREE.Group[] = [];
  private t = 0;

  constructor(x: number, z: number) {
    this.group.position.set(x, 0.006, z);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      const hinge = new THREE.Group();
      hinge.position.set(Math.cos(a) * 1.1, 0, Math.sin(a) * 0.8);
      hinge.rotation.y = (Math.random() - 0.5) * 16 * DEG;
      const sway = new THREE.Group();
      sway.add(createCard(spriteArt(i % 2 ? 'tentacle-1' : 'tentacle-0', { height: 1.05 + 0.25 * Math.random() })));
      hinge.add(sway);
      this.sways.push(sway);
      this.group.add(hinge);
      this.fold.add(hinge, { size: 1.2, seed: Math.random(), delay: i / n, wobble: 1.6 });
    }
    this.fold.setTarget(1);
    bus.emit('creature', { kind: 'kraken', x, z });
  }

  update(dt: number): boolean {
    this.t += dt;
    this.sways.forEach((s, i) => { s.rotation.z = 0.13 * Math.sin(this.t * 1.7 + i * 1.3); });
    if (this.t > 7) this.fold.setTarget(0);
    this.fold.update(dt);
    showWhileUp(this.fold, this.group);
    return !(this.t > 7 && this.fold.isSettled);
  }
}

/** How a pod of leapers looks and jumps. */
interface LeaperStyle {
  /** The prints of the pod, one per member in turn (each mirrored as its heading needs). */
  sprites: string[];
  count: number;
  height: number;
  jumps: number;
  /** Seconds in the air, seconds under water between jumps. */
  air: number;
  gap: number;
  /** Peak height of the arc, speed along the ship (units / s), distance from the ship's side. */
  arc: number;
  speed: number;
  side: number;
  spread: number;
}

const DOLPHINS: LeaperStyle = { sprites: ['dolphin-0', 'dolphin-1'], count: 3, height: 0.75, jumps: 3, air: 1.15, gap: 0.45, arc: 1.25, speed: 1.8, side: 1.9, spread: 0.55 };
const FISH_SCHOOL: LeaperStyle = { sprites: ['fish-school'], count: 2, height: 0.55, jumps: 3, air: 0.7, gap: 0.5, arc: 0.6, speed: 2.4, side: 1.6, spread: 0.8 };
const FLYING_FISH: LeaperStyle = { sprites: ['flying-fish'], count: 3, height: 0.42, jumps: 2, air: 1.9, gap: 0.6, arc: 0.55, speed: 3.2, side: 2.2, spread: 0.6 };

/** A pod of creatures leaping alongside the ship: they come up through the sea page (no hinge). */
class Leapers implements Encounter {
  readonly group = new THREE.Group();
  private readonly members: Array<{ node: THREE.Group; right: THREE.Mesh; left: THREE.Mesh; delay: number; side: number }> = [];
  private t = 0;

  constructor(private readonly style: LeaperStyle, private readonly side: number) {
    const h = style.height;
    for (let i = 0; i < style.count; i++) {
      const node = new THREE.Group();
      const sprite = style.sprites[i % style.sprites.length];
      const art = spriteArt(sprite, { height: h, bottom: -h / 2 });
      const right = createCard(art, { flipX: mirrorFor(sprite, 1) });
      const left = createCard(art, { flipX: mirrorFor(sprite, -1) });
      node.add(right, left);
      node.visible = false;
      this.group.add(node);
      this.members.push({ node, right, left, delay: i * 0.38, side: style.side + i * style.spread });
    }
  }

  update(dt: number, ship: ShipState): boolean {
    const st = this.style;
    const t0 = this.t;
    this.t += dt;
    const period = st.air + st.gap;
    // the pod runs alongside the ship, a little faster than it
    const rx = -ship.fz * this.side;
    const rz = ship.fx * this.side;
    const goingRight = ship.fx >= 0;
    for (const d of this.members) {
      const tl = this.t - d.delay;
      const tl0 = t0 - d.delay;
      const cycle = Math.floor(tl / period);
      const s = (tl - cycle * period) / st.air; // 0..1 in the air
      const along = tl * st.speed - 1.3;
      const baseX = ship.x + rx * d.side + ship.fx * along;
      const baseZ = ship.z + rz * d.side + ship.fz * along;
      const inAir = tl >= 0 && cycle < st.jumps && s <= 1 && water(baseX, baseZ, 0.6);
      d.node.visible = inAir;
      if (!inAir) continue;
      const lift = st.arc + st.height * 0.45;
      const y = -st.height * 0.45 + lift * Math.sin(Math.PI * s);
      const slope = lift * Math.PI * Math.cos(Math.PI * s);
      d.node.position.set(baseX, y, baseZ);
      d.node.rotation.z = Math.atan2(slope, st.speed * st.air) * 0.55 * (goingRight ? 1 : -1);
      d.right.visible = goingRight;
      d.left.visible = !goingRight;
      const prevCycle = Math.floor(tl0 / period);
      const prevS = (tl0 - prevCycle * period) / st.air;
      if (prevCycle === cycle && prevS < 0.5 && s >= 0.5) bus.emit('creature', { kind: 'splash', x: baseX, z: baseZ });
    }
    return this.t < st.jumps * period + st.count * 0.4 + 0.8;
  }
}

/** A few jellyfish bobbing up around a point, drifting, then sinking. */
class Jellies implements Encounter {
  readonly group = new THREE.Group();
  private readonly fold = new FoldGroup(0.8);
  private readonly bobs: THREE.Group[] = [];
  private t = 0;

  constructor(x: number, z: number) {
    this.group.position.set(x, 0.006, z);
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const hinge = new THREE.Group();
      hinge.position.set((Math.random() - 0.5) * 2.4, 0, (Math.random() - 0.5) * 1.6);
      const bob = new THREE.Group();
      bob.add(createCard(spriteArt('jellyfish', { height: 0.6 + Math.random() * 0.25 }), { flipX: Math.random() < 0.5 }));
      hinge.add(bob);
      this.bobs.push(bob);
      this.group.add(hinge);
      this.fold.add(hinge, { size: 0.45, seed: Math.random(), delay: i / n, wobble: 1.8 });
    }
    this.fold.setTarget(1);
  }

  update(dt: number): boolean {
    this.t += dt;
    if (!blocked(this.group, 1.6, 0, 0.4)) this.group.position.x += 0.12 * dt;
    this.bobs.forEach((b, i) => {
      b.position.y = 0.05 * Math.max(0, Math.sin(this.t * 1.6 + i));
      b.rotation.z = 0.08 * Math.sin(this.t * 1.2 + i * 2);
    });
    if (this.t > 9) this.fold.setTarget(0);
    this.fold.update(dt);
    showWhileUp(this.fold, this.group);
    return !(this.t > 9 && this.fold.isSettled);
  }
}

/** A sea serpent: tail, humps and head rise one after another along a line and the whole beast glides on. */
class Serpent implements Encounter {
  readonly group = new THREE.Group();
  private readonly fold = new FoldGroup(0.9);
  private t = 0;

  private end = 7.5;

  constructor(x: number, z: number, private readonly dir: number) {
    this.group.position.set(x, 0.006, z);
    // from the back to the front: tail, two humps, head (the head print looks left: mirror it to head right)
    const parts: Array<[string, number, boolean]> = [
      ['serpent-tail', 0.75, mirrorFor('serpent-tail', dir)],
      ['serpent-hump', 0.6, false],
      ['serpent-hump', 0.68, true],
      ['serpent-head', 1.15, mirrorFor('serpent-head', dir)],
    ];
    parts.forEach(([name, h, flip], i) => {
      const hinge = new THREE.Group();
      hinge.position.set((i - 1.5) * 1.05 * dir, 0, (i % 2) * 0.12);
      hinge.add(createCard(spriteArt(name, { height: h }), { flipX: flip }));
      this.group.add(hinge);
      this.fold.add(hinge, { size: h, seed: Math.random(), delay: i / 3, wobble: 1.3 });
    });
    this.fold.setTarget(1);
    bus.emit('creature', { kind: 'kraken', x, z });
  }

  update(dt: number): boolean {
    this.t += dt;
    if (blocked(this.group, this.dir * 2.8, 0, 0.5)) this.end = Math.min(this.end, this.t);
    else this.group.position.x += this.dir * 0.75 * dt;
    if (this.t > this.end) this.fold.setTarget(0);
    this.fold.update(dt);
    showWhileUp(this.fold, this.group);
    return !(this.t > this.end && this.fold.isSettled);
  }
}

/** Another ship crossing in the distance (a merchantman, or a ghost ship by night). */
class PassingShip implements Encounter {
  readonly group = new THREE.Group();
  private readonly fold = new FoldGroup();
  private readonly card: THREE.Group;
  private t = 0;

  constructor(x: number, z: number, private readonly dir: number, ghost: boolean) {
    this.group.position.set(x, 0.006, z);
    const sprite = ghost ? 'ghost-ship' : 'merchant-ship';
    this.card = popCard(sprite, 1.75, mirrorFor(sprite, dir), this.fold);
    this.group.add(this.card);
    this.fold.setTarget(1);
  }

  update(dt: number): boolean {
    this.t += dt;
    // never through an island: land ahead and it folds away where it is
    if (this.t < 14 && blocked(this.group, this.dir * 1.6, 0, 0.9)) this.t = 14;
    if (this.t < 14) this.group.position.x += this.dir * 1.1 * dt;
    this.card.rotation.z = 0.025 * Math.sin(this.t * 1.3);
    if (this.t >= 14) this.fold.setTarget(0);
    this.fold.update(dt);
    showWhileUp(this.fold, this.card);
    return !(this.t > 14 && this.fold.isSettled);
  }
}

/** papertrails' paper flip: the card's facing eases round at this rate (1/s). */
const FLIP_RATE = 11;
/** The share of the gulls still out at night. */
const NIGHT_GULLS = 0.35;

class Gull {
  readonly node = new THREE.Group();
  private readonly frames: THREE.Mesh[];
  /** -1..1: which way the card faces (eased: the paper flip). */
  private face = 1;
  private angle = Math.random() * Math.PI * 2;
  private readonly radius: number;
  private readonly height: number;
  private readonly speed: number;
  private readonly cx: number[] = [0, 0];
  private t = Math.random() * 10;

  constructor() {
    // every frame turned to face right; turning round, the card flips like papertrails' animals (its width eased through 0)
    this.frames = ['gull-up', 'gull-down', 'gull-glide'].map((n) => {
      const m = createCard(spriteArt(n, { height: n === 'gull-glide' ? 0.28 : 0.5, bottom: -0.25 }), { flipX: mirrorFor(n, 1) });
      m.receiveShadow = false;
      this.node.add(m);
      return m;
    });
    this.radius = LIFE.gullRadius[0] + Math.random() * (LIFE.gullRadius[1] - LIFE.gullRadius[0]);
    this.height = LIFE.gullHeight[0] + Math.random() * (LIFE.gullHeight[1] - LIFE.gullHeight[0]);
    this.speed = (0.35 + Math.random() * 0.25) * (Math.random() < 0.5 ? 1 : -1);
  }

  /** shown: 0..1, how far this gull is out (it shrinks away); clear: the shared clear line. */
  update(dt: number, ship: ShipState, shown: number, clear: ClearLine): void {
    this.t += dt;
    // the circle's centre trails the ship
    const k = 1 - Math.exp(-dt * 0.6);
    this.cx[0] += (ship.x - this.cx[0]) * k;
    this.cx[1] += (ship.z - this.cx[1]) * k;
    this.angle += this.speed * dt;
    const x = this.cx[0] + Math.cos(this.angle) * this.radius;
    const z = this.cx[1] + Math.sin(this.angle) * this.radius * 0.7;
    this.node.position.set(x, this.height + 0.15 * Math.sin(this.t * 1.3), z);
    const vx = -Math.sin(this.angle) * this.speed;
    // flap for a while, then glide
    const cyc = this.t % 4.5;
    const frame = cyc < 2.2 ? (Math.floor(this.t / 0.17) % 2) : 2;
    this.frames.forEach((m, fi) => { m.visible = fi === frame; });
    this.face += ((vx >= 0 ? 1 : -1) - this.face) * (1 - Math.exp(-dt * FLIP_RATE));
    const size = shown * clear.k(x, this.node.position.y, z);
    this.node.visible = size > 0.01;
    this.node.scale.set(Math.sign(this.face || 1) * Math.max(0.1, Math.abs(this.face)) * size, size, size);
    this.node.rotation.z = (frame === 2 ? 0.08 : 0) * Math.sign(vx);
  }
}

export class SeaLife {
  readonly group = new THREE.Group();
  private readonly encounters: Encounter[] = [];
  private readonly gulls: Gull[] = [];
  private timer = 4;
  private readonly ship: ShipState = { x: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: -1 };
  /** The share of the gulls out (1 by day, NIGHT_GULLS by night), eased. */
  private flock = 1;

  constructor(
    private readonly isOpenWater: (x: number, z: number, margin: number) => boolean,
    private readonly isNight: () => boolean,
    private readonly clearLine: ClearLine,
  ) {
    water = isOpenWater;
    for (let i = 0; i < LIFE.gulls; i++) {
      const g = new Gull();
      this.gulls.push(g);
      this.group.add(g.node);
    }
  }

  update(dt: number, ship: ShipState): void {
    Object.assign(this.ship, ship);
    // at night most of them roost (papertrails keeps 0.35 of its birds): they go by rank, the last first
    this.flock += ((this.isNight() ? NIGHT_GULLS : 1) - this.flock) * (1 - Math.exp(-dt * 0.5));
    this.gulls.forEach((g, i) => g.update(dt, this.ship, Math.min(1, Math.max(0, (this.flock * this.gulls.length - i) / 0.6)), this.clearLine));
    for (let i = this.encounters.length - 1; i >= 0; i--) {
      const e = this.encounters[i];
      if (!e.update(dt, this.ship)) {
        this.group.remove(e.group);
        e.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
        this.encounters.splice(i, 1);
      }
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = LIFE.spawnInterval[0] + Math.random() * (LIFE.spawnInterval[1] - LIFE.spawnInterval[0]);
      if (this.encounters.length < LIFE.maxActive) this.spawn();
    }
  }

  /** Spawns an encounter now, picked by the weights of LIFE. */
  private spawn(): boolean {
    const s = this.ship;
    const [kind] = pickWeighted(Object.entries(LIFE.weights) as Array<[keyof typeof LIFE.weights, number]>, ([, w]) => w, Math.random());
    const side = Math.random() < 0.5 ? 1 : -1;
    if (kind === 'dolphins') return this.add(new Leapers(DOLPHINS, side));
    if (kind === 'fishSchool') return this.add(new Leapers(FISH_SCHOOL, side));
    if (kind === 'flyingFish') return this.add(new Leapers(FLYING_FISH, side));
    if (kind === 'ship') {
      // far out to one side, crossing the view
      const a = Math.atan2(s.fz, s.fx) + side * (Math.PI / 2 + (Math.random() - 0.5) * 0.8);
      const d = 8 + Math.random() * 3;
      const x = s.x + Math.cos(a) * d;
      const z = s.z + Math.sin(a) * d;
      const dir = Math.random() < 0.5 ? 1 : -1;
      for (let k = 0; k <= 16; k++) if (!this.isOpenWater(x + dir * k, z, 1.2)) return false;
      return this.add(new PassingShip(x, z, dir, this.isNight() && Math.random() < 0.7));
    }
    // somewhere ahead-ish of the ship, in open water
    for (let attempt = 0; attempt < 8; attempt++) {
      // off to one side and a little ahead: inside the sharp band of the lens, not up in the blurred distance
      const a = Math.atan2(s.fz, s.fx) + side * (0.55 + Math.random() * 0.9);
      const d = LIFE.spawnDistance[0] + Math.random() * (LIFE.spawnDistance[1] - LIFE.spawnDistance[0]);
      const x = s.x + Math.cos(a) * d;
      const z = s.z + Math.sin(a) * d;
      if (!this.isOpenWater(x, z, kind === 'kraken' || kind === 'shark' ? 2.5 : 1.5)) continue;
      const dir = Math.random() < 0.5 ? 1 : -1;
      if (kind === 'whale') return this.add(new Whale(x, z, dir));
      if (kind === 'turtle') return this.add(new Swimmer(x, z, dir * 0.35, (Math.random() - 0.5) * 0.2, 'turtle', 0.6, 8));
      if (kind === 'manta') return this.add(new Swimmer(x, z, dir * 0.6, (Math.random() - 0.5) * 0.3, 'manta', 0.62, 8));
      if (kind === 'octopus') return this.add(new Swimmer(x, z, dir * 0.08, 0, 'octopus', 0.75, 6));
      if (kind === 'jellyfish') return this.add(new Jellies(x, z));
      if (kind === 'serpent') return this.add(new Serpent(x, z, dir));
      if (kind === 'shark') return this.add(new Shark(x, z));
      return this.add(new Kraken(x, z));
    }
    return false;
  }

  private add(e: Encounter): boolean {
    this.encounters.push(e);
    this.group.add(e.group);
    return true;
  }

}
