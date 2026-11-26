/** Small helpers for the world's printed lines (streams, roads, lanes): points on the page, [x, z]. */
import { clamp } from '../core/math';

export type Pt = [number, number];

/** Axis-aligned bounds [x0, z0, x1, z1]. */
export type Box = [number, number, number, number];

export function boundsOf(pts: readonly Pt[], pad = 0): Box {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, z] of pts) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}

export function overlaps(a: Box, b: Box): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Distance from p to the segment ab (segmentDistance without the parameter, for loops run every frame). */
export function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-12 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Distance from p to the segment ab, and the parameter t (0..1) of the nearest point. */
function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 1e-12 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return [Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t];
}

/** Distance from p to a polyline and the index (fractional) along it of the nearest point. */
export function polylineDistance(pts: readonly Pt[], px: number, pz: number): [number, number] {
  let best = Infinity;
  let at = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [d, t] = segmentDistance(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) {
      best = d;
      at = i + t;
    }
  }
  return [best, at];
}

/** Chaikin corner cutting (keeps both end points). */
export function chaikin(pts: readonly Pt[], passes = 2): Pt[] {
  let out = pts.slice();
  for (let p = 0; p < passes; p++) {
    if (out.length < 3) return out;
    const next: Pt[] = [out[0]];
    for (let i = 0; i + 1 < out.length; i++) {
      const [ax, az] = out[i];
      const [bx, bz] = out[i + 1];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** The polyline resampled at a fixed spacing (keeps both end points). */
export function resample(pts: readonly Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    let s = step - carry;
    while (s <= l) {
      out.push([ax + ((bx - ax) * s) / l, az + ((bz - az) * s) / l]);
      s += step;
    }
    carry = l - (s - step);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/**
 * The polyline with the points it can do without (Douglas-Peucker): none of the points dropped lies further than
 * tolerance from the line kept. Keeps both end points.
 */
export function simplify(pts: readonly Pt[], tolerance: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const spans: Array<[number, number]> = [[0, pts.length - 1]];
  while (spans.length) {
    const [a, b] = spans.pop()!;
    let far = -1;
    let farD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far < 0) continue;
    keep[far] = 1;
    spans.push([a, far], [far, b]);
  }
  return pts.filter((_, i) => keep[i]);
}

/** Where the segments ab and cd cross: [t along ab, u along cd], or null. */
export function segmentCross(a: Pt, b: Pt, c: Pt, d: Pt): [number, number] | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0];
  const qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}
