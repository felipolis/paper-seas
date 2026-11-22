/**
 * Card meshes. A painted card face (CardArt) becomes either
 *   - a thick die-cut card: the print's own silhouette (traced from its alpha) extruded into real cardstock, printed
 *     on both faces (like papertrails' cards: folded either way, a card never shows a blank back) with a cut edge of
 *     dark card core (a darker cut of the print's own tone), its face darkening just above the foot (papertrails'
 *     contact shading, baked per vertex), or
 *   - a plain plane (drawn cards whose geometry is bent afterwards: transom, bulkhead...).
 * Both stand upright on their hinge line (bottom edge at y = 0 in card units).
 */
import * as THREE from 'three';
import type { CardArt } from '../art/card-painter';
import { createPaperMaterial, type PaperOptions } from '../render/paper-material';
import { contoursFromGrid, outlinesWithHoles } from '../world/contours';
import type { Pt } from '../world/polyline';
import { clamp } from '../core/math';

/** Cardstock thickness (world units) of a standing card (papertrails' assets.js: 0.016). */
export const CARD_THICKNESS = 0.016;

const materialCache = new WeakMap<CardArt, THREE.MeshLambertMaterial>();

/** One shared paper material per painted card face, printed on both sides unless options.back says otherwise. */
export function materialFor(art: CardArt, options: Omit<PaperOptions, 'map'> = {}): THREE.MeshLambertMaterial {
  let mat = materialCache.get(art);
  if (!mat) {
    mat = createPaperMaterial({ back: null, ...options, map: art.texture });
    materialCache.set(art, mat);
  }
  return mat;
}

/**
 * papertrails' contact shading, baked into every card's vertex colours (tiles.glb): the face at its hinge (and below
 * it), rising smoothly to full colour over this height (world units) above it.
 */
const FOOT_SHADE = 0.787;
const FOOT_RAMP = 0.21;
/** papertrails' cut edge: the card's own tone darkened per channel (sRGB; median of its cards in tiles.glb). */
const EDGE_DARK = [0.62, 0.65, 0.78];

const edgeTones = new WeakMap<object, THREE.Color>();

