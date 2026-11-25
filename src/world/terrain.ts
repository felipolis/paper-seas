/**
 * Streams the land in square chunks around the ship. A chunk is built in small steps over several frames (a
 * generator), so sailing never stutters:
 *
 *   1. sample the land field and the terrace thresholds on a grid aligned to the world
 *   2. print the ground texture pixel by pixel from those grids (sand, wet sand, biome-tinted grass, hills, rock): every
 *      term is a function of world position, so chunks meet without seams
 *   3. extrude the land into one paper sheet, clipped to the chunk square
 *   4. place the standing cards: vegetation by biome, big scenery on the high ground, villages on the coast,
 *      ruins, signature landmarks of the stamped islands, chests on beaches, animals, sea arches in the shallows
 */
import * as THREE from 'three';
import { POPUP } from '../config/popup';
import { bus } from '../core/events';
import { DEG, clamp, hexRgb, smoothstep } from '../core/math';
import { hash2, mulberry32 } from '../core/rng';
import { mirrorSkip } from '../render/reflection';
import { toTexture } from '../art/card-painter';
import { cardWidth, spriteSpan, spriteTop } from '../art/sprites';
import { BAND_HI, BAND_LO, HULL_MAX, hullSegments, placeSegments, type Segment } from './blockers';
import { cellCentre, cellGesture, cellJitter, type Reveal } from './reveal';
import { contoursFromGrid, outlinesWithHoles, type Grid } from './contours';
import { LAND_TOP, type LandField } from './land';
import { valueNoise } from './noise';
import { plantCover, plantShallows, type CoverEnv } from './cover';
import { addContact, edgeWallUV, groundData, groundMaterial, landEdgeMaterial, pathTones, type Footprint } from './ground-shader';
import { streamRibbons } from './stream-mesh';
import type { Chimney } from '../life/smoke';
import { ROAD_WIDTH, junctionsOf, onRoad } from './roads';
import { Streams } from './streams';
import type { Places } from './places';
import { STREET_WIDTH } from './sites';
import { polylineDistance, type Box, type Pt } from './polyline';
import { CROSSED, heightOf } from '../config/flora';
import { CROSS_PLANES, type Card, type CardField, type CardSpec } from './card-field';
import { islandName } from './island-names';
import { buildModel, modelFoot, modelInfo, type Building, type ModelInfo } from './models';
import type { IslandSpec } from './island-layout';
import { WORLD } from '../config/world';
import { Critters } from './critters';
import { applyTint, groundTint, pathTone, type TintRows } from '../render/biome-tint';
import { cellKey } from '../core/grid';
import { ClearanceField, REACH } from './clearance';

/** World hashes are salted with the voyage seed: every voyage places its own villages, ruins, chests... */
/** The chest roll's own salt (each roll its own: one shared with the lighthouse's put a chest by every lighthouse). */
const CHEST_SALT = 97;
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
 * A ground colour (sRGB bytes r, g, b) under the biome tints of the four grid nodes round (u, v) (0..1 across the
 * chunk), mixed by smooth weights (null nodes are the identity), written to `out` as sRGB bytes; `one` is scratch.
 * (It runs for every tinted pixel of a chunk's print.)
 */
function tintAt(tints: Array<TintRows | null>, u: number, v: number, r: number, g: number, b: number, out: Rgb, one: Rgb): void {
  const fx = clamp(u * TINT_GRID, 0, TINT_GRID - 1e-3);
  const fz = clamp(v * TINT_GRID, 0, TINT_GRID - 1e-3);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const a = smoothstep(0, 1, fx - i);
  const c = smoothstep(0, 1, fz - j);
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const row = TINT_GRID + 1;
  out[0] = out[1] = out[2] = 0;
  addTinted(tints[j * row + i], (1 - a) * (1 - c), lr, lg, lb, out, one);
  addTinted(tints[j * row + i + 1], a * (1 - c), lr, lg, lb, out, one);
  addTinted(tints[(j + 1) * row + i], (1 - a) * c, lr, lg, lb, out, one);
  addTinted(tints[(j + 1) * row + i + 1], a * c, lr, lg, lb, out, one);
  out[0] = toByte(out[0]);
  out[1] = toByte(out[1]);
  out[2] = toByte(out[2]);
}

type Rgb = [number, number, number];

/** Adds w of the linear colour (lr, lg, lb) under a node's tint (none: as it is) to `out`. */
function addTinted(t: TintRows | null, w: number, lr: number, lg: number, lb: number, out: Rgb, one: Rgb): void {
  one[0] = lr;
  one[1] = lg;
  one[2] = lb;
  if (t) applyTint(t, one);
  out[0] += one[0] * w;
  out[1] += one[1] * w;
  out[2] += one[2] * w;
}
const LOAD_RADIUS = 36;
const UNLOAD_RADIUS = 46;
const FRAME_BUDGET_MS = 4;
/** Grid layout shared by every chunk (origin = chunk corner - one cell). */
const GRID_N = Math.round(CHUNK / CELL) + 2;
const GRID_W = GRID_N + 1;

/** Bilinear read at (x, z) of a chunk's sampled grid a, whose first node lies at (gx0, gz0) (clamped to the grid). */
function gridSample(a: Float32Array, gx0: number, gz0: number, x: number, z: number): number {
  const fx = clamp((x - gx0) / CELL, 0, GRID_N - 1e-3);
  const fz = clamp((z - gz0) / CELL, 0, GRID_N - 1e-3);
  const ii = Math.floor(fx);
  const jj = Math.floor(fz);
  const u = fx - ii;
  const v = fz - jj;
  const k = jj * GRID_W + ii;
  return a[k] * (1 - u) * (1 - v) + a[k + 1] * u * (1 - v) + a[k + GRID_W] * (1 - u) * v + a[k + GRID_W + 1] * u * v;
}


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
  /** Bumped when one of its pieces stops blocking (a chest taken): its walk field is made again. */
  revision: number;
}

