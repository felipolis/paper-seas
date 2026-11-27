/**
 * Deterministic, fictional place names (a pure function of the place and the seed): a stamped island's own name, and
 * the name of a stretch of coast with none (placeAt: the one name a place goes by, on the chart and for a treasure).
 */
import { hash2, mulberry32 } from '../core/rng';
import { WORLD } from '../config/world';
import type { IslandKind, IslandSpec } from './island-layout';
import type { LandField } from './land';

const FIRST: Record<IslandKind, string[]> = {
  tropical: ['Coconut', 'Palm', 'Parrot', 'Sunny', 'Mango', 'Coral', 'Driftwood', 'Hibiscus'],
  jungle: ['Tangle', 'Green Lantern', 'Vine', 'Howler', 'Fern', 'Monsoon', 'Mossy', 'Canopy'],
  rocky: ['Gull', 'Flint', 'Grey Tooth', 'Beacon', 'Breaker', 'Slate', 'Windward', 'Storm'],
  skull: ['Skull', 'Dead Man’s', 'Bone', 'Grinning', 'Hollow Eye', 'Black Tooth', 'Cutthroat', 'Gallows'],
  village: ['Saltwind', 'Tarport', 'Rumhaven', 'Lanternfall', 'Kettle', 'Ropewalk', 'Barnacle', 'Anchorage'],
  sandbar: ['Doubloon', 'Sixpence', 'Gold Dust', 'Lucky', 'Long Shot', 'Piece of Eight', 'Lost Coin', 'Whisper'],
  volcano: ['Ember', 'Smoking', 'Cinder', 'Ashfall', 'Brimstone', 'Firebrand', 'Red Peak', 'Thunder'],
  ruins: ['Forgotten', 'Old King’s', 'Idol', 'Sunken Temple', 'Moonstone', 'Silent', 'Elder', 'Lost Shrine'],
};

const SECOND: Record<IslandKind, string[]> = {
  tropical: ['Cay', 'Isle', 'Key', 'Atoll'],
  jungle: ['Isle', 'Wilds', 'Reach', 'Island'],
  rocky: ['Rock', 'Point', 'Crag', 'Isle'],
  skull: ['Rock', 'Isle', 'Island', 'Reef'],
  village: ['Harbour', 'Haven', 'Town', 'Landing'],
  sandbar: ['Shoal', 'Bar', 'Spit', 'Sands'],
  volcano: ['Island', 'Mount', 'Isle', 'Cone'],
  ruins: ['Isle', 'Island', 'Key', 'Reach'],
};

function islandName(kind: IslandKind, seed: number): string {
  const rng = mulberry32(seed ^ 0x51a7);
  const a = FIRST[kind][Math.floor(rng() * FIRST[kind].length)];
  const b = SECOND[kind][Math.floor(rng() * SECOND[kind].length)];
  return `${a} ${b}`;
}

/** The name of a stretch of continent coast: the island name's first word and "Coast" (Coconut Coast). */
function coastName(kind: IslandKind, seed: number): string {
  const rng = mulberry32(seed ^ 0x51a7);
  return `${FIRST[kind][Math.floor(rng() * FIRST[kind].length)]} Coast`;
}

/** A place goes by its name within this distance of its shore (a coast counts as discovered this close). */
export const PLACE_REACH = 3.5;
/** A stretch of coast with no stamped island is named per square of this size (world units). */
const COAST_REGION = 48;
/** The salts of a coast's id and of its name. */
const COAST_ID_SALT = 113;
const COAST_NAME_SALT = 127;

/** A place's name: its id (a stamped island's own; a coast's negative), its name, and its island if it is one. */
export interface Place {
  id: number;
  name: string;
  island: IslandSpec | null;
}

/**
 * The place at (x, z): the stamped island within reach, else the stretch of coast round it, named for its biome (one
 * name per square of COAST_REGION). The chart's labels and the treasures found use it, so both name a place alike.
 */
export function placeAt(land: LandField, x: number, z: number, reach: number): Place {
  const island = land.islandsNear(x, z, reach)[0];
  if (island) return { id: island.id, name: islandName(island.kind, island.seed), island };
  const ri = Math.floor(x / COAST_REGION);
  const rj = Math.floor(z / COAST_REGION);
  // (the biome of the square's middle, so every spot of that coast takes one name)
  const biome = land.biome((ri + 0.5) * COAST_REGION, (rj + 0.5) * COAST_REGION, -3);
  const kind: IslandKind = biome === 'jungle' ? 'jungle' : biome === 'pine' || biome === 'rocky' ? 'rocky' : biome === 'meadow' ? 'village' : 'tropical';
  return {
    id: -((hash2(COAST_ID_SALT ^ WORLD.seed, ri, rj) >>> 1) + 1),
    name: coastName(kind, hash2(COAST_NAME_SALT ^ WORLD.seed, ri, rj)),
    island: null,
  };
}
