/**
 * The papercraft skill's print, drawn in code (look.md section 3, procedural-art.md section 3; its kit's P.layer and
 * P.rim): a card printed as a layered paper collage. The base is shaded softly from a lit top to a darker foot with a
 * faint shade inside its edge; every part laid on it is a layer of its own, with a pale lip along its lit (upper-left)
 * edges and a short soft shadow to the lower right; the cut edge is printed with it, a thin dark warm-brown line at
 * the silhouette with a pale highlight just inside it only where the cut faces the light. Both edge colours come from
 * the card's own base colour, never black, never an even pale rim. Used for the captains' puppets (player/crew-model.ts).
 */
import { CardPainter, polygonPath, type CardArt } from '../card-painter';

export type Pt = readonly [number, number];

/** Direction toward the key light in card space (y up): upper left, the kit's rimLight. */
const LIGHT: Pt = [-0.55, 0.83];
/** The skill's warm umber (darkening) and warm white (lightening): never grey, never black. */
const UMBER = '#2b1a0e';
const WARM_WHITE = '#fff7e8';

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)) as [number, number, number];
const hexOf = (c: readonly number[]): string => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

/** a mixed toward b by t (sRGB, as the skill mixes its hex colours). */
export function mix(a: string, b: string, t: number): string {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return hexOf(A.map((v, k) => v + (B[k] - v) * t));
}

/** Paper-safe shading (the kit's shade): k < 0 darkens toward warm umber, k > 0 lightens toward warm white. */
export function tone(c: string, k: number): string {
  return k < 0 ? mix(c, UMBER, Math.min(1, -k)) : mix(c, WARM_WHITE, Math.min(1, k));
}

export interface PrintOptions {
  /** Pixels per card unit. */
  ppu?: number;
  /** Width of the pale highlight where the cut faces the light (card units; the dark line is 0.84 of it). */
  rim?: number;
}

/** A card being printed: its outline, its painter, and the collage helpers. */
export class Print {
  readonly ctx: CanvasRenderingContext2D;
  readonly outline: Path2D;

  constructor(readonly painter: CardPainter, readonly pts: readonly Pt[], readonly base: string) {
    this.ctx = painter.ctx;
    this.outline = polygonPath(pts);
  }

  /** The card's own paper: its base colour, lit at the top and darker at the foot, a faint shade inside its edge. */
  paper(colour = this.base): void {
    const ctx = this.ctx;
    const ys = this.pts.map((p) => p[1]);
    const g = ctx.createLinearGradient(0, Math.max(...ys), 0, Math.min(...ys));
    g.addColorStop(0, tone(colour, 0.08));
    g.addColorStop(1, tone(colour, -0.1));
    ctx.fillStyle = g;
    ctx.fill(this.outline);
    this.painter.clipped(this.outline, () => {
      ctx.save();
      ctx.filter = `blur(${Math.max(1, this.painter.ppu * 0.006)}px)`;
      ctx.strokeStyle = tone(colour, -0.5);
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 0.012;
      ctx.stroke(this.outline);
      ctx.restore();
    });
  }

  /**
   * One layer of the collage, clipped to the card: a short soft shadow to the lower right, the shape in its colour,
   * and a pale lip along its upper-left edges (the shape drawn pale, then again in its colour a lip's width down-right).
   */
  layer(path: Path2D, colour: string, o: { lip?: number; shadow?: number } = {}): void {
    const lip = o.lip ?? 0.0035;
    const shadow = o.shadow ?? 0.004;
    const ctx = this.ctx;
    this.painter.clipped(this.outline, () => {
      if (shadow > 0) {
        ctx.save();
        ctx.translate(shadow, -shadow);
        ctx.filter = `blur(${Math.max(1, this.painter.ppu * shadow * 0.8)}px)`;
        ctx.fillStyle = tone(colour, -0.6);
        ctx.globalAlpha = 0.32;
        ctx.fill(path);
        ctx.restore();
      }
      ctx.fillStyle = tone(colour, 0.32);
      ctx.fill(path);
      ctx.save();
      ctx.clip(path);
      ctx.translate(lip, -lip);
      ctx.fillStyle = colour;
      ctx.fill(path);
      ctx.restore();
    });
  }

