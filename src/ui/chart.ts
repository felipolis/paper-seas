/**
 * The voyage chart (E or Tab): a sheet of cream paper slides up over the diorama while the camera lifts away, and
 * the explored seas ink in from the ship outward.
 *
 *   explored land and sea   the printed tiles of Exploration (the game's teal sea, sand and page tone), their edge
 *                           torn where the fog begins (the papercraft skill's torn printed areas)
 *   stamps                  tiny die-cut copies of the game's own stickers laid over the print, few and far between:
 *                           waves on open sea, trees by biome, crags on the heights, the landmark of a stamped island
 *   marks                   the ship (pointing its heading), the dashed track sailed, names of discovered lands,
 *                           an X and a chest where treasure was dug up
 *   furniture               a title cartouche with its legend, a compass rose, a scale bar, a faint graticule
 *
 * The paper is the game's own stock (papertrails' page fibre, art/paper-maps.ts) and every line is the same warm
 * brown ink, never black; as on papertrails' map page the fibre and a warm vignette lie over the print too, so the
 * print sits in the paper.
 *
 * Nothing expensive happens per frame. The explored world is baked once into world-space regions (RC x RC cells:
 * tiles and the torn fog edge) at two resolutions, re-baked only when a tile inside changes, and a frame just
 * places the regions on screen. The parchment and its frame are baked per resize. Stamps are cut from the sprites
 * once per size and re-cut only when the zoom changes their size.
 *
 * Drag / WASD pan, wheel / + - zoom, E / Tab / Esc close.
 */
import './chart.css';
import { CELL, TILE_PX, type CellInfo, type Exploration } from '../game/exploration';
import { cellKey, keyI, keyJ } from '../core/grid';
import type { Progress } from '../game/progress';
import type { Biome } from '../world/land';
import type { IslandKind } from '../world/island-layout';
import { pageFibre } from '../art/paper-maps';
import { PALETTE } from '../config/palette';
import { hexRgb, clamp } from '../core/math';
import { hash01, mulberry32 } from '../core/rng';
import { bus } from '../core/events';
import { spriteImage } from '../art/sprites';

const INK = PALETTE.ink;
/** papertrails' accent (its north point and pin head): a terracotta red. */
const RED = '#b9603f';
/** The sheet: halfway between the game's kraft and its cut edge (papertrails' page cream). */
const PAPER = mixHex(PALETTE.kraft, PALETTE.cutEdge, 0.5);
const SERIF = "'IM Fell English', Georgia, serif";
const REVEAL_TIME = 0.9;
/** Region side in cells. */
const RC = 8;
/** Fog spill around a region (cells): disc radius plus the three box-blur passes. */
const MARGIN = 3;
/** Fog mask pixels per cell. */
const MP = 8;
/** Baked pixels per world unit: fine (zoomed in) and coarse (zoomed out). */
const HI = 8;
const LO = 3;
/** Screen pixels per world unit below which the coarse bake (with its baked-in stamps) is shown. */
const LO_BELOW = 6;
/** Fine bakes kept (each is 256 x 256); the least recently shown are dropped first. */
const HI_KEEP = 200;
const MAX_DPR = 1.5;
/** A veil of paper over the print keeps it matte and a little faded, like an old plate (papertrails: 0.16). */
const VEIL = 0.14;
/** Height (px) of the shrunken copy of each sprite that stamps are cut from. */
const STAMP_BASE = 96;
/** The page fibre's tile on the chart (px), and how strongly it shows (soft-light). */
const FIBRE_PX = 512;
const FIBRE_ALPHA = 0.75;

export interface ChartShip {
  x: number;
  z: number;
  heading: number;
  /** Where the captain walks when ashore (the ship then lies at anchor). */
  onFoot?: { x: number; z: number } | null;
}

interface Region {
  ri: number;
  rj: number;
  hi: HTMLCanvasElement | null;
  lo: HTMLCanvasElement | null;
  /** Stamps as [x, z, kind] triples (world units). */
  glyphs: number[];
  dirty: boolean;
  used: number;
}

/** A stamp cut to size: the canvas and where its top-left lies from the point it stands on. */
interface Sticker {
  img: HTMLCanvasElement;
  ox: number;
  oy: number;
}

/** Stamp kinds: the sprite and its height in glyph units. */
const WAVE = 0;
const PEAK = 1;
const SNOW = 2;
const PINE = 3;
const PALM = 4;
const TREE = 5;
const BLOSSOM = 6;
const ROCK = 7;
const HUT = 8;
const SKULL = 9;
const ARCH = 10;
const STAMPS: ReadonlyArray<{ sprite: string; size: number }> = [
  { sprite: 'wave-2', size: 0.8 },
  { sprite: 'crag-0', size: 1.35 },
  { sprite: 'rock-spire', size: 1.3 },
  { sprite: 'pine', size: 1.15 },
  { sprite: 'palm-1', size: 1.05 },
  { sprite: 'tree-broad', size: 1.05 },
  { sprite: 'tree-blossom', size: 1.05 },
  { sprite: 'rock-big', size: 0.8 },
  { sprite: 'hut-round', size: 1.15 },
  { sprite: 'skull-rock', size: 1.2 },
  { sprite: 'ruin-arch', size: 1.15 },
];
/** The landmark stamped where a stamped island has its centre. */
const LANDMARK: Partial<Record<IslandKind, number>> = { village: HUT, skull: SKULL, ruins: ARCH };
/** Share of the cells of each biome that carry a tree (or a stone) stamp, and which. */
const WOODS: Record<Biome, [number, number]> = {
  jungle: [0.45, PALM],
  pine: [0.45, PINE],
  meadow: [0.28, TREE],
  beach: [0.22, PALM],
  rocky: [0.25, ROCK],
};
/** Share of open-sea cells with a wave, of the peak blocks with a crag, of the meadow trees in blossom. */
const WAVE_CHANCE = 0.09;
const PEAK_BLOCK = 3;
const PEAK_CHANCE = 0.85;
const BLOSSOM_CHANCE = 0.3;
const CHEST = 'chest';
const BOTTLE = 'bottle';

