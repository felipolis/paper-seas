/**
 * The small cut-paper pieces of the ambient life (leaves, petals, dust, rain streaks and splash rings, birds). Each is
 * a quad creased down its middle (the halves bent back a little, so it catches the light like folded card), cut out by
 * a white shape with a darker lip of thickness under it, tinted per piece, lit by the scene and written to depth (so
 * the lens blurs it with the scene).
 *
 * One InstancedMesh per shape; a kind whose pieces come in several shapes keeps one per shape and draws each piece in
 * its own. Pieces are written allocation-free straight into the instance matrices.
 */
import * as THREE from 'three';
import { hash01 } from '../core/rng';
import { createPaperMaterial } from '../render/paper-material';
import { TAU } from '../core/math';


export type Shape = 'leaf' | 'leaf2' | 'petal' | 'flake' | 'dot' | 'bar' | 'ring' | 'bird';

type Draw = (g: CanvasRenderingContext2D, top: boolean) => void;

/** The shapes in a unit cell (x right, y down), and whether they have a lip; 'bar' is a plain quad. */
const SHAPES: Record<Exclude<Shape, 'bar'>, { draw: Draw; lip: boolean }> = {
  leaf: {
    lip: true,
    draw: (g, top) => {
      g.beginPath(); g.moveTo(0, -1); g.quadraticCurveTo(0.82, -0.1, 0, 1); g.quadraticCurveTo(-0.82, -0.1, 0, -1); g.fill();
      if (top) crease(g, [0, -0.8, 0, 0.9]);
    },
  },
  leaf2: {
    lip: true,
    draw: (g, top) => {
      poly(g, [0, -1, 0.3, -0.45, 0.85, -0.55, 0.6, -0.05, 0.95, 0.3, 0.4, 0.4, 0.3, 0.95, 0, 0.6, -0.3, 0.95, -0.4, 0.4, -0.95, 0.3, -0.6, -0.05, -0.85, -0.55, -0.3, -0.45]);
      if (top) crease(g, [0, -0.7, 0, 0.8]);
    },
  },
  petal: {
    lip: true,
    draw: (g, top) => {
      g.beginPath(); g.moveTo(0, 1); g.bezierCurveTo(0.95, 0.5, 0.75, -0.9, 0.12, -0.92); g.lineTo(0, -0.7); g.lineTo(-0.12, -0.92); g.bezierCurveTo(-0.75, -0.9, -0.95, 0.5, 0, 1); g.fill();
      if (top) crease(g, [0, -0.5, 0, 0.8]);
    },
  },
  flake: { lip: true, draw: (g) => poly(g, [0, -0.9, 0.8, -0.42, 0.74, 0.5, 0, 0.92, -0.8, 0.46, -0.76, -0.44]) },
  dot: { lip: false, draw: (g) => { g.beginPath(); g.arc(0, 0, 0.85, 0, TAU); g.fill(); } },
  ring: { lip: false, draw: (g) => { g.lineWidth = 0.24; g.beginPath(); g.arc(0, 0, 0.8, 0, TAU); g.stroke(); } },
  // seen from above, nose toward the top; the quad's crease is its body, so the wings fold on it
  bird: {
    lip: true,
    draw: (g, top) => {
      poly(g, [0, -0.78, 0.16, -0.42, 0.62, -0.5, 1.12, -0.08, 0.6, -0.08, 0.2, 0.12, 0.12, 0.5, 0.3, 0.86, 0, 0.72, -0.3, 0.86, -0.12, 0.5, -0.2, 0.12, -0.6, -0.08, -1.12, -0.08, -0.62, -0.5, -0.16, -0.42]);
      if (top) crease(g, [0, -0.6, 0, 0.6]);
    },
  },
};

function crease(g: CanvasRenderingContext2D, pts: number[]): void {
  g.save();
  g.strokeStyle = '#d2cabb';
  g.lineWidth = 0.07;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.stroke();
  g.restore();
}

function poly(g: CanvasRenderingContext2D, pts: number[]): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fill();
}

const textures = new Map<Shape, THREE.Texture>();

/**
 * A shape's texture: white paper over a lip of thickness. Canvas pixels are premultiplied (everything outside the
 * shape is transparent black, which would darken the rims in the small mips), so it is copied into a data texture
 * with white under alpha 0 (rows flipped: v up).
 */
function shapeTexture(shape: Exclude<Shape, 'bar'>): THREE.Texture {
  let tex = textures.get(shape);
  if (tex) return tex;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const { draw, lip } = SHAPES[shape];
  g.translate(S / 2, S / 2);
  g.scale(S * 0.42, S * 0.42);
  if (lip) {
    g.save();
    g.translate(0.07, 0.09);
    g.fillStyle = g.strokeStyle = '#a9a092';
    draw(g, false);
    g.restore();
  }
  g.fillStyle = g.strokeStyle = '#ffffff';
  draw(g, true);
  const src = g.getImageData(0, 0, S, S).data;
  const px = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const s = (y * S + x) * 4;
      const d = ((S - 1 - y) * S + x) * 4;
      const a = src[s + 3];
      if (a < 8) px[d] = px[d + 1] = px[d + 2] = 255;
      else {
        px[d] = src[s];
        px[d + 1] = src[s + 1];
        px[d + 2] = src[s + 2];
        px[d + 3] = a;
      }
    }
  }
  tex = new THREE.DataTexture(px, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  textures.set(shape, tex);
  return tex;
}

