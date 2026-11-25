/**
 * The Blender-built pop-up models (tools/blender/build_models.py -> public/models/models.glb): buildings made of
 * real paper pieces joined by hinges, printed from one atlas (public/models/atlas.png).
 *
 * Each model is turned into ONE skinned mesh: every hinged piece is a bone (the glTF node hierarchy, so a roof
 * plane rides on its side wall which rides on the front), all pieces merged into one geometry weighted to their
 * bone. A building is therefore a single draw call, however many pieces it has, and its pieces unfold through the
 * same FoldGroup springs as every other card (rest * RotX(foldAngle * (1 - p)), staggered by each piece's delay).
 * The print is the paper material (cardstock grain and relief, kraft back), and its lit windows glow at night. Folded
 * flat, a model fades toward a pencil plan far from the page focus, as every folded card does (papertrails' printed
 * twin of its folded tiles): each building draws with its own copy of the material, carrying how flat it lies.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FoldGroup } from '../popup/fold-group';
import { createPaperMaterial, paperCopy, pencilPlan, setPaperFlat } from '../render/paper-material';
import { addGlowMap, setGlowShare } from '../render/glow';
import { footSegments, hullSegments, type Segment } from './blockers';
import { POPUP } from '../config/popup';
import { cellKey } from '../core/grid';
import { tintMaterial } from '../render/biome-tint';
import type { Biome } from './land';

export interface ModelInfo {
  /** Footprint width (x) and depth (z) of the assembled model, and its height. */
  width: number;
  depth: number;
  height: number;
  /** A pier's / bridge's walkable deck: its height above the foot at the ends. */
  deck: number;
  /**
   * A bridge's deck profile (the skill's bridge): a ramp rising at `ramp` (rad) over `share` of each half span from the
   * bank, then the crown at `crown` (rad) to the middle; null for a level deck.
   */
  profile: { share: number; ramp: number; crown: number } | null;
}

interface Prototype {
  info: ModelInfo;
  geometry: THREE.BufferGeometry;
  /** The bone tree (root first), in rest pose; cloned per building. */
  bones: THREE.Bone[];
  boneInverses: THREE.Matrix4[];
  /**
   * Per bone (index > 0): its fold; size, the upright height (world units) of the piece with all that rides on it;
   * layer, its place in a flat stack; liftSign, -1 for a piece whose face points into the one it folds against (a
   * slotted cross's front half).
   */
  folds: Array<{ foldAngle: number; delay: number; size: number; layer: number; liftSign: number }>;
  /** Per bone (index > 0): how far its piece stands off its own face while folded flat (model units; < 0: behind it). */
  lifts: number[];
  /** Per bone: what lifts it clear of the pieces it would lie on folded flat (its parent's space; see separateFlat). */
  stacks: Array<THREE.Vector3 | null>;
  /** What blocks the feet once it stands (model space, scaled): see blockers.ts. */
  foot: Segment[];
  /** Its size in the world (SCALE). */
  scale: number;
  /** The top of its chimney (model space, scaled), if it has one. */
  smoke: THREE.Vector3 | null;
  /** What it is culled with (model space): its bounds standing, grown over its pieces folded flat (see foldedBounds). */
  sphere: THREE.Sphere;
  box: THREE.Box3;
}

/**
 * Size of each model in the world, after papertrails' proportions (its traveller and our captain are 0.6 tall): a
 * house about 1.1 tall, a church steeple 1.55, a watchtower 1.5. The Blender build keeps its own units; the rest is 1.
 */
const SCALE: Record<string, number> = { hut: 0.72, tavern: 0.85, chapel: 0.72, fort: 1, lighthouse: 0.8 };

const prototypes = new Map<string, Prototype>();
let material: THREE.MeshLambertMaterial | null = null;

/**
 * Loads the models and their atlas (once, at startup); paperMaps: the cardstock maps their paper material is printed
 * with (art/paper-maps.ts loadPaperMaps), loading meanwhile.
 */