interface Paths {
  strips: Array<{ pts: Pt[]; width: number }>;
  squares: Array<[number, number, number]>;
}

/**
 * A walkable deck: centred at (x, z), running along the unit (dx, dz) (a pier: out to sea), half its length and
 * width; its height is y at the ends plus top(along) (a bridge's ramps and crown; a pier is level).
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
  top: (along: number) => number;
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

/** papertrails' crossed cards turn only this share of the camera-facing cards' jitter (world.js cardJ). */
const CROSS_JITTER = 0.6;

/** A chunk's walk field (world/clearance.ts): what it was made from (its piece count and revision), the pieces, how far they reach. */
interface FieldEntry {
  count: number;
  revision: number;
  pieces: Segment[][];
  box: Box | null;
  field: ClearanceField | null;
}

/** How near a wall's corners must lie to a side of its chunk's square to be a seam wall. */
const SEAM_EPS = 1e-4;

/**
 * Leaves out the cut-edge walls a layer's outline has where it was cut back onto its chunk's square (world/contours.ts
 * clip): the land runs on into the next chunk there, so they are no shore, only walls back to back with the next
 * chunk's; the mirror, which leaves the land's tops out (render/reflection.ts), showed them as straight cream lines
 * across the streams. The extruded layer has no index; its kept triangles become one, its groups (caps 0, walls 1, per
 * shape) re-counted over it.
 */
function withoutSeamWalls(g: THREE.BufferGeometry, [x0, z0, x1, z1]: Box): void {
  const pos = g.getAttribute('position');
  // (the square's sides: x = x0, x = x1, z = z0, z = z1)
  const sides = [x0, x1, z0, z1];
  const on = (k: number, side: number) => Math.abs((side < 2 ? pos.getX(k) : pos.getZ(k)) - sides[side]) < SEAM_EPS;
  const seam = (k: number) => sides.some((_, side) => on(k, side) && on(k + 1, side) && on(k + 2, side));
  const index: number[] = [];
  const groups = g.groups.map((gr) => ({ ...gr }));
  g.clearGroups();
  for (const gr of groups) {
    const start = index.length;
    for (let k = gr.start; k < gr.start + gr.count; k += 3) if (gr.materialIndex !== 1 || !seam(k)) index.push(k, k + 1, k + 2);
    if (index.length > start) g.addGroup(start, index.length - start, gr.materialIndex);
  }
  g.setIndex(index);
}

/** The square of land a chunk answers for. */
function chunkSquare(c: Chunk): Box {
  return [c.i * CHUNK, c.j * CHUNK, (c.i + 1) * CHUNK, (c.j + 1) * CHUNK];
}

/** The bounds of every piece's segments, grown by pad, or null when there are none. */
function piecesBox(pieces: Segment[][], pad: number): Box | null {
  let box: Box | null = null;
  for (const piece of pieces) {
    for (const [ax, az, bx, bz] of piece) {
      box ??= [Infinity, Infinity, -Infinity, -Infinity];
      box[0] = Math.min(box[0], ax - pad, bx - pad);
      box[1] = Math.min(box[1], az - pad, bz - pad);
      box[2] = Math.max(box[2], ax + pad, bx + pad);
      box[3] = Math.max(box[3], az + pad, bz + pad);
    }
  }
  return box;
}

/** Width of the lanes from a village square to its doors, and the square's radius (papertrails' road: 0.5). */
const LANE_WIDTH = 0.36;
const SQUARE_RADIUS = 0.95;

/** What is built without a contact patch: a mountain is ground itself, a pier or a bridge stands over the water. */
const BARE = /^(ridge-|outcrop-|pier$|bridge$)/;

/** Clear ground kept round a building (beyond its own footprint): the ground cover grows close to the walls. */
const YARD = 0.35;

