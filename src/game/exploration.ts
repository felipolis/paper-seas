/**
 * What has been seen, for the voyage chart: a set of explored cells (CELL world units square), one small printed tile
 * per cell (land and sea painted from the land field in the game's own tones, coast inked), the dominant feature of
 * each cell (for the map's stamped trees, peaks, waves and landmarks), and the track sailed and walked.
 *
 * Cells are marked within SIGHT of the ship (of the captain, ashore). Their tiles are painted in the background a few
 * per frame, so opening the chart is instant; at most MAX_TILES are kept (the chart bakes them into its regions, and
 * asks again for any it needs). The explored set and the track are kept in localStorage.
 */
import { clamp, hexRgb, smoothstep } from '../core/math';
import { PALETTE } from '../config/palette';
import { valueNoise } from '../world/noise';
import { GROUND } from '../world/terrain';
import { DEPTH_PRINT } from '../sea/sea-surface';
import type { Biome, LandField } from '../world/land';
import type { IslandKind } from '../world/island-layout';
import { cellKey, keyI, keyJ } from '../core/grid';
import { forget, isNumberArray, isRecord, loadJson, saveJson } from '../core/storage';

export const CELL = 4;
/** Tile resolution (pixels per cell side). */
export const TILE_PX = 24;
const SIGHT = 15;
const STORAGE_KEY = 'paper-seas:explored:v1';

/** What is kept of the exploration: the explored cells (their keys) and the track, x and z in turn. */
interface Explored {
  cells?: number[];
  track?: number[];
}

const isExplored = (v: unknown): v is Explored =>
  isRecord(v) && (v.cells === undefined || isNumberArray(v.cells)) && (v.track === undefined || isNumberArray(v.track));
const TRACK_STEP = 1.6;
const TRACK_MAX = 4000;
/** Painted tiles kept (the oldest go first): about 10 MB of canvases. */
const MAX_TILES = 4096;
/** Seconds between two saves while something changes (and on leaving the page). */
const SAVE_EVERY = 10;

export interface CellInfo {
  /** Share of the cell that is land. */
  land: number;
  /** Highest terrace in the cell (-1 = all sea). */
  terrace: number;
  biome: Biome | null;
  snow: boolean;
  /** The kind of the stamped island whose centre lies in this cell (its landmark goes on the chart), or null. */
  island: IslandKind | null;
}

type Rgb = [number, number, number];
/** The sea in the sea surface's tones (sea/sea-surface.ts); the land is the ground's print (world/terrain.ts GROUND). */
const COL = {
  deep: hexRgb(PALETTE.seaDeep),
  sea: hexRgb(PALETTE.sea),
  light: hexRgb(PALETTE.seaLight),
  shallow: hexRgb(PALETTE.seaShallow),
  foam: hexRgb(PALETTE.foam),
  ink: hexRgb(PALETTE.ink),
};
/** Where each shallow step prints on the chart, crisp: halfway across the shore distances the sea fades it over. */
const STEP_EDGES = DEPTH_PRINT.steps.map(([from, to, share]) => [(from + to) / 2, share] as const);

export class Exploration {
  readonly cells = new Set<number>();
  private readonly tiles = new Map<number, HTMLCanvasElement>();
  readonly info = new Map<number, CellInfo>();
  readonly track: Array<[number, number]> = [];
  /** Tiles waiting to be painted (the last queued first); extra: those the chart asked for beyond the explored. */
  private readonly queue: number[] = [];
  private readonly extra = new Set<number>();
  private dirty = false;
  private saveTimer = 0;
  /** The stored chart was forgotten (a new voyage): nothing is saved again before the page reloads. */
  private forgotten = false;
  private lastCi = Number.NaN;
  private lastCj = Number.NaN;

  constructor(private readonly land: LandField) {
    const data = loadJson(STORAGE_KEY, isExplored);
    for (const k of data?.cells ?? []) this.cells.add(k);
    window.addEventListener('pagehide', () => { if (this.dirty) this.save(); });
    const t = data?.track ?? [];
    for (let i = 0; i + 1 < t.length; i += 2) this.track.push([t[i], t[i + 1]]);
  }

  /** Forgets the stored chart (a new voyage: the page reloads after). */
  forgetVoyage(): void {
    this.forgotten = true;
    forget(STORAGE_KEY);
  }

  /**
   * The tile of a cell (explored, or one the fog's soft edge reaches into), or undefined while it is queued to be
   * painted (onTile tells when it is).
   */
  requestTile(k: number): HTMLCanvasElement | undefined {
    const t = this.tiles.get(k);
    if (!t && !this.extra.has(k)) {
      this.extra.add(k);
      this.queue.unshift(k);
    }
    return t;
  }

  /** Called whenever a tile has been painted (the chart re-bakes the region it falls in). */
  onTile: ((k: number) => void) | null = null;

  /** Cells still waiting for their printed tile. */
  get pending(): number {
    return this.queue.length;
  }

