/**
 * Paper sounds synthesised per event in plain JS into a mono buffer (no oscillators).
 *
 * A flap (a card rising or folding away) is
 *   - a "brush" bed: white noise with a lumpy decaying envelope, broad band-pass       (card moving through air)
 *   - crackle grains: dozens of 0.1-1.5 ms noise bursts, denser at the start, fed through three short card-body
 *     resonances (1-6 kHz)                                                              (fibres in the crease giving way)
 *   - an onset snap, a smaller tick when the card meets its stop, and for large cards a faint low body thump
 *   - an air "whoosh": a 0.6-2 kHz noise swell
 * A knock (the hull touching a shore) is a short bed + a few grains + a hollow low resonance.
 * The pitch factor scales every filter frequency and grain time; the size sets duration, brightness and grain count.
 */
import { AUDIO } from '../config/audio';
import { clamp, lerp, smoothstep } from '../core/math';
import { mulberry32 } from '../core/rng';
import type { StepSurface } from '../core/events';

type Coeffs = readonly [number, number, number, number, number];
type Rng = () => number;

/** RBJ biquad coefficients, normalised: [b0, b1, b2, a1, a2]. 'bp' has a 0 dB peak. */
function biquad(type: 'lp' | 'hp' | 'bp', f: number, q: number, sr: number): Coeffs {
  const w0 = (2 * Math.PI * clamp(f, 20, sr * 0.45)) / sr;
  const cs = Math.cos(w0);
  const al = Math.sin(w0) / (2 * q);
  const a0 = 1 + al;
  let b0: number;
  let b1: number;
  let b2: number;
  if (type === 'lp') {
    b0 = (1 - cs) / 2;
    b1 = 1 - cs;
    b2 = b0;
  } else if (type === 'hp') {
    b0 = (1 + cs) / 2;
    b1 = -(1 + cs);
    b2 = b0;
  } else {
    b0 = al;
    b1 = 0;
    b2 = -al;
  }
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * cs) / a0, (1 - al) / a0];
}

const NO_BQ: Coeffs = [0, 0, 0, 0, 0];

interface ShapeParams {
  bed: Coeffs;
  gBed: number;
  res: Coeffs[];
  gRes: number[];
  gDirect: number;
  /** One-pole tilt corner (0 = none). */
  tiltHz: number;
  lp: Coeffs;
  hp: Coeffs;
  low: Coeffs;
  gLow: number;
}

/**
 * The whole filter stage in one fused pass:
 *   out = HP( LP( LP( tilt( gBed * BP_bed(bed) + gDirect * gr + sum gRes[k] * BP_res[k](gr) ) ) ) ) + gLow * BP_low(low)
 */
