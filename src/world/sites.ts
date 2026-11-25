/**
 * Where people live, as a pure function of the seed (so every chunk a village reaches agrees on it): one site at most
 * per chunk square. On the coast a fishing village or a port town, well inland now and then a hamlet; here and there
 * old ruins. A site's layout is worked out from the site, keeping clear of the roads that reach it, of the streams and
 * of the ground already claimed by the neighbouring sites laid out before it (laidOutBefore): its buildings, ringed
 * round the square or lined along a street through it (papertrails' village rows), its props and scenes, its piers,
 * and the lanes branching from the square (or the street) to every door.
 */
import { WORLD } from '../config/world';
import { hash01, hash2, mulberry32 } from '../core/rng';
import { modelInfo, type ModelInfo } from './models';
import { cardWidth, spriteTop } from '../art/sprites';
import { HEIGHT, heightOf, type Awake } from '../config/flora';
import { boundsOf, polylineDistance, type Box, type Pt } from './polyline';
import { penAt } from './pen';
import type { LandField } from './land';

const SEED = WORLD.seed;
/** Sites are laid on the same squares as the terrain chunks. */
export const SITE_CELL = 18;
/** A prop's footprint radius: half its card's drawn width at its tallest (what stops the feet is the card as drawn). */
function propFoot(sprite: string): number {
  return cardWidth(sprite, HEIGHT[sprite][1]) / 2;
}

/** A lane's points; a new lane may branch off an earlier one only short of its door (its first BRANCH_FROM points). */
const LANE_POINTS = 12;
const BRANCH_FROM = 9;
/** ...and only when that saves at least a quarter of the walk from the square. */
const BRANCH_SAVING = 0.75;

/**
 * papertrails' village rows (its villages line up along the roads): this share of the villages (not the jungle's
 * stilt huts, which keep to a clearing) line their houses along a street through the square, the others ring it.
 */
const STREET_SHARE = 0.5;
/** The village square's radius on the print (papertrails' road is 0.5 wide). */
export const SQUARE_RADIUS = 0.95;
/** The street's width on the print (between the lanes', 0.36, and a road's, 0.75). */
export const STREET_WIDTH = 0.55;
/**
 * It runs within STREET_TURN of east-west (rad), so the row behind it shows its fronts, past the end houses by
 * STREET_END. The roads that reach the square, the shore and the streams leave gaps in a row: the street takes the turn
 * and the shift along it (of STREET_TRIES) that seat the most houses, and needs at least STREET_MIN of them.
 */
const STREET_TURN = 0.3;
const STREET_END = 0.6;
const STREET_TRIES: ReadonlyArray<[number, number]> = [-1, -0.5, 0, 0.5, 1].flatMap((t) => [0, -1.3, 1.3].map((s): [number, number] => [t * STREET_TURN, s]));
const STREET_MIN = 2;
/**
 * The row behind the street (the far side, fronts to the camera and to the street) holds at most ROW_MAX houses; the
 * rest face it from the near side, their backs to the camera (a house's back carries its front's print). Neighbours
 * stand ROW_GAP apart, FRONT_YARD back from the street's edge.
 */
const ROW_MAX = 5;
const ROW_GAP = 0.45;
const FRONT_YARD = 0.3;
/** The ground a street's square keeps clear (a ring's keeps 1). */
const SQUARE_LINED = 0.3;
/** Along a street, this share of the props stands on its near side (low pieces: the street stays in sight). */
const STREET_PROPS = 0.7;

export type SiteKind = 'port' | 'village' | 'hamlet' | 'ruins';

export interface Site {
  id: number;
  kind: SiteKind;
  /** The square (or the middle of the ruins). */
  x: number;
  z: number;
  /** Jungle villages are stilt huts. */
  jungle: boolean;
}

/** Ground a layout holds: a circle [x, z, r] round its square and each of its buildings, piers and props. */
export type Claim = [number, number, number];

/** Neighbouring sites are laid out in this order (a port before a village, a village before a hamlet, then by id). */
const KIND_ORDER: Record<SiteKind, number> = { port: 0, village: 1, hamlet: 2, ruins: 3 };

