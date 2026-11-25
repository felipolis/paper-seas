/**
 * The clock and the look it picks. papertrails has a day look and a night look (render/daynight.js and
 * render/biomegrade.js there) and blends every value between them by one eased night amount; here the clock sets that
 * amount (config/time.ts). It drives the key / fill / ambient light, the paper's response, the post chain's grade,
 * the glowing windows and lanterns, and the warm light the ship carries at night. The two looks are the biome's here
 * (render/biome-look.ts).
 */
import * as THREE from 'three';
import { TIME } from '../config/time';
import { LIGHTS, NIGHT, PAPER } from '../config/view';
import type { BiomeLook } from './biome-look';
import { clamp } from '../core/math';
import type { Lights } from './lights';
import type { PostChain } from './post';
import { paperLighting } from './paper-material';
import { setGlowLevel } from './glow';
import { blend, pair } from './colour-pair';

const TRANSLUCENCY = pair(PAPER.translucencyTint, NIGHT.paper.translucencyTint);

/** The paper's shared lighting uniforms (render/paper-material.ts), as the look writes them. */
const paper: Record<'uPaperWrap' | 'uPaperTrans' | 'uPaperCloud', THREE.IUniform<number>> & Record<'uPaperTransTint' | 'uPaperShadowLeak', THREE.IUniform<THREE.Color>> = paperLighting;

/** 0 by day .. 1 by night at this clock hour: an eased fade between papertrails' two looks, centred on dawn and dusk. */
function nightAt(hour: number): number {
  const span = TIME.fadeHours;
  const sunUp = clamp((hour - TIME.dawn) / span + 0.5, 0, 1);
  const sunDown = clamp((hour - TIME.dusk) / span + 0.5, 0, 1);
  const t = 1 - sunUp + sunDown;
  return t * t * (3 - 2 * t);
}

export class DayNight {
  /** Clock hour 0..24. */
  hour: number = TIME.startHour;
  private night = nightAt(TIME.startHour);

  constructor(
    private readonly lights: Lights,
    private readonly post: PostChain,
    /** The ship's own lantern light. */
    private readonly shipLight: THREE.PointLight,
    /** The biome's look by day and by night. */
    private readonly look: BiomeLook,
  ) {}

  /** The night amount (0 day .. 1 night): lanterns, windows and the ship's stern lights are lit with it. */
  get lanterns(): number {
    return this.night;
  }

  update(dt: number, fast: boolean): void {
    this.hour = (this.hour + (dt * 24 * (fast ? TIME.fastForward : 1)) / TIME.cycleSeconds) % 24;
    const n = (this.night = nightAt(this.hour));
    const mix = (day: number, night: number) => day + (night - day) * n;

    const D = this.look.day;
    const N = this.look.night;
    const L = this.lights;
    L.key.color.copy(D.key.color).lerp(N.key.color, n);
    L.key.intensity = mix(D.key.intensity, N.key.intensity);
    L.keyAzimuth = mix(LIGHTS.key.azimuthDeg, NIGHT.key.azimuthDeg);
    L.keyElevation = mix(LIGHTS.key.elevationDeg, NIGHT.key.elevationDeg);
    L.fill.color.copy(D.fill.color).lerp(N.fill.color, n);
    L.fill.intensity = mix(D.fill.intensity, N.fill.intensity);
    L.fillElevation = mix(LIGHTS.fill.elevationDeg, NIGHT.fill.elevationDeg);
    L.hemi.color.copy(D.hemi.sky).lerp(N.hemi.sky, n);
    L.hemi.groundColor.copy(D.hemi.ground).lerp(N.hemi.ground, n);
    L.hemi.intensity = mix(D.hemi.intensity, N.hemi.intensity);
    L.lightSize = mix(D.lightSize, N.lightSize);

    paper.uPaperWrap.value = mix(PAPER.wrap, NIGHT.paper.wrap);
    paper.uPaperTrans.value = mix(PAPER.translucency, NIGHT.paper.translucency);
    paper.uPaperCloud.value = mix(PAPER.cloud, NIGHT.paper.cloud);
    blend(paper.uPaperTransTint.value, TRANSLUCENCY, n);
    paper.uPaperShadowLeak.value.copy(D.leak).lerp(N.leak, n);

    this.post.setLook(this.look, n);
    setGlowLevel(n);
    // (only its intensity: switching it off would change the light count the shaders are built for)
    this.shipLight.intensity = n * 2.2;
  }
}
