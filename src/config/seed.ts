/**
 * The world's seed. Every voyage has its own world: a new voyage draws a fresh seed (or takes one the player typed,
 * to sail a friend's world), and the world then stays the same for the whole voyage, so places, the chart and
 * found treasure keep agreeing. Kept in localStorage with the voyage.
 */
const KEY = 'paper-seas:seed';

function draw(): number {
  return 1 + Math.floor(Math.random() * 999_999);
}

function load(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (Number.isInteger(v) && v > 0) return v;
    const s = draw();
    localStorage.setItem(KEY, String(s));
    return s;
  } catch {
    return draw();
  }
}

/** The seed of the current voyage (read once at load: the world is built from it). */
export const VOYAGE_SEED: number = typeof localStorage === 'undefined' ? 7 : load();

/** Sets the seed of the next voyage: the given one, or a fresh random one. Returns it. */
export function nextVoyageSeed(seed?: number): number {
  const s = seed && Number.isInteger(seed) && seed > 0 ? seed : draw();
  try {
    localStorage.setItem(KEY, String(s));
  } catch {
    // storage unavailable
  }
  return s;
}