/** A creased quad: unit square in XY, the two halves bent back 0.16 from the crease along Y. */
function creasedQuad(): THREE.BufferGeometry {
  const b = 0.16;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, b, 0, -0.5, 0, 0, 0.5, 0, -0.5, 0.5, b, 0, -0.5, 0, 0.5, -0.5, b, 0.5, 0.5, b, 0, 0.5, 0], 3));
  const nx = 0.305;
  const nz = 0.952;
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz, -nx, 0, nz, -nx, 0, nz, -nx, 0, nz, -nx, 0, nz], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0.5, 0, 0.5, 1, 0, 1, 0.5, 0, 1, 0, 1, 1, 0.5, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return geo;
}
const QUAD = creasedQuad();

/** Zero scale: the instance draws nothing. */
export function hideMatrix(A: THREE.TypedArray, i: number): void {
  const o = i * 16;
  A[o] = A[o + 1] = A[o + 2] = A[o + 4] = A[o + 5] = A[o + 6] = A[o + 8] = A[o + 9] = A[o + 10] = 0;
}

/** R = Ry(yaw) * Rx(pitch) * Rz(roll); the quad lies in local XY (normal +Z), scaled sx / sy. */
export function putMatrix(A: THREE.TypedArray, i: number, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, sx: number, sy: number): void {
  const o = i * 16;
  const cy = Math.cos(yaw);
  const sy_ = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx_ = Math.sin(pitch);
  const cz = Math.cos(roll);
  const sz = Math.sin(roll);
  A[o] = (cy * cz + sy_ * sx_ * sz) * sx; A[o + 1] = cx * sz * sx; A[o + 2] = (-sy_ * cz + cy * sx_ * sz) * sx;
  A[o + 4] = (-cy * sz + sy_ * sx_ * cz) * sy; A[o + 5] = cx * cz * sy; A[o + 6] = (sy_ * sz + cy * sx_ * cz) * sy;
  A[o + 8] = sy_ * cx * sx; A[o + 9] = -sx_ * sx; A[o + 10] = cy * cx * sx;
  A[o + 12] = x; A[o + 13] = y; A[o + 14] = z;
}

/** Explicit basis: X and Y unit axes, Z = X x Y; sz scales the crease depth (the fold of the halves). */
function putBasis(A: THREE.TypedArray, i: number, x: number, y: number, z: number, Xx: number, Xy: number, Xz: number, Yx: number, Yy: number, Yz: number, sx: number, sy: number, sz: number): void {
  const o = i * 16;
  A[o] = Xx * sx; A[o + 1] = Xy * sx; A[o + 2] = Xz * sx;
  A[o + 4] = Yx * sy; A[o + 5] = Yy * sy; A[o + 6] = Yz * sy;
  A[o + 8] = (Xy * Yz - Xz * Yy) * sz; A[o + 9] = (Xz * Yx - Xx * Yz) * sz; A[o + 10] = (Xx * Yy - Xy * Yx) * sz;
  A[o + 12] = x; A[o + 13] = y; A[o + 14] = z;
}

/** A pool of `count` pieces of a kind, each cut in one of `shapes` and tinted one of `colors` (shaded +-10 %). */
export class Bits {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** Per piece: the mesh it is drawn in. */
  private readonly pick: Uint8Array;

  constructor(count: number, shapes: readonly Shape[], colors: readonly string[], salt: number) {
    const distinct = [...new Set(shapes)];
    for (const s of distinct) {
      const material = createPaperMaterial({ map: s === 'bar' ? null : shapeTexture(s), back: null });
      const mesh = new THREE.InstancedMesh(QUAD, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      const A = mesh.instanceMatrix.array;
      A.fill(0);
      for (let i = 0; i < count; i++) A[i * 16 + 15] = 1;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.pick = new Uint8Array(count);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.pick[i] = distinct.indexOf(shapes[Math.floor(hash01(salt + 5, i, 0) * shapes.length)]);
      c.set(colors[Math.floor(hash01(salt + 3, i, 0) * colors.length)]).multiplyScalar(0.9 + 0.1 * hash01(salt + 4, i, 0));
      for (const m of this.meshes) m.setColorAt(i, c);
    }
  }

  /** Places piece i (see putMatrix). */
  put(i: number, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, sx: number, sy: number): void {
    putMatrix(this.meshes[this.pick[i]].instanceMatrix.array, i, x, y, z, yaw, pitch, roll, sx, sy);
  }

  /** Places piece i by its axes: X and Y (unit), sx / sy their scales, sz the depth of its crease. */
  putBasis(i: number, x: number, y: number, z: number, Xx: number, Xy: number, Xz: number, Yx: number, Yy: number, Yz: number, sx: number, sy: number, sz: number): void {
    putBasis(this.meshes[this.pick[i]].instanceMatrix.array, i, x, y, z, Xx, Xy, Xz, Yx, Yy, Yz, sx, sy, sz);
  }

  hide(i: number): void {
    hideMatrix(this.meshes[this.pick[i]].instanceMatrix.array, i);
  }

  /** Uploads this frame's pieces. */
  commit(): void {
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}
