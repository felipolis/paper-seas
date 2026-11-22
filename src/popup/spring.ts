/**
 * Pop-up flap dynamics: one degree of freedom per flap, its progress p (0 = folded flat on the page,
 * 1 = upright; p overshoots past 1). Integrated with a fixed step (semi-implicit Euler) so the motion is the
 * same at any frame rate. Three regimes:
 *
 *   RISE    p'' = k (1 - p) - c p'                 lightly damped hinge spring: the card arrives upright with speed
 *   LOCKED  p'' = -w^2 (p - 1) - (2 z w + drag |p'|) p' - friction
 *                                                  latched the moment the card reaches upright: it whips past by
 *                                                  8-15 % and quivers at 4-7 Hz for 2-3 cycles (the paper wobble)
 *   FALL    p'' = -kd p - cd p' - pull             softer; at the page the card slaps with a little restitution
 *
 * The same model drives every pop-up in the game: island props (Object3D hinges, fold-group.ts), the wave cards
 * (instanced, wave-field.ts) and the ship's masts.
 */
import { POPUP } from '../config/popup';
import { clamp } from '../core/math';

export interface FlapTuning {
  /** Upright height of the card (world units): large cards are slower and whip further. */
  size: number;
  /** Per-flap random in [0, 1) used for the deterministic jitter and twist sign. */
  seed: number;
  /** Multiplier on the flutter (0.2 .. 2.5). */
  wobble?: number;
  /** Multiplier on the spring frequency. */
  stiffness?: number;
}

/** Precomputed constants of one flap. */
export interface FlapConstants {
  kUp: number;
  cUp: number;
  kDn: number;
  cDn: number;
  gDn: number;
  wLsq: number;
  cL: number;
  dragL: number;
  fricL: number;
  freqScale: number;
  twist: number;
}

export function flapConstants(t: FlapTuning): FlapConstants {
  const S = POPUP;
  const sizeT = clamp((t.size - S.sizeSmall) / (S.sizeLarge - S.sizeSmall), 0, 1);
  const stiff = Math.max(0.25, t.stiffness ?? 1);
  const jitter = (t.seed * 2 - 1) * S.jitter;
  const fs = (S.freqSmall + (S.freqLarge - S.freqSmall) * sizeT) * Math.sqrt(stiff) * (1 + jitter);
  const wob = clamp((t.wobble ?? 1) * S.wobble * (1 + (S.wobbleLarge - 1) * sizeT), 0.2, 2.5);
  const wL = 2 * Math.PI * S.flutterHz * (1 + jitter * 0.7);
  const twSeed = (t.seed * 7.31) % 1;
  return {
    kUp: S.stiffness * fs * fs,
    cUp: S.damping * fs * (1 + (S.dampingLarge - 1) * sizeT),
    kDn: S.downStiffness * fs * fs,
    cDn: S.downDamping * fs,
    gDn: S.downPull * fs * fs,
    wLsq: wL * wL,
    cL: (2 * S.flutterDamping * wL) / Math.sqrt(wob),
    dragL: S.flutterDrag / Math.sqrt(wob),
    fricL: S.flutterFriction * fs * (1 + (S.flutterFrictionLarge - 1) * sizeT),
    freqScale: fs,
    // never near zero: every card visibly twists, alternating sign from flap to flap
    twist: S.twist * (twSeed < 0.5 ? -1 : 1) * (0.55 + 0.45 * Math.abs(twSeed * 2 - 1)) * (0.6 + 0.4 * sizeT),
  };
}

/** Mutable state of one flap. */
export class Flap {
  /** Progress at the current / previous fixed step, and the interpolated value to draw. */
  m = 0;
  mPrev = 0;
  p = 0;
  v = 0;
  /** Target the flap is heading for (0 / 1) and whether it has latched upright since it last started rising. */
  target = 0;
  locked = false;
  atRest = true;
  /** Seconds left before a pending target change starts (stagger / ripple). */
  wait = 0;
  pendingTarget = -1;

  constructor(readonly k: FlapConstants) {}

