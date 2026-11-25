/**
 * The world the ship sails through: the land field (continents, channels, stamped islands), the streamed terrain
 * chunks (the land's printed paper sheet) and the instanced standing cards. Also answers the world queries the other
 * systems need: where a voyage begins, open water, collisions with the shore and the piers.
 */
import * as THREE from 'three';
import { LandField } from './land';
import { CardField } from './card-field';
import { Terrain } from './terrain';
import { Places } from './places';
import type { Reveal } from './reveal';
import { PADDING } from './blockers';

/** Waves, creatures and flotsam keep at least this far from any beach. */
const SHALLOWS = 0.9;
/**
 * Animals stand only where the walk field leaves this much room (clearance
 * past the blockers' padding), so they go round trees, rocks, fences and houses instead of through them.
 */
const ANIMAL_ROOM = 0.07;

export interface ShorePush {
  dx: number;
  dz: number;
  nx: number;
  nz: number;
}

export class World {
  readonly group = new THREE.Group();
  readonly land = new LandField();
  /** (the animals keep to the land, out of the streams, but for the ducks afloat on them) */
  readonly cards = new CardField({
    canStand: (x, z) => this.terrain.distanceAt(x, z) < -0.08 && !this.places.waterAt(x, z, 0.1) && this.room(x, z) > ANIMAL_ROOM,
    water: (x, z) => this.places.waterAt(x, z),
    night: () => this.night,
  });
  /** Streams, villages, roads: what spans the chunks. */
  readonly places = new Places(this.land);
  readonly terrain: Terrain;
  /** Night by the clock (the animals keep still and the cats nap), as of the last update. */
  private night = false;

  constructor() {
    this.terrain = new Terrain(this.land, this.cards, this.places);
    this.group.add(this.terrain.group, this.cards.group);
  }

  /**
   * Where a voyage begins: the open water nearest the origin that has a coast in sight (land on several sides
   * within a few ship lengths), so the first thing you see is a shore, not an empty sea.
   */
  findStart(): [number, number, number] {
    const clear = (x: number, z: number, r: number) => {
      for (let q = 0; q < 16; q++) {
        const a = (q / 16) * Math.PI * 2;
        for (let s = 0.5; s <= r; s += 0.5) if (this.land.distance(x + Math.cos(a) * s, z + Math.sin(a) * s) < 0.2) return false;
      }
      return true;
    };
    for (let r = 0; r < 400; r += 3) {
      const steps = Math.max(1, Math.round((r * Math.PI * 2) / 3));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (this.land.distance(x, z) < 2.5) continue;
        let near = 0;
        for (let q = 0; q < 12; q++) if (this.land.distance(x + Math.cos((q / 12) * 6.283) * 10, z + Math.sin((q / 12) * 6.283) * 10) < 0) near++;
        if (near < 3 || near > 7 || !clear(x, z, 5)) continue;
        // head for the widest open water
        let best = 0;
        let heading = 0;
        for (let q = 0; q < 16; q++) {
          const b = (q / 16) * Math.PI * 2;
          const dx = Math.cos(b);
          const dz = Math.sin(b);
          let run = 0;
          while (run < 30 && this.land.distance(x + dx * run, z + dz * run) > 1.5) run += 1;
          if (run > best) { best = run; heading = Math.atan2(-dx, -dz); }
        }
        return [x, z, heading];
      }
    }
    return [0, 0, 0];
  }

  /** Builds the land around the start at once. */
  prime(x: number, z: number): void {
    this.terrain.prime(x, z);
  }

  /** reveal: which part of the land stands up (around the ship or the captain on foot); night: 0 day .. 1 night. */
  update(dt: number, reveal: Reveal, focusX: number, focusZ: number, night: number): void {
    // the animals know day or night, not the fade between them
    this.night = night > 0.5;
    this.terrain.update(focusX, focusZ);
    this.cards.update(dt, reveal, focusX, focusZ);
    this.terrain.updateHouses(dt, reveal);
  }

  /** The walk-field clearance at a point: the distance to whatever stops the feet, past its padding. */
  private room(x: number, z: number): number {
    return this.terrain.roomAt(x, z) - PADDING;
  }


  /** True if (x, z) is open water at least `margin` beyond the shallows. */
  isOpenWater(x: number, z: number, margin: number): boolean {
    return this.terrain.distanceAt(x, z) > SHALLOWS + margin;
  }

  /** Push-out for a circle of radius r at (x, z) against the shore and the standing piers, or null when clear. */
  collide(x: number, z: number, r: number): ShorePush | null {
    return this.terrain.pierPush(x, z, r) ?? this.shorePush(x, z, r);
  }

  private shorePush(x: number, z: number, r: number): ShorePush | null {
    // the same numbers the ground was drawn from: what you see is what you hit
    const d = this.terrain.distanceAt(x, z);
    const depth = r - d;
    if (depth <= 0) return null;
    const e = 0.12;
    let nx = this.terrain.distanceAt(x + e, z) - this.terrain.distanceAt(x - e, z);
    let nz = this.terrain.distanceAt(x, z + e) - this.terrain.distanceAt(x, z - e);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    // only a shore that is really there: walk toward the land (against the normal) and require drawn ground within
    // reach. A shoal where the field dips toward zero without ever becoming land never stops the ship.
    let land = d < 0;
    for (let t = 0.08; !land && t <= Math.max(0, d) + 0.35; t += 0.08) if (this.terrain.distanceAt(x - nx * t, z - nz * t) < 0) land = true;
    if (!land) return null;
    return { dx: nx * depth, dz: nz * depth, nx, nz };
  }
}
