/**
 * Sailing with inertia. The hull keeps its momentum in the world: thrust and drag act along the keel, the keel
 * fights sideways motion hard but not instantly (so the ship slips a little in a turn), the rudder takes time to
 * come over, the turn rate builds up and dies down (rotational inertia) and needs way on, and the thrust follows
 * the sail area actually set. Heel and pitch are under-damped springs, stepped exactly, so the hull rocks back after
 * a turn or a change of speed the same at any frame rate.
 */
import { SHIP } from '../config/ship';
import { approach, clamp } from '../core/math';
import { HULL_LENGTH } from './hull-shape';

export interface HelmInput {
  /** -1 (port / left) .. 1 (starboard / right). */
  steer: number;
  /** Back-paddling (S held while the sails are furled). */
  reverse: boolean;
}

export interface ShoreCollider {
  collide(x: number, z: number, r: number): { dx: number; dz: number; nx: number; nz: number } | null;
}

/**
 * Rates (1/s) of the exponential decays: the shore contact's strength, the speed a grounding scrapes off, the
 * acceleration the pitch follows, and the way and turn the ship loses at anchor.
 */
const IMPACT_DECAY = 9.75;
const SCRAPE_RATE = 5;
const ACCEL_RATE = 4;
const ANCHOR_DAMPING = 3;

/**
 * The pitch's spring against the heel's: its stiffness (share of the heel's omega squared) and its damping term
 * (share of the heel's).
 */
const PITCH_STIFFNESS = 1.6;
const PITCH_DAMPING = 1.26;

/**
 * Hull sample circles along the keel: offset from the centre (forward +) and radius, laid out on a 2.6 hull and
 * stretched along the chosen ship's own length (the longest is 3.15: its bow and stern must not reach past them).
 */
const HULL_CIRCLES: ReadonlyArray<[number, number]> = ([[0.95, 0.28], [0.35, 0.42], [-0.35, 0.42], [-0.95, 0.36]] as const).map(
  ([off, r]): [number, number] => [(off * HULL_LENGTH) / 2.6, r],
);

/** Quadratic drag that makes the thrust and drag balance exactly at maxSpeed. */
const DRAG_QUAD = (SHIP.thrust - SHIP.dragLinear * SHIP.maxSpeed) / (SHIP.maxSpeed * SHIP.maxSpeed);

/** springStep's answer (one shared object: it runs twice a step). */
const _spring = { x: 0, v: 0 };

/**
 * One step of an under-damped spring of angular frequency omega and damping ratio zeta (< 1) pulling x (moving at v)
 * toward goal, exact for any dt with the goal held over the step: the new x and v.
 */
function springStep(x: number, v: number, goal: number, omega: number, zeta: number, dt: number): { x: number; v: number } {
  const a = zeta * omega;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const d = x - goal;
  const e = Math.exp(-a * dt);
  const c = Math.cos(wd * dt);
  const s = Math.sin(wd * dt);
  _spring.x = goal + e * (d * c + ((v + a * d) / wd) * s);
  _spring.v = e * (v * c - ((a * v + omega * omega * d) / wd) * s);
  return _spring;
}

export class ShipPhysics {
  x = 0;
  z = 0;
  /** Heading as the root's rotation.y: forward = (-sin, -cos). */
  heading = 0;
  vx = 0;
  vz = 0;
  yawRate = 0;
  rudder = 0;
  /** Speed along the keel (+ forward) and across it (+ starboard). */
  surge = 0;
  accel = 0;
  roll = 0;
  rollV = 0;
  pitch = 0;
  pitchV = 0;
  /** Last frame's shore contact strength (for effects). */
  impact = 0;

  get forwardX(): number {
    return -Math.sin(this.heading);
  }

