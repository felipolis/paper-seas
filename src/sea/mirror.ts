/**
 * The world mirrored in the water (papertrails' real mirror, render/water.js there), shared by the sea and the
 * streams: each water material projects its own pixel into the planar mirror image (render/reflection.ts) and shows
 * it rippled sideways and tinted toward the water under it.
 *
 * The image is the sea's, mirrored in the plane y = 0; the streams lie on the land, h above it, and read the same
 * image at their own point. Mirrored in their plane the world would stand 2h higher, which is the same as looking
 * from 2h lower: the ray they read instead parts from the true one by 2h x (how far past the water the mirrored
 * thing is) / (how far the camera is), about 0.03 for a tree on the bank seen on foot, below the image's own ripple.
 * papertrails' page is flat and all its water one plane, so it has the one image too.
 *
 * At night (papertrails' water.js WATER_GLOW_GLSL and the night part of WATER_MIRROR_GLSL) the water sinks into a deep
 * blue, the mirrored paper sinks into the blue while the mirrored lights stay bright and pull out into warm broken
 * streaks toward the viewer, and every lamp pool (render/lamp-pools.ts) lays a warm streak on the water before it. The
 * night comes in with the pools.
 */
import * as THREE from 'three';
import type { Reflection } from '../render/reflection';
import { POOL_COUNT, poolUniforms } from '../render/lamp-pools';

/**
 * papertrails' mirror (config/world.js water.mirror there, render/water.js WATER_DEFAULTS.mirror): its sideways
 * ripple (world units), its strength, how far its image is tinted toward the water, its gain, and the gain of what is
 * brighter than paper.
 */
const MIRROR_DISTORT = '0.017';
const MIRROR_STRENGTH = '0.7';
const MIRROR_TINT = '0.6';
const MIRROR_GAIN = '0.88';
const MIRROR_HOT = '0.62';
/**
 * papertrails' night water: its colour multiplied toward deep blue, its mirrored paper toward a paler blue, the strength
 * of the lamp pools' streaks (water.streak) and of the lights' streaks in the mirror.
 */
const NIGHT_WATER = 'vec3(0.42, 0.52, 0.7)';
const NIGHT_MIRROR = 'vec3(0.55, 0.66, 0.82)';
const POOL_STREAK = '0.55';
const LIGHT_STREAK = '0.42';
/**
 * papertrails only ever shows its mirror on foot, the focus 10.8 from its camera; the ripple's wave trains and
 * displacement are sized for that framing. Seen from further (the ship's 18), the same world sizes would shrink to
 * ~5 px rows that read as scanlines, so they keep the size on screen they have in papertrails at its framing: they
 * grow with the camera's distance beyond MIRROR_FRAMING. The wave is laid out from an anchor that moves to the focus
 * whenever the size changes (keeping the wave where it was there), so a zoom stretches it about the middle of the
 * picture instead of sliding it by the world's far-off coordinates; at a steady size it stays put in the world.
 */
const MIRROR_FRAMING = 10.8;
/** The wave's frequencies are multiples of 2 pi / MIRROR_WRAP (papertrails' WKF), so its offset wraps there exactly. */
const MIRROR_WRAP = 256;
/** papertrails' WKF(n): n whole waves over MIRROR_WRAP, as a GLSL literal written out in full so the wrap stays exact. */
const wkf = (n: number): string => ((2 * Math.PI * n) / MIRROR_WRAP).toFixed(8);
/** The broad wave train's frequency across the image and the slower one that bends it (WKF(1700), WKF(260)). */
const MIRROR_WAVE = wkf(1700);
const MIRROR_BEND = wkf(260);

/** The uniforms every water material shares for its mirror: the image, its projection, and the ripple's framing. */
const uniforms = {
  uRefl: { value: null as THREE.Texture | null },
  uReflMatrix: { value: new THREE.Matrix4() },
  uReflOn: { value: 0 },
  uReflScale: { value: 1 },
  uReflAnchor: { value: new THREE.Vector4(0, 0, 0, 0) },
  // the lamp pools (their lamps for the streaks, their colour for how far into the night it is)
  ...poolUniforms,
};