/** True if site a is laid out before site b (b keeps clear of a's ground). */
export function laidOutBefore(a: Site, b: Site): boolean {
  return (KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id - b.id) < 0;
}

export interface Placed {
  name: string;
  x: number;
  z: number;
  yaw: number;
  /** Cards (props): their height and mirroring, and papertrails' vignette for an animal tied to a piece. */
  height?: number;
  flip?: boolean;
  vignette?: { seat: number };
  /** An animal about by day or by night only. */
  awake?: Awake;
  /** Stands at its own yaw, set with the rest of its scene (a pen's fences), not turned a little at random. */
  fixed?: boolean;
  /** Too low to stop the feet (a pen's fences). */
  passable?: boolean;
}

export interface Layout {
  site: Site;
  buildings: Placed[];
  /** Cards (props): sprite name, position. */
  props: Placed[];
  piers: Placed[];
  /** The street its houses line (STREET_WIDTH wide), or null when they ring the square. */
  street: Pt[] | null;
  /** Lanes to each door and pier, branching from the square (or the street) and from one another. */
  lanes: Pt[][];
  box: Box;
  /** The ground it holds (a neighbour laid out after it keeps clear of it). */
  claims: Claim[];
}

/**
 * What sites and layouts keep clear of: true if a road / a stream comes within r of (x, z); the ground the
 * neighbouring sites laid out before this one hold.
 */
export interface Avoid {
  road(x: number, z: number, r: number): boolean;
  water(x: number, z: number, r: number): boolean;
  claimed: readonly Claim[];
}

/** True if a stream comes within r of (x, z). */
export type Water = (x: number, z: number, r: number) => boolean;

/** The site of the chunk square (i, j), or null. */
export function siteIn(land: LandField, water: Water, i: number, j: number): Site | null {
  const x0 = i * SITE_CELL;
  const z0 = j * SITE_CELL;
  const roll = hash01(SEED ^ 41, i, j);
  const ruinsRoll = hash01(SEED ^ 43, i, j);
  const rng = mulberry32(hash2(SEED ^ 45, i, j));
  const id = hash2(SEED ^ 47, i, j);
  const kind: SiteKind | null = roll < 0.1 ? 'port' : roll < 0.3 ? 'village' : roll < 0.42 ? 'hamlet' : ruinsRoll < 0.08 ? 'ruins' : null;
  if (!kind) return null;
  for (let tries = 0; tries < 30; tries++) {
    const x = x0 + 3 + rng() * (SITE_CELL - 6);
    const z = z0 + 3 + rng() * (SITE_CELL - 6);
    const d = land.distance(x, z);
    const ok =
      kind === 'hamlet' ? d < -6 && d > -30 : kind === 'ruins' ? d < -2.5 : d < -1.5 && d > -5;
    if (!ok || land.terraceAt(x, z, d) > 1 || water(x, z, 2.5)) continue;
    return { id, kind, x, z, jungle: land.biome(x, z, d) === 'jungle' };
  }
  return null;
}