function shape(out: Float32Array, n: number, bed: Float32Array, gr: Float32Array, low: Float32Array | null, K: ShapeParams, sr: number): void {
  const cb = K.bed;
  const b0 = cb[0] * K.gBed;
  const b2 = cb[2] * K.gBed;
  const ba1 = cb[3];
  const ba2 = cb[4];
  const c1 = K.res[0] ?? NO_BQ;
  const c2 = K.res[1] ?? NO_BQ;
  const c3 = K.res[2] ?? NO_BQ;
  const p0 = c1[0] * (K.gRes[0] ?? 0);
  const p2 = c1[2] * (K.gRes[0] ?? 0);
  const pa1 = c1[3];
  const pa2 = c1[4];
  const q0 = c2[0] * (K.gRes[1] ?? 0);
  const q2 = c2[2] * (K.gRes[1] ?? 0);
  const qa1 = c2[3];
  const qa2 = c2[4];
  const r0 = c3[0] * (K.gRes[2] ?? 0);
  const r2 = c3[2] * (K.gRes[2] ?? 0);
  const ra1 = c3[3];
  const ra2 = c3[4];
  const gd = K.gDirect;
  const aT = K.tiltHz > 0 ? 1 - Math.exp((-2 * Math.PI * Math.min(K.tiltHz, sr * 0.45)) / sr) : 1;
  const [l0, l1, l2, la1, la2] = K.lp;
  const [h0, h1, h2, ha1, ha2] = K.hp;
  const cw = low ? K.low : NO_BQ;
  const w0 = cw[0] * K.gLow;
  const w2 = cw[2] * K.gLow;
  const wa1 = cw[3];
  const wa2 = cw[4];
  // states (transposed direct form II); the band-passes have b1 = 0
  let bz1 = 0, bz2 = 0, pz1 = 0, pz2 = 0, qz1 = 0, qz2 = 0, rz1 = 0, rz2 = 0;
  let t = 0, az1 = 0, az2 = 0, cz1 = 0, cz2 = 0, hz1 = 0, hz2 = 0, wz1 = 0, wz2 = 0;
  for (let i = 0; i < n; i++) {
    const xb = bed[i];
    const xg = gr[i];
    const yb = b0 * xb + bz1;
    bz1 = -ba1 * yb + bz2;
    bz2 = b2 * xb - ba2 * yb;
    const yp = p0 * xg + pz1;
    pz1 = -pa1 * yp + pz2;
    pz2 = p2 * xg - pa2 * yp;
    const yq = q0 * xg + qz1;
    qz1 = -qa1 * yq + qz2;
    qz2 = q2 * xg - qa2 * yq;
    const yr = r0 * xg + rz1;
    rz1 = -ra1 * yr + rz2;
    rz2 = r2 * xg - ra2 * yr;
    t += aT * (yb + yp + yq + yr + gd * xg - t);
    const ya = l0 * t + az1;
    az1 = l1 * t - la1 * ya + az2;
    az2 = l2 * t - la2 * ya;
    const yc = l0 * ya + cz1;
    cz1 = l1 * ya - la1 * yc + cz2;
    cz2 = l2 * ya - la2 * yc;
    let y = h0 * yc + hz1;
    hz1 = h1 * yc - ha1 * y + hz2;
    hz2 = h2 * yc - ha2 * y;
    if (low) {
      const xw = low[i];
      const yw = w0 * xw + wz1;
      wz1 = -wa1 * yw + wz2;
      wz2 = w2 * xw - wa2 * yw;
      y += yw;
    }
    out[i] = y;
  }
  out[n] = 0;
  out[n + 1] = 0;
}

/** Fast per-sample white noise (xorshift32). */
function makeNoise(rng: Rng): () => number {
  let s = ((rng() * 4294967296) >>> 0) | 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s | 0) / 2147483648;
  };
}

let grainSeed = 0x9e3779b9;
function seedGrains(rng: Rng): void {
  grainSeed = ((rng() * 4294967296) >>> 0) | 1;
}

/** One crackle grain: enveloped noise burst (3-sample attack, exponential decay tau seconds). */
function addGrain(buf: Float32Array, n: number, sr: number, t: number, amp: number, tau: number): void {
  const i0 = Math.floor(t * sr);
  if (i0 < 0 || i0 + 4 >= n) return;
  const d = Math.exp(-1 / Math.max(1, tau * sr));
  const end = Math.min(n, i0 + Math.ceil(tau * sr * 5.5) + 4);
  let e = amp;
  let s = grainSeed;
  for (let j = 0; j < 3; j++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    buf[i0 + j] += ((s | 0) / 2147483648) * e * (j === 0 ? 0.15 : j === 1 ? 0.5 : 0.85);
    e *= d;
  }
  for (let i = i0 + 3; i < end; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    buf[i] += ((s | 0) / 2147483648) * e;
    e *= d;
  }
  grainSeed = s;
}

// scratch buffers shared by all synth calls (synthesis is synchronous)
let scrLen = 0;
let scrA = new Float32Array(0);
let scrB = new Float32Array(0);
let scrC = new Float32Array(0);
function scratch(n: number): void {
  if (n > scrLen) {
    scrLen = n;
    scrA = new Float32Array(n);
    scrB = new Float32Array(n);
    scrC = new Float32Array(n);
  }
  scrA.fill(0, 0, n);
  scrB.fill(0, 0, n);
  scrC.fill(0, 0, n);
}