  update(dt: number, x: number, z: number, budgetMs: number): void {
    // mark what is in sight (only when the ship enters a new cell)
    const ci = Math.floor(x / CELL);
    const cj = Math.floor(z / CELL);
    if (ci !== this.lastCi || cj !== this.lastCj) {
      this.lastCi = ci;
      this.lastCj = cj;
      const r = Math.ceil(SIGHT / CELL);
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - z) > SIGHT) continue;
          const k = cellKey(i, j);
          if (this.cells.has(k)) continue;
          this.cells.add(k);
          this.queue.push(k);
          this.dirty = true;
        }
      }
    }
    // the track
    const last = this.track[this.track.length - 1];
    if (!last || Math.hypot(last[0] - x, last[1] - z) > TRACK_STEP) {
      this.track.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
      if (this.track.length > TRACK_MAX) this.track.splice(0, this.track.length - TRACK_MAX);
      this.dirty = true;
    }
    this.paint(budgetMs);
    this.saveTimer -= dt;
    if (this.dirty && this.saveTimer <= 0) this.save();
  }

  /** Paints queued tiles until the time budget is spent. */
  paint(budgetMs: number): void {
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const k = this.queue.pop()!;
      if (!this.tiles.has(k)) this.paintTile(k);
    }
  }

  private save(): void {
    if (this.forgotten) return;
    this.dirty = false;
    this.saveTimer = SAVE_EVERY;
    const track: number[] = [];
    for (const [x, z] of this.track) track.push(x, z);
    saveJson(STORAGE_KEY, { cells: [...this.cells], track } satisfies Explored);
  }

  private paintTile(k: number): void {
    const i = keyI(k);
    const j = keyJ(k);
    const N = TILE_PX;
    const step = CELL / N;
    const x0 = i * CELL;
    const z0 = j * CELL;
    // samples on an (N + 2)^2 grid (one ring outside the tile, for the field's gradient at the coast)
    const W = N + 2;
    const d = new Float32Array(W * W);
    for (let jj = 0; jj < W; jj++) for (let ii = 0; ii < W; ii++) d[jj * W + ii] = this.land.distance(x0 + (ii - 0.5) * step, z0 + (jj - 0.5) * step);
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(N, N);
    let landN = 0;
    let topTerrace = -1;
    let snow = false;
    for (let jj = 0; jj < N; jj++) {
      for (let ii = 0; ii < N; ii++) {
        const dd = d[(jj + 1) * W + ii + 1];
        const x = x0 + (ii + 0.5) * step;
        const z = z0 + (jj + 0.5) * step;
        // the field is a distance estimate: over its gradient it reads in pixels at the coast, where the shore is
        // drawn anti-aliased (the share of the pixel that is land) and a fine ink line follows it
        const gx = d[(jj + 1) * W + ii + 2] - d[(jj + 1) * W + ii];
        const gz = d[(jj + 2) * W + ii + 1] - d[jj * W + ii + 1];
        const px = dd / Math.max(0.05, Math.hypot(gx, gz) / 2);
        const cover = clamp(0.5 - px, 0, 1);
        let col: Rgb = COL.sea;
        if (cover < 1) col = seaColour(x, z, Math.max(0, dd));
        if (dd < 0) {
          landN++;
          const terrace = this.land.terraceAt(x, z, dd);
          topTerrace = Math.max(topTerrace, terrace);
          snow ||= terrace === 3 && this.land.highland(x, z) > 0.72;
          col = mix(col, landColour(terrace, dd), cover);
        } else if (cover > 0) col = mix(col, landColour(0, 0), cover);
        col = mix(col, COL.ink, clamp(1.2 - Math.abs(px) / 1.2, 0, 1) * (0.2 + 0.4 * cover));
        const o = (jj * N + ii) * 4;
        img.data[o] = col[0];
        img.data[o + 1] = col[1];
        img.data[o + 2] = col[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.tiles.set(k, c);
    if (this.tiles.size > MAX_TILES) {
      const oldest = this.tiles.keys().next().value!;
      this.tiles.delete(oldest);
      this.extra.delete(oldest);
    }
    const cx = x0 + CELL / 2;
    const cz = z0 + CELL / 2;
    const dc = this.land.distance(cx, cz);
    const island = this.land.islandsNear(cx, cz, CELL).find((s) => s.x >= x0 && s.x < x0 + CELL && s.z >= z0 && s.z < z0 + CELL);
    this.info.set(k, {
      land: landN / (N * N),
      terrace: topTerrace,
      biome: dc < 0 ? this.land.biome(cx, cz, dc) : null,
      snow,
      island: island?.kind ?? null,
    });
    this.onTile?.(k);
  }
}

/** The sea dd from the shore: deep and mid tones in broad patches, lighter over the shelf, three shallow steps, foam. */
function seaColour(x: number, z: number, dd: number): Rgb {
  const n = valueNoise(31, x * 0.045, z * 0.045) * 0.65 + valueNoise(32, x * 0.13, z * 0.13) * 0.35;
  let col = mix(COL.deep, COL.sea, smoothstep(DEPTH_PRINT.mid[0], DEPTH_PRINT.mid[1], n));
  col = mix(col, COL.light, (1 - smoothstep(DEPTH_PRINT.shelf[0], DEPTH_PRINT.shelf[1], dd)) * DEPTH_PRINT.shelfLight);
  const dn = dd + DEPTH_PRINT.wobble * (valueNoise(33, x * 0.9, z * 0.9) - 0.5);
  let steps = 0;
  for (const [edge, share] of STEP_EDGES) if (dn < edge) steps += share;
  col = mix(col, COL.shallow, steps * DEPTH_PRINT.shallow);
  return dd < 0.2 ? mix(col, COL.foam, 0.7) : col;
}

/** The ground of a terrace dd from the shore (dd <= 0): wet sand to dry, the page tone, tinted on the heights. */
function landColour(terrace: number, dd: number): Rgb {
  if (terrace <= 0) return mix(GROUND.sand, GROUND.wetSand, GROUND.wetShare * smoothstep(GROUND.wetBand[0], GROUND.wetBand[1], dd));
  if (terrace === 1) return GROUND.page;
  return mix(GROUND.page, terrace === 2 ? GROUND.hill : GROUND.rock, terrace === 2 ? GROUND.hillTint : GROUND.rockTint);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