/** The layout of a site: its buildings and props keep off the roads that reach it and off the streams. */
export function layoutOf(land: LandField, avoid: Avoid, site: Site): Layout {
  const rng = mulberry32(hash2(SEED ^ 49, site.id, 7));
  const buildings: Placed[] = [];
  const props: Placed[] = [];
  const piers: Placed[] = [];
  // (a street's square is a widening of it, with houses close beside; a ring's keeps its houses back)
  const lined = site.kind !== 'ruins' && !site.jungle && hash01(SEED ^ 51, site.id, 3) < STREET_SHARE;
  const taken: Claim[] = [[site.x, site.z, lined ? SQUARE_LINED : 1.0]];
  const clear = (x: number, z: number, r: number, claims: readonly Claim[]) => claims.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + r);
  const free = (x: number, z: number, r: number) =>
    clear(x, z, r, taken) && clear(x, z, r, avoid.claimed) && !avoid.road(x, z, r) && !avoid.water(x, z, r);
  const stops: Pt[] = [];
  // a building stands where the ground is level enough, clear, and every corner of its base on the land (the shore
  // distance is only approximate away from the centre); dry: only whether it would
  const build = (name: string, x: number, z: number, yaw: number, dMin: number, dMax: number, dry = false): boolean => {
    const info = modelInfo(name)!;
    const foot = footOf(info);
    const d = land.distance(x, z);
    if (d > Math.min(dMax, -foot) || d < dMin || land.terraceAt(x, z, d) > 1 || !free(x, z, foot)) return false;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]): Pt => [(u * info.width) / 2, (v * info.depth) / 2]);
    if (corners.some(([u, v]) => land.distance(x + u * c + v * sn, z - u * sn + v * c) > -0.08)) return false;
    if (dry) return true;
    taken.push([x, z, foot]);
    buildings.push({ name, x, z, yaw });
    stops.push([x, z]);
    return true;
  };
  // round the square: a spot rMin..rMax from it, the front turned roughly toward the camera
  const place = (name: string, rMin: number, rMax: number, dMin: number, dMax: number, tries: number): boolean => {
    for (let a = 0; a < tries; a++) {
      const r = rMin + rng() * (rMax - rMin);
      const ang = rng() * Math.PI * 2;
      if (build(name, site.x + Math.cos(ang) * r, site.z + Math.sin(ang) * r, (rng() - 0.5) * 0.9, dMin, dMax)) return true;
    }
    return false;
  };

  if (site.kind === 'ruins') {
    for (const sprite of ['ruin-arch', 'pillars', 'tiki', 'tiki']) {
      const x = site.x + (rng() - 0.5) * 3.2;
      const z = site.z + (rng() - 0.5) * 3.2;
      if (land.distance(x, z) > -0.8 || !free(x, z, 0.5)) continue;
      taken.push([x, z, 0.5]);
      props.push({ name: sprite, x, z, yaw: 0 });
    }
    return finish(site, buildings, props, piers, null, [], taken);
  }

  const plan = site.jungle
    ? ['hut', 'hut', 'hut', 'hut', 'cottage']
    : ['cottage', 'tavern', 'cottage', 'warehouse', 'cottage', rng() < 0.5 ? 'chapel' : 'warehouse', 'cottage'];
  const count = site.kind === 'port' ? 6 + Math.floor(rng() * 4) : site.kind === 'village' ? 3 + Math.floor(rng() * 4) : 2 + Math.floor(rng() * 2);
  const houses = Array.from({ length: count }, (_, k) => (site.kind === 'hamlet' ? (site.jungle ? 'hut' : 'cottage') : plan[k % plan.length]));
  // along a street through the square, or round it; a house the street has no room for stands round the square
  const street = lined ? lineStreet(site, houses, rng, build, avoid.water) : null;
  for (const name of street ? street.left : houses) place(name, 1.2, 4.2, -40, 0, 16);
  if (site.kind === 'port') {
    // the waterfront: warehouses and a tavern just up the beach, a lighthouse at the water, a fort behind
    const front: Array<[string, number, number]> = [['warehouse', -1.6, -0.9], ['warehouse', -1.6, -0.9], ['tavern', -1.8, -1.0], ['lighthouse', -1.1, -0.6], ['fort', -4.5, -2.5]];
    for (const [name, dMin, dMax] of front) place(name, 2, 8, dMin, dMax, 40);
  }
  // piers on the nearest beach, running straight out to sea (two for a port, none for a hamlet)
  const pierInfo = modelInfo('pier')!;
  for (let a = 0, n = 0; a < 60 && n < (site.kind === 'port' ? 2 : site.kind === 'village' ? 1 : 0); a++) {
    const ang = rng() * Math.PI * 2;
    const r = 2 + rng() * 5;
    const x = site.x + Math.cos(ang) * r;
    const z = site.z + Math.sin(ang) * r;
    const d = land.distance(x, z);
    if (d > -0.05 || d < -0.4 || !free(x, z, 0.8)) continue;
    const [gx, gz] = land.normal(x, z);
    const half = pierInfo.depth / 2;
    // its shore end 0.5 up the beach, the rest over clear water
    let clear = true;
    for (let t = 0.6; t <= pierInfo.depth - 0.5 && clear; t += 0.3) if (land.distance(x + gx * t, z + gz * t) < 0.15) clear = false;
    if (!clear) continue;
    taken.push([x, z, 0.8]);
    piers.push({ name: 'pier', x: x + gx * (half - 0.5), z: z + gz * (half - 0.5), yaw: Math.atan2(gx, gz) });
    stops.push([x, z]);
    n++;
  }
  // a lane to every door and pier: a gentle bend, dropped if it would cross a stream. The nearest doors come first,
  // and each lane leaves from the nearest point of the paths already trodden (the street, the square or a lane short
  // of its door), so they branch like real paths instead of fanning out side by side from the square
  const lanes: Pt[][] = [];
  const order = [...stops].sort((a, b) => Math.hypot(a[0] - site.x, a[1] - site.z) - Math.hypot(b[0] - site.x, b[1] - site.z));
  for (const [bx, bz] of order) {
    let [ax, az] = [site.x, site.z];
    let best = Math.hypot(bx - ax, bz - az) * BRANCH_SAVING;
    const from = (pts: readonly Pt[]) => {
      for (const [x, z] of pts) {
        const d = Math.hypot(bx - x, bz - z);
        if (d < best) [best, ax, az] = [d, x, z];
      }
    };
    if (street) from(street.pts);
    for (const l of lanes) from(l.slice(0, BRANCH_FROM));
    const len = Math.hypot(bx - ax, bz - az);
    const bend = (rng() - 0.5) * 0.3 * len;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    const pts: Pt[] = [];
    for (let k = 0; k <= LANE_POINTS; k++) {
      const t = k / LANE_POINTS;
      const off = bend * Math.sin(Math.PI * t);
      pts.push([ax + (bx - ax) * t - uz * off, az + (bz - az) * t + ux * off]);
    }
    if (pts.some(([x, z]) => avoid.water(x, z, 0.2))) continue;
    lanes.push(pts);
  }
  // (the square, the street and the lanes)
  const trodden = (x: number, z: number, r: number) =>
    Math.hypot(x - site.x, z - site.z) < SQUARE_RADIUS + r ||
    lanes.some((l) => polylineDistance(l, x, z)[0] < r + 0.2) || (!!street && polylineDistance(street.pts, x, z)[0] < r + STREET_WIDTH / 2 + 0.1);
  // a prop's spot: round the square, or along the street, mostly on its near side
  const propSpot = (): Pt => {
    if (street && rng() < STREET_PROPS) {
      const s = (rng() - 0.5) * 2 * street.reach;
      const out = STREET_WIDTH / 2 + 0.3 + rng() * 0.9;
      return [site.x + street.ux * s - street.uz * out, site.z + street.uz * s + street.ux * out];
    }
    const r = 0.9 + rng() * 3.4;
    const ang = rng() * Math.PI * 2;
    return [site.x + Math.cos(ang) * r, site.z + Math.sin(ang) * r];
  };
  const spotFor = (foot: number): Pt | null => {
    for (let a = 0; a < 12; a++) {
      const [x, z] = propSpot();
      const d = land.distance(x, z);
      if (d > -0.4 || land.terraceAt(x, z, d) > 1 || !free(x, z, foot) || trodden(x, z, foot)) continue;
      return [x, z];
    }
    return null;
  };
  const prop = (name: string, x: number, z: number, more: Partial<Placed> = {}) => {
    taken.push([x, z, propFoot(name)]);
    props.push({ name, x, z, yaw: 0, height: heightOf(name, rng()), flip: rng() < 0.5, ...more });
  };
  // props about the square or the street (papertrails' village and farm tiles: a well, stalls, laundry, bunting,
  // carts, benches, lamps, hives and fences)
  const hamlet = site.kind === 'hamlet';
  const kit = hamlet
    ? ['barrel', 'well', 'laundry', 'crates', 'fence-bamboo', 'bench', 'handcart', 'beehive']
    : ['market', 'well', 'windmill', 'stall', 'cannon', 'laundry', 'bunting', 'barrel', 'handcart', 'crates', 'bench', 'lantern-post', 'flag-pole', 'beehive', 'fence-rail', 'fence-bamboo'];
  const n = hamlet ? 4 + Math.floor(rng() * 3) : 9 + Math.floor(rng() * 5);
  for (let k = 0; k < n; k++) {
    const sprite = kit[k % kit.length];
    const at = spotFor(propFoot(sprite));
    if (at) prop(sprite, ...at);
  }
  // its flocks (papertrails' village and farm rows: hens and chicks by day, a few goats, a pig or two)
  const flocks: Array<[string, number, number, Awake | undefined]> = hamlet
    ? [['hen', 2, 3, 'day'], ['goat', 1, 2, undefined]]
    : [['hen', 2, 3, 'day'], ['chick', 1, 2, 'day'], ['goat', 2, 3, undefined], ['pig', 1, 2, undefined]];
  for (const [sprite, lo, hi, awake] of flocks) {
    const first = spotFor(0.12);
    if (!first) continue;
    const heads = lo + Math.floor(rng() * (hi - lo + 1));
    for (let m = 0, tries = 0; m < heads && tries < 16; tries++) {
      const spread = 0.2 + 0.09 * heads;
      const [x, z] = m ? [first[0] + (rng() - 0.5) * 2 * spread, first[1] + (rng() - 0.5) * 2 * spread] : first;
      if (m && (land.distance(x, z) > -0.4 || !free(x, z, 0.08) || trodden(x, z, 0.08))) continue;
      prop(sprite, x, z, { awake });
      m++;
    }
  }
  // (by a door the house's claimed circle does not count, only its walls: inside no building, clear of the props)
  const inside = (x: number, z: number, r: number) =>
    buildings.some((b) => {
      const info = modelInfo(b.name)!;
      const c = Math.cos(b.yaw);
      const sn = Math.sin(b.yaw);
      const u = (x - b.x) * c - (z - b.z) * sn;
      const v = (x - b.x) * sn + (z - b.z) * c;
      return Math.abs(u) < info.width / 2 + r && Math.abs(v) < info.depth / 2 + r;
    });
  const byDoor = (x: number, z: number, r: number) =>
    land.distance(x, z) < -0.3 && !trodden(x, z, r) && !avoid.road(x, z, r) && !avoid.water(x, z, r) && !inside(x, z, r) && props.every((p) => Math.hypot(p.x - x, p.z - z) > propFoot(p.name) + r);
  const ok = (x: number, z: number, r: number) => land.distance(x, z) < -0.3 && free(x, z, r) && !trodden(x, z, r);
  scenes(site, buildings, props, piers, rng, ok, byDoor, prop, (x, z, r) => taken.push([x, z, r]), (x, z) => land.distance(x, z));
  vignettes(site, buildings, props, rng, (x, z) => land.distance(x, z) < -0.3 && free(x, z, 0.06));
  return finish(site, buildings, props, piers, street?.pts ?? null, lanes, taken);
}

