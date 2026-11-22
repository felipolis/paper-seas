/**
 * Streams the land in square chunks around the ship. A chunk is built in small steps over several frames (a
 * generator), so sailing never stutters:
 *
 *   1. sample the land field and the terrace thresholds on a grid aligned to the world
 *   2. print the ground texture pixel by pixel from those grids (sand, wet sand, biome-tinted grass, hills, rock,
 *      snow, inked terrace edges): every term is a function of world position, so chunks meet without seams
 *   3. extrude each terrace (sand, grass, hill, high) into stacked paper layers, clipped to the chunk square
 *   4. place the standing cards: vegetation by biome, big scenery on the high ground, villages on the coast,
 *      ruins, signature landmarks of the stamped islands, chests on beaches, animals, sea arches in the shallows
 */
import * as THREE from 'three';
import { POPUP } from '../config/popup';
import { DEG, clamp, hexRgb, smoothstep } from '../core/math';
import { hash2, mulberry32 } from '../core/rng';
import { mirrorSkip } from '../render/reflection';
import { toTexture } from '../art/card-painter';
import { spriteInfo, spriteSpan, spriteTop } from '../art/sprites';
import { BAND_HI, BAND_LO, HULL_MAX, hullSegments, placeSegments, type Segment } from './blockers';
import { JITTER, type Reveal } from './reveal';
import { contoursFromGrid, outlinesWithHoles, type Grid } from './contours';
import { LAND_TOP, type LandField } from './land';
import { valueNoise } from './noise';
import { plantCover, plantShallows, type CoverEnv } from './cover';
import { addContact, edgeWallUV, groundData, groundMaterial, landEdgeMaterial, pathTones } from './ground-shader';
import { streamRibbons } from './stream-mesh';
import type { Chimney } from '../life/smoke';
import { ROAD_WIDTH } from './roads';
import { Streams } from './streams';
import type { Places } from './places';
import { polylineDistance, segmentDistance, type Box, type Pt } from './polyline';
import { heightOf } from '../config/flora';
import { CROSS_PLANES, type Card, type CardField, type CardSpec } from './card-field';
import { islandName } from './island-names';
import { buildModel, modelInfo, type Building } from './models';
import type { IslandSpec } from './island-layout';

/** World hashes are salted with the voyage seed: every voyage places its own villages, ruins, chests... */
import { WORLD } from '../config/world';
import { Critters } from './critters';
import { applyTint, groundTint, pathTone, type TintRows } from '../render/biome-tint';
const SEED = WORLD.seed;

export const CHUNK = 18;

/**
 * The land field is a distance *estimate*: where its noise flattens out it can read "0.3 from the shore" over open
 * sea with no land anywhere near. Dividing by the gradient's length turns it into a true distance (sign and zero
 * line unchanged), so nothing ever collides with land that is not there.
 */
export function trueDistance(a: Float32Array, w: number, cell: number): Float32Array {
  const h = a.length / w;
  const out = new Float32Array(a.length);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const il = i > 0 ? k - 1 : k;
      const ir = i < w - 1 ? k + 1 : k;
      const jd = j > 0 ? k - w : k;
      const ju = j < h - 1 ? k + w : k;
      const gx = (a[ir] - a[il]) / (cell * (ir - il || 1));
      const gz = (a[ju] - a[jd]) / ((cell * (ju - jd || 1)) / w);
      const g = Math.max(0.05, Math.hypot(gx, gz));
      out[k] = a[k] / g;
    }
  }
  return out;
}
const CELL = 0.225; // 80 cells per chunk, aligned to the world
const PPU = 44; // ground print resolution (pixels per world unit)
/** Nodes per chunk side of the grid the ground tint is blended over (papertrails blends its biomes over one tile). */
const TINT_GRID = 8;

/** sRGB byte <-> linear (papertrails' transforms work on linear colour). */
const toLinear = (v: number) => Math.pow(v / 255, 2.2);
const toByte = (v: number) => 255 * Math.pow(Math.min(1, v), 1 / 2.2);

/**
 * A ground colour (sRGB bytes) under the biome tints of the four grid nodes round (u, v) (0..1 across the chunk),
 * mixed by smooth weights; null nodes are the identity.
 */
function tintAt(tints: Array<TintRows | null>, u: number, v: number, r: number, g: number, b: number, lin: [number, number, number], one: [number, number, number]): [number, number, number] {
  const fx = clamp(u * TINT_GRID, 0, TINT_GRID - 1e-3);
  const fz = clamp(v * TINT_GRID, 0, TINT_GRID - 1e-3);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const a = smoothstep(0, 1, fx - i);
  const c = smoothstep(0, 1, fz - j);
  lin[0] = lin[1] = lin[2] = 0;
  for (const [di, dj, w] of [[0, 0, (1 - a) * (1 - c)], [1, 0, a * (1 - c)], [0, 1, (1 - a) * c], [1, 1, a * c]] as const) {
    one[0] = toLinear(r);
    one[1] = toLinear(g);
    one[2] = toLinear(b);
    const t = tints[(j + dj) * (TINT_GRID + 1) + i + di];
    if (t) applyTint(t, one);
    lin[0] += one[0] * w;
    lin[1] += one[1] * w;
    lin[2] += one[2] * w;
  }
  return [toByte(lin[0]), toByte(lin[1]), toByte(lin[2])];
}
const LOAD_RADIUS = 36;
const UNLOAD_RADIUS = 46;
const FRAME_BUDGET_MS = 4;
/** Grid layout shared by every chunk (origin = chunk corner - one cell). */
const GRID_N = Math.round(CHUNK / CELL) + 2;
const GRID_W = GRID_N + 1;


interface Chunk {
  key: number;
  i: number;
  j: number;
  ground: THREE.Group | null;
  cards: Card[];
  chests: Chest[];
  texture: THREE.Texture | null;
  /** The ground shader's data (roads, grass): world/ground-shader.ts. */
  data: THREE.DataTexture | null;
  /** The road tone of its biomes (world/ground-shader.ts pathTones). */
  pathTone: THREE.DataTexture | null;
  material: THREE.Material | null;
  /** Assembled houses of this chunk. */
  houses: Building[];
  /** The shore-distance grid the ground was drawn from (null until sampled): collisions read the same numbers. */
  dist: Float32Array | null;
  /** Walkable decks (piers, bridges) of this chunk. */
  decks: Deck[];
  /** The trodden ground of this chunk (roads, lanes, squares), as the ground shader draws it. */
  paths: Paths | null;
}

interface Paths {
  strips: Array<{ pts: Pt[]; width: number }>;
  squares: Array<[number, number, number]>;
}

/**
 * A walkable deck: centred at (x, z), running along the unit (dx, dz) (a pier: out to sea), half its length and
 * width; its height is y at the ends and rises by `rise` at the middle (a bridge's arch).
 */
