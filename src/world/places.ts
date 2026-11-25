/**
 * Everything on the land that spans more than one chunk, worked out once and shared (all pure functions of the seed,
 * cached): the streams, the sites where people live, the roads between them with their bridges, each site's layout,
 * and the ponds (laid after all of them, clear of them). A chunk asks for what reaches its square; whichever chunk asks first, the answer is the same.
 */
import { MAX_LINK, MAX_RUINS_LINK, ROUTE_PAD, onRoad, routeRoad, type Road } from './roads';
import { SITE_CELL, laidOutBefore, layoutOf, siteIn, type Layout, type Site } from './sites';
import { Streams } from './streams';
import { overlaps, type Box } from './polyline';
import type { LandField } from './land';
import { cellKey } from '../core/grid';
import { pondDistance, pondIn, type Pond } from './ponds';

/** How many nearest settlements each one is joined to. */
const LINKS = 2;
/** How far a site's layout reaches from its square (its buildings, props, piers). */
const LAYOUT_REACH = 10;
/** The farthest a pond's water reaches from its centre (its largest radius and wobble). */
const POND_REACH = 1.6;

export class Places {
  readonly streams: Streams;
  private readonly sites = new Map<number, Site | null>();
  private readonly roads = new Map<string, Road | null>();
  private readonly layouts = new Map<number, Layout>();
  private readonly links = new Map<number, Site[]>();
  private readonly ponds = new Map<number, Pond | null>();

  constructor(private readonly land: LandField) {
    this.streams = new Streams(land);
  }

  /** The site of the chunk square (i, j), or null. */
  siteIn(i: number, j: number): Site | null {
    const key = cellKey(i, j);
    let s = this.sites.get(key);
    if (s === undefined) {
      s = siteIn(this.land, (x, z, r) => this.streams.waterAt(x, z, r), i, j);
      this.sites.set(key, s);
    }
    return s;
  }

  /** Sites within r of (x, z). */
  sitesNear(x: number, z: number, r: number): Site[] {
    const out: Site[] = [];
    const n = Math.ceil(r / SITE_CELL);
    const ci = Math.floor(x / SITE_CELL);
    const cj = Math.floor(z / SITE_CELL);
    for (let j = cj - n; j <= cj + n; j++) {
      for (let i = ci - n; i <= ci + n; i++) {
        const s = this.siteIn(i, j);
        if (s && Math.hypot(s.x - x, s.z - z) <= r) out.push(s);
      }
    }
    return out;
  }

  /**
   * The sites a site is joined to by road: a settlement to its LINKS nearest settlements within MAX_LINK, a ruin to
   * its nearest settlement within MAX_RUINS_LINK; a link counts if either end chose the other (so both agree).
   */
  private chosen(s: Site): Site[] {
    const settled = (o: Site) => o.kind !== 'ruins' && o.id !== s.id;
    const reach = s.kind === 'ruins' ? MAX_RUINS_LINK : MAX_LINK;
    const near = this.sitesNear(s.x, s.z, reach).filter(settled);
    near.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
    return near.slice(0, s.kind === 'ruins' ? 1 : LINKS);
  }

  private linksOf(s: Site): Site[] {
    let out = this.links.get(s.id);
    if (!out) {
      out = this.chosen(s);
      // ... and every site that chose this one (ruins included)
      if (s.kind !== 'ruins') {
        for (const o of this.sitesNear(s.x, s.z, MAX_LINK)) {
          if (o.id === s.id || out.includes(o)) continue;
          if (this.chosen(o).some((c) => c.id === s.id)) out.push(o);
        }
      }
      this.links.set(s.id, out);
    }
    return out;
  }

  /** The roads that reach a site. */
  roadsOf(s: Site): Road[] {
    const out: Road[] = [];
    for (const o of this.linksOf(s)) {
      const r = this.road(s, o);
      if (r) out.push(r);
    }
    return out;
  }

  /** Every road that comes within the box. */
  roadsNear(box: Box): Road[] {
    const out = new Map<string, Road>();
    const cx = (box[0] + box[2]) / 2;
    const cz = (box[1] + box[3]) / 2;
    const r = Math.hypot(box[2] - box[0], box[3] - box[1]) / 2 + MAX_LINK;
    for (const s of this.sitesNear(cx, cz, r)) {
      for (const o of this.linksOf(s)) {
        // a road never leaves the box its route was searched in: only those that can reach this box are routed
        const reach: Box = [Math.min(s.x, o.x) - ROUTE_PAD, Math.min(s.z, o.z) - ROUTE_PAD, Math.max(s.x, o.x) + ROUTE_PAD, Math.max(s.z, o.z) + ROUTE_PAD];
        if (!overlaps(reach, box)) continue;
        const road = this.road(s, o);
        if (road && overlaps(road.box, box)) out.set(road.id, road);
      }
    }
    return [...out.values()];
  }

