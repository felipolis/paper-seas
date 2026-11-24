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
 */
import * as THREE from 'three';
import type { Reflection } from '../render/reflection';

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

/** The uniforms every water material shares for its mirror: the image, its projection, and the ripple's framing. */
const uniforms = {
  uRefl: { value: null as THREE.Texture | null },
  uReflMatrix: { value: new THREE.Matrix4() },
  uReflOn: { value: 0 },
  uReflScale: { value: 1 },
  uReflAnchor: { value: new THREE.Vector4(0, 0, 0, 0) },
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
 * the image's colour in gMirror and how much of the paper it replaces in gMirrorW (0 with no mirror this frame). After
 * WATER_GLSL (uTime).
 */
export const MIRROR_GLSL = /* glsl */ `
uniform sampler2D uRefl;
uniform mat4 uReflMatrix;
uniform float uReflOn;
uniform float uReflScale;    // the ripple's size relative to papertrails' (its framing / ours, at least 1)
uniform vec4 uReflAnchor;    // the wave laid out as (p - xy) / uReflScale + zw
vec3 gMirror;
float gMirrorW;
void mirrorImage(vec2 p, float h, vec3 col, float clear) {
  gMirror = vec3(0.0);
  gMirrorW = 0.0;
  if (uReflOn < 0.5) return;
  float T = uTime;
  // papertrails' real mirror: the image sways sideways on its broad wave train (period 0.15 units, its WKF(1700)),
  // MIRROR_DISTORT units at most, uReflScale larger so it is the size on screen it is in papertrails at its framing.
  // Its finer train (WKF(4100), which also dimmed the image in bands) is left out: over a dark hull on our paler sea
  // it split the image into rows with water showing between them, stripes papertrails' mid-tone pieces over deep
  // teal never show
  vec2 rp = (p - uReflAnchor.xy) / uReflScale + uReflAnchor.zw;
  float w1 = sin(rp.y * 41.72 + T * 1.5 + 1.8 * sin(rp.x * 6.381 + T * 0.45));
  vec4 rc4 = uReflMatrix * vec4(p.x + w1 * ${MIRROR_DISTORT} * uReflScale, h, p.y, 1.0);
  vec4 m = texture2D(uRefl, rc4.xy / rc4.w);
  float cover = clamp(m.a, 0.0, 1.0) * clamp(clear, 0.0, 1.0);
  // its colour: the image tinted MIRROR_TINT of the way to the water under it and a little darker (MIRROR_GAIN);
  // what is brighter than paper (lit panes, lanterns) stays bright and untinted (MIRROR_HOT), and always shows
  vec3 rcol = m.rgb / max(m.a, 0.05);
  vec3 rtint = mix(vec3(1.0), col / max(max(col.r, max(col.g, col.b)), 0.05), ${MIRROR_TINT});
  float rhot = smoothstep(0.9, 2.2, max(rcol.r, max(rcol.g, rcol.b)));
  gMirror = rcol * mix(rtint * ${MIRROR_GAIN}, vec3(${MIRROR_HOT}), rhot);
  gMirrorW = max(cover * ${MIRROR_STRENGTH}, rhot * cover);
}
`;

/** The shader lines that lay the mirror over a water material's paper (it already carries its own light). */
export const MIRROR_APPLY = {
  /** After the water's colour (color_fragment): the image replaces part of the diffuse paper. */
  colour: 'diffuseColor.rgb *= 1.0 - gMirrorW;',
  /** In emissivemap_fragment: the image itself. */
  emissive: 'totalEmissiveRadiance += gMirror * gMirrorW;',
};