export async function loadModels(paperMaps: Promise<void>, base = `${import.meta.env.BASE_URL}models/`): Promise<void> {
  const [gltf, atlas, glow] = await Promise.all([
    new GLTFLoader().loadAsync(`${base}models.glb`),
    new THREE.TextureLoader().loadAsync(`${base}atlas.png`),
    new THREE.TextureLoader().loadAsync(`${base}atlas-glow.png`),
    paperMaps,
  ]);
  // glTF texture coordinates address the image from the top
  atlas.flipY = false;
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  const paper = createPaperMaterial({ map: atlas });
  glow.flipY = false;
  glow.colorSpace = THREE.SRGBColorSpace;
  addGlowMap(paper, glow);
  pencilPlan(paper, 'object');
  material = paper;
  for (const node of gltf.scene.children) {
    const name = node.userData.model as string | undefined;
    if (!name) continue;
    const proto = prototype(node, SCALE[name] ?? 1, SOLID.test(name));
    separateFlat(proto, paper);
    foldedBounds(proto, paper);
    prototypes.set(name, proto);
  }
}

/** A model's footprint: the walls of its base on the ground (model space, scaled), as a building's `foot`. */
export function modelFoot(name: string): Segment[] {
  const proto = prototypes.get(name);
  if (!proto) throw new Error(`model "${name}" not loaded`);
  return proto.foot;
}

/** The names of every loaded model (the construction clip check, tools/qa/model-clips.ts). */
export function modelNames(): string[] {
  return [...prototypes.keys()];
}

/** The heights (mountains, outcrops) are solid masses: their whole footprint blocks, not only their walls. */
const SOLID = /^(ridge|outcrop)-/;

export function modelInfo(name: string): ModelInfo | undefined {
  return prototypes.get(name)?.info;
}

/** Turns one exported model into a skinned prototype: bones from the hinge nodes, one merged geometry. */
function prototype(root: THREE.Object3D, scale: number, solid: boolean): Prototype {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const bones: THREE.Bone[] = [];
  const folds: Prototype['folds'] = [];
  const boneOf = new Map<THREE.Object3D, THREE.Bone>();
  const parts: THREE.BufferGeometry[] = [];
  const rootBone = new THREE.Bone();
  bones.push(rootBone);
  folds.push({ foldAngle: 0, delay: 0, size: 0, layer: 0, liftSign: 1 });
  boneOf.set(root, rootBone);
  const local = new THREE.Matrix4();
  let smoke: THREE.Vector3 | null = null;
  // each bone's parent, and the height span (model space) of its piece with all that rides on it
  const indexOf = new Map<THREE.Object3D, number>([[root, 0]]);
  const parentOf = [-1];
  const lowest = [Infinity];
  const highest = [-Infinity];
  root.traverse((o) => {
    if (o === root) return;
    const bone = new THREE.Bone();
    bone.name = o.name;
    bone.position.copy(o.position);
    bone.quaternion.copy(o.quaternion);
    bone.scale.copy(o.scale);
    boneOf.get(o.parent!)!.add(bone);
    boneOf.set(o, bone);
    const index = bones.length;
    bones.push(bone);
    indexOf.set(o, index);
    parentOf.push(indexOf.get(o.parent!)!);
    lowest.push(Infinity);
    highest.push(-Infinity);
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      // the piece's vertices in model space (its rest pose), weighted to its bone
      local.multiplyMatrices(rootInv, mesh.matrixWorld);
      const g = mesh.geometry.clone().applyMatrix4(local);
      const g2 = g.index ? g.toNonIndexed() : g;
      const n = g2.getAttribute('position').count;
      g2.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).map((_, i) => (i % 4 === 0 ? index : 0)), 4));
      g2.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
      for (const name of Object.keys(g2.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(name)) g2.deleteAttribute(name);
      g2.computeBoundingBox();
      lowest[index] = g2.boundingBox!.min.y;
      highest[index] = g2.boundingBox!.max.y;
      // the chimney's top, where its smoke rises from
      if (o.name.endsWith('__chimney')) {
        const bb = g2.boundingBox!;
        smoke = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y, (bb.min.z + bb.max.z) / 2).multiplyScalar(scale);
      }
      parts.push(g2);
    }
    folds.push({ foldAngle: Number(o.userData.foldAngle ?? -Math.PI / 2), delay: Number(o.userData.delay ?? 0), size: 0, layer: Number(o.userData.layer ?? 0), liftSign: Number(o.userData.liftSign ?? 1) });
  });
  // papertrails' flap size (fold.js there): the upright height of the piece with all that rides on it, in world units
  // (its 0.05 to 1 tile), 0.3 tile for a piece without geometry; the bones come after their parents, so walking back
  // gathers every piece's riders before the piece itself is measured
  for (let i = bones.length - 1; i > 0; i--) {
    const p = parentOf[i];
    lowest[p] = Math.min(lowest[p], lowest[i]);
    highest[p] = Math.max(highest[p], highest[i]);
    const h = (highest[i] - lowest[i]) * scale;
    folds[i].size = Number.isFinite(h) ? Math.min(2, Math.max(0.1, h)) : 0.6;
  }
  // folded, a piece stands off its face by its depth in the tree and its layer (so a piece folded onto the one it is
  // hinged to lies on it); separateFlat lifts apart the pieces that still meet
  const lifts = parentOf.map((_, i) => {
    let depth = 0;
    for (let p = parentOf[i]; p > 0; p = parentOf[p]) depth++;
    return (0.006 * (depth + 1) + 0.012 * folds[i].layer) * folds[i].liftSign;
  });
  const geometry = merge(parts);
  // bind pose: every bone's world matrix in model space
  rootBone.updateMatrixWorld(true);
  const boneInverses = bones.map((b) => b.matrixWorld.clone().invert());
  return {
    info: {
      width: Number(root.userData.width ?? 1) * scale,
      depth: Number(root.userData.depth ?? 1) * scale,
      height: Number(root.userData.height ?? 1) * scale,
      deck: Number(root.userData.deck ?? 0) * scale,
      profile:
        root.userData.rampShare === undefined
          ? null
          : { share: Number(root.userData.rampShare), ramp: (Number(root.userData.rampDeg) * Math.PI) / 180, crown: (Number(root.userData.crownDeg) * Math.PI) / 180 },
    },
    geometry,
    bones,
    boneInverses,
    folds,
    lifts,
    stacks: bones.map(() => null),
    foot: solid ? hullSegments(footSegments(geometry, scale)) : footSegments(geometry, scale),
    scale,
    smoke,
    sphere: geometry.boundingSphere!.clone(),
    box: geometry.boundingBox!.clone(),
  };
}