/** Smooth fade-in / fade-out, peak-early enforcement and normalisation. Returns n. */
function finish(out: Float32Array, n: number, sr: number, T: number, attack: number, peakWithin: number, tailFrom: number, refCrest: number, kneeRel = 0.45, loud = 0.5, gLo = 0.86, gHi = 1.2): number {
  const na = Math.max(2, Math.round(attack * sr));
  for (let i = 0; i < na && i < n; i++) {
    const u = i / na;
    out[i] *= u * u * (3 - 2 * u);
  }
  const f0 = Math.max(0, Math.floor(T * tailFrom * sr));
  const nf = n - f0;
  for (let i = f0; i < n; i++) {
    const u = 1 - (i - f0) / nf;
    out[i] *= u * u * (3 - 2 * u);
  }
  out[n - 1] = 0;
  // the loudest sample must sit in the onset: softly hold later samples below the early peak
  const np = Math.min(n, Math.round(peakWithin * sr));
  let early = 0;
  for (let i = 0; i < np; i++) {
    const a = Math.abs(out[i]);
    if (a > early) early = a;
  }
  early = Math.max(early, 1e-6);
  const knee = early * kneeRel;
  const room = early * Math.min(0.17, 0.97 - kneeRel);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    let v = out[i];
    if (i >= np) {
      const a = Math.abs(v);
      if (a > knee) {
        v = (v < 0 ? -1 : 1) * (knee + room * Math.tanh((a - knee) / room));
        out[i] = v;
      }
    }
    sq += v * v;
  }
  const rms = Math.sqrt(sq / Math.max(1, Math.round(T * sr)));
  const crest = early / Math.max(rms, 1e-9);
  const g = (1 / early) * clamp(Math.pow(crest / refCrest, loud), gLo, gHi);
  for (let i = 0; i < n; i++) out[i] *= g;
  return n;
}

export interface FlapVoice {
  up: boolean;
  /** 0 (tiny cut-out) .. 1 (large card). */
  size: number;
  /** Frequency scale (0.5 .. 0.82). */
  pitch: number;
  semitones: number;
  /** Seconds to -40 dB. */
  dur: number;
  level: number;
  synthSeed: number;
}

/** Pitch / duration / level of one flap. lastSt: semitones of the previous flap (consecutive flaps differ). */
export function flapVoice(up: boolean, size01: number, seed: number, lastSt: number | null): FlapVoice {
  const F = AUDIO.flap;
  const size = clamp(size01, 0, 1);
  const r = mulberry32(seed);
  const u0 = r();
  const lo = 12 * Math.log2(F.pitchMin);
  const hi = 12 * Math.log2(F.pitchMax);
  let st = F.pitchSizeSt * (1 - 2 * size) + (u0 * 2 - 1) * F.pitchRandSt;
  if (lastSt !== null && Math.abs(st - lastSt) < F.pitchMinStepSt) {
    const dir = st >= lastSt ? 1 : -1;
    let cand = lastSt + dir * F.pitchMinStepSt * 1.5;
    if (cand > hi || cand < lo) cand = lastSt - dir * F.pitchMinStepSt * 1.5;
    st = cand;
  }
  st = clamp(st, lo, hi);
  const pitch = Math.pow(2, st / 12);
  const dur = lerp(F.durMin, F.durMax, Math.pow(size, F.durCurve)) * Math.pow(pitch, -F.durPitch) * (1 + (r() * 2 - 1) * F.durJitter);
  const level = F.gain * lerp(F.sizeGainMin, 1, size) * (up ? 1 : Math.pow(10, F.downGainDb / 20));
  return { up, size, pitch, semitones: st, dur, level, synthSeed: (r() * 4294967296) >>> 0 };
}

/** Longest sound any synth here writes (buffers are sized for it). */
export const MAX_SOUND_SECONDS = 0.34;

