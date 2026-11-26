/**
 * Card meshes. A painted card face (CardArt) becomes either
 *   - a thick die-cut card: the print's own silhouette (traced from its alpha) extruded into real cardstock, printed
 *     on both faces (folded either way, a card never shows a blank back) with a cut edge of dark card core (a darker
 *     cut of the print's own tone), its face darkening just above the foot (contact shading, baked per vertex), or
 *   - a plain plane, shaded at its foot the same way (a print with no traced outline, or a card asked to stay thin).
 * Both stand upright on their hinge line (bottom edge at y = 0 in card units).
 */
import * as THREE from 'three';
import type { CardArt } from '../art/card-painter';
import { CARD_WALL_ATTRIBUTE, createPaperMaterial } from '../render/paper-material';
import { contoursFromGrid, outlinesWithHoles } from '../world/contours';
import { simplify, type Pt } from '../world/polyline';
import { clamp } from '../core/math';

/** Cardstock thickness (world units) of a standing card. */
export const CARD_THICKNESS = 0.016;

const materialCache = new WeakMap<CardArt, THREE.MeshLambertMaterial>();

/** One shared paper material per painted card face, printed on both sides. */
export function materialFor(art: CardArt): THREE.MeshLambertMaterial {
  let mat = materialCache.get(art);
  if (!mat) {
    mat = createPaperMaterial({ back: null, map: art.texture });
    materialCache.set(art, mat);
  }
  return mat;
}

/**
 * Contact shading, baked into every card's vertex colours (12 % darker at the hinge over ~11 % of the captain's
 * height): the face at its hinge (and below it), rising smoothly to full colour over this height
 * (world units) above it.
 */
const FOOT_SHADE = 0.88;
const FOOT_RAMP = 0.065;
/**
 * The card's side (its stock's thickness): the print's own tone darkened toward a dark umber, with a hint of the
 * cream core (more darkening and less core on dark prints, so a pine never shows a pale edge).
 */
const EDGE_UMBER = [0x2b, 0x1a, 0x0e].map((v) => v / 255);
const EDGE_CORE = [0xf4, 0xe6, 0xc8].map((v) => v / 255);

const edgeTones = new WeakMap<object, THREE.Color>();

/** The colour of a print's side: the mean of its art, as EDGE_UMBER says. Cached per image. */
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
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  if (!n) return fallback;
  // (mixed in sRGB, as hex colours are)
  const mean = [r / n / 255, g / n / 255, b / n / 255];
  const dark = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2] < 0.42;
  const [toUmber, toCore] = dark ? [0.5, 0.06] : [0.45, 0.1];
  const side = mean.map((v, k) => {
    const shaded = v + (EDGE_UMBER[k] - v) * toUmber;
    return shaded + (EDGE_CORE[k] - shaded) * toCore;
  });
  const tone = new THREE.Color().setRGB(side[0], side[1], side[2], THREE.SRGBColorSpace);
  edgeTones.set(image, tone);
  return tone;
}

/**
 * Every card geometry carries a vertex colour, so one material draws the face and the edge: the face is shaded from
 * its hinge (y = 0) up over ramp (card units), the walls (from index wallsFrom on) carry the edge colour (a card's own
 * tone, the clump shading, is its instance colour: world/card-field.ts).
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

/**
 * Upright plane card geometry: x across, y up, z = 0 (bottom edge on the hinge line). height: the world height a
 * unit-tall card is usually drawn at (its contact shading is measured in world units).
 */
export function cardGeometry(art: CardArt, o: { height?: number } = {}): THREE.PlaneGeometry {
  const w = art.right - art.left;
  const h = art.top - art.bottom;
  const ramp = FOOT_RAMP / (o.height ?? 1);
  // rows no further apart than the contact ramp, so the shading rises over it and not over the whole card
  const g = new THREE.PlaneGeometry(w, h, 1, Math.min(8, Math.ceil(h / ramp)));
  g.translate((art.left + art.right) / 2, (art.bottom + art.top) / 2, 0);
  paintVertices(g, ramp, edgeColour(art.texture));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Silhouettes and thick cards
// ---------------------------------------------------------------------------------------------

/**
 * The silhouette is traced at the print's own resolution (larger prints scaled down to this many pixels on their long
 * side), so the card's edge follows the printed outline to within a pixel. A gap in a larger print narrower than one
 * trace pixel closes in the trace: a pixel or two of the print, too fine to show.
 */
const TRACE_SIZE = 384;
/**
 * How far (trace pixels) the traced outline may stray from the alpha contour when its points are thinned: under a
 * pixel, too little to see, and the walls far lighter than one point per pixel.
 */
const TRACE_TOLERANCE = 0.6;
/** The alpha the outline is traced at: just inside the print's die cut (render/paper-material.ts CARDSTOCK.cut). */
const TRACE_ALPHA = 0.5;

/**
 * Silhouette loops of a texture in uv space (0..1), traced at TRACE_ALPHA: the loops run along the printed outline,
 * a hair inside the die cut (never more than TRACE_TOLERANCE off it), so the card's edge shows round the print.
 * Cached per image.
 */
const silhouettes = new WeakMap<object, Pt[][]>();

function silhouette(texture: THREE.Texture): Pt[][] | null {
  const image = texture.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!image || !image.width) return null;
  let loops = silhouettes.get(image);
  if (loops) return loops;
  const s = Math.min(1, TRACE_SIZE / Math.max(image.width, image.height));
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
  // field < 0 inside the card; rows flipped so v grows upward like the texture
  const values = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) values[(H - 1 - y) * W + x] = TRACE_ALPHA - data[(y * W + x) * 4 + 3] / 255;
  // one grid cell = one pixel (the 1 px transparent frame closes every loop); converted to uv afterwards
  const raw = contoursFromGrid({ x0: -1, z0: -1, cell: 1, nx: w + 1, nz: h + 1, values });
  // (specks a few pixels round are left out)
  loops = raw
    .filter((loop) => loop.length >= 12)
    .map((loop) => simplify(loop, TRACE_TOLERANCE).map(([x, y]) => [x / w, y / h] as Pt))
    .filter((loop) => loop.length >= 3);
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
 *   edge   the card's thickness: walls extruded from the traced outline, which follows the print a hair inside its die
 *          cut, so the edge shows as the card's dark side round the print seen at an angle, and no wall strays
 *          visibly outside the printed shape (none shows through a notch of a pine or between palm fronds).
 *
 * With unit = true the card is 1 unit tall (to be scaled per instance) and 1 unit deep (the instance's z scale is
 * then the thickness). half cuts the card down its middle and keeps one side (+1: x >= 0, -1: x <= 0), its cut edge
 * a wall like the rest: the half cards, the second plane of a slotted cross (world/card-field.ts).
 */
