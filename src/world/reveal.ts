/**
 * Which part of the world stands up (papertrails' streaming rules, world/world.js there), shared by the cards, the
 * Blender-built models, the waves and what is adrift. Every distance is papertrails' own (its traveller is as tall as
 * our captain); the one thing that varies is papertrails' view reach: a camera further out sees past the ring, so the
 * ring and the near circle (and the fold-back radius) grow by `reach`, eased, never more than REACH_MAX.
 *
 *   rope      the anchor trails the traveller on a rope GRACE long: small moves change nothing
 *   heading   the direction of travel, low-passed (DIR_SMOOTH s)
 *   rise      a cell rises within RADIUS + reach of a point FORWARD ahead along the heading, or within NEAR + reach
 *             of the traveller, unless it lies more than BEHIND_RISE behind; after a ripple delay of RIPPLE s per
 *             cell of distance from the traveller (plus a little jitter)
 *   fold      a cell folds once it is no longer wanted and either lies more than BEHIND_FOLD behind (rows behind
 *             close from the track outward, FOLD_STAGGER s per cell sideways) or is further than FOLD_BACK + reach
 *             from the traveller and outside the forward ring by HYSTERESIS
 *   flip      a cell's target flips at most once per MIN_FLIP s, except within REFLIP of the traveller
 *   hold      a still-flat cell the traveller is crossing waits up to RISE_HOLD s before it rises (its cards would swing
 *             up through him), except right after a jump of more than JUMP
 *   cap       at most MAX_RISES cells start rising in one frame (the rest wait a frame)
 */
import { cellKey } from '../core/grid';
import { hash01 } from '../core/rng';

export const CELL = 2;
/** papertrails, in world units (its tiles are 2 wide): 3 tiles, x1.07, 1.35 tiles ahead, 4.25 tiles... */
const RADIUS = 6;
const NEAR = 6.42;
const FORWARD = 2.7;
const FOLD_BACK = 8.5;
const HYSTERESIS = 0.7;
const BEHIND_FOLD = 5.2;
const BEHIND_RISE = 4.2;
const REFLIP = 3.5;
const GRACE = 1;
const DIR_SMOOTH = 0.3;
const RIPPLE = 0.055;
const JITTER = 0.035;
/** papertrails: on the way, cells closer than the ring's radius less 0.75 tiles rise without the ripple. */
const INNER = 1.5;
/** Salt of the cells' rise jitter. */
const JITTER_SALT = 0x6a09e667;
const MIN_FLIP = 2;
const FOLD_STAGGER = 0.07;
/** papertrails' view reach: at most 1.5 tiles, eased at 0.85 tiles a second. */
const REACH_MAX = 3;
const REACH_RATE = 1.7;
/** papertrails' riseHoldMax, and how near (per axis) the traveller counts as crossing a cell: half a cell + 0.15. */
const RISE_HOLD = 0.8;
const HOLD_REACH = CELL / 2 + 0.15;
/** A traveller moving further than this in one frame has jumped (papertrails' fresh frame). */
const JUMP = 1.5;
/** papertrails' maxRisePerFrame. */
const MAX_RISES = 6;

export class Reveal {
  /** The traveller now, and whether it has just jumped (or appeared). */
  private px = 0;
  private pz = 0;
  private fresh = true;
  /** Keys of the cells that started rising this frame. */
  private readonly risen: number[] = [];
  /** Where the rope holds the anchor (the traveller, give or take GRACE). */
  private tx = 0;
  private tz = 0;
  /** Low-passed heading (unit). */
  private dx = 0;
  private dz = -1;
  /** The view reach now (world units added to the ring). */
  private reach = 0;
  private placed = false;

  /** The ring's radius (world units). */
  get radius(): number {
    return RADIUS + this.reach;
  }

