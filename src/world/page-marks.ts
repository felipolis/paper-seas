/**
 * How each standing card is made, printed on the page at its foot (the papercraft skill's score-line flap): a pale
 * score line across its hinge, half-way from the ground's colour to the paper stock, and on the wider cards a kraft glue
 * tab at each end of its base. They follow the card's own foot (the silhouette's base, measured from its print, so a
 * tree's line runs under its trunk, a bush's under its whole base) and lie on the camera side of the hinge, where the
 * card never covers them, folded or standing.
 */
import * as THREE from 'three';
import { PALETTE } from '../config/palette';
import { HERO_HEIGHT } from '../config/flora';
import { spriteImage, spriteInfo } from '../art/sprites';
import { createPaperMaterial } from '../render/paper-material';

/** The score line: its width across the hinge, and how far it runs past each end of the base (world units). */
const SCORE_WIDTH = 0.03 * HERO_HEIGHT;
const SCORE_OVER = 0.02 * HERO_HEIGHT;
/** Glue tabs, on cards whose base is wider than TAB_MIN: width at the hinge and at the tip, depth, inset from each end. */
const TAB_MIN = 0.5 * HERO_HEIGHT;
const TAB_BASE = 0.18 * HERO_HEIGHT;
const TAB_TIP = 0.15 * HERO_HEIGHT;
const TAB_DEPTH = 0.12 * HERO_HEIGHT;
const TAB_INSET = 0.17 * HERO_HEIGHT;
/** How far above the page the marks lie (they are print on it). */
const LIFT = 0.0015;

/** One card's foot, as the marks need it. */
export interface Foot {
  sprite: string;
  flip: boolean;
  x: number;
  y: number;
  z: number;
  height: number;
  yaw: number;
}

const spans = new Map<string, [number, number]>();

/**
 * Where a sprite's silhouette meets its base: [left, right] as shares of its width, from the lowest rows of its print
 * that hold any paper (cached per sprite).
 */
function baseSpan(sprite: string): [number, number] {
  const known = spans.get(sprite);
  if (known) return known;
  const img = spriteImage(sprite);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const solid = (x: number, y: number) => d[(y * c.width + x) * 4 + 3] > 128;
  let left = c.width;
  let right = -1;
  // (the lowest row with paper, and a few rows above it: the foot of the cut, not a stray pixel)
  let bottom = c.height - 1;
  while (bottom > 0 && !Array.from({ length: c.width }, (_, x) => solid(x, bottom)).some(Boolean)) bottom--;
  for (let y = bottom; y > bottom - Math.max(2, Math.round(c.height * 0.02)) && y >= 0; y--) {
    for (let x = 0; x < c.width; x++) {
      if (!solid(x, y)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  const span: [number, number] = right < left ? [0.4, 0.6] : [left / c.width, (right + 1) / c.width];
  spans.set(sprite, span);
  return span;
}

/** A trapezoid lying on the page: its hinge edge (width 1) on z = 0, its tip (width TAB_TIP / TAB_BASE) at z = 1. */
function tabGeometry(): THREE.BufferGeometry {
  const t = TAB_TIP / TAB_BASE / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, t, 0, 1, -t, 0, 1], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5 + t, 1, 0.5 - t, 1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

function marksMesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, 64);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

export class PageMarks {
  readonly group = new THREE.Group();
  private scores: THREE.InstancedMesh;
  private tabs: THREE.InstancedMesh;

  constructor() {
    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // (half-way from the ground to the stock: the stock laid over the ground at half strength)
    const score = createPaperMaterial({ color: PALETTE.cutEdge, transparent: true, opacity: 0.5, vary: false });
    score.depthWrite = false;
    const tab = createPaperMaterial({ color: PALETTE.kraft });
    for (const m of [score, tab]) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.scores = marksMesh(flat, score);
    this.tabs = marksMesh(tabGeometry(), tab);
    this.group.add(this.scores, this.tabs);
  }

  /** Prints the marks of these feet (all of them, every time: cards come and go a chunk at a time). */
  rebuild(feet: Iterable<Foot>): void {
    const scores: THREE.Matrix4[] = [];
    const tabs: THREE.Matrix4[] = [];
    for (const f of feet) {
      const info = spriteInfo(f.sprite);
      const width = (f.height * info.w) / info.h;
      const [l, r] = baseSpan(f.sprite);
      // the base along the card's own x (the card centred on its place; a mirrored card mirrors its base)
      const a = (f.flip ? 0.5 - r : l - 0.5) * width;
      const b = (f.flip ? 0.5 - l : r - 0.5) * width;
      const ux = Math.cos(f.yaw);
      const uz = -Math.sin(f.yaw);
      _q.setFromAxisAngle(Y, f.yaw);
      const mid = (a + b) / 2;
      _p.set(f.x + ux * mid, f.y + LIFT, f.z + uz * mid);
      _s.set(b - a + 2 * SCORE_OVER, 1, SCORE_WIDTH);
      scores.push(new THREE.Matrix4().compose(_p, _q, _s));
      if (b - a < TAB_MIN) continue;
      for (const at of [a + TAB_INSET, b - TAB_INSET]) {
        _p.set(f.x + ux * at, f.y + LIFT, f.z + uz * at);
        _s.set(TAB_BASE, 1, TAB_DEPTH);
        tabs.push(new THREE.Matrix4().compose(_p, _q, _s));
      }
    }
    this.scores = this.fill(this.scores, scores);
    this.tabs = this.fill(this.tabs, tabs);
  }

  /** Writes the matrices into the mesh, growing it if they do not fit. */
  private fill(mesh: THREE.InstancedMesh, matrices: THREE.Matrix4[]): THREE.InstancedMesh {
    if (mesh.instanceMatrix.count < matrices.length) {
      const grown = marksMesh(mesh.geometry, mesh.material as THREE.Material);
      grown.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(Math.ceil(matrices.length * 1.5) * 16), 16);
      this.group.remove(mesh);
      mesh.dispose();
      this.group.add(grown);
      mesh = grown;
    }
    matrices.forEach((m, i) => mesh.setMatrixAt(i, _m.copy(m)));
    mesh.count = matrices.length;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }
}