export function thickCardGeometry(art: CardArt, o: { flipX?: boolean; unit?: boolean; height?: number; half?: 1 | -1 } = {}): THREE.BufferGeometry | null {
  const loops = silhouette(art.texture);
  if (!loops) return null;
  const w = art.right - art.left;
  const hgt = art.top - art.bottom;
  const scale = o.unit ? 1 / hgt : 1;
  const depth = o.unit ? 1 : CARD_THICKNESS;
  const key = `${(art.texture as THREE.Texture).uuid}|${art.left.toFixed(4)}|${art.right.toFixed(4)}|${art.bottom.toFixed(4)}|${art.top.toFixed(4)}|${o.flipX ? 1 : 0}|${o.unit ? 1 : 0}|${o.height ?? 1}|${o.half ?? 0}`;
  const cached = thickCache.get(key);
  if (cached) return cached;
  const toCard = (u: number, v: number) => new THREE.Vector2((art.left + (o.flipX ? 1 - u : u) * w) * scale, (art.bottom + v * hgt) * scale);
  const uvAt = (x: number, y: number): THREE.Vector2 => {
    const u = (x / scale - art.left) / w;
    return new THREE.Vector2(o.flipX ? 1 - u : u, (y / scale - art.bottom) / hgt);
  };

  // ---- the face: a strip at the foot (the contact shading rises over it) and the rest ----
  const x0 = o.half === 1 ? 0 : art.left * scale;
  const x1 = o.half === -1 ? 0 : art.right * scale;
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
    const cut = (loop: readonly Pt[]) => keepSide(loop.map(([u, v]) => toCard(u, v)), o.half);
    for (const { outer, holes } of outlinesWithHoles(loops)) {
      const kept = cut(outer);
      if (kept.length < 3) continue;
      const shape = new THREE.Shape(kept);
      for (const hole of holes) {
        const h = cut(hole);
        if (h.length >= 3) shape.holes.push(new THREE.Path(h));
      }
      shapes.push(shape);
    }
    const uvGen = {
      generateTopUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number): THREE.Vector2[] {
        return [a, b, c].map((k) => uvAt(v[k * 3], v[k * 3 + 1]));
      },
      // (the walls take their vertex colour alone, CARD_WALL_ATTRIBUTE; their uv is the print where they stand)
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
  const wall = new Float32Array(pos.length / 3);
  wall.fill(1, faceVerts);
  g.setAttribute(CARD_WALL_ATTRIBUTE, new THREE.Float32BufferAttribute(wall, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  thickCache.set(key, g);
  return g;
}

/**
 * The part of a closed outline on one side of the card's middle (x = 0; side undefined: all of it). An outline that
 * crosses the middle more than twice comes back as one loop joined along x = 0, gaps and all: its wall there is the
 * half card's hinge edge, pressed against the card's face once standing and lying no taller than the half is thick.
 */
function keepSide(pts: THREE.Vector2[], side?: 1 | -1): THREE.Vector2[] {
  if (!side) return pts;
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ia = a.x * side >= 0;
    if (ia) out.push(a);
    if (ia !== b.x * side >= 0) out.push(new THREE.Vector2(0, a.y + ((b.y - a.y) * a.x) / (a.x - b.x)));
  }
  return out;
}

/**
 * The material of a thick card: the face's own print material, reading the vertex colour (the contact shading on the
 * face, the edge tint on the walls). The walls stand on the print's outline and are not cut by its alpha (they
 * take the vertex colour alone). Plane cards (cardGeometry) carry the face's shading too, so the same material serves
 * both.
 */
export function thickMaterial<M extends THREE.Material>(print: M): M {
  if (!(print as THREE.Material & { vertexColors: boolean }).vertexColors) {
    print.vertexColors = true;
    print.needsUpdate = true;
  }
  return print;
}

/** An upright card mesh standing on its hinge line. flipX mirrors the print (a creature heading the other way). */
export function createCard(art: CardArt, o: { material?: THREE.Material; flipX?: boolean; thin?: boolean } = {}): THREE.Mesh {
  const print = o.material ?? materialFor(art);
  const image = art.texture.image;
  const thick = !o.thin && (image instanceof HTMLImageElement || image instanceof HTMLCanvasElement)
    ? thickCardGeometry(art, { flipX: o.flipX })
    : null;
  let mesh: THREE.Mesh;
  if (thick) {
    mesh = new THREE.Mesh(thick, thickMaterial(print));
  } else {
    const g = cardGeometry(art);
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

