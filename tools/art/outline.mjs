// The cut outline of a printed piece, traced from its print's alpha, for the Blender builds (a card or a glued-on
// detail cut to its drawing, with its thickness along that edge): the models' cut-out faces (tools/art/pack-atlas.mjs)
// and the ships' printed details (tools/ship/trace-details.mjs). The tracing is the game's own (src/world/contours.ts),
// on the print eroded by one cell, as the sprites' silhouettes (src/popup/card.ts), so the outline runs just inside it.
import { contoursFromGrid, outlinesWithHoles } from '../../src/world/contours.ts';

/** The print is traced on a grid at most this many cells across (fine enough for a sign's scrolls). */
export const OUTLINE_GRID = 160;
/** Points within this many grid cells of the line through their neighbours are dropped. */
const TOLERANCE = 0.35;

/**
 * Runs in a page (inject it with page.addScriptTag({ content: alphaGrid.toString() })): an image's alpha on a grid at
 * most `grid` cells across, eroded by one cell (each takes the least alpha round it), framed by a transparent cell,
 * rows from the bottom, as 0.5 - alpha: the field traceOutline traces at 0.
 */
export function alphaGrid(img, w0, h0, grid) {
  const s = Math.min(1, grid / Math.max(w0, h0));
  const w = Math.max(4, Math.round(w0 * s));
  const h = Math.max(4, Math.round(h0 * s));
  const W = w + 2;
  const H = h + 2;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const cc = cv.getContext('2d', { willReadFrequently: true });
  cc.drawImage(img, 1, 1, w, h);
  const data = cc.getImageData(0, 0, W, H).data;
  const values = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = 255;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          m = Math.min(m, xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : data[(yy * W + xx) * 4 + 3]);
        }
      }
      values[(H - 1 - y) * W + x] = 0.5 - m / 255;
    }
  }
  return { w, h, values };
}

/**
 * The outline of a print from its alpha grid (alphaGrid): [{ outer, holes }] of [a, b] points in 0..1 of the print (b
 * from the bottom), outer loops counter-clockwise and holes clockwise, simplified.
 */
export function traceOutline({ w, h, values }) {
  const loops = contoursFromGrid({ x0: -1, z0: -1, cell: 1, nx: w + 1, nz: h + 1, values: Float32Array.from(values) })
    .map((loop) => simplify(loop, TOLERANCE))
    .filter((loop) => loop.length >= 3);
  const inPrint = (loop, ccw) => {
    const pts = loop.map(([x, y]) => [+(x / w).toFixed(4), +(y / h).toFixed(4)]);
    return signedArea(pts) > 0 === ccw ? pts : pts.reverse();
  };
  return outlinesWithHoles(loops).map(({ outer, holes }) => ({ outer: inPrint(outer, true), holes: holes.map((l) => inPrint(l, false)) }));
}

/** Twice the signed area of a loop (> 0: counter-clockwise). */
function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    s += x0 * y1 - x1 * y0;
  }
  return s;
}

/** A closed loop with the points within tol of the line through their kept neighbours dropped (Douglas-Peucker). */
function simplify(loop, tol) {
  const far = (a, b, from, to) => {
    let best = -1;
    let dist = tol;
    const [ax, ay] = loop[a];
    const dx = loop[b][0] - ax;
    const dy = loop[b][1] - ay;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = from; i < to; i++) {
      const d = Math.abs((loop[i][0] - ax) * dy - (loop[i][1] - ay) * dx) / len;
      if (d > dist) {
        dist = d;
        best = i;
      }
    }
    return best;
  };
  const keep = new Set([0]);
  // split the loop at its point farthest from the first, then simplify each half
  let opposite = 0;
  for (let i = 1, d = -1; i < loop.length; i++) {
    const di = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (di > d) {
      d = di;
      opposite = i;
    }
  }
  keep.add(opposite);
  const run = (a, b) => {
    const m = far(a, b % loop.length, a + 1, b);
    if (m < 0) return;
    keep.add(m);
    run(a, m);
    run(m, b);
  };
  run(0, opposite);
  run(opposite, loop.length);
  return [...keep].sort((p, q) => p - q).map((i) => loop[i]);
}