/** The mirror's uniforms, shared by every water material (spread them into its own). */
export function mirrorUniforms(): Record<string, THREE.IUniform> {
  return uniforms;
}

/** The mirror image this frame, or null when none was drawn. */
export function setMirror(r: Reflection | null): void {
  uniforms.uReflOn.value = r ? 1 : 0;
  if (!r) return;
  uniforms.uRefl.value = r.target.texture;
  uniforms.uReflMatrix.value.copy(r.matrix);
}

/**
 * Keeps the ripple papertrails' size on screen. cameraDistance: how far the camera stands from its focus (fx, fz);
 * the wave is re-anchored at the focus when its size changes (see MIRROR_FRAMING).
 */
export function frameMirrorRipple(cameraDistance: number, fx: number, fz: number): void {
  const scale = Math.max(1, cameraDistance / MIRROR_FRAMING);
  const u = uniforms.uReflScale;
  if (scale === u.value) return;
  // the wave at the focus stays where it is: (f - a) / old + o, re-laid from the focus
  const a = uniforms.uReflAnchor.value;
  const wrap = (v: number) => v - MIRROR_WRAP * Math.floor(v / MIRROR_WRAP);
  a.set(fx, fz, wrap((fx - a.x) / u.value + a.z), wrap((fz - a.y) / u.value + a.w));
  u.value = scale;
}

/**
 * mirrorImage(p, h, col, clear): the mirror at the water point p (world x, z) at the height h of its water (see above),
 * over the water colour col; clear: how much of that pixel is open water (dashes and foam hide the image). It leaves
 * the image's colour in gMirror and how much of the paper it replaces in gMirrorW (0 with no mirror this frame), marks
 * the pixel as water (gMirrorWater, for the night's blue) and leaves the night's warm streaks in gMirrorStreak. After
 * WATER_GLSL (uTime).
 */