/** Cards that stand in the shallows on purpose. */
const SEA_CARDS = new Set(['flamingo', 'sea-arch', 'rock-spire', 'duck-float']);
/** papertrails' watchtower vignette: an owl at this share of the top of the tower, on this share of the towers, by night. */
const TOP_K = 0.95;
const OWL_CHANCE = 0.85;
/**
 * papertrails' roadside props: every path tile carries one (a guidepost, a bench, a cart, barrels; its signposts stand
 * where the roads meet: SIGN_OUT).
 */
const ROADSIDE = ['guidepost', 'bench', 'handcart', 'lantern-post', 'barrel'];
/** A junction's signpost stands in the wedge between two of its roads, this far out from where they meet. */
const SIGN_OUT = [0.75, 0.95, 1.2];
/** A handcart by the road keeps a bale of hay beside it this often. */
const CART_HAY = 0.5;
/** One roadside prop every this many units of road, standing this far out from its edge. */
const ROADSIDE_STEP = 3.2;
const ROADSIDE_OUT = 0.32;
/** Reeds stand along a stream's banks every this many points (papertrails' river tiles: 1 to 5 reeds). */
const REED_EVERY = 4;
/** papertrails' ducks: on a river tile 0.4 chance of one or two floating; a frog on the bank 0.45 at a spring. */
const DUCK_CHANCE = 0.12;
const BANK_ANIMAL_CHANCE = 0.08;

/**
 * papertrails' rear copies (tiles.glb: tuft_a_rear, reeds_a_rear and the like, measured): behind a lone tuft of grass or
 * a reed bed stands a copy of it, 0.75 of its tone and 1.08 of its size, 0.1-0.16 further from the camera and a little
 * to one side, so a tuft reads as a thick clump rather than one card.
 */
const DOUBLED = /^(grass-|tuft-flowers$|cattails$|papyrus$)/;
const REAR = { tone: 0.75, scale: 1.08, back: [0.1, 0.16], side: [0.05, 0.18] } as const;

/** Ground cover and animals: the feet go through (or past) them. */
const SOFT = /^(grass|fern|bush|flower|tuft|hibiscus|orchids|bird-of-paradise|cattails|papyrus|mushrooms|shells|pebbles|monkey|parrot|toucan|crab|iguana|pelican|flamingo|duck|hen|chick|goat|pig|cat|dog|frog|rabbit|owl|hummingbird|tortoise|boar|gecko|heron)/;
/** A river's footbridge gives way to a road's bridge this near; the way on and off it is kept clear this far past its ends. */
const BRIDGE_ROAD = 4;
const BRIDGE_CLEAR = 1.2;
/** The ground round each end of a river (its pool, mound and crags) is kept clear this far. */
const SOURCE_CLEAR = 1;
/** Room kept between a path's edge and the blocking foot of any card (u). */
const PATH_ROOM = 0.12;

/**
 * A deck's height above its ends at `along` from its middle: the skill's bridge profile (a ramp from each bank over
 * its share of the half span, then the crown to the middle), or level.
 */
function deckTop(info: ModelInfo): (along: number) => number {
  const p = info.profile;
  if (!p) return () => 0;
  const half = info.depth / 2;
  const z1 = half * (1 - p.share);
  const h1 = (half - z1) * Math.tan(p.ramp);
  return (along) => {
    const u = Math.abs(along);
    return u >= half ? 0 : u >= z1 ? (half - u) * Math.tan(p.ramp) : h1 + (z1 - u) * Math.tan(p.crown);
  };
}

/** The part of a card's width (0..1 across its face) that stops the feet: its print in the blocking height band. */
function blockingSpan(sprite: string, height: number): [number, number] | null {
  return SOFT.test(sprite) ? null : spriteSpan(sprite, BAND_LO / height, BAND_HI / height);
}