  /** A flat printed motif (an ornament, a seam, an eye): no lip, no shadow. */
  ink(path: Path2D, colour: string): void {
    this.painter.clipped(this.outline, () => {
      this.ctx.fillStyle = colour;
      this.ctx.fill(path);
    });
  }

  /** A printed line (a seam, a crease) of the given width. */
  line(path: Path2D, colour: string, width: number): void {
    this.painter.clipped(this.outline, () => {
      this.ctx.strokeStyle = colour;
      this.ctx.lineWidth = width;
      this.ctx.stroke(path);
    });
  }
}

/** A band of chevrons pointing up between y0 and y1, across x0..x1 (the skill's bold ornament on cloth). */
export function chevrons(x0: number, x1: number, y0: number, y1: number, n: number): Path2D {
  const p = new Path2D();
  const w = (x1 - x0) / n;
  const h = y1 - y0;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w;
    p.moveTo(a, y0);
    p.lineTo(a + w / 2, y0 + h * 0.62);
    p.lineTo(a + w, y0);
    p.lineTo(a + w, y0 + h * 0.38);
    p.lineTo(a + w / 2, y1);
    p.lineTo(a, y0 + h * 0.38);
    p.closePath();
  }
  return p;
}

/** A row of n dots of radius r along y between x0 and x1. */
export function dots(x0: number, x1: number, y: number, r: number, n: number): Path2D {
  const p = new Path2D();
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1);
    p.moveTo(x + r, y);
    p.arc(x, y, r, 0, Math.PI * 2);
  }
  return p;
}

export function ellipse(x: number, y: number, rx: number, ry: number): Path2D {
  const p = new Path2D();
  p.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  return p;
}

export function rect(x0: number, y0: number, x1: number, y1: number): Path2D {
  return polygonPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
}

/**
 * Prints a card cut to the polygon pts (card units, y up) in the base colour: paint draws the collage on it (paper()
 * first, then layers and ink), then the cut edge is printed: the pale highlight on the edges facing the light, the dark
 * warm-brown line round the whole silhouette (half of it outside the cut, so the card ends in it).
 */
export function printCard(pts: readonly Pt[], base: string, paint: (p: Print) => void, o: PrintOptions = {}): CardArt {
  const rim = o.rim ?? 0.0095;
  const ink = rim * 0.84;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const pad = ink;
  const painter = new CardPainter(
    { left: Math.min(...xs) - pad, right: Math.max(...xs) + pad, bottom: Math.min(...ys) - pad, top: Math.max(...ys) + pad },
    { ppu: o.ppu ?? 700, pad: 0 },
  );
  const print = new Print(painter, pts, base);
  paint(print);
  // the cut edge: the pale highlight just inside the cut where it faces the light (drawn as a wide stroke along each
  // such segment, clipped to the card), then the dark line
  const ctx = painter.ctx;
  const ll = Math.hypot(LIGHT[0], LIGHT[1]);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  }
  const out = area >= 0 ? 1 : -1;
  painter.clipped(print.outline, () => {
    ctx.strokeStyle = mix(base, '#fff3d6', 0.78);
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 1e-6) continue;
      const nx = (out * (y1 - y0)) / len;
      const ny = (-out * (x1 - x0)) / len;
      const facing = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1]) / ll);
      if (facing <= 0.05) continue;
      ctx.lineWidth = 2 * rim * (0.08 + 1.3 * facing);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  });
  return painter.finish(print.outline, { ink, grain: 0.3, inkColor: mix(tone(base, -0.55), '#4a2812', 0.5) });
}