/** A street through the square: its points, half its length, its direction, and the houses it had no room for. */
interface Street {
  pts: Pt[];
  reach: number;
  ux: number;
  uz: number;
  left: string[];
}

/** The ground a building holds: a circle round it, through its corners and a little beyond. */
function footOf(info: ModelInfo): number {
  return Math.hypot(info.width, info.depth) * 0.5 + 0.12;
}

/** A house's place in a street's rows: where, which way it faces, and its span along the street. */
interface Slot {
  name: string;
  x: number;
  z: number;
  yaw: number;
  lo: number;
  hi: number;
}

/**
 * The slots of a street turned by turn, its rows shifted along it by shift: the far side's row (up to ROW_MAX) faces
 * the camera and the street; the rest face it from the near side, between them (a house's back carries its front's
 * print).
 */
function streetSlots(site: Site, houses: string[], turn: number, shift: number, stagger: number): Slot[] {
  const ux = Math.cos(turn);
  const uz = Math.sin(turn);
  const out: Slot[] = [];
  for (const [side, row] of [[-1, houses.slice(0, ROW_MAX)], [1, houses.slice(ROW_MAX)]] as const) {
    // (neighbours ROW_GAP apart, and no nearer than their claimed ground allows: a house holds a circle round it)
    const infos = row.map((name) => modelInfo(name)!);
    const steps = infos.slice(1).map((b, k) => Math.max((infos[k].width + b.width) / 2 + ROW_GAP, footOf(infos[k]) + footOf(b) + 0.01));
    let at = shift - steps.reduce((a, d) => a + d, 0) / 2 + (side > 0 ? stagger : 0);
    for (const [k, name] of row.entries()) {
      const info = infos[k];
      if (k) at += steps[k - 1];
      const across = side * (STREET_WIDTH / 2 + FRONT_YARD + info.depth / 2);
      out.push({ name, x: site.x + ux * at - uz * across, z: site.z + uz * at + ux * across, yaw: side < 0 ? -turn : Math.PI - turn, lo: at - info.width / 2, hi: at + info.width / 2 });
    }
  }
  return out;
}