/** How far a card's blocking foot reaches from its centre (0 if nothing of it blocks). */
function footReach(sprite: string, height: number): number {
  const span = blockingSpan(sprite, height);
  if (!span) return 0;
  return Math.max(0.5 - span[0], span[1] - 0.5) * cardWidth(sprite, height);
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

  /** Each chunk's walk field (world/clearance.ts): its pieces, how far they reach, and the field once asked for. */
  private readonly fields = new Map<number, FieldEntry>();

  constructor(private readonly land: LandField, private readonly cards: CardField, private readonly places: Places) {}

  /** True on a road, a lane or a village square (trodden ground). */
  onPath(x: number, z: number): boolean {
    const p = this.chunks.get(cellKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)))?.paths;
    if (!p) return false;
    return p.squares.some(([sx, sz, r]) => Math.hypot(x - sx, z - sz) < r) || p.strips.some((st) => polylineDistance(st.pts, x, z)[0] < st.width / 2);
  }

  /**
   * Shore distance exactly as the ground was drawn: bilinear on the chunk's sampled grid (so you collide with what
   * you see, never with a sliver of land too thin to print); the analytic field where no chunk is sampled yet.
   */
  distanceAt(x: number, z: number): number {
    const i = Math.floor(x / CHUNK);
    const j = Math.floor(z / CHUNK);
    const c = this.chunks.get(cellKey(i, j));
    if (!c || !c.dist) return this.land.distance(x, z);
    return gridSample(c.dist, i * CHUNK - CELL, j * CHUNK - CELL, x, z);
  }

  /** Chests currently loaded. */
  chestList(): IterableIterator<Chest> {
    return this.chests.values();
  }

  /** A chest found: taken away for good (its card hidden, its chunk's walk field made again without it). */
  takeChest(chest: Chest): void {
    this.cards.hide(chest.card);
    const c = this.chunks.get(cellKey(Math.floor(chest.card.x / CHUNK), Math.floor(chest.card.z / CHUNK)));
    if (c) c.revision++;
  }

  /** Builds every chunk around a point right away (start of the voyage). */
  prime(x: number, z: number): void {
    for (const [i, j] of this.wanted(x, z)) {
      const key = cellKey(i, j);
      if (this.chunks.has(key)) continue;
      const it = this.build(i, j);
      while (!it.next().done) { /* run to completion */ }
    }
  }

  /**
   * How much room there is round (x, z), as drawn (papertrails' walk field): the distance (REACH at most) to whatever
   * stops the feet, the print of every card between the blocking heights (a trunk, the foot of a rock, a crate; the soft
   * ground cover and the animals never block) and the footprint of every building but the piers (walked on). As in
   * papertrails, a piece blocks standing or lying folded: round the feet the land always stands.
   */
  roomAt(x: number, z: number): number {
    let room = REACH;
    const i = Math.floor(x / CHUNK);
    const j = Math.floor(z / CHUNK);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const f = this.fieldOf(cellKey(i + di, j + dj), x, z);
        if (f) room = Math.min(room, f.distance(x, z));
      }
    }
    return room;
  }

  /**
   * The walk field of a chunk, if its pieces reach (x, z). A chunk makes it at the end of its build (makeField); asked
   * before that, or once the chunk holds other pieces than it was made from, it is made at once.
   */
  private fieldOf(key: number, x: number, z: number): ClearanceField | null {
    const c = this.chunks.get(key);
    if (!c) return null;
    let e = this.fields.get(key);
    if (!e || e.count !== c.cards.length + c.houses.length || e.revision !== c.revision) {
      e = this.fieldEntry(c);
      this.fields.set(key, e);
    }
    if (!e.box || x < e.box[0] || x > e.box[2] || z < e.box[1] || z > e.box[3]) return null;
    e.field ??= ClearanceField.now(chunkSquare(c), e.pieces);
    return e.field;
  }

  /** Makes a chunk's walk field, a slice per yield (the last step of its build). */
  private *makeField(c: Chunk): Generator<void> {
    const e = this.fieldEntry(c);
    if (e.box) e.field = yield* ClearanceField.make(chunkSquare(c), e.pieces);
    this.fields.set(c.key, e);
  }

  /** A chunk's pieces and how far they reach, its field not made yet. */
  private fieldEntry(c: Chunk): FieldEntry {
    const pieces = this.pieces(c);
    return { count: c.cards.length + c.houses.length, revision: c.revision, pieces, box: piecesBox(pieces, REACH), field: null };
  }

  /** The blocking segments of each piece of a chunk (see roomAt). */
  private pieces(c: Chunk): Segment[][] {
    const pieces: Segment[][] = [];
    for (const card of c.cards) {
      if (card.hidden) continue;
      const span = blockingSpan(card.sprite, card.height);
      if (!span) continue;
      const w = cardWidth(card.sprite, card.height);
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
      if (h.name === 'pier') continue;
      const foot: Segment[] = [];
      placeSegments(h.foot, h.x, h.z, h.yaw, foot);
      pieces.push(foot);
    }
    return pieces;
  }

  private clock = 0;
  private readonly flips = new WeakMap<Building, number>();
  /** How long each still-flat building has waited for the traveller to cross its cell. */
  private readonly held = new WeakMap<Building, number>();

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
        return p.y + p.top(along);
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

  /**
   * Push-out for a circle of radius r at (x, z) against the standing piers (the ship moors alongside one, never sails
   * through it): each pier is its deck's rectangle; the circle is pushed off its nearest side. Null when clear.
   */
  pierPush(x: number, z: number, r: number): { dx: number; dz: number; nx: number; nz: number } | null {
    for (const c of this.chunks.values()) {
      for (const p of c.decks) {
        if (p.kind !== 'pier' || p.building.fold.progress < 0.5 || Math.hypot(p.x - x, p.z - z) > r + p.half + p.halfW) continue;
        // in the pier's frame: u along it, v across it
        const ox = x - p.x;
        const oz = z - p.z;
        const u = ox * p.dx + oz * p.dz;
        const v = ox * p.dz - oz * p.dx;
        const cu = Math.max(-p.half, Math.min(p.half, u));
        const cv = Math.max(-p.halfW, Math.min(p.halfW, v));
        let du = u - cu;
        let dv = v - cv;
        let dist = Math.hypot(du, dv);
        if (dist >= r) continue;
        if (dist < 1e-6) {
          // the centre is on the deck: out by the nearest side
          const outU = p.half - Math.abs(u);
          const outV = p.halfW - Math.abs(v);
          if (outV < outU) [du, dv, dist] = [0, Math.sign(v) || 1, -outV];
          else [du, dv, dist] = [Math.sign(u) || 1, 0, -outU];
        }
        const l = Math.hypot(du, dv) || 1;
        const nu = du / l;
        const nv = dv / l;
        const nx = nu * p.dx + nv * p.dz;
        const nz = nu * p.dz - nv * p.dx;
        const depth = r - dist;
        return { dx: nx * depth, dz: nz * depth, nx, nz };
      }
    }
    return null;
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
    chunk.decks.push({ kind, x, z, dx, dz, half: info.depth / 2, halfW: info.width / 2 + 0.02, y: y + info.deck, top: deckTop(info), building });
  }

  /** Unfolds / folds the assembled buildings with the same reach as the cards. */
  updateHouses(dt: number, reveal: Reveal): void {
    this.clock += dt;
    for (const c of this.chunks.values()) {
      for (const h of c.houses) {
        // the same rules as the cards of the cell it stands in (papertrails' tiles, a house and all): it waits while
        // the traveller crosses the cell, takes one of the frame's rise slots, and a rise still waiting is called off
        // once the cell is no longer wanted
        const cx = cellCentre(h.x);
        const cz = cellCentre(h.z);
        const fold = h.fold;
        if (fold.risePending && !reveal.wanted(cx, cz)) {
          fold.cancelRise();
          bus.emit('paperCancel', { key: cellGesture(h.x, h.z) });
        }
        else if (fold.target !== 1 && reveal.mayFlip(cx, cz, this.flips.get(h) ?? -99, this.clock) && reveal.wantsUp(cx, cz)) {
          const held = this.held.get(h) ?? 0;
          if (reveal.holds(cx, cz, held)) this.held.set(h, held + dt);
          else if (reveal.claimRise(cx, cz)) this.flip(h, 1, reveal.riseDelay(cx, cz, cellJitter(h.x, h.z)));
        } else {
          this.held.delete(h);
          if (fold.target !== 0 && reveal.mayFlip(cx, cz, this.flips.get(h) ?? -99, this.clock) && reveal.wantsDown(cx, cz)) {
            this.flip(h, 0, reveal.foldDelay(cx, cz, cellJitter(h.x, h.z)));
          }
        }
        fold.update(dt);
        // folded, a building lies flat on the page (its walls and roof stacked flat): drawn within sight
        h.root.visible = reveal.distance(h.x, h.z) < reveal.radius + 30;
      }
    }
  }

  /** Sets a building rising (1) or folding (0) after `delay` s, and voices it in its cell's gesture. */
  private flip(h: Building, target: 0 | 1, delay: number): void {
    h.fold.setTarget(target, delay);
    this.flips.set(h, this.clock);
    this.held.delete(h);
    // (one gesture with the cards of its cell: the largest piece speaks)
    bus.emit('paper', { x: h.x, z: h.z, height: modelInfo(h.name)!.height, up: target === 1, delay, key: cellGesture(h.x, h.z) });
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
        const next = this.wanted(shipX, shipZ).find(([i, j]) => !this.chunks.has(cellKey(i, j)));
        if (!next) return;
        this.job = { key: cellKey(next[0], next[1]), it: this.build(next[0], next[1]) };
      }
      if (this.job.it.next().done) this.job = null;
    }
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
    this.fields.delete(key);
    if (this.job && this.job.key === key) this.job = null;
  }

  /** Builds one chunk, yielding between the expensive steps. */
  private *build(i: number, j: number): Generator<void> {
    const key = cellKey(i, j);
    const chunk: Chunk = { key, i, j, ground: null, cards: [], chests: [], texture: null, data: null, pathTone: null, material: null, dist: null, houses: [], decks: [], paths: null, revision: 0 };
    this.chunks.set(key, chunk);
    const land = this.land;
    const x0 = i * CHUNK;
    const z0 = j * CHUNK;
    const x1 = x0 + CHUNK;
    const z1 = z0 + CHUNK;

    // ---- 1. grids: shore distance + terrace fields (d + threshold < 0 inside a terrace) ----
    const gx0 = x0 - CELL;
    const gz0 = z0 - CELL;
    const n = GRID_N;
    const W = GRID_W;
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
    const sampleAt = (a: Float32Array, x: number, z: number): number => gridSample(a, gx0, gz0, x, z);
    const terraceAt = (x: number, z: number): number => {
      if (sampleAt(dist, x, z) >= 0) return -1;
      for (let t = 2; t >= 0; t--) if (sampleAt(terr[t], x, z) < 0) return t + 1;
      return 0;
    };

    const hasLand = minD < 0;
    // what spans chunks and reaches this square (world/places.ts): streams, roads with their bridges, villages, ruins
    const box: Box = [x0 - 1, z0 - 1, x1 + 1, z1 + 1];
    const streams = minD < 3 ? this.places.streams.near(box) : [];
    const shore = (chunk.dist = trueDistance(dist, GRID_W, CELL));
    const roads = minD < 3 ? this.places.roadsNear(box) : [];
    // the rivers' footbridges (where no road bridges the river close by)
    const footbridges = streams.flatMap((st) => st.bridges).filter((b) => !roads.some((r) => r.bridges.some((rb) => Math.hypot(rb.x - b.x, rb.z - b.z) < BRIDGE_ROAD)));
    // (along a footbridge, from past one end to past the other)
    const bridgeReach = modelInfo('bridge')!.depth / 2 + BRIDGE_CLEAR;
    const nearBridge = (x: number, z: number) => footbridges.some((b) => Math.hypot(b.x - x, b.z - z) < bridgeReach);
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
      const lin: Rgb = [0, 0, 0];
      const one: Rgb = [0, 0, 0];
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
          if (tinted && t1 < 0) {
            tintAt(tints, (x - x0) / CHUNK, (z - z0) / CHUNK, r, g, b, lin, one);
            r = lin[0];
            g = lin[1];
            b = lin[2];
          }
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
        strips: [...roads.map((r) => ({ pts: r.pts, width: ROAD_WIDTH })), ...layouts.flatMap((l) => [...l.lanes.map((pts) => ({ pts, width: LANE_WIDTH })), ...(l.street ? [{ pts: l.street, width: STREET_WIDTH }] : [])])],
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
      const loops = contoursFromGrid(grid, clip);
      const sheet = loops.length ? this.layer(loops, base, LAND_TOP - base, x0, z0, top, this.edgeMaterial) : null;
      if (sheet) ground.add(sheet);
      // the streams' water on it (world/stream-mesh.ts)
      const ribbons = streamRibbons(streams, x0, z0, x1, z1, (x, z) => land.biomeInland(x, z));
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
      // the true shore distance, the one the ground, the feet and the checks all read: this chunk's own grid, and past
      // its edge the neighbouring chunk's (a village or a landmark may reach beyond the chunk that builds it)
      const inGrid = (x: number, z: number) => x >= gx0 && x <= gx0 + n * CELL && z >= gz0 && z <= gz0 + n * CELL;
      const shoreAt = (x: number, z: number) => (inGrid(x, z) ? sampleAt(shore, x, z) : this.distanceAt(x, z));
      const onLand = (sprite: string, x: number, z: number, height: number, yaw: number, cross: boolean) => {
        const half = cardWidth(sprite, height) / 2;
        for (const a of cross ? CROSS_PLANES.map((p) => yaw + p) : [yaw]) {
          for (const k of [-1, 1]) if (shoreAt(x + Math.cos(a) * half * k, z - Math.sin(a) * half * k) > -0.05) return false;
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
      // papertrails' clump shading; awake: an animal about by day or by night only)
      const stand = (sprite: string, x: number, z: number, height: number, flip: boolean, yawJitter: number, card: Pick<CardSpec, 'vignette' | 'tone' | 'awake'>): boolean => {
        const { vignette, tone, awake } = card;
        const cross = CROSSED.has(sprite);
        const yaw = (rng() - 0.5) * 2 * yawJitter * (cross ? CROSS_JITTER : 1) * DEG;
        if (!SEA_CARDS.has(sprite) && !onLand(sprite, x, z, height, yaw, cross)) return false;
        if (!vignette && onPath(sprite, x, z, height)) return false;
        // (papertrails' animals are not tinted with the tile)
        const biome = Critters.is(sprite) ? undefined : land.biomeInland(x, z);
        specs.push({ sprite, x, y: heightAt(x, z) + (vignette?.seat ?? 0), z, height, yaw, flip, delay: 0, cross, vignette, biome, tone, awake });
        return true;
      };
      // (a tuft of grass or a reed bed stands with its darker rear copy behind it: papertrails' *_rear cards)
      const add = (sprite: string, x: number, z: number, height = heightOf(sprite, rng()), flip = rng() < 0.5, yawJitter = 14, card: Pick<CardSpec, 'vignette' | 'tone' | 'awake'> = {}) => {
        // (only a lone one: a card of a clump has the clump's own cards behind it)
        if (!stand(sprite, x, z, height, flip, yawJitter, card) || !DOUBLED.test(sprite) || card.tone !== undefined) return;
        const side = rng() < 0.5 ? -1 : 1;
        const rx = x + side * (REAR.side[0] + rng() * (REAR.side[1] - REAR.side[0]));
        const rz = z - (REAR.back[0] + rng() * (REAR.back[1] - REAR.back[0]));
        stand(sprite, rx, rz, height * REAR.scale, flip, yawJitter, { tone: REAR.tone });
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
      for (const st of streams) claimLine(st.pts, (k) => Streams.widthAt(k) / 2 + 0.12);
      // (a river's ends, and the way on and off a footbridge)
      for (const st of streams) claimLine([st.pts[0], st.pts[st.pts.length - 1]], () => SOURCE_CLEAR);
      for (const b of footbridges) {
        const n = Math.ceil(bridgeReach / 0.35);
        claimLine(Array.from({ length: 2 * n + 1 }, (_, k): Pt => [b.x + b.dx * bridgeReach * (k / n - 1), b.z + b.dz * bridgeReach * (k / n - 1)]), () => 0.45);
      }
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
        // (and whatever ground the layout holds besides: a scene's, a pen's)
        taken.push(...l.claims);
        for (const lane of l.lanes) claimLine(lane, () => LANE_WIDTH / 2 + 0.06);
        if (l.street) claimLine(l.street, () => STREET_WIDTH / 2 + 0.06);
      }

      // A model stands only where every wall of its base is on the ground as drawn (the layouts chose their spots by the
      // land's approximate shore distance), so no building or height ever stands in the sea
      const footOnLand = (name: string, x: number, z: number, yaw: number) => {
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        return modelFoot(name).every(([ax, az, bx, bz]) => [[ax, az], [bx, bz]].every(([u, v]) => shoreAt(x + u * c + v * sn, z - u * sn + v * c) < -0.08));
      };

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
            const yaw = (rng() - 0.5) * 0.35;
            if (!footOnLand(name, x, z, yaw)) return false;
            taken.push([x, z, foot]);
            this.addBuilding(chunk, name, x, heightAt(x, z), z, yaw);
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
      // (each piece of a village is built by the square it stands in, not the one its centre is in: its spot is then read
      // on this square's own ground)
      for (const l of layouts) {
        for (const b of l.buildings) if (own(b.x, b.z) && footOnLand(b.name, b.x, b.z, b.yaw)) this.addBuilding(chunk, b.name, b.x, heightAt(b.x, b.z), b.z, b.yaw);
        for (const p of l.props) if (own(p.x, p.z)) add(p.name, p.x, p.z, p.height, p.flip, p.vignette || p.square ? 0 : 10, { vignette: p.vignette, awake: p.awake });
        for (const p of l.piers) {
          if (!own(p.x, p.z)) continue;
          // standing on the beach at its shore end
          const dx = Math.sin(p.yaw);
          const dz = Math.cos(p.yaw);
          const back = modelInfo('pier')!.depth / 2 - 0.5;
          this.addDeck(chunk, 'pier', p.x, heightAt(p.x - dx * back, p.z - dz * back), p.z, dx, dz);
        }
      }
      for (const b of [...roads.flatMap((r) => r.bridges), ...footbridges]) if (own(b.x, b.z)) this.addDeck(chunk, 'bridge', b.x, heightAt(b.x, b.z), b.z, b.dx, b.dz);
      for (const st of streams) {
        const end = st.pts.length - 1;
        for (const [i, into] of [[0, 3], [end, end - 3]]) {
          const [sx, sz] = st.pts[i];
          if (!own(sx, sz)) continue;
          // the river_source at both ends of a river (papertrails'): a stone mound card with the water's mouth at the
          // river's end, three crags in a horseshoe behind it, reeds and a stone on the pool's bank
          const [ax, az] = st.pts[into];
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
        // the banks (clear of the stones at either end and of the footbridges): reeds now and then, a duck afloat, a
        // frog, a duck or a heron at the water's edge
        for (let k = 2; k < end - 1; k++) {
          const [px, pz] = st.pts[k];
          if (!own(px, pz) || nearBridge(px, pz)) continue;
          const [qx, qz] = st.pts[k + 1];
          const l = Math.hypot(qx - px, qz - pz) || 1;
          const nx = -(qz - pz) / l;
          const nz = (qx - px) / l;
          const hw = Streams.widthAt(k) / 2;
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
            const h = heightOf(sprite, rng());
            add(sprite, x, z, h, rng() < 0.5, 10);
            taken.push([x, z, 0.2]);
            // (a cart with its hay, beside it as the card is seen)
            const hx = x + side * (cardWidth(sprite, h) / 2 + 0.14);
            const hz = z - 0.06;
            if (sprite === 'handcart' && rng() < CART_HAY && free(hx, hz, 0.15) && !roads.some((r) => onRoad(r, hx, hz, 0.15))) {
              add('hay', hx, hz);
              taken.push([hx, hz, 0.15]);
            }
          }
        }
      }
      // papertrails' signposts where the roads meet: in the wedge between two of them, off every road
      for (const j of junctionsOf(roads)) {
        const [[ax, az], [bx, bz]] = j.dirs;
        const wl = Math.hypot(ax + bx, az + bz);
        const [wx, wz] = wl > 0.2 ? [(ax + bx) / wl, (az + bz) / wl] : [-az, ax];
        for (const out of SIGN_OUT) {
          const x = j.x + wx * out;
          const z = j.z + wz * out;
          if (!own(x, z) || !free(x, z, 0.2) || sampleAt(dist, x, z) > -0.4 || roads.some((r) => onRoad(r, x, z, 0.18))) continue;
          add('signpost', x, z, heightOf('signpost', rng()), rng() < 0.5, 10);
          taken.push([x, z, 0.2]);
          break;
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
          const yaw = (rng() - 0.5) * 0.6;
          if (!footOnLand(name, x, z, yaw)) continue;
          taken.push([x, z, foot]);
          this.addBuilding(chunk, name, x, heightAt(x, z), z, yaw);
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
            if (rng() < OWL_CHANCE) add('owl', x, z + 0.02, undefined, rng() < 0.5, 0, { vignette: { seat: tower * spriteTop('watchtower', 0.5) * TOP_K }, awake: 'night' });
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
        this.landmark(s, add, shoreAt, taken, free, rng, (name, x, z) => {
          const yaw = (rng() - 0.5) * 0.8;
          if (!footOnLand(name, x, z, yaw)) return false;
          this.addBuilding(chunk, name, x, heightAt(x, z), z, yaw);
          yards.push([x, z, 1.2]);
          return true;
        });
      }
      yield;

      // ground cover by 2 x 2 tiles (world/cover.ts) and the life of the shallows
      const env: CoverEnv = {
        distance: (x, z) => sampleAt(dist, x, z),
        biome: (x, z, d) => land.biome(x, z, d),
        blocked: (x, z, r) => !free(x, z, r) || inYard(x, z),
        claim: (x, z, r) => taken.push([x, z, r]),
        place: (sprite, x, z, height, card = {}) => add(sprite, x, z, height, undefined, card.square ? 0 : undefined, card),
        rng,
      };
      plantShallows(env, x0, z0, CHUNK);
      plantCover(env, x0, z0, CHUNK);

      // a treasure chest on a beach, sometimes
      let chestAt = -1;
      if ((hash2(CHEST_SALT ^ SEED, i, j) >>> 0) / 4294967296 < 0.2) {
        for (let a = 0; a < 40; a++) {
          const x = x0 + rng() * CHUNK;
          const z = z0 + rng() * CHUNK;
          const d = sampleAt(dist, x, z);
          if (d > -0.3 || d < -0.9 || !free(x, z, 0.4)) continue;
          const before = specs.length;
          add('chest', x, z, heightOf('chest', rng()), rng() < 0.5, 12);
          if (specs.length === before) continue;
          chestAt = before;
          break;
        }
      }
      // (the chest with the rest: it takes its place in its cell's rise order)
      const cards = this.cards.add(specs);
      chunk.cards.push(...cards);
      if (chestAt >= 0) {
        const card = cards[chestAt];
        const chest: Chest = { id: hash2((53) ^ SEED, i, j), card, name: this.coastName(card.x, card.z) };
        chunk.chests.push(chest);
        this.chests.set(chest.id, chest);
      }
      // papertrails' contact patch under every standing piece of the chunk (the ground cover and the animals as well),
      // and under its buildings (a village's that stand in the next square too: their patch reaches over)
      if (chunk.data) {
        const foot = (b: { name: string; x: number; z: number; yaw: number }): Footprint => {
          const info = modelInfo(b.name)!;
          return [b.x, b.z, info.width, info.depth, b.yaw];
        };
        const feet = [...chunk.houses.filter((h) => !BARE.test(h.name)), ...layouts.flatMap((l) => l.buildings.filter((b) => !own(b.x, b.z)))].map(foot);
        addContact(chunk.data, x0, z0, chunk.cards.map((c) => [c.x, c.z, cardWidth(c.sprite, c.height)]), feet);
      }
    }
    // papertrails' walk field, made with the chunk (not when the feet first ask, in the middle of a walk)
    yield* this.makeField(chunk);
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
    /** The drawn shore distance (past this chunk's own grid too: a landmark may stand beyond its centre's chunk). */
    shoreAt: (x: number, z: number) => number,
    taken: Array<[number, number, number]>,
    free: (x: number, z: number, r: number) => boolean,
    rng: () => number,
    /** Stands a model there, unless its base would reach the sea (false). */
    place: (name: string, x: number, z: number) => boolean,
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
        if (shoreAt(x, z) > -Math.max(0.6, h * 0.35) || !free(x, z, h * 0.5)) continue;
        if (modelInfo(sprite)) {
          if (!place(sprite, x, z)) continue;
        } else add(sprite, x, z, h, rng() < 0.5, 5);
        taken.push([x, z, h * 0.5]);
        break;
      }
    }
  }

  /**
   * One extruded paper layer: printed top (UVs into the chunk's ground print), coloured cut edge (but where its outline
   * was cut back onto the chunk's square: see withoutSeamWalls).
   */
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
    withoutSeamWalls(g, [x0, z0, x0 + CHUNK, z0 + CHUNK]);
    const mesh = new THREE.Mesh(g, [top, edge]);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }
}
