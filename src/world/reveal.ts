/**
 * Which part of the world stands up, shared by the cards, the Blender-built models, the waves and what is adrift.
 * Every distance is fixed but the view reach: a camera further out sees past the ring, so the ring and the near
 * circle (and the fold-back radius) grow by `reach`, eased, never more than REACH_MAX.
 *
 *   rope      the anchor trails the player on a rope GRACE long: small moves and turns on the spot change nothing
 *   heading   the direction the rope is dragged in, low-passed (DIR_SMOOTH s); after a jump, the way it is moving
 *   rise      a cell rises within RADIUS + reach of a point FORWARD ahead along the heading, or within NEAR + reach
 *             of the player, unless it lies more than BEHIND_RISE behind; after a ripple delay of RIPPLE s per
 *             cell of distance from the player (plus a little jitter)
 *   fold      a cell folds once it is no longer wanted and either lies more than BEHIND_FOLD behind (rows behind
 *             close from the track outward, FOLD_STAGGER s per cell sideways) or is further than FOLD_BACK + reach
 *             from the player and outside the forward ring by HYSTERESIS
 *   flip      a cell's target flips at most once per MIN_FLIP s, except within REFLIP of the player
 *   hold      a still-flat cell the player is crossing waits up to RISE_HOLD s before it rises (its cards would swing
 *             up through him), except right after a jump of more than JUMP
 *   cap       at most MAX_RISES cells start rising in one frame (the rest wait a frame)
 */
import { cellKey } from '../core/grid';
import { hash01 } from '../core/rng';

export const CELL = 2;
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
/** On the way, cells closer than the ring's radius less this rise without the ripple. */
const INNER = 1.5;
/** Salt of the cells' rise jitter. */
const JITTER_SALT = 0x6a09e667;
const MIN_FLIP = 2;
const FOLD_STAGGER = 0.07;
/** The view reach: at most REACH_MAX, eased at REACH_RATE a second (world units). */
const REACH_MAX = 3;
const REACH_RATE = 1.7;
/**
 * How long a still-flat cell holds its rise (s), and how near (per axis) the player counts as crossing a cell: half a
 * cell + 0.15.
 */
const RISE_HOLD = 0.8;
const HOLD_REACH = CELL / 2 + 0.15;
/** A player moving further than this in one frame has jumped. */
const JUMP = 1.5;
/** The most cells that start rising in one frame. */
const MAX_RISES = 6;

export class Reveal {
  /** The player now, and whether it has just jumped (or appeared). */
  private px = 0;
  private pz = 0;
  private fresh = true;
  /** Keys of the cells that started rising this frame. */
  private readonly risen: number[] = [];
  /** Where the rope holds the anchor (the player, give or take GRACE). */
  private tx = 0;
  private tz = 0;
  /** The low-passed direction of the rope's pull, and the heading: that direction, unit. */
  private sx = 0;
  private sz = -1;
  private dx = 0;
  private dz = -1;
  /** The view reach now (world units added to the ring). */
  private reach = 0;
  private placed = false;

  /** The ring's radius (world units). */
  get radius(): number {
    return RADIUS + this.reach;
  }

  /** px, pz: the player (the captain, or the ship); vx, vz: its velocity; reach: the view's reach (world units). */
  update(dt: number, px: number, pz: number, vx: number, vz: number, reach: number): void {
    const want = Math.min(REACH_MAX, Math.max(0, reach));
    this.fresh = !this.placed || Math.hypot(px - this.px, pz - this.pz) > JUMP;
    this.px = px;
    this.pz = pz;
    this.risen.length = 0;
    if (this.fresh) {
      // (a jump: the anchor comes along, heading the way the player is going, if it is going anywhere)
      this.tx = px;
      this.tz = pz;
      this.reach = want;
      this.placed = true;
      const sp = Math.hypot(vx, vz);
      if (sp > 0.05) this.setHeading(vx / sp, vz / sp, 1);
    }
    const step = dt * REACH_RATE;
    this.reach += Math.max(-step, Math.min(step, want - this.reach));
    const ox = px - this.tx;
    const oz = pz - this.tz;
    const off = Math.hypot(ox, oz);
    // (only real travel drags the rope: the heading follows the drag, never a step back or a turn on the spot)
    if (off > GRACE) {
      this.setHeading(ox / off, oz / off, 1 - Math.exp(-dt / DIR_SMOOTH));
      this.tx = px - (ox / off) * GRACE;
      this.tz = pz - (oz / off) * GRACE;
    }
  }

  /** Moves the low-passed pull k of the way toward (ux, uz) and takes its direction as the heading. */
  private setHeading(ux: number, uz: number, k: number): void {
    this.sx += (ux - this.sx) * k;
    this.sz += (uz - this.sz) * k;
    const l = Math.hypot(this.sx, this.sz);
    if (l > 1e-4) {
      this.dx = this.sx / l;
      this.dz = this.sz / l;
    }
  }

  /** Distance from the player (the rope's end). */
  distance(x: number, z: number): number {
    return Math.hypot(x - this.tx, z - this.tz);
  }

  /** How far (world units) the point lies behind the player along the heading. */
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

  /**
   * Is the cell centred at (x, z) still wanted standing (in the ring, not far behind)? A rise still waiting out its
   * ripple delay is called off once it is not.
   */
  wanted(x: number, z: number): boolean {
    return (this.forwardDistance(x, z) < RADIUS + this.reach || this.distance(x, z) < NEAR + this.reach) && this.behind(x, z) < BEHIND_FOLD;
  }

  /** Should a standing cell centred at (x, z) fold? */
  wantsDown(x: number, z: number): boolean {
    if (this.wanted(x, z)) return false;
    return this.behind(x, z) >= BEHIND_FOLD || (this.distance(x, z) > FOLD_BACK + this.reach && this.forwardDistance(x, z) >= RADIUS + this.reach + HYSTERESIS);
  }

  /** Must a flat cell centred at (x, z) that has waited `held` s wait on, the player crossing it? */
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

/** The centre of the cell holding the coordinate v (x or z). */
export function cellCentre(v: number): number {
  return (Math.floor(v / CELL) + 0.5) * CELL;
}

/**
 * The sound gesture of the cell holding (x, z): its cards and buildings moving one way speak as one
 * flap (audio/paper-voices.ts).
 */
export function cellGesture(x: number, z: number): string {
  return `c${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
}

/** The ripple jitter (s) of the cell holding (x, z): one for every card and building in it. */
export function cellJitter(x: number, z: number): number {
  return (hash01(JITTER_SALT, Math.floor(x / CELL), Math.floor(z / CELL)) - 0.5) * 2 * JITTER;
}