/**
 * papertrails' village row: the houses lined along a street through the square, nearly east-west, at the turn and
 * shift that seat the most of them (STREET_TRIES). A house that does not fit (the shore, a stream, a road, a
 * neighbour) is left for the square; with fewer than STREET_MIN seated there is no street.
 */
function lineStreet(site: Site, houses: string[], rng: () => number, build: (name: string, x: number, z: number, yaw: number, dMin: number, dMax: number, dry?: boolean) => boolean, water: Water): Street | null {
  const stagger = (rng() - 0.5) * 0.8;
  const seats = (slots: Slot[]) => slots.filter((t) => build(t.name, t.x, t.z, t.yaw, -40, 0, true)).length;
  let best: { turn: number; slots: Slot[]; n: number } | null = null;
  for (const [turn, shift] of STREET_TRIES) {
    const slots = streetSlots(site, houses, turn, shift, stagger);
    const n = seats(slots);
    if (!best || n > best.n) best = { turn, slots, n };
  }
  if (!best || best.n < STREET_MIN) return null;
  const ux = Math.cos(best.turn);
  const uz = Math.sin(best.turn);
  const left: string[] = [];
  // (the street runs past the end houses, and always through the square)
  let lo = -STREET_END;
  let hi = STREET_END;
  for (const t of best.slots) {
    if (!build(t.name, t.x, t.z, t.yaw, -40, 0)) {
      left.push(t.name);
      continue;
    }
    lo = Math.min(lo, t.lo - STREET_END);
    hi = Math.max(hi, t.hi + STREET_END);
  }
  const reach = Math.max(-lo, hi);
  const pts: Pt[] = [];
  for (let k = 0; k <= LANE_POINTS * 2; k++) {
    const s = lo + ((hi - lo) * k) / (LANE_POINTS * 2);
    // (a hand-drawn street: the faintest bend)
    const off = 0.08 * Math.sin(((s - lo) / (hi - lo)) * Math.PI);
    pts.push([site.x + ux * s - uz * off, site.z + uz * s + ux * off]);
  }
  // (cut short either way where it would run into a stream: the dry run through the square)
  const wet = (k: number) => water(pts[k][0], pts[k][1], STREET_WIDTH / 2);
  const mid = Math.round((-lo / (hi - lo)) * LANE_POINTS * 2);
  let a = mid;
  let b = mid;
  while (a > 0 && !wet(a - 1)) a--;
  while (b < pts.length - 1 && !wet(b + 1)) b++;
  return { pts: pts.slice(a, b + 1), reach, ux, uz, left };
}

