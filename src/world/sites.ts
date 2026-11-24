/**
 * Where people live, as a pure function of the seed (so every chunk a village reaches agrees on it): one site at most
 * per chunk square. On the coast a fishing village or a port town, well inland now and then a hamlet; here and there
 * old ruins. A site's layout (its buildings round the square, its props, its piers, the lanes branching from the square to
 * every door) is worked out from the site, keeping clear of the roads that reach it, of the streams and of the ground
 * already claimed by the neighbouring sites laid out before it (laidOutBefore).
 */
import { WORLD } from '../config/world';
import { hash01, hash2, mulberry32 } from '../core/rng';
import { modelInfo } from './models';
import { cardWidth, spriteTop } from '../art/sprites';
import { HEIGHT, heightOf } from '../config/flora';
import { boundsOf, polylineDistance, type Box, type Pt } from './polyline';
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
}

export interface Layout {
  site: Site;
  buildings: Placed[];
  /** Cards (props): sprite name, position. */
  props: Placed[];
  piers: Placed[];
  /** Lanes to each door and pier, branching from the square and from one another. */
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
  const taken: Claim[] = [[site.x, site.z, 1.0]];
  const clear = (x: number, z: number, r: number, claims: readonly Claim[]) => claims.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + r);
  const free = (x: number, z: number, r: number) =>
    clear(x, z, r, taken) && clear(x, z, r, avoid.claimed) && !avoid.road(x, z, r) && !avoid.water(x, z, r);
  const stops: Pt[] = [];
  const place = (name: string, rMin: number, rMax: number, dMin: number, dMax: number, tries: number): boolean => {
    const info = modelInfo(name)!;
    const foot = Math.hypot(info.width, info.depth) * 0.5 + 0.12;
    for (let a = 0; a < tries; a++) {
      const r = rMin + rng() * (rMax - rMin);
      const ang = rng() * Math.PI * 2;
      const x = site.x + Math.cos(ang) * r;
      const z = site.z + Math.sin(ang) * r;
      const d = land.distance(x, z);
      if (d > Math.min(dMax, -foot) || d < dMin || land.terraceAt(x, z, d) > 1 || !free(x, z, foot)) continue;
      // every corner of its base on the land (the shore distance is only approximate away from the centre)
      const yaw = (rng() - 0.5) * 0.9;
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]): Pt => [(u * info.width) / 2, (v * info.depth) / 2]);
      if (corners.some(([u, v]) => land.distance(x + u * c + v * sn, z - u * sn + v * c) > -0.08)) continue;
      taken.push([x, z, foot]);
      buildings.push({ name, x, z, yaw });
      stops.push([x, z]);
      return true;
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
    return finish(site, buildings, props, piers, [], taken);
  }

  // the houses round the square, their fronts turned roughly toward the camera
  const plan = site.jungle
    ? ['hut', 'hut', 'hut', 'hut', 'cottage']
    : ['cottage', 'tavern', 'cottage', 'warehouse', 'cottage', rng() < 0.5 ? 'chapel' : 'warehouse', 'cottage'];
  const houses = site.kind === 'port' ? 6 + Math.floor(rng() * 4) : site.kind === 'village' ? 3 + Math.floor(rng() * 4) : 2 + Math.floor(rng() * 2);
  for (let k = 0; k < houses; k++) place(site.kind === 'hamlet' ? (site.jungle ? 'hut' : 'cottage') : plan[k % plan.length], 1.2, 4.2, -40, 0, 16);
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
  // and each lane leaves from the nearest point of the paths already trodden (the square or a lane short of its
  // door), so they branch like real paths instead of fanning out side by side from the square
  const lanes: Pt[][] = [];
  const order = [...stops].sort((a, b) => Math.hypot(a[0] - site.x, a[1] - site.z) - Math.hypot(b[0] - site.x, b[1] - site.z));
  for (const [bx, bz] of order) {
    let [ax, az] = [site.x, site.z];
    let best = Math.hypot(bx - ax, bz - az) * BRANCH_SAVING;
    for (const l of lanes) {
      for (const [x, z] of l.slice(0, BRANCH_FROM)) {
        const d = Math.hypot(bx - x, bz - z);
        if (d < best) [best, ax, az] = [d, x, z];
      }
    }
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
  // props about the square, off the lanes, and its animals (papertrails' village and farm tiles: a well, stalls,
  // laundry, bunting, carts, benches, lamps, hives and fences, 2.5 to 4.5 animals a tile)
  const hamlet = site.kind === 'hamlet';
  const kit = hamlet
    ? ['barrel', 'well', 'laundry', 'crates', 'fence-bamboo', 'bench', 'handcart', 'beehive']
    : ['market', 'well', 'windmill', 'stall', 'cannon', 'laundry', 'bunting', 'barrel', 'handcart', 'crates', 'bench', 'lantern-post', 'flag-pole', 'beehive', 'fence-rail', 'fence-bamboo'];
  const animals = ['hen', 'chick', 'hen', 'pig', 'goat', 'chick'];
  const count = hamlet ? 4 + Math.floor(rng() * 3) : 9 + Math.floor(rng() * 5);
  const herd = hamlet ? 3 + Math.floor(rng() * 2) : 5 + Math.floor(rng() * 4);
  for (let k = 0; k < herd; k++) kit.push(animals[(k + Math.floor(rng() * animals.length)) % animals.length]);
  for (let k = 0; k < count + herd; k++) {
    const sprite = k < count ? kit[k % (kit.length - herd)] : kit[kit.length - herd + (k - count)];
    for (let a = 0; a < 12; a++) {
      const r = 0.9 + rng() * 3.4;
      const ang = rng() * Math.PI * 2;
      const x = site.x + Math.cos(ang) * r;
      const z = site.z + Math.sin(ang) * r;
      const d = land.distance(x, z);
      const foot = propFoot(sprite);
      if (d > -0.4 || land.terraceAt(x, z, d) > 1 || !free(x, z, foot) || lanes.some((l) => polylineDistance(l, x, z)[0] < foot + 0.2)) continue;
      taken.push([x, z, foot]);
      props.push({ name: sprite, x, z, yaw: 0, height: heightOf(sprite, rng()), flip: rng() < 0.5 });
      break;
    }
  }
  vignettes(site, buildings, props, rng, (x, z) => land.distance(x, z) < -0.3 && free(x, z, 0.06));
  return finish(site, buildings, props, piers, lanes, taken);
}

