/**
 * Going ashore: the captain steps off the ship and walks the island as a layered paper puppet, moved the way
 * papertrails moves its traveller (player/traveller.js there). F near a shore goes ashore, F by the ship goes back
 * aboard; WASD walks (screen directions), Shift runs.
 *
 * Movement against what stands in the way works on a clearance field: c(x, z) is how much room there is round the
 * feet (the distance to the nearest blocker, the shore or a stream's bank; decks are free). A step is taken if it
 * leaves the feet roomy (c >= R) or no tighter than where they stand, so a captain who finds a card risen right beside
 * him simply steps out of it. A blocked step slides along the obstacle (the field's gradient gives its normal),
 * goes round it on the roomier side when walked into head on, or fans out to find a way; the step is taken in
 * sub-steps of at most SUB, with a constant acceleration, and the velocity is what the feet actually moved.
 */
import * as THREE from 'three';
import { Puppet } from './puppet';
import { PLAYER } from '../config/player';
import { bus } from '../core/events';
import type { Input } from '../core/input';
import { PADDING, WALKER_RADIUS, type Segment } from '../world/blockers';
import { segmentDistance } from '../world/polyline';

export interface WalkWorld {
  /** Signed distance to the shore (negative on land). */
  distance(x: number, z: number): number;
  /** Height of the paper ground at a land point. */
  ground(x: number, z: number): number;
  /** What stops the feet near the point (segments on the page, as drawn). */
  blockers(x: number, z: number, r: number): Segment[];
  /** Distance to the nearest stream's bank (negative on its water). */
  bank(x: number, z: number): number;
  /** Height of a standing deck (pier, bridge) under the point, or null (the planks are walked on, over the water). */
  deck(x: number, z: number): number | null;
  /** On a road, a lane or a square (the footsteps sound of trodden ground). */
  onPath(x: number, z: number): boolean;
}

const SPEED = PLAYER.speed;
const RUN = SPEED * PLAYER.runMul;
const ACCEL = PLAYER.accel;
/** Turning toward the input (1/s), even while held up; the smoothing of the turn rate the puppet feels (1/s). */
const TURN_RATE = 13;
const YAW_SMOOTH = 20;
/** Room the feet need (the captain's radius) and the longest sub-step. */
const R = WALKER_RADIUS;
const SUB = 0.03;
/** How far up the beach the feet must stay (shore distance). */
const WATERLINE = -0.12;
/** Sliding: the slowest slide along an obstacle (share of the step), the probe for the field's gradient. */
const SLIDE_MIN = 0.6;
const PROBE = 0.06;
/** Ground height smoothing (1/s): up and onto decks without lag. */
const HEIGHT_RATE = 45;
/** Fan of escape directions tried when sliding fails (rad), committed side first. */
const FAN = [0.6, 1.05, 1.45];
/** Sub-steps held before trying the other side round an obstacle (doubles at every switch). */
const FLIP_AFTER = 24;

/** The lantern he carries (papertrails: #ffc45a, 1.1 by day, 2.3 at night, reach 6.5, 0.55 above him). */
const LANTERN = { colour: '#ffc45a', day: 1.1, night: 2.3, distance: 6.5, decay: 0.62, height: 0.55 };

export class Walker {
  readonly group = new THREE.Group();
  /**
   * His lantern's light: always in the scene (its intensity goes to 0 aboard), so the count of lights the shaders
   * are built for never changes.
   */
  readonly lantern = new THREE.PointLight(LANTERN.colour, 0, LANTERN.distance, LANTERN.decay);
  active = false;
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  private readonly puppet: Puppet;
  private heading = 0;
  private yawRate = 0;
  private y = 0;
  /** The blockers round the feet (fetched once per frame). */
  private near: Segment[] = [];
  private world: WalkWorld | null = null;
  // going round an obstacle: the side committed to, how long we have been held
  private side = 1;
  private blocked = false;
  private stall = 0;
  private freeRun = 0;
  private flipAt = FLIP_AFTER;

  constructor(captain: string) {
    this.puppet = new Puppet(captain);
    this.group.add(this.puppet.root);
    this.group.visible = false;
  }

  /** Room round the feet at (x, z): the distance to whatever stops them (<= 0: no standing there). */
  private clearance(x: number, z: number): number {
    const world = this.world!;
    if (world.deck(x, z) !== null) return 4;
    let c = Math.min(WATERLINE - world.distance(x, z), world.bank(x, z)) + R;
    for (const [ax, az, bx, bz] of this.near) c = Math.min(c, segmentDistance(x, z, ax, az, bx, bz)[0] - PADDING);
    return c;
  }

