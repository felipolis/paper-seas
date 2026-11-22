/**
 * The world's seed. Every voyage has its own world: a new voyage draws a fresh seed (or takes one the player typed,
 * to sail a friend's world), and the world then stays the same for the whole voyage, so places, the chart and
 * found treasure keep agreeing. Kept in the browser with the voyage (core/storage.ts).
 */
import { loadText, saveText } from '../core/storage';

const KEY = 'paper-seas:seed';

function draw(): number {
  return 1 + Math.floor(Math.random() * 999_999);
}

/** The stored seed, or a fresh one (stored for the voyage). */
function load(): number {
  const v = Number(loadText(KEY));
  if (Number.isInteger(v) && v > 0) return v;
  const s = draw();
  saveText(KEY, String(s));
  return s;
}

/** The seed of the current voyage (read once at load: the world is built from it). */
export const VOYAGE_SEED: number = load();

/** Sets the seed of the next voyage: the given one, or a fresh random one. Returns it. */
export function nextVoyageSeed(seed?: number): number {
  const s = seed && Number.isInteger(seed) && seed > 0 ? seed : draw();
  saveText(KEY, String(s));
  return s;
}