  get forwardZ(): number {
    return -Math.cos(this.heading);
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * @param sailArea effective sail set 0..1
   * @param windX, windZ unit vector the wind blows toward
   */
  step(dt: number, input: HelmInput, sailArea: number, windX: number, windZ: number, shores: ShoreCollider): void {
    const S = SHIP;
    const fx = this.forwardX;
    const fz = this.forwardZ;
    const rx = -fz; // starboard
    const rz = fx;

    // ---- along / across the keel ----
    let u = this.vx * fx + this.vz * fz;
    let w = this.vx * rx + this.vz * rz;
    const windCos = fx * windX + fz * windZ;
    const windEff = 1 - S.windPenalty * (1 - windCos) * 0.5;
    let du = S.thrust * sailArea * windEff - S.dragLinear * u - DRAG_QUAD * u * Math.abs(u);
    if (input.reverse && sailArea < 0.05 && u > -S.reverseMax) du -= S.reverseThrust;
    u += du * dt;
    w *= Math.exp(-S.dragLateral * dt);
    this.accel += (du - this.accel) * (1 - Math.exp(-ACCEL_RATE * dt));
    this.surge = u;

    // ---- helm: the rudder comes over at a finite rate; turning needs way on ----
    this.rudder = approach(this.rudder, clamp(input.steer, -1, 1), S.rudderRate * dt);
    const authority = S.turnAtRest + (1 - S.turnAtRest) * clamp(Math.abs(u) / (0.55 * S.maxSpeed), 0, 1);
    const targetYaw = -this.rudder * S.turnRate * authority * (u >= -0.05 ? 1 : -1);
    this.yawRate += (targetYaw - this.yawRate) * (1 - Math.exp(-S.yawResponse * dt));

    // velocity stays in the old frame: the hull turns, the momentum does not (the keel then bleeds off the slip)
    this.vx = u * fx + w * rx;
    this.vz = u * fz + w * rz;
    this.heading += this.yawRate * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.resolveShores(shores, dt);

    // ---- heel and pitch: under-damped springs ----
    this.heel(dt, clamp(-this.yawRate * u * S.heelGain, -0.22, 0.22), clamp(this.accel * S.pitchGain, -0.08, 0.08));
  }

  /** The heel and pitch springs, a step toward these targets (rad). */
  private heel(dt: number, rollTarget: number, pitchTarget: number): void {
    const S = SHIP;
    const om = 2 * Math.PI * S.heelHz;
    let sp = springStep(this.roll, this.rollV, rollTarget, om, S.heelDamping, dt);
    this.roll = sp.x;
    this.rollV = sp.v;
    const omPitch = om * Math.sqrt(PITCH_STIFFNESS);
    sp = springStep(this.pitch, this.pitchV, pitchTarget, omPitch, (S.heelDamping * om * PITCH_DAMPING) / omPitch, dt);
    this.pitch = sp.x;
    this.pitchV = sp.v;
  }

  /** Stopped dead where she lies (a teleport): no way, turn, helm, heel, pitch or shore contact carried over. */
  stop(): void {
    this.vx = this.vz = 0;
    this.surge = this.accel = 0;
    this.yawRate = this.rudder = 0;
    this.roll = this.rollV = 0;
    this.pitch = this.pitchV = 0;
    this.impact = 0;
  }

  /**
   * At anchor (the captain ashore, she lies where he left her): the way she still has, her turn and her rudder die
   * away, and she rights herself, her heel and pitch springing back to level.
   */
  anchor(dt: number): void {
    const k = Math.exp(-ANCHOR_DAMPING * dt);
    this.vx *= k;
    this.vz *= k;
    this.surge *= k;
    this.accel *= k;
    this.yawRate *= k;
    this.rudder = approach(this.rudder, 0, SHIP.rudderRate * dt);
    this.heel(dt, 0, 0);
  }

  private resolveShores(shores: ShoreCollider, dt: number): void {
    const fx = this.forwardX;
    const fz = this.forwardZ;
    this.impact *= Math.exp(-IMPACT_DECAY * dt);
    const scrape = Math.exp(-SCRAPE_RATE * dt);
    for (const [off, r] of HULL_CIRCLES) {
      const hit = shores.collide(this.x + fx * off, this.z + fz * off, r + SHIP.shorePadding);
      if (!hit) continue;
      this.x += hit.dx;
      this.z += hit.dz;
      const vn = this.vx * hit.nx + this.vz * hit.nz;
      if (vn < 0) {
        this.vx -= (1 + SHIP.restitution) * vn * hit.nx;
        this.vz -= (1 + SHIP.restitution) * vn * hit.nz;
        this.impact = Math.max(this.impact, -vn);
        // grounding scrapes speed off and kicks the bow round a little
        this.vx *= scrape;
        this.vz *= scrape;
        this.yawRate += (fx * hit.nz - fz * hit.nx) * -vn * 0.4 * Math.sign(off);
        this.rollV += -vn * 0.25;
      }
    }
  }
}
