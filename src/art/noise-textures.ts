/** Procedural, deterministic paper noise: the print grain the card painter lays under its prints. */
import { mulberry32 } from '../core/rng';

function valueNoise(size: number, cells: number, rng: () => number): Float32Array {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const out = new Float32Array(size * size);
  const s = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const iy = Math.floor(fy);
    const ty = s(fy - iy);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const ix = Math.floor(fx);
      const tx = s(fx - ix);
      const a = grid[(iy % cells) * cells + (ix % cells)];
      const b = grid[(iy % cells) * cells + ((ix + 1) % cells)];
      const c = grid[((iy + 1) % cells) * cells + (ix % cells)];
      const d = grid[((iy + 1) % cells) * cells + ((ix + 1) % cells)];
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

/** Fibre noise in [0, 1]: a few octaves of tileable value noise plus fine tooth. */
function fibreValues(size: number, seed: number): Float32Array {
  const rng = mulberry32(seed);
  const octaves: Array<[number, number]> = [[4, 0.35], [8, 0.25], [32, 0.2], [64, 0.12]];
  const out = new Float32Array(size * size);
  for (const [cells, amp] of octaves) {
    const n = valueNoise(size, cells, rng);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
  }
  for (let i = 0; i < out.length; i++) out[i] += (rng() - 0.5) * 0.12; // tooth
  let min = Infinity;
  let max = -Infinity;
  for (const v of out) { min = Math.min(min, v); max = Math.max(max, v); }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / (max - min);
  return out;
}

export interface GrainTile {
  size: number;
  /** Signed grain in about [-1, 1] (mottling, tooth and a few light / dark specks). */
  values: Float32Array;
}

let grainTile: GrainTile | null = null;

/** Tileable grain printed onto painted cards (see CardPainter.finish). */
export function getGrainTile(): GrainTile {
  if (grainTile) return grainTile;
  const size = 128;
  const values = fibreValues(size, 0x9a17);
  const rng = mulberry32(77);
  for (let i = 0; i < values.length; i++) {
    const speck = rng() < 0.01 ? (rng() < 0.5 ? -1.4 : 1.0) : 0;
    values[i] = (values[i] - 0.5) * 2 + speck;
  }
  grainTile = { size, values };
  return grainTile;
}