  /** True if the captain can stand at (x, z) with room to spare (a landing spot). */
  canStand(x: number, z: number, world: WalkWorld): boolean {
    this.world = world;
    this.near = world.blockers(x, z, 1);
    return this.clearance(x, z) >= R;
  }

  /** Steps ashore at (x, z). */
  land(x: number, z: number, world: WalkWorld): void {
    this.active = true;
    this.x = x;
    this.z = z;
    this.vx = this.vz = 0;
    this.blocked = false;
    this.y = world.deck(x, z) ?? world.ground(x, z);
    this.group.visible = true;
    this.group.position.set(x, this.y, z);
  }

  /** night: 0..1 (the day-night cycle's lantern level). */
  updateLantern(night: number): void {
    this.lantern.intensity = this.active ? LANTERN.day + (LANTERN.night - LANTERN.day) * night : 0;
    this.lantern.position.set(this.x, this.y + LANTERN.height, this.z);
  }

  leave(): void {
    this.active = false;
    this.group.visible = false;
  }

  /** input: the keys walking him (null: none, the chart is open). */
  update(dt: number, input: Input | null, world: WalkWorld): void {
    if (!this.active) return;
    this.world = world;
    let ix = 0;
    let iz = 0;
    if (input?.isDown('KeyW', 'ArrowUp')) iz -= 1;
    if (input?.isDown('KeyS', 'ArrowDown')) iz += 1;
    if (input?.isDown('KeyA', 'ArrowLeft')) ix -= 1;
    if (input?.isDown('KeyD', 'ArrowRight')) ix += 1;
    const il = Math.hypot(ix, iz);
    const speed = input?.isDown('ShiftLeft', 'ShiftRight') ? RUN : SPEED;
    // constant acceleration toward the wanted velocity
    const v0x = this.vx;
    const v0z = this.vz;
    let dvx = (il ? (ix / il) * speed : 0) - v0x;
    let dvz = (il ? (iz / il) * speed : 0) - v0z;
    const dl = Math.hypot(dvx, dvz);
    if (dl > ACCEL * dt) {
      dvx *= (ACCEL * dt) / dl;
      dvz *= (ACCEL * dt) / dl;
    }
    const v1x = v0x + dvx;
    const v1z = v0z + dvz;
    // he turns toward where he is pushed, held up or not
    let turn = 0;
    if (il) {
      const d = Math.atan2(Math.sin(Math.atan2(ix, iz) - this.heading), Math.cos(Math.atan2(ix, iz) - this.heading));
      turn = d * (1 - Math.exp(-TURN_RATE * dt));
      this.heading += turn;
    }
    // the step (trapezoidal), in sub-steps, each resolved against the field
    this.near = world.blockers(this.x, this.z, 1.2);
    const sx = ((v0x + v1x) / 2) * dt;
    const sz = ((v0z + v1z) / 2) * dt;
    const len = Math.hypot(sx, sz);
    const x0 = this.x;
    const z0 = this.z;
    if (len > 1e-6) {
      const n = Math.ceil(len / SUB);
      for (let k = 0; k < n; k++) this.moveSlide(sx / n, sz / n);
    }
    // the velocity is what the feet actually did: a slide carries on smoothly, a wedge stops cleanly
    const mx = this.x - x0;
    const mz = this.z - z0;
    if (len > 1e-6 && dt > 0) {
      const cap = Math.hypot(v1x, v1z);
      const moved = Math.hypot(mx, mz) / dt;
      const k = moved > cap && moved > 0 ? cap / moved : 1;
      this.vx = (mx / dt) * k;
      this.vz = (mz / dt) * k;
    } else {
      this.vx = v1x;
      this.vz = v1z;
    }
    const gy = world.deck(this.x, this.z) ?? world.ground(this.x, this.z);
    this.y += (gy - this.y) * (1 - Math.exp(-HEIGHT_RATE * dt));
    this.group.position.set(this.x, this.y, this.z);
    this.puppet.root.rotation.y = this.heading;
    // (papertrails smooths the yaw rate the roll and the lantern feel)
    if (dt > 0) this.yawRate += (turn / dt - this.yawRate) * (1 - Math.exp(-YAW_SMOOTH * dt));
    const forward = this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
    const foot = this.puppet.walk(dt, Math.hypot(mx, mz), Math.hypot(this.vx, this.vz), forward, this.yawRate);
    if (foot !== null) bus.emit('step', { surface: world.deck(this.x, this.z) !== null ? 'bridge' : world.onPath(this.x, this.z) ? 'path' : 'grass', foot });
  }

