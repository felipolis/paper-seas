/**
 * What stands on the land and how tall, after papertrails (its traveller is 0.6 tall, our captain 0.58, so its
 * heights carry over as they are): trees about 1.8 x the traveller, pines 2.2, bushes 0.67, flowers and tufts a
 * third, rocks half, boulders one, a hen half, a cat or a dog two thirds (its animals.json heights x 1.5 x their size).
 * Ground cover is planted by 2 x 2 tiles (world/cover.ts), as papertrails' page is: each tile is one composition (a
 * grove, a thicket, a glade...) mixing several tall species near its corners with clumps of ground cover, flowers,
 * small props and its animals (papertrails: 9 or 10 cards a tile, nearly every one a different drawing), chosen
 * per biome, with forest tiles massing where a low-frequency field is high.
 */
import type { Biome } from '../world/land';

/** The captain's height (world units): the hero every size is measured against. */
export const HERO_HEIGHT = 0.58;

/** Height range (world units) of every sprite that stands on the land. */
export const HEIGHT: Record<string, [number, number]> = {
  // trees
  'tree-broad': [1.0, 1.25],
  'tree-broad-1': [0.85, 1.05],
  'tree-broad-2': [1.0, 1.25],
  'tree-blossom': [0.95, 1.15],
  'tree-blossom-1': [1.0, 1.2],
  acacia: [1.0, 1.2],
  mangrove: [1.0, 1.2],
  banana: [0.8, 1.0],
  'palm-0': [1.15, 1.35],
  'palm-1': [1.15, 1.35],
  'palm-3': [1.15, 1.35],
  'palm-4': [1.15, 1.35],
  'palm-2': [1.0, 1.2],
  'palm-5': [1.15, 1.35],
  'palm-cluster': [1.0, 1.2],
  pine: [1.15, 1.5],
  'pine-1': [1.15, 1.5],
  'pine-2': [1.0, 1.3],
  'pine-3': [1.15, 1.5],
  cypress: [1.2, 1.45],
  deadwood: [0.85, 1.0],
  // ground cover
  'bush-red': [0.36, 0.44],
  'bush-pink': [0.36, 0.44],
  'bush-yellow': [0.36, 0.44],
  // (papertrails' ferns: 0.33-0.46)
  'fern-0': [0.33, 0.46],
  'fern-1': [0.33, 0.46],
  'fern-2': [0.33, 0.46],
  // flowers and reeds (papertrails: flowers and tufts half the traveller, reeds a little more)
  hibiscus: [0.34, 0.42],
  orchids: [0.28, 0.34],
  'flowers-yellow': [0.22, 0.28],
  'flowers-white': [0.22, 0.28],
  'tuft-flowers': [0.2, 0.26],
  'bird-of-paradise': [0.36, 0.44],
  cattails: [0.42, 0.52],
  papyrus: [0.45, 0.55],
  // small props of the wild
  stump: [0.27, 0.3],
  log: [0.18, 0.22],
  mushrooms: [0.36, 0.4],
  coconuts: [0.14, 0.18],
  shells: [0.1, 0.12],
  pebbles: [0.1, 0.13],
  woodpile: [0.3, 0.36],
  hay: [0.3, 0.36],
  'grass-0': [0.19, 0.22],
  'grass-1': [0.19, 0.22],
  'grass-2': [0.19, 0.22],
  // rocks
  'rock-boulder': [0.26, 0.34],
  'rock-slab': [0.3, 0.4],
  'rock-pile': [0.32, 0.42],
  'rock-stack': [0.4, 0.5],
  'rock-cairn': [0.36, 0.44],
  'rock-big': [0.52, 0.66],
  'rock-spire': [0.7, 0.85],
  // animals (a monkey about half the captain, a bird a third)
  monkey: [0.28, 0.32],
  parrot: [0.2, 0.24],
  toucan: [0.2, 0.24],
  crab: [0.16, 0.2],
  iguana: [0.22, 0.27],
  pelican: [0.36, 0.42],
  flamingo: [0.46, 0.52],
  'duck-float': [0.24, 0.27],
  duck: [0.28, 0.31],
  hen: [0.27, 0.29],
  chick: [0.115, 0.125],
  goat: [0.38, 0.42],
  pig: [0.36, 0.4],
  cat: [0.32, 0.35],
  dog: [0.4, 0.44],
  frog: [0.11, 0.125],
  rabbit: [0.2, 0.215],
  owl: [0.215, 0.235],
  hummingbird: [0.12, 0.14],
  tortoise: [0.14, 0.16],
  boar: [0.26, 0.3],
  gecko: [0.08, 0.1],
  heron: [0.4, 0.46],
  // props and landmarks
  barrel: [0.3, 0.35],
  crates: [0.3, 0.33],
  cannon: [0.34, 0.38],
  market: [0.58, 0.64],
  windmill: [1.6, 1.66],
  'flag-pole': [1.0, 1.1],
  chest: [0.34, 0.38],
  'hut-stilts': [0.95, 1.05],
  'hut-round': [0.75, 0.85],
  'pier-post': [0.3, 0.36],
  shipwreck: [0.8, 0.95],
  // structures and camp (papertrails' watchtower stands about three travellers tall)
  watchtower: [1.4, 1.5],
  well: [0.62, 0.68],
  bench: [0.3, 0.34],
  'lantern-post': [0.7, 0.76],
  signpost: [0.62, 0.7],
  guidepost: [0.5, 0.56],
  'fence-bamboo': [0.34, 0.38],
  'fence-rail': [0.32, 0.36],
  tent: [0.58, 0.64],
  'tent-striped': [0.58, 0.64],
  laundry: [0.37, 0.41],
  bunting: [0.94, 1.02],
  handcart: [0.4, 0.46],
  beehive: [0.55, 0.6],
  stall: [0.58, 0.64],
  campfire: [0.3, 0.36],
  // the spring of a stream and the crags round it (papertrails' river_source: 0.32 tall, crags 0.46-0.73)
  spring: [0.32, 0.36],
  'crag-0': [0.7, 0.75],
  'crag-1': [0.5, 0.55],
  'crag-2': [0.46, 0.5],
  tiki: [0.75, 0.9],
  'ruin-arch': [1.2, 1.3],
  pillars: [1.0, 1.15],
  waterfall: [1.3, 1.5],
  'sea-arch': [1.2, 1.6],
  'skull-rock': [1.5, 1.6],
};