/** Concatenates non-indexed geometries with the same attributes. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
    const first = parts[0].getAttribute(name);
    const total = parts.reduce((n, p) => n + p.getAttribute(name).count, 0);
    const Ctor = (first.array as Float32Array).constructor as new (n: number) => Float32Array;
    const array = new Ctor(total * first.itemSize);
    let offset = 0;
    for (const p of parts) {
      const a = p.getAttribute(name);
      array.set(a.array as Float32Array, offset);
      offset += a.count * a.itemSize;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, first.itemSize));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export interface Building {
  root: THREE.Object3D;
  fold: FoldGroup;
  x: number;
  z: number;
  yaw: number;
  name: string;
  /** Its blocking footprint in its own space (placed with x, z, yaw). */
  foot: Segment[];
  /** The top of its chimney in the world, if it has one. */
  smoke: THREE.Vector3 | null;
  /**
   * Frees it. keepMaterial: its material stays in use, and with it the shader program compiled for it, so the buildings
   * that come later never compile it again (the load-time prewarm).
   */
  dispose(keepMaterial?: boolean): void;
}

/** A new building standing at (x, y, z), turned by yaw, folded flat until its FoldGroup raises it. */
export function buildModel(name: string, x: number, y: number, z: number, yaw: number, biome: Biome): Building {
  const proto = prototypes.get(name);
  if (!proto || !material) throw new Error(`model "${name}" not loaded`);
  // (papertrails tints a tile's pieces by its biome, render/biome-tint.ts)
  const paper = paperCopy(tintMaterial(material, biome, name));
  const { mesh, fold } = rig(proto, paper, x, z);
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // culled with its bounds standing and folded flat (folded, it is still drawn within sight: terrain.ts updateHouses)
  mesh.boundingSphere = proto.sphere.clone();
  mesh.boundingBox = proto.box.clone();
  fold.snap(0);
  mesh.onBeforeRender = () => {
    setPaperFlat(paper, 1 - fold.progress);
    // (its windows light up only as it stands: folded flat they lie dark on the page)
    const up = Math.min(1, Math.max(0, (fold.progress - 0.6) / 0.35));
    setGlowShare(paper, up * up * (3 - 2 * up));
  };
  return {
    root: mesh,
    fold,
    x,
    z,
    yaw,
    name,
    foot: proto.foot,
    smoke: proto.smoke ? proto.smoke.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, y, z)) : null,
    dispose(keepMaterial = false) {
      mesh.skeleton.dispose();
      if (!keepMaterial) paper.dispose();
    },
  };
}

