/**
 * Live player of the synthesised paper sounds (allocation after papertrails by xikhar, MIT, audio/paper.js there):
 *   - a fixed pool of voice slots (gain + stereo panner, each with its own reusable buffer), the quietest voice is
 *     faded out and replaced when all are busy;
 *   - a token-bucket rate limit, and overlapping voices turned down (~1 / sqrt(voices)) so they never sum into hiss;
 *     detail flaps (the smallest pieces) give way first when the page is busy, and may not spend the last tokens;
 *   - one sound per gesture: the pieces of one cell moving the same way within a group window speak as one, its
 *     largest piece taking the gesture's place while it waits (the skill: one flap for a group's largest layer);
 *   - flaps keep a minimum spacing: pieces rising around the ship come out as a soft flap now and then, the loudest
 *     waiting gesture (nearest, largest) taking the next slot, a little quieter the longer it waited, late ones
 *     dropped.
 * Everything goes through a short room (early reflections) into `out`.
 */
import { AUDIO } from '../config/audio';
import { MAX_SOUND_SECONDS, flapVoice, makeRoomIR, stepVoice, synthFlap, synthKnock, synthStep } from './paper-synth';
import type { StepSurface } from '../core/events';
import { clamp, lerp, smoothstep } from '../core/math';
import { mulberry32 } from '../core/rng';

interface Slot {
  gain: GainNode;
  pan: StereoPannerNode;
  src: AudioBufferSourceNode | null;
  buffer: AudioBuffer;
  start: number;
  end: number;
  freeAt: number;
  level: number;
  dur: number;
  released: boolean;
}

/** A flap waiting to be voiced. */
interface Candidate {
  /** When its piece moves (audio clock). */
  t: number;
  up: boolean;
  size: number;
  gain: number;
  pan: number;
  air: number;
  seed: number;
  /** How it ranks for the next slot (louder: nearer, larger, rising). */
  score: number;
  /** The gesture it speaks for (none: a sheet the player moved). */
  gesture: Gesture | null;
}

/** One gesture: a cell's pieces moving one way within the group window. */
interface Gesture {
  /** When it began (audio clock). */
  t: number;
  voiced: boolean;
  /** Its flap waiting for a slot, if any. */
  waiting: Candidate | null;
}

export class PaperVoices {
  private readonly slots: Slot[] = [];
  private readonly sr: number;
  private tokens: number = AUDIO.rate.burst;
  private tokenT = -1;
  private lastSt: number | null = null;
  private nextOnset = -1;
  /** The one flap waiting for the next slot (papertrails' queue of one). */
  private queued: Candidate | null = null;
  /** The gestures under way, by key and direction. */
  private readonly gestures = new Map<string, Gesture>();

