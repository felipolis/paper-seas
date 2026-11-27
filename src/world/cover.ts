/**
 * Ground cover, planted by 2 x 2 tiles (see config/flora.ts): every tile on land is one composition picked for its
 * biome: a few tall pieces near its corners (a leading species that drifts slowly from tile to tile, the others of
 * its list mixed in), clumps of ground cover and flowers, small props, and its animals (herds and flocks, some about
 * by day or by night only, config/flora.ts ANIMALS). A tile hardly ever shows the same drawing twice: each list hands
 * out all its species before any comes again. Forest tiles gather where a low-frequency field is high, so the woods
 * mass together; where another slow field is low the tile is a clearing (designed negative space: open ground
 * between the groups, clumped, never even), only a low clump or two on it. In any view-sized region no more than
 * SAME_CAP of one prop or animal stand (a world of clones reads as a tech demo).
 *
 * A clump is one to four cards of different species, the tallest at the back and the shorter ones stepping out in
 * front of it, the cards toward the back printed darker.
 */
import { WORLD } from '../config/world';
import { pickWeighted } from '../core/rng';
import { ANIMALS, SEA_STACK, TILES, hasTag, heightOf, variantOf, type AnimalRow, type Sprite, type TileKind } from '../config/flora';
import { spriteTop } from '../art/sprites';
import { penAt } from './pen';
import { fbm, valueNoise } from '../core/noise';
import { CELL } from './reveal';
import type { Biome } from './land';
import type { SetDown } from './card-field';

const SEED = WORLD.seed;
/** Tall pieces stand this far from the tile centre along both axes, give or take. */
const CORNER = 0.62;
const CORNER_JITTER = 0.15;
/** Where the tall pieces of a tile stand: its corners, and its middle for a fifth. */
const SPOTS: Array<[number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]];
/**
 * Vignettes at a tree: beside its trunk, 0.08 + 0.14 out and 0.07
 * toward the camera; behind it, 0.1 out and 0.05 back (the body hidden by the card, the head out past its edge).
 */
const VIGNETTES: Record<string, [number, number]> = { gecko: [0.22, 0.07], boar: [0.1, -0.05] };
/** How many cards a clump has (weights: 16 of one card, 49 of two, 19 of three, 2 of four). */
const CLUMP_SIZES: Array<[number, number]> = [[1, 16], [2, 49], [3, 19], [4, 2]];
/**
 * Clump shading, by the card's place from the back:
 * the front card as drawn, each one behind it about a tenth darker.
 */
const CLUMP_TONES: number[][] = [[], [1], [0.87, 1], [0.79, 0.89, 1], [0.69, 0.79, 0.89, 1]];
/**
 * Where the next card of a clump stands from the last: to either side, and a little in front (about 0.2
 * apart, 0.06 nearer the camera, the median).
 */
const CLUMP_SIDE: [number, number] = [0.08, 0.24];
const CLUMP_AHEAD: [number, number] = [-0.03, 0.12];
/** Footprints kept clear round what is planted (so nothing stands inside something else). */
const TALL_ROOM = 0.3;
const PROP_ROOM = 0.25;
const COVER_ROOM = 0.06;
const ANIMAL_ROOM = 0.15;
/**
 * A herd: the first of a group finds its spot, the others stand within this of it
 * (0.2 + 0.09 a head), no nearer than HERD_GAP to one another.
 */
const HERD_SPREAD = [0.2, 0.09] as const;
const HERD_GAP = 0.16;
/**
 * Perches: the window of the tops an owl takes on a prop that is a perch (config/flora.ts), in world units; a sitter
 * sinks this far below the top.
 */
const PERCH_TOP: [number, number] = [0.06, 0.62];
const PERCH_SINK = 0.03;
/** How many spots a small piece tries on its tile before it gives up (the tall pieces have their corners). */
const TRIES = 6;
/** Forest field: period (world units) and the weight it gives forest tiles (0.06 + 5.2 F^2). */
const FOREST_PERIOD = 20;
const SPECIES_PERIOD = 12;
/** Clearing field: its period (world units, several groups wide) and the level below which a tile is a clearing. */
const CLEARING_PERIOD = 9;
const CLEARING_LEVEL = 0.36;
/** At most this many of one prop or animal in a REGION x REGION square (about what one on-foot view shows). */
const SAME_CAP = 3;
const REGION = 9;

