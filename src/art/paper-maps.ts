/**
 * The paper maps (public/textures/paper): the fine card stock of every cut piece and the rougher page stock of the
 * ground, each a grey detail map (linear data, mean 0.5) and its tangent-space normal map (OpenGL +Y), and the edge
 * strip of stacked sheets for the land's cut edge. Loaded once at startup.
 *
 * The card maps are repacked into the one texture the paper material samples: RG = the normal's xy, B = the detail around its mean, A = a procedural cloud (the
 * 0.15-0.3 unit mottling).
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { addValueNoise } from './tile-noise';

/** The rougher page stock of the ground. */
export interface PageFibre {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  /** Mean luminance of the albedo (`imageMean`): the detail is read as albedo / mean - 1. */
  mean: number;
}

let cardDetail: THREE.Texture | null = null;
let cardPacked: THREE.DataTexture | null = null;
let page: PageFibre | null = null;
let sheetStrip: THREE.Texture | null = null;

/** A tiling data map, mipmapped and anisotropic (linear, repeat, flipY). */
function repeatTexture(image: HTMLImageElement): THREE.Texture {
  const t = new THREE.Texture(image);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Zero mean, unit variance. */
function normalise(a: Float32Array): Float32Array {
  let m = 0;
  for (const v of a) m += v;
  m /= a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) {
    a[i] -= m;
    v += a[i] * a[i];
  }
  const s = 1 / Math.sqrt(v / a.length + 1e-12);
  for (let i = 0; i < a.length; i++) a[i] *= s;
  return a;
}

/** The mottling cloud: three octaves of value noise. */
function makeCloud(n: number, rng: () => number): Float32Array {
  const c = new Float32Array(n * n);
  addValueNoise(c, n, 9, 1.0, rng);
  addValueNoise(c, n, 17, 0.7, rng);
  addValueNoise(c, n, 36, 0.35, rng);
  return normalise(c);
}

function pixels(image: HTMLImageElement, n: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, n, n);
  return ctx.getImageData(0, 0, n, n).data;
}

/** The card detail and normal maps and the cloud in one RGBA texture. */
function packCardFibre(detail: HTMLImageElement, normal: HTMLImageElement): THREE.DataTexture {
  const n = Math.min(1024, detail.width);
  const d = pixels(detail, n);
  const nm = pixels(normal, n);
  const cloud = makeCloud(n, mulberry32(0x7a11c3));
  let mean = 0;
  for (let i = 0; i < n * n; i++) mean += d[i * 4];
  mean /= n * n;
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = nm[i * 4];
    // canvas rows are top-down while this texture is uploaded bottom-up: the image is mirrored in v, so the normal's
    // v component is mirrored with it
    data[i * 4 + 1] = 255 - nm[i * 4 + 1];
    data[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(d[i * 4] - mean + 127.5)));
    data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((0.5 + cloud[i] * 0.16) * 255)));
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Mean luminance on a 32 px copy. */
function imageMean(image: HTMLImageElement): number {
  const d = pixels(image, 32);
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  return Math.max(0.05, s / (d.length / 4) / 255);
}

export async function loadPaperMaps(base = `${import.meta.env.BASE_URL}textures/paper/`): Promise<void> {
  const loader = new THREE.ImageLoader();
  const [card, cardNormal, pageAlbedo, pageNormal, edge] = await Promise.all(
    ['card_albedo.png', 'card_normal.jpg', 'page_albedo.png', 'page_normal.jpg', 'edge_strip.png'].map((f) => loader.loadAsync(base + f)),
  );
  cardDetail = repeatTexture(card);
  cardPacked = packCardFibre(card, cardNormal);
  page = { albedo: repeatTexture(pageAlbedo), normal: repeatTexture(pageNormal), mean: imageMean(pageAlbedo) };
  // a luminance strip in sRGB, repeating along the edge and clamped across it
  sheetStrip = repeatTexture(edge);
  sheetStrip.colorSpace = THREE.SRGBColorSpace;
  sheetStrip.wrapT = THREE.ClampToEdgeWrapping;
}

/** The card stock's grey detail map (mean 0.5), for fibre outside the paper material (the sea, the chart's grain). */
export function paperDetail(): THREE.Texture | null {
  return cardDetail;
}

/** The packed card fibre of the paper material (render/paper-material.ts). */
export function cardFibre(): THREE.DataTexture {
  if (!cardPacked) throw new Error('paper maps not loaded');
  return cardPacked;
}

/** The page stock of the ground (world/ground-shader.ts). */
export function pageFibre(): PageFibre {
  if (!page) throw new Error('paper maps not loaded');
  return page;
}

/**
 * The edge strip: the luminance of stacked sheets seen edge-on. u runs along the edge, v across it; the stacked-sheet
 * band is v 0.3125..1 (with flipY).
 */
export function edgeStrip(): THREE.Texture {
  if (!sheetStrip) throw new Error('paper maps not loaded');
  return sheetStrip;
}