/**
 * papertrails' village vignettes (config/animals.js spawns: village, house, manor, village_green there): a cat sitting
 * ON a fence, a barrel, the well, crates, hay, a woodpile or a bench (its feet at the piece's top, sunk 0.03), a cat
 * asleep or sitting BY a door, a dog sitting AT the cart, a bench, the well or a signpost, hens AT a fence or the cart.
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
  const beside = (who: string, re: RegExp, n: number) => {
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
      props.push({ name: who, x, z, yaw: 0, height: heightOf(who, rng()), flip: sd < 0, vignette: { seat: 0 } });
      placed++;
    }
  };
  if (rng() < VIG.dog) beside('dog', /^(handcart|bench|well)$/, 1);
  if (rng() < VIG.hens) beside('hen', /^(fence-|handcart$)/, 3);
}

/** papertrails' vignette chances: village / house cat on a piece, at the door, a dog at the cart, hens at the yard. */
const VIG = { on: 1, onHamlet: 0.55, door: 0.7, doorHamlet: 1, dog: 0.7, hens: 0.7, sink: 0.03 };

function finish(site: Site, buildings: Placed[], props: Placed[], piers: Placed[], lanes: Pt[][], claims: Claim[]): Layout {
  const pts: Pt[] = [[site.x, site.z], ...[...buildings, ...props, ...piers].map((p): Pt => [p.x, p.z]), ...lanes.flat()];
  return { site, buildings, props, piers, lanes, box: boundsOf(pts, 2.5), claims };
}