  /** A sub-step, taken if it leaves room or is no tighter than where the feet are. */
  private tryStep(dx: number, dz: number): boolean {
    const here = this.clearance(this.x, this.z);
    const c = this.clearance(this.x + dx, this.z + dz);
    if (c >= R || c >= here) {
      this.x += dx;
      this.z += dz;
      return true;
    }
    return false;
  }

  /** A step toward the side we are not committed to waits until we have been held a while. */
  private trySide(dx: number, dz: number, ux: number, uz: number): boolean {
    const s = Math.sign(ux * dz - uz * dx) || this.side;
    if (s !== this.side && this.stall < this.flipAt) return false;
    if (!this.tryStep(dx, dz)) return false;
    if (s !== this.side) {
      this.side = s;
      this.flipAt *= 2;
      this.stall = 0;
    }
    return true;
  }

  private room(x: number, z: number): number {
    return Math.min(this.clearance(x, z), R);
  }

  /** papertrails' moveSlide: step, else slide along the obstacle, else go round it, else fan out; else stop. */
  private moveSlide(dx: number, dz: number): void {
    if (this.tryStep(dx, dz)) {
      this.stall = 0;
      if (++this.freeRun > 8) {
        this.blocked = false;
        this.flipAt = FLIP_AFTER;
      }
      return;
    }
    this.freeRun = 0;
    const d = Math.hypot(dx, dz);
    const ux = dx / d;
    const uz = dz / d;
    // the obstacle's outward normal: the gradient of the room just ahead of the feet (at the feet if flat there)
    let [nx, nz] = this.gradient(this.x + ux * 0.04, this.z + uz * 0.04);
    if (nx === 0 && nz === 0) [nx, nz] = this.gradient(this.x, this.z);
    if (nx === 0 && nz === 0) [nx, nz] = [-ux, -uz];
    const dn = ux * nx + uz * nz;
    let tx = ux - dn * nx;
    let tz = uz - dn * nz;
    let tl = Math.hypot(tx, tz);
    if (dn < 0 && tl >= 0.3) {
      // a glancing hit: slide along it
      if (!this.blocked) this.side = Math.sign(ux * tz - uz * tx) || 1;
    } else {
      // head on: go round on the roomier side
      if (!this.blocked) {
        const left = this.room(this.x - nz * 0.15, this.z + nx * 0.15) + this.room(this.x - nz * 0.3, this.z + nx * 0.3);
        const right = this.room(this.x + nz * 0.15, this.z - nx * 0.15) + this.room(this.x + nz * 0.3, this.z - nx * 0.3);
        this.side = left >= right ? 1 : -1;
      }
      // the tangent on the committed side (cross(u, t) carries the side's sign)
      tx = -nz;
      tz = nx;
      if (Math.sign(ux * tz - uz * tx) !== this.side) {
        tx = -tx;
        tz = -tz;
      }
      tl = 1;
    }
    this.blocked = true;
    tx /= tl;
    tz /= tl;
    const k = d * Math.max(SLIDE_MIN, Math.min(1, tl));
    if (tx * ux + tz * uz > -0.05) {
      for (const lift of [0.12, 0, 0.35]) if (this.trySide((tx + nx * lift) * k, (tz + nz * lift) * k, ux, uz)) return;
    }
    // the fan: the step turned away from the obstacle, the committed side first
    for (const pass of [this.side, -this.side]) {
      for (const a of FAN) {
        const c = Math.cos(a * pass);
        const s = Math.sin(a * pass);
        const l = d * Math.max(0.6, Math.cos(a));
        if (this.trySide((ux * c - uz * s) * l, (ux * s + uz * c) * l, ux, uz)) return;
      }
    }
    this.stall++;
  }

  /** Unit gradient of the room at (x, z) (pointing to more room), or [0, 0] where it is flat. */
  private gradient(x: number, z: number): [number, number] {
    const gx = this.room(x + PROBE, z) - this.room(x - PROBE, z);
    const gz = this.room(x, z + PROBE) - this.room(x, z - PROBE);
    const l = Math.hypot(gx, gz);
    return l < 1e-6 ? [0, 0] : [gx / l, gz / l];
  }
}
