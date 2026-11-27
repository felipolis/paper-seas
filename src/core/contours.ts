/**
 * Marching squares for any scalar field: closed loops of f(x, z) = 0 (inside = f < 0) over a rectangle, with a
 * consistent orientation so segments chain into loops, then one pass of Chaikin smoothing. The field should be
 * positive on the rectangle's border (contoursFromGrid takes the rectangle to clip to).
 */
import type { Pt } from './polyline';


/** Edge pairs (from, to) per marching-squares case, all walked with the inside on the same side. */
const TABLE: Record<number, Array<[number, number]>> = {
  1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 2], [1, 0]], 6: [[0, 2]], 7: [[3, 2]],
  8: [[2, 3]], 9: [[2, 0]], 10: [[0, 3], [2, 1]], 11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]],
};

/** A field sampled on a grid ((nx + 1) x (nz + 1) values from (x0, z0)), reused for several levels. */
export interface Grid {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  values: Float32Array;
}

/** Loops of grid value = 0; `clip` (optional) is intersected so loops close along a rectangle. */
export function contoursFromGrid(g: Grid, clip?: [number, number, number, number]): Pt[][] {
  const { x0, z0, cell, nx, nz, values } = g;
  const W = nx + 1;
  const v = new Float32Array(values.length);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * cell;
      const z = z0 + j * cell;
      let f = values[j * W + i];
      // outside the rectangle the field is pushed out; ON its edge it keeps its own value, so land narrower than a
      // cell along a chunk seam is still found (the loop then runs a little past the edge and is cut back onto it
      // below): both chunks meeting at the seam close their loops at the same points
      if (clip) {
        const c = Math.max(clip[0] - x, x - clip[2], clip[1] - z, z - clip[3]);
        if (c > 0) f = Math.max(f, c);
      }
      // keep exact zeros off the lattice so every crossing is well defined
      v[j * W + i] = f === 0 ? 1e-6 : f;
    }
  }
  const at = (i: number, j: number) => v[j * W + i];
  const lerpPt = (i0: number, j0: number, i1: number, j1: number): Pt => {
    const a = at(i0, j0);
    const b = at(i1, j1);
    const t = a / (a - b);
    return [x0 + (i0 + (i1 - i0) * t) * cell, z0 + (j0 + (j1 - j0) * t) * cell];
  };
  const key = (i0: number, j0: number, i1: number, j1: number) => (i0 < i1 || (i0 === i1 && j0 < j1) ? ((i0 * 4099 + j0) * 2 + (i1 - i0)) : ((i1 * 4099 + j1) * 2 + (i0 - i1)));
  const next = new Map<number, { to: number; p: Pt }>();
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = (at(i, j) < 0 ? 1 : 0) | (at(i + 1, j) < 0 ? 2 : 0) | (at(i + 1, j + 1) < 0 ? 4 : 0) | (at(i, j + 1) < 0 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const E: Array<[number, number, number, number]> = [
        [i, j, i + 1, j],
        [i + 1, j, i + 1, j + 1],
        [i, j + 1, i + 1, j + 1],
        [i, j, i, j + 1],
      ];
      for (const [ea, eb] of TABLE[idx]) next.set(key(...E[ea]), { to: key(...E[eb]), p: lerpPt(...E[ea]) });
    }
  }
  const loops: Pt[][] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop: Pt[] = [];
    let k: number | undefined = start;
    while (k !== undefined && !seen.has(k)) {
      seen.add(k);
      const seg: { to: number; p: Pt } | undefined = next.get(k);
      if (!seg) break;
      loop.push(seg.p);
      k = seg.to;
    }
    if (loop.length < 4) continue;
    if (!clip) {
      loops.push(chaikinLoop(loop));
      continue;
    }
    // cut back onto the rectangle what ran past its edge
    const cut = loop.map(([x, z]): Pt => [Math.min(clip[2], Math.max(clip[0], x)), Math.min(clip[3], Math.max(clip[1], z))]);
    // (a loop wholly past the edge is cut down to a line along it: nothing of it lies in this rectangle)
    if (Math.abs(loopArea(cut)) < 1e-6) continue;
    loops.push(chaikinLoop(withCorners(cut, clip), clip));
  }
  return loops;
}

/**
 * Marching squares cuts a corner of the clip rectangle diagonally across one cell (the loop steps from one side of
 * the rectangle to the next through the corner cell), which leaves a diamond-shaped hole where four chunks meet: put
 * the corner itself back wherever the loop goes from one side straight on to the perpendicular one.
 */
function withCorners(loop: Pt[], clip: [number, number, number, number]): Pt[] {
  const e = 2e-3;
  const side = ([x, z]: Pt): number => (Math.abs(x - clip[0]) < e ? 0 : Math.abs(z - clip[1]) < e ? 1 : Math.abs(x - clip[2]) < e ? 2 : Math.abs(z - clip[3]) < e ? 3 : -1);
  const out: Pt[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    out.push(a);
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0 && sb >= 0 && sa !== sb && (sa + sb) % 2 === 1) {
      const xs = sa === 0 || sb === 0 ? clip[0] : clip[2];
      const zs = sa === 1 || sb === 1 ? clip[1] : clip[3];
      out.push([xs, zs]);
    }
  }
  return out;
}

/**
 * One pass of Chaikin corner cutting round a closed loop. Points on the clip rectangle stay where they are: the
 * neighbouring chunk's loop closes along the same line, and cutting the corner where a shore meets it would open a
 * notch at the seam (a hole down to the sea between two chunks).
 */
function chaikinLoop(pts: Pt[], clip?: [number, number, number, number]): Pt[] {
  const e = 2e-3;
  const fixed = (p: Pt) => !!clip && (Math.abs(p[0] - clip[0]) < e || Math.abs(p[0] - clip[2]) < e || Math.abs(p[1] - clip[1]) < e || Math.abs(p[1] - clip[3]) < e);
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const fa = fixed(a);
    const fb = fixed(b);
    if (fa) out.push(a);
    if (!fa || !fb) {
      if (!fa) out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      if (!fb) out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
  }
  return out;
}

/** Signed area of a closed loop (shoelace). */
function loopArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) a += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
  return a / 2;
}

function pointInLoop(x: number, z: number, loop: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, zi] = loop[i];
    const [xj, zj] = loop[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Groups loops into outlines with their holes (a loop inside an odd number of others is a hole). */
export function outlinesWithHoles(loops: Pt[][]): Array<{ outer: Pt[]; holes: Pt[][] }> {
  const depth = loops.map((l, i) => loops.reduce((d, o, j) => (j !== i && pointInLoop(l[0][0], l[0][1], o) ? d + 1 : d), 0));
  const outers = loops.map((l, i) => ({ outer: l, holes: [] as Pt[][], i })).filter((o) => depth[o.i] % 2 === 0);
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) return;
    let best: (typeof outers)[number] | null = null;
    for (const o of outers) if (pointInLoop(l[0][0], l[0][1], o.outer) && (!best || depth[o.i] > depth[best.i])) best = o;
    best?.holes.push(l);
  });
  return outers.map(({ outer, holes }) => ({ outer, holes }));
}
