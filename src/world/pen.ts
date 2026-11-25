/**
 * A pen: a diamond of low fence cards turned 45 degrees either way to the camera, one left out on the near side for
 * a gate, and the herd inside it. Its fences are 0.18 tall, low enough for the captain to step over: they are
 * passable cards. Villages and meadows both keep one now and then.
 */
import { cardWidth } from '../art/sprites';

const FENCE = 'fence-rail';
/** The fence cards' height (world units). */
const FENCE_HEIGHT = 0.18;
/** Fence cards along each side of the diamond, a little overlapped. */
const PER_SIDE = 3;
const OVERLAP = 0.97;
/** The herd stands about the middle, this far apart. */
const APART = 0.24;

export interface Pen {
  /** Its middle. */
  x: number;
  z: number;
  fence: string;
  height: number;
  /** The fences: where, and their yaw (radians). */
  fences: Array<[number, number, number]>;
  /** The herd: who, and where. */
  herd: Array<[string, number, number]>;
  /** The ground the pen holds round its middle (nothing grows in it or right in front of it). */
  room: number;
}

/** A pen about (x, z): its fences round a diamond, and two or three goats (or now and then a pig) in it. */
export function penAt(x: number, z: number, rng: () => number): Pen {
  const height = FENCE_HEIGHT * (0.95 + rng() * 0.1);
  const w = cardWidth(FENCE, height) * OVERLAP;
  // the diamond's corners north, east, south and west of the middle, each side PER_SIDE cards long
  const r = (PER_SIDE * w) / Math.SQRT2;
  const corners: Array<[number, number]> = [[0, -r], [r, 0], [0, r], [-r, 0], [0, -r]];
  const fences: Array<[number, number, number]> = [];
  for (let side = 0; side < 4; side++) {
    const [ax, az] = corners[side];
    const [bx, bz] = corners[side + 1];
    // (a card's width runs along (cos yaw, -sin yaw): the side's own direction)
    const yaw = Math.atan2(-(bz - az), bx - ax);
    for (let k = 0; k < PER_SIDE; k++) {
      // (the gate: the middle card of the near-left side, toward the camera)
      if (side === 2 && k === Math.floor(PER_SIDE / 2)) continue;
      const t = (k + 0.5) / PER_SIDE;
      fences.push([x + ax + (bx - ax) * t, z + az + (bz - az) * t, yaw]);
    }
  }
  const kinds = rng() < 0.75 ? Array<string>(2 + Math.floor(rng() * 2)).fill('goat') : ['pig'];
  const herd = kinds.map((who, k): [string, number, number] => [who, x + (k - (kinds.length - 1) / 2) * APART + (rng() - 0.5) * 0.06, z + (rng() - 0.5) * 0.12]);
  return { x, z, fence: FENCE, height, fences, herd, room: r + 0.3 };
}
