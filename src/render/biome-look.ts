/**
 * papertrails' per-biome light and grade (render/biomegrade.js there): each biome lights and grades the page its own
 * way, by day and by night, blended by the biomes round the traveller (smoothed in time). Its heartland keeps the
 * plain look; the blossom is peach and lilac, the pinewood a weak warm sun through the canopy, teal and misty.
 *
 * Our plain look is the papercraft skill's, not papertrails' (config/view.ts), so a biome is ported as the change it
 * makes to papertrails' own plain look, applied to ours: colours scaled channel by channel (linear), intensities,
 * exposure, sizes and distances scaled, contrast and saturation shifted. The haze's amount stays the skill's. Our
 * meadow takes papertrails' blossom and the pine woods its pinewood (as the biome tints, render/biome-tint.ts); the
 * jungle, the rocks and the open sea keep the plain look. render/day-night.ts and render/post.ts read the two looks.
 */
import * as THREE from 'three';
import { LIGHTS, NIGHT, PAPER, POST } from '../config/view';
import { SHADOW } from './shadows';
import { clamp } from '../core/math';
import type { Biome, LandField } from '../world/land';

/** The terms of the look a biome changes. */
export interface Look {
  key: { color: THREE.Color; intensity: number };
  fill: { color: THREE.Color; intensity: number };
  hemi: { sky: THREE.Color; ground: THREE.Color; intensity: number };
  /** The key shadow's penumbra per unit of blocker distance, and the warm light leaking into it. */
  lightSize: number;
  leak: THREE.Color;
  gobo: { key: number; tint: number };
  /** The far haze: its colour, and where it starts and ends (world units at the normal framing). */
  fade: { color: THREE.Color; start: number; end: number };
  background: THREE.Color;
  exposure: number;
  contrast: number;
  saturation: number;
  tint: [number, number, number];
  shadowTint: THREE.Color;
  aoTint: THREE.Color;
  greenPull: number;
  vignette: number;
  split: number;
  focusBand: number;
  farGain: number;
}

/** A look as numbers and hex colours, as papertrails writes its tables. */
type LookSpec = {
  key: { color: string; intensity: number };
  fill: { color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  lightSize: number;
  leak: string;
  gobo: { key: number; tint: number };
  fade: { color: string; start: number; end: number };
  background: string;
  exposure: number;
  contrast: number;
  saturation: number;
  tint: readonly [number, number, number];
  shadowTint: string;
  aoTint: string;
  greenPull: number;
  vignette: number;
  split: number;
  focusBand: number;
  farGain: number;
};
type Partial2<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends readonly number[] ? T[K] : Partial<T[K]>) : T[K] };

/**
 * papertrails' plain look by day (config/render.js) and by night (render/biomegrade.js NIGHT_BASE); greenPull is its
 * greenDesat.
 */
const PT_DAY: LookSpec = {
  key: { color: '#ffd29c', intensity: 2.9 },
  fill: { color: '#f3cfa6', intensity: 0.95 },
  hemi: { sky: '#ffe9cc', ground: '#b98858', intensity: 0.42 },
  lightSize: 0.26,
  leak: '#7c5634',
  gobo: { key: 0.12, tint: 0.07 },
  fade: { color: '#a8804f', start: 6.5, end: 13.5 },
  background: '#96744a',
  exposure: 0.79,
  contrast: 1.1,
  saturation: 0.92,
  tint: [1.05, 0.96, 1.0],
  shadowTint: '#3a200c',
  aoTint: '#5a3214',
  greenPull: 0.7,
  vignette: 0.1,
  split: 0.025,
  focusBand: 0.36,
  farGain: 1.0,
};
const PT_NIGHT: LookSpec = {
  ...PT_DAY,
  key: { color: '#8fb0f0', intensity: 1.05 },
  fill: { color: '#3a58ac', intensity: 0.38 },
  hemi: { sky: '#4666c8', ground: '#16285c', intensity: 0.5 },
  lightSize: 0.22,
  leak: '#16286a',
  gobo: { key: 0.2, tint: 0.05 },
  fade: { color: '#070c2a', start: 5.0, end: 11.5 },
  background: '#070a24',
  exposure: 0.92,
  contrast: 1.1,
  saturation: 0.74,
  tint: [0.82, 0.97, 1.2],
  shadowTint: '#091638',
  aoTint: '#081030',
  greenPull: 0.45,
  vignette: 0.34,
  split: 0.02,
};

