/** papertrails' tileable value noise (render/materials.js `addValueNoise` there), shared by the paper's textures. */

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Adds amp times a tileable value noise of cells x cells random nodes (each in -0.5..0.5, drawn from rng) to the
 * n x n map `out`, smoothly interpolated.
 */
export function addValueNoise(out: Float32Array, n: number, cells: number, amp: number, rng: () => number): void {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng() - 0.5;
  for (let y = 0; y < n; y++) {
    const fy = (y / n) * cells;
    const iy = Math.floor(fy);
    const ty = smooth(fy - iy);
    const y0 = (iy % cells) * cells;
    const y1 = ((iy + 1) % cells) * cells;
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells;
      const ix = Math.floor(fx);
      const tx = smooth(fx - ix);
      const x0 = ix % cells;
      const x1 = (ix + 1) % cells;
      const a = g[y0 + x0] + (g[y0 + x1] - g[y0 + x0]) * tx;
      const b = g[y1 + x0] + (g[y1 + x1] - g[y1 + x0]) * tx;
      out[y * n + x] += amp * (a + (b - a) * ty);
    }
  }
}