/** The flowers grown by a door: in the jungle and elsewhere. */
const BEDS = { jungle: ['hibiscus', 'bush-pink', 'orchids'], plain: ['flowers-yellow', 'flowers-white', 'tuft-flowers', 'bush-pink'] };
/** The houses that keep a bed by the door, and how many of them do. */
const HOMES = /^(cottage|tavern|chapel|hut)$/;
const BED_CHANCE = 0.55;
/** How many sites keep a pen (world/pen.ts), and how far out from the square it may stand (a ring of spots tried). */
const PEN_CHANCE = 0.7;
const PEN_RING: [number, number] = [2.4, 6.5];
const PEN_TRIES = 40;

/**
 * Little scenes, the way papertrails composes its tiles (rather than props strewn about): a bed of flowers by a door,
 * a pen of goats (or a pig) between two fences, a handcart with its hay, a rowboat drawn up on the beach by a pier.
 * ok(x, z, r): on the land, clear by r and off the paths; byDoor: the same, but a house's own ground is its door's;
 * place: a prop, claimed; claim: holds ground besides (a pen's, so nothing grows in it); shore: the shore distance.
 */
function scenes(
  site: Site,
  buildings: Placed[],
  props: Placed[],
  piers: Placed[],
  rng: () => number,
  ok: (x: number, z: number, r: number) => boolean,
  byDoor: (x: number, z: number, r: number) => boolean,
  place: (name: string, x: number, z: number, more?: Partial<Placed>) => void,
  claim: (x: number, z: number, r: number) => void,
  shore: (x: number, z: number) => number,
): void {
  // a bed of flowers on one or both sides of a door
  const beds = site.jungle ? BEDS.jungle : BEDS.plain;
  for (const b of buildings) {
    if (!HOMES.test(b.name) || rng() >= BED_CHANCE) continue;
    const info = modelInfo(b.name)!;
    const nx = Math.sin(b.yaw);
    const nz = Math.cos(b.yaw);
    const sides = rng() < 0.5 ? [-1, 1] : [rng() < 0.5 ? -1 : 1];
    for (const side of sides) {
      const along = side * info.width * (0.3 + rng() * 0.1);
      const out = info.depth / 2 + 0.1;
      const x = b.x + nx * out + nz * along;
      const z = b.z + nz * out - nx * along;
      if (byDoor(x, z, 0.08)) place(beds[Math.floor(rng() * beds.length)], x, z);
    }
  }
  // a pen (world/pen.ts) a little way out from the square, its herd keeping its place
  if (!site.jungle && rng() < PEN_CHANCE) {
    for (let a = 0; a < PEN_TRIES; a++) {
      const r = PEN_RING[0] + rng() * (PEN_RING[1] - PEN_RING[0]);
      const ang = rng() * Math.PI * 2;
      const x = site.x + Math.cos(ang) * r;
      const z = site.z + Math.sin(ang) * r;
      const pen = penAt(x, z, rng);
      if (!ok(x, z, pen.room) || !pen.fences.every(([px, pz]) => shore(px, pz) < -0.3)) continue;
      for (const [px, pz, yaw] of pen.fences) place(pen.fence, px, pz, { height: pen.height, flip: false, yaw, fixed: true, passable: true });
      for (const [who, hx, hz] of pen.herd) place(who, hx, hz, { vignette: { seat: 0 } });
      claim(x, z, pen.room);
      break;
    }
  }
  // the handcart's hay beside it
  for (const cart of props.filter((p) => p.name === 'handcart')) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = cart.x + side * (cardWidth('handcart', cart.height!) / 2 + 0.14);
    const z = cart.z - 0.06;
    if (ok(x, z, 0.12)) place('hay', x, z);
  }
  // a rowboat drawn up on the sand beside each pier's shore end
  for (const pier of piers) {
    const half = modelInfo('pier')!.depth / 2 - 0.5;
    const ex = pier.x - Math.sin(pier.yaw) * half;
    const ez = pier.z - Math.cos(pier.yaw) * half;
    const side = rng() < 0.5 ? -1 : 1;
    for (const along of [0.8, 1.1, -0.8, -1.1]) {
      const x = ex + Math.cos(pier.yaw) * along * side;
      const z = ez - Math.sin(pier.yaw) * along * side;
      const d = shore(x, z);
      if (d > -0.15 || d < -0.45) continue;
      place('rowboat', x, z);
      break;
    }
  }
}

