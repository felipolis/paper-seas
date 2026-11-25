/**
 * papertrails' pen (its fence_pad with the herd in it, on the meadow and the farm tiles): fence cards in a row behind
 * and a row in front, set square to the camera, and the herd between them toward the back, where the front row does
 * not hide it (a card 0.34 tall hides about 0.38 behind it, seen 42 degrees down). Villages and meadows both keep one.
 */
import { cardWidth } from '../art/sprites';
import { heightOf } from '../config/flora';
import type { Pt } from './polyline';

const FENCE = 'fence-rail';
/** Fence cards in each row, and the rows' distance apart (world units). */
const PER_ROW = 3;
const DEPTH = 0.95;
/** The herd stands this far behind the pen's middle, this far apart. */
const BACK = 0.14;
const APART = 0.34;

export interface Pen {
  fence: string;
  height: number;
  /** Half a fence card's width: the room each needs. */
  half: number;
  fences: Pt[];
  /** The herd: who, and where. */
  herd: Array<[string, number, number]>;
  /** The ground the pen holds round its middle (nothing grows in it or right in front of it). */
  room: number;
}

/** A pen about (x, z): its fences, and two or three goats (or now and then a pig) between them. */
export function penAt(x: number, z: number, rng: () => number): Pen {
  const height = heightOf(FENCE, rng());
  const w = cardWidth(FENCE, height) * 0.96;
  const fences = [-1, 1].flatMap((row) => Array.from({ length: PER_ROW }, (_, k): Pt => [x + (k - (PER_ROW - 1) / 2) * w, z + (row * DEPTH) / 2]));
  const kinds = rng() < 0.75 ? Array<string>(2 + Math.floor(rng() * 2)).fill('goat') : ['pig'];
  const herd = kinds.map((who, k): [string, number, number] => [who, x + (k - (kinds.length - 1) / 2) * APART + (rng() - 0.5) * 0.08, z - BACK + (rng() - 0.5) * 0.1]);
  return { fence: FENCE, height, half: w / 2, fences, herd, room: (w * PER_ROW) / 2 + DEPTH / 2 };
}
