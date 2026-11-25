/**
 * Paints the printed face of a die-cut card on a canvas, in card units (x right, y up, origin on the hinge line
 * at the card's bottom centre), and turns it into a texture.
 *
 * Every card is finished the same way, which is what makes the set read as one printed sheet:
 *   1. the art is filled and detailed by a painter (clipped to its outline where it wants)
 *   2. a light grain is printed over it
 *   3. a thin ink line traces the cut (the dark cut edge)
 * Anything left transparent is cut away (the card material alpha-tests it).
 */
import * as THREE from 'three';
import { PALETTE } from '../config/palette';
import { getGrainTile } from './noise-textures';

export interface CardBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** A painted card face: texture + the card-unit rectangle it covers. */
export interface CardArt extends CardBounds {
  texture: THREE.Texture;
}

export interface FinishOptions {
  /** Width of the ink cut line (card units). 0 = none. */
  ink?: number;
  /** Strength of the printed grain (0..1). */
  grain?: number;
}

const MAX_PX = 2048;

export class CardPainter {
  readonly ctx: CanvasRenderingContext2D;
  readonly canvas: HTMLCanvasElement;
  readonly bounds: CardBounds;

  /**
   * @param art   the rectangle the painter draws in (card units)
   * @param pad   margin added round it (but not under its hinge) so the cut line is not clipped
   */
  constructor(art: CardBounds, options: { ppu?: number; pad?: number } = {}) {
    const pad = options.pad ?? 0.05;
    this.bounds = {
      left: art.left - pad,
      right: art.right + pad,
      bottom: art.bottom,
      top: art.top + pad,
    };
    const w = this.bounds.right - this.bounds.left;
    const h = this.bounds.top - this.bounds.bottom;
    const ppu = Math.min(options.ppu ?? 220, MAX_PX / w, MAX_PX / h);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(4, Math.ceil(w * ppu));
    this.canvas.height = Math.max(4, Math.ceil(h * ppu));
    // (pixels per unit as the canvas came out: its size is rounded up, and the print must span the bounds exactly)
    const sx = this.canvas.width / w;
    const sy = this.canvas.height / h;
    this.ctx = this.canvas.getContext('2d')!;
    // card units, y up
    this.ctx.setTransform(sx, 0, 0, -sy, -this.bounds.left * sx, this.bounds.top * sy);
    this.ctx.lineJoin = 'round';
    this.ctx.lineCap = 'round';
  }

  /** Draws `fn` clipped to `path`. */
  clipped(path: Path2D, fn: (ctx: CanvasRenderingContext2D) => void): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.clip(path);
    fn(ctx);
    ctx.restore();
  }

  fill(path: Path2D, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fill(path);
  }

  stroke(path: Path2D, color: string, width: number): void {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.stroke(path);
  }

  /** Finishes the card (grain, ink cut line) and returns its texture. */
  finish(outline: Path2D, options: FinishOptions = {}): CardArt {
    const ink = options.ink ?? 0.014;
    const grain = options.grain ?? 0.5;

    if (grain > 0) printGrain(this.canvas, this.ctx, 0.11 * grain);
    if (ink > 0) this.stroke(outline, PALETTE.ink, ink);
    return { ...this.bounds, texture: toTexture(this.canvas) };
  }
}

/** Modulates the painted pixels by the tileable grain (transparent pixels stay untouched). */
function printGrain(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, amount: number): void {
  const { size, values } = getGrainTile();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const w = canvas.width;
  for (let y = 0; y < canvas.height; y++) {
    const row = (y % size) * size;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      const f = 1 + values[row + (x % size)] * amount;
      d[i] = Math.min(255, d[i] * f);
      d[i + 1] = Math.min(255, d[i + 1] * f);
      d[i + 2] = Math.min(255, d[i + 2] * f);
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// Path helpers (all in card units)
// ---------------------------------------------------------------------------------------------

/** Open smooth path through points. */
export function smoothOpenPath(points: ReadonlyArray<readonly [number, number]>, path = new Path2D()): Path2D {
  const n = points.length;
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    path.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1],
    );
  }
  return path;
}

/** Closed polygon through points. */
export function polygonPath(points: ReadonlyArray<readonly [number, number]>): Path2D {
  const path = new Path2D();
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i][0], points[i][1]);
  path.closePath();
  return path;
}

