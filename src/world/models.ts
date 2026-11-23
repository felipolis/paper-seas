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
import { tintMaterial } from '../render/biome-tint';
import type { Biome } from './land';

export interface ModelInfo {
  /** Footprint width (x) and depth (z) of the assembled model, and its height. */
  width: number;
  depth: number;
  height: number;
  /** A pier's / bridge's walkable deck: its height above the foot at the ends, and how much it rises at the middle. */
  deck: number;
  rise: number;
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
  /** Per bone (index > 0): its fold. */
  folds: Array<{ foldAngle: number; delay: number; size: number; layer: number }>;
  /** What blocks the feet once it stands (model space, scaled): see blockers.ts. */
  foot: Segment[];
  /** Its size in the world (SCALE). */
  scale: number;
  /** The top of its chimney (model space, scaled), if it has one. */
  smoke: THREE.Vector3 | null;
}

/**
 * Size of each model in the world, after papertrails' proportions (its traveller and our captain are 0.6 tall): a
 * house about 1.1 tall, a church steeple 1.55, a watchtower 1.5. The Blender build keeps its own units; the rest is 1.
 */
const SCALE: Record<string, number> = { hut: 0.72, tavern: 0.85, chapel: 0.72, fort: 1, lighthouse: 0.8 };

const prototypes = new Map<string, Prototype>();
let material: THREE.MeshLambertMaterial | null = null;

/** Loads the models and their atlas (once, at startup). */
export async function loadModels(base = `${import.meta.env.BASE_URL}models/`): Promise<void> {
  const [gltf, atlas, glow] = await Promise.all([
    new GLTFLoader().loadAsync(`${base}models.glb`),
    new THREE.TextureLoader().loadAsync(`${base}atlas.png`),
    new THREE.TextureLoader().loadAsync(`${base}atlas-glow.png`),
  ]);
  // glTF texture coordinates address the image from the top
  atlas.flipY = false;
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  material = createPaperMaterial({ map: atlas });
  glow.flipY = false;
  glow.colorSpace = THREE.SRGBColorSpace;
  addGlowMap(material, glow);
  pencilPlan(material, 'object');
  for (const node of gltf.scene.children) {
    const name = node.userData.model as string | undefined;
    if (name) prototypes.set(name, prototype(node, SCALE[name] ?? 1, SOLID.test(name)));
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
  folds.push({ foldAngle: 0, delay: 0, size: 0, layer: 0 });
  boneOf.set(root, rootBone);
  const local = new THREE.Matrix4();
  let smoke: THREE.Vector3 | null = null;
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
    const mesh = o as THREE.Mesh;
    let size = 0.3;
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
      const s = new THREE.Vector3();
      g2.boundingBox!.getSize(s);
      size = Math.max(s.x, s.y, s.z);
      // the chimney's top, where its smoke rises from
      if (o.name.endsWith('__chimney')) {
        const bb = g2.boundingBox!;
        smoke = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y, (bb.min.z + bb.max.z) / 2).multiplyScalar(scale);
      }
      parts.push(g2);
    }
    folds.push({ foldAngle: Number(o.userData.foldAngle ?? -Math.PI / 2), delay: Number(o.userData.delay ?? 0), size, layer: Number(o.userData.layer ?? 0) });
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
      rise: Number(root.userData.rise ?? 0) * scale,
      profile:
        root.userData.rampShare === undefined
          ? null
          : { share: Number(root.userData.rampShare), ramp: (Number(root.userData.rampDeg) * Math.PI) / 180, crown: (Number(root.userData.crownDeg) * Math.PI) / 180 },
    },
    geometry,
    bones,
    boneInverses,
    folds,
    foot: solid ? hullSegments(footSegments(geometry, scale)) : footSegments(geometry, scale),
    scale,
    smoke,
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
  const rootBone = proto.bones[0].clone(true);
  const bones: THREE.Bone[] = [];
  rootBone.traverse((b) => bones.push(b as THREE.Bone));
  // (papertrails tints a tile's pieces by its biome, render/biome-tint.ts)
  const paper = paperCopy(tintMaterial(material, biome, name));
  const mesh = new THREE.SkinnedMesh(proto.geometry, paper);
  mesh.add(rootBone);
  mesh.bind(new THREE.Skeleton(bones, proto.boneInverses), new THREE.Matrix4());
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.scale.setScalar(proto.scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // culled with its assembled bounds (it is hidden while folded flat)
  mesh.boundingSphere = proto.geometry.boundingSphere!.clone();
  mesh.boundingBox = proto.geometry.boundingBox!.clone();
  // papertrails: all the pieces of a tile start within its 0.34 s stagger span
  const fold = new FoldGroup();
  bones.forEach((b, i) => {
    if (i === 0) return;
    const f = proto.folds[i];
    let depth = 0;
    for (let a = b.parent; a && a !== rootBone; a = a.parent) depth++;
    // (a piece rides on the piece it is hinged to: it follows it as it opens, papertrails' and the skill's NESTED flaps)
    const parent = b.parent !== rootBone ? (b.parent ?? undefined) : undefined;
    fold.add(b, { foldAngle: f.foldAngle, delay: f.delay, size: f.size, seed: (i * 0.618034 + x * 0.37 + z * 0.73) % 1, wobble: 0.7, lift: 0.006 * (depth + 1) + 0.012 * f.layer, parent });
  });
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