  constructor(private readonly ctx: AudioContext, out: AudioNode) {
    this.sr = ctx.sampleRate;
    const room = ctx.createConvolver();
    room.normalize = false;
    room.buffer = makeRoomIR(ctx);
    room.connect(out);
    const bus = ctx.createGain();
    bus.channelCount = 2;
    bus.channelCountMode = 'explicit';
    bus.connect(room);
    const maxLen = Math.ceil(MAX_SOUND_SECONDS * this.sr);
    for (let i = 0; i < AUDIO.maxVoices + AUDIO.spareVoices; i++) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      gain.connect(pan).connect(bus);
      this.slots.push({ gain, pan, src: null, buffer: ctx.createBuffer(1, maxLen + 2, this.sr), start: -1, end: -1, freeAt: -1, level: 0, dur: 0.1, released: true });
    }
  }

  /**
   * A piece rose (up) or folded away. size: 0 (tiny) .. 1 (large), gain: distance gain 0..1, pan -1..1, air 0..1
   * (distance softening), delay: seconds until the piece actually moves. force: a sheet the player moved (the chart,
   * the sails), played at once whatever the spacing. key: the gesture it belongs to (its cell).
   */
  flap(up: boolean, size: number, gain: number, pan: number, air: number, seed: number, delay = 0, force = false, key?: string): void {
    if (gain * AUDIO.flap.gain < AUDIO.minGain) return;
    const F = AUDIO.flaps;
    const now = this.ctx.currentTime;
    this.drain(now);
    const t = now + delay;
    const score = gain * lerp(AUDIO.flap.sizeGainMin, 1, size) * (up ? 1 : F.downScore);
    const c: Candidate = { t, up, size, gain, pan, air, seed, score, gesture: null };
    if (force || key === undefined) {
      this.startOne(c, now);
      return;
    }
    const k = `${key}|${up ? 1 : 0}`;
    let g = this.gestures.get(k);
    if (!g || t - g.t > F.groupWindow) {
      // (forget the gestures long past, a few at a time)
      if (this.gestures.size > 96) for (const [o, v] of this.gestures) if (now - v.t > F.groupWindow && !v.waiting) this.gestures.delete(o);
      g = { t, voiced: false, waiting: null };
      this.gestures.set(k, g);
    }
    if (g.voiced) return;
    if (g.waiting) {
      // a larger piece of a gesture still waiting takes over its place
      if (size > g.waiting.size) Object.assign(g.waiting, { up, size, gain, pan, air, seed, score: Math.max(g.waiting.score, score) });
      return;
    }
    c.gesture = g;
    if (!this.queued && t <= now + F.lookahead && t >= this.nextOnset) {
      this.startOne(c, Math.max(t, now));
      return;
    }
    // one waiting place: the louder candidate keeps it
    if (this.queued && this.queued.score >= score) return;
    if (this.queued?.gesture) this.queued.gesture.waiting = null;
    this.queued = c;
    g.waiting = c;
  }

  /**
   * The rise of gesture `key` was called off before its pieces moved: its flap, if still waiting for its slot, is
   * dropped (papertrails voices a flap only as it starts moving, so a rise called off is never heard).
   */
  cancel(key: string): void {
    const g = this.gestures.get(`${key}|1`);
    if (!g?.waiting) return;
    if (this.queued === g.waiting) this.queued = null;
    g.waiting = null;
  }

  /** The hull struck a shore. */
  knock(strength: number, seed: number): void {
    const now = this.ctx.currentTime;
    const slot = this.claim(now, AUDIO.knock.gain);
    if (!slot) return;
    const data = slot.buffer.getChannelData(0);
    const n = synthKnock(data, this.sr, clamp(strength, 0, 1), mulberry32(seed));
    this.launch(slot, now + 0.004, n / this.sr, AUDIO.knock.gain * clamp(0.5 + strength * 0.6, 0.4, 1.1), 0, AUDIO.knock.dur);
  }

  /** A foot came down (papertrails: never rate-limited, a little to its own side). */
  step(surface: StepSurface, foot: 0 | 1, seed: number): void {
    const now = this.ctx.currentTime;
    const V = stepVoice(surface, seed, foot);
    const slot = this.claim(now, V.level);
    if (!slot) return;
    const data = slot.buffer.getChannelData(0);
    const n = synthStep(data, this.sr, V, mulberry32(V.synthSeed));
    this.launch(slot, now + 0.004, n / this.sr, V.level, (foot ? 1 : -1) * AUDIO.step.footPan, V.dur);
  }

  /** Starts the queued flap when its slot comes (call every frame). */
  update(): void {
    this.drain(this.ctx.currentTime);
  }

  private drain(now: number): void {
    const c = this.queued;
    const F = AUDIO.flaps;
    // (a voice is only ever started for the next few milliseconds: its slot must be free right now)
    if (!c || this.nextOnset > now + F.lookahead || c.t > now + F.lookahead) return;
    this.queued = null;
    const at = Math.max(this.nextOnset, c.t, now);
    if (at - c.t > F.maxDefer) {
      if (c.gesture) c.gesture.waiting = null;
      return;
    }
    this.startOne(c, at);
  }

  /** Voices a candidate at `at`, a little quieter the longer it waited; the next flap keeps its spacing after it. */
  private startOne(c: Candidate, at: number): void {
    const F = AUDIO.flaps;
    if (c.gesture) c.gesture.waiting = null;
    const wait = Math.max(0, at - c.t);
    const start = this.play(c, at, Math.pow(10, (-F.deferDb * Math.min(1, wait / F.maxDefer)) / 20));
    if (start === null) return;
    if (c.gesture) c.gesture.voiced = true;
    this.nextOnset = start.at + F.spacing + F.spacingJitter * ((((start.seed >>> 10) & 1023) / 1023) * 2 - 1);
  }

  /** Synthesises and starts one flap at `at` (extGain: a deferred flap's softening); its onset and seed, or null. */
  private play(c: Candidate, at: number, extGain: number): { at: number; seed: number } | null {
    const A = AUDIO;
    const active = this.active(at);
    const density = clamp(active / A.maxVoices, 0, 1);
    // detail flaps give way first when the page is busy: quieter, and they cost more of the rate budget
    const big = smoothstep(0, 1, (c.size - A.detail.below) / A.detail.range);
    const cost = 1 + (1 - big) * A.detail.cost * density;
    if (this.tokenT >= 0) this.tokens = Math.min(A.rate.burst, this.tokens + (at - this.tokenT) * A.rate.perSecond);
    this.tokenT = at;
    // (details may not spend the last tokens: those are kept for the next real flap)
    if (this.tokens < cost + (big < 0.5 ? A.rate.reserve : 0)) return null;
    const V = flapVoice(c.up, c.size, c.seed, this.lastSt);
    const level = (V.level * c.gain * extGain * (1 - A.densityDuck * density * (1 + A.detail.duck * (1 - big)))) / Math.sqrt(1 + A.overlapDuck * active);
    const slot = this.claim(at, level);
    if (!slot) return null;
    this.tokens -= cost;
    this.lastSt = V.semitones;
    const data = slot.buffer.getChannelData(0);
    const n = synthFlap(data, this.sr, { ...V, tick: 1 - A.densityTickDuck * density, air: c.air }, mulberry32(V.synthSeed));
    // events arrive on the frame grid: onsets spread over a frame, and a little more when the page is busy
    const start = at + (A.onsetJitter + A.rippleJitter * density) * ((V.synthSeed & 1023) / 1023);
    this.launch(slot, start, n / this.sr, level, c.pan, V.dur);
    return { at: start, seed: V.synthSeed };
  }

  private active(t: number): number {
    let a = 0;
    for (const s of this.slots) if (!s.released && s.end > t) a++;
    return a;
  }

  /** A free slot at time t (stealing the quietest sounding voice if it is quieter than `level`), or null. */
  private claim(t: number, level: number): Slot | null {
    let free: Slot | null = null;
    let quiet: Slot | null = null;
    let quietLevel = Infinity;
    let active = 0;
    for (const s of this.slots) {
      if (s.freeAt <= t) {
        free ??= s;
        continue;
      }
      if (s.released || s.end <= t) continue;
      active++;
      const l = s.level * Math.exp((-4.6 * Math.max(0, t - s.start)) / s.dur);
      if (l < quietLevel) {
        quietLevel = l;
        quiet = s;
      }
    }
    if (level < AUDIO.minGain || !free) return null;
    if (active >= AUDIO.maxVoices) {
      if (!quiet || quietLevel > level) return null;
      const g = quiet.gain.gain;
      g.setValueAtTime(quiet.level, t);
      g.linearRampToValueAtTime(0, t + AUDIO.stealFade);
      try {
        quiet.src?.stop(t + AUDIO.stealFade + 0.001);
      } catch {
        // already stopped
      }
      quiet.released = true;
      quiet.freeAt = t + AUDIO.stealFade + 0.004;
    }
    return free;
  }

  private launch(slot: Slot, start: number, dur: number, level: number, pan: number, decay: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = slot.buffer;
    src.connect(slot.gain);
    slot.gain.gain.cancelScheduledValues(start);
    slot.gain.gain.setValueAtTime(level, start);
    slot.pan.pan.setValueAtTime(clamp(pan * AUDIO.panWidth, -1, 1), start);
    src.start(start, 0, dur);
    slot.src = src;
    slot.start = start;
    slot.end = start + dur;
    slot.freeAt = start + dur + 0.03;
    slot.level = level;
    slot.dur = decay;
    slot.released = false;
  }
}