const regionOf = (i: number): number => Math.floor(i / RC);

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function mixHex(a: string, b: string, t: number): string {
  const p = hexRgb(a);
  const q = hexRgb(b);
  return `#${p.map((v, k) => Math.round(v + (q[k] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

export class Chart {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Screen-size scratch layer, used only while the explored area inks in. */
  private readonly layer = canvas(1, 1);
  /** Parchment and its mottling (per resize). */
  private readonly sheet = canvas(1, 1);
  /** Frame and compass rose, over everything (per resize). */
  private readonly overlay = canvas(1, 1);
  private readonly maskCanvas = canvas((RC + 2 * MARGIN) * MP, (RC + 2 * MARGIN) * MP);
  private readonly maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true })!;
  private readonly printCanvas = canvas(RC * TILE_PX, RC * TILE_PX);
  private readonly regions = new Map<number, Region>();
  /** Explored cells already accounted for in the regions. */
  private readonly indexed = new Set<number>();
  /** The page fibre laid over the whole sheet (soft-light) and the warm vignette (multiply), per resize. */
  private readonly fibre: CanvasPattern;
  private vignette: CanvasGradient | null = null;
  /** Each stamped sprite shrunk to STAMP_BASE px high, and the stickers cut from them. */
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  private readonly stickers = new Map<string, Sticker>();
  private open = false;
  private t = 0;
  private frame = 0;
  /** View centre (world) and the world units shown across the map's height. */
  private vx = 0;
  private vz = 0;
  private span = 110;
  private targetSpan = 110;
  private drag: { x: number; y: number; vx: number; vz: number } | null = null;
  private readonly held = new Set<string>();

  constructor(
    parent: HTMLElement,
    private readonly exploration: Exploration,
    private readonly progress: Progress,
    private readonly ship: () => ChartShip,
    private readonly stats: () => { bottles: number },
  ) {
    this.root = document.createElement('div');
    this.root.className = 'chart';
    this.root.innerHTML = `<div class="chart-sheet"><canvas class="chart-canvas"></canvas><div class="chart-hint">drag to pan · wheel to zoom · <b>E</b> to close</div></div>`;
    parent.appendChild(this.root);
    this.canvas = this.root.querySelector('.chart-canvas')!;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.fibre = this.ctx.createPattern(fibreTile(), 'repeat')!;
    // (the game loaded every sprite before it made the chart)
    for (const name of [...STAMPS.map((s) => s.sprite), CHEST, BOTTLE]) this.sprites.set(name, shrink(spriteImage(name), STAMP_BASE));

    exploration.onTile = (k) => {
      const r = this.regions.get(cellKey(regionOf(keyI(k)), regionOf(keyJ(k))));
      if (r) r.dirty = true;
    };
    exploration.onReset = () => {
      this.regions.clear();
      this.indexed.clear();
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, vx: this.vx, vz: this.vz };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const k = this.span / this.canvas.clientHeight;
      this.vx = this.drag.vx - (e.clientX - this.drag.x) * k;
      this.vz = this.drag.vz - (e.clientY - this.drag.y) * k;
    });
    this.canvas.addEventListener('pointerup', () => { this.drag = null; });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetSpan = Math.min(700, Math.max(35, this.targetSpan * (e.deltaY > 0 ? 1.18 : 1 / 1.18)));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) this.held.add(e.code);
      if (e.code === 'Equal' || e.code === 'NumpadAdd') this.targetSpan = Math.max(35, this.targetSpan / 1.25);
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.targetSpan = Math.min(700, this.targetSpan * 1.25);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    window.addEventListener('resize', () => { if (this.open) this.resize(); });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** True once the sheet has settled over the scene (the diorama behind it can stop being redrawn). */
  get settled(): boolean {
    return this.open && this.t > 1.1;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    const s = this.ship();
    // the chart opens on the captain: on foot, or at sea aboard the ship
    this.vx = s.onFoot?.x ?? s.x;
    this.vz = s.onFoot?.z ?? s.z;
    this.span = this.targetSpan = 110;
    this.open = true;
    this.t = 0;
    this.resize();
    this.root.classList.add('on');
    bus.emit('sails', { level: -1 });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.held.clear();
    this.drag = null;
    this.root.classList.remove('on');
    bus.emit('sails', { level: -1 });
  }

  update(dt: number): void {
    this.frame++;
    this.index();
    if (!this.open) {
      // keep the regions around the ship baked, a little at a time, so the chart opens ready
      if (this.frame % 8 === 0) {
        const s = this.ship();
        this.bakeSome(0.5, s.x, s.z, 70);
      }
      return;
    }
    this.t += dt;
    // keep inking tiles while the chart is open
    if (this.exploration.pending) this.exploration.paint(3);
    const pan = (this.span * 0.9) * dt;
    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) this.vx -= pan;
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) this.vx += pan;
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) this.vz -= pan;
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) this.vz += pan;
    if (Math.abs(this.targetSpan - this.span) > 0.05) this.span += (this.targetSpan - this.span) * Math.min(1, dt * 10);
    const H = this.canvas.height;
    const W = this.canvas.width;
    const halfW = (W / 2) * (this.span / H);
    this.bakeSome(4, this.vx, this.vz, Math.hypot(halfW, this.span / 2) + CELL * RC);
    this.draw();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // stamps

  /** A stamped sprite cut to h px high with a faint warm shadow under it (cached per whole pixel). */
  private sticker(name: string, h: number): Sticker {
    const src = this.sprites.get(name);
    if (!src) throw new Error(`the chart does not stamp "${name}"`);
    const hq = Math.max(4, Math.round(h));
    const key = `${name}|${hq}`;
    let s = this.stickers.get(key);
    if (!s) {
      // (zooming walks through many sizes: an old size is cheap to cut again)
      if (this.stickers.size > 160) this.stickers.clear();
      const w = (hq * src.width) / src.height;
      const pad = Math.ceil(hq * 0.1) + 1;
      const img = canvas(Math.ceil(w) + pad * 2, hq + pad * 2);
      const c = img.getContext('2d')!;
      c.imageSmoothingQuality = 'high';
      // the sticker lies on the page: a soft shadow just below it
      c.shadowColor = rgba(INK, 0.4);
      c.shadowBlur = Math.max(1, hq * 0.06);
      c.shadowOffsetY = Math.max(0.5, hq * 0.03);
      c.drawImage(src, pad, pad, w, hq);
      s = { img, ox: -img.width / 2, oy: -(hq + pad) };
      this.stickers.set(key, s);
    }
    return s;
  }

  /** The stickers of every stamp kind for a glyph height of g px. */
  private stampSet(g: number): Sticker[] {
    return STAMPS.map((s) => this.sticker(s.sprite, g * s.size));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // regions

  /** Marks the regions touched by newly explored cells (their own and any whose fog margin they spill into). */
  private index(): void {
    const cells = this.exploration.cells;
    if (cells.size === this.indexed.size) return;
    for (const k of cells) {
      if (this.indexed.has(k)) continue;
      this.indexed.add(k);
      const i = keyI(k);
      const j = keyJ(k);
      const ri0 = regionOf(i - MARGIN);
      const ri1 = regionOf(i + MARGIN);
      const rj0 = regionOf(j - MARGIN);
      const rj1 = regionOf(j + MARGIN);
      for (let rj = rj0; rj <= rj1; rj++) {
        for (let ri = ri0; ri <= ri1; ri++) {
          const rk = cellKey(ri, rj);
          const r = this.regions.get(rk);
          if (r) r.dirty = true;
          else this.regions.set(rk, { ri, rj, hi: null, lo: null, glyphs: [], dirty: true, used: 0 });
        }
      }
    }
  }

  /** Bakes dirty regions within reach of (x, z), nearest first, until the budget (ms) is spent. */
  private bakeSome(budgetMs: number, x: number, z: number, reach: number): void {
    const t0 = performance.now();
    const size = RC * CELL;
    const todo: Array<[number, Region]> = [];
    for (const r of this.regions.values()) {
      if (!r.dirty) continue;
      const d = Math.hypot((r.ri + 0.5) * size - x, (r.rj + 0.5) * size - z);
      if (d < reach) todo.push([d, r]);
    }
    if (!todo.length) return;
    todo.sort((a, b) => a[0] - b[0]);
    for (const [, r] of todo) {
      this.bake(r);
      if (performance.now() - t0 > budgetMs) break;
    }
    this.evict();
  }

  private evict(): void {
    let n = 0;
    for (const r of this.regions.values()) if (r.hi) n++;
    if (n <= HI_KEEP) return;
    const byUse = [...this.regions.values()].filter((r) => r.hi).sort((a, b) => a.used - b.used);
    for (let k = 0; k < n - HI_KEEP; k++) {
      byUse[k].hi = null;
      byUse[k].dirty = true;
    }
  }

  private bake(r: Region): void {
    r.dirty = false;
    const ex = this.exploration;
    const cells = ex.cells;
    const ci0 = r.ri * RC;
    const cj0 = r.rj * RC;

    // ---- fog mask: a disc per explored cell (own cells and the margin), blurred into one shape, its edge torn ----
    const M = this.maskCtx;
    const MS = this.maskCanvas.width;
    M.clearRect(0, 0, MS, MS);
    M.fillStyle = '#000';
    let any = false;
    for (let j = cj0 - MARGIN; j < cj0 + RC + MARGIN; j++) {
      for (let i = ci0 - MARGIN; i < ci0 + RC + MARGIN; i++) {
        if (!cells.has(cellKey(i, j))) continue;
        any = true;
        M.beginPath();
        M.arc((i - ci0 + MARGIN + 0.5) * MP, (j - cj0 + MARGIN + 0.5) * MP, MP * (0.55 + 0.2 * hash01(9, i, j)), 0, Math.PI * 2);
        M.fill();
      }
    }
    if (!any) {
      r.hi = r.lo = null;
      r.glyphs = [];
      return;
    }
    tearAlpha(M, MS, MS, MP, (ci0 - MARGIN) * MP, (cj0 - MARGIN) * MP);

    // ---- the print: tiles of the explored cells and of their neighbours, assembled at their own resolution ----
    const P = this.printCanvas.getContext('2d')!;
    P.clearRect(0, 0, this.printCanvas.width, this.printCanvas.height);
    for (let j = cj0; j < cj0 + RC; j++) {
      for (let i = ci0; i < ci0 + RC; i++) {
        const k = cellKey(i, j);
        let tile: HTMLCanvasElement | undefined;
        if (cells.has(k)) tile = ex.tiles.get(k);
        else {
          let near = false;
          for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1 && !near; di++) near = cells.has(cellKey(i + di, j + dj));
          if (!near) continue;
          tile = ex.requestTile(k);
        }
        if (tile) P.drawImage(tile, (i - ci0) * TILE_PX, (j - cj0) * TILE_PX);
      }
    }

    // ---- fine bake: the print under a veil of paper, cut by the fog ----
    const px = RC * CELL * HI;
    const hi = r.hi ?? canvas(px, px);
    const C = hi.getContext('2d')!;
    C.globalCompositeOperation = 'source-over';
    C.clearRect(0, 0, px, px);
    C.imageSmoothingEnabled = true;
    C.imageSmoothingQuality = 'high';
    C.drawImage(this.printCanvas, 0, 0, px, px);
    C.globalAlpha = VEIL;
    C.fillStyle = PAPER;
    C.fillRect(0, 0, px, px);
    C.globalAlpha = 1;
    C.globalCompositeOperation = 'destination-in';
    const mpx = (CELL * HI) / MP;
    C.drawImage(this.maskCanvas, -MARGIN * CELL * HI, -MARGIN * CELL * HI, MS * mpx, MS * mpx);
    C.globalCompositeOperation = 'source-over';
    r.hi = hi;

    // ---- stamps: a landmark where an island has its centre, the rest only well inside the explored area (never
    // floating in the fog's soft rim), and sparse ----
    const glyphs: number[] = [];
    for (let j = cj0; j < cj0 + RC; j++) {
      for (let i = ci0; i < ci0 + RC; i++) {
        const k = cellKey(i, j);
        const info = ex.info.get(k);
        if (!info || !cells.has(k)) continue;
        const kind = this.stampOf(k, i, j, info);
        if (kind >= 0) glyphs.push((i + 0.25 + 0.5 * hash01(1, i, j)) * CELL, (j + 0.3 + 0.5 * hash01(2, i, j)) * CELL, kind);
      }
    }
    r.glyphs = glyphs;

    // ---- coarse bake: the fine one scaled down, with the land stamps in small (kept inside the region) ----
    const lpx = RC * CELL * LO;
    const lo = r.lo ?? canvas(lpx, lpx);
    const L = lo.getContext('2d')!;
    L.clearRect(0, 0, lpx, lpx);
    L.imageSmoothingEnabled = true;
    L.imageSmoothingQuality = 'high';
    L.drawImage(hi, 0, 0, lpx, lpx);
    const stamps = this.stampSet(2.2 * LO);
    const x0 = ci0 * CELL;
    const z0 = cj0 * CELL;
    for (let g = 0; g < glyphs.length; g += 3) {
      if (glyphs[g + 2] === WAVE) continue;
      const s = stamps[glyphs[g + 2]];
      const x = Math.min(lpx - s.img.width, Math.max(0, (glyphs[g] - x0) * LO + s.ox));
      const y = Math.min(lpx - s.img.height, Math.max(0, (glyphs[g + 1] - z0) * LO + s.oy));
      L.drawImage(s.img, x, y);
    }
    r.lo = lo;
  }

  /** The stamp of an explored cell (-1 for none). */
  private stampOf(k: number, i: number, j: number, info: CellInfo): number {
    const landmark = info.island ? LANDMARK[info.island] : undefined;
    if (landmark !== undefined && info.land > 0.3) return landmark;
    const ex = this.exploration;
    const around = [k + 65536, k - 65536, k + 1, k - 1];
    if (!around.every((n) => ex.cells.has(n))) return -1;
    const roll = hash01(4, i, j);
    if (info.land < 0.05) {
      // a wave only on open water, clear of every coast
      const open = around.every((n) => (ex.info.get(n)?.land ?? 1) < 0.05);
      return open && roll < WAVE_CHANCE ? WAVE : -1;
    }
    if (info.land < 0.6 || !info.biome) return -1;
    if (info.terrace >= 3) {
      // a range of single crags with ground between them (as the game spaces its mountains): one cell of each
      // PEAK_BLOCK x PEAK_BLOCK block may carry one
      const bi = Math.floor(i / PEAK_BLOCK);
      const bj = Math.floor(j / PEAK_BLOCK);
      const chosen = i - bi * PEAK_BLOCK === Math.floor(hash01(6, bi, bj) * PEAK_BLOCK) && j - bj * PEAK_BLOCK === Math.floor(hash01(7, bi, bj) * PEAK_BLOCK);
      return chosen && roll < PEAK_CHANCE ? (info.snow ? SNOW : PEAK) : -1;
    }
    if (info.terrace < 1) return -1;
    const [share, kind] = WOODS[info.biome];
    if (roll >= share) return -1;
    return kind === TREE && hash01(5, i, j) < BLOSSOM_CHANCE ? BLOSSOM : kind;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // drawing

  private resize(): void {
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 1200;
    const h = this.canvas.clientHeight || 800;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = this.layer.width = this.sheet.width = this.overlay.width = W;
      this.canvas.height = this.layer.height = this.sheet.height = this.overlay.height = H;
    }
    this.bakeSheet();
  }

  /** The sheet itself: cream paper with soft light and dark clouds in it (papertrails' page), and its vignette. */
  private bakeSheet(): void {
    const W = this.sheet.width;
    const H = this.sheet.height;
    const u = H / 900;
    const c = this.sheet.getContext('2d')!;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = PAPER;
    c.fillRect(0, 0, W, H);
    const rng = mulberry32(0xc4a27);
    for (let k = 0; k < 56; k++) {
      const x = rng() * W;
      const y = rng() * H;
      const r = (70 + rng() * 200) * u;
      const tone = rng() < 0.5 ? PALETTE.cutEdge : PALETTE.kraft;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(tone, 0.32));
      g.addColorStop(1, rgba(tone, 0));
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // paper under light: darker, warmer toward the corners (laid over everything each frame)
    this.vignette = this.ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    this.vignette.addColorStop(0, '#ffffff');
    this.vignette.addColorStop(1, '#e0cdb4');

    // the frame and the compass rose sit over the print: their own transparent layer
    const o = this.overlay.getContext('2d')!;
    o.clearRect(0, 0, W, H);
    this.bakeOverlay(o, W, H, u);
  }

  /** Inked double frame with its degree ticks, and the compass rose. */
  private bakeOverlay(c: CanvasRenderingContext2D, W: number, H: number, u: number): void {
    const pad = 28 * u;
    const o = pad * 0.5;
    const i = o + 7 * u;
    c.strokeStyle = INK;
    c.globalAlpha = 0.8;
    c.lineWidth = 2.2 * u;
    c.strokeRect(o, o, W - 2 * o, H - 2 * o);
    c.globalAlpha = 0.55;
    c.lineWidth = 1 * u;
    c.strokeRect(i, i, W - 2 * i, H - 2 * i);
    // ticks between the two lines, like the degree marks of an atlas plate
    c.globalAlpha = 0.5;
    c.beginPath();
    const tick = (H - 2 * i) / 12;
    for (let x = i + tick; x < W - i - 1; x += tick) {
      c.moveTo(x, o);
      c.lineTo(x, i);
      c.moveTo(x, H - o);
      c.lineTo(x, H - i);
    }
    for (let y = i + tick; y < H - i - 1; y += tick) {
      c.moveTo(o, y);
      c.lineTo(i, y);
      c.moveTo(W - o, y);
      c.lineTo(W - i, y);
    }
    c.stroke();

    // compass rose
    const R = 52 * u;
    c.save();
    c.translate(W - pad - 80 * u, pad + 90 * u);
    c.strokeStyle = INK;
    c.lineWidth = 1.1 * u;
    c.globalAlpha = 0.7;
    c.beginPath();
    c.arc(0, 0, R * 0.78, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(0, 0, R * 0.7, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 0.9;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
      const len = k % 2 ? R * 0.55 : R;
      const w = k % 2 ? R * 0.08 : R * 0.14;
      // each point in two halves, one inked and one left paper (the light falls from the west)
      for (const side of [1, -1]) {
        c.beginPath();
        c.moveTo(Math.cos(a) * len, Math.sin(a) * len);
        c.lineTo(Math.cos(a + (side * Math.PI) / 2) * w, Math.sin(a + (side * Math.PI) / 2) * w);
        c.lineTo(0, 0);
        c.closePath();
        c.fillStyle = k === 0 ? (side > 0 ? RED : mixHex(RED, PAPER, 0.45)) : side > 0 ? INK : PAPER;
        c.fill();
        c.stroke();
      }
    }
    c.fillStyle = RED;
    c.font = `${Math.round(18 * u)}px ${SERIF}`;
    c.textAlign = 'center';
    c.fillText('N', 0, -R - 6 * u);
    c.restore();
    c.globalAlpha = 1;
  }

  private draw(): void {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ppu = H / this.span;
    const X = (x: number) => (x - this.vx) * ppu + W / 2;
    const Y = (z: number) => (z - this.vz) * ppu + H / 2;
    const u = H / 900;
    const s = this.ship();
    const reveal = Math.min(1, this.t / REVEAL_TIME);
    const revealing = this.t < REVEAL_TIME + 0.05;
    const revealR = (1 - (1 - reveal) ** 3) * Math.hypot(W, H) / ppu;
    const leagues = this.span > 300 ? 100 : this.span > 120 ? 40 : 20;

    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.drawImage(this.sheet, 0, 0);

    // ---- a faint graticule on the paper, one line per scale bar ----
    c.strokeStyle = INK;
    c.globalAlpha = 0.07;
    c.lineWidth = Math.max(1, u);
    c.beginPath();
    for (let x = Math.ceil((this.vx - W / 2 / ppu) / leagues) * leagues; X(x) < W; x += leagues) {
      c.moveTo(Math.round(X(x)) + 0.5, 0);
      c.lineTo(Math.round(X(x)) + 0.5, H);
    }
    for (let z = Math.ceil((this.vz - H / 2 / ppu) / leagues) * leagues; Y(z) < H; z += leagues) {
      c.moveTo(0, Math.round(Y(z)) + 0.5);
      c.lineTo(W, Math.round(Y(z)) + 0.5);
    }
    c.stroke();
    c.globalAlpha = 1;

    // ---- explored world: the baked regions (inked in from the ship while the sheet arrives) ----
    const target = revealing ? this.layer.getContext('2d')! : c;
    if (revealing) target.clearRect(0, 0, W, H);
    const size = RC * CELL;
    const ri0 = Math.floor((this.vx - W / 2 / ppu) / size);
    const ri1 = Math.floor((this.vx + W / 2 / ppu) / size);
    const rj0 = Math.floor((this.vz - H / 2 / ppu) / size);
    const rj1 = Math.floor((this.vz + H / 2 / ppu) / size);
    const fine = ppu >= LO_BELOW;
    target.imageSmoothingEnabled = true;
    target.globalAlpha = 0.92;
    const visible: Region[] = [];
    for (let rj = rj0; rj <= rj1; rj++) {
      for (let ri = ri0; ri <= ri1; ri++) {
        const r = this.regions.get(cellKey(ri, rj));
        if (!r) continue;
        const img = fine ? r.hi ?? r.lo : r.lo;
        if (!img) continue;
        r.used = this.frame;
        visible.push(r);
        const x0 = Math.round(X(ri * size));
        const y0 = Math.round(Y(rj * size));
        target.drawImage(img, x0, y0, Math.round(X((ri + 1) * size)) - x0, Math.round(Y((rj + 1) * size)) - y0);
      }
    }
    target.globalAlpha = 1;

    // ---- stamps: waves on open sea, trees on the land, crags on the heights, landmarks ----
    if (fine) {
      const stamps = this.stampSet(Math.min(CELL * ppu * 0.5, 22 * u));
      for (const r of visible) {
        const g = r.glyphs;
        for (let k = 0; k < g.length; k += 3) {
          const st = stamps[g[k + 2]];
          target.drawImage(st.img, Math.round(X(g[k]) + st.ox), Math.round(Y(g[k + 1]) + st.oy));
        }
      }
    }

    if (revealing) {
      // the explored area inks in from the ship outward, with a soft front
      const sx = X(s.x);
      const sy = Y(s.z);
      const R = Math.max(1, revealR * ppu);
      const front = target.createRadialGradient(sx, sy, R * 0.82, sx, sy, R);
      front.addColorStop(0, 'rgba(0, 0, 0, 1)');
      front.addColorStop(1, 'rgba(0, 0, 0, 0)');
      target.globalCompositeOperation = 'destination-in';
      target.fillStyle = front;
      target.fillRect(0, 0, W, H);
      target.globalCompositeOperation = 'source-over';
      c.drawImage(this.layer, 0, 0);
    }

    // ---- the track sailed: a dashed red line (only the stretches on screen) ----
    const tr = this.exploration.track;
    if (tr.length > 1) {
      c.save();
      c.strokeStyle = rgba(RED, 0.75);
      c.lineWidth = Math.max(1.5, 2 * u);
      c.lineCap = 'round';
      c.setLineDash([6 * u, 5 * u]);
      c.beginPath();
      const mx = W / 2 / ppu + 4;
      const mz = H / 2 / ppu + 4;
      let pen = false;
      for (let k = 1; k < tr.length; k++) {
        const [x, z] = tr[k];
        const [px, pz] = tr[k - 1];
        const off = (Math.abs(x - this.vx) > mx && Math.abs(px - this.vx) > mx) || (Math.abs(z - this.vz) > mz && Math.abs(pz - this.vz) > mz);
        if (off || Math.hypot(x - px, z - pz) > 12) {
          pen = false;
          continue;
        }
        if (!pen) c.moveTo(X(px), Y(pz));
        c.lineTo(X(x), Y(z));
        pen = true;
      }
      c.stroke();
      c.restore();
    }

    // ---- treasure dug up: an X with the chest beside it ----
    const chest = this.sticker(CHEST, 22 * u);
    c.strokeStyle = RED;
    c.lineWidth = 3 * u;
    c.lineCap = 'round';
    for (const t of this.progress.treasureSpots) {
      const x = X(t.x);
      const y = Y(t.z);
      const r = 8 * u;
      if (x < -4 * r || y < -4 * r || x > W + 4 * r || y > H + 4 * r) continue;
      c.beginPath();
      c.moveTo(x - r, y - r);
      c.lineTo(x + r, y + r);
      c.moveTo(x - r, y + r);
      c.lineTo(x + r, y - r);
      c.stroke();
      c.drawImage(chest.img, Math.round(x + r * 2.6 + chest.ox), Math.round(y + r + chest.oy));
    }

    // ---- names of the lands discovered ----
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `italic ${Math.round(17 * u)}px ${SERIF}`;
    c.lineWidth = 4 * u;
    c.lineJoin = 'round';
    for (const p of this.progress.places.values()) {
      const x = X(p.x);
      const y = Y(p.z);
      if (x < -200 || y < -50 || x > W + 200 || y > H + 50) continue;
      if (revealing && Math.hypot(p.x - s.x, p.z - s.z) > revealR * 0.9) continue;
      c.strokeStyle = rgba(PAPER, 0.85);
      c.strokeText(p.name, x, y);
      c.fillStyle = INK;
      c.fillText(p.name, x, y);
    }

    this.drawShip(c, X(s.x), Y(s.z), s, X, Y, u);
    this.furniture(c, H, u, ppu, leagues);
    c.drawImage(this.overlay, 0, 0);

    // ---- the paper over it all: the page fibre and the warm corners ----
    c.globalCompositeOperation = 'soft-light';
    c.globalAlpha = FIBRE_ALPHA;
    c.fillStyle = this.fibre;
    c.fillRect(0, 0, W, H);
    c.globalAlpha = 1;
    if (this.vignette) {
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = this.vignette;
      c.fillRect(0, 0, W, H);
    }
    c.globalCompositeOperation = 'source-over';
  }

  /** The ship pointing its heading, the captain's pin when ashore, and a soft ring round whichever is the captain. */
  private drawShip(c: CanvasRenderingContext2D, x: number, y: number, s: ChartShip, X: (x: number) => number, Y: (z: number) => number, u: number): void {
    const r = 13 * u;
    c.save();
    c.translate(x, y);
    // heading 0 = north (up); rotation.y grows counter-clockwise seen from above
    c.rotate(-s.heading);
    c.fillStyle = PALETTE.wood;
    c.strokeStyle = INK;
    c.lineWidth = 1.5 * u;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(0, -r * 1.2);
    c.quadraticCurveTo(r * 0.6, -r * 0.2, r * 0.45, r * 0.9);
    c.lineTo(-r * 0.45, r * 0.9);
    c.quadraticCurveTo(-r * 0.6, -r * 0.2, 0, -r * 1.2);
    c.fill();
    c.stroke();
    c.fillStyle = PALETTE.cutEdge;
    c.fillRect(-r * 0.7, -r * 0.35, r * 1.4, r * 0.22);
    c.strokeRect(-r * 0.7, -r * 0.35, r * 1.4, r * 0.22);
    c.fillRect(-r * 0.55, r * 0.2, r * 1.1, r * 0.2);
    c.strokeRect(-r * 0.55, r * 0.2, r * 1.1, r * 0.2);
    c.restore();
    const me = s.onFoot;
    if (me) {
      // ashore: the ship at anchor (an anchor mark), the dotted way to the captain and papertrails' pin on him
      const ax = x + r * 1.1;
      const ay = y - r * 0.9;
      c.strokeStyle = INK;
      c.lineWidth = 1.6 * u;
      c.lineCap = 'round';
      c.beginPath();
      c.arc(ax, ay, 3.5 * u, 0, Math.PI * 2);
      c.moveTo(ax, ay + 3.5 * u);
      c.lineTo(ax, ay + 12 * u);
      c.moveTo(ax - 6 * u, ay + 9 * u);
      c.quadraticCurveTo(ax, ay + 15 * u, ax + 6 * u, ay + 9 * u);
      c.stroke();
      const fx = X(me.x);
      const fy = Y(me.z);
      c.save();
      c.setLineDash([3 * u, 4 * u]);
      c.strokeStyle = rgba(INK, 0.6);
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(fx, fy);
      c.stroke();
      c.restore();
      const p = 26 * u;
      c.fillStyle = rgba(INK, 0.28);
      c.beginPath();
      c.ellipse(fx + p * 0.1, fy + p * 0.02, p * 0.2, p * 0.08, 0, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = Math.max(1, p * 0.06);
      c.beginPath();
      c.moveTo(fx, fy);
      c.lineTo(fx, fy - p * 0.55);
      c.stroke();
      c.fillStyle = RED;
      c.beginPath();
      c.arc(fx, fy - p * 0.66, p * 0.24, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = rgba(PALETTE.cutEdge, 0.7);
      c.beginPath();
      c.arc(fx - p * 0.07, fy - p * 0.73, p * 0.07, 0, Math.PI * 2);
      c.fill();
    }
    // the ring pulses gently so the captain is easy to find
    c.strokeStyle = rgba(RED, 0.55);
    c.lineWidth = 2 * u;
    c.beginPath();
    c.arc(me ? X(me.x) : x, me ? Y(me.z) - 13 * u : y, r * 2.2 + 3 * u * Math.sin(this.t * 3), 0, Math.PI * 2);
    c.stroke();
  }

  /** Title cartouche with its legend (papertrails' legend strip), and the scale bar. */
  private furniture(c: CanvasRenderingContext2D, H: number, u: number, ppu: number, leagues: number): void {
    const pad = 28 * u;
    const bx = pad + 4 * u;
    const by = pad + 8 * u;
    const title = `${Math.round(30 * u)}px 'IM Fell English SC', ${SERIF}`;
    const label = `600 ${Math.round(10 * u)}px Georgia, serif`;
    const count = `italic ${Math.round(20 * u)}px ${SERIF}`;
    const spacing = `${(1.4 * u).toFixed(2)}px`;
    const gap = 14 * u;

    // the legend: a sticker, a count and a small spaced label for each (measured first: the box fits round it)
    const p = this.progress;
    const legend = ([
      [STAMPS[PALM].sprite, p.discovered.size, 'lands'],
      [CHEST, p.treasures.size, 'treasures'],
      [BOTTLE, this.stats().bottles, 'bottles'],
    ] as const).map(([sprite, n, name]) => {
      const st = this.sticker(sprite, 26 * u);
      c.font = count;
      const nw = c.measureText(String(n)).width;
      c.font = label;
      c.letterSpacing = spacing;
      const lw = c.measureText(name.toUpperCase()).width;
      c.letterSpacing = '0px';
      const iw = st.img.width + 2 * u;
      return { st, n: String(n), name: name.toUpperCase(), iw, nw, w: iw + nw + 5 * u + lw };
    });
    c.font = title;
    const inner = Math.max(c.measureText('Chart of the Paper Seas').width, legend.reduce((a, l) => a + l.w, 0) + gap * (legend.length - 1));
    const bw = inner + 36 * u;
    const bh = 104 * u;
    c.fillStyle = rgba(PAPER, 0.94);
    c.strokeStyle = INK;
    c.globalAlpha = 1;
    c.beginPath();
    c.roundRect(bx, by, bw, bh, 8 * u);
    c.fill();
    c.globalAlpha = 0.8;
    c.lineWidth = 1.5 * u;
    c.stroke();
    c.globalAlpha = 0.4;
    c.lineWidth = 0.8 * u;
    c.beginPath();
    c.roundRect(bx + 5 * u, by + 5 * u, bw - 10 * u, bh - 10 * u, 5 * u);
    c.stroke();
    c.globalAlpha = 1;

    const tx = bx + 18 * u;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillStyle = RED;
    c.font = title;
    c.fillText('Chart of the Paper Seas', tx, by + 42 * u);
    c.strokeStyle = INK;
    c.globalAlpha = 0.3;
    c.lineWidth = 0.8 * u;
    c.beginPath();
    c.moveTo(tx, by + 54 * u);
    c.lineTo(bx + bw - 18 * u, by + 54 * u);
    c.stroke();
    c.globalAlpha = 1;

    const ly = by + 84 * u;
    let x = tx;
    c.textBaseline = 'middle';
    c.fillStyle = INK;
    for (const l of legend) {
      c.drawImage(l.st.img, Math.round(x), Math.round(ly + 11 * u + l.st.oy));
      c.globalAlpha = 0.9;
      c.font = count;
      c.fillText(l.n, x + l.iw, ly);
      c.globalAlpha = 0.72;
      c.font = label;
      c.letterSpacing = spacing;
      c.fillText(l.name, x + l.iw + l.nw + 5 * u, ly + 1 * u);
      c.letterSpacing = '0px';
      x += l.w + gap;
    }
    c.globalAlpha = 1;

    // scale bar (world units shown as leagues)
    const sx = pad + 18 * u;
    const sy = H - pad - 22 * u;
    const blen = leagues * ppu;
    for (let k = 0; k < 4; k++) {
      c.fillStyle = k % 2 ? PAPER : INK;
      c.fillRect(sx + (k * blen) / 4, sy, blen / 4, 6 * u);
    }
    c.strokeStyle = INK;
    c.lineWidth = 1 * u;
    c.strokeRect(sx, sy, blen, 6 * u);
    c.fillStyle = INK;
    c.font = `italic ${Math.round(13 * u)}px ${SERIF}`;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    c.fillText(`${leagues / 4} leagues`, sx + blen + 8 * u, sy + 7 * u);
  }
}

/** A sprite shrunk to h px high by halving (a clean small copy to cut stamps from). */
function shrink(img: HTMLImageElement, h: number): HTMLCanvasElement {
  let src: CanvasImageSource = img;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  do {
    const nh = Math.max(h, Math.round(sh / 2));
    const nw = Math.round((sw * nh) / sh);
    const step = canvas(nw, nh);
    const c = step.getContext('2d')!;
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, nw, nh);
    src = step;
    sw = nw;
    sh = nh;
  } while (sh > h);
  return src as HTMLCanvasElement;
}

/**
 * The page fibre (art/paper-maps.ts) as a grey tile around mid-grey for soft-light: read as papertrails reads it,
 * albedo / mean - 1, at half scale so its fibres come out fine on the sheet.
 */
function fibreTile(): HTMLCanvasElement {
  const page = pageFibre();
  const tile = canvas(FIBRE_PX, FIBRE_PX);
  const c = tile.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(page.albedo.image as HTMLImageElement, 0, 0, FIBRE_PX, FIBRE_PX);
  const img = c.getImageData(0, 0, FIBRE_PX, FIBRE_PX);
  const d = img.data;
  for (let k = 0; k < d.length; k += 4) {
    const v = Math.round(128 + 128 * (d[k] / 255 / page.mean - 1));
    d[k] = d[k + 1] = d[k + 2] = Math.max(0, Math.min(255, v));
  }
  c.putImageData(img, 0, 0);
  return tile;
}

/**
 * The fog's edge, torn (the papercraft skill's paper-ui.md: printed areas end in torn edges, not soft fades): three
 * box-blur passes merge the discs into one round shape, then its rim is nibbled by noise in world-fixed mask pixels
 * (ox, oy: the mask's origin, so neighbouring regions tear alike) and cut almost hard; the upscale to the print softens
 * it by a pixel or two.
 */
function tearAlpha(ctx: CanvasRenderingContext2D, w: number, h: number, r: number, ox: number, oy: number): void {
  if (w < 2 || h < 2 || r < 1) return;
  const img = ctx.getImageData(0, 0, w, h);
  let a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = img.data[i * 4 + 3];
  const tmp = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[y * w + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * r + 1);
        acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    const out = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    a = out;
  }
  // value noise in mask pixels: a fine nibble on a coarser wander
  const noise = (x: number, y: number, cell: number, seed: number): number => {
    const fx = x / cell;
    const fy = y / cell;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const u = fx - ix;
    const v = fy - iy;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const top = hash01(seed, ix, iy) + (hash01(seed, ix + 1, iy) - hash01(seed, ix, iy)) * su;
    const bottom = hash01(seed, ix, iy + 1) + (hash01(seed, ix + 1, iy + 1) - hash01(seed, ix, iy + 1)) * su;
    return top + (bottom - top) * sv - 0.5;
  };
  for (let i = 0; i < w * h; i++) {
    const x = (i % w) + ox;
    const y = Math.floor(i / w) + oy;
    const v = a[i] / 255 + 0.22 * noise(x, y, 7, 31) + 0.16 * noise(x, y, 2.2, 47);
    const t = clamp((v - 0.42) / 0.08, 0, 1);
    img.data[i * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  ctx.putImageData(img, 0, 0);
}