  /** Asks the flap to rise (1) or fold (0) after `delay` seconds. No-op if it is already heading there. */
  setTarget(target: 0 | 1, delay = 0): void {
    if (this.pendingTarget === target) return;
    if (this.pendingTarget < 0 && this.target === target) return;
    if (delay <= 0) {
      this.start(target);
      return;
    }
    this.pendingTarget = target;
    this.wait = delay;
  }

  /** Places the flap at progress p (0 or 1) with no motion. */
  snap(p: 0 | 1): void {
    this.m = this.mPrev = this.p = p;
    this.v = 0;
    this.target = p;
    this.locked = p === 1;
    this.atRest = true;
    this.pendingTarget = -1;
  }

  /** Gives the flap a kick (e.g. the bow pressing a wave down). */
  impulse(v: number): void {
    this.v += v;
    this.atRest = false;
  }

  /** True while the flap needs simulation steps. */
  get active(): boolean {
    return !this.atRest || this.pendingTarget >= 0;
  }

  /** Current flutter twist (rad), zero at rest. */
  get twist(): number {
    return this.locked && this.p !== 1 ? this.k.twist * (this.p - 1) : 0;
  }

  private start(target: 0 | 1): void {
    this.pendingTarget = -1;
    if (target === this.target && this.atRest) return;
    // unlatch twitch: a card resting upright flicks a degree further before it falls (anticipation)
    if (target === 0 && this.atRest && this.m >= 1) this.v = POPUP.downAnticipation * this.k.freqScale;
    this.target = target;
    this.locked = false;
    this.atRest = false;
  }

  /** Advances one fixed step of length h. */
  step(h: number): void {
    if (this.pendingTarget >= 0) {
      this.wait -= h;
      if (this.wait <= 0) this.start(this.pendingTarget as 0 | 1);
    }
    if (this.atRest) {
      this.mPrev = this.m;
      return;
    }
    const k = this.k;
    let a: number;
    if (this.target === 1) {
      if (!this.locked && this.m >= 1) this.locked = true;
      a = this.locked
        ? -k.wLsq * (this.m - 1) - (k.cL + k.dragL * Math.abs(this.v) + k.fricL / (Math.abs(this.v) + 0.05)) * this.v
        : k.kUp * (1 - this.m) - k.cUp * this.v;
    } else {
      a = -k.kDn * this.m - k.cDn * this.v - k.gDn;
      // reversed while still travelling up: brake like the rise spring; the end stop still exists past upright
      if (this.v > 0) a -= k.cUp * this.v * Math.min(this.m, 1);
      if (this.m > 1) a -= k.wLsq * (this.m - 1) + k.cL * this.v;
    }
    this.mPrev = this.m;
    this.v += a * h;
    this.m += this.v * h;
    const eps = POPUP.settleEps;
    if (this.m <= 0 && this.target === 0) {
      // the page: paper cannot pass through it
      this.m = 0;
      this.v = this.v < -POPUP.minBounceSpeed * k.freqScale ? -this.v * POPUP.restitution : 0;
      if (this.v === 0) this.atRest = true;
    } else if (this.m < 0) {
      this.m = 0;
      if (this.v < 0) this.v = 0;
    }
    if (this.target === 1 && Math.abs(this.m - 1) < eps && Math.abs(this.v) < eps * 12) {
      this.m = 1;
      this.v = 0;
      this.atRest = true;
    }
  }

  /** Interpolates the drawn progress between the last two fixed steps. */
  interpolate(alpha: number): void {
    this.p = this.atRest ? this.m : this.mPrev + (this.m - this.mPrev) * alpha;
  }
}

/**
 * Splits frame time into fixed steps. Returns the number of steps to run this frame; `alpha` is the
 * interpolation factor for drawing.
 */
export class FixedStepper {
  private acc = 0;
  alpha = 0;

  advance(dt: number): number {
    const h = POPUP.step;
    this.acc += Math.min(dt, h * POPUP.maxSubSteps);
    const n = Math.floor(this.acc / h + 1e-7);
    this.acc -= n * h;
    if (this.acc < 0) this.acc = 0;
    this.alpha = this.acc / h;
    return n;
  }
}