interface Deck {
  kind: 'pier' | 'bridge';
  x: number;
  z: number;
  dx: number;
  dz: number;
  half: number;
  halfW: number;
  y: number;
  rise: number;
  building: Building;
}

/** A treasure chest standing on a beach. */
export interface Chest {
  id: number;
  card: Card;
  name: string;
}

const C = {
  sand: hexRgb('#e6cf9a'),
  wetSand: hexRgb('#cdb07a'),
  /** papertrails' page: one ground tone for every biome (world.js there), its printed patches flattened. */
  page: hexRgb('#a8a374'),
  hill: hexRgb('#8a8a58'),
  rock: hexRgb('#8f9070'),
};

/**
 * Symmetric trees are two cards slotted together (a crossed pop-up). Only where the print is symmetric about its
 * trunk: a leaning palm, a palm cluster or a twisted dead tree would not cross cleanly, so they stay single cards.
 */
const CROSSED = new Set(['palm-1', 'pine', 'pine-1', 'pine-2', 'cypress', 'tree-broad', 'tree-broad-1', 'tree-broad-2', 'tree-blossom', 'tree-blossom-1', 'mangrove', 'acacia', 'banana']);
/** papertrails' crossed cards turn only this share of the camera-facing cards' jitter (world.js cardJ). */
const CROSS_JITTER = 0.6;

/** papertrails' closeRadius x 2: gaps between blocking pieces narrower than this are closed (world.js buildField). */
const CLOSE = 0.4;

/** The closest approach between two sets of segments: its length and the segment across it, or null. */
function closestBetween(a: Segment[], b: Segment[]): [number, Segment] | null {
  let best: [number, Segment] | null = null;
  const tryPoint = (px: number, pz: number, [ax, az, bx, bz]: Segment, flip: boolean) => {
    const [d, t] = segmentDistance(px, pz, ax, az, bx, bz);
    if (best && d >= best[0]) return;
    const qx = ax + (bx - ax) * t;
    const qz = az + (bz - az) * t;
    best = [d, flip ? [qx, qz, px, pz] : [px, pz, qx, qz]];
  };
  for (const s of a) {
    for (const t of b) {
      tryPoint(s[0], s[1], t, false);
      tryPoint(s[2], s[3], t, false);
      tryPoint(t[0], t[1], s, true);
      tryPoint(t[2], t[3], s, true);
    }
  }
  return best;
}

/** Width of the lanes from a village square to its doors, and the square's radius (papertrails' road: 0.5). */
const LANE_WIDTH = 0.36;
const SQUARE_RADIUS = 0.95;

/** Clear ground kept round a building (beyond its own footprint): the ground cover grows close to the walls. */
const YARD = 0.35;

/** Cards that stand in the shallows on purpose. */
const SEA_CARDS = new Set(['flamingo', 'sea-arch', 'rock-spire', 'duck-float']);
/** papertrails' watchtower vignette: an owl at this share of the top of the tower, on this share of the towers. */
const TOP_K = 0.95;
const OWL_CHANCE = 0.85;
/** papertrails' roadside props: every path tile carries one (a guidepost, a bench, a cart, barrels or signposts). */
const ROADSIDE = ['signpost', 'guidepost', 'bench', 'handcart', 'lantern-post', 'barrel'];
/** One roadside prop every this many units of road, standing this far out from its edge. */
const ROADSIDE_STEP = 3.2;
const ROADSIDE_OUT = 0.32;
/** Reeds stand along a stream's banks every this many points (papertrails' river tiles: 1 to 5 reeds). */
const REED_EVERY = 4;
/** papertrails' ducks: on a river tile 0.4 chance of one or two floating; a frog on the bank 0.45 at a spring. */
const DUCK_CHANCE = 0.12;
const BANK_ANIMAL_CHANCE = 0.08;

/** Ground cover and animals: the feet go through (or past) them. */
const SOFT = /^(grass|fern|bush|flower|tuft|hibiscus|orchids|bird-of-paradise|cattails|papyrus|mushrooms|shells|pebbles|monkey|parrot|toucan|crab|iguana|pelican|flamingo|duck|hen|chick|goat|pig|cat|dog|frog|rabbit|owl|hummingbird|tortoise|boar|gecko|heron)/;
/** How far up a stream's bed (from the shore) the sea comes in: its inlet. */
const MOUTH = 1.2;
/** Room kept between a path's edge and the blocking foot of any card (u). */
const PATH_ROOM = 0.12;

/** The part of a card's width (0..1 across its face) that stops the feet: its print in the blocking height band. */
function blockingSpan(sprite: string, height: number): [number, number] | null {
  return SOFT.test(sprite) ? null : spriteSpan(sprite, BAND_LO / height, BAND_HI / height);
}

/** How far a card's blocking foot reaches from its centre (0 if nothing of it blocks). */
function footReach(sprite: string, height: number): number {
  const span = blockingSpan(sprite, height);
  if (!span) return 0;
  const info = spriteInfo(sprite);
  return Math.max(0.5 - span[0], span[1] - 0.5) * ((height * info.w) / info.h);
}


export class Terrain {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, Chunk>();
  /** The land sheet's cut edge: the card's own colour. */
  private readonly edgeMaterial = landEdgeMaterial();
  private job: { key: number; it: Iterator<void> } | null = null;
  private readonly chests = new Map<number, Chest>();

  /** Uploads a texture to the GPU right away (set by the game), so a new chunk never stalls a later frame. */
  uploadTexture: (t: THREE.Texture) => void = () => {};

  constructor(private readonly land: LandField, private readonly cards: CardField, private readonly places: Places) {}

  /**
   * Shore distance exactly as the ground was drawn: bilinear on the chunk's sampled grid (so you collide with what
   * you see, never with a sliver of land too thin to print); the analytic field where no chunk is sampled yet.
   */
  /** True on a road, a lane or a village square (trodden ground). */
  onPath(x: number, z: number): boolean {
    const p = this.chunks.get(this.key(Math.floor(x / CHUNK), Math.floor(z / CHUNK)))?.paths;
    if (!p) return false;
    return p.squares.some(([sx, sz, r]) => Math.hypot(x - sx, z - sz) < r) || p.strips.some((st) => polylineDistance(st.pts, x, z)[0] < st.width / 2);
  }

  distanceAt(x: number, z: number): number {
    const i = Math.floor(x / CHUNK);
    const j = Math.floor(z / CHUNK);
    const c = this.chunks.get(this.key(i, j));
    if (!c || !c.dist) return this.land.distance(x, z);
    const fx = Math.min(GRID_N - 1e-3, Math.max(0, (x - (i * CHUNK - CELL)) / CELL));
    const fz = Math.min(GRID_N - 1e-3, Math.max(0, (z - (j * CHUNK - CELL)) / CELL));
    const ii = Math.floor(fx);
    const jj = Math.floor(fz);
    const u = fx - ii;
    const v = fz - jj;
    const k = jj * GRID_W + ii;
    const a = c.dist;
    return a[k] * (1 - u) * (1 - v) + a[k + 1] * u * (1 - v) + a[k + GRID_W] * (1 - u) * v + a[k + GRID_W + 1] * u * v;
  }

