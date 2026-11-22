/**
 * One felt-piano note as mono samples, peak-normalised. The voice is ported from papertrails by xikhar (MIT licence,
 * https://github.com/xikhar/papertrails, src/audio/music.js): inharmonic partials (a stiff string stretches them
 * sharp), two slightly detuned strings per partial that beat slowly, a two-stage decay with the higher partials
 * dying sooner, a felt hammer struck near 1/8 of the string, and a soft low-passed thump at the onset.
 * Pure and deterministic: it runs in the piano worker.
 */
export const NOTE_SR = 24000;

function hash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function synthNote(midi: number): Float32Array<ArrayBuffer> {
  const sr = NOTE_SR;
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const dur = Math.max(3.2, Math.min(7.5, 7.5 - (midi - 36) * 0.075));
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const B = 0.00008 * Math.pow(2, (midi - 40) / 12); // string stiffness: partials stretch sharp
  const d0 = 0.55 + Math.max(0, midi - 40) * 0.022; // slow decay rate (1/s): higher notes die sooner
  const maxK = Math.max(2, Math.min(12, Math.floor(2800 / f)));
  for (let k = 1; k <= maxK; k++) {
    const fk = f * k * Math.sqrt(1 + B * k * k);
    if (fk > sr * 0.45) break;
    // felt hammer: steep roll-off; struck at ~1/8 of the string (weak 8th partial)
    const amp = (Math.pow(k, -2.4) * Math.abs(Math.sin((Math.PI * k) / 8.3))) / Math.abs(Math.sin(Math.PI / 8.3));
    const dk = d0 * (1 + 0.42 * (k - 1));
    const rFast = Math.exp((-dk * 3.2) / sr);
    const rSlow = Math.exp((-dk * 0.7) / sr);
    for (let s = 0; s < 2; s++) {
      const cents = (s ? 1 : -1) * (0.5 + 0.12 * k);
      const w = (2 * Math.PI * fk * Math.pow(2, cents / 1200)) / sr;
      const c2 = 2 * Math.cos(w);
      const ph = hash(midi, k * 2 + s) * 6.283;
      let y1 = Math.sin(ph - w);
      let y2 = Math.sin(ph - 2 * w);
      let eF = 0.6 * amp * 0.5;
      let eS = 0.4 * amp * 0.5;
      for (let i = 0; i < n; i++) {
        const y = c2 * y1 - y2;
        y2 = y1;
        y1 = y;
        out[i] += y * (eF + eS);
        eF *= rFast;
        eS *= rSlow;
      }
    }
  }
  // soft hammer thump (low-passed noise, ~25 ms) + attack + release fade
  let seed = (midi * 2654435761) >>> 0;
  let lp = 0;
  const thump = 0.025 * Math.min(1, 200 / f + 0.3);
  const att = Math.floor(sr * 0.006);
  const rel = Math.floor(sr * 0.5);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    if (i < sr * 0.04) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      lp += (seed / 2147483648 - 1 - lp) * 0.12;
      out[i] += lp * thump * Math.exp(-i / (sr * 0.008));
    }
    if (i < att) out[i] *= i / att;
    if (i > n - rel) out[i] *= (n - i) / rel;
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  const g = 1 / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}