/** papertrails' biome tables (GRADE there), its blossom and pinewood; a night entry overrides its night base. */
const PT_GRADE: Record<'blossom' | 'pinewood', { day: Partial2<LookSpec>; night: Partial2<LookSpec> }> = {
  blossom: {
    day: {
      key: { color: '#ffe6cc', intensity: 2.9 },
      fill: { color: '#c9b9da', intensity: 1.15 },
      hemi: { sky: '#fff1ec', ground: '#c4a6b8', intensity: 0.5 },
      gobo: { key: 0.18, tint: 0.09 },
      lightSize: 0.32,
      leak: '#8c6c88',
      fade: { color: '#bc9ea4', start: 6.5, end: 13.5 },
      background: '#b0969e',
      exposure: 0.8,
      contrast: 1.05,
      saturation: 1.05,
      tint: [1.03, 0.98, 0.97],
      shadowTint: '#2a1832',
      aoTint: '#5a3848',
      greenPull: 0.3,
      vignette: 0.1,
    },
    night: { fade: { color: '#0b0d2e' }, background: '#0a0b28', saturation: 0.68 },
  },
  pinewood: {
    day: {
      key: { color: '#f8e2b6', intensity: 2.8 },
      fill: { color: '#62857f', intensity: 1.05 },
      hemi: { sky: '#c0d6cc', ground: '#55786e', intensity: 0.6 },
      gobo: { key: 0.14, tint: 0.03 },
      lightSize: 0.4,
      leak: '#44685c',
      fade: { color: '#788e84', start: 4.8, end: 11.5 },
      background: '#748a82',
      exposure: 0.86,
      contrast: 1.08,
      saturation: 0.98,
      tint: [0.99, 1.0, 0.97],
      shadowTint: '#0a2420',
      aoTint: '#2c4c44',
      greenPull: 0.4,
      vignette: 0.13,
      split: 0.02,
      farGain: 0.75,
      focusBand: 0.3,
    },
    night: {
      key: { color: '#86a8e8', intensity: 0.95 },
      fill: { color: '#3a64a8', intensity: 0.5 },
      hemi: { sky: '#4a74c0', ground: '#1a3c60', intensity: 0.85 },
      fade: { color: '#0b2238', start: 4.6, end: 10.5 },
      background: '#06162a',
      tint: [0.84, 0.99, 1.16],
    },
  },
};

/** Which of papertrails' looks each of our biomes takes (the rest: the plain look). */
const GRADE_OF: Partial<Record<Biome, keyof typeof PT_GRADE>> = { meadow: 'blossom', pine: 'pinewood' };
/** The looks blended: the plain one first, then papertrails' biomes. */
const GRADES = [null, 'blossom', 'pinewood'] as const;
/** Where the biomes round the traveller are read: his point (counted twice) and eight round him this far away. */
const SAMPLE_RADIUS = 3;
/** How fast the blend follows (papertrails: 1 - exp(-dt * 2.2)), and its quantum (a still traveller rewrites none). */
const FOLLOW = 2.2;
const QUANTUM = 512;
/** A colour channel scales by no more than this either way (very dark night colours make wild ratios). */
const MAX_SCALE = 4;

/** Our plain look by day and by night (config/view.ts; the night takes the day's terms it does not set). */
const OUR_DAY: LookSpec = {
  key: { color: LIGHTS.key.color, intensity: LIGHTS.key.intensity },
  fill: { color: LIGHTS.fill.color, intensity: LIGHTS.fill.intensity },
  hemi: { sky: LIGHTS.hemi.sky, ground: LIGHTS.hemi.ground, intensity: LIGHTS.hemi.intensity },
  lightSize: SHADOW.lightSize,
  leak: PAPER.shadowLeak,
  gobo: { key: POST.gobo.key, tint: POST.gobo.tint },
  fade: { color: POST.fade.color, start: POST.fade.start, end: POST.fade.end },
  background: POST.background,
  exposure: POST.exposure,
  contrast: POST.contrast,
  saturation: POST.saturation,
  tint: POST.tint,
  shadowTint: POST.shadowTint,
  aoTint: POST.aoTint,
  greenPull: POST.greenPull,
  vignette: POST.vignette,
  split: POST.split,
  focusBand: POST.focusBand,
  farGain: POST.farGain,
};
const OUR_NIGHT: LookSpec = {
  ...OUR_DAY,
  key: { color: NIGHT.key.color, intensity: NIGHT.key.intensity },
  fill: { color: NIGHT.fill.color, intensity: NIGHT.fill.intensity },
  hemi: { sky: NIGHT.hemi.sky, ground: NIGHT.hemi.ground, intensity: NIGHT.hemi.intensity },
  lightSize: NIGHT.lightSize,
  leak: NIGHT.paper.shadowLeak,
  gobo: { key: NIGHT.gobo.key, tint: NIGHT.gobo.tint },
  fade: { color: NIGHT.fade.color, start: NIGHT.fade.start, end: NIGHT.fade.end },
  background: NIGHT.background,
  exposure: NIGHT.exposure,
  contrast: NIGHT.contrast,
  saturation: NIGHT.saturation,
  tint: NIGHT.tint,
  shadowTint: NIGHT.shadowTint,
  aoTint: NIGHT.aoTint,
  greenPull: NIGHT.greenPull,
  vignette: NIGHT.vignette,
  split: NIGHT.split,
};