/** Synthesises one flap into out[0..n). tick scales the snaps (busy page: softer), air 0..1 = distance softening. */
export function synthFlap(out: Float32Array, sr: number, P: FlapVoice & { tick: number; air: number }, rng: Rng): number {
  const F = AUDIO.flap;
  const up = P.up;
  const s = P.size;
  const T = P.dur;
  const n = Math.min(out.length - 2, Math.ceil((T + 0.012) * sr));
  scratch(n);
  const bed = scrA;
  const gr = scrB;
  const th = scrC;
  // card identity: body modes depend on the card, not on the fold direction
  const resF: number[] = [];
  const resG: number[] = [];
  for (let k = 0; k < F.resHz.length; k++) {
    resF.push(1 + (rng() * 2 - 1) * F.resJitter);
    resG.push(1 + (rng() * 2 - 1) * F.resGainJitter);
  }
  makeNoise(rng); // (draws its seed: keeps every flap identical to its seed)
  seedGrains(rng);
  const big01 = smoothstep(F.brightFrom, F.brightTo, s);
  const bright = F.brightSmall * Math.pow(F.brightLarge / F.brightSmall, big01) * (up ? 1 : F.downBright);
  const air = clamp(P.air, 0, 1);
  const tiltHz = (up ? F.tiltSmall * Math.pow(F.tiltLarge / F.tiltSmall, big01) : F.tiltSmallDown * Math.pow(F.tiltLargeDown / F.tiltSmallDown, big01)) * Math.pow(P.pitch, F.tiltTrack) * (1 - F.airTilt * air);
  const fs = P.pitch * bright;
  const ts = 1 / Math.sqrt(fs);
  const tick = P.tick * F.tick;

  // ---- brush bed: crackly fizz = noise * decay * random lumps * heavy-tailed micro gate ----
  const tauE = T / F.decayNepers;
  const tauF = T / F.decayFast;
  const mixF = F.decayFastMix;
  const kBed = Math.exp(-1 / (tauE * (up ? 1 : F.bedDecayDown) * sr));
  const kFast = Math.exp(-1 / (tauF * sr));
  const segs = Math.max(4, Math.round((T / F.lumpEvery) * (0.8 + rng() * 0.4)));
  const segLen = Math.ceil(n / segs);
  const gateEvery = Math.max(2, Math.round((F.gateEvery * sr) / fs));
  const gSmooth = 1 - Math.exp(-2.2 / gateEvery);
  let env = 1 - mixF;
  let envF = mixF;
  let gate = 1;
  let gTarget = 1;
  let ns = ((rng() * 4294967296) >>> 0) | 1;
  let gateLeft = 0;
  let v0 = up ? 0.7 + rng() * 0.3 : 0.5 + rng() * 0.3;
  const kSw = up ? 0 : Math.exp(-1 / (F.downSwell * sr));
  let sw = up ? 0 : 1 - F.downSwellFrom;
  for (let sgi = 0, i = 0; sgi < segs; sgi++) {
    const v1 = F.lumpMin + rng() * (1 - F.lumpMin);
    const end = Math.min(n, i + segLen);
    const inv = 1 / segLen;
    for (let j = 0; i < end; i++, j++) {
      if (--gateLeft <= 0) {
        gateLeft = gateEvery;
        ns ^= ns << 13;
        ns ^= ns >>> 17;
        ns ^= ns << 5;
        const r = (ns | 0) / 2147483648;
        const r2 = r * r;
        gTarget = F.bedSmooth + (1 - F.bedSmooth) * 5 * r2 * r2;
      }
      gate += gSmooth * (gTarget - gate);
      const u = j * inv;
      ns ^= ns << 13;
      ns ^= ns >>> 17;
      ns ^= ns << 5;
      bed[i] = ((ns | 0) / 2147483648) * (env + envF) * (v0 + (v1 - v0) * u * u * (3 - 2 * u)) * gate * (1 - sw);
      env *= kBed;
      envF *= kFast;
      sw *= kSw;
    }
    v0 = v1;
  }

  // ---- crackle grains ----
  const E = (t: number) => (1 - mixF) * Math.exp(-t / tauE) + mixF * Math.exp(-t / tauF);
  const nOn = up ? F.onsetGrains : F.onsetGrains - 1;
  for (let k = 0; k < nOn; k++) {
    const t = (up ? 0.0008 : 0.0014) + rng() * (up ? 0.0034 : 0.0036);
    addGrain(gr, n, sr, t, tick * (k === 0 ? 1 : 0.5 + rng() * 0.45) * (up ? 1 : F.downTick), (up ? 0.0005 + rng() * 0.0008 : 0.001 + rng() * 0.001) * ts);
  }
  const dens = up ? 1 : F.downGrains;
  const nMac = Math.round(lerp(F.grainsMin, F.grainsMax, s) * dens);
  const kd = F.grainThin;
  const span = 1 - Math.exp(-kd);
  const thin = () => (-Math.log(1 - rng() * span) / kd) * T * 0.84;
  const tStop = T * (up ? 0.38 + rng() * 0.24 : F.downStop + rng() * 0.16);
  let left = nMac;
  while (left > 0) {
    const tc = rng() < F.stopShare ? Math.max(0.003, tStop + (rng() + rng() - 1) * T * 0.11) : 0.003 + thin();
    const inCl = Math.min(left, 1 + Math.floor(rng() * rng() * 7));
    const width = 0.0012 + rng() * 0.006;
    const r = rng();
    const ac = F.grainAmp * (0.14 + r * r * r) * E(tc);
    let tg = tc;
    for (let k = 0; k < inCl; k++) {
      addGrain(gr, n, sr, tg, ac * (0.45 + 0.55 * rng()), (0.00015 + rng() * 0.0008) * ts);
      tg += (-Math.log(1 - rng() * 0.95) * width) / 2.2;
    }
    left -= inCl;
  }
  const nMic = Math.round(lerp(F.microMin, F.microMax, s) * dens);
  for (let k = 0; k < nMic; k++) {
    const t = 0.001 + thin() * 1.1;
    addGrain(gr, n, sr, t, F.microAmp * (0.2 + rng()) * E(t), (0.0001 + rng() * 0.0003) * ts);
  }
  const nSt = up ? 3 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 2);
  for (let k = 0; k < nSt; k++) {
    const t = tStop + (k === 0 ? 0 : rng() * (up ? 0.006 : 0.004));
    const a = tick * F.stopTick * (k === 0 ? 1 : 0.25 + rng() * 0.5);
    if (up) addGrain(gr, n, sr, t, a, (0.00025 + rng() * 0.0005) * ts);
    else addGrain(bed, n, sr, t, a * F.patGain, (0.0012 + rng() * 0.0014) * ts);
  }
  const nQ = 2 + Math.floor(rng() * 4);
  for (let k = 0; k < nQ; k++) {
    const t = tStop + 0.007 + rng() * Math.max(0.001, T * 0.88 - tStop);
    addGrain(gr, n, sr, t, F.grainAmp * (0.25 + rng() * 0.5) * E(t), (0.0002 + rng() * 0.0004) * ts);
  }

  // ---- low body thump (large flaps only) ----
  const big = clamp((s - 0.3) / 0.7, 0, 1);
  const thAmp = F.thump * Math.pow(big, 1.4);
  if (thAmp > 0.002) {
    addGrain(th, n, sr, up ? 0.0012 : tStop, thAmp * (up ? 1 : F.thumpDown), 0.0035);
    if (up) addGrain(th, n, sr, tStop + 0.001, thAmp * 0.55, 0.0035);
  }

  shape(out, n, bed, gr, thAmp > 0.002 ? th : null, {
    bed: biquad('bp', F.bedHz * fs, F.bedQ, sr),
    gBed: up ? F.bedGain : F.bedGainDown,
    res: [0, 1, 2].map((k) => biquad('bp', F.resHz[k] * fs * resF[k], F.resQ[k], sr)),
    gRes: [0, 1, 2].map((k) => F.resGain[k] * resG[k]),
    gDirect: F.grainDirect,
    tiltHz,
    lp: biquad('lp', F.lpHz * (1 - F.airLp * air), 0.6, sr),
    hp: biquad('hp', F.hpHz * Math.sqrt(fs) * (up ? 1 : F.downHp), 0.7, sr),
    low: biquad('bp', (F.thumpHz * P.pitch) / (0.8 + 0.4 * s), F.thumpQ, sr),
    gLow: F.thumpGain,
  }, sr);

  // ---- air whoosh + low body of large cards, added un-tilted ----
  {
    const fA = 2 * Math.sin((Math.PI * F.airHz * Math.pow(P.pitch, 0.5) * (up ? 1 : F.downBright)) / sr);
    const qA = 1 / F.airQ;
    const fT = 2 * Math.sin((Math.PI * F.lowHz * Math.pow(P.pitch, 0.5)) / (sr * (0.8 + 0.4 * s)));
    const qT = 1 / F.lowQ;
    const tr = (up ? F.airRise : F.airRiseDown) * (0.8 + 0.4 * rng()) * (0.7 + 0.6 * s);
    const kA = Math.exp(-1 / (tr * sr));
    const gA = (up ? F.airGain : F.airGainDown) * lerp(F.airSmall, 1, big01) * Math.E * (1 - kA);
    const lowAmp = F.lowGain * Math.pow(clamp((s - F.lowFrom) / (1 - F.lowFrom), 0, 1), 0.8) * (up ? 1 : F.lowDown);
    const iT = Math.floor((up ? 0.0015 : tStop) * sr);
    const kT = Math.exp(-1 / (F.lowTau * sr));
    const aL = 1 - Math.exp((-2 * Math.PI * F.airLpHz * Math.pow(P.pitch, 0.5)) / sr);
    let e1 = 1, e2 = 0, eT = 0, al = 0, ab = 0, aw = 0, tl = 0, tb = 0;
    for (let i = 0; i < n; i++) {
      ns ^= ns << 13;
      ns ^= ns >>> 17;
      ns ^= ns << 5;
      const x = (ns | 0) / 2147483648;
      e2 = e2 * kA + e1;
      e1 *= kA;
      al += fA * ab;
      ab += fA * (x - al - qA * ab);
      aw += aL * (ab - aw);
      let y = aw * e2 * gA;
      if (lowAmp > 0) {
        if (i === iT) eT = lowAmp;
        tl += fT * tb;
        tb += fT * (x * eT - tl - qT * tb);
        eT *= kT;
        y += tb;
      }
      out[i] += y;
    }
  }
  return finish(out, n, sr, T, up ? F.attackUp : F.attackDown, 0.0055, F.tailFrom, F.refCrest, F.peakKnee, F.loudNorm, F.normLo, F.normHi);
}