export const MIRROR_GLSL = /* glsl */ `
uniform sampler2D uRefl;
uniform mat4 uReflMatrix;
uniform float uReflOn;
uniform float uReflScale;    // the ripple's size relative to papertrails' (its framing / ours, at least 1)
uniform vec4 uReflAnchor;    // the wave laid out as (p - xy) / uReflScale + zw
uniform vec4 uPaperPool[ ${POOL_COUNT} ];
uniform vec4 uPaperPoolCol;
vec3 gMirror;
float gMirrorW;
float gMirrorWater;
vec3 gMirrorStreak;
/** How far into the night the water is (papertrails: with the lamp pools' colour). */
float waterNight() {
  return uPaperPoolCol.w > 0.0 ? clamp(uPaperPoolCol.r * 1.2, 0.0, 1.0) : 0.0;
}
void mirrorImage(vec2 p, float h, vec3 col, float clear) {
  gMirror = vec3(0.0);
  gMirrorW = 0.0;
  gMirrorWater = 1.0;
  gMirrorStreak = vec3(0.0);
  float T = uTime;
  float nk = waterNight();
  if (nk > 0.0) {
    // under every lamp pool a warm streak runs toward the camera (it looks north: the streak lies to the lamp's south)
    float wg = 0.0;
    for (int i = 0; i < ${POOL_COUNT}; i++) {
      vec4 pp = uPaperPool[i];
      vec2 dl = p - pp.xz;
      float sx = dl.x + 0.035 * sin(dl.y * 38.0 - T * 2.0);
      wg += pp.w * exp(-sx * sx / 0.007) * smoothstep(0.05, 0.3, dl.y) * (1.0 - smoothstep(0.6, 2.1, dl.y)) * (0.55 + 0.45 * sin(dl.y * 64.0 + T * 1.7));
    }
    gMirrorStreak += wg * ${POOL_STREAK} * uPaperPoolCol.rgb;
  }
  if (uReflOn < 0.5) return;
  // papertrails' real mirror: the image sways sideways on its broad wave train (period 0.15 units, its WKF(1700)),
  // MIRROR_DISTORT units at most, uReflScale larger so it is the size on screen it is in papertrails at its framing.
  // Its finer train (WKF(4100), which also dimmed the image in bands) is left out: over a dark hull on our paler sea
  // it split the image into rows with water showing between them, stripes papertrails' mid-tone pieces over deep
  // teal never show
  vec2 rp = (p - uReflAnchor.xy) / uReflScale + uReflAnchor.zw;
  float w1 = sin(rp.y * ${MIRROR_WAVE} + T * 1.5 + 1.8 * sin(rp.x * ${MIRROR_BEND} + T * 0.45));
  vec4 rc4 = uReflMatrix * vec4(p.x + w1 * ${MIRROR_DISTORT} * uReflScale, h, p.y, 1.0);
  vec2 ruv = rc4.xy / rc4.w;
  vec4 m = texture2D(uRefl, ruv);
  float cover = clamp(m.a, 0.0, 1.0) * clamp(clear, 0.0, 1.0);
  // its colour: the image tinted MIRROR_TINT of the way to the water under it and a little darker (MIRROR_GAIN);
  // what is brighter than paper (lit panes, lanterns) stays bright and untinted (MIRROR_HOT), and always shows; at
  // night the paper sinks into the blue, the lights do not
  vec3 rcol = m.rgb / max(m.a, 0.05);
  vec3 rtint = mix(vec3(1.0), col / max(max(col.r, max(col.g, col.b)), 0.05), ${MIRROR_TINT});
  float rhot = smoothstep(0.9, 2.2, max(rcol.r, max(rcol.g, rcol.b)));
  gMirror = rcol * mix(rtint * ${MIRROR_GAIN} * mix(vec3(1.0), ${NIGHT_MIRROR}, nk), vec3(${MIRROR_HOT}), rhot);
  gMirrorW = max(cover * ${MIRROR_STRENGTH}, rhot * cover);
  if (nk > 0.05) {
    // the lit panes and lamps in the mirror pull out into warm broken streaks toward the viewer (4 taps up the image)
    float sk = 0.0;
    for (int i = 1; i <= 4; i++) {
      vec2 su = ruv + vec2(0.0025 * sin(gl_FragCoord.y * 0.21 + T * 2.0 + float(i)), 0.011 * float(i));
      vec4 s4 = texture2D(uRefl, su);
      vec3 sc4 = s4.rgb / max(s4.a, 0.05);
      sk += smoothstep(0.95, 2.2, max(sc4.r, max(sc4.g, sc4.b))) * clamp(s4.a, 0.0, 1.0) * (1.0 - 0.2 * float(i));
    }
    float brk = 0.45 + 0.55 * smoothstep(-0.3, 0.6, sin(gl_FragCoord.y * 0.75 + T * 1.7 + 3.0 * sin(gl_FragCoord.x * 0.05)));
    gMirrorStreak += clamp(clear, 0.0, 1.0) * nk * sk * brk * ${LIGHT_STREAK} * vec3(1.0, 0.72, 0.38);
  }
}
`;

/** The shader lines that lay the mirror over a water material's paper (it already carries its own light). */
export const MIRROR_APPLY = {
  /** After the water's colour (color_fragment): the night's blue on the water, then the image replaces part of it. */
  colour: `diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * ${NIGHT_WATER}, gMirrorWater * waterNight());\ndiffuseColor.rgb *= 1.0 - gMirrorW;`,
  /** In emissivemap_fragment: the image itself and the night's streaks. */
  emissive: 'totalEmissiveRadiance += gMirror * gMirrorW + gMirrorStreak;',
};
