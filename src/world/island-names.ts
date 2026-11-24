/** Deterministic, fictional island names (a pure function of the island's seed and kind). */
import { mulberry32 } from '../core/rng';
import type { IslandKind } from './island-layout';

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

export function islandName(kind: IslandKind, seed: number): string {
  const rng = mulberry32(seed ^ 0x51a7);
  const a = FIRST[kind][Math.floor(rng() * FIRST[kind].length)];
  const b = SECOND[kind][Math.floor(rng() * SECOND[kind].length)];
  return `${a} ${b}`;
}

/** The name of a stretch of continent coast: the island name's first word and "Coast" (Coconut Coast). */
export function coastName(kind: IslandKind, seed: number): string {
  const rng = mulberry32(seed ^ 0x51a7);
  return `${FIRST[kind][Math.floor(rng() * FIRST[kind].length)]} Coast`;
}
