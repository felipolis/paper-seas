/**
 * The player's ship: reads the helm, steps the physics, sets the sails and poses the model.
 *
 * Controls: W / S (or arrow up / down) step the sail setting up and down (furled, courses, all sails); A / D steer;
 * holding S with the sails furled back-paddles slowly.
 */
import { SHIP } from '../config/ship';
import { SEA_WIND } from '../config/world';
import { activeShip } from '../config/ships';
import { clamp } from '../core/math';
import type { Input } from '../core/input';
import { ShipModel } from './ship-model';
import { ShipPhysics, type ShoreCollider } from './ship-physics';
import type { WakeSource } from '../sea/wave-field';
import { HULL_LENGTH, planHalfBeam } from './hull-shape';
import { bus } from '../core/events';

export class Ship {
  readonly model = new ShipModel();
  readonly physics = new ShipPhysics();
  private sailIndex = 0;
  private time = 0;
  private readonly wake: WakeSource = { sternX: 0, sternZ: 0, bowX: 0, bowZ: 0, halfBeam: planHalfBeam(0.5), speed: 0 };

  get sailLevel(): number {
    return SHIP.sailLevels[this.sailIndex];
  }

  get sailSetting(): number {
    return this.sailIndex;
  }

  get wind(): { x: number; z: number } {
    return SEA_WIND;
  }

  /** Sets the sails: 0 furled .. the last of SHIP.sailLevels, all sails. */
  setSailSetting(setting: number): void {
    this.sailIndex = setting;
    this.model.setSails(this.sailLevel);
    bus.emit('sails', { level: this.sailLevel });
  }

  /** Masts pop up after `delay` seconds (the launch). */
  launch(delay: number): void {
    this.model.raiseMasts(delay);
    // (as tall as her tallest mast)
    const height = Math.max(...activeShip().masts.map((m) => m.height));
    bus.emit('paper', { x: this.physics.x, z: this.physics.z, height, up: true, delay, key: 'ship' });
  }

  /**
   * input: the keys on the helm (null: no one at it, ashore or with the chart open); frozen: the voyage is paused
   * (chart open): the hull holds still, the cloth and flag keep moving.
   */
  update(dt: number, input: Input | null, shores: ShoreCollider, frozen = false): void {
    this.time += dt;
    if (input) {
      const step = (input.wasPressed('KeyW', 'ArrowUp') ? 1 : 0) - (input.wasPressed('KeyS', 'ArrowDown') ? 1 : 0);
      const next = clamp(this.sailIndex + step, 0, SHIP.sailLevels.length - 1);
      if (next !== this.sailIndex) this.setSailSetting(next);
    }
    const steer = input ? (input.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (input.isDown('KeyA', 'ArrowLeft') ? 1 : 0) : 0;
    const reverse = this.sailIndex === 0 && !!input?.isDown('KeyS', 'ArrowDown');

    const p = this.physics;
    const impactBefore = p.impact;
    if (!frozen) p.step(dt, { steer, reverse }, this.model.sailArea, SEA_WIND.x, SEA_WIND.z, shores);
    if (p.impact > 0.35 && p.impact > impactBefore + 0.2) bus.emit('bump', { strength: p.impact });

    // wind in the ship's frame: fill of the square sails, side of the head sails, flag direction
    const fx = p.forwardX;
    const fz = p.forwardZ;
    const along = SEA_WIND.x * fx + SEA_WIND.z * fz; // + = from astern
    const across = SEA_WIND.x * -fz + SEA_WIND.z * fx; // + = toward starboard
    const fill = clamp(0.35 + 0.65 * (along * 0.5 + 0.5), 0, 1) * clamp(0.25 + Math.abs(p.surge) / SHIP.maxSpeed, 0, 1);
    // apparent wind ~ true wind minus the boat's own motion; the flag streams along it (ship-local)
    const appX = SEA_WIND.x * 2.2 - p.vx;
    const appZ = SEA_WIND.z * 2.2 - p.vz;
    const lx = appX * Math.cos(p.heading) - appZ * Math.sin(p.heading);
    const lz = appX * Math.sin(p.heading) + appZ * Math.cos(p.heading);

    const swell = 2 * Math.PI * SHIP.swellHz * this.time;
    this.model.root.position.set(p.x, 0, p.z);
    this.model.root.rotation.y = p.heading;
    this.model.update(dt, {
      rudder: p.rudder,
      pitch: p.pitch + SHIP.swellPitch * Math.sin(swell),
      roll: p.roll + SHIP.swellRoll * Math.sin(swell * 0.71 + 1.3),
      bob: SHIP.swellBob * Math.sin(swell * 1.13 + 0.4),
      fill: this.sailIndex === 0 ? 0 : fill,
      windSide: across,
      flagAngle: Math.atan2(-lz, lx),
      time: this.time,
    });
  }

  /** Hull segment on the water for the wave cards. */
  get wakeSource(): WakeSource {
    const p = this.physics;
    const half = HULL_LENGTH * 0.5;
    this.wake.sternX = p.x - p.forwardX * half;
    this.wake.sternZ = p.z - p.forwardZ * half;
    this.wake.bowX = p.x + p.forwardX * (half + 0.35);
    this.wake.bowZ = p.z + p.forwardZ * (half + 0.35);
    this.wake.speed = p.speed;
    return this.wake;
  }
}
