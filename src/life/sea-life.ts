/**
 * Sea life around the ship. Now and then an encounter pops up near the ship, on the side it is heading to:
 *   whale     surfaces (pop-up), swims, blows a spout, dives and waves its tail
 *   dolphins  a small pod leaping along its own line: each on an arm turning about an axle under the sea page
 *   turtle    paddles by
 *   shark     a fin circling
 *   kraken    tentacles rise around a point, sway, and sink again
 * Gulls circle spots of their own over the sea (nothing follows the ship: a spot left behind, its gull shrinks away and
 * comes back over one ahead). Every card faces the camera; creatures heading left use a mirrored print.
 */
import * as THREE from 'three';
import { LIFE } from '../config/life';
import { DEG, clamp } from '../core/math';
import { bus } from '../core/events';
import { pickWeighted, stream } from '../core/rng';
import { FoldGroup } from '../popup/fold-group';
import { createCard } from '../popup/card';
import { spriteArt } from '../art/sprites';
import type { ClearLine } from './clear-line';
import { mirrorFor } from '../art/facing';

type EncounterKind = 'dolphins' | 'whale' | 'turtle' | 'shark' | 'kraken' | 'manta' | 'jellyfish' | 'octopus' | 'serpent' | 'fishSchool' | 'flyingFish' | 'ship';

/** This module's seeded randomness (core/rng.ts stream). */
const random = stream('sea-life');

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
  fx: number;
  fz: number;
}

/** How far a sea card turns off square to the view, either way (rad). */
const POP_YAW = 5 * DEG;

/** A fresh turn off square to the view for a sea card (within POP_YAW). */
function popYaw(): number {
  return (random() - 0.5) * 2 * POP_YAW;
}

/**
 * How a sea card pops up: its turn about the vertical (a fresh popYaw if not given) and the way it lies folded
 * (FoldGroup's: back, away from the camera, if not given).
 */
interface Pop {
  yaw?: number;
  foldAngle?: number;
}

/** A hinged card that pops up out of the sea page. */
function popCard(name: string, height: number, flip: boolean, fold: FoldGroup, pop: Pop = {}): THREE.Group {
  return popHinge(createCard(spriteArt(name, { height }), { flipX: flip }), height, fold, pop);
}