/**
 * What the hull's knock and a footstep share, written to the scratch buffers over n samples of a sound T long: a
 * decaying noise bed (scrA), the tap itself, two grains, and `scuffs` scuff grains over the first `spread` of it
 * (scrB); fs scales the grains' lengths (a higher pitch, shorter grains).
 */
function tap(n: number, sr: number, T: number, fs: number, noise: () => number, rng: Rng, scuffs: number, spread: number): void {
  const kBed = Math.exp(-1 / ((T / 4.6) * sr));
  let env = 1;
  for (let i = 0; i < n; i++) {
    scrA[i] = noise() * env;
    env *= kBed;
  }
  addGrain(scrB, n, sr, 0.0006 + rng() * 0.0008, 1, (0.0005 + rng() * 0.0006) / fs);
  addGrain(scrB, n, sr, 0.0018 + rng() * 0.0016, 0.5 + rng() * 0.3, (0.0004 + rng() * 0.0006) / fs);
  for (let k = 0; k < scuffs; k++) {
    const t = 0.003 + rng() * T * spread;
    addGrain(scrB, n, sr, t, (0.12 + 0.3 * rng()) * Math.exp((-t / T) * 3), (0.0002 + rng() * 0.0006) / fs);
  }
}

/** Synthesises the hull's wooden knock on a shore (strength 0..1 darkens and lengthens it a little). */
export function synthKnock(out: Float32Array, sr: number, strength: number, rng: Rng): number {
  const K = AUDIO.knock;
  const T = K.dur * (0.85 + 0.3 * strength);
  const n = Math.min(out.length - 2, Math.ceil((T + 0.008) * sr));
  scratch(n);
  const noise = makeNoise(rng);
  seedGrains(rng);
  const fs = 0.85 + rng() * 0.2 - strength * 0.12;
  tap(n, sr, T, fs, noise, rng, 3, 0.5);
  addGrain(scrC, n, sr, 0.0008, K.knock, 0.006);
  shape(out, n, scrA, scrB, scrC, {
    bed: biquad('bp', K.bedHz * fs, K.bedQ, sr),
    gBed: K.bedGain,
    res: K.resHz.map((f, k) => biquad('bp', f * fs * (0.92 + rng() * 0.16), K.resQ[k], sr)),
    gRes: K.resHz.map(() => 0.3),
    gDirect: 0.08,
    tiltHz: 0,
    lp: biquad('lp', K.lpHz * fs, 0.62, sr),
    hp: biquad('hp', 70, 0.7, sr),
    low: biquad('bp', 120 * fs, 3.2, sr),
    gLow: 7,
  }, sr);
  return finish(out, n, sr, T, 0.0016, 0.006, 0.7, 7);
}

