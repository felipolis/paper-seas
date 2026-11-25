export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
export const DEG = Math.PI / 180;

/** '#rrggbb' -> [r, g, b] (0..255). */
export const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** The value t (0..1) of the way across a [min, max] range (papertrails' range tunables). */
export const mixRange = (r: readonly number[], t: number): number => r[0] + (r[1] - r[0]) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * papertrails' rank gate (life/life.js there): the piece of this rank (0..1) in a pool shows once the pool's amount
 * (0..1) reaches its rank, fading in, so the pool fills and empties piece by piece in rank order.
 */
export const rankGate = (amount: number, rank: number): number => smoothstep(0, 1, (amount - rank * 0.88) / 0.12);

/** Moves `value` toward `target` by at most `maxDelta`. */
export function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(value + maxDelta, target);
  return Math.max(value - maxDelta, target);
}

