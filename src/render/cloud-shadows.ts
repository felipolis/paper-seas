/**
 * Cloud shadows, as papertrails casts them (life/life.js `clouds()`, config/life.js `clouds` there): five soft dark
 * patches with a wavy outline lying on the page, 8 to 13 units across, drifting with the wind, wrapped round the
 * traveller in a 30-unit square and faded at its edge, gone at night. papertrails draws each as a ground quad pulled
 * in front of everything ("ground shadows darken whatever stands on them"); here the post pass does the same per pixel,
 * from where the pixel's view ray meets the page.
 */
import * as THREE from 'three';
import { mulberry32 } from '../core/rng';
import { smoothstep } from '../core/math';

/** papertrails' numbers. */
const CLOUDS = {
  count: 5,
  size: [8, 13],
  alpha: 0.15,
  speed: 0.34,
  span: 30,
  color: '#0b0a1c',
  /** Its heartland density: the share of the five that are out (by rank, as its life gates them). */
  density: 0.8,
} as const;
/** Height of the page the shadows lie on (papertrails' 0.02). */
const CLOUD_Y = 0.02;


export class CloudShadows {
  /** Per patch: centre x, z and the cosine / sine of its turn. */
  readonly a = Array.from({ length: CLOUDS.count }, () => new THREE.Vector4());
  /** Per patch: half length, half width, outline phase, shadow strength (0: none). */
  readonly b = Array.from({ length: CLOUDS.count }, () => new THREE.Vector4());
  readonly color = new THREE.Color(CLOUDS.color);
  /** Each patch's own six random numbers (papertrails' Q). */
  private readonly q: number[][];
  private time = 0;

  constructor() {
    const rng = mulberry32(0xc10d5);
    this.q = Array.from({ length: CLOUDS.count }, () => Array.from({ length: 6 }, rng));
  }

  /** (fx, fz): the traveller; (windX, windZ): the wind's direction; night: 0..1. */
  update(dt: number, fx: number, fz: number, windX: number, windZ: number, night: number): void {
    this.time += dt;
    const C = CLOUDS;
    const W = C.span;
    const wl = Math.hypot(windX, windZ) || 1;
    const amount = C.density * (1 - night);
    this.q.forEach((Q, j) => {
      let dx = Q[0] * W + (windX / wl) * C.speed * this.time - fx;
      dx -= W * Math.round(dx / W);
      let dz = Q[1] * W + (windZ / wl) * C.speed * this.time - fz;
      dz -= W * Math.round(dz / W);
      // papertrails' gate: by rank as the density allows, faded at the edge of the wrapping square
      const rank = smoothstep(0, 1, (amount - ((j + 0.5) / C.count) * 0.88) / 0.12);
      const edge = 1 - smoothstep(0.8, 1, Math.max(Math.abs(dx), Math.abs(dz)) / (W * 0.5));
      const s = C.size[0] + (C.size[1] - C.size[0]) * Q[2];
      const yaw = Q[3] * Math.PI * 2;
      this.a[j].set(fx + dx, fz + dz, Math.cos(yaw), Math.sin(yaw));
      this.b[j].set(s / 2, (s * (0.62 + 0.25 * Q[4])) / 2, Q[5], C.alpha * rank * edge);
    });
  }
}

/** The shader side: darkens a colour by every patch over the point where its view ray meets the page. */
export const CLOUD_GLSL = /* glsl */ `
uniform vec4 uCloudA[${CLOUDS.count}];
uniform vec4 uCloudB[${CLOUDS.count}];
uniform vec3 uCloudColor;
vec3 cloudShadows(vec3 col, vec3 pw, vec3 cam) {
  float k = (cam.y - ${CLOUD_Y.toFixed(3)}) / max(cam.y - pw.y, 1e-4);
  vec2 g = cam.xz + (pw.xz - cam.xz) * k;
  for (int i = 0; i < ${CLOUDS.count}; i++) {
    vec4 A = uCloudA[i];
    vec4 B = uCloudB[i];
    if (B.w <= 0.0) continue;
    vec2 d = g - A.xy;
    vec2 p = vec2(d.x * A.z + d.y * A.w, -d.x * A.w + d.y * A.z) / B.xy;
    float r = length(p);
    if (r > 1.3) continue;
    // papertrails' soft patch: a wavy outline, a smooth fall from the middle
    float ang = atan(p.y, p.x);
    r *= 1.0 + 0.13 * sin(ang * 3.0 + B.z * 6.283) + 0.07 * sin(ang * 5.0 + B.z * 17.0);
    float a = (1.0 - smoothstep(0.2, 1.0, r)) * B.w;
    // (its premultiplied quad over the scene: colour * a * a + dst * (1 - a))
    col = col * (1.0 - a) + uCloudColor * a * a;
  }
  return col;
}
`;
