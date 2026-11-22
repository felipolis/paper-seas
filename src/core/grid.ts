/**
 * Exact number keys of grid cells (for maps and sets keyed by cell): every (i, j) with |i|, |j| < 32768 gets its own
 * key, so no two cells ever share a cached value.
 */

export const cellKey = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);
export const keyI = (k: number): number => Math.floor(k / 65536) - 32768;
export const keyJ = (k: number): number => (k % 65536) - 32768;
