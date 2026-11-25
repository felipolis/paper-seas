/**
 * The soft patch, the shape of the cloud shadows and soft blobs (render/cloud-shadows.ts, life/soft-quads.ts): a wavy
 * outline, its phase per patch, and a smooth fall from the middle.
 */

/** GLSL: softPatch(p, phase), the patch's alpha (0..1) at p (-1..1 across it) for an outline phase of 0..1. */
export const SOFT_PATCH_GLSL = /* glsl */ `
float softPatch(vec2 p, float phase) {
  float ang = atan(p.y, p.x);
  float r = length(p) * (1.0 + 0.13 * sin(ang * 3.0 + phase * 6.283) + 0.07 * sin(ang * 5.0 + phase * 17.0));
  return 1.0 - smoothstep(0.2, 1.0, r);
}`;