  /** Chests currently loaded. */
  chestList(): IterableIterator<Chest> {
    return this.chests.values();
  }

  /** Builds every chunk around a point right away (start of the voyage). */
  prime(x: number, z: number): void {
    for (const [i, j] of this.wanted(x, z)) {
      const key = this.key(i, j);
      if (this.chunks.has(key)) continue;
      const it = this.build(i, j);
      while (!it.next().done) { /* run to completion */ }
    }
  }

  /**
   * What stops the feet within r of (x, z), as drawn (papertrails' walk field): the print of every standing card
   * between the blocking heights (a trunk, the foot of a rock, a crate; the soft ground cover and the animals never
   * block) and the footprint of every assembled building. Folded pieces lie flat and stop nothing; piers are walked on.
   */
  blockersNear(x: number, z: number, r: number): Segment[] {
    const out: Segment[] = [];
    // (each piece's segments, for papertrails' closing below)
    const pieces: Segment[][] = [];
    for (const c of this.chunks.values()) {
      // (only the chunks round the point)
      if (x < c.i * CHUNK - r - 2 || x > (c.i + 1) * CHUNK + r + 2 || z < c.j * CHUNK - r - 2 || z > (c.j + 1) * CHUNK + r + 2) continue;
      for (const card of c.cards) {
        if (card.hidden || card.flap.p < 0.5 || Math.abs(card.x - x) > r + 1.5 || Math.abs(card.z - z) > r + 1.5) continue;
        const span = blockingSpan(card.sprite, card.height);
        if (!span) continue;
        const info = spriteInfo(card.sprite);
        const w = (card.height * info.w) / info.h;
        // the card's own x runs across its face; a flipped card is mirrored
        const l = (card.flip ? 0.5 - span[1] : span[0] - 0.5) * w;
        const rr = (card.flip ? 0.5 - span[0] : span[1] - 0.5) * w;
        const planes = (card.cross ? CROSS_PLANES.map((a) => card.yaw + a) : [card.yaw]).map((yaw): Segment => {
          const cx = Math.cos(yaw);
          const sz = -Math.sin(yaw);
          return [card.x + cx * l, card.z + sz * l, card.x + cx * rr, card.z + sz * rr];
        });
        // papertrails' hull fill: crossed cards block their whole footprint, or the four quadrants between them
        // would be pockets a walker gets wedged in; a footprint wider than HULL_MAX is no single prop, its cards block
        pieces.push(card.cross && rr - l <= HULL_MAX ? hullSegments(planes) : planes);
      }
      for (const h of c.houses) {
        if (h.name === 'pier' || h.fold.progress < 0.6 || Math.abs(h.x - x) > r + 4 || Math.abs(h.z - z) > r + 4) continue;
        const foot: Segment[] = [];
        placeSegments(h.foot, h.x, h.z, h.yaw, foot);
        pieces.push(foot);
      }
    }
    for (const p of pieces) out.push(...p);
    // papertrails' closing (world.js buildField there, closeRadius 0.2): a gap narrower than CLOSE between two pieces is
    // filled, so no nook between them is left for the feet to be wedged in (the feet need more room than that to pass)
    for (let a = 0; a < pieces.length; a++) {
      for (let b = a + 1; b < pieces.length; b++) {
        const gap = closestBetween(pieces[a], pieces[b]);
        if (gap && gap[0] < CLOSE) out.push(gap[1]);
      }
    }
    return out;
  }

  private clock = 0;
  private readonly flips = new WeakMap<Building, number>();

  /** A Blender-built model standing in this chunk (raised and folded by updateHouses). */
  private addBuilding(chunk: Chunk, name: string, x: number, y: number, z: number, yaw: number): Building {
    const b = buildModel(name, x, y, z, yaw, this.land.biomeInland(x, z));
    b.root.visible = false;
    this.group.add(b.root);
    chunk.houses.push(b);
    return b;
  }

  /**
   * papertrails' sightBlocked: true if the ray from (ox, oy, oz) along the unit (dx, dy, dz) meets a standing large
   * piece (a building, a mountain: what cannot tip aside) within len. Each is taken as its box (footprint x height).
   */
  sightBlocked(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number): boolean {
    for (const c of this.chunks.values()) {
      for (const h of c.houses) {
        if (h.name === 'pier' || h.name === 'bridge' || h.fold.progress < 0.6) continue;
        const info = modelInfo(h.name)!;
        const reach = Math.hypot(info.width, info.depth) / 2;
        if (Math.hypot(h.x - ox, h.z - oz) > len + reach) continue;
        // into the building's own frame (turned by yaw about +y, like Object3D.rotation.y)
        const cs = Math.cos(h.yaw);
        const sn = Math.sin(h.yaw);
        const px = ox - h.x;
        const pz = oz - h.z;
        const lo = [px * cs - pz * sn, oy - h.root.position.y, px * sn + pz * cs];
        const ld = [dx * cs - dz * sn, dy, dx * sn + dz * cs];
        const half = [info.width / 2, info.height, info.depth / 2];
        const min = [-half[0], 0, -half[2]];
        let t0 = 0;
        let t1 = len;
        for (let a = 0; a < 3 && t0 <= t1; a++) {
          if (Math.abs(ld[a]) < 1e-9) {
            if (lo[a] < min[a] || lo[a] > half[a]) t1 = -1;
            continue;
          }
          let ta = (min[a] - lo[a]) / ld[a];
          let tb = (half[a] - lo[a]) / ld[a];
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
        }
        if (t0 <= t1) return true;
      }
    }
    return false;
  }

  /** The height of a standing deck (pier, bridge) under (x, z), or null when there is none (it must be up to be walked). */
  deckAt(x: number, z: number): number | null {
    for (const c of this.chunks.values()) {
      for (const p of c.decks) {
        const rx = x - p.x;
        const rz = z - p.z;
        const along = rx * p.dx + rz * p.dz;
        const across = -rx * p.dz + rz * p.dx;
        if (Math.abs(along) > p.half || Math.abs(across) > p.halfW || p.building.fold.progress < 0.9) continue;
        return p.y + p.rise * (1 - (along / p.half) ** 2);
      }
    }
    return null;
  }

  /** The chimneys of the standing houses within r of (x, z) (for their smoke). */
  chimneysNear(x: number, z: number, r: number): Chimney[] {
    const out: Chimney[] = [];
    for (const c of this.chunks.values()) {
      for (const h of c.houses) {
        if (h.smoke && h.fold.progress > 0.95 && Math.hypot(h.x - x, h.z - z) < r) out.push({ key: h, at: h.smoke });
      }
    }
    return out;
  }

