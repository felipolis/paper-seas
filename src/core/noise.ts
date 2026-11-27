/** Deterministic 2D value noise and fBm (seeded), shared by the land field and its biomes. */
import { hash01 } from './rng';

/** Smooth value noise in [0, 1]. */
export function valueNoise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash01(seed, ix, iy);
  const b = hash01(seed, ix + 1, iy);
  const c = hash01(seed, ix, iy + 1);
  const d = hash01(seed, ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise in about [0, 1]: `octaves` of value noise, each twice the frequency and `gain` the amplitude. */
export function fbm(seed: number, x: number, y: number, octaves = 4, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(seed + o * 101, x * f, y * f) * amp;
    norm += amp;
    amp *= gain;
    f *= 2.03;
  }
  return sum / norm;
}