const colour = (hex: string) => new THREE.Color(hex);

/** Our colour, scaled channel by channel as papertrails' biome scales its own (linear RGB). */
function shiftColour(ours: string, pt: string, ptBiome: string | undefined): THREE.Color {
  const out = colour(ours);
  if (ptBiome === undefined) return out;
  const a = colour(pt);
  const b = colour(ptBiome);
  const k = (from: number, to: number) => (from < 1e-4 ? 1 : clamp(to / from, 1 / MAX_SCALE, MAX_SCALE));
  return out.setRGB(out.r * k(a.r, b.r), out.g * k(a.g, b.g), out.b * k(a.b, b.b));
}

/** Our value scaled (or, delta: shifted) as papertrails' biome changes its own. */
const scale = (ours: number, pt: number, ptBiome: number | undefined) => (ptBiome === undefined ? ours : (ours * ptBiome) / pt);
const shift = (ours: number, pt: number, ptBiome: number | undefined) => (ptBiome === undefined ? ours : ours + ptBiome - pt);

/** Our look in a biome: our plain look changed the way papertrails' biome changes its plain look. */
function ported(ours: LookSpec, pt: LookSpec, g: Partial2<LookSpec>): Look {
  return {
    key: { color: shiftColour(ours.key.color, pt.key.color, g.key?.color), intensity: scale(ours.key.intensity, pt.key.intensity, g.key?.intensity) },
    fill: { color: shiftColour(ours.fill.color, pt.fill.color, g.fill?.color), intensity: scale(ours.fill.intensity, pt.fill.intensity, g.fill?.intensity) },
    hemi: {
      sky: shiftColour(ours.hemi.sky, pt.hemi.sky, g.hemi?.sky),
      ground: shiftColour(ours.hemi.ground, pt.hemi.ground, g.hemi?.ground),
      intensity: scale(ours.hemi.intensity, pt.hemi.intensity, g.hemi?.intensity),
    },
    lightSize: scale(ours.lightSize, pt.lightSize, g.lightSize),
    leak: shiftColour(ours.leak, pt.leak, g.leak),
    gobo: { key: scale(ours.gobo.key, pt.gobo.key, g.gobo?.key), tint: scale(ours.gobo.tint, pt.gobo.tint, g.gobo?.tint) },
    fade: {
      color: shiftColour(ours.fade.color, pt.fade.color, g.fade?.color),
      start: scale(ours.fade.start, pt.fade.start, g.fade?.start),
      end: scale(ours.fade.end, pt.fade.end, g.fade?.end),
    },
    background: shiftColour(ours.background, pt.background, g.background),
    exposure: scale(ours.exposure, pt.exposure, g.exposure),
    contrast: shift(ours.contrast, pt.contrast, g.contrast),
    saturation: shift(ours.saturation, pt.saturation, g.saturation),
    tint: [0, 1, 2].map((i) => scale(ours.tint[i], pt.tint[i], g.tint?.[i])) as [number, number, number],
    shadowTint: shiftColour(ours.shadowTint, pt.shadowTint, g.shadowTint),
    aoTint: shiftColour(ours.aoTint, pt.aoTint, g.aoTint),
    greenPull: scale(ours.greenPull, pt.greenPull, g.greenPull),
    vignette: scale(ours.vignette, pt.vignette, g.vignette),
    split: scale(ours.split, pt.split, g.split),
    focusBand: scale(ours.focusBand, pt.focusBand, g.focusBand),
    farGain: scale(ours.farGain, pt.farGain, g.farGain),
  };
}

/**
 * The look of each grade (GRADES order), by day and by night (a night keeps its biome's day depth of field, as
 * papertrails).
 */
const DAY_LOOKS = GRADES.map((g) => ported(OUR_DAY, PT_DAY, g ? PT_GRADE[g].day : {}));
const NIGHT_LOOKS = GRADES.map((g, i) => {
  const look = ported(OUR_NIGHT, PT_NIGHT, g ? PT_GRADE[g].night : {});
  look.focusBand = DAY_LOOKS[i].focusBand;
  look.farGain = DAY_LOOKS[i].farGain;
  return look;
});