  /** px, pz: the traveller (the captain, or the ship); vx, vz: its velocity; reach: the view's reach (world units). */
  update(dt: number, px: number, pz: number, vx: number, vz: number, reach: number): void {
    const want = Math.min(REACH_MAX, Math.max(0, reach));
    this.fresh = !this.placed || Math.hypot(px - this.px, pz - this.pz) > JUMP;
    this.px = px;
    this.pz = pz;
    this.risen.length = 0;
    if (!this.placed || Math.hypot(px - this.tx, pz - this.tz) > GRACE * 6) {
      this.tx = px;
      this.tz = pz;
      this.reach = want;
      this.placed = true;
    }
    const step = dt * REACH_RATE;
    this.reach += Math.max(-step, Math.min(step, want - this.reach));
    const ox = px - this.tx;
    const oz = pz - this.tz;
    const off = Math.hypot(ox, oz);
    if (off > GRACE) {
      this.tx = px - (ox / off) * GRACE;
      this.tz = pz - (oz / off) * GRACE;
    }
    const sp = Math.hypot(vx, vz);
    if (sp > 0.05) {
      const k = 1 - Math.exp(-dt / DIR_SMOOTH);
      this.dx += (vx / sp - this.dx) * k;
      this.dz += (vz / sp - this.dz) * k;
      const l = Math.hypot(this.dx, this.dz) || 1;
      this.dx /= l;
      this.dz /= l;
    }
  }

  /** Distance from the traveller (the rope's end). */
  distance(x: number, z: number): number {
    return Math.hypot(x - this.tx, z - this.tz);
  }

  /** How far (world units) the point lies behind the traveller along the heading. */
  private behind(x: number, z: number): number {
    return -((x - this.tx) * this.dx + (z - this.tz) * this.dz);
  }

  private forwardDistance(x: number, z: number): number {
    return Math.hypot(x - (this.tx + this.dx * FORWARD), z - (this.tz + this.dz * FORWARD));
  }

  /** Should a flat cell centred at (x, z) rise? */
  wantsUp(x: number, z: number): boolean {
    const inRing = this.forwardDistance(x, z) < RADIUS + this.reach || this.distance(x, z) < NEAR + this.reach;
    return inRing && this.behind(x, z) < BEHIND_RISE;
  }

  /** Should a standing cell centred at (x, z) fold? */
  wantsDown(x: number, z: number): boolean {
    const dF = this.forwardDistance(x, z);
    const dT = this.distance(x, z);
    const want = (dF < RADIUS + this.reach || dT < NEAR + this.reach) && this.behind(x, z) < BEHIND_FOLD;
    if (want) return false;
    return this.behind(x, z) >= BEHIND_FOLD || (dT > FOLD_BACK + this.reach && dF >= RADIUS + this.reach + HYSTERESIS);
  }

  /** Must a flat cell centred at (x, z) that has waited `held` s wait on, the traveller crossing it? */
  holds(x: number, z: number, held: number): boolean {
    return !this.fresh && held < RISE_HOLD && Math.abs(this.px - x) < HOLD_REACH && Math.abs(this.pz - z) < HOLD_REACH;
  }

  /** May the cell centred at (x, z) start rising this frame? (Takes one of the frame's slots, once per cell.) */
  claimRise(x: number, z: number): boolean {
    const key = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
    if (this.risen.includes(key)) return true;
    if (this.risen.length >= MAX_RISES) return false;
    this.risen.push(key);
    return true;
  }

  /** May a cell that last flipped at `flipAt` flip again at `now`? */
  mayFlip(x: number, z: number, flipAt: number, now: number): boolean {
    return now - flipAt >= MIN_FLIP || this.distance(x, z) < REFLIP;
  }

  /**
   * Ripple delay (s) before a cell rises: further cells later (jitter: the cell's own +-JITTER). On the way, a cell
   * well inside the ring (INNER short of its edge) rises at once: the ripple runs along the ring's edge, and over
   * everything only after a jump.
   */
  riseDelay(x: number, z: number, jitter: number): number {
    const d = this.distance(x, z);
    if (!this.fresh && d < RADIUS + this.reach - INNER) return 0;
    return Math.max(0, (d / CELL) * RIPPLE + jitter);
  }

  /** Delay (s) before a cell folds: the rows behind close from the track outward. */
  foldDelay(x: number, z: number, jitter: number): number {
    if (this.behind(x, z) < BEHIND_FOLD) return Math.max(0, jitter + JITTER);
    const side = Math.abs((x - this.tx) * this.dz - (z - this.tz) * this.dx);
    return (side / CELL) * FOLD_STAGGER + Math.max(0, jitter + JITTER);
  }
}

/** The ripple jitter (s) of the cell holding (x, z): one for every card and building in it (papertrails' tiles). */
export function cellJitter(x: number, z: number): number {
  return (hash01(JITTER_SALT, Math.floor(x / CELL), Math.floor(z / CELL)) - 0.5) * 2 * JITTER;
}
