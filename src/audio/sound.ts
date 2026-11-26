/**
 * The voyage's sound (Web Audio, no audio files; started by the first key press or click, M mutes):
 *   music     a felt-piano barcarolle (music.ts); discoveries, treasure and bottles ring a note of it
 *   paper     every card that rises or folds around the ship: a synthesised paper flap (paper-voices.ts), spaced
 *             so a wave of cards is a ripple of soft flaps, never a rustle; the chart and the sails are big sheets
 *   hull      a hollow wooden knock when the ship touches a shore
 *   creatures a whale's breath, splashes, the kraken's rumble
 *   sea       a room tone: a slow warm wash under the table, so the silence between sounds is never digital black
 * Chain: voices -> room -> soft limiter -> master; music and sea -> master.
 */
import { AUDIO } from '../config/audio';
import { bus } from '../core/events';
import { Music } from './music';
import { PaperVoices } from './paper-voices';
import { makeLimiterCurve } from './paper-synth';
import { clamp, smoothstep } from '../core/math';
import { hash2, mulberry32, stream } from '../core/rng';

/** This module's seeded randomness (core/rng.ts stream). */
const random = stream('sound');

/** The audio graph, made at the player's first key or click (browsers start sound only after a gesture). */
interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  /** The effects bus (into the limiter). */
  fx: GainNode;
  voices: PaperVoices;
  music: Music;
  /** A few seconds of noise for the creature sounds. */
  noise: AudioBuffer;
}

export class Sound {
  private graph: AudioGraph | null = null;
  private musicOff = false;
  private listenerX = 0;
  private listenerZ = 0;
  private events = 0;

