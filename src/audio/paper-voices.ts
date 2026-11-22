/**
 * Live player of the synthesised paper sounds (allocation after papertrails by xikhar, MIT):
 *   - a fixed pool of voice slots (gain + stereo panner, each with its own reusable buffer), the quietest voice is
 *     faded out and replaced when all are busy;
 *   - a token-bucket rate limit, and overlapping voices turned down (~1 / sqrt(voices)) so they never sum into hiss;
 *   - one sound per gesture: the flaps of one piece the same way within a group window speak as one (the skill);
 *   - flaps keep a minimum spacing: cards rising around the ship come out as a soft flap now and then, the loudest
 *     candidate (nearest, largest) taking the next slot, late ones dropped.
 * Everything goes through a short room (early reflections) into `out`.
 */
import { AUDIO } from '../config/audio';
import { MAX_SOUND_SECONDS, flapVoice, makeRoomIR, stepVoice, synthFlap, synthKnock, synthStep } from './paper-synth';
import type { StepSurface } from '../core/events';
import { clamp } from '../core/math';
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

interface Pending {
  /** When the card moved (audio clock). */
  t: number;
  up: boolean;
  size: number;
  gain: number;
  pan: number;
  air: number;
  seed: number;
}


export class PaperVoices {
  private readonly slots: Slot[] = [];
  private readonly sr: number;
  private tokens: number = AUDIO.rate.burst;
  private tokenT = -1;
  private lastSt: number | null = null;
  private nextOnset = -1;
  private queued: Pending | null = null;
  /** When each piece (key and direction) last flapped (audio clock), for the group window. */
  private readonly gestures = new Map<string, number>();

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
   * A card rose (up) or folded away. gain: distance gain 0..1, pan -1..1, air 0..1 (distance softening),
   * delay: seconds until the card actually moves. force: a sheet the player moved (the chart, the sails), played
   * at once whatever the spacing. key: the piece it belongs to; its flaps the same way within the group window after
   * the first stay silent.
   */
  flap(up: boolean, size: number, gain: number, pan: number, air: number, seed: number, delay = 0, force = false, key?: string): void {
    if (gain * AUDIO.flap.gain < AUDIO.minGain) return;
    const now = this.ctx.currentTime;
    this.drain(now);
    const c: Pending = { t: now + delay, up, size, gain, pan, air, seed };
    if (key !== undefined) {
      const k = `${key}|${up ? 1 : 0}`;
      const last = this.gestures.get(k);
      if (last !== undefined && Math.abs(c.t - last) < AUDIO.flaps.groupWindow) return;
      this.gestures.set(k, c.t);
      // (forget the gestures long past, a few at a time)
      if (this.gestures.size > 256) for (const [g, t] of this.gestures) if (now - t > AUDIO.flaps.groupWindow * 4) this.gestures.delete(g);
    }
    if (force) {
      this.start(c, now);
      return;
    }
    const score = (p: Pending) => p.gain * (0.85 + 0.15 * p.size) * (p.up ? 1 : 0.7);
    if (!this.queued && c.t <= now + 0.03 && c.t >= this.nextOnset) {
      this.start(c, Math.max(c.t, now));
      return;
    }
    // one waiting place: the louder candidate keeps it
    if (!this.queued || score(c) > score(this.queued)) this.queued = c;
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
    // (a voice is only ever started for the next few milliseconds: its slot must be free right now)
    if (!c || this.nextOnset > now + 0.03 || c.t > now + 0.03) return;
    this.queued = null;
    const at = Math.max(this.nextOnset, c.t, now);
    if (at - c.t > AUDIO.flaps.maxDefer) return;
    this.start(c, at);
  }

  private start(c: Pending, at: number): void {
    const A = AUDIO;
    const active = this.active(at);
    const density = clamp(active / A.maxVoices, 0, 1);
    // rate limit
    if (this.tokenT >= 0) this.tokens = Math.min(A.rate.burst, this.tokens + (at - this.tokenT) * A.rate.perSecond);
    this.tokenT = at;
    if (this.tokens < 1) return;
    const V = flapVoice(c.up, c.size, c.seed, this.lastSt);
    const level = (V.level * c.gain * (1 - A.densityDuck * density)) / Math.sqrt(1 + A.overlapDuck * active);
    const slot = this.claim(at, level);
    if (!slot) return;
    this.tokens -= 1;
    this.lastSt = V.semitones;
    const data = slot.buffer.getChannelData(0);
    const n = synthFlap(data, this.sr, { ...V, tick: 1 - A.densityTickDuck * density, air: c.air }, mulberry32(V.synthSeed));
    const start = at + A.onsetJitter * ((V.synthSeed & 1023) / 1023);
    this.launch(slot, start, n / this.sr, level, c.pan, V.dur);
    this.nextOnset = start + A.flaps.spacing + A.flaps.spacingJitter * ((((V.synthSeed >>> 10) & 1023) / 1023) * 2 - 1);
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
