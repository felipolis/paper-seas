/**
 * The hull of the chosen ship as plain functions, shared by the game (decks, masts, rigging, collisions, wake) and,
 * through tools/ship/export-shape.mjs, by the Blender build (tools/blender/build_ship.py), so the paper model and the
 * game always agree. t runs along the hull from the stern (0) to the bow (1); y is the height above the waterline.
 *
 * Each ship type has its own structure (config/ships.ts HullSpec): a main deck along the waist, a raised quarterdeck
 * aft (the roof of the great cabin), on the bigger ships a poop deck higher still over the captain's cabin, a
 * forecastle at the bow; the rail (sheer) runs a bulwark above whatever deck is under it and steps up at each break.
 * The plan (each ship's own) is full amidships, rounds into a flat transom aft and into a bluff round bow, a long fine
 * entry or a junk's blunt square bow; the sides tumble home above the wale and close down to the keel below the water.
 */
import { SHIP } from '../config/ship';
import { activeShip, type HullSpec } from '../config/ships';
import { clamp, smoothstep } from '../core/math';

const SPEC: HullSpec = activeShip().hull;
export const HULL_LENGTH = SHIP.length;
/** Length (share of t) of the curved step where the rail climbs from one deck's bulwark to the next. */
const STEP = 0.035;

/** Deck height at t (poop, quarterdeck, main deck or forecastle). */
export function deckHeightAt(t: number): number {
  if (SPEC.poop && t < SPEC.poop.end) return SPEC.poop.height;
  if (SPEC.quarter && t < SPEC.quarter.end) return SPEC.quarter.height;
  if (SPEC.forecastle && t > SPEC.forecastle.start) return SPEC.forecastle.height;
  return SPEC.main;
}

/** The decks as spans [t0, t1] with their height (stern first). */
export function deckSpans(): Array<{ name: string; t0: number; t1: number; y: number }> {
  const out: Array<{ name: string; t0: number; t1: number; y: number }> = [];
  const qEnd = SPEC.quarter?.end ?? 0;
  const pEnd = SPEC.poop?.end ?? 0;
  const fStart = SPEC.forecastle?.start ?? 1;
  if (SPEC.poop) out.push({ name: 'poop', t0: 0, t1: pEnd, y: SPEC.poop.height });
  if (SPEC.quarter) out.push({ name: 'quarter', t0: SPEC.poop ? pEnd : 0, t1: qEnd, y: SPEC.quarter.height });
  out.push({ name: 'main', t0: qEnd, t1: fStart, y: SPEC.main });
  if (SPEC.forecastle) out.push({ name: 'forecastle', t0: fStart, t1: 1, y: SPEC.forecastle.height });
  return out;
}

/** Height of the rail (top of the bulwark) at t: a bulwark above the deck, easing up and down at the breaks. */
export function sheer(t: number): number {
  const b = SPEC.bulwark;
  let h = SPEC.main + b;
  if (SPEC.quarter) h = Math.max(h, SPEC.main + b + (SPEC.quarter.height - SPEC.main) * (1 - smoothstep(SPEC.quarter.end - STEP, SPEC.quarter.end + STEP * 0.4, t)));
  if (SPEC.poop) h = Math.max(h, SPEC.main + b + (SPEC.poop.height - SPEC.main) * (1 - smoothstep(SPEC.poop.end - STEP, SPEC.poop.end + STEP * 0.4, t)));
  if (SPEC.forecastle) h = Math.max(h, SPEC.main + b + (SPEC.forecastle.height - SPEC.main) * smoothstep(SPEC.forecastle.start - STEP * 0.4, SPEC.forecastle.start + STEP, t));
  // the ends sweep up (a junk's stern most of all), and a carrack's whole rail rises in a crescent toward them
  h += SPEC.sternSweep * (1 - smoothstep(0, 0.12, t)) ** 2 + SPEC.bowSweep * smoothstep(0.85, 1, t) ** 2;
  h += (SPEC.crescent ?? 0) * (2 * t - 1) ** 2;
  return h;
}

/** Tallest point of the rail. */
export function hullTop(): number {
  let top = 0;
  for (let t = 0; t <= 1; t += 0.01) top = Math.max(top, sheer(t));
  return top;
}

/** Half beam of the hull plan at t (at its widest height). */
export function planHalfBeam(t: number): number {
  const B = SHIP.halfBeam;
  const { aft, fore, entry } = SPEC.plan;
  // aft: from the transom's width the quarters swell out to the full beam
  if (t < aft) {
    const k = clamp(t / aft, 0, 1);
    return B * (SPEC.transom + (1 - SPEC.transom) * Math.sin(k * Math.PI * 0.5) ** 0.7);
  }
  if (t < fore) return B;
  const k = clamp((t - fore) / (1 - fore), 0, 1);
  // forward: a bluff round bow or a long fine entry closing on the stem, or a junk's blunt square bow
  const close = Math.cos(k * Math.PI * 0.5) ** entry;
  return B * (SPEC.bowWidth + (1 - SPEC.bowWidth) * close);
}

/** Half beam at t and height y: the sides tumble home above the wale and close in to the keel below the water. */
export function halfBeamAt(t: number, y: number): number {
  const plan = planHalfBeam(t);
  const wide = 0.14;
  let k: number;
  if (y >= wide) k = 1 - SPEC.tumblehome * clamp((y - wide) / Math.max(0.1, sheer(t) - wide), 0, 1.2);
  else {
    const d = clamp((wide - y) / (wide + SPEC.draft), 0, 1);
    k = 1 - 0.85 * d ** 1.7;
  }
  return Math.max(0.004, plan * k);
}

/** The ship-local z of t (stern t = 0 .. bow t = 1; forward is -z). */
export const zOf = (t: number): number => (0.5 - t) * HULL_LENGTH;

/**
 * The stern lanterns over the taffrail: across (x), how far each stands above the rail on its post (lift: the centre
 * one of three on a taller post) and its size. The game hangs the lantern cards there, Blender stands the posts.
 */
export function lanternSpots(): Array<{ x: number; lift: number; scale: number }> {
  const x = halfBeamAt(0, sheer(0.01)) * 0.8;
  if (SPEC.lanterns === 1) return [{ x: 0, lift: 0.04, scale: 0.85 }];
  const pair = [{ x: -x, lift: 0, scale: 0.55 }, { x, lift: 0, scale: 0.55 }];
  return SPEC.lanterns === 2 ? pair : [...pair, { x: 0, lift: 0.12, scale: 0.7 }];
}

/** Mast positions along the hull (t) and their heights above the deck they stand on (the chosen ship's). */
export const MASTS = activeShip().masts;