  constructor() {
    // A context made by a key that is not a user activation (Esc) stays suspended: every key and click resumes it until
    // it runs.
    const wake = () => {
      const { ctx } = this.start();
      if (ctx.state === 'running') awake();
      else void ctx.resume().then(awake);
    };
    const awake = () => {
      window.removeEventListener('keydown', wake);
      window.removeEventListener('pointerdown', wake);
    };
    window.addEventListener('keydown', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat) this.toggleMusic(); });

    bus.on('paper', (e) => this.paper(e.x, e.z, e.height, e.up, e.delay ?? 0, e.key));
    bus.on('paperCancel', (e) => this.graph?.voices.cancel(e.key));
    bus.on('sails', () => this.sheet(0.8, true));
    bus.on('chart', () => this.sheet(1, false));
    bus.on('bump', (e) => this.knock(e.strength));
    bus.on('step', (e) => {
      this.live()?.voices.step(e.surface, e.foot, hashXZ(++this.events, 31, 9));
    });
    bus.on('creature', (e) => {
      if (e.kind === 'spout') this.spout(e.x, e.z);
      else if (e.kind === 'splash') this.splash(e.x, e.z);
      else this.rumble(e.x, e.z);
    });
    bus.on('discovered', () => this.graph?.music.chime('discover'));
    bus.on('treasure', () => this.graph?.music.chime('treasure'));
    bus.on('bottle', () => this.graph?.music.chime('bottle'));
  }

  get isMusicOff(): boolean {
    return this.musicOff;
  }

  /** M: the music off or on again (the paper, the steps and the sea play on). */
  toggleMusic(): void {
    this.musicOff = !this.musicOff;
    bus.emit('music', { off: this.musicOff });
    this.graph?.music.setOff(this.musicOff);
  }

  /** Per frame: where the listener is. */
  update(x: number, z: number): void {
    this.listenerX = x;
    this.listenerZ = z;
    this.graph?.voices.update();
  }

  /** The audio graph, made the first time. */
  private start(): AudioGraph {
    if (this.graph) return this.graph;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: AUDIO.sampleRate, latencyHint: 'interactive' });
    } catch {
      // (a browser that cannot run at the asked sample rate refuses it: it then runs at its own)
      ctx = new AudioContext();
    }
    const master = ctx.createGain();
    master.gain.value = AUDIO.masterGain;
    master.connect(ctx.destination);
    // effects: soft-knee limiter (its curve spans the limiter's range and keeps the level, so only the input is scaled
    // into it), then its ceiling
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeLimiterCurve();
    const ceiling = ctx.createGain();
    ceiling.gain.value = AUDIO.limiter.ceiling;
    shaper.connect(ceiling).connect(master);
    const fx = ctx.createGain();
    fx.gain.value = 1 / AUDIO.limiter.range;
    fx.connect(shaper);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const rng = mulberry32(0x5ea);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;

    // the sea's room tone: a baked loop, faded in
    const sea = ctx.createBufferSource();
    sea.buffer = makeSea(ctx);
    sea.loop = true;
    const seaGain = ctx.createGain();
    seaGain.gain.setValueAtTime(0, ctx.currentTime);
    seaGain.gain.linearRampToValueAtTime(AUDIO.sea.gain, ctx.currentTime + AUDIO.sea.fadeIn);
    sea.connect(seaGain).connect(master);
    sea.start();
    this.graph = { ctx, master, fx, voices: new PaperVoices(ctx, fx), music: new Music(ctx, master), noise };
    this.graph.music.setOff(this.musicOff);
    return this.graph;
  }

  /** Gain (0..1), pan (-1..1) and distance softening (0..1) of a sound at (x, z). */
  private place(x: number, z: number): { gain: number; pan: number; air: number } {
    const A = AUDIO;
    const dx = x - this.listenerX;
    const d = Math.hypot(dx, z - this.listenerZ);
    const gain = d >= A.earshot ? 0 : (1 / (1 + (d / A.falloff) ** A.falloffPow)) * (1 - smoothstep(A.earshotFade, A.earshot, d));
    return { gain, pan: clamp(dx / A.panSpan, -1, 1), air: clamp(d / A.earshot, 0, 1) };
  }

  /** The graph, if it is running. */
  private live(): AudioGraph | null {
    return this.graph && this.graph.ctx.state === 'running' ? this.graph : null;
  }

  /** A piece height tall rose or folded at (x, z): a flap as large as the piece is against a tile's height. */
  private paper(x: number, z: number, height: number, up: boolean, delay: number, key: string): void {
    const g = this.live();
    if (!g) return;
    const p = this.place(x, z);
    if (p.gain <= 0) return;
    const size = clamp(height / AUDIO.flaps.tile, AUDIO.flaps.minSize, 1);
    g.voices.flap(up, size, p.gain, p.pan, p.air, hashXZ(x, z, up ? 1 : 2), delay, false, key);
  }

  /** A big sheet: the chart unfolding, the sails being set or furled. */
  private sheet(size: number, sails: boolean): void {
    this.live()?.voices.flap(true, size, sails ? 0.8 : 1, 0, 0, hashXZ(++this.events, 7, 3), 0, true);
  }

  private knock(strength: number): void {
    this.live()?.voices.knock(strength, hashXZ(++this.events, 11, 5));
  }

  /** A shaped noise burst into a world-placed gain. */
  private burst(x: number, z: number, level: number, o: { type: BiquadFilterType; freq: number; q: number; attack: number; decay: number; sweepTo?: number }): void {
    const g = this.live();
    if (!g) return;
    const { ctx } = g;
    const p = this.place(x, z);
    if (p.gain * level < AUDIO.minGain) return;
    const at = ctx.currentTime + 0.01;
    const src = ctx.createBufferSource();
    src.buffer = g.noise;
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
    src.connect(f).connect(env).connect(pan).connect(g.fx);
    const length = o.attack + o.decay + 0.05;
    src.start(at, random() * Math.max(0, g.noise.duration - length), length);
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

/** A seed for a sound's variation, from where it happens (to an eighth of a unit) and what kind it is. */
function hashXZ(x: number, z: number, k: number): number {
  return hash2(k, Math.round(x * 8), Math.round(z * 8));
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
