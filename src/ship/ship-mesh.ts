/**
 * The ship's hull, decks, cabins and fittings, built in Blender (tools/blender/build_ship.py ->
 * public/models/ship-<id>.glb) and dressed here with printed paper.
 *
 * The glb's parts are named by material: tiling printed wood (lower, wale, upper, inner, deck: their UVs are in world
 * units, the textures repeat), printed details (gallery, windows, cabin-door, gunport, scroll, crest, grating, the
 * ship's own figurehead, painted eyes: UVs 0..1) and plain coloured paper. Parts are merged into one mesh per material;
 * the wheel stays its own group so the ship can turn it with the rudder. Every material is the paper material (fibre,
 * relief, card edge).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { activeShip } from '../config/ships';
import { createPaperMaterial } from '../render/paper-material';
import { addGlowMap } from '../render/glow';

let scene: THREE.Object3D | null = null;
const textures = new Map<string, THREE.Texture>();
const TEX = `${import.meta.env.BASE_URL}models/tex/`;
const HULL = activeShip().hull;
/** The printed details every ship carries, and her own (her figurehead, a junk's painted eyes). */
const DETAILS = ['gallery', 'windows', 'cabin-door', 'gunport', 'scroll', 'crest', 'grating', ...(HULL.figurehead ? [HULL.figurehead] : []), ...(HULL.eyes ? ['eye'] : [])];

export async function loadShipMesh(): Promise<void> {
  const type = activeShip();
  const w = type.hull.wood;
  const names = [...new Set([w.lower, w.wale, w.upper, w.deck, ...DETAILS])];
  const loader = new THREE.TextureLoader();
  const [gltf] = await Promise.all([
    new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/ship-${type.id}.glb`),
    ...names.map(async (n) => {
      const t = await loader.loadAsync(`${TEX}${n}.png`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      if (!DETAILS.includes(n)) t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
      textures.set(n, t);
    }),
  ]);
  scene = gltf.scene;
}

/** The paper material for every part of the ship. */
function materials(): Record<string, THREE.Material> {
  const type = activeShip();
  const w = type.hull.wood;
  const wood = (name: string, tint = '#ffffff') => createPaperMaterial({ map: textures.get(name)!, color: tint, back: null, alphaTest: 0 });
  const detail = (name: string) => createPaperMaterial({ map: textures.get(name)!, color: type.hull.detailTint ?? '#ffffff', back: '#4a3020' });
  const plain = (color: string) => createPaperMaterial({ color, back: null });
  const out: Record<string, THREE.Material> = {
    lower: wood(w.lower),
    wale: wood(w.wale),
    upper: wood(w.upper),
    // the inside of the bulwarks: the same planks, in the shade
    inner: wood(w.upper, '#9a8470'),
    deck: wood(w.deck, '#fff6e6'),
    rail: plain(type.hull.trim),
    dark: plain('#4a3020'),
    wood: plain(type.hull.fittings ?? '#9a6a40'),
    gold: plain(type.hull.trim),
    iron: plain('#3b3633'),
    rope: plain('#b89a6a'),
    // a wreck's weed and slime
    weed: plain('#5a7356'),
  };
  for (const d of DETAILS) out[d] = detail(d);
  // the lit stern windows glow at night, in the colour of her light
  // (the mask is an sRGB canvas: the light's sRGB components)
  const light = new THREE.Color(type.hull.windowLight ?? CANDLELIGHT).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  for (const d of ['gallery', 'windows', 'cabin-door']) {
    const m = out[d] as THREE.MeshLambertMaterial;
    addGlowMap(m, lightMask(textures.get(d)!, light));
  }
  return out;
}

/** Warm candlelight: the default colour of lit windows (sRGB of the mask's 1 : 0.82 : 0.55). */
const CANDLELIGHT = '#ffd18c';

/** The warm lit pixels of a printed detail (its window panes) as an emissive mask, in the given light's colour. */
function lightMask(tex: THREE.Texture, light: THREE.RGB): THREE.Texture {
  const img = tex.image as HTMLImageElement;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2];
    const warm = r > 200 && g > 150 && b < 150 && r - b > 80;
    const v = warm ? Math.min(255, (r + g) / 2) : 0;
    d.data[i] = v * light.r;
    d.data[i + 1] = v * light.g;
    d.data[i + 2] = v * light.b;
    d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = tex.flipY;
  return t;
}

export interface ShipMeshParts {
  /** Merged static hull and deck, one mesh per material. */
  meshes: THREE.Mesh[];
  /** The ship's wheel, positioned on its axle (turn it about its local z). */
  helm: THREE.Group;
}

export function buildShipMesh(): ShipMeshParts {
  if (!scene) throw new Error('ship mesh not loaded');
  const mats = materials();
  scene.updateMatrixWorld(true);
  const root = scene.getObjectByName('ship') ?? scene;
  const rootInv = root.matrixWorld.clone().invert();
  const helmNode = root.getObjectByName('helm');
  const helmInv = helmNode ? helmNode.matrixWorld.clone().invert() : null;
  const byMaterial = new Map<string, THREE.BufferGeometry[]>();
  const helm = new THREE.Group();
  const local = new THREE.Matrix4();

  const prepare = (mesh: THREE.Mesh, frame: THREE.Matrix4): [string, THREE.BufferGeometry] => {
    const name = (mesh.material as THREE.Material).name;
    let g = mesh.geometry.clone();
    g = g.index ? g.toNonIndexed() : g;
    g.applyMatrix4(local.multiplyMatrices(frame, mesh.matrixWorld));
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    // glTF texture coordinates run from the top: back to the paper material's convention
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (uv) for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    return [name, g];
  };

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let inHelm = false;
    for (let a: THREE.Object3D | null = o.parent; a; a = a.parent) if (a === helmNode) inHelm = true;
    if (inHelm && helmInv) {
      const [name, g] = prepare(mesh, helmInv);
      const m = new THREE.Mesh(g, mats[name]);
      m.castShadow = true;
      helm.add(m);
      return;
    }
    const [name, g] = prepare(mesh, rootInv);
    let list = byMaterial.get(name);
    if (!list) byMaterial.set(name, (list = []));
    list.push(g);
  });

  const meshes: THREE.Mesh[] = [];
  for (const [name, list] of byMaterial) {
    const mat = mats[name];
    if (!mat) throw new Error(`ship material "${name}" has no paper material`);
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.name = `ship-${name}`;
    m.castShadow = true;
    m.receiveShadow = true;
    meshes.push(m);
  }
  if (helmNode) helm.position.setFromMatrixPosition(local.multiplyMatrices(rootInv, helmNode.matrixWorld));
  return { meshes, helm };
}
