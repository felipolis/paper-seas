/**
 * What the voyage has achieved: lands discovered (sail close to a coast you have not seen before: each stamped
 * island, and each stretch of continent, has its own name) and treasure chests found (nose the bow onto the beach
 * where one stands). Kept in localStorage when available, so a voyage can be continued.
 */
import { bus } from '../core/events';
import type { World } from '../world/world';
import { PLACE_REACH, placeAt } from '../world/island-names';
import { forget, isNumber, isNumberArray, isRecord, isString, loadJson, saveJson } from '../core/storage';

/** Its storage key (v3: the world of every seed changed with core/rng.ts hash2, so older places are of another world). */
const STORAGE_KEY = 'paper-seas:progress:v3';

/**
 * What is kept of the voyage: lands and treasures found (ids), named places [id, name, x, z], dig spots [name, x, z].
 */
interface Kept {
  lands?: number[];
  treasures?: number[];
  places?: Array<[number, string, number, number]>;
  spots?: Array<[string, number, number]>;
}

const isPlace = (v: unknown): v is [number, string, number, number] => Array.isArray(v) && v.length === 4 && isNumber(v[0]) && isString(v[1]) && isNumber(v[2]) && isNumber(v[3]);
const isSpot = (v: unknown): v is [string, number, number] => Array.isArray(v) && v.length === 3 && isString(v[0]) && isNumber(v[1]) && isNumber(v[2]);
const isKept = (v: unknown): v is Kept =>
  isRecord(v) &&
  (v.lands === undefined || isNumberArray(v.lands)) &&
  (v.treasures === undefined || isNumberArray(v.treasures)) &&
  (v.places === undefined || (Array.isArray(v.places) && v.places.every(isPlace))) &&
  (v.spots === undefined || (Array.isArray(v.spots) && v.spots.every(isSpot)));
/** The ship collects a treasure when its centre comes this close to the chest. */
const TREASURE_REACH = 2.7;

export class Progress {
  readonly discovered = new Set<number>();
  readonly treasures = new Set<number>();
  /** Where each discovered land was first seen (for the chart's labels). */
  readonly places = new Map<number, { name: string; x: number; z: number }>();
  /** Where each treasure was dug up. */
  readonly treasureSpots: Array<{ name: string; x: number; z: number }> = [];
  private checkTimer = 0;

  constructor() {
    const data = loadJson(STORAGE_KEY, isKept);
    data?.lands?.forEach((id) => this.discovered.add(id));
    data?.treasures?.forEach((id) => this.treasures.add(id));
    data?.places?.forEach(([id, name, x, z]) => this.places.set(id, { name, x, z }));
    data?.spots?.forEach(([name, x, z]) => this.treasureSpots.push({ name, x, z }));
  }

  /** Forgets the stored voyage (a new voyage: the page reloads after). */
  forgetVoyage(): void {
    forget(STORAGE_KEY);
  }

  update(dt: number, world: World, x: number, z: number): void {
    // treasure
    for (const chest of world.terrain.chestList()) {
      if (this.treasures.has(chest.id)) {
        if (!chest.card.hidden) world.terrain.takeChest(chest);
        continue;
      }
      if (chest.card.flap.p < 0.9) continue;
      if (Math.hypot(chest.card.x - x, chest.card.z - z) > TREASURE_REACH) continue;
      this.treasures.add(chest.id);
      this.treasureSpots.push({ name: chest.name, x: chest.card.x, z: chest.card.z });
      world.terrain.takeChest(chest);
      this.save();
      bus.emit('treasure', { name: chest.name });
    }

    // discoveries (a few times a second is plenty)
    this.checkTimer -= dt;
    if (this.checkTimer > 0) return;
    this.checkTimer = 0.4;
    if (world.land.distance(x, z) > PLACE_REACH) return;
    const { id, name, island } = placeAt(world.land, x, z, PLACE_REACH);
    if (this.discovered.has(id)) return;
    this.discovered.add(id);
    // label the land a little inland from where the ship first saw it
    const [nx, nz] = world.land.normal(x, z);
    const inland = Math.max(2, Math.min(9, world.land.distance(x, z) + 4));
    this.places.set(id, island ? { name, x: island.x, z: island.z } : { name, x: x - nx * inland, z: z - nz * inland });
    this.save();
    bus.emit('discovered', { name, coast: !island });
  }

  private save(): void {
    saveJson(STORAGE_KEY, {
      lands: [...this.discovered],
      treasures: [...this.treasures],
      places: [...this.places].map(([id, p]) => [id, p.name, Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]),
      spots: this.treasureSpots.map((t) => [t.name, Math.round(t.x * 10) / 10, Math.round(t.z * 10) / 10]),
    } satisfies Kept);
  }
}
