/**
 * What stops the feet ashore (the walk field): the pieces as they are drawn, not circles round them.
 * Only geometry that stands between BAND_LO and BAND_HI above the page blocks (a trunk, a wall, the foot of a dome
 * card, a crate), projected onto the page as segments; the walker keeps WALKER_RADIUS + PADDING away from them.
 */
import * as THREE from 'three';

/** Height band (world units) of the geometry that blocks, and the walker's radius plus the clearance kept. */
export const BAND_LO = 0.07;
export const BAND_HI = 0.3;
export const WALKER_RADIUS = 0.12;
export const PADDING = 0.06;
/** Crossed cards block over their hull only up to this footprint (wider, each card blocks). */
export const HULL_MAX = 1.1;
/** An upright surface lower than this is the cut edge of a card, not a wall. */
const MIN_WALL = 0.04;

/** A blocking segment on the page: [ax, az, bx, bz]. */
export type Segment = [number, number, number, number];

/**
 * The blocking footprint of a model in its own space (rest pose), drawn `scale` times its modelled size: the page
 * projection of every edge of an upright triangle (a wall, a card, a rail: decks and ramps are walked on) that
 * crosses the blocking band. Upright cards project to their foot lines; duplicates are merged.
 */
export function footSegments(geometry: THREE.BufferGeometry, scale = 1): Segment[] {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const out: Segment[] = [];
  const seen = new Set<string>();
  const q = (v: number) => Math.round(v * 100);
  const add = (ax: number, az: number, bx: number, bz: number) => {
    if (Math.hypot(bx - ax, bz - az) * scale < 0.02) return;
    const k1 = `${q(ax)},${q(az)},${q(bx)},${q(bz)}`;
    const k2 = `${q(bx)},${q(bz)},${q(ax)},${q(az)}`;
    if (seen.has(k1) || seen.has(k2)) return;
    seen.add(k1);
    out.push([ax * scale, az * scale, bx * scale, bz * scale]);
  };
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const y0 = pos.getY(i) * scale;
    const y1 = pos.getY(i + 1) * scale;
    const y2 = pos.getY(i + 2) * scale;
    if (Math.min(y0, y1, y2) > BAND_HI || Math.max(y0, y1, y2) < BAND_LO) continue;
    // the cut edge of a card lying flat (a deck plank's thickness) is upright but no wall
    if (Math.max(y0, y1, y2) - Math.min(y0, y1, y2) < MIN_WALL) continue;
    // the triangle's normal: lying flat-ish (|ny| large) means a floor, not a wall
    const ux = pos.getX(i + 1) - pos.getX(i);
    const uy = pos.getY(i + 1) - pos.getY(i);
    const uz = pos.getZ(i + 1) - pos.getZ(i);
    const vx = pos.getX(i + 2) - pos.getX(i);
    const vy = pos.getY(i + 2) - pos.getY(i);
    const vz = pos.getZ(i + 2) - pos.getZ(i);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (Math.abs(ny) > 0.7 * Math.hypot(nx, ny, nz)) continue;
    for (const [a, b] of [[i, i + 1], [i + 1, i + 2], [i + 2, i]]) add(pos.getX(a), pos.getZ(a), pos.getX(b), pos.getZ(b));
  }
  return out;
}

/**
 * A solid mass's footprint (a mountain of dome cards in a V, an outcrop of slabs): the convex hull round its walls,
 * closed, so the feet cannot walk into the hollow between its cards.
 */
export function hullSegments(segments: Segment[]): Segment[] {
  const pts = segments.flatMap(([ax, az, bx, bz]) => [[ax, az], [bx, bz]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return segments;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  // Andrew's monotone chain
  const half = (list: number[][]) => {
    const h: number[][] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  const hull = [...half(pts), ...half([...pts].reverse())];
  return hull.map((p, i) => {
    const q = hull[(i + 1) % hull.length];
    return [p[0], p[1], q[0], q[1]] as Segment;
  });
}

/** Segments of a model's footprint placed at (x, z) and turned by yaw (about +Y, like Object3D.rotation.y). */
export function placeSegments(local: Segment[], x: number, z: number, yaw: number, out: Segment[]): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  for (const [ax, az, bx, bz] of local) out.push([x + ax * c + az * s, z - ax * s + az * c, x + bx * c + bz * s, z - bx * s + bz * c]);
}
