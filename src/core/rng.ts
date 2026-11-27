/**
 * Deterministic randomness. The world is a pure function of (seed, position): nothing in world generation may use
 * Math.random, so a place always looks the same however you sail back to it. What moves (sea life, smoke, the weather,
 * the captain's idle breath, a sound's start in its loop) draws from a seeded stream of its own (stream()), so the same
 * voyage and the same input give the same frames (no unseeded random in anything that moves). Only a new voyage's own
 * seed is drawn at random (config/seed.ts).
 */
import { VOYAGE_SEED } from '../config/seed';

/** 32-bit integer hash of (seed, a, b). */
export function hash2(seed: number, a: number, b: number): number {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(a | 0, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** hash2 mapped to [0, 1). */
export function hash01(seed: number, a: number, b: number): number {
  return hash2(seed, a, b) / 4294967296;
}

/** One of the items, each as likely as its weight; r: a number in [0, 1). */
export function pickWeighted<T>(items: readonly T[], weight: (item: T) => number, r: number): T {
  let x = r * items.reduce((a, t) => a + weight(t), 0);
  for (const t of items) if ((x -= weight(t)) <= 0) return t;
  return items[items.length - 1];
}

/** Small fast seeded PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded random stream with a few helpers. */
export class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  float(): number {
    return this.next();
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

}

/** A seeded stream of [0, 1) numbers for one part of the game (name), drawn from the voyage's seed. */
export function stream(name: string): () => number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return mulberry32(hash2(VOYAGE_SEED, h, 0x5eed));
}