/** A hinge holding `content` (a card, or a node a card moves on), `size` tall, that pops up out of the sea page. */
function popHinge(content: THREE.Object3D, size: number, fold: FoldGroup, { yaw = popYaw(), foldAngle }: Pop = {}): THREE.Group {
  const hinge = new THREE.Group();
  hinge.add(content);
  hinge.rotation.y = yaw;
  fold.add(hinge, { size, seed: random(), wobble: 1.4, foldAngle });
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

/** Where the whale's spout stands from its body's foot, in the body's own frame, for a whale heading right. */
const SPOUT_AT = new THREE.Vector3(0.8, 0.4, 0.1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

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
    const yaw = popYaw();
    this.body = popCard('whale', 1.1, flip, this.bodyFold, { yaw });
    // the spout stands square with the body, clear in front of its head, and folds forward: rising and folding it
    // never cuts through the body
    this.spout = popCard('spout', 0.9, false, this.spoutFold, { yaw, foldAngle: Math.PI / 2 });
    this.spout.position.copy(SPOUT_AT).setX(SPOUT_AT.x * dir).applyAxisAngle(Y_AXIS, yaw);
    this.tail = new THREE.Group();
    this.tailSway.add(createCard(spriteArt('whale-tail', { height: 1.2 }), { flipX: flip }));
    this.tail.add(this.tailSway);
    this.tailFold.add(this.tail, { size: 1.2, seed: random(), wobble: 1.6 });
    this.group.add(this.body, this.spout, this.tail);
    this.bodyFold.setTarget(1);
  }

  update(dt: number): boolean {
    const t0 = this.t;
    this.t += dt;
    const t = this.t;
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
    // (flukes that came up only after this slip under again at once: they never keep the whale)
    if (this.tailShown && t >= 10.2) this.tailFold.setTarget(0);
    this.bodyFold.update(dt);
    this.spoutFold.update(dt);
    this.tailFold.update(dt);
    showWhileUp(this.bodyFold, this.body);
    showWhileUp(this.spoutFold, this.spout);
    showWhileUp(this.tailFold, this.tail);
    return !(t > 12 && this.bodyFold.isDown && this.spoutFold.isDown && this.tailFold.isDown);
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
  private readonly phase = random() * Math.PI * 2;

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
      hinge.rotation.y = (random() - 0.5) * 16 * DEG;
      const sway = new THREE.Group();
      // (dealt a size by scale, keeping the art of its base height: popup/card.ts caches a geometry per art)
      const tentacle = createCard(spriteArt(i % 2 ? 'tentacle-1' : 'tentacle-0', { height: 1.05 }));
      const s = 1 + (0.25 * random()) / 1.05;
      tentacle.scale.set(s, s, 1);
      sway.add(tentacle);
      hinge.add(sway);
      this.sways.push(sway);
      this.group.add(hinge);
      this.fold.add(hinge, { size: 1.2, seed: random(), delay: i / n, wobble: 1.6 });
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
  /**
   * How far (degrees) the arm swings either side of upright: the leap's arc is the circle its tip draws, wide enough to
   * cover speed x air; then the speed along the ship (units / s) and the distance from the ship's side.
   */
  swing: number;
  speed: number;
  side: number;
  spread: number;
}

const DOLPHINS: LeaperStyle = { sprites: ['dolphin-0', 'dolphin-1'], count: 3, height: 0.75, jumps: 3, air: 1.15, gap: 0.45, swing: 80, speed: 1.8, side: 1.9, spread: 0.55 };
const FISH_SCHOOL: LeaperStyle = { sprites: ['fish-school'], count: 2, height: 0.55, jumps: 3, air: 0.7, gap: 0.5, swing: 65, speed: 2.4, side: 1.6, spread: 0.8 };
const FLYING_FISH: LeaperStyle = { sprites: ['flying-fish'], count: 3, height: 0.42, jumps: 2, air: 1.9, gap: 0.6, swing: 30, speed: 3.2, side: 2.2, spread: 0.6 };
/** A leaper's card turns on its pin this share of its arm's angle (its nose leads up and down, never past steep). */
const LEAP_PIN = 0.55;

/**
 * A pod of creatures leaping beside the ship's track (along its own line, from where it came up), as a paper mover: each rides an arm turning about an axle under the
 * sea page, so it swings up out of the water, over and back in, only ever turning (the axle steps on between leaps).
 */
class Leapers implements Encounter {
  readonly group = new THREE.Group();
  private readonly members: Array<{ node: THREE.Group; right: THREE.Mesh; left: THREE.Mesh; delay: number; side: number }> = [];
  private t = 0;
  /** Where the pod came up and the line it runs (the ship's place and heading then): it never paces the ship. */
  private from: { x: number; z: number; fx: number; fz: number } | null = null;

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
    // the pod runs its own line, from beside where the ship was when it came up, the way the ship was heading
    const o = (this.from ??= { x: ship.x, z: ship.z, fx: ship.fx, fz: ship.fz });
    const rx = -o.fz * this.side;
    const rz = o.fx * this.side;
    const goingRight = o.fx >= 0;
    for (const d of this.members) {
      const tl = this.t - d.delay;
      const tl0 = t0 - d.delay;
      const cycle = Math.floor(tl / period);
      const s = (tl - cycle * period) / st.air; // 0..1 in the air
      const along = tl * st.speed - 1.3;
      const baseX = o.x + rx * d.side + o.fx * along;
      const baseZ = o.z + rz * d.side + o.fz * along;
      const inAir = tl >= 0 && cycle < st.jumps && s <= 1 && water(baseX, baseZ, 0.6);
      d.node.visible = inAir;
      if (!inAir) continue;
      // the arm: long enough that its swing covers the leap; its axle below the water, so the creature's middle
      // leaves and meets the page at the ends of the swing; the axle stays put through the leap (where it is half-way)
      const swing = st.swing * DEG;
      const arm = (st.speed * st.air) / (2 * Math.sin(swing));
      const axleY = -st.height * 0.45 - arm * Math.cos(swing);
      const angle = swing * (2 * s - 1);
      const back = (s - 0.5) * st.air * st.speed;
      const ax = baseX - o.fx * back;
      const az = baseZ - o.fz * back;
      const reach = arm * Math.sin(angle);
      d.node.position.set(ax + o.fx * reach, axleY + arm * Math.cos(angle), az + o.fz * reach);
      d.node.rotation.z = -angle * LEAP_PIN * (goingRight ? 1 : -1);
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
    const n = 3 + Math.floor(random() * 3);
    for (let i = 0; i < n; i++) {
      const hinge = new THREE.Group();
      hinge.position.set((random() - 0.5) * 2.4, 0, (random() - 0.5) * 1.6);
      const bob = new THREE.Group();
      const s = 1 + (random() * 0.25) / 0.6;
      const jelly = createCard(spriteArt('jellyfish', { height: 0.6 }), { flipX: random() < 0.5 });
      jelly.scale.set(s, s, 1);
      bob.add(jelly);
      hinge.add(bob);
      this.bobs.push(bob);
      this.group.add(hinge);
      this.fold.add(hinge, { size: 0.45, seed: random(), delay: i / n, wobble: 1.8 });
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
      this.fold.add(hinge, { size: h, seed: random(), delay: i / 3, wobble: 1.3 });
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

/** Another ship crossing in the distance (a merchantman, or now and then by night a ghost ship: GHOST_SHARE). */
class PassingShip implements Encounter {
  readonly group = new THREE.Group();
  private readonly fold = new FoldGroup();
  private readonly hinge: THREE.Group;
  /** Her rocking, inside the hinge (the fold drives the hinge's pose), as the whale's flukes. */
  private readonly rock = new THREE.Group();
  private t = 0;

  constructor(x: number, z: number, private readonly dir: number, ghost: boolean) {
    this.group.position.set(x, 0.006, z);
    const sprite = ghost ? 'ghost-ship' : 'merchant-ship';
    this.rock.add(createCard(spriteArt(sprite, { height: 1.75 }), { flipX: mirrorFor(sprite, dir) }));
    this.hinge = popHinge(this.rock, 1.75, this.fold);
    this.group.add(this.hinge);
    this.fold.setTarget(1);
  }

  update(dt: number): boolean {
    this.t += dt;
    // never through an island: land ahead and it folds away where it is
    if (this.t < 14 && blocked(this.group, this.dir * 1.6, 0, 0.9)) this.t = 14;
    if (this.t < 14) this.group.position.x += this.dir * 1.1 * dt;
    this.rock.rotation.z = 0.025 * Math.sin(this.t * 1.3);
    if (this.t >= 14) this.fold.setTarget(0);
    this.fold.update(dt);
    showWhileUp(this.fold, this.hinge);
    return !(this.t > 14 && this.fold.isSettled);
  }
}

/** The share of the ships passing by night that are ghosts (a glimpse now and then; the Phantom is life/marvels.ts). */
const GHOST_SHARE = 0.1;

/** The paper flip: the card's facing eases round at this rate (1/s), cut across its middle below FLIP_CUT. */
const FLIP_RATE = 11;
const FLIP_CUT = 0.3;
/** The share of the gulls still out at night. */
const NIGHT_GULLS = 0.35;

class Gull {
  readonly node = new THREE.Group();
  private readonly frames: THREE.Mesh[];
  /** -1..1: which way the card faces (eased: the paper flip). */
  private face = 1;
  private angle = random() * Math.PI * 2;
  private readonly radius: number;
  private readonly height: number;
  private readonly speed: number;
  /** The spot it circles, and how far it is out (0 gone .. 1 out): it shrinks away when the ship leaves the spot behind. */
  private readonly cx: number[] = [0, 0];
  private placed = false;
  private out = 0;
  private t = random() * 10;

  constructor() {
    // every frame turned to face right; turning round, the card flips (its width eased through 0)
    this.frames = ['gull-up', 'gull-down', 'gull-glide'].map((n) => {
      const m = createCard(spriteArt(n, { height: n === 'gull-glide' ? 0.28 : 0.5, bottom: -0.25 }), { flipX: mirrorFor(n, 1) });
      m.receiveShadow = false;
      this.node.add(m);
      return m;
    });
    this.radius = LIFE.gullRadius[0] + random() * (LIFE.gullRadius[1] - LIFE.gullRadius[0]);
    this.height = LIFE.gullHeight[0] + random() * (LIFE.gullHeight[1] - LIFE.gullHeight[0]);
    this.speed = (0.35 + random() * 0.25) * (random() < 0.5 ? 1 : -1);
  }

  /** shown: 0..1, how far this gull is out (it shrinks away); clear: the shared clear line. */
  update(dt: number, ship: ShipState, shown: number, clear: ClearLine): void {
    this.t += dt;
    // its own spot: kept while the ship is near; left behind, the gull shrinks away and then takes a spot ahead
    const far = !this.placed || Math.hypot(ship.x - this.cx[0], ship.z - this.cx[1]) > LIFE.gullRange;
    this.out += ((far ? 0 : 1) - this.out) * (1 - Math.exp(-dt * 1.5));
    if (far && this.out < 0.02) {
      const ahead = LIFE.gullAhead[0] + random() * (LIFE.gullAhead[1] - LIFE.gullAhead[0]);
      const side = (random() - 0.5) * 6;
      this.cx[0] = ship.x + ship.fx * ahead - ship.fz * side;
      this.cx[1] = ship.z + ship.fz * ahead + ship.fx * side;
      this.placed = true;
    }
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
    // (the flip cut at its middle: never seen edge-on, it jumps across)
    if (Math.abs(this.face) < FLIP_CUT) this.face = FLIP_CUT * (vx >= 0 ? 1 : -1);
    const size = shown * this.out * clear.k(x, this.node.position.y, z);
    this.node.visible = size > 0.01;
    this.node.scale.set(this.face * size, size, size);
    this.node.rotation.z = (frame === 2 ? 0.08 : 0) * Math.sign(vx);
  }
}

export class SeaLife {
  readonly group = new THREE.Group();
  private readonly encounters: Encounter[] = [];
  private readonly gulls: Gull[] = [];
  private timer = 4;
  private readonly ship: ShipState = { x: 0, z: 0, fx: 0, fz: -1 };
  /** The share of the gulls out (1 by day, NIGHT_GULLS by night, none out in the deep), eased. */
  private flock = 1;

  constructor(
    private readonly isOpenWater: (x: number, z: number, margin: number) => boolean,
    /** Signed distance to the nearest shore (positive at sea): which of LIFE.zones the ship is in. */
    private readonly shoreDistance: (x: number, z: number) => number,
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
    // at night most of them roost (0.35 of them stay out): they go by rank, the last first
    const zone = this.zone();
    this.flock += ((zone.gulls ? (this.isNight() ? NIGHT_GULLS : 1) : 0) - this.flock) * (1 - Math.exp(-dt * 0.5));
    this.gulls.forEach((g, i) => g.update(dt, this.ship, clamp((this.flock * this.gulls.length - i) / 0.6, 0, 1), this.clearLine));
    for (let i = this.encounters.length - 1; i >= 0; i--) {
      const e = this.encounters[i];
      if (!e.update(dt, this.ship)) {
        // (their cards' geometry is the sprites' own, cached and shared: popup/card.ts)
        this.group.remove(e.group);
        this.encounters.splice(i, 1);
      }
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = LIFE.spawnInterval[0] + random() * (LIFE.spawnInterval[1] - LIFE.spawnInterval[0]);
      if (this.encounters.length < LIFE.maxActive) this.spawn();
    }
  }

  /** The sea's environment where the ship is (LIFE.zones). */
  private zone(): (typeof LIFE.zones)[number] {
    const d = this.shoreDistance(this.ship.x, this.ship.z);
    return LIFE.zones.find((z) => d < z.until) ?? LIFE.zones[LIFE.zones.length - 1];
  }

  /** Spawns an encounter now, picked by the weights of the ship's environment. */
  private spawn(): void {
    const s = this.ship;
    const [kind] = pickWeighted(Object.entries(this.zone().weights) as Array<[EncounterKind, number]>, ([, w]) => w, random());
    const side = random() < 0.5 ? 1 : -1;
    if (kind === 'dolphins') return this.add(new Leapers(DOLPHINS, side));
    if (kind === 'fishSchool') return this.add(new Leapers(FISH_SCHOOL, side));
    if (kind === 'flyingFish') return this.add(new Leapers(FLYING_FISH, side));
    if (kind === 'ship') {
      // far out to one side, crossing the view
      const a = Math.atan2(s.fz, s.fx) + side * (Math.PI / 2 + (random() - 0.5) * 0.8);
      const d = 8 + random() * 3;
      const x = s.x + Math.cos(a) * d;
      const z = s.z + Math.sin(a) * d;
      const dir = random() < 0.5 ? 1 : -1;
      for (let k = 0; k <= 16; k++) if (!this.isOpenWater(x + dir * k, z, 1.2)) return;
      return this.add(new PassingShip(x, z, dir, this.isNight() && random() < GHOST_SHARE));
    }
    // somewhere ahead-ish of the ship, in open water
    for (let attempt = 0; attempt < 8; attempt++) {
      // off to one side and a little ahead: inside the sharp band of the lens, not up in the blurred distance
      const a = Math.atan2(s.fz, s.fx) + side * (0.55 + random() * 0.9);
      const d = LIFE.spawnDistance[0] + random() * (LIFE.spawnDistance[1] - LIFE.spawnDistance[0]);
      const x = s.x + Math.cos(a) * d;
      const z = s.z + Math.sin(a) * d;
      if (!this.isOpenWater(x, z, kind === 'kraken' || kind === 'shark' ? 2.5 : 1.5)) continue;
      const dir = random() < 0.5 ? 1 : -1;
      if (kind === 'whale') return this.add(new Whale(x, z, dir));
      if (kind === 'turtle') return this.add(new Swimmer(x, z, dir * 0.35, (random() - 0.5) * 0.2, 'turtle', 0.6, 8));
      if (kind === 'manta') return this.add(new Swimmer(x, z, dir * 0.6, (random() - 0.5) * 0.3, 'manta', 0.62, 8));
      if (kind === 'octopus') return this.add(new Swimmer(x, z, dir * 0.08, 0, 'octopus', 0.75, 6));
      if (kind === 'jellyfish') return this.add(new Jellies(x, z));
      if (kind === 'serpent') return this.add(new Serpent(x, z, dir));
      if (kind === 'shark') return this.add(new Shark(x, z));
      return this.add(new Kraken(x, z));
    }
  }

  private add(e: Encounter): void {
    // (posed once before it is first drawn: what lies folded is hidden from the start, never shown flat for a frame)
    e.update(0, this.ship);
    this.encounters.push(e);
    this.group.add(e.group);
  }

}
