/**
 * The wind in the standing cards (papertrails' sway, world/fold.js and config/fold.js there): every upright card rocks a
 * little about its hinge, toward and away from the camera, more the taller and thinner it is, by its kind (grass and
 * palms loose, posts and animals stiff, rocks and walls rigid), the tall ones slower, and twists a little about its own
 * long axis as it rocks. The angle is a pure function of (time, place):
 *
 *   gust g  two slow sine fronts travelling across the land (the main one bent sideways, so they are not ruler-straight)
 *   sway    A * (0.5 (g - 0.3) (wind . card normal) + (0.35 + 0.65 g) * flutter(t, place))
 *
 * so neighbours meet the same front one after the other, and a card the wind meets face-on leans downwind in a gust.
 */
import { hash01 } from '../core/rng';
import { DEG, clamp } from '../core/math';
import type { Biome } from './land';

const MIN_DEG = 0.6;
const MAX_DEG = 2.2;
const LIMIT_DEG = 2.5;
const CUTOFF_DEG = 0.08;
const HZ_SMALL = 0.8;
const HZ_TALL = 0.42;
/** Twist about the card's long axis per rad of sway. */
const TWIST = 0.5;
/** Gust fronts: direction (from +x toward +z), wavelengths (world units), periods (s), strengths, sideways bend (rad). */
const DIR = 30 * DEG;
const D1X = Math.cos(DIR);
const D1Z = Math.sin(DIR);
const D2X = Math.cos(DIR + 0.9);
const D2Z = Math.sin(DIR + 0.9);
const K1 = (2 * Math.PI) / 14;
const W1 = (2 * Math.PI) / 9;
const K2 = (2 * Math.PI) / 8;
const W2 = (2 * Math.PI) / 5.3;
const G1 = 0.32;
const G2 = 0.18;
const WARP = 1.7;
/** Wavelength (world units) of the flutter phase along the wind: neighbours rock one after the other. */
const KF = (2 * Math.PI) / 5;
/** Seconds for the sway to fade in once a card has settled upright, and to relax away once it moves again. */
export const SWAY_FADE_IN = 1.2;
export const SWAY_RELEASE = 0.22;
/** Only cards this close to the focus sway (papertrails: 5.5 tiles). */
export const SWAY_RADIUS = 11;

const LOOSE = /^(grass|fern|flower|palm|reed)/;
const STIFF = /^(post|flag|tiki|windmill|monkey|parrot|toucan|crab|iguana|pelican|flamingo|deadwood)/;
const RIGID = /^(rock|ruin|pillar|crate|barrel|cannon|chest|market|waterfall|skull|sea-arch)/;

export interface Sway {
  /** Amplitude (rad) at wind strength 1, 0 = the card never sways. */
  amp: number;
  /** Flutter rate (rad / s) and phase. */
  rate: number;
  phase: number;
  /** Twist about the card's long axis per rad of sway (its sign varies from card to card). */
  twist: number;
}

/** The sway of a card: its sprite, height and width (world units) and where it stands (its random numbers). */
export function swayOf(sprite: string, height: number, width: number, x: number, z: number): Sway {
  const tall = clamp((height - 0.25) / 1.0, 0, 1);
  const thin = clamp((height / Math.max(width, 1e-3) - 0.7) / 1.2, 0, 1);
  const cls = LOOSE.test(sprite) ? 1.3 : STIFF.test(sprite) ? 0.35 : RIGID.test(sprite) ? 0.04 : 1;
  const deg = (MIN_DEG + (MAX_DEG - MIN_DEG) * (0.55 * tall + 0.45 * thin)) * cls;
  if (deg < CUTOFF_DEG) return { amp: 0, rate: 0, phase: 0, twist: 0 };
  const ix = Math.round(x * 1000);
  const iz = Math.round(z * 1000);
  const r = (salt: number) => hash01(salt, ix, iz);
  return {
    amp: deg * DEG,
    rate: 2 * Math.PI * (HZ_SMALL + (HZ_TALL - HZ_SMALL) * tall) * (0.85 + 0.3 * r(31)),
    phase: r(37) * Math.PI * 2,
    twist: (r(41) < 0.5 ? -1 : 1) * TWIST * (0.6 + 0.4 * r(43)),
  };
}

/**
 * The sway angle (rad) of a card at (x, z) at time t, at full fade-in; (nx, nz): the way its top tips as the angle
 * grows (unit, on the ground). strength: the wind's (windStrength).
 */
export function swayAngle(s: Sway, x: number, z: number, nx: number, nz: number, t: number, strength: number): number {
  if (s.amp === 0) return 0;
  const along = x * D1X + z * D1Z;
  const a = along * K1 - t * W1 + WARP * Math.sin((z * D1X - x * D1Z) * K1 * 0.6);
  const b = (x * D2X + z * D2Z) * K2 - t * W2;
  const g = 0.5 + G1 * Math.sin(a) + G2 * Math.sin(b);
  const e = 0.35 + 0.65 * g;
  const ph = s.rate * t + s.phase - along * KF;
  const amp = Math.min(LIMIT_DEG * DEG, s.amp * strength);
  return amp * (0.5 * (g - 0.3) * (nx * D1X + nz * D1Z) + e * (0.55 * Math.sin(ph) + 0.1 * Math.sin(2.31 * ph + 1.7)));
}

/**
 * papertrails' wind strength per biome (config/fold.js wind.strength there: heartland 1, blossom 0.85, pinewood 0.32,
 * the pine woods all but still), its rows taken as the biome tints take them (render/biome-tint.ts). A card with no
 * biome (an animal) takes the heartland's.
 */
const STRENGTH: Record<Biome, number> = { jungle: 1, rocky: 1, beach: 1, meadow: 0.85, pine: 0.32 };

export function windStrength(biome: Biome | undefined): number {
  return biome ? STRENGTH[biome] : 1;
}