  /**
   * The layout of a site (its buildings and props keep off every road round it, off the streams and off the ground of
   * the neighbouring sites laid out before it, so two villages close together never build on the same spot).
   */
  layout(s: Site): Layout {
    let l = this.layouts.get(s.id);
    if (!l) {
      const roads = this.roadsNear([s.x - LAYOUT_REACH, s.z - LAYOUT_REACH, s.x + LAYOUT_REACH, s.z + LAYOUT_REACH]);
      // (the order is strict, so this never comes back round to s)
      const claimed = this.sitesNear(s.x, s.z, 2 * LAYOUT_REACH).filter((o) => laidOutBefore(o, s)).flatMap((o) => this.layout(o).claims);
      l = layoutOf(this.land, { road: (x, z, r) => roads.some((road) => onRoad(road, x, z, r)), water: (x, z, r) => this.streams.waterAt(x, z, r), claimed }, s);
      this.layouts.set(s.id, l);
    }
    return l;
  }

  /** The ponds whose water may come within the box. */
  pondsNear(box: Box): Pond[] {
    const out: Pond[] = [];
    // (a pond lies inside its square, give or take its rim)
    for (let j = Math.floor((box[1] - POND_REACH) / SITE_CELL); j <= Math.floor((box[3] + POND_REACH) / SITE_CELL); j++) {
      for (let i = Math.floor((box[0] - POND_REACH) / SITE_CELL); i <= Math.floor((box[2] + POND_REACH) / SITE_CELL); i++) {
        const p = this.pondOf(i, j);
        if (p && p.x + POND_REACH > box[0] && p.x - POND_REACH < box[2] && p.z + POND_REACH > box[1] && p.z - POND_REACH < box[3]) out.push(p);
      }
    }
    return out;
  }

  /** Distance from (x, z) to the nearest bank of a stream or a pond (negative on the water; large when none is near). */
  waterDistance(x: number, z: number): number {
    let d = this.streams.bankDistance(x, z);
    for (const p of this.pondsNear([x - 1, z - 1, x + 1, z + 1])) d = Math.min(d, pondDistance(p, x, z));
    return d;
  }

  /** True if (x, z) lies on a stream's or a pond's water (plus margin). */
  waterAt(x: number, z: number, margin = 0): boolean {
    return this.waterDistance(x, z) < margin;
  }

  private pondOf(i: number, j: number): Pond | null {
    const key = cellKey(i, j);
    let p = this.ponds.get(key);
    if (p === undefined) {
      p = pondIn(this.land, {
        stream: (x, z, r) => this.streams.waterAt(x, z, r),
        road: (x, z, r) => this.roadsNear([x - r, z - r, x + r, z + r]).some((road) => onRoad(road, x, z, r)),
        site: (x, z, r) => this.sitesNear(x, z, r).length > 0,
      }, i, j);
      this.ponds.set(key, p);
    }
    return p;
  }

  /** Layouts that come within the box. */
  layoutsNear(box: Box): Layout[] {
    const cx = (box[0] + box[2]) / 2;
    const cz = (box[1] + box[3]) / 2;
    const r = Math.hypot(box[2] - box[0], box[3] - box[1]) / 2 + 12;
    return this.sitesNear(cx, cz, r).map((s) => this.layout(s)).filter((l) => overlaps(l.box, box));
  }

  private road(a: Site, b: Site): Road | null {
    const id = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
    let r = this.roads.get(id);
    if (r === undefined) {
      const lo = a.id < b.id ? a : b;
      const hi = a.id < b.id ? b : a;
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const span = Math.hypot(a.x - b.x, a.z - b.z) / 2 + 12;
      const others = this.sitesNear(mx, mz, span).filter((s) => s.id !== a.id && s.id !== b.id && s.kind !== 'ruins');
      const streams = this.streams.near([mx - span, mz - span, mx + span, mz + span]);
      r = routeRoad(this.land, lo, hi, others, streams);
      this.roads.set(id, r);
    }
    return r;
  }
}
