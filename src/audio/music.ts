/**
 * The voyage's music: a calm barcarolle (a boat song, 6/8, D minor) on a felt piano, an original 16-bar piece played
 * over and over with small deterministic variations (every other time through the melody sings an octave lower,
 * every third time the left hand thins out, here and there a note is left out).
 *
 * The piano is played with a velocity-dependent low-pass, panned by pitch, in a dark 4 s hall, its notes scheduled a
 * little ahead of the audio clock. The notes are synthesised in a worker (piano-worker.ts) so the frame rate never hitches.
 *
 * Gameplay chimes are single notes of the same piano taken from the chord of the bar that is sounding, so they always
 * belong to the music.
 */
import { AUDIO } from '../config/audio';
import { NOTE_SR } from './piano-synth';
import { hash01 } from '../core/rng';

/** Eighth notes per bar. */
const BEATS = 6;
/** Left hand per bar: [bass, t1, t2, t3] (MIDI): Dm Dm/C Bb A | Dm Gm C F | Bb F/A Gm Dm/F | Bb C A Dm. */
const LEFT: ReadonlyArray<readonly [number, number, number, number]> = [
  [38, 45, 50, 53], [36, 45, 50, 53], [34, 41, 46, 50], [33, 40, 45, 49],
  [38, 45, 50, 53], [31, 38, 43, 46], [36, 43, 48, 52], [29, 36, 45, 48],
  [34, 41, 46, 50], [33, 41, 45, 48], [31, 38, 43, 46], [29, 38, 45, 50],
  [34, 41, 46, 50], [36, 43, 48, 52], [33, 40, 45, 49], [38, 45, 50, 53],
];
/** Right hand per bar: [eighth, midi, velocity scale]. */
const RIGHT: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [[0, 69, 1], [3, 65, 0.8], [5, 64, 0.6]],
  [[0, 62, 0.9], [3, 65, 0.75], [4, 69, 0.8]],
  [[0, 74, 1], [3, 72, 0.8], [5, 70, 0.7]],
  [[0, 69, 0.95], [3, 64, 0.7]],
  [[0, 65, 0.85], [2, 69, 0.8], [3, 74, 1]],
  [[0, 74, 0.9], [3, 70, 0.8], [5, 67, 0.65]],
  [[0, 76, 1], [3, 72, 0.8], [4, 67, 0.7]],
  [[0, 69, 0.9], [3, 65, 0.7]],
  [[0, 77, 1], [3, 74, 0.85], [5, 70, 0.7]],
  [[0, 72, 0.95], [3, 69, 0.8]],
  [[0, 70, 0.9], [2, 74, 0.85], [3, 67, 0.75]],
  [[0, 69, 0.85], [3, 65, 0.7], [5, 62, 0.6]],
  [[0, 74, 0.95], [3, 77, 0.9]],
  [[0, 76, 0.95], [2, 74, 0.8], [3, 72, 0.8]],
  [[0, 74, 0.9], [3, 73, 0.85]],
  [[0, 74, 0.85], [3, 69, 0.6]],
];
/** The rocking left hand: bass, rising through the chord and back (eighths 0..5). */
const LEFT_IDX = [0, 1, 2, 3, 2, 1];
/** Salt of the score's choices per bar (core/rng hash01). */
const SCORE_SALT = 0x5c07e;

interface Note {
  beat: number;
  midi: number;
  vel: number;
}

/** The notes of one bar (deterministic per bar number). */
function barNotes(bar: number): Note[] {
  const i = ((bar % 16) + 16) % 16;
  const cycle = Math.floor(bar / 16);
  const r = (k: number) => hash01(SCORE_SALT, bar, k);
  const out: Note[] = [];
  const lh = LEFT[i];
  const sparse = cycle % 3 === 2;
  for (let k = 0; k < 6; k++) {
    if (k > 0 && sparse && k % 2 === 1) continue;
    if (k >= 4 && r(k) < 0.3) continue;
    const vel = (k === 0 ? 0.3 : k === 3 ? 0.17 : 0.14) * (0.9 + r(10 + k) * 0.2);
    out.push({ beat: k + (k ? (r(20 + k) - 0.5) * 0.05 : 0), midi: lh[LEFT_IDX[k]], vel });
  }
  const low = cycle % 2 === 1;
  RIGHT[i].forEach(([b, m, v], k) => {
    if (cycle > 0 && k > 0 && r(40 + k) < 0.22) return;
    out.push({ beat: b + 0.02 + (r(50 + k) - 0.5) * 0.05, midi: low ? m - 12 : m, vel: (low ? 0.2 : 0.22) * v * (0.9 + r(60 + k) * 0.2) });
  });
  return out;
}

/** Every pitch the piece (and the chimes) can play. */
const ALL_NOTES: number[] = (() => {
  const s = new Set<number>();
  for (const l of LEFT) for (const m of l) s.add(m);
  for (const b of RIGHT) for (const [, m] of b) {
    s.add(m);
    s.add(m - 12);
  }
  for (const m of [79, 81, 86]) s.add(m);
  return [...s].sort((a, b) => a - b);
})();

/** A dark hall: 4 s of noise whose tail grows duller as it fades. */
function makeHall(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 4);
  const buf = ctx.createBuffer(2, n, sr);
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2147483648 - 1);
  const pre = Math.floor(sr * 0.022);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      lp += (rnd() - lp) * (0.03 + 0.12 * Math.exp(-t * 2.2));
      d[i] = lp * Math.exp(-t * 1.7) * Math.min(1, t / 0.03);
    }
  }
  return buf;
}