export interface CoverEnv {
  /** Shore distance (< 0 on land). */
  distance(x: number, z: number): number;
  biome(x: number, z: number, d: number): Biome;
  /** True if something already stands (or a road runs) within r of the point. */
  blocked(x: number, z: number, r: number): boolean;
  /** Keeps r round the point clear from now on. */
  claim(x: number, z: number, r: number): void;
  /**
   * Stands a card; card.vignette: an animal tied to a piece (it keeps its place); card.tone: its clump
   * shading; card.awake: an animal about by day or by night only; card.passable: too low to stop the feet; card.yaw:
   * its own turn, set with the rest of its scene (a pen's fences), not a random one.
   */
  place(sprite: string, x: number, z: number, height: number, card?: SetDown): void;
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
function deck<T>(env: CoverEnv, items: readonly T[]): () => T {
  let left: T[] = [];
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
  // (props and animals counted per region; a region lies within one square, its size a multiple of REGION)
  const counts = new Map<string, number>();
  let pens = 0;
  const room = (sprite: string, x: number, z: number): boolean => {
    const key = `${Math.floor(x / REGION)},${Math.floor(z / REGION)}|${sprite}`;
    const n = counts.get(key) ?? 0;
    if (n >= SAME_CAP) return false;
    counts.set(key, n + 1);
    return true;
  };
  for (let cz = z0 + CELL / 2; cz < z0 + size; cz += CELL) {
    for (let cx = x0 + CELL / 2; cx < x0 + size; cx += CELL) {
      const d = env.distance(cx, cz);
      if (d > -0.15) continue;
      const biome = env.biome(cx, cz, d);
      const forest = fbm(SEED + 301, cx / FOREST_PERIOD, cz / FOREST_PERIOD, 2);
      const kinds = TILES[biome];
      const kind = pickWeighted(kinds, (k) => k.weight * (k.forest ? 0.06 + 5.2 * forest * forest : 1), env.rng());
      const clearing = !kind.forest && fbm(SEED + 331, cx / CLEARING_PERIOD, cz / CLEARING_PERIOD, 2) < CLEARING_LEVEL;
      // (one pen at most in the square: a meadow of pens reads as a pattern, not a farm)
      const pen = !pens && !!kind.pen && !clearing && env.rng() < kind.pen;
      if (pen && plantPen(env, cx, cz)) pens++;
      plantTile(env, clearing ? clearingOf(kind) : kind, kinds.indexOf(kind), biome, cx, cz, room);
    }
  }
}

/** A tile left open: only a low clump or two of its ground cover. */
function clearingOf(kind: TileKind): TileKind {
  return { weight: kind.weight, clumps: kind.clumps ? { species: kind.clumps.species, count: [1, 2] } : undefined };
}

/** room(sprite, x, z): whether one more of this prop or animal may stand there (and counts it if so). */
function plantTile(env: CoverEnv, kind: TileKind, kindIndex: number, biome: Biome, cx: number, cz: number, room: (sprite: string, x: number, z: number) => boolean): void {
  const talls: Array<[number, number]> = [];
  if (kind.tall) {
    const list = kind.tall.species;
    const lead = list[Math.floor(valueNoise(SEED + 311 + kindIndex * 7, cx / SPECIES_PERIOD, cz / SPECIES_PERIOD) * list.length) % list.length];
    const others = deck(env, list.filter((s) => s !== lead));
    const corners = sample(env, SPOTS, between(env, kind.tall.count));
    for (const [k, [sx, sz]] of corners.entries()) {
      // (the leading species stands first, the others of the list after it)
      const species = variantOf(k === 0 || list.length === 1 ? lead : others(), env.rng());
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
  // (the props an owl may perch on: where, and their top there)
  const perches: Array<[number, number, number]> = [];
  if (kind.props) {
    const next = deck(env, kind.props.species);
    for (let n = between(env, kind.props.count); n > 0; n--) {
      const sprite = next();
      const at = spot(env, cx, cz, 0.8, PROP_ROOM, (d) => d < -0.2);
      if (!at || !room(sprite, at[0], at[1])) continue;
      const [x, z] = at;
      const h = heightOf(sprite, env.rng());
      env.place(sprite, x, z, h);
      env.claim(x, z, PROP_ROOM);
      const top = h * spriteTop(sprite, 0.5);
      if (hasTag(sprite, 'perch') && top >= PERCH_TOP[0] && top <= PERCH_TOP[1]) perches.push([x, z, top]);
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
      const species = new Set<Sprite>();
      while (species.size < size) species.add(next());
      const cards = [...species].map((kind) => variantOf(kind, env.rng())).map((sprite) => ({ sprite, height: heightOf(sprite, env.rng()) })).sort((a, b) => b.height - a.height);
      const side = env.rng() < 0.5 ? -1 : 1;
      for (const [m, { sprite, height }] of cards.entries()) {
        if (env.distance(x, z) < -0.12 && !env.blocked(x, z, COVER_ROOM)) {
          // (a lone card is not a clump: it takes a rear copy instead, world/terrain.ts)
          env.place(sprite, x, z, height, size > 1 ? { tone: CLUMP_TONES[size][m] } : {});
          env.claim(x, z, COVER_ROOM);
        }
        // the next card stands out to one side of this one and a little in front of it
        x += side * (CLUMP_SIDE[0] + env.rng() * (CLUMP_SIDE[1] - CLUMP_SIDE[0]));
        z += CLUMP_AHEAD[0] + env.rng() * (CLUMP_AHEAD[1] - CLUMP_AHEAD[0]);
      }
    }
  }
  // the tile's animals: as many of its rows as its average says (its whole part, and one more by chance of the rest)
  const rows = ANIMALS[biome];
  if (kind.animals && rows) {
    const n = Math.floor(kind.animals) + (env.rng() < kind.animals % 1 ? 1 : 0);
    for (let k = 0; k < n; k++) plantAnimals(env, pickWeighted(rows, (r) => r.weight, env.rng()), cx, cz, talls, perches, room);
  }
}

/**
 * One of a tile's animal rows: at a tree, up on a perch, or on the ground, a herd about the
 * first of it. A herd counts once against the same-kind cap (room).
 */
function plantAnimals(env: CoverEnv, row: AnimalRow, cx: number, cz: number, talls: ReadonlyArray<[number, number]>, perches: ReadonlyArray<[number, number, number]>, room: (sprite: string, x: number, z: number) => boolean): void {
  const sprite = row.species;
  const awake = row.awake;
  // grove vignettes: a gecko at a tree's trunk, a boar half hidden behind one
  if (row.at === 'tree' && talls.length && VIGNETTES[sprite]) {
    const tree = talls[Math.floor(env.rng() * talls.length)];
    const side = env.rng() < 0.5 ? -1 : 1;
    const [ox, oz] = VIGNETTES[sprite];
    const x = tree[0] + side * ox;
    const z = tree[1] + oz;
    if (env.distance(x, z) < -0.2 && room(sprite, x, z)) env.place(sprite, x, z, heightOf(sprite, env.rng()), { vignette: { seat: 0 }, awake });
    return;
  }
  if (row.at === 'perch') {
    if (!perches.length) return;
    const [x, z, top] = perches[Math.floor(env.rng() * perches.length)];
    if (room(sprite, x, z)) env.place(sprite, x, z + 0.02, heightOf(sprite, env.rng()), { vignette: { seat: top - PERCH_SINK }, awake });
    return;
  }
  // (crabs keep to the beach)
  const ok = (d: number) => d < -0.2 && !(sprite === 'crab' && d < -0.7);
  const count = between(env, row.count);
  const spread = HERD_SPREAD[0] + HERD_SPREAD[1] * count;
  const herd: Array<[number, number]> = [];
  for (let m = 0; m < count; m++) {
    const at = row.herd && herd.length ? near(env, herd, spread, ok) : spot(env, cx, cz, 0.7, ANIMAL_ROOM, ok);
    if (!at || (!(row.herd && herd.length) && !room(sprite, at[0], at[1]))) continue;
    env.place(sprite, at[0], at[1], heightOf(sprite, env.rng()), { awake });
    herd.push(at);
  }
}

/** A meadow pen (world/pen.ts) about the tile's middle, its herd keeping its place; whether it found room. */
function plantPen(env: CoverEnv, cx: number, cz: number): boolean {
  const pen = penAt(cx + (env.rng() - 0.5) * 0.4, cz + (env.rng() - 0.5) * 0.4, env.rng);
  const clear = (px: number, pz: number, r: number) => env.distance(px, pz) < -0.3 && !env.blocked(px, pz, r);
  if (!clear(pen.x, pen.z, pen.room) || !pen.fences.every(([px, pz]) => env.distance(px, pz) < -0.3)) return false;
  for (const [px, pz, yaw] of pen.fences) env.place(pen.fence, px, pz, pen.height, { yaw, passable: true });
  for (const [who, x, z] of pen.herd) env.place(who, x, z, heightOf(who, env.rng()), { vignette: { seat: 0 } });
  env.claim(pen.x, pen.z, pen.room);
  return true;
}

/** A spot for the next of a herd: within spread of its first, clear of the others of it by HERD_GAP; or null. */
function near(env: CoverEnv, herd: ReadonlyArray<[number, number]>, spread: number, ok: (d: number) => boolean): [number, number] | null {
  const [hx, hz] = herd[0];
  for (let t = 0; t < TRIES * 2; t++) {
    const x = hx + (env.rng() - 0.5) * 2 * spread;
    const z = hz + (env.rng() - 0.5) * 2 * spread;
    if (!ok(env.distance(x, z)) || env.blocked(x, z, ANIMAL_ROOM) || herd.some(([ax, az]) => Math.hypot(ax - x, az - z) < HERD_GAP)) continue;
    return [x, z];
  }
  return null;
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
        env.place(sprite, x, z, sprite === 'sea-arch' ? heightOf('sea-arch', env.rng()) : SEA_STACK[0] + env.rng() * (SEA_STACK[1] - SEA_STACK[0]));
      }
    }
  }
}