export interface StepVoice {
  surface: StepSurface;
  pitch: number;
  dur: number;
  level: number;
  synthSeed: number;
}

/** Pitch, length and level of one footstep: a little random, the two feet half a semitone apart. */
export function stepVoice(surface: StepSurface, seed: number, foot: 0 | 1): StepVoice {
  const S = AUDIO.step;
  const r = mulberry32(seed);
  const st = (r() * 2 - 1) * S.pitchRandSt + (foot ? S.footSt : -S.footSt);
  const pitch = Math.pow(2, st / 12);
  return {
    surface,
    pitch,
    dur: S.dur * (0.92 + r() * 0.16) * Math.pow(pitch, -0.3),
    level: S.gain * S.surfaces[surface].gain * (0.85 + r() * 0.3),
    synthSeed: (r() * 4294967296) >>> 0,
  };
}

/** Synthesises one footstep: a soft noise bed, the tap, a few scuff grains (more on grass), a knock on a deck. */
export function synthStep(out: Float32Array, sr: number, P: StepVoice, rng: Rng): number {
  const S = AUDIO.step;
  const V = S.surfaces[P.surface];
  const T = P.dur;
  const fs = P.pitch;
  const n = Math.min(out.length - 2, Math.ceil((T + 0.008) * sr));
  scratch(n);
  const noise = makeNoise(rng);
  seedGrains(rng);
  // the tap, and scuff grains (more on grass)
  tap(n, sr, T, fs, noise, rng, V.grains, 0.6);
  if (V.knock > 0) addGrain(scrC, n, sr, 0.0008, V.knock, 0.003);
  shape(out, n, scrA, scrB, V.knock > 0 ? scrC : null, {
    bed: biquad('bp', V.bedHz * fs, V.bedQ, sr),
    gBed: V.bedGain,
    res: V.resHz.map((f, k) => biquad('bp', f * fs * (0.92 + rng() * 0.16), V.resQ[k], sr)),
    gRes: V.resHz.map(() => V.grain),
    gDirect: 0.25 * V.grain,
    tiltHz: 0,
    lp: biquad('lp', V.lpHz * fs, 0.62, sr),
    hp: biquad('hp', 300, 0.7, sr),
    low: biquad('bp', 560 * fs, 2.6, sr),
    gLow: 5,
  }, sr);
  return finish(out, n, sr, T, 0.0016, 0.0045, 0.7, S.refCrest);
}

