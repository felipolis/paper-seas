/**
 * Ground cover, planted by 2 x 2 tiles like papertrails' page (see config/flora.ts): every tile on land is one
 * composition picked for its biome: a few tall pieces near its corners (a leading species that drifts slowly from
 * tile to tile, the others of its list mixed in, as papertrails' forest tile mixes four), clumps of ground cover and
 * flowers, small props, and its animals. Like papertrails' tiles, a tile hardly ever shows the same drawing twice: each
 * list hands out all its species before any comes again. Forest tiles gather where a low-frequency field is high, so
 * the woods mass together and open ground is left between them.
 *
 * A clump is papertrails' (tiles.glb, its 86 clumps measured): one to four cards of different species, the tallest at
 * the back and the shorter ones stepping out in front of it, the cards toward the back printed darker.
 */
import { WORLD } from '../config/world';
import { pickWeighted } from '../core/rng';
import { ANIMALS, TILES, heightOf, type TileKind } from '../config/flora';
import { fbm, valueNoise } from './noise';
import { CELL } from './reveal';
import type { Biome } from './land';
import type { CardSpec } from './card-field';

const SEED = WORLD.seed;
/** Tall pieces stand this far from the tile centre along both axes (papertrails: about 0.6-0.9), give or take. */
const CORNER = 0.62;
const CORNER_JITTER = 0.15;
/** Where the tall pieces of a tile stand: its corners, and its middle for a fifth. */
const SPOTS: Array<[number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]];
/**
 * papertrails' vignettes at a tree (life/animals.js resolveAnchor there): beside its trunk, 0.08 + 0.14 out and 0.07
 * toward the camera; behind it, 0.1 out and 0.05 back (the body hidden by the card, the head out past its edge).
 */
const VIGNETTES: Record<string, [number, number]> = { gecko: [0.22, 0.07], boar: [0.1, -0.05] };
/** How many cards a clump has (weights: papertrails' clumps, 16 of one card, 49 of two, 19 of three, 2 of four). */
const CLUMP_SIZES: Array<[number, number]> = [[1, 16], [2, 49], [3, 19], [4, 2]];
/**
 * papertrails' clump shading, by the card's place from the back (every card's foot in tiles.glb is 0.787 of its tone):
 * the front card as drawn, each one behind it about a tenth darker.
 */
const CLUMP_TONES: number[][] = [[], [1], [0.87, 1], [0.79, 0.89, 1], [0.69, 0.79, 0.89, 1]];
/**
 * Where the next card of a clump stands from the last: to either side, and a little in front (papertrails: about 0.2
 * apart, 0.06 nearer the camera, the median).
 */
const CLUMP_SIDE: [number, number] = [0.08, 0.24];
const CLUMP_AHEAD: [number, number] = [-0.03, 0.12];
/** Footprints kept clear round what is planted (so nothing stands inside something else). */
const TALL_ROOM = 0.3;
const PROP_ROOM = 0.25;
const COVER_ROOM = 0.06;
const ANIMAL_ROOM = 0.15;
/** How many spots a small piece tries on its tile before it gives up (the tall pieces have their corners). */
const TRIES = 6;
/** Forest field: period (world units) and the weight it gives forest tiles (papertrails: 0.06 + 5.2 F^2). */
const FOREST_PERIOD = 20;
const SPECIES_PERIOD = 12;

export interface CoverEnv {
  /** Shore distance (< 0 on land). */
  distance(x: number, z: number): number;
  biome(x: number, z: number, d: number): Biome;
  /** True if something already stands (or a road runs) within r of the point. */
  blocked(x: number, z: number, r: number): boolean;
  /** Keeps r round the point clear from now on. */
  claim(x: number, z: number, r: number): void;
  /**
   * Stands a card; card.vignette: papertrails' animal tied to a piece (it keeps its place); card.tone: its clump
   * shading.
   */
  place(sprite: string, x: number, z: number, height: number, card?: Pick<CardSpec, 'vignette' | 'tone'>): void;
  rng(): number;
}

