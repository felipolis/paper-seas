/**
 * Lily pads on the ponds (world/ponds.ts): the giant water lily's round die-cut paper pads (public/art lily-*,
 * generated seen from above, notch, ribs and the card's cut line printed on them), lying on the water, turned every
 * way, now and then one with its pink lily open. Packed once into a little strip (one square cell per print), laid as
 * flat quads a hair over the water; not mirrored (they lie on the water, render/reflection.ts).
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { mirrorSkip } from '../render/reflection';
import { spriteImage } from '../art/sprites';
import { LAND_TOP } from './land';
import { pondRadius, type Pond } from './ponds';

/** A hair over the streams' and ponds' water (world/stream-mesh.ts STREAM_Y). */
const PAD_Y = LAND_TOP + 0.007;
/** Pads on a pond, their radius range, how far out from the middle they may float (share of the shore's radius). */
const COUNT: [number, number] = [4, 7];
const SIZE: [number, number] = [0.13, 0.22];
const REACH = 0.7;
/** The prints: the plain pads, then the pad with its flower (FLOWER of the pads carry it). */
const PRINTS = ['lily-0', 'lily-1', 'lily-2', 'lily-3', 'lily-flower'];
const FLOWER = 0.2;
/** Pixels of a cell of the strip. */
const CELL = 256;

let material: THREE.MeshLambertMaterial | null = null;

/** The pads' prints, packed once into a strip of square cells (each print centred in its own, aspect kept). */
function padMaterial(): THREE.MeshLambertMaterial {
  if (material) return material;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * PRINTS.length;
  canvas.height = CELL;
  const ctx = canvas.getContext('2d')!;
  PRINTS.forEach((name, k) => {
    const img = spriteImage(name);
    const s = CELL / Math.max(img.width, img.height);
    ctx.drawImage(img, k * CELL + (CELL - img.width * s) / 2, (CELL - img.height * s) / 2, img.width * s, img.height * s);
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const m = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  mirrorSkip.add(m);
  material = m;
  return m;
}

/** The pads of these ponds as one mesh (each pond's own, from its id), or null. */
export function lilyPads(ponds: readonly Pond[]): THREE.Mesh | null {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (const p of ponds) {
    const rng = mulberry32(p.id ^ 0x5bd1e995);
    const placed: Array<[number, number, number]> = [];
    const n = COUNT[0] + Math.floor(rng() * (COUNT[1] - COUNT[0] + 1));
    for (let t = 0; t < n * 4 && placed.length < n; t++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * pondRadius(p, a) * REACH;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      const s = SIZE[0] + rng() * (SIZE[1] - SIZE[0]);
      // (pads touch, never overlap)
      if (placed.some(([ox, oz, os]) => Math.hypot(ox - x, oz - z) < (os + s) * 0.9)) continue;
      placed.push([x, z, s]);
      const cell = rng() < FLOWER ? PRINTS.length - 1 : Math.floor(rng() * (PRINTS.length - 1));
      const turn = rng() * Math.PI * 2;
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      const base = pos.length / 3;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(x + (u * c - v * sn) * s, PAD_Y, z + (u * sn + v * c) * s);
        uv.push((cell + (u + 1) / 2) / PRINTS.length, (v + 1) / 2);
      }
      // (counter-clockwise seen from above)
      index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  if (!index.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, padMaterial());
  mesh.receiveShadow = true;
  return mesh;
}