/** Room impulse response: direct sound, smeared early reflections, a short warm tail. */
export function makeRoomIR(ctx: BaseAudioContext): AudioBuffer {
  const R = AUDIO.room;
  const sr = ctx.sampleRate;
  const n = Math.ceil(R.length * sr);
  const ir = ctx.createBuffer(2, n, sr);
  const rng = mulberry32(0x7ab1e);
  const lpA = 1 - Math.exp((-2 * Math.PI * R.tailLpHz) / sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let y = 0;
    const i0 = Math.floor(0.003 * sr);
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / sr;
      y += lpA * (rng() * 2 - 1 - y);
      d[i] = y * R.tail * Math.exp(-t / R.tailDecay) * Math.min(1, (i - i0) / (0.002 * sr));
    }
    for (const [delay, gain, pan] of R.taps) {
      const g = gain * (c === 0 ? Math.min(1, 1 - pan) : Math.min(1, 1 + pan));
      const i = Math.round(delay * sr);
      if (i > 1 && i + 1 < n) {
        d[i - 1] += g * 0.25;
        d[i] += g * 0.5;
        d[i + 1] += g * 0.25;
      }
    }
    const fo = Math.floor(0.004 * sr);
    for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo;
    d[0] = 1;
  }
  return ir;
}

/** Soft-knee limiter curve for a WaveShaperNode (linear below the knee, tanh above). */
export function makeLimiterCurve(): Float32Array<ArrayBuffer> {
  const L = AUDIO.limiter;
  const N = 4097;
  const curve = new Float32Array(N);
  const k = L.knee;
  for (let i = 0; i < N; i++) {
    const x = ((i / (N - 1)) * 2 - 1) * L.range;
    const a = Math.abs(x);
    const y = a <= k ? a : k + (1 - k) * Math.tanh((a - k) / (1 - k));
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}