  /** Points along every standing pier near (x, z) (to step ashore onto one from the ship). */
  piersNear(x: number, z: number, r: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const c of this.chunks.values()) {
      for (const p of c.decks) {
        if (p.kind !== 'pier' || Math.hypot(p.x - x, p.z - z) > r + p.half || p.building.fold.progress < 0.9) continue;
        for (let t = -p.half + 0.2; t <= p.half - 0.1; t += 0.25) out.push([p.x + p.dx * t, p.z + p.dz * t]);
      }
    }
    return out;
  }

  /** A deck (pier or bridge) standing at (x, z), running along the unit (dx, dz). */
  private addDeck(chunk: Chunk, kind: Deck['kind'], x: number, y: number, z: number, dx: number, dz: number): void {
    const info = modelInfo(kind)!;
    const building = this.addBuilding(chunk, kind, x, y, z, Math.atan2(dx, dz));
    chunk.decks.push({ kind, x, z, dx, dz, half: info.depth / 2, halfW: info.width / 2 + 0.02, y: y + info.deck, rise: info.rise, building });
  }

  /** Unfolds / folds the assembled buildings with the same reach as the cards. */
  updateHouses(dt: number, reveal: Reveal): void {
    this.clock += dt;
    for (const c of this.chunks.values()) {
      for (const h of c.houses) {
        // the same rules as the cards (papertrails' tiles): the building is one cell
        const jitter = ((Math.abs(Math.sin(h.x * 12.9898 + h.z * 78.233) * 43758.5453) % 1) - 0.5) * 2 * JITTER;
        if (reveal.mayFlip(h.x, h.z, this.flips.get(h) ?? -99, this.clock)) {
          if (h.fold.target !== 1 && reveal.wantsUp(h.x, h.z)) {
            h.fold.setTarget(1, reveal.riseDelay(h.x, h.z, jitter));
            this.flips.set(h, this.clock);
          } else if (h.fold.target !== 0 && reveal.wantsDown(h.x, h.z)) {
            h.fold.setTarget(0, reveal.foldDelay(h.x, h.z, jitter));
            this.flips.set(h, this.clock);
          }
        }
        h.fold.update(dt);
        // folded, a building lies flat on the page (its walls and roof stacked flat): drawn within sight
        h.root.visible = reveal.distance(h.x, h.z) < reveal.radius + 30;
      }
    }
  }

  update(shipX: number, shipZ: number): void {
    // unload far chunks
    for (const [key, c] of this.chunks) {
      const cx = (c.i + 0.5) * CHUNK;
      const cz = (c.j + 0.5) * CHUNK;
      if (Math.hypot(cx - shipX, cz - shipZ) > UNLOAD_RADIUS) this.unload(key, c);
    }
    // build the nearest missing chunk, a slice per frame
    const t0 = performance.now();
    while (performance.now() - t0 < FRAME_BUDGET_MS) {
      if (!this.job) {
        const next = this.wanted(shipX, shipZ).find(([i, j]) => !this.chunks.has(this.key(i, j)));
        if (!next) return;
        this.job = { key: this.key(next[0], next[1]), it: this.build(next[0], next[1]) };
      }
      if (this.job.it.next().done) this.job = null;
    }
  }

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  private wanted(x: number, z: number): Array<[number, number]> {
    const out: Array<[number, number, number]> = [];
    const r = Math.ceil(LOAD_RADIUS / CHUNK);
    const ci = Math.floor(x / CHUNK);
    const cj = Math.floor(z / CHUNK);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        const d = Math.hypot((i + 0.5) * CHUNK - x, (j + 0.5) * CHUNK - z);
        if (d < LOAD_RADIUS) out.push([i, j, d]);
      }
    }
    return out.sort((a, b) => a[2] - b[2]).map(([i, j]) => [i, j]);
  }

  private unload(key: number, c: Chunk): void {
    for (const h of c.houses) {
      this.group.remove(h.root);
      h.dispose();
    }
    if (c.ground) {
      this.group.remove(c.ground);
      c.ground.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
    c.texture?.dispose();
    c.data?.dispose();
    c.pathTone?.dispose();
    if (c.material) mirrorSkip.delete(c.material);
    c.material?.dispose();
    this.cards.remove(c.cards);
    for (const ch of c.chests) this.chests.delete(ch.id);
    this.chunks.delete(key);
    if (this.job && this.job.key === key) this.job = null;
  }

  /** Builds one chunk, yielding between the expensive steps. */
  private *build(i: number, j: number): Generator<void> {
    const key = this.key(i, j);
    const chunk: Chunk = { key, i, j, ground: null, cards: [], chests: [], texture: null, data: null, pathTone: null, material: null, dist: null, houses: [], decks: [], paths: null };
    this.chunks.set(key, chunk);
    const land = this.land;
    const x0 = i * CHUNK;
    const z0 = j * CHUNK;
    const x1 = x0 + CHUNK;
    const z1 = z0 + CHUNK;

    // ---- 1. grids: shore distance + terrace fields (d + threshold < 0 inside a terrace) ----
    const gx0 = x0 - CELL;
    const gz0 = z0 - CELL;
    const n = Math.round(CHUNK / CELL) + 2;
    const W = n + 1;
    const dist = new Float32Array(W * W);
    const terr = [new Float32Array(W * W), new Float32Array(W * W), new Float32Array(W * W)];
    let minD = Infinity;
    for (let jj = 0; jj <= n; jj++) {
      for (let ii = 0; ii <= n; ii++) {
        const x = gx0 + ii * CELL;
        const z = gz0 + jj * CELL;
        const d = land.distance(x, z);
        const k = jj * W + ii;
        dist[k] = d;
        if (d < minD) minD = d;
        if (d < 0) {
          const th = land.terraceThresholds(x, z);
          for (let t = 0; t < 3; t++) terr[t][k] = d + th[t];
        } else for (let t = 0; t < 3; t++) terr[t][k] = d + 1;
      }
      if (jj % 4 === 3) yield;
    }
    const sampleAt = (a: Float32Array, x: number, z: number): number => {
      const fx = clamp((x - gx0) / CELL, 0, n - 1e-3);
      const fz = clamp((z - gz0) / CELL, 0, n - 1e-3);
      const ii = Math.floor(fx);
      const jj = Math.floor(fz);
      const u = fx - ii;
      const v = fz - jj;
      const k = jj * W + ii;
      return a[k] * (1 - u) * (1 - v) + a[k + 1] * u * (1 - v) + a[k + W] * (1 - u) * v + a[k + W + 1] * u * v;
    };
    const terraceAt = (x: number, z: number): number => {
      if (sampleAt(dist, x, z) >= 0) return -1;
      for (let t = 2; t >= 0; t--) if (sampleAt(terr[t], x, z) < 0) return t + 1;
      return 0;
    };

    const hasLand = minD < 0;
    // what spans chunks and reaches this square (world/places.ts): streams, roads with their bridges, villages, ruins
    const box: Box = [x0 - 1, z0 - 1, x1 + 1, z1 + 1];
    const streams = minD < 3 ? this.places.streams.near(box) : [];
    // where a stream reaches the sea the sea comes up its bed: the land is cut along its banks for its last stretch,
    // so the stream pours off the paper's edge into a little inlet instead of ending against a straight shore
    for (const st of streams) {
      for (let k = 0; k < dist.length; k++) {
        if (dist[k] < -(MOUTH + 1) || dist[k] > 0.5) continue;
        const x = gx0 + (k % W) * CELL;
        const z = gz0 + Math.floor(k / W) * CELL;
        if (x < st.box[0] - 1 || x > st.box[2] + 1 || z < st.box[1] - 1 || z > st.box[3] + 1) continue;
        const [d, at] = polylineDistance(st.pts, x, z);
        const [ax, az] = st.pts[Math.round(at)];
        if (land.distance(ax, az) < -MOUTH) continue;
        dist[k] = Math.max(dist[k], Streams.widthAt(st, at) / 2 - d);
      }
    }
    const shore = (chunk.dist = trueDistance(dist, GRID_W, CELL));
    const roads = minD < 3 ? this.places.roadsNear(box) : [];
    const layouts = minD < 3 ? this.places.layoutsNear(box) : [];
    yield;
    if (hasLand) {
      // ---- 2. ground print ----
      const px = Math.round(CHUNK * PPU);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      const ctx = canvas.getContext('2d')!;
      const img = ctx.createImageData(px, px);
      const data = img.data;
      // papertrails' ground tint, its biomes blended over one tile: the transform of the biome at every node of a coarse
      // grid, the colours they make mixed between the four nodes round a pixel
      const tints = Array.from({ length: (TINT_GRID + 1) ** 2 }, (_, k) => groundTint(land.biomeInland(x0 + ((k % (TINT_GRID + 1)) / TINT_GRID) * CHUNK, z0 + (Math.floor(k / (TINT_GRID + 1)) / TINT_GRID) * CHUNK)));
      const tinted = tints.some((t) => t !== null);
      const lin: [number, number, number] = [0, 0, 0];
      const one: [number, number, number] = [0, 0, 0];
      for (let py = 0; py < px; py++) {
        // canvas rows run from north (top, z0) to south (z1)
        const z = z0 + (py + 0.5) / PPU;
        for (let pxx = 0; pxx < px; pxx++) {
          const x = x0 + (pxx + 0.5) / PPU;
          const d = sampleAt(dist, x, z);
          const o = (py * px + pxx) * 4;
          if (d > 0.05) {
            data[o + 3] = 0;
            continue;
          }
          let r: number;
          let g: number;
          let b: number;
          const t1 = sampleAt(terr[0], x, z);
          const t2 = sampleAt(terr[1], x, z);
          const t3 = sampleAt(terr[2], x, z);
          const grain = valueNoise(7, x * 9, z * 9) * 0.5 + valueNoise(8, x * 31, z * 31) * 0.5;
          if (t1 >= 0) {
            // sand, darker and wetter at the water
            const wet = 1 - smoothstep(-0.35, 0, d);
            const s = 1 - wet * 0.9;
            r = C.sand[0] * s + C.wetSand[0] * (1 - s);
            g = C.sand[1] * s + C.wetSand[1] * (1 - s);
            b = C.sand[2] * s + C.wetSand[2] * (1 - s);
            const dot = valueNoise(9, x * 22, z * 22) > 0.82 ? 0.9 : 1;
            r *= dot; g *= dot; b *= dot;
          } else {
            r = C.page[0]; g = C.page[1]; b = C.page[2];
            // the hills and heights only tint the page a little: the relief is the standing mountains
            if (t2 < 0) {
              const k = smoothstep(0, 1.5, -t2) * (t3 < 0 ? 0.32 : 0.18);
              const base = t3 < 0 ? C.rock : C.hill;
              r = r * (1 - k) + base[0] * k; g = g * (1 - k) + base[1] * k; b = b * (1 - k) + base[2] * k;
            }
          }
          // (the beach's sand is ours, not a page papertrails tints: it keeps its colour)
          if (tinted && t1 < 0) [r, g, b] = tintAt(tints, (x - x0) / CHUNK, (z - z0) / CHUNK, r, g, b, lin, one);
          // (no ink on the ground, as in papertrails: the land's cut edge is the paper's own)
          const shade = 0.9 + 0.2 * grain;
          data[o] = r * shade;
          data[o + 1] = g * shade;
          data[o + 2] = b * shade;
          data[o + 3] = 255;
        }
        if (py % 14 === 13) yield;
      }
      ctx.putImageData(img, 0, 0);
      const texture = toTexture(canvas);
      // the roads, lanes and squares and where the grass grows, for the ground's shader (world/ground-shader.ts)
      chunk.paths = {
        strips: [...roads.map((r) => ({ pts: r.pts, width: ROAD_WIDTH })), ...layouts.flatMap((l) => l.lanes.map((pts) => ({ pts, width: LANE_WIDTH })))],
        squares: layouts.filter((l) => l.site.kind !== 'ruins').map((l): [number, number, number] => [l.site.x, l.site.z, SQUARE_RADIUS]),
      };
      const shaderData = groundData(x0, z0, CHUNK, chunk.paths, (x, z) => smoothstep(0.15, -0.15, sampleAt(terr[0], x, z)));
      yield;
      this.uploadTexture(texture);
      this.uploadTexture(shaderData);
      chunk.texture = texture;
      chunk.data = shaderData;
      const paths = pathTones(TINT_GRID, (u, v) => pathTone(land.biomeInland(x0 + u * CHUNK, z0 + v * CHUNK)));
      this.uploadTexture(paths);
      chunk.pathTone = paths;
      const top = groundMaterial(texture, shaderData, paths, x0, z0, CHUNK);
      chunk.material = top;
      mirrorSkip.add(top);
      yield;

      // ---- 3. the land: one sheet of paper cut to the shore ----
      const ground = new THREE.Group();
      const clip: [number, number, number, number] = [x0, z0, x1, z1];
      const grid: Grid = { x0: gx0, z0: gz0, cell: CELL, nx: n, nz: n, values: dist };
      const base = POPUP.layerGap * 0.5;
      const loops = contoursFromGrid(grid, 0, undefined, clip);
      const sheet = loops.length ? this.layer(loops, base, LAND_TOP - base, x0, z0, top, this.edgeMaterial) : null;
      if (sheet) ground.add(sheet);
      // the streams' water on it (world/stream-mesh.ts)
      const ribbons = streamRibbons(streams, x0, z0, x1, z1, (x, z) => sampleAt(dist, x, z), (x, z) => land.biomeInland(x, z));
      if (ribbons) ground.add(ribbons);
      yield;
      this.group.add(ground);
      chunk.ground = ground;
    }

    // ---- 4. cards ----
    if (minD < 3) {
      const specs: CardSpec[] = [];
      const rng = mulberry32(hash2((77) ^ SEED, i, j));
      const heightAt = (x: number, z: number) => {
        return (sampleAt(dist, x, z) < 0 ? LAND_TOP : 0) + POPUP.layerGap * (1 + Math.floor(rng() * 4));
      };
      // every card faces the camera give or take yawJitter degrees (papertrails: 14)
      // (a land card never hangs over the water: both ends of its base, on every plane, stand on the land)
      const onLand = (sprite: string, x: number, z: number, height: number, yaw: number, cross: boolean) => {
        const info = spriteInfo(sprite);
        const half = (height * info.w) / info.h / 2;
        for (const a of cross ? CROSS_PLANES.map((p) => yaw + p) : [yaw]) {
          // (measured on the true shore distance, the one the ground, the feet and the checks all read)
          for (const k of [-1, 1]) if (sampleAt(shore, x + Math.cos(a) * half * k, z - Math.sin(a) * half * k) > -0.05) return false;
        }
        return true;
      };
      // (papertrails' path strips hold no standing piece: no card's blocking foot comes within PATH_ROOM of a road's
      // or a lane's edge, so the trodden ground is always walkable end to end)
      const onPath = (sprite: string, x: number, z: number, height: number) => {
        const reach = footReach(sprite, height);
        return reach > 0 && !!chunk.paths?.strips.some((st) => polylineDistance(st.pts, x, z)[0] < st.width / 2 + reach + PATH_ROOM);
      };
      // (a vignette, papertrails' animal tied to a piece: up on its seat, and it does not keep off the paths; tone:
      // papertrails' clump shading)
      const add = (sprite: string, x: number, z: number, height = heightOf(sprite, rng()), flip = rng() < 0.5, yawJitter = 14, card: Pick<CardSpec, 'vignette' | 'tone'> = {}) => {
        const { vignette, tone } = card;
        const cross = CROSSED.has(sprite);
        const yaw = (rng() - 0.5) * 2 * yawJitter * (cross ? CROSS_JITTER : 1) * DEG;
        if (!SEA_CARDS.has(sprite) && !onLand(sprite, x, z, height, yaw, cross)) return;
        if (!vignette && onPath(sprite, x, z, height)) return;
        // (papertrails' animals are not tinted with the tile)
        const biome = Critters.is(sprite) ? undefined : land.biomeInland(x, z);
        specs.push({ sprite, x, y: heightAt(x, z) + (vignette?.seat ?? 0), z, height, yaw, flip, delay: 0, cross, vignette, biome, tone });
      };
      const taken: Array<[number, number, number]> = [];
      const free = (x: number, z: number, r: number) => taken.every(([tx, tz, tr]) => (tx - x) ** 2 + (tz - z) ** 2 > (tr + r) ** 2);
      // buildings keep a wider ring clear of plants (a tree card right behind a house reads as growing from its roof)
      const yards: Array<[number, number, number]> = [];
      const inYard = (x: number, z: number) => yards.some(([tx, tz, tr]) => (tx - x) ** 2 + (tz - z) ** 2 < tr * tr);

      // whatever spans chunks and reaches this square keeps its ground clear; what stands in it is built further down
      const inBox = ([x, z]: Pt) => x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3];
      const own = (x: number, z: number) => x >= x0 && x < x1 && z >= z0 && z < z1;
      const claimLine = (pts: readonly Pt[], r: (k: number) => number) => {
        pts.forEach((p, k) => {
          if (inBox(p)) taken.push([p[0], p[1], r(k)]);
        });
      };
      for (const st of streams) claimLine(st.pts, (k) => Streams.widthAt(st, k) / 2 + 0.12);
      for (const road of roads) claimLine(road.pts, () => ROAD_WIDTH / 2 + 0.1);
      for (const l of layouts) {
        taken.push([l.site.x, l.site.z, l.site.kind === 'ruins' ? 0.3 : 1.0]);
        for (const b of l.buildings) {
          const info = modelInfo(b.name)!;
          const foot = Math.hypot(info.width, info.depth) * 0.5 + 0.12;
          taken.push([b.x, b.z, foot]);
          yards.push([b.x, b.z, foot + YARD]);
        }
        for (const p of [...l.props, ...l.piers]) taken.push([p.x, p.z, 0.4]);
        for (const lane of l.lanes) claimLine(lane, () => LANE_WIDTH / 2 + 0.06);
      }

      // big scenery on the high ground (coarse grid)
      for (let gz = z0 + 4.5; gz < z1; gz += 9) {
        for (let gx = x0 + 4.5; gx < x1; gx += 9) {
          const x = gx + (rng() - 0.5) * 5;
          const z = gz + (rng() - 0.5) * 5;
          const t = terraceAt(x, z);
          if (t < 2) continue;
          const hl = land.highland(x, z);
          // the heights are Blender-built card constructions like papertrails' dunes and rocks (curved dome cards in a
          // V, stone slabs in pairs), never a flat card with a mountain printed on it; they face the viewer like every
          // card (the camera's yaw is fixed), give or take a little
          const solid = (name: string) => {
            const info = modelInfo(name)!;
            const foot = Math.max(info.width, info.depth) * 0.5;
            // (mountains keep apart: a range of single ridges with ground between them, never a wall)
            if (!free(x, z, foot * 1.4)) return false;
            taken.push([x, z, foot]);
            this.addBuilding(chunk, name, x, heightAt(x, z), z, (rng() - 0.5) * 0.35);
            yards.push([x, z, foot + 0.3]);
            return true;
          };
          const b = land.biome(x, z);
          if (t === 3) {
            const roll = rng();
            if (hl > 0.78 && roll < 0.1) solid('ridge-volcano');
            else if (hl > 0.72) solid(roll < 0.5 ? 'ridge-snow' : 'ridge-snow-b');
            else if (b === 'pine' || b === 'jungle') solid(roll < 0.5 ? 'ridge-forest' : 'ridge-forest-b');
            else if (b === 'beach') solid('ridge-sand');
            else solid(roll < 0.5 ? 'ridge-rock' : 'ridge-rock-b');
            continue;
          }
          // hills: a low green dome, a rock outcrop of stone slabs or a waterfall (the trees are ground cover tiles)
          const roll = rng();
          if (b === 'meadow' && roll < 0.35 && solid('ridge-hill')) continue;
          if ((b === 'rocky' || b === 'beach') && roll < 0.4 && solid(b === 'beach' ? 'outcrop-sandstone' : 'outcrop-rock')) continue;
          if ((b === 'jungle' || b === 'pine') && roll < 0.12 && solid('outcrop-moss')) continue;
          if (rng() < 0.15 && free(x, z, 1)) {
            taken.push([x, z, 1]);
            add('waterfall', x, z, heightOf('waterfall', rng()), rng() < 0.5, 5);
          }
        }
      }
      yield;

      // the villages and ruins, bridges and springs that stand in this square
      for (const l of layouts) {
        if (!own(l.site.x, l.site.z)) continue;
        for (const b of l.buildings) this.addBuilding(chunk, b.name, b.x, heightAt(b.x, b.z), b.z, b.yaw);
        for (const p of l.props) add(p.name, p.x, p.z, p.height, p.flip, p.vignette ? 0 : 10, { vignette: p.vignette });
        for (const p of l.piers) {
          // standing on the beach at its shore end
          const dx = Math.sin(p.yaw);
          const dz = Math.cos(p.yaw);
          const back = modelInfo('pier')!.depth / 2 - 0.5;
          this.addDeck(chunk, 'pier', p.x, heightAt(p.x - dx * back, p.z - dz * back), p.z, dx, dz);
        }
      }
      for (const road of roads) for (const b of road.bridges) if (own(b.x, b.z)) this.addDeck(chunk, 'bridge', b.x, heightAt(b.x, b.z), b.z, b.dx, b.dz);
      for (const st of streams) {
        const [sx, sz] = st.pts[0];
        if (own(sx, sz)) {
          // the spring (papertrails' river_source): a stone mound card with the water's mouth at the stream's head,
          // three crags in a horseshoe behind it, reeds and a stone on the pool's bank
          const [ax, az] = st.pts[Math.min(3, st.pts.length - 1)];
          const l = Math.hypot(ax - sx, az - sz) || 1;
          const ux = (ax - sx) / l;
          const uz = (az - sz) / l;
          const at = (back: number, side: number): [number, number] => [sx - ux * back - uz * side, sz - uz * back + ux * side];
          add('spring', ...at(0.02, 0), undefined, false, 4);
          add('crag-0', ...at(0.22, -0.08));
          add('crag-1', ...at(-0.16, -0.56));
          add('crag-2', ...at(-0.1, 0.58));
          add(rng() < 0.5 ? 'cattails' : 'papyrus', ...at(-0.45, 0.42));
          if (rng() < 0.45) add('frog', ...at(-0.5, -0.4));
        }
        // the banks: reeds now and then, a duck afloat, a frog, a duck or a heron at the water's edge
        for (let k = 2; k < st.pts.length - 1; k++) {
          const [px, pz] = st.pts[k];
          if (!own(px, pz)) continue;
          const [qx, qz] = st.pts[k + 1];
          const l = Math.hypot(qx - px, qz - pz) || 1;
          const nx = -(qz - pz) / l;
          const nz = (qx - px) / l;
          const hw = Streams.widthAt(st, k) / 2;
          const side = rng() < 0.5 ? -1 : 1;
          if (k % REED_EVERY === 0) add(rng() < 0.6 ? 'cattails' : 'papyrus', px + nx * side * (hw + 0.14), pz + nz * side * (hw + 0.14));
          if (rng() < DUCK_CHANCE) add('duck-float', px + nx * (rng() - 0.5) * hw, pz + nz * (rng() - 0.5) * hw, undefined, rng() < 0.5, 25);
          else if (rng() < BANK_ANIMAL_CHANCE) add(['frog', 'duck', 'heron', 'duck'][Math.floor(rng() * 4)], px - nx * side * (hw + 0.22), pz - nz * side * (hw + 0.22));
        }
      }
      // papertrails' roadside props along the roads, a little off their edge
      for (const road of roads) {
        let run = rng() * ROADSIDE_STEP;
        for (let k = 1; k < road.pts.length; k++) {
          const [ax, az] = road.pts[k - 1];
          const [bx, bz] = road.pts[k];
          const l = Math.hypot(bx - ax, bz - az);
          run += l;
          if (run < ROADSIDE_STEP || l < 1e-6 || !own(bx, bz)) continue;
          run = 0;
          const side = rng() < 0.5 ? -1 : 1;
          const out = ROAD_WIDTH / 2 + ROADSIDE_OUT;
          const x = bx - ((bz - az) / l) * side * out;
          const z = bz + ((bx - ax) / l) * side * out;
          const sprite = ROADSIDE[Math.floor(rng() * ROADSIDE.length)];
          // (well up the beach, as the villages keep their props)
          if (free(x, z, 0.2) && sampleAt(dist, x, z) < -0.4) {
            add(sprite, x, z, heightOf(sprite, rng()), rng() < 0.5, 10);
            taken.push([x, z, 0.2]);
          }
        }
      }

      // a lighthouse on the shore now and then, a fort tower a little inland
      for (const [name, salt, chance, dMin, dMax] of [['lighthouse', 47, 0.05, -1.4, -0.75], ['fort', 53, 0.07, -2.8, -1.3]] as const) {
        if ((hash2((salt) ^ SEED, i, j) >>> 0) / 4294967296 >= chance) continue;
        const info = modelInfo(name)!;
        const foot = Math.hypot(info.width, info.depth) * 0.5 + 0.15;
        for (let a = 0; a < 40; a++) {
          const x = x0 + 1 + rng() * (CHUNK - 2);
          const z = z0 + 1 + rng() * (CHUNK - 2);
          const dd = sampleAt(dist, x, z);
          if (dd > dMax || dd < dMin || terraceAt(x, z) > 1 || !free(x, z, foot)) continue;
          taken.push([x, z, foot]);
          this.addBuilding(chunk, name, x, heightAt(x, z), z, (rng() - 0.5) * 0.6);
          yards.push([x, z, foot + YARD]);
          break;
        }
      }

      // a lookout tower on the heights now and then (papertrails' watchtower tile), and a camp: tents round a fire
      for (const [kind, salt, chance] of [['watchtower', 61, 0.1], ['camp', 67, 0.12]] as const) {
        if ((hash2(salt ^ SEED, i, j) >>> 0) / 4294967296 >= chance) continue;
        const room = kind === 'watchtower' ? 0.7 : 1.2;
        for (let a = 0; a < 40; a++) {
          const x = x0 + 1.5 + rng() * (CHUNK - 3);
          const z = z0 + 1.5 + rng() * (CHUNK - 3);
          const dd = sampleAt(dist, x, z);
          if (dd > -2.2 || !free(x, z, room) || inYard(x, z)) continue;
          taken.push([x, z, room]);
          yards.push([x, z, room + 0.4]);
          if (kind === 'watchtower') {
            const tower = heightOf('watchtower', rng());
            add('watchtower', x, z, tower, rng() < 0.5, 0);
            // papertrails' watchtower tile: an owl perched at the top of the tower (0.85 of them)
            if (rng() < OWL_CHANCE) add('owl', x, z + 0.02, undefined, rng() < 0.5, 0, { vignette: { seat: tower * spriteTop('watchtower', 0.5) * TOP_K } });
            add('woodpile', x + 0.55, z + 0.35);
          } else {
            add(rng() < 0.5 ? 'tent' : 'tent-striped', x - 0.45, z - 0.25);
            add('campfire', x + 0.2, z + 0.25);
            add('log', x + 0.6, z + 0.05);
            if (rng() < 0.6) add('tent-striped', x + 0.55, z - 0.45);
          }
          break;
        }
      }

      // signature landmarks of stamped islands whose centre lies in this chunk
      for (const s of land.islandsNear((x0 + x1) / 2, (z0 + z1) / 2, CHUNK)) {
        if (s.x < x0 || s.x >= x1 || s.z < z0 || s.z >= z1) continue;
        this.landmark(s, add, sampleAt, dist, taken, free, rng, (name, x, z) => {
          this.addBuilding(chunk, name, x, heightAt(x, z), z, (rng() - 0.5) * 0.8);
          yards.push([x, z, 1.2]);
        });
      }
      yield;

      // ground cover by 2 x 2 tiles (world/cover.ts) and the life of the shallows
      const env: CoverEnv = {
        distance: (x, z) => sampleAt(dist, x, z),
        biome: (x, z, d) => land.biome(x, z, d),
        blocked: (x, z, r) => !free(x, z, r) || inYard(x, z),
        claim: (x, z, r) => taken.push([x, z, r]),
        place: (sprite, x, z, height, card) => add(sprite, x, z, height, undefined, undefined, card),
        rng,
      };
      plantShallows(env, x0, z0, CHUNK);
      plantCover(env, x0, z0, CHUNK);

      // a treasure chest on a beach, sometimes
      if ((hash2((47) ^ SEED, i, j) >>> 0) / 4294967296 < 0.2) {
        for (let a = 0; a < 40; a++) {
          const x = x0 + rng() * CHUNK;
          const z = z0 + rng() * CHUNK;
          const d = sampleAt(dist, x, z);
          if (d > -0.3 || d < -0.9 || !free(x, z, 0.4)) continue;
          const before = specs.length;
          add('chest', x, z, heightOf('chest', rng()), rng() < 0.5, 12);
          if (specs.length === before) continue;
          const card = this.cards.add([specs.pop()!])[0];
          chunk.cards.push(card);
          const chest: Chest = { id: hash2((53) ^ SEED, i, j), card, name: this.coastName(x, z) };
          chunk.chests.push(chest);
          this.chests.set(chest.id, chest);
          break;
        }
      }
      chunk.cards.push(...this.cards.add(specs));
      // papertrails' contact patch under every standing piece of the chunk (the ground cover and the animals as well)
      if (chunk.data) addContact(chunk.data, x0, z0, chunk.cards.map((c) => [c.x, c.z, (c.height * spriteInfo(c.sprite).w) / spriteInfo(c.sprite).h]));
    }
  }

  /** A fitting name for a coast (used by treasure messages). */
  private coastName(x: number, z: number): string {
    const kinds = ['tropical', 'jungle', 'rocky', 'village', 'ruins'] as const;
    const h = hash2((59) ^ SEED, Math.floor(x / 40), Math.floor(z / 40));
    return islandName(kinds[h % kinds.length], h);
  }

  private landmark(
    s: IslandSpec,
    add: (sprite: string, x: number, z: number, height: number, flip?: boolean, yawJitter?: number) => void,
    sampleAt: (a: Float32Array, x: number, z: number) => number,
    dist: Float32Array,
    taken: Array<[number, number, number]>,
    free: (x: number, z: number, r: number) => boolean,
    rng: () => number,
    place: (name: string, x: number, z: number) => void,
  ): void {
    const sig: Partial<Record<IslandSpec['kind'], Array<[string, number]>>> = {
      skull: [['skull-rock', 1.55], ['flag-pole', 1.05]],
      rocky: [['lighthouse', 2.1]],
      volcano: [['ridge-volcano', 2.8]],
      ruins: [['ruin-arch', 1.25], ['pillars', 1.1]],
      village: [['tavern', 1.3], ['cottage', 1.1]],
      jungle: [['waterfall', 1.4]],
    };
    for (const [sprite, h] of sig[s.kind] ?? []) {
      for (let a = 0; a < 30; a++) {
        const x = s.x + (rng() - 0.5) * s.shape.extent;
        const z = s.z + (rng() - 0.5) * s.shape.extent - 0.5;
        if (sampleAt(dist, x, z) > -Math.max(0.6, h * 0.35) || !free(x, z, h * 0.5)) continue;
        taken.push([x, z, h * 0.5]);
        if (modelInfo(sprite)) place(sprite, x, z);
        else add(sprite, x, z, h, rng() < 0.5, 5);
        break;
      }
    }
  }

  /** One extruded paper layer: printed top (UVs into the chunk's ground print), coloured cut edge. */
  private layer(loops: Pt[][], base: number, depth: number, x0: number, z0: number, top: THREE.Material, edge: THREE.Material): THREE.Mesh | null {
    const shapes: THREE.Shape[] = [];
    // (a point repeated along a loop would extrude a wall of no width, with no normal: its light came out NaN)
    const toV = (loop: Pt[]) =>
      loop
        .filter(([x, z], k) => {
          const [px, pz] = loop[(k + loop.length - 1) % loop.length];
          return Math.hypot(x - px, z - pz) > 1e-5;
        })
        .map(([x, z]) => new THREE.Vector2(x, -z));
    for (const { outer, holes } of outlinesWithHoles(loops)) {
      const shape = new THREE.Shape(toV(outer));
      for (const h of holes) shape.holes.push(new THREE.Path(toV(h)));
      shapes.push(shape);
    }
    if (!shapes.length) return null;
    const uvGen = {
      generateTopUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number): THREE.Vector2[] {
        // shape x = world x, shape y = -world z; the print's v runs from south (0) to north (1)
        return [a, b, c].map((k) => new THREE.Vector2((v[k * 3] - x0) / CHUNK, (v[k * 3 + 1] + z0 + CHUNK) / CHUNK));
      },
      generateSideWallUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number, d: number): THREE.Vector2[] {
        return edgeWallUV(v, depth, [a, b, c, d]);
      },
    };
    const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 1, UVGenerator: uvGen });
    g.rotateX(-Math.PI / 2);
    g.translate(0, base, 0);
    const mesh = new THREE.Mesh(g, [top, edge]);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }
}