/** A height for a sprite: r (0..1) picks within its range. */
export function heightOf(sprite: string, r: number): number {
  const h = HEIGHT[sprite];
  if (!h) throw new Error(`no height for "${sprite}"`);
  return h[0] + (h[1] - h[0]) * r;
}

/** One tile composition (2 x 2 units). Counts are [min, max]. */
export interface TileKind {
  weight: number;
  /** A forest tile: its weight grows with the forest field (forest tiles mass together). */
  forest?: boolean;
  /**
   * Tall pieces near the corners: the species a slow field picks leads (so neighbouring tiles share it), the others
   * of the list mixed in (papertrails' forest tile: 4 species).
   */
  tall?: { species: string[]; count: [number, number] };
  /** Clumps of ground cover and flowers (world/cover.ts: one to four cards of different species from the list). */
  clumps?: { species: string[]; count: [number, number] };
  /** Rocks and small props (a stump, a log, mushrooms...), alone. */
  props?: { species: string[]; count: [number, number] };
  /** Animals from the biome's list: how many on the tile on average. */
  animals?: number;
}

/**
 * The tile compositions of each biome. Like papertrails' tiles they are full: a few tall pieces of mixed species,
 * clumps of ground cover and flowers, small props, animals; the wild is mostly wood: forest tiles carry most of the
 * weight and grow more likely still where the forest field is high, so the woods close up and the open ground comes
 * in glades.
 */
