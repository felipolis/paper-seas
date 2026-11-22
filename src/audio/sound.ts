/**
 * The voyage's sound (Web Audio, no audio files; started by the first key press or click, M mutes):
 *   music     a felt-piano barcarolle (music.ts); discoveries, treasure and bottles ring a note of it
 *   paper     every card that rises or folds around the ship: a synthesised paper flap (paper-voices.ts), spaced
 *             so a wave of cards is a ripple of soft flaps, never a rustle; the chart and the sails are big sheets
 *   hull      a hollow wooden knock when the ship touches a shore
 *   creatures a whale's breath, splashes, the kraken's rumble
 *   sea       a slow warm wash under the table, and air that rises with the ship's speed
 * Chain: voices -> room -> soft limiter -> master; music and sea -> master.
 */
import { AUDIO } from '../config/audio';
import { bus } from '../core/events';
import { Music } from './music';
import { PaperVoices } from './paper-voices';
import { makeLimiterCurve } from './paper-synth';
import { clamp, smoothstep } from '../core/math';
import { mulberry32 } from '../core/rng';

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private fx!: GainNode;
  private voices!: PaperVoices;
  private music!: Music;
  private noise!: AudioBuffer;
  private wind!: GainNode;
  private muted = false;
  private listenerX = 0;
  private listenerZ = 0;
  private events = 0;

  constructor() {
    const start = () => {
      this.start();
      window.removeEventListener('keydown', start);
      window.removeEventListener('pointerdown', start);
    };
    window.addEventListener('keydown', start);
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat) this.toggleMute(); });

    bus.on('paper', (e) => this.paper(e.x, e.z, e.size, e.up, e.delay ?? 0));
    bus.on('sails', (e) => this.sheet(e.level < 0 ? 1 : 0.8, e.level >= 0));
    bus.on('bump', (e) => this.knock(e.strength));
    bus.on('step', (e) => {
      if (this.live()) this.voices.step(e.surface, e.foot, hashXZ(++this.events, 31, 9));
    });
    bus.on('creature', (e) => {
      if (e.kind === 'spout') this.spout(e.x, e.z);
      else if (e.kind === 'splash') this.splash(e.x, e.z);
      else this.rumble(e.x, e.z);
    });
    bus.on('discovered', () => this.music?.chime('discover'));
    bus.on('treasure', () => this.music?.chime('treasure'));
    bus.on('bottle', () => this.music?.chime('bottle'));
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (!this.ctx) return;
    const g = this.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(this.muted ? 0 : AUDIO.masterGain, this.ctx.currentTime, 0.05);
  }

  /** Per frame: where the listener is and how fast the ship goes. */
  update(_dt: number, x: number, z: number, speed: number): void {
    this.listenerX = x;
    this.listenerZ = z;
    if (!this.ctx) return;
    this.voices.update();
    const S = AUDIO.sea;
    this.wind.gain.setTargetAtTime(S.windGain + S.windSpeedGain * clamp(speed / 3.4, 0, 1), this.ctx.currentTime, 0.6);
  }

  private start(): void {
    if (this.ctx) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: AUDIO.sampleRate, latencyHint: 'interactive' });
    } catch {
      ctx = new AudioContext();
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : AUDIO.masterGain;
    this.master.connect(ctx.destination);
    // effects: soft-knee limiter (scaled in and out of its range)
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeLimiterCurve();
    const ceiling = ctx.createGain();
    ceiling.gain.value = AUDIO.limiter.ceiling * AUDIO.limiter.range;
    shaper.connect(ceiling).connect(this.master);
    this.fx = ctx.createGain();
    this.fx.gain.value = 1 / AUDIO.limiter.range;
    this.fx.connect(shaper);
    this.voices = new PaperVoices(ctx, this.fx);
    this.music = new Music(ctx, this.master);

    // a few seconds of noise for the creature sounds and the wind
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const rng = mulberry32(0x5ea);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;

    // the sea: a baked loop, faded in
    const sea = ctx.createBufferSource();
    sea.buffer = makeSea(ctx);
    sea.loop = true;
    const seaGain = ctx.createGain();
    seaGain.gain.setValueAtTime(0, ctx.currentTime);
    seaGain.gain.linearRampToValueAtTime(AUDIO.sea.gain, ctx.currentTime + 3);
    sea.connect(seaGain).connect(this.master);
    sea.start();
    // air: soft band of noise, louder with speed
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = AUDIO.sea.windHz;
    bp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    air.connect(bp).connect(lp).connect(this.wind).connect(this.master);
    air.start();
  }

  /** Gain (0..1), pan (-1..1) and distance softening (0..1) of a sound at (x, z). */
  private place(x: number, z: number): { gain: number; pan: number; air: number } {
    const A = AUDIO;
    const dx = x - this.listenerX;
    const d = Math.hypot(dx, z - this.listenerZ);
    const gain = d >= A.earshot ? 0 : (1 / (1 + (d / A.falloff) ** A.falloffPow)) * (1 - smoothstep(A.earshotFade, A.earshot, d));
    return { gain, pan: clamp(dx / A.panSpan, -1, 1), air: clamp(d / A.earshot, 0, 1) };
  }

  private live(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  private paper(x: number, z: number, size: number, up: boolean, delay: number): void {
    if (!this.live()) return;
    const p = this.place(x, z);
    if (p.gain <= 0) return;
    this.voices.flap(up, size, p.gain, p.pan, p.air, hashXZ(x, z, up ? 1 : 2), delay);
  }

  /** A big sheet: the chart unfolding, the sails being set or furled. */
  private sheet(size: number, sails: boolean): void {
    if (!this.live()) return;
    this.voices.flap(true, size, sails ? 0.8 : 1, 0, 0, hashXZ(++this.events, 7, 3), 0, true);
  }

  private knock(strength: number): void {
    if (!this.live()) return;
    this.voices.knock(strength, hashXZ(++this.events, 11, 5));
  }

  /** A shaped noise burst into a world-placed gain. */
  private burst(x: number, z: number, level: number, o: { type: BiquadFilterType; freq: number; q: number; attack: number; decay: number; sweepTo?: number }): void {
    if (!this.live()) return;
    const ctx = this.ctx!;
    const p = this.place(x, z);
    if (p.gain * level < AUDIO.minGain) return;
    const at = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.freq, at);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, at + o.attack + o.decay);
    f.Q.value = o.q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(level * p.gain, at + o.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + o.attack + o.decay);
    const pan = ctx.createStereoPanner();
    pan.pan.value = p.pan * AUDIO.panWidth;
    src.connect(f).connect(env).connect(pan).connect(this.fx);
    src.start(at, Math.random() * 2, o.attack + o.decay + 0.05);
  }

  /** A whale breathing out: a soft rising breath. */
  private spout(x: number, z: number): void {
    this.burst(x, z, 0.16, { type: 'bandpass', freq: 380, q: 0.6, attack: 0.25, decay: 1.1, sweepTo: 1500 });
  }

  /** Something leaps or falls back: a short wet hush, darkening as it settles. */
  private splash(x: number, z: number): void {
    this.burst(x, z, 0.14, { type: 'lowpass', freq: 1800, q: 0.6, attack: 0.015, decay: 0.45, sweepTo: 380 });
  }

  /** The kraken: a deep swell of the sea. */
  private rumble(x: number, z: number): void {
    this.burst(x, z, 0.5, { type: 'lowpass', freq: 160, q: 0.8, attack: 0.5, decay: 2.2, sweepTo: 70 });
  }
}