/** The colour of a print's cut edge: the mean of its art (the cream border left out), darkened. Cached per image. */
function edgeColour(texture: THREE.Texture): THREE.Color {
  const image = texture.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  const fallback = new THREE.Color('#4a4a3a');
  if (!image || !image.width) return fallback;
  const known = edgeTones.get(image);
  if (known) return known;
  const s = Math.min(1, 64 / Math.max(image.width, image.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(image.width * s));
  c.height = Math.max(1, Math.round(image.height * s));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
    if (mn > 175 && mx - mn < 70) continue; // the cream die-cut border
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  const tone = n ? new THREE.Color().setRGB((r / n / 255) * EDGE_DARK[0], (g / n / 255) * EDGE_DARK[1], (b / n / 255) * EDGE_DARK[2], THREE.SRGBColorSpace) : fallback;
  edgeTones.set(image, tone);
  return tone;
}

/**
 * Every card geometry carries a vertex colour, so one material draws the face and the edge: the face is shaded from
 * its hinge (y = 0) up over ramp (card units), the walls (from index wallsFrom on) carry the edge colour (a card's own
 * tone, papertrails' clump shading, is its instance colour: world/card-field.ts).
 */
function paintVertices(g: THREE.BufferGeometry, ramp: number, edge: THREE.Color, wallsFrom = Infinity): void {
  const P = g.getAttribute('position');
  const n = P.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (i >= wallsFrom) {
      c[i * 3] = edge.r;
      c[i * 3 + 1] = edge.g;
      c[i * 3 + 2] = edge.b;
      continue;
    }
    const t = clamp(P.getY(i) / ramp, 0, 1);
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = FOOT_SHADE + (1 - FOOT_SHADE) * t * t * (3 - 2 * t);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
}

export interface CardGeometryOptions {
  segmentsX?: number;
  segmentsY?: number;
  /** The world height a unit-tall card is usually drawn at (its contact shading is measured in world units). */
  height?: number;
}

/** Upright plane card geometry: x across, y up, z = 0 (bottom edge on the hinge line). */
export function cardGeometry(art: CardArt, o: CardGeometryOptions = {}): THREE.PlaneGeometry {
  const w = art.right - art.left;
  const h = art.top - art.bottom;
  const ramp = FOOT_RAMP / (o.height ?? 1);
  // rows no further apart than the contact ramp, so the shading rises over it and not over the whole card
  const g = new THREE.PlaneGeometry(w, h, o.segmentsX ?? 1, Math.max(o.segmentsY ?? 1, Math.min(8, Math.ceil(h / ramp))));
  g.translate((art.left + art.right) / 2, (art.bottom + art.top) / 2, 0);
  paintVertices(g, ramp, edgeColour(art.texture));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Silhouettes and thick cards
// ---------------------------------------------------------------------------------------------

/**
 * Silhouette loops of a texture in uv space (0..1), traced at alpha 0.5 of the print shrunk by one trace pixel, so
 * the loops always run just inside the printed shape. Cached per image.
 */
const silhouettes = new WeakMap<object, Pt[][]>();

function silhouette(texture: THREE.Texture): Pt[][] | null {
  const image = texture.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!image || !image.width) return null;
  let loops = silhouettes.get(image);
  if (loops) return loops;
  const max = 72;
  const s = Math.min(1, max / Math.max(image.width, image.height));
  const w = Math.max(4, Math.round(image.width * s));
  const h = Math.max(4, Math.round(image.height * s));
  const W = w + 2;
  const H = h + 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 1, 1, w, h);
  const data = ctx.getImageData(0, 0, W, H).data;
  // erode: each pixel takes the least alpha of its 3 x 3 neighbourhood
  const alpha = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = 255;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          const a = xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : data[(yy * W + xx) * 4 + 3];
          if (a < m) m = a;
        }
      }
      alpha[y * W + x] = m / 255;
    }
  }
  // field < 0 inside the card; rows flipped so v grows upward like the texture
  const values = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) values[(H - 1 - y) * W + x] = 0.5 - alpha[y * W + x];
  // one grid cell = one pixel (the 1 px transparent frame closes every loop); converted to uv afterwards
  const raw = contoursFromGrid({ x0: -1, z0: -1, cell: 1, nx: w + 1, nz: h + 1, values }, 0);
  loops = raw
    .map((loop) => loop.filter((_, i) => i % 2 === 0).map(([x, y]) => [x / w, y / h] as Pt))
    .filter((loop) => loop.length >= 6);
  silhouettes.set(image, loops);
  return loops;
}

const thickCache = new Map<string, THREE.BufferGeometry>();

/** Traces the silhouettes of these card faces now (load time) instead of the first time each one appears. */
export function prewarmSilhouettes(arts: CardArt[]): void {
  for (const a of arts) silhouette(a.texture);
}

/**
 * Thick card geometry for a card face, drawn in one call with the face's own material (see thickMaterial): the
 * edge is told apart by its vertex colour.
 *
 *   face   one quad at z = +depth/2 carrying the print; its alpha cuts the card's outline exactly (and its shadow).
 *          The face is double-sided: seen from behind it shows the same print, cut the same way.
 *   edge   the card's thickness: walls extruded from the traced outline, which runs just inside the print, so a wall
 *          never stands outside the printed shape (no pale kraft or stray wall showing through a notch of a pine or
 *          between palm fronds) and only shows as the card's depth when seen at an angle.
 *
 * With unit = true the card is 1 unit tall (to be scaled per instance) and 1 unit deep (the instance's z scale is
 * then the thickness).
 */
