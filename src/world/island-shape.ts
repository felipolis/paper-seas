/**
 * Free-form island shapes as a signed distance field (negative on land, positive in the water, ~world units):
 * a union of lumpy ellipse "blobs" of land minus water "cuts" (lagoons, channels, bays). Contours of the field at
 * different levels give the shallow-water ring, the beach and the inland layer (marching squares), the gradient
 * gives shore normals for collisions.
 */
import { clamp } from '../core/math';

export interface Lump {
  k: number;
  amp: number;
  phase: number;
}

export interface Blob {
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  lumps: Lump[];
}

export type Cut =
  | { type: 'circle'; x: number; z: number; r: number }
  | { type: 'capsule'; x1: number; z1: number; x2: number; z2: number; r: number };

export interface IslandShape {
  blobs: Blob[];
  cuts: Cut[];
  /** Radius (from the island centre) that contains all land. */
  extent: number;
}

function blobDistance(b: Blob, x: number, z: number): number {
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const lx = (dx * c + dz * s) / b.rx;
  const lz = (-dx * s + dz * c) / b.rz;
  const rn = Math.sqrt(lx * lx + lz * lz);
  const th = Math.atan2(lz, lx);
  let k = 1;
  for (const l of b.lumps) k += l.amp * Math.sin(l.k * th + l.phase);
  return (rn - k) * Math.min(b.rx, b.rz);
}

function cutDistance(c: Cut, x: number, z: number): number {
  if (c.type === 'circle') return Math.hypot(x - c.x, z - c.z) - c.r;
  const vx = c.x2 - c.x1;
  const vz = c.z2 - c.z1;
  const len2 = vx * vx + vz * vz || 1;
  const t = clamp(((x - c.x1) * vx + (z - c.z1) * vz) / len2, 0, 1);
  return Math.hypot(x - (c.x1 + vx * t), z - (c.z1 + vz * t)) - c.r;
}

/** Signed distance (island-local coordinates): < 0 on land. */
export function shapeDistance(shape: IslandShape, x: number, z: number): number {
  let d = Infinity;
  for (const b of shape.blobs) d = Math.min(d, blobDistance(b, x, z));
  for (const c of shape.cuts) d = Math.max(d, -cutDistance(c, x, z));
  return d;
}