/**
 * papertrails' village vignettes (config/animals.js spawns: village, house, manor, village_green there): a cat sitting
 * ON a fence, a barrel, the well, crates, hay, a woodpile or a bench (its feet at the piece's top, sunk 0.03), a cat
 * asleep or sitting BY a door, a dog sitting AT the cart, a bench, the well or a signpost, hens AT a fence or the cart
 * (by day).
 */
function vignettes(site: Site, buildings: Placed[], props: Placed[], rng: () => number, ok: (x: number, z: number) => boolean): void {
  const hamlet = site.kind === 'hamlet';
  const pick = (re: RegExp) => {
    const list = props.filter((p) => re.test(p.name) && !p.vignette);
    return list.length ? list[Math.floor(rng() * list.length)] : null;
  };
  // on: across the piece's top, feet at its print's top there (a seat between 0.13 and 0.75, as papertrails takes)
  const seat = rng() < (hamlet ? VIG.onHamlet : VIG.on) ? pick(/^(fence-|barrel$|well$|crates$|bench$)/) : null;
  if (seat && seat.height) {
    const t = (rng() - 0.5) * 0.9;
    const u = 0.5 + t * 0.5;
    const top = seat.height * Math.min(spriteTop(seat.name, u), spriteTop(seat.name, 1 - u));
    if (top >= 0.13 && top <= 0.75) {
      const w = cardWidth(seat.name, seat.height);
      props.push({ name: 'cat', x: seat.x + t * w * 0.5, z: seat.z + 0.02, yaw: 0, height: heightOf('cat', rng()), flip: rng() < 0.5, vignette: { seat: top - VIG.sink } });
    }
  }
  // door: by the door of a house, a little to one side
  if (rng() < (hamlet ? VIG.doorHamlet : VIG.door)) {
    const homes = buildings.filter((b) => b.name !== 'lighthouse' && b.name !== 'fort');
    const b = homes.length ? homes[Math.floor(rng() * homes.length)] : null;
    const info = b ? modelInfo(b.name) : null;
    if (b && info) {
      const nx = Math.sin(b.yaw);
      const nz = Math.cos(b.yaw);
      const side = rng() < 0.5 ? -1 : 1;
      const along = side * Math.min(0.17, info.width * 0.3);
      for (let d = 0.1; d < 0.34; d += 0.04) {
        const x = b.x + nx * (info.depth / 2 + d) + nz * along;
        const z = b.z + nz * (info.depth / 2 + d) - nx * along;
        if (!ok(x, z)) continue;
        props.push({ name: 'cat', x, z, yaw: 0, height: heightOf('cat', rng()), flip: side < 0, vignette: { seat: 0 } });
        break;
      }
    }
  }
  // at: beside a piece, then a little in front of it
  const beside = (who: string, re: RegExp, n: number, awake?: Awake) => {
    const p = pick(re);
    if (!p || !p.height) return;
    const half = cardWidth(p.name, p.height) / 2;
    const s0 = rng() < 0.5 ? -1 : 1;
    let placed = 0;
    for (let q = 0; q < 4 && placed < n; q++) {
      const sd = q & 1 ? -s0 : s0;
      const reach = half + 0.14;
      const x = p.x + sd * (q < 2 ? reach : reach * 0.4);
      const z = p.z + (q < 2 ? 0.07 : 0.2);
      if (!ok(x, z)) continue;
      props.push({ name: who, x, z, yaw: 0, height: heightOf(who, rng()), flip: sd < 0, vignette: { seat: 0 }, awake });
      placed++;
    }
  };
  if (rng() < VIG.dog) beside('dog', /^(handcart|bench|well)$/, 1);
  if (rng() < VIG.hens) beside('hen', /^(fence-|handcart$)/, 3, 'day');
}

/** papertrails' vignette chances: village / house cat on a piece, at the door, a dog at the cart, hens at the yard. */
const VIG = { on: 1, onHamlet: 0.55, door: 0.7, doorHamlet: 1, dog: 0.7, hens: 0.7, sink: 0.03 };

function finish(site: Site, buildings: Placed[], props: Placed[], piers: Placed[], street: Pt[] | null, lanes: Pt[][], claims: Claim[]): Layout {
  const pts: Pt[] = [[site.x, site.z], ...[...buildings, ...props, ...piers].map((p): Pt => [p.x, p.z]), ...lanes.flat(), ...(street ?? [])];
  return { site, buildings, props, piers, street, lanes, box: boundsOf(pts, 2.5), claims };
}
