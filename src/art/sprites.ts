/**
 * Illustrated card faces cut from the generated sprite sheets (tools/art/cut-sprites.mjs -> public/art).
 * All sprites are loaded once at startup (loadSprites) and then handed out as CardArt in world units.
 */
import * as THREE from 'three';
import type { CardArt } from './card-painter';

export interface SpriteInfo {
  w: number;
  h: number;
}

const images = new Map<string, HTMLImageElement>();
const textures = new Map<string, THREE.Texture>();
const arts = new Map<string, CardArt>();
let manifest: Record<string, SpriteInfo> = {};

/** Loads the manifest and every sprite image. Call (and await) before building anything that uses sprites. */
export async function loadSprites(base = `${import.meta.env.BASE_URL}art/`): Promise<void> {
  manifest = await (await fetch(`${base}manifest.json`)).json();
  await Promise.all(
    Object.keys(manifest).map(async (name) => {
      const img = new Image();
      img.src = `${base}${name}.png`;
      await img.decode();
      images.set(name, img);
    }),
  );
}

export function spriteInfo(name: string): SpriteInfo {
  const info = manifest[name];
  if (!info) throw new Error(`sprite "${name}" not in the manifest`);
  return info;
}

/** Names of all loaded sprites starting with `prefix`. */
export function spritesWithPrefix(prefix: string): string[] {
  return Object.keys(manifest).filter((n) => n.startsWith(prefix)).sort();
}

function textureFor(name: string): THREE.Texture {
  let tex = textures.get(name);
  if (!tex) {
    const img = images.get(name);
    if (!img) throw new Error(`sprite "${name}" not loaded`);
    tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    textures.set(name, tex);
  }
  return tex;
}

/** Per sprite, bottom-up rows of the opaque print: [left, right] (0..1 of the width) or null for an empty row. */
const ROWS = 48;
const rowSpans = new Map<string, Array<[number, number] | null>>();

function spansOf(name: string): Array<[number, number] | null> {
  let spans = rowSpans.get(name);
  if (!spans) {
    const img = images.get(name);
    if (!img) throw new Error(`sprite "${name}" not loaded`);
    const w = 96;
    const h = ROWS * 2;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    const a = ctx.getImageData(0, 0, w, h).data;
    spans = [];
    for (let r = 0; r < ROWS; r++) {
      let l = w;
      let rt = -1;
      for (const y of [h - 1 - r * 2, h - 2 - r * 2]) {
        for (let x = 0; x < w; x++) {
          if (a[(y * w + x) * 4 + 3] > 128) {
            l = Math.min(l, x);
            rt = Math.max(rt, x);
          }
        }
      }
      spans.push(rt >= 0 ? [l / w, (rt + 1) / w] : null);
    }
    rowSpans.set(name, spans);
  }
  return spans;
}

/**
 * The horizontal extent [left, right] (0..1 of the width) of the sprite's print between two heights given as
 * fractions of its height (0 = the bottom), or null where nothing is printed there.
 */
export function spriteSpan(name: string, from: number, to: number): [number, number] | null {
  const spans = spansOf(name);
  let l = 1;
  let r = 0;
  const r0 = Math.max(0, Math.floor(from * ROWS));
  const r1 = Math.min(ROWS - 1, Math.ceil(to * ROWS));
  for (let i = r0; i <= r1; i++) {
    const s = spans[i];
    if (!s) continue;
    l = Math.min(l, s[0]);
    r = Math.max(r, s[1]);
  }
  return r > l ? [l, r] : null;
}

/** The top of a sprite's print over the column u (0..1 across it), as a share of its height (0 if empty there). */
export function spriteTop(name: string, u: number): number {
  const spans = spansOf(name);
  for (let i = ROWS - 1; i >= 0; i--) {
    const s = spans[i];
    if (s && u >= s[0] && u <= s[1]) return (i + 1) / ROWS;
  }
  return 0;
}

export interface SpriteBounds {
  /** Height of the card in world units (the width follows the sprite's aspect unless given). */
  height: number;
  width?: number;
  /** Where the card's bottom edge sits relative to its hinge (default 0: standing on it). */
  bottom?: number;
  /** Horizontal anchor: 'center' (default) or 'left' (the card starts at x = 0, e.g. a flag on its hoist). */
  anchor?: 'center' | 'left';
}

/** The sprite as a card face of the given size (cached per name and size). */
export function spriteArt(name: string, b: SpriteBounds): CardArt {
  const info = spriteInfo(name);
  const height = b.height;
  const width = b.width ?? (height * info.w) / info.h;
  const bottom = b.bottom ?? 0;
  const left = b.anchor === 'left' ? 0 : -width / 2;
  const key = `${name}|${width.toFixed(4)}|${height.toFixed(4)}|${bottom.toFixed(4)}|${left.toFixed(4)}`;
  let art = arts.get(key);
  if (!art) {
    art = { texture: textureFor(name), left, right: left + width, bottom, top: bottom + height };
    arts.set(key, art);
  }
  return art;
}
