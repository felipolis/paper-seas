/**
 * The papercraft skill's paper-safe colour mixing (its kit's shade): darkening goes toward a warm umber and lightening
 * toward a warm white, never toward grey or black. Used for the captains' card colours (player/crew-model.ts) and the
 * chart's inks (ui/chart.ts).
 */
import { hexRgb } from '../core/math';

/** The skill's warm umber (darkening) and warm white (lightening). */
const UMBER = '#2b1a0e';
const WARM_WHITE = '#fff7e8';

const hexOf = (c: readonly number[]): string => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

/** a mixed toward b by t (sRGB, as the skill mixes its hex colours). */
export function mix(a: string, b: string, t: number): string {
  const A = hexRgb(a);
  const B = hexRgb(b);
  return hexOf(A.map((v, k) => v + (B[k] - v) * t));
}

/** Paper-safe shading: k < 0 darkens toward warm umber, k > 0 lightens toward warm white. */
export function tone(c: string, k: number): string {
  return k < 0 ? mix(c, UMBER, Math.min(1, -k)) : mix(c, WARM_WHITE, Math.min(1, k));
}