/** A skinned copy of a prototype (scaled, at the origin) and the fold of its pieces; (x, z) seeds their flutter. */
function rig(proto: Prototype, paper: THREE.Material, x: number, z: number): { mesh: THREE.SkinnedMesh; fold: FoldGroup } {
  const rootBone = proto.bones[0].clone(true);
  const bones: THREE.Bone[] = [];
  rootBone.traverse((b) => bones.push(b as THREE.Bone));
  const mesh = new THREE.SkinnedMesh(proto.geometry, paper);
  mesh.add(rootBone);
  mesh.bind(new THREE.Skeleton(bones, proto.boneInverses), new THREE.Matrix4());
  mesh.scale.setScalar(proto.scale);
  // papertrails: all the pieces of a tile start within its 0.34 s stagger span
  const fold = new FoldGroup();
  bones.forEach((b, i) => {
    if (i === 0) return;
    const f = proto.folds[i];
    // (a piece rides on the piece it is hinged to: it follows it as it opens, papertrails' and the skill's NESTED flaps)
    const parent = b.parent !== rootBone ? (b.parent ?? undefined) : undefined;
    fold.add(b, { foldAngle: f.foldAngle, delay: f.delay, size: f.size, seed: i * 0.618034 + x * 0.37 + z * 0.73, lift: proto.lifts[i], stack: proto.stacks[i] ?? undefined, parent });
  });
  return { mesh, fold };
}

/** A face of a folded piece lies flat when its normal is this near vertical. */
const FLAT_NORMAL = 0.9;
/**
 * Two faces fight over the part of the area they share where they lie within a step of each other: more of it than
 * FIGHT_AREA (about 2 x 2 cm) and the piece moves. Faces crossing at an angle meet on a strip no wider than
 * 1.8 steps / their slope against each other: steeper than CROSS_SLOPE it is under a centimetre, a line, not a surface
 * flickering, and no lift short of clearing the whole crossing would remove it.
 */
const FIGHT_AREA = 0.0004;
const CROSS_SLOPE = 0.18;
/** The most steps a piece goes up or down to clear the ones before it. */
const MAX_STEPS = 24;
/** Side of the squares the folded faces are filed under, to find the ones a face lies over. */
const FACE_CELL = 0.1;

/** A flat face of the model folded flat (world units): its bone, corners (x, z), plane, bounds and how far it has moved. */
interface Face {
  bone: number;
  corners: Array<[number, number]>;
  /** Its plane as y = py + gx (x - px) + gz (z - pz), through its centre (px, py, pz). */
  px: number;
  py: number;
  pz: number;
  gx: number;
  gz: number;
  /** Its bounds: x, z across, and its lowest and highest corners. */
  box: [number, number, number, number];
  bottom: number;
  top: number;
  lift: number;
  /** The last face it was checked against (each pair once, whatever squares they share). */
  seen: Face | null;
}

/**
 * Lifts apart the pieces of a model that lie over each other folded flat at one height (POPUP.flatStep, as the cards'
 * card-field.ts layFlat): mirrored pieces, the two walls or the two roof slopes of a house, fold onto each other at the
 * same lift and flickered, the depth test picking either face frame by frame. Measured once on a copy folded flat (its
 * pieces skinned to flat faces); then piece by piece, in order, the fewest steps straight up or down that leave none of
 * its faces fighting a face of the pieces before it (FIGHT_AREA), as its stack turned into its parent's folded space,
 * the pieces riding on it going along. A face wholly under the model's base lies under the page, covered: it fights
 * nothing (so a piece may also clear a crossing by going down under it).
 */