export const TILES: Record<Biome, TileKind[]> = {
  jungle: [
    { weight: 2.2, forest: true, tall: { species: ['tree-broad', 'tree-broad-1', 'tree-broad-2', 'palm-1', 'palm-4', 'banana', 'palm-5'], count: [3, 5] }, clumps: { species: ['fern-0', 'fern-1', 'fern-2', 'bush-red', 'orchids', 'bird-of-paradise'], count: [2, 3] }, props: { species: ['stump', 'log', 'mushrooms', 'coconuts', 'rock-pile'], count: [1, 3] }, animals: 1.0 },
    { weight: 0.8, tall: { species: ['banana', 'palm-1', 'palm-2'], count: [1, 2] }, clumps: { species: ['bush-red', 'bush-pink', 'hibiscus', 'fern-0', 'orchids'], count: [3, 4] }, props: { species: ['coconuts', 'log', 'mushrooms'], count: [1, 3] }, animals: 0.9 },
    { weight: 0.6, tall: { species: ['palm-1', 'palm-4', 'tree-broad', 'tree-broad-2'], count: [1, 2] }, clumps: { species: ['grass-2', 'fern-1', 'bush-pink', 'bird-of-paradise', 'tuft-flowers'], count: [3, 4] }, props: { species: ['stump', 'rock-boulder'], count: [1, 2] }, animals: 0.8 },
    { weight: 0.2, props: { species: ['rock-pile', 'rock-boulder', 'log'], count: [1, 3] }, tall: { species: ['tree-broad', 'banana'], count: [1, 2] }, clumps: { species: ['fern-0', 'orchids'], count: [2, 3] }, animals: 0.6 },
  ],
  pine: [
    { weight: 2.4, forest: true, tall: { species: ['pine', 'pine-1', 'pine-2', 'pine-3', 'cypress'], count: [3, 5] }, clumps: { species: ['grass-2', 'fern-1', 'fern-2', 'flowers-white', 'tuft-flowers', 'grass-0'], count: [2, 3] }, props: { species: ['stump', 'log', 'mushrooms', 'rock-slab'], count: [1, 3] }, animals: 0.9 },
    { weight: 0.6, tall: { species: ['pine', 'pine-1', 'pine-2', 'pine-3', 'cypress'], count: [1, 2] }, clumps: { species: ['grass-2', 'grass-0', 'flowers-white', 'tuft-flowers', 'fern-2', 'bush-yellow'], count: [3, 4] }, props: { species: ['woodpile', 'stump', 'mushrooms'], count: [1, 3] }, animals: 0.8 },
    { weight: 0.3, props: { species: ['rock-slab', 'rock-big', 'log'], count: [1, 3] }, tall: { species: ['pine', 'pine-2', 'pine-3'], count: [1, 2] }, clumps: { species: ['grass-2', 'fern-2', 'flowers-white', 'tuft-flowers'], count: [2, 3] }, animals: 0.6 },
  ],
  meadow: [
    { weight: 1.2, forest: true, tall: { species: ['acacia', 'tree-blossom', 'tree-blossom-1', 'tree-broad', 'tree-broad-2'], count: [2, 4] }, clumps: { species: ['grass-0', 'bush-yellow', 'flowers-yellow', 'hibiscus'], count: [2, 3] }, props: { species: ['stump', 'log', 'rock-boulder'], count: [1, 3] }, animals: 1.0 },
    { weight: 1.0, tall: { species: ['tree-blossom', 'tree-blossom-1', 'acacia'], count: [0, 1] }, clumps: { species: ['grass-0', 'grass-2', 'bush-yellow', 'bush-pink', 'flowers-yellow', 'flowers-white', 'tuft-flowers'], count: [3, 4] }, props: { species: ['hay', 'woodpile', 'rock-cairn', 'beehive'], count: [1, 3] }, animals: 1.2 },
    { weight: 0.25, props: { species: ['rock-cairn', 'rock-boulder', 'hay'], count: [1, 3] }, clumps: { species: ['grass-0', 'bush-yellow', 'flowers-white'], count: [3, 4] }, animals: 0.9 },
  ],
  rocky: [
    { weight: 1.2, props: { species: ['rock-pile', 'rock-stack', 'rock-big', 'rock-spire', 'pebbles'], count: [2, 5] }, clumps: { species: ['grass-2', 'tuft-flowers', 'flowers-yellow', 'bush-yellow'], count: [2, 3] }, animals: 0.8 },
    { weight: 0.8, tall: { species: ['deadwood', 'pine-3'], count: [1, 2] }, clumps: { species: ['grass-2', 'flowers-white', 'tuft-flowers', 'fern-2'], count: [3, 4] }, props: { species: ['rock-boulder', 'stump', 'pebbles'], count: [1, 3] }, animals: 0.7 },
    { weight: 0.9, forest: true, tall: { species: ['pine', 'pine-1', 'pine-2', 'cypress'], count: [2, 4] }, clumps: { species: ['grass-2', 'fern-2', 'flowers-white', 'tuft-flowers'], count: [2, 3] }, props: { species: ['log', 'rock-slab'], count: [1, 2] }, animals: 0.6 },
  ],
  beach: [
    { weight: 0.9, tall: { species: ['palm-0', 'palm-3', 'palm-cluster', 'palm-2', 'palm-5'], count: [1, 3] }, clumps: { species: ['grass-1', 'tuft-flowers', 'hibiscus', 'bird-of-paradise'], count: [2, 3] }, props: { species: ['coconuts', 'shells', 'pebbles'], count: [1, 3] }, animals: 0.8 },
    { weight: 1, clumps: { species: ['grass-1', 'tuft-flowers', 'hibiscus', 'bird-of-paradise', 'flowers-yellow'], count: [3, 4] }, props: { species: ['shells', 'pebbles', 'coconuts', 'log'], count: [1, 3] }, animals: 0.9 },
    { weight: 0.3, props: { species: ['rock-boulder', 'shells'], count: [1, 3] }, clumps: { species: ['grass-1', 'tuft-flowers', 'hibiscus', 'bird-of-paradise', 'flowers-yellow'], count: [2, 3] }, animals: 0.6 },
    { weight: 0.12, props: { species: ['hut-stilts', 'hut-round', 'pier-post', 'barrel'], count: [1, 3] }, tall: { species: ['palm-0', 'palm-3'], count: [1, 2] }, clumps: { species: ['grass-1', 'tuft-flowers', 'hibiscus', 'bird-of-paradise', 'flowers-yellow'], count: [2, 3] }, animals: 0.8 },
    { weight: 0.05, props: { species: ['shipwreck', 'barrel', 'pier-post'], count: [1, 3] }, clumps: { species: ['grass-1', 'tuft-flowers', 'hibiscus', 'bird-of-paradise', 'flowers-yellow'], count: [2, 3] }, animals: 0.5 },
  ],
};

/** The animals of each biome (weights): papertrails' rows per tile, with their tropical equivalents. */
export const ANIMALS: Partial<Record<Biome, Array<[string, number]>>> = {
  beach: [['crab', 1], ['pelican', 0.4], ['tortoise', 0.4], ['heron', 0.3]],
  jungle: [['monkey', 1], ['parrot', 0.6], ['toucan', 0.5], ['frog', 0.4], ['gecko', 0.5], ['hummingbird', 0.5], ['boar', 0.3]],
  pine: [['rabbit', 1], ['boar', 0.5], ['owl', 0.4], ['hummingbird', 0.3], ['frog', 0.3]],
  meadow: [['goat', 0.8], ['rabbit', 0.8], ['hen', 0.5], ['pig', 0.4], ['monkey', 0.3], ['tortoise', 0.3]],
  rocky: [['iguana', 1], ['gecko', 0.7], ['goat', 0.6], ['tortoise', 0.3]],
};
