/**
 * The world the ship sails through: the land field (continents, channels, stamped islands), the streamed terrain
 * chunks (stacked paper ground) and the instanced standing cards. Also answers the world queries the other
 * systems need: open water, shore collisions, ground height.
 */
import * as THREE from 'three';
import { LandField } from './land';
import { CardField } from './card-field';
import { Terrain } from './terrain';
import { Places } from './places';
import type { Reveal } from './reveal';
import { PADDING, type Segment } from './blockers';
import { segmentDistance } from './polyline';

/** Waves, creatures and flotsam keep at least this far from any beach. */
const SHALLOWS = 0.9;
/**
 * papertrails' animals stand only where the walk field leaves this much room (config/animals.js minClear: clearance
 * past the blockers' padding), so they go round trees, rocks, fences and houses instead of through them.
 */
const ANIMAL_ROOM = 0.07;
/** The blockers round a point are fetched once a frame per square of this size (world units), and this far round it. */
const BLOCK_CELL = 0.5;
const BLOCK_REACH = 0.6;

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
    canStand: (x, z) => this.terrain.distanceAt(x, z) < -0.08 && !this.places.streams.waterAt(x, z, 0.1) && this.room(x, z) > ANIMAL_ROOM,
    water: (x, z) => this.places.streams.waterAt(x, z),
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
  update(dt: number, reveal: Reveal, focusX: number, focusZ: number, wind: number, night: number): void {
    // papertrails' animals know day or night, not the fade between them
    this.night = night > 0.5;
    // (cards rise and fold: the blockers are fetched afresh every frame)
    this.blocks.clear();
    this.terrain.update(focusX, focusZ);
    this.cards.update(dt, reveal, focusX, focusZ, wind);
    this.terrain.updateHouses(dt, reveal);
  }

  /** The blockers near a point this frame, fetched once per BLOCK_CELL square. */
  private readonly blocks = new Map<number, Segment[]>();

  /** papertrails' walk-field clearance at a point: the distance to whatever stops the feet, past its padding. */
  private room(x: number, z: number): number {
    const i = Math.floor(x / BLOCK_CELL);
    const j = Math.floor(z / BLOCK_CELL);
    const key = i * 73856093 ^ j * 19349663;
    let near = this.blocks.get(key);
    if (!near) {
      near = this.terrain.blockersNear((i + 0.5) * BLOCK_CELL, (j + 0.5) * BLOCK_CELL, BLOCK_CELL * 0.71 + BLOCK_REACH);
      this.blocks.set(key, near);
    }
    let c = BLOCK_REACH;
    for (const [ax, az, bx, bz] of near) c = Math.min(c, segmentDistance(x, z, ax, az, bx, bz)[0] - PADDING);
    return c;
  }

  /** True if (x, z) is open water at least `margin` beyond the shallows. */
  isOpenWater(x: number, z: number, margin: number): boolean {
    return this.terrain.distanceAt(x, z) > SHALLOWS + margin;
  }

  /** Push-out for a circle of radius r at (x, z) against the shore, or null when clear. */
  collide(x: number, z: number, r: number): ShorePush | null {
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