function separateFlat(proto: Prototype, paper: THREE.Material): void {
  const { faces, turn, parent } = foldedFlat(proto, paper);
  // (the farthest a piece could move: faces farther apart never meet)
  const reach = (MAX_STEPS + 1) * POPUP.flatStep;
  const rides = (i: number, j: number) => {
    for (let p = parent[i]; p > 0; p = parent[p]) if (p === j) return true;
    return false;
  };
  // the FACE_CELL squares each face's corners reach, and the faces of the pieces done so far filed under them
  const cells = new Map<Face, number[]>();
  for (const f of faces) {
    const keys: number[] = [];
    for (let i = Math.floor(f.box[0] / FACE_CELL); i <= Math.floor(f.box[2] / FACE_CELL); i++) {
      for (let k = Math.floor(f.box[1] / FACE_CELL); k <= Math.floor(f.box[3] / FACE_CELL); k++) keys.push(cellKey(i, k));
    }
    cells.set(f, keys);
  }
  const filed = new Map<number, Face[]>();
  const byBone = parent.map((_, j) => faces.filter((f) => f.bone === j));
  for (let j = 1; j < byBone.length; j++) {
    // how far above each overlapped earlier face this piece's faces lie, least and most over the area they share
    const gaps: Gap[] = [];
    for (const f of byBone[j]) {
      for (const cell of cells.get(f)!) {
        for (const g of filed.get(cell) ?? []) {
          if (g.seen === f) continue;
          g.seen = f;
          // (farther apart than any move could bring them, or crossing)
          if (f.bottom + f.lift > g.top + g.lift + reach || g.bottom + g.lift > f.top + f.lift + reach) continue;
          if (f.box[0] >= g.box[2] || g.box[0] >= f.box[2] || f.box[1] >= g.box[3] || g.box[1] >= f.box[3]) continue;
          if (Math.hypot(f.gx - g.gx, f.gz - g.gz) > CROSS_SLOPE) continue;
          const shared = clip(f.corners, g.corners);
          const size = area(shared);
          if (size < FIGHT_AREA) continue;
          const d = shared.map(([x, z]) => heightOn(f, x, z) - heightOn(g, x, z));
          gaps.push({ lo: Math.min(...d), hi: Math.max(...d), area: size, top: f.top + f.lift, under: g.top + g.lift });
        }
      }
    }
    // (the height between them runs evenly over the shared area, from lo to hi: the share of it within a step)
    const s = POPUP.flatStep;
    const fights = (g: Gap, up: number) => {
      if (g.top + up < 0 || g.under < 0) return false;
      const lo = g.lo + up;
      const hi = g.hi + up;
      const within = Math.min(hi, POPUP.flatNear) - Math.max(lo, -POPUP.flatNear);
      return within > 0 && g.area * (hi - lo > 1e-9 ? within / (hi - lo) : 1) > FIGHT_AREA;
    };
    // the fewest steps that clear every fight (0, 1, -1, 2, -2 ...); none within MAX_STEPS: the piece stays
    let k = 0;
    for (let n = 0; n <= 2 * MAX_STEPS; n++) {
      const step = n % 2 ? (n + 1) / 2 : -n / 2;
      if (!gaps.some((g) => fights(g, step * s))) {
        k = step;
        break;
      }
    }
    if (k !== 0) {
      // (k steps up in the world, down if negative, in the parent's space as it lies folded; the bones are in model
      // units, the world scaled)
      proto.stacks[j] = new THREE.Vector3(0, (k * POPUP.flatStep) / proto.scale, 0).applyQuaternion(turn[parent[j]].clone().invert());
      for (const f of faces) if (f.bone === j || rides(f.bone, j)) f.lift += k * POPUP.flatStep;
    }
    for (const f of byBone[j]) {
      for (const cell of cells.get(f)!) {
        const list = filed.get(cell);
        if (list) list.push(f);
        else filed.set(cell, [f]);
      }
    }
  }
}

/** How far a later face lies above an earlier one over the area they share, and how high each reaches. */
interface Gap {
  lo: number;
  hi: number;
  area: number;
  /** The later face's highest corner, and the earlier one's (lifted as they are so far). */
  top: number;
  under: number;
}