export type ChimeKind = 'discover' | 'treasure' | 'bottle';

const CHIMES: Record<ChimeKind, { lo: number; hi: number; vel: number; notes: number; gap: number }> = {
  discover: { lo: 62, hi: 79, vel: 0.17, notes: 2, gap: 0.2 }, // a two-note rising figure
  treasure: { lo: 62, hi: 86, vel: 0.17, notes: 2, gap: 0.15 }, // a wider two-note figure (never more than two)
  bottle: { lo: 74, hi: 86, vel: 0.14, notes: 1, gap: 0 }, // one high soft note
};

/** The time constant of M's fade (s). */
const MUTE_FADE = 0.15;

export class Music {
  private readonly out: GainNode;
  private readonly dry: GainNode;
  private readonly buffers = new Map<number, AudioBuffer>();
  private origin = -1;
  private done = 0;
  private chimeAt = -1;
  private chimeTurn = 0;
  /** Turned off (M): its output faded out, the score running on silently so it comes back in time. */
  private off = false;

  constructor(private readonly ctx: AudioContext, destination: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    this.dry = ctx.createGain();
    this.dry.connect(this.out);
    const hall = ctx.createConvolver();
    hall.buffer = makeHall(ctx);
    const wet = ctx.createGain();
    wet.gain.value = AUDIO.music.reverb;
    this.dry.connect(hall).connect(wet).connect(this.out);

    const worker = new Worker(new URL('./piano-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ midi: number; samples: Float32Array<ArrayBuffer> }>) => {
      const { midi, samples } = e.data;
      const b = ctx.createBuffer(1, samples.length, NOTE_SR);
      b.copyToChannel(samples, 0);
      this.buffers.set(midi, b);
      if (this.buffers.size === ALL_NOTES.length) worker.terminate();
    };
    worker.postMessage(ALL_NOTES);
    // (the score is scheduled a little ahead of the audio clock, for the whole session)
    window.setInterval(() => this.tick(), 60);
  }

  /** M: fades the music out, or back in. */
  setOff(off: boolean): void {
    this.off = off;
    // (before it has started, its first fade-in is its own)
    if (this.origin < 0) return;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setTargetAtTime(off ? 0 : AUDIO.music.gain, this.ctx.currentTime, MUTE_FADE);
  }

  /** A quiet note (or figure) of the piano, in the chord that is sounding. Rate-limited. */
  chime(kind: ChimeKind): void {
    if (this.origin < 0 || this.ctx.state !== 'running') return;
    const k = CHIMES[kind];
    const now = this.ctx.currentTime;
    if (now - this.chimeAt < 0.3) return;
    const bar = Math.max(0, Math.floor((now - this.origin) / this.barLength));
    const chord = LEFT[bar % 16];
    const cand = ALL_NOTES.filter((m) => m >= k.lo && m <= k.hi && this.buffers.has(m) && chord.some((c) => (m - c) % 12 === 0));
    if (!cand.length) return;
    this.chimeAt = now;
    this.chimeTurn++;
    const first = k.notes === 1 ? (this.chimeTurn * 2) % cand.length : this.chimeTurn % Math.max(1, cand.length - k.notes + 1);
    for (let i = 0; i < k.notes && first + i < cand.length; i++) this.play(now + 0.02 + i * k.gap, cand[first + i], k.vel * (1 + i * 0.08));
  }

  private get barLength(): number {
    return (60 / AUDIO.music.bpm) * BEATS;
  }

  private tick(): void {
    if (this.ctx.state !== 'running') return;
    if (this.origin < 0) {
      // start once every note is ready
      if (this.buffers.size < ALL_NOTES.length) return;
      this.origin = this.ctx.currentTime + 0.3;
      this.done = 0;
      // (it fades in once, as it starts, unless it was turned off before)
      if (!this.off) this.out.gain.setTargetAtTime(AUDIO.music.gain, this.ctx.currentTime, AUDIO.music.fadeIn / 3);
    }
    const now = this.ctx.currentTime - this.origin;
    // (after a stall - a hidden tab, a long block - the notes it missed are skipped, not all played at once)
    this.done = Math.max(this.done, now);
    const until = now + 1.2;
    if (until > this.done) {
      this.schedule(this.done, until);
      this.done = until;
    }
  }

  /** Schedules every note whose onset lies in [t0, t1) (music time). */
  private schedule(t0: number, t1: number): void {
    const eighth = 60 / AUDIO.music.bpm;
    const barLen = eighth * BEATS;
    const b0 = Math.max(0, Math.floor((t0 - 0.2) / barLen) - 1);
    const b1 = Math.floor(t1 / barLen);
    for (let bar = b0; bar <= b1; bar++) {
      // a breath at the end of each 8-bar phrase: its last eighths stretch a little
      const phraseEnd = bar % 8 === 7;
      for (const n of barNotes(bar)) {
        const rub = phraseEnd && n.beat > 2.9 ? (n.beat - 2.9) * 0.06 : 0;
        const t = bar * barLen + (n.beat + rub) * eighth + 0.1;
        if (t >= t0 && t < t1) this.play(this.origin + t, n.midi, n.vel);
      }
    }
  }

  private play(t: number, midi: number, vel: number): void {
    const buffer = this.buffers.get(midi);
    if (!buffer) return;
    const ctx = this.ctx;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.value = Math.max(350, Math.min(1900, f * (1.3 + vel * 5))); // softer = darker
    const g = ctx.createGain();
    g.gain.value = vel;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.45, Math.min(0.45, (midi - 60) / 55));
    src.connect(lp).connect(g).connect(pan).connect(this.dry);
    src.start(t);
  }
}
