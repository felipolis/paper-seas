/**
 * What stands on the land and how tall, against the captain (config/player.ts PLAYER.height, 0.6): trees about 1.9 x
 * the captain, pines 2.2, bushes two thirds, flowers about half, grass and tufts a third, rocks from half to one;
 * animals at most half the captain (the smallest, a chick, a frog, a gecko, far less); every kind varied +-15 % about
 * the middle of its range.
 * Ground cover is planted by 2 x 2 tiles (world/cover.ts): each tile is one composition (a grove, a thicket, a
 * glade...) mixing several tall species near its corners with clumps of ground cover, flowers, small props and its
 * animals (9 or 10 cards a tile, nearly every one a different drawing), chosen per biome, with forest tiles massing
 * where a low-frequency field is high.
 */
import type { Biome } from '../world/land';

/**
 * How heavy a land card's stock is against the base card's (popup/card.ts CARD_THICKNESS): the small pieces of the
 * ground (ferns, flowers, tufts, grass, mushrooms) and the bushes in heavier stock, so they still read as card, the
 * props and rocks a little heavier, the trees and the reeds lighter (the base stock on a tall card reads as board),
 * the animals in the base stock.
 */
const STOCK = { tree: 0.86, reed: 0.8, bush: 1.22, cover: 1.3, prop: 1.15, base: 1 } as const;

/** How a card rocks in the wind (world/wind.ts): loose (grass, ferns, palms), plain, stiff (posts, animals), rigid. */
export type WindClass = 'loose' | 'plain' | 'stiff' | 'rigid';

/**
 * What else a sprite is:
 *   animal     a creature: it moves (world/critters.ts has its behaviour)
 *   crossed    two cards slotted together (a crossed pop-up), only where the print is symmetric about its trunk: a
 *              leaning palm, a palm cluster or a twisted dead tree would not cross cleanly
 *   flower     the butterflies visit it
 *   lamp       it lights a pool round it at night (render/lamp-pools.ts)
 *   perch      an owl may sit on its top (world/cover.ts)
 *   doubled    a rear copy stands behind it, so a tuft reads as a clump (world/terrain.ts)
 *   shallows   it may stand in the shallows on purpose
 *   keepsTint  the blossom leaves its print as drawn (render/biome-tint.ts)
 */
export type Tag = 'animal' | 'crossed' | 'flower' | 'lamp' | 'perch' | 'doubled' | 'shallows' | 'keepsTint';

/** A land sprite's sheet: everything the game needs to know about it. */
export interface SpriteSheet {
  /** Height range (world units). */
  height: readonly [number, number];
  stock: keyof typeof STOCK;
  wind: WindClass;
  /** The feet go through (or past) it: ground cover and animals. */
  passable?: boolean;
  tags?: readonly Tag[];
}

/** An animal's sheet: base stock, stiff in the wind, the feet go past it; more: its other tags. */
const animal = (lo: number, hi: number, ...more: Tag[]): SpriteSheet => ({ height: [lo, hi], stock: 'base', wind: 'stiff', passable: true, tags: ['animal', ...more] });