const between = (env: CoverEnv, [a, b]: [number, number]) => a + Math.floor(env.rng() * (b - a + 1));

/** The first n of the items in a random order (Fisher-Yates). */
function sample<T>(env: CoverEnv, items: readonly T[], n: number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(env.rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** Hands out the species of a list in a shuffled order, every one of them before any comes again. */
function deck(env: CoverEnv, items: readonly string[]): () => string {
  let left: string[] = [];
  return () => {
    if (!left.length) left = sample(env, items, items.length);
    return left.pop()!;
  };
}

/**
 * Room for a piece on a tile: up to TRIES spots within half of its centre (along both axes), the first whose shore
 * distance d passes ok and that is clear by room; or null.
 */
function spot(env: CoverEnv, cx: number, cz: number, half: number, room: number, ok: (d: number) => boolean): [number, number] | null {
  for (let t = 0; t < TRIES; t++) {
    const x = cx + (env.rng() - 0.5) * 2 * half;
    const z = cz + (env.rng() - 0.5) * 2 * half;
    if (ok(env.distance(x, z)) && !env.blocked(x, z, room)) return [x, z];
  }
  return null;
}

/** Plants the tiles of the square [x0, x0 + size) x [z0, z0 + size) (size a multiple of CELL, aligned to it). */
export function plantCover(env: CoverEnv, x0: number, z0: number, size: number): void {
  for (let cz = z0 + CELL / 2; cz < z0 + size; cz += CELL) {
    for (let cx = x0 + CELL / 2; cx < x0 + size; cx += CELL) {
      const d = env.distance(cx, cz);
      if (d > -0.15) continue;
      const biome: Biome = d > -1.1 ? 'beach' : env.biome(cx, cz, d);
      const forest = fbm(SEED + 301, cx / FOREST_PERIOD, cz / FOREST_PERIOD, 2);
      const kinds = TILES[biome];
      const kind = pickWeighted(kinds, (k) => k.weight * (k.forest ? 0.06 + 5.2 * forest * forest : 1), env.rng());
      plantTile(env, kind, kinds.indexOf(kind), biome, cx, cz);
    }
  }
}

function plantTile(env: CoverEnv, kind: TileKind, kindIndex: number, biome: Biome, cx: number, cz: number): void {
  const talls: Array<[number, number]> = [];
  if (kind.tall) {
    const list = kind.tall.species;
    const lead = list[Math.floor(valueNoise(SEED + 311 + kindIndex * 7, cx / SPECIES_PERIOD, cz / SPECIES_PERIOD) * list.length) % list.length];
    const others = deck(env, list.filter((s) => s !== lead));
    const corners = sample(env, SPOTS, between(env, kind.tall.count));
    for (const [k, [sx, sz]] of corners.entries()) {
      // (the leading species stands first, the others of the list after it)
      const species = k === 0 || list.length === 1 ? lead : others();
      const x = cx + sx * (CORNER + (env.rng() - 0.5) * 2 * CORNER_JITTER);
      const z = cz + sz * (CORNER + (env.rng() - 0.5) * 2 * CORNER_JITTER);
      const h = heightOf(species, env.rng());
      // a tall piece stands well up the beach (its trunk never at the water's edge)
      if (env.distance(x, z) > -Math.min(1.1, 0.25 + h * 0.22) || env.blocked(x, z, TALL_ROOM)) continue;
      env.place(species, x, z, h);
      env.claim(x, z, TALL_ROOM);
      talls.push([x, z]);
    }
  }
  if (kind.props) {
    const next = deck(env, kind.props.species);
    for (let n = between(env, kind.props.count); n > 0; n--) {
      const sprite = next();
      const at = spot(env, cx, cz, 0.8, PROP_ROOM, (d) => d < -0.2);
      if (!at) continue;
      const [x, z] = at;
      env.place(sprite, x, z, heightOf(sprite, env.rng()));
      env.claim(x, z, PROP_ROOM);
    }
  }
  if (kind.clumps) {
    const next = deck(env, kind.clumps.species);
    for (let n = between(env, kind.clumps.count); n > 0; n--) {
      const at = spot(env, cx, cz, 0.75, COVER_ROOM, (d) => d < -0.12);
      if (!at) continue;
      let [x, z] = at;
      // its cards: different species, the tallest first (at the back)
      const size = Math.min(pickWeighted(CLUMP_SIZES, (e) => e[1], env.rng())[0], kind.clumps.species.length);
      const species = new Set<string>();
      while (species.size < size) species.add(next());
      const cards = [...species].map((sprite) => ({ sprite, height: heightOf(sprite, env.rng()) })).sort((a, b) => b.height - a.height);
      const side = env.rng() < 0.5 ? -1 : 1;
      for (const [m, { sprite, height }] of cards.entries()) {
        if (env.distance(x, z) < -0.12 && !env.blocked(x, z, COVER_ROOM)) {
          env.place(sprite, x, z, height, { tone: CLUMP_TONES[size][m] });
          env.claim(x, z, COVER_ROOM);
        }
        // the next card stands out to one side of this one and a little in front of it
        x += side * (CLUMP_SIDE[0] + env.rng() * (CLUMP_SIDE[1] - CLUMP_SIDE[0]));
        z += CLUMP_AHEAD[0] + env.rng() * (CLUMP_AHEAD[1] - CLUMP_AHEAD[0]);
      }
    }
  }
  // the tile's animals: as many as its average says (its whole part, and one more by chance of the rest)
  const animals = ANIMALS[biome];
  if (kind.animals && animals) {
    const n = Math.floor(kind.animals) + (env.rng() < kind.animals % 1 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const [sprite] = pickWeighted(animals, (e) => e[1], env.rng());
      // papertrails' grove vignettes: a squirrel at a tree's trunk (our gecko), a fox half hidden behind one (our boar)
      const tree = VIGNETTES[sprite] && talls.length ? talls[Math.floor(env.rng() * talls.length)] : null;
      if (tree) {
        const side = env.rng() < 0.5 ? -1 : 1;
        const [ox, oz] = VIGNETTES[sprite];
        const x = tree[0] + side * ox;
        const z = tree[1] + oz;
        if (env.distance(x, z) < -0.2) env.place(sprite, x, z, heightOf(sprite, env.rng()), { vignette: { seat: 0 } });
        continue;
      }
      // (crabs keep to the beach)
      const at = spot(env, cx, cz, 0.7, ANIMAL_ROOM, (d) => d < -0.2 && !(sprite === 'crab' && d < -0.7));
      if (at) env.place(sprite, at[0], at[1], heightOf(sprite, env.rng()));
    }
  }
}

/** The shallows round a coast: flamingos wading, now and then a sea arch or a stack off the shore. */
export function plantShallows(env: CoverEnv, x0: number, z0: number, size: number): void {
  for (let cz = z0 + CELL / 2; cz < z0 + size; cz += CELL) {
    for (let cx = x0 + CELL / 2; cx < x0 + size; cx += CELL) {
      const x = cx + (env.rng() - 0.5) * CELL;
      const z = cz + (env.rng() - 0.5) * CELL;
      const d = env.distance(x, z);
      if (d > 0.25 && d < 0.8 && env.rng() < 0.08) env.place('flamingo', x, z, heightOf('flamingo', env.rng()));
      else if (d > 1.2 && d < 2.6 && env.rng() < 0.025 && !env.blocked(x, z, 1.5)) {
        env.claim(x, z, 1.5);
        const sprite = env.rng() < 0.6 ? 'sea-arch' : 'rock-spire';
        env.place(sprite, x, z, sprite === 'sea-arch' ? heightOf('sea-arch', env.rng()) : 1.2 + env.rng() * 0.4);
      }
    }
  }
}