/** An empty look to blend into. */
function blank(): Look {
  return ported(OUR_DAY, PT_DAY, {});
}

/** looks blended by the weights w into out. */
function blendLooks(out: Look, looks: Look[], w: Float32Array): void {
  const num = (get: (l: Look) => number) => looks.reduce((s, l, i) => s + get(l) * w[i], 0);
  const col = (o: THREE.Color, get: (l: Look) => THREE.Color) => {
    o.setRGB(0, 0, 0);
    looks.forEach((l, i) => {
      const c = get(l);
      o.r += c.r * w[i];
      o.g += c.g * w[i];
      o.b += c.b * w[i];
    });
  };
  col(out.key.color, (l) => l.key.color);
  out.key.intensity = num((l) => l.key.intensity);
  col(out.fill.color, (l) => l.fill.color);
  out.fill.intensity = num((l) => l.fill.intensity);
  col(out.hemi.sky, (l) => l.hemi.sky);
  col(out.hemi.ground, (l) => l.hemi.ground);
  out.hemi.intensity = num((l) => l.hemi.intensity);
  out.lightSize = num((l) => l.lightSize);
  col(out.leak, (l) => l.leak);
  out.gobo.key = num((l) => l.gobo.key);
  out.gobo.tint = num((l) => l.gobo.tint);
  col(out.fade.color, (l) => l.fade.color);
  out.fade.start = num((l) => l.fade.start);
  out.fade.end = num((l) => l.fade.end);
  col(out.background, (l) => l.background);
  out.exposure = num((l) => l.exposure);
  out.contrast = num((l) => l.contrast);
  out.saturation = num((l) => l.saturation);
  for (let i = 0; i < 3; i++) out.tint[i] = num((l) => l.tint[i]);
  col(out.shadowTint, (l) => l.shadowTint);
  col(out.aoTint, (l) => l.aoTint);
  out.greenPull = num((l) => l.greenPull);
  out.vignette = num((l) => l.vignette);
  out.split = num((l) => l.split);
  out.focusBand = num((l) => l.focusBand);
  out.farGain = num((l) => l.farGain);
}

export class BiomeLook {
  /** The look here by day and by night (day-night.ts blends the two by the clock). */
  readonly day = blank();
  readonly night = blank();
  /** Bumped whenever the looks change (post.ts recomputes its grade then). */
  version = 0;
  private readonly smooth = new Float32Array(GRADES.length);
  private readonly weights = new Float32Array(GRADES.length);
  private readonly target = new Float32Array(GRADES.length);
  private readonly next = new Float32Array(GRADES.length);
  private placed = false;

  constructor() {
    this.smooth[0] = 1;
    this.weights[0] = 1;
    blendLooks(this.day, DAY_LOOKS, this.weights);
    blendLooks(this.night, NIGHT_LOOKS, this.weights);
  }

  /** Follows the biomes round the traveller at (x, z) (dt 0: at once). */
  update(dt: number, land: LandField, x: number, z: number): void {
    const t = this.target;
    t.fill(0);
    const count = (px: number, pz: number, weight: number) => {
      if (land.distance(px, pz) >= 0) return;
      const g = GRADE_OF[land.biomeInland(px, pz)];
      t[g ? GRADES.indexOf(g) : 0] += weight;
    };
    count(x, z, 2);
    for (let i = 0; i < 8; i++) count(x + Math.cos((i * Math.PI) / 4) * SAMPLE_RADIUS, z + Math.sin((i * Math.PI) / 4) * SAMPLE_RADIUS, 1);
    // (out at sea, or with no land round him: the plain look)
    let sum = t.reduce((s, v) => s + v, 0);
    if (sum === 0) {
      t[0] = 1;
      sum = 1;
    }
    const k = !this.placed || dt <= 0 ? 1 : 1 - Math.exp(-dt * FOLLOW);
    this.placed = true;
    let changed = false;
    let wsum = 0;
    const w = this.next;
    for (let b = 0; b < GRADES.length; b++) {
      this.smooth[b] += (t[b] / sum - this.smooth[b]) * k;
      w[b] = Math.round(this.smooth[b] * QUANTUM) / QUANTUM;
      wsum += w[b];
    }
    for (let b = 0; b < GRADES.length; b++) {
      w[b] = wsum > 0 ? w[b] / wsum : +(b === 0);
      if (Math.abs(w[b] - this.weights[b]) > 1e-4) changed = true;
    }
    if (!changed) return;
    this.weights.set(w);
    blendLooks(this.day, DAY_LOOKS, w);
    blendLooks(this.night, NIGHT_LOOKS, w);
    this.version++;
  }
}