/** Every sprite that stands on the land, and its sheet. A sprite without one fails loudly (sheetOf). */
const SPRITES = {
  // trees
  'tree-broad': { height: [1.0, 1.25], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  'tree-broad-1': { height: [0.85, 1.05], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  'tree-broad-2': { height: [1.0, 1.25], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  'tree-blossom': { height: [0.95, 1.15], stock: 'tree', wind: 'plain', tags: ['crossed', 'flower'] },
  'tree-blossom-1': { height: [1.0, 1.2], stock: 'tree', wind: 'plain', tags: ['crossed', 'flower'] },
  'tree-broad-3': { height: [1.0, 1.25], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  'tree-broad-4': { height: [0.85, 1.05], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  'tree-blossom-2': { height: [0.95, 1.15], stock: 'tree', wind: 'plain', tags: ['crossed', 'flower'] },
  'tree-blossom-3': { height: [1.0, 1.2], stock: 'tree', wind: 'plain', tags: ['crossed', 'flower'] },
  acacia: { height: [1.0, 1.2], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  mangrove: { height: [1.0, 1.2], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  banana: { height: [0.8, 1.0], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  'palm-0': { height: [1.15, 1.35], stock: 'tree', wind: 'loose' },
  'palm-1': { height: [1.15, 1.35], stock: 'tree', wind: 'loose', tags: ['crossed'] },
  'palm-3': { height: [1.15, 1.35], stock: 'tree', wind: 'loose' },
  'palm-4': { height: [1.15, 1.35], stock: 'tree', wind: 'loose' },
  'palm-2': { height: [1.0, 1.2], stock: 'tree', wind: 'loose' },
  'palm-5': { height: [1.15, 1.35], stock: 'tree', wind: 'loose' },
  'palm-cluster': { height: [1.0, 1.2], stock: 'tree', wind: 'loose' },
  pine: { height: [1.15, 1.5], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  'pine-1': { height: [1.15, 1.5], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  'pine-2': { height: [1.0, 1.3], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  'pine-3': { height: [1.15, 1.5], stock: 'tree', wind: 'plain' },
  cypress: { height: [1.2, 1.45], stock: 'tree', wind: 'plain', tags: ['crossed'] },
  deadwood: { height: [0.85, 1.0], stock: 'tree', wind: 'stiff' },
  // ground cover
  'bush-red': { height: [0.36, 0.44], stock: 'bush', wind: 'plain', passable: true, tags: ['flower', 'doubled'] },
  'bush-pink': { height: [0.36, 0.44], stock: 'bush', wind: 'plain', passable: true, tags: ['flower', 'doubled'] },
  'bush-yellow': { height: [0.36, 0.44], stock: 'bush', wind: 'plain', passable: true, tags: ['flower', 'doubled'] },
  'bush-coral': { height: [0.36, 0.44], stock: 'bush', wind: 'plain', passable: true, tags: ['flower', 'doubled'] },
  'bush-plum': { height: [0.36, 0.44], stock: 'bush', wind: 'plain', passable: true, tags: ['flower', 'doubled'] },
  // ferns
  'fern-0': { height: [0.33, 0.46], stock: 'cover', wind: 'loose', passable: true },
  'fern-1': { height: [0.33, 0.46], stock: 'cover', wind: 'loose', passable: true },
  'fern-2': { height: [0.33, 0.46], stock: 'cover', wind: 'loose', passable: true },
  'fern-3': { height: [0.33, 0.46], stock: 'cover', wind: 'loose', passable: true },
  'fern-4': { height: [0.33, 0.46], stock: 'cover', wind: 'loose', passable: true },
  // flowers and reeds (flowers about half the captain's height, tufts a third, reeds a little more than half)
  hibiscus: { height: [0.34, 0.42], stock: 'cover', wind: 'plain', passable: true, tags: ['flower'] },
  orchids: { height: [0.28, 0.34], stock: 'cover', wind: 'plain', passable: true, tags: ['flower'] },
  'flowers-yellow': { height: [0.22, 0.28], stock: 'cover', wind: 'loose', passable: true, tags: ['flower'] },
  'flowers-white': { height: [0.22, 0.28], stock: 'cover', wind: 'loose', passable: true, tags: ['flower'] },
  'tuft-flowers': { height: [0.2, 0.26], stock: 'cover', wind: 'plain', passable: true, tags: ['flower', 'doubled'] },
  'bird-of-paradise': { height: [0.36, 0.44], stock: 'cover', wind: 'plain', passable: true, tags: ['flower'] },
  cattails: { height: [0.42, 0.52], stock: 'reed', wind: 'loose', passable: true, tags: ['doubled', 'keepsTint'] },
  papyrus: { height: [0.45, 0.55], stock: 'reed', wind: 'loose', passable: true, tags: ['doubled', 'keepsTint'] },
  // small props of the wild
  stump: { height: [0.27, 0.3], stock: 'prop', wind: 'plain', tags: ['perch', 'keepsTint'] },
  log: { height: [0.18, 0.22], stock: 'prop', wind: 'plain', tags: ['perch', 'keepsTint'] },
  mushrooms: { height: [0.36, 0.4], stock: 'cover', wind: 'plain', passable: true },
  coconuts: { height: [0.14, 0.18], stock: 'prop', wind: 'plain' },
  shells: { height: [0.1, 0.12], stock: 'prop', wind: 'plain', passable: true },
  pebbles: { height: [0.1, 0.13], stock: 'prop', wind: 'plain', passable: true },
  woodpile: { height: [0.3, 0.36], stock: 'prop', wind: 'plain', tags: ['perch', 'keepsTint'] },
  hay: { height: [0.3, 0.36], stock: 'prop', wind: 'plain', tags: ['keepsTint'] },
  'grass-0': { height: [0.19, 0.22], stock: 'cover', wind: 'loose', passable: true, tags: ['doubled'] },
  'grass-1': { height: [0.19, 0.22], stock: 'cover', wind: 'loose', passable: true, tags: ['doubled'] },
  'grass-2': { height: [0.19, 0.22], stock: 'cover', wind: 'loose', passable: true, tags: ['doubled'] },
  'grass-3': { height: [0.19, 0.22], stock: 'cover', wind: 'loose', passable: true, tags: ['doubled'] },
  'grass-4': { height: [0.19, 0.22], stock: 'cover', wind: 'loose', passable: true, tags: ['doubled'] },
  // rocks
  'rock-boulder': { height: [0.26, 0.34], stock: 'prop', wind: 'rigid', tags: ['perch', 'doubled', 'keepsTint'] },
  'rock-slab': { height: [0.3, 0.4], stock: 'prop', wind: 'rigid', tags: ['perch', 'doubled', 'keepsTint'] },
  'rock-pile': { height: [0.32, 0.42], stock: 'prop', wind: 'rigid', tags: ['perch', 'keepsTint'] },
  'rock-stack': { height: [0.4, 0.5], stock: 'prop', wind: 'rigid', tags: ['perch', 'keepsTint'] },
  'rock-cairn': { height: [0.36, 0.44], stock: 'prop', wind: 'rigid', tags: ['perch', 'keepsTint'] },
  'rock-big': { height: [0.52, 0.66], stock: 'prop', wind: 'rigid', tags: ['perch', 'doubled', 'keepsTint'] },
  'rock-spire': { height: [0.7, 0.85], stock: 'prop', wind: 'rigid', tags: ['perch', 'shallows', 'keepsTint'] },
  // animals: at most half the captain (a kind taller than that scaled down to it, its range kept)
  monkey: animal(0.254, 0.29),
  parrot: animal(0.2, 0.24),
  toucan: animal(0.2, 0.24),
  crab: animal(0.16, 0.2),
  iguana: animal(0.22, 0.27),
  pelican: animal(0.249, 0.29),
  flamingo: animal(0.257, 0.29, 'shallows'),
  'duck-float': animal(0.24, 0.27, 'shallows'),
  duck: animal(0.262, 0.29),
  hen: animal(0.27, 0.29),
  chick: animal(0.115, 0.125),
  goat: animal(0.262, 0.29),
  pig: animal(0.261, 0.29),
  cat: animal(0.265, 0.29),
  dog: animal(0.264, 0.29),
  frog: animal(0.11, 0.125),
  rabbit: animal(0.2, 0.215),
  owl: animal(0.215, 0.235),
  hummingbird: animal(0.12, 0.14),
  tortoise: animal(0.14, 0.16),
  boar: animal(0.251, 0.29),
  gecko: animal(0.08, 0.1),
  heron: animal(0.252, 0.29),
  // props and landmarks
  barrel: { height: [0.3, 0.35], stock: 'prop', wind: 'rigid' },
  crates: { height: [0.3, 0.33], stock: 'prop', wind: 'rigid' },
  cannon: { height: [0.34, 0.38], stock: 'prop', wind: 'rigid' },
  market: { height: [0.58, 0.64], stock: 'prop', wind: 'rigid' },
  windmill: { height: [1.6, 1.66], stock: 'prop', wind: 'stiff' },
  'flag-pole': { height: [1.0, 1.1], stock: 'prop', wind: 'stiff' },
  chest: { height: [0.34, 0.38], stock: 'prop', wind: 'rigid' },
  rowboat: { height: [0.36, 0.42], stock: 'prop', wind: 'plain' },
  'hut-stilts': { height: [0.95, 1.05], stock: 'prop', wind: 'plain' },
  'hut-round': { height: [0.75, 0.85], stock: 'prop', wind: 'plain' },
  'pier-post': { height: [0.3, 0.36], stock: 'prop', wind: 'stiff' },
  shipwreck: { height: [0.8, 0.95], stock: 'prop', wind: 'plain' },
  // structures and camp
  watchtower: { height: [1.4, 1.5], stock: 'prop', wind: 'plain' },
  well: { height: [0.62, 0.68], stock: 'prop', wind: 'plain' },
  bench: { height: [0.3, 0.34], stock: 'prop', wind: 'plain' },
  'lantern-post': { height: [0.7, 0.76], stock: 'prop', wind: 'stiff', tags: ['lamp'] },
  signpost: { height: [0.62, 0.7], stock: 'prop', wind: 'stiff' },
  guidepost: { height: [0.5, 0.56], stock: 'prop', wind: 'stiff' },
  'fence-bamboo': { height: [0.34, 0.38], stock: 'prop', wind: 'stiff', tags: ['keepsTint'] },
  'fence-rail': { height: [0.32, 0.36], stock: 'prop', wind: 'stiff', tags: ['keepsTint'] },
  tent: { height: [0.58, 0.64], stock: 'prop', wind: 'plain' },
  'tent-striped': { height: [0.58, 0.64], stock: 'prop', wind: 'plain' },
  laundry: { height: [0.37, 0.41], stock: 'prop', wind: 'plain' },
  bunting: { height: [0.94, 1.02], stock: 'prop', wind: 'plain' },
  handcart: { height: [0.4, 0.46], stock: 'prop', wind: 'plain' },
  beehive: { height: [0.55, 0.6], stock: 'prop', wind: 'plain', tags: ['flower'] },
  stall: { height: [0.58, 0.64], stock: 'prop', wind: 'plain' },
  campfire: { height: [0.3, 0.36], stock: 'prop', wind: 'plain', tags: ['lamp'] },
  // the spring of a stream and the crags round it
  spring: { height: [0.32, 0.36], stock: 'prop', wind: 'plain' },
  'crag-0': { height: [0.7, 0.75], stock: 'prop', wind: 'plain', tags: ['doubled', 'keepsTint'] },
  'crag-1': { height: [0.5, 0.55], stock: 'prop', wind: 'plain', tags: ['doubled', 'keepsTint'] },
  'crag-2': { height: [0.46, 0.5], stock: 'prop', wind: 'plain', tags: ['doubled', 'keepsTint'] },
  tiki: { height: [0.75, 0.9], stock: 'prop', wind: 'stiff' },
  'ruin-arch': { height: [1.2, 1.3], stock: 'prop', wind: 'rigid' },
  pillars: { height: [1.0, 1.15], stock: 'prop', wind: 'rigid' },
  waterfall: { height: [1.3, 1.5], stock: 'prop', wind: 'rigid' },
  'sea-arch': { height: [1.2, 1.6], stock: 'prop', wind: 'rigid', tags: ['shallows'] },
  'skull-rock': { height: [1.5, 1.6], stock: 'prop', wind: 'rigid' },
} satisfies Record<string, SpriteSheet>;

/** A land sprite's name. */
export type Sprite = keyof typeof SPRITES;

/** Every land sprite's name. */
export const SPRITE_NAMES = Object.keys(SPRITES) as Sprite[];

/** The sheet of a land sprite (a name without one is a bug: it throws). */
export function sheetOf(sprite: string): SpriteSheet {
  const sheet: SpriteSheet | undefined = (SPRITES as Record<string, SpriteSheet>)[sprite];
  if (!sheet) throw new Error(`no sheet for "${sprite}"`);
  return sheet;
}

/** Whether the land sprite carries the tag. */
export function hasTag(sprite: string, tag: Tag): boolean {
  return sheetOf(sprite).tags?.includes(tag) ?? false;
}

/**
 * A rock spire standing off the shore as a sea stack (world/cover.ts plantShallows) is far taller than one on the land
 * (its sheet): as tall as a sea arch, its height drawn evenly over this range.
 */
export const SEA_STACK: [number, number] = [1.2, 1.6];

/**
 * A sprite's height for a random r in [0, 1): the middle of its range, varied +-SIZE_VARY (every kind ~15 % in
 * scale, so no two of a kind stand alike).
 */
export function heightOf(sprite: string, r: number): number {
  const h = sheetOf(sprite).height;
  return ((h[0] + h[1]) / 2) * (1 + SIZE_VARY * (2 * r - 1));
}

/** A land card's stock for its sprite, against the base card's. */
export function stockOf(sprite: string): number {
  return STOCK[sheetOf(sprite).stock];
}

/**
 * The kinds printed in several variants (4-5 seeded variants per kind, no stamped repeats). A tile's lists name a
 * kind by any of its members; each card it plants is drawn among all of them (variantOf).
 */
const VARIANTS: readonly (readonly Sprite[])[] = [
  ['tree-broad', 'tree-broad-1', 'tree-broad-2', 'tree-broad-3', 'tree-broad-4'],
  ['tree-blossom', 'tree-blossom-1', 'tree-blossom-2', 'tree-blossom-3'],
  ['fern-0', 'fern-1', 'fern-2', 'fern-3', 'fern-4'],
  ['grass-0', 'grass-1', 'grass-2', 'grass-3', 'grass-4'],
  ['bush-red', 'bush-yellow', 'bush-pink', 'bush-coral', 'bush-plum'],
];
const FAMILY = new Map(VARIANTS.flatMap((family) => family.map((name) => [name, family] as const)));

/** One of the variants of the sprite's kind for a random r in [0, 1) (the sprite itself if it has none). */
export function variantOf(sprite: Sprite, r: number): Sprite {
  const family = FAMILY.get(sprite);
  return family ? family[Math.floor(r * family.length) % family.length] : sprite;
}

/** How far a kind's height varies about the middle of its range (+-). */
const SIZE_VARY = 0.15;

/** One tile composition (2 x 2 units). Counts are [min, max]. */
export interface TileKind {
  weight: number;
  /** A forest tile: its weight grows with the forest field (forest tiles mass together). */
  forest?: boolean;
  /**
   * Tall pieces near the corners: the species a slow field picks leads (so neighbouring tiles share it), the others
   * of the list mixed in.
   */
  tall?: { species: Sprite[]; count: [number, number] };
  /** Clumps of ground cover and flowers (world/cover.ts: one to four cards of different species from the list). */
  clumps?: { species: Sprite[]; count: [number, number] };
  /** Rocks and small props (a stump, a log, mushrooms...), alone. */
  props?: { species: Sprite[]; count: [number, number] };
  /** Animals from the biome's list: how many on the tile on average. */
  animals?: number;
  /**
   * A meadow pen (a diamond of low fences with a herd inside, world/pen.ts): this share of the tiles keep one (one a
   * square at most).
   */
  pen?: number;
}

/**
 * The tile compositions of each biome. They are full: a few tall pieces of mixed species, clumps of ground cover and
 * flowers, small props, animals; the wild is mostly wood: forest tiles carry most of the weight and grow more likely
 * still where the forest field is high, so the woods close up and the open ground comes in glades.
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
    { weight: 1.0, tall: { species: ['tree-blossom', 'tree-blossom-1', 'acacia'], count: [0, 1] }, clumps: { species: ['grass-0', 'grass-2', 'bush-yellow', 'bush-pink', 'flowers-yellow', 'flowers-white', 'tuft-flowers'], count: [3, 4] }, props: { species: ['hay', 'woodpile', 'rock-cairn', 'beehive'], count: [1, 3] }, animals: 1.2, pen: 0.3 },
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

/** When an animal is about: by day only, or by night only; always if not given. */
export type Awake = 'day' | 'night';

/**
 * One row of a biome's animals: its weight among the biome's rows, how many come, whether they keep together (one
 * tight group), when they are about, and where they are: at a tree of the tile (beside it or half hidden behind it) or
 * perched on a stump, a log or a stone of it (no perch, no animal).
 */
export interface AnimalRow {
  species: Sprite;
  weight: number;
  count: [number, number];
  herd?: boolean;
  awake?: Awake;
  at?: 'tree' | 'perch';
}

const row = (species: Sprite, weight: number, count: [number, number], more: Omit<AnimalRow, 'species' | 'weight' | 'count'> = {}): AnimalRow => ({ species, weight, count, ...more });

/**
 * The animals of each biome, as world/critters.ts plays them: goats and pigs come in herds, hens, parrots, toucans and
 * hummingbirds in flocks by day, monkeys, geckos and iguanas by day; the boar half hidden behind a tree by day and out
 * in the open at night, the tortoise by night, the owl by night up on a stump or a log.
 */
export const ANIMALS: Partial<Record<Biome, AnimalRow[]>> = {
  beach: [row('crab', 1, [1, 2]), row('pelican', 0.4, [1, 1], { awake: 'day' }), row('tortoise', 0.4, [1, 1]), row('heron', 0.3, [1, 1], { awake: 'day' })],
  jungle: [
    row('monkey', 1, [1, 1], { awake: 'day' }),
    row('parrot', 0.6, [2, 3], { herd: true, awake: 'day' }),
    row('toucan', 0.5, [1, 2], { herd: true, awake: 'day' }),
    row('frog', 0.4, [1, 1]),
    row('gecko', 0.5, [1, 1], { awake: 'day', at: 'tree' }),
    row('hummingbird', 0.5, [2, 3], { herd: true, awake: 'day' }),
    row('boar', 0.3, [1, 1], { awake: 'day', at: 'tree' }),
    row('boar', 0.4, [1, 1], { awake: 'night' }),
  ],
  pine: [
    row('rabbit', 1, [1, 2]),
    row('boar', 0.3, [1, 1], { awake: 'day', at: 'tree' }),
    row('boar', 0.4, [1, 1], { awake: 'night' }),
    row('owl', 0.45, [1, 1], { awake: 'night', at: 'perch' }),
    row('hummingbird', 0.3, [2, 3], { herd: true, awake: 'day' }),
    row('frog', 0.3, [1, 1]),
  ],
  meadow: [
    row('goat', 0.8, [2, 3], { herd: true }),
    row('rabbit', 0.8, [1, 2]),
    row('hen', 0.5, [2, 3], { herd: true, awake: 'day' }),
    row('pig', 0.4, [1, 2], { herd: true }),
    row('monkey', 0.3, [1, 1], { awake: 'day' }),
    row('tortoise', 0.3, [1, 1], { awake: 'night' }),
  ],
  rocky: [row('iguana', 1, [1, 2], { awake: 'day' }), row('gecko', 0.7, [1, 2], { awake: 'day' }), row('goat', 0.6, [2, 3], { herd: true }), row('tortoise', 0.3, [1, 1], { awake: 'night' })],
};