function hashXZ(x: number, z: number, k: number): number {
  let h = (Math.imul(Math.round(x * 8), 0x9e3779b1) ^ Math.imul(Math.round(z * 8), 0x85ebca6b) ^ Math.imul(k, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  return (h ^ (h >>> 12)) >>> 0;
}

/**
 * The sea as a seamless stereo loop: warm low-passed noise (two poles, no rumble), its level rising and falling in
 * slow uneven swells, like water washing against the table legs.
 */
function makeSea(ctx: BaseAudioContext): AudioBuffer {
  const S = AUDIO.sea;
  const sr = ctx.sampleRate;
  const n = Math.floor(S.length * sr);
  const xf = Math.floor(0.5 * sr);
  const buf = ctx.createBuffer(2, n, sr);
  const rng = mulberry32(0x5eaba7);
  const a1 = 1 - Math.exp((-2 * Math.PI * S.lpHz) / sr);
  const a2 = 1 - Math.exp((-2 * Math.PI * 40) / sr);
  // swells: whole numbers of cycles over the loop, so the loop is seamless
  const swells = [3, 5, 8].map((cycles) => ({ w: (2 * Math.PI * cycles) / n, ph: rng() * Math.PI * 2 }));
  for (let c = 0; c < 2; c++) {
    const tmp = new Float32Array(n + xf);
    let y1 = 0, y2 = 0, y3 = 0, sq = 0;
    for (let i = 0; i < n + xf; i++) {
      const w = rng() * 2 - 1;
      y1 += a1 * (w - y1);
      y2 += a1 * (y1 - y2);
      y3 += a2 * (y2 - y3);
      const v = y2 - y3;
      tmp[i] = v;
      sq += v * v;
    }
    const norm = 1 / Math.sqrt(sq / (n + xf));
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let v = tmp[i];
      if (i < xf) {
        const u = i / xf;
        v = v * Math.sqrt(u) + tmp[n + i] * Math.sqrt(1 - u);
      }
      let s = 0;
      for (const sw of swells) s += Math.sin(sw.w * i + sw.ph + c * 0.6);
      const swell = 1 - S.swell * 0.5 * (1 - s / swells.length);
      d[i] = v * norm * swell;
    }
  }
  return buf;
}