export function thickCardGeometry(art: CardArt, o: { flipX?: boolean; unit?: boolean; height?: number } = {}): THREE.BufferGeometry | null {
  const loops = silhouette(art.texture);
  if (!loops) return null;
  const w = art.right - art.left;
  const hgt = art.top - art.bottom;
  const scale = o.unit ? 1 / hgt : 1;
  const depth = o.unit ? 1 : CARD_THICKNESS;
  const key = `${(art.texture as THREE.Texture).uuid}|${art.left.toFixed(4)}|${art.right.toFixed(4)}|${art.bottom.toFixed(4)}|${art.top.toFixed(4)}|${o.flipX ? 1 : 0}|${o.unit ? 1 : 0}|${o.height ?? 1}`;
  const cached = thickCache.get(key);
  if (cached) return cached;
  const toCard = (u: number, v: number) => new THREE.Vector2((art.left + (o.flipX ? 1 - u : u) * w) * scale, (art.bottom + v * hgt) * scale);
  const uvAt = (x: number, y: number): THREE.Vector2 => {
    const u = (x / scale - art.left) / w;
    return new THREE.Vector2(o.flipX ? 1 - u : u, (y / scale - art.bottom) / hgt);
  };

  // ---- the face: a strip at the foot (the contact shading rises over it) and the rest ----
  const x0 = art.left * scale;
  const x1 = art.right * scale;
  const y0 = art.bottom * scale;
  const y1 = art.top * scale;
  const zf = depth / 2;
  const ramp = FOOT_RAMP / (o.height ?? 1);
  const ym = Math.min(y1, y0 + ramp);
  const pos: number[] = [x0, y0, zf, x1, y0, zf, x1, ym, zf, x0, y0, zf, x1, ym, zf, x0, ym, zf, x0, ym, zf, x1, ym, zf, x1, y1, zf, x0, ym, zf, x1, y1, zf, x0, y1, zf];
  const faceVerts = pos.length / 3;
  const nrm: number[] = [];
  const uvs: number[] = [];
  for (let k = 0; k < faceVerts; k++) {
    nrm.push(0, 0, 1);
    const t = uvAt(pos[k * 3], pos[k * 3 + 1]);
    uvs.push(t.x, t.y);
  }

  // ---- the cut edge: only the walls of the extruded outline ----
  if (loops.length) {
    const shapes: THREE.Shape[] = [];
    for (const { outer, holes } of outlinesWithHoles(loops)) {
      const shape = new THREE.Shape(outer.map(([u, v]) => toCard(u, v)));
      for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([u, v]) => toCard(u, v))));
      shapes.push(shape);
    }
    const uvGen = {
      generateTopUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number): THREE.Vector2[] {
        return [a, b, c].map((k) => uvAt(v[k * 3], v[k * 3 + 1]));
      },
      // the edge shows the card's own colour: the print right where the wall stands (just inside its outline)
      generateSideWallUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number, d: number): THREE.Vector2[] {
        return [a, b, c, d].map((k) => uvAt(v[k * 3], v[k * 3 + 1]));
      },
    };
    const ex = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 1, UVGenerator: uvGen });
    ex.translate(0, 0, -depth / 2);
    const wall = ex.groups.find((gr) => gr.materialIndex === 1);
    if (wall) {
      const P = ex.getAttribute('position');
      const N = ex.getAttribute('normal');
      const U = ex.getAttribute('uv');
      for (let i = wall.start; i < wall.start + wall.count; i++) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i));
        nrm.push(N.getX(i), N.getY(i), N.getZ(i));
        uvs.push(U.getX(i), U.getY(i));
      }
    }
    ex.dispose();
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  paintVertices(g, ramp, edgeColour(art.texture), faceVerts);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  thickCache.set(key, g);
  return g;
}

/**
 * The material of a thick card: the face's own print material, reading the vertex colour (the contact shading on the
 * face, the edge tint on the walls). The walls stand inside the print's outline, so the print's alpha cut leaves them whole.
 * Plane cards (cardGeometry) carry the face's shading too, so the same material serves both.
 */
export function thickMaterial<M extends THREE.Material>(print: M): M {
  if (!(print as THREE.Material & { vertexColors: boolean }).vertexColors) {
    print.vertexColors = true;
    print.needsUpdate = true;
  }
  return print;
}

/** An upright card mesh standing on its hinge line. flipX mirrors the print (a creature heading the other way). */
export function createCard(art: CardArt, o: CardGeometryOptions & { material?: THREE.Material; flipX?: boolean; thin?: boolean } = {}): THREE.Mesh {
  const print = o.material ?? materialFor(art);
  const thick = !o.thin && o.segmentsX === undefined && o.segmentsY === undefined && art.texture.image instanceof HTMLImageElement
    ? thickCardGeometry(art, { flipX: o.flipX })
    : null;
  let mesh: THREE.Mesh;
  if (thick) {
    mesh = new THREE.Mesh(thick, thickMaterial(print));
  } else {
    const g = cardGeometry(art, o);
    if (o.flipX) {
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    }
    mesh = new THREE.Mesh(g, print);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