/** A face's height at (x, z), lifted as it is so far. */
function heightOn(f: Face, x: number, z: number): number {
  return f.py + f.gx * (x - f.px) + f.gz * (z - f.pz) + f.lift;
}

/** The part of polygon a (x, z corners) inside triangle b (Sutherland-Hodgman, either winding). */
function clip(a: Array<[number, number]>, b: Array<[number, number]>): Array<[number, number]> {
  const turn = Math.sign((b[1][0] - b[0][0]) * (b[2][1] - b[0][1]) - (b[1][1] - b[0][1]) * (b[2][0] - b[0][0]));
  let out = a;
  for (let e = 0; e < 3 && out.length; e++) {
    const [x0, z0] = b[e];
    const [x1, z1] = b[(e + 1) % 3];
    const side = ([x, z]: [number, number]) => turn * ((x1 - x0) * (z - z0) - (z1 - z0) * (x - x0));
    const next: Array<[number, number]> = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      const q = out[(i + 1) % out.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) next.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    out = next;
  }
  return out;
}

/** The area of a polygon (x, z corners). */
function area(poly: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % poly.length];
    s += x0 * z1 - x1 * z0;
  }
  return Math.abs(s) / 2;
}

/**
 * Grows a prototype's culling bounds over its pieces folded flat (with their lifts, so after separateFlat): a folded
 * piece lies out round the foot, as far from its hinge as it stands tall, past the bounds of the standing model, and a
 * folded building is drawn within sight (terrain.ts updateHouses), so it must not vanish at the edge of the view.
 */
function foldedBounds(proto: Prototype, paper: THREE.Material): void {
  const { mesh, fold } = rig(proto, paper, 0, 0);
  fold.snap(0);
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const pos = proto.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  for (let k = 0; k < pos.count; k++) {
    // (the skinned vertex in the mesh's own space, as the bounds are)
    mesh.applyBoneTransform(k, v.fromBufferAttribute(pos, k));
    proto.sphere.expandByPoint(v);
    proto.box.expandByPoint(v);
  }
}

/**
 * The model folded flat at the origin (world units): its flat faces, how each bone is turned in the model (its rotation
 * under the root, folded) and the bone each is hinged to.
 */
function foldedFlat(proto: Prototype, paper: THREE.Material): { faces: Face[]; turn: THREE.Quaternion[]; parent: number[] } {
  const { mesh, fold } = rig(proto, paper, 0, 0);
  fold.snap(0);
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const bones = mesh.skeleton.bones;
  const turn = bones.map((b) => b.getWorldQuaternion(new THREE.Quaternion()));
  const parent = bones.map((b) => bones.indexOf(b.parent as THREE.Bone));
  const pos = proto.geometry.getAttribute('position');
  const bone = proto.geometry.getAttribute('skinIndex');
  const p = Array.from({ length: pos.count }, (_, k) => mesh.applyBoneTransform(k, new THREE.Vector3().fromBufferAttribute(pos, k)).applyMatrix4(mesh.matrixWorld));
  const faces: Face[] = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let k = 0; k < pos.count; k += 3) {
    const [a, b, c] = [p[k], p[k + 1], p[k + 2]];
    const n = e1.subVectors(b, a).cross(e2.subVectors(c, a));
    const size = n.length() / 2;
    if (size === 0 || Math.abs(n.y) < FLAT_NORMAL * 2 * size) continue;
    faces.push({
      bone: bone.getX(k),
      corners: [a, b, c].map((v): [number, number] => [v.x, v.z]),
      px: (a.x + b.x + c.x) / 3,
      py: (a.y + b.y + c.y) / 3,
      pz: (a.z + b.z + c.z) / 3,
      gx: -n.x / n.y,
      gz: -n.z / n.y,
      box: [Math.min(a.x, b.x, c.x), Math.min(a.z, b.z, c.z), Math.max(a.x, b.x, c.x), Math.max(a.z, b.z, c.z)],
      bottom: Math.min(a.y, b.y, c.y),
      top: Math.max(a.y, b.y, c.y),
      lift: 0,
      seen: null,
    });
  }
  return { faces, turn, parent };
}
