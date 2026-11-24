/**
 * GLSL of the post chain (render/post.ts). All passes draw one full-screen triangle.
 *
 *   AO        contact darkening from depth (Vogel taps, reconstructed normals)          [half res]
 *   PRE       downsample x AO, signed circle of confusion (px, - = near) in alpha       [half res]
 *   TILE      max near-field CoC, so foreground blur bleeds over the sharp band             [1/8 res]
 *   GATHER    golden-angle disc bokeh, scatter-as-gather, near / far aware                  [half res]
 *   FILL      small tent that closes the gaps between gather taps                          [half res]
 *   BLOOM     threshold downsample + separable gaussian                                 [quarter res]
 *   SPILL     three ever wider blurs of the bloom (night only: lamp light washing the paper)  [1/16 res]
 *   COMPOSITE edge chroma, sharp / blur mix, AO, dark die-cut edge on depth silhouettes, bloom, spill, warm world
 *             haze, cloud shadows, vignette, filmic tone map, grade, film grain, sRGB
 */
import { CLOUD_GLSL } from './cloud-shadows';

/** Interleaved gradient noise (per-pixel rotation of a tap pattern) and Rec. 709 luma. */
const HELPERS = /* glsl */ `
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

export const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Shared: depth -> view z, circle of confusion, hash, luma, world grade. */
const COMMON = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec4 uProj;   // near, far, tan(fov / 2), aspect
uniform vec4 uDofA;   // focus view depth, focus uv.y, depth scale, depth weight
uniform vec4 uDofB;   // half band, ramp, max blur (px, drawing buffer), near gain
uniform vec3 uDofC;   // far gain, green pull, warm/cool split
uniform mat4 uCamWorld;
uniform vec3 uFocusW;
uniform vec4 uGobo;   // screen-right axis on the ground (x, z), 1 / radius, key falloff
uniform vec4 uGobo2;  // warm / cool tint, fade start, fade end, fade amount
uniform vec3 uFade;   // haze colour (pre-compensated for the tone curve)
${CLOUD_GLSL}
float viewZ(float d) { return (uProj.x * uProj.y) / (uProj.y - d * (uProj.y - uProj.x)); }
// a scene texel that is not a number or infinite (exponent bits all set; tested on the bits, which no compiler folds
// away as it may isnan) would spread through every blur that reads it: one bad pixel came out as a white bokeh disc
// ringed with black taps. It reads as the mean of the finite texels one and two away from the nearest one instead (a
// bad speck may be a few texels across), fetched whole (a filtered read beside it would blend the bad one in again);
// HDRP's "Stop NaNs" does the same job
bool finite3(vec3 c) { return !any(equal(floatBitsToUint(c) & 0x7f800000u, uvec3(0x7f800000u))); }
vec3 sceneAt(sampler2D t, vec2 uv) {
  vec3 c = textureLod(t, uv, 0.0).rgb;
  if (finite3(c)) return c;
  ivec2 size = textureSize(t, 0);
  ivec2 p = ivec2(uv * vec2(size));
  vec3 sum = vec3(0.0);
  float n = 0.0;
  for (int i = 0; i < 8; i++) {
    int s = (i & 1) * 2 - 1;
    int r = 1 + (i >> 2);
    ivec2 o = (i & 2) == 0 ? ivec2(s * r, 0) : ivec2(0, s * r);
    vec3 q = texelFetch(t, clamp(p + o, ivec2(0), size - 1), 0).rgb;
    if (finite3(q)) { sum += q; n += 1.0; }
  }
  return n > 0.0 ? sum / n : vec3(0.0);
}
float cocAt(vec2 uv, float z) {
  float sY = uv.y - uDofA.y;
  float sD = (z - uDofA.x) / uDofA.x * uDofA.z;
  float c = mix(sY, sD, uDofA.w);
  float a = min(max(abs(c) - uDofB.x, 0.0) / uDofB.y, 1.0);
  a = a * a * (3.0 - 2.0 * a) * 0.35 + a * 0.65;
  float g = c < 0.0 ? uDofB.w : uDofC.x;
  return sign(c) * min(a * g, 1.0) * uDofB.z;
}
${HELPERS}
vec3 viewPos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * vec2(uProj.z * uProj.w, uProj.z) * z, -z); }

// papertrails' world-space light falloff: the key side (screen-left) brighter and warmer, the fill side dimmer and
// cooler; and far from the focus, on the ground, a subtle haze of one colour.
vec3 gradeWorld(vec3 col, vec2 uv, float z, float rawDepth) {
  vec3 pv = viewPos(uv, z);
  vec3 pw = (uCamWorld * vec4(pv, 1.0)).xyz;
  vec2 rel = pw.xz - uFocusW.xz;
  // papertrails' cloud shadows: soft patches on the page, darkening whatever stands on them
  if (rawDepth < 0.99999) col = cloudShadows(col, pw, uCamWorld[3].xyz);
  float t = clamp(dot(rel, uGobo.xy) * uGobo.z, -1.0, 1.0);
  col *= (1.0 - uGobo.w * t) * vec3(1.0 - uGobo2.x * 0.5 * t, 1.0, 1.0 + uGobo2.x * t);
  float f = rawDepth >= 0.99999 ? 1.0 : smoothstep(uGobo2.y, uGobo2.z, length(rel));
  return mix(col, uFade, f * uGobo2.w);
}
`;

export const AO_FRAG = COMMON + /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uTexel;  // full-res texel
uniform vec3 uAo;     // radius (world), intensity, bias (world)
vec3 vpos(vec2 uv) { return viewPos(uv, viewZ(textureLod(tDepth, uv, 0.0).r)); }
void main() {
  float d0 = textureLod(tDepth, vUv, 0.0).r;
  if (d0 >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = vpos(vUv);
  vec2 t = uTexel * 2.0;
  vec3 pr = vpos(vUv + vec2(t.x, 0.0)), pl = vpos(vUv - vec2(t.x, 0.0));
  vec3 pu = vpos(vUv + vec2(0.0, t.y)), pd = vpos(vUv - vec2(0.0, t.y));
  vec3 dxv = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dyv = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dxv, dyv));
  float z = -P.z;
  float rUv = uAo.x / (2.0 * z * uProj.z);
  float phi = ign(gl_FragCoord.xy) * 6.2831853;
  float occ = 0.0;
  for (int i = 0; i < AO_TAPS; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / float(AO_TAPS));
    float a = fi * 2.399963229728653 + phi;
    vec2 o = vec2(cos(a), sin(a)) * r * rUv;
    vec3 v = vpos(vUv + vec2(o.x / uProj.w, o.y)) - P;
    float dv = dot(v, v);
    float fall = clamp(1.0 - dv / (uAo.x * uAo.x), 0.0, 1.0);
    occ += min(max(dot(v, N) - uAo.z, 0.0) / (dv + 1e-4) * uAo.x, 1.6) * fall;
  }
  float ao = clamp(1.0 - uAo.y * occ / float(AO_TAPS), 0.0, 1.0);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

export const PRE_FRAG = COMMON + /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tAo;
uniform vec2 uTexel;  // full-res texel
uniform vec3 uAoTint;
void main() {
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float coc = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUv + (vec2(float(i & 1), float(i >> 1)) - 0.5) * uTexel;
    float dr = textureLod(tDepth, uv, 0.0).r;
    float zz = viewZ(dr);
    float c = cocAt(uv, zz);
    // favour the blurrier samples so a sharp foreground edge never leaks its colour into the blur buffer
    float w = 0.02 + abs(c);
    acc += gradeWorld(min(sceneAt(tScene, uv), vec3(24.0)), uv, zz, dr) * w;
    wsum += w;
    if (abs(c) > abs(coc)) coc = c;
  }
  vec3 col = acc / wsum;
  vec2 t = uTexel * 2.0;
  float ao = 0.25 * (texture2D(tAo, vUv + t * vec2(0.5, 0.5)).r + texture2D(tAo, vUv + t * vec2(-0.5, 0.5)).r
    + texture2D(tAo, vUv + t * vec2(0.5, -0.5)).r + texture2D(tAo, vUv + t * vec2(-0.5, -0.5)).r);
  col *= mix(uAoTint, vec3(1.0), ao);
  gl_FragColor = vec4(col, coc);
}
`;

/** The largest near-field CoC over a block of 4 x 4 half-res texels (foreground blur may spread over its neighbours). */
export const TILE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPre;
uniform vec2 uHalfTexel;
void main() {
  float m = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 o = (vec2(float(x), float(y)) - 1.5) * uHalfTexel;
      m = max(m, -textureLod(tPre, vUv + o, 0.0).a);
    }
  }
  gl_FragColor = vec4(m, 0.0, 0.0, 1.0);
}
`;

export const GATHER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPre;
uniform sampler2D tTile;
uniform vec2 uTexel;  // full-res texel
uniform vec2 uTileTexel;
uniform vec2 uTaps[DOF_TAPS];
uniform float uBoost;
${HELPERS}
void main() {
  vec4 c0 = textureLod(tPre, vUv, 0.0);
  float cc = c0.a;
  float nearMax = texture2D(tTile, vUv).r;
  nearMax = max(nearMax, texture2D(tTile, vUv + uTileTexel * vec2(1.3, 1.3)).r);
  nearMax = max(nearMax, texture2D(tTile, vUv + uTileTexel * vec2(-1.3, 1.3)).r);
  nearMax = max(nearMax, texture2D(tTile, vUv + uTileTexel * vec2(1.3, -1.3)).r);
  nearMax = max(nearMax, texture2D(tTile, vUv + uTileTexel * vec2(-1.3, -1.3)).r);
  // dilate only for a real foreground silhouette; inside a smooth ramp the pixel keeps its own radius
  float R = mix(abs(cc), max(abs(cc), nearMax), smoothstep(2.0, 6.0, nearMax - abs(cc)));
  if (R < 0.6) { gl_FragColor = vec4(c0.rgb, 0.0); return; }
  float phi = ign(gl_FragCoord.xy) * 6.2831853;
  mat2 rot = mat2(cos(phi), sin(phi), -sin(phi), cos(phi));
  vec3 acc = c0.rgb * 0.15;
  float wsum = 0.15;
  float nearW = 0.0;
  float wnorm = 0.0;
  for (int i = 0; i < DOF_TAPS; i++) {
    vec2 o = rot * uTaps[i];
    float tr = length(uTaps[i]);
    float d = tr * R;
    vec4 s = textureLod(tPre, vUv + o * R * uTexel, 0.0);
    float sAbs = abs(s.a);
    // a tap behind the centre may not spread further than the centre is blurred itself
    if (s.a > cc) sAbs = min(sAbs, abs(cc) * 2.0);
    // taps are denser toward the centre (r = u^0.75); tr^(2/3) restores the area weighting
    float w = smoothstep(d - 1.0, d + 1.0, sAbs) * pow(tr, 0.6667);
    nearW += w * smoothstep(1.0, 3.4, -s.a);
    wnorm += pow(tr, 0.6667);
    w *= 1.0 + uBoost * min(luma(s.rgb), 6.0);
    acc += s.rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, clamp(2.0 * nearW / max(wnorm, 1e-3), 0.0, 1.0));
}
`;

/** A small tent over the gathered blur, as wide as the gaps between its taps. */
export const FILL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tGather;
uniform sampler2D tPre;
uniform vec2 uTexel;  // full-res texel
uniform vec2 uFill;   // spacing factor, max blur px
void main() {
  vec4 c = texture2D(tGather, vUv);
  float R = max(abs(textureLod(tPre, vUv, 0.0).a), c.a * uFill.y * 0.6);
  float f = clamp(R * uFill.x, 0.0, 5.0);
  vec2 o = uTexel * f;
  vec4 s = c * 0.3;
  s += texture2D(tGather, vUv + vec2(o.x, o.y * 0.4)) * 0.175;
  s += texture2D(tGather, vUv + vec2(-o.x, -o.y * 0.4)) * 0.175;
  s += texture2D(tGather, vUv + vec2(-o.x * 0.4, o.y)) * 0.175;
  s += texture2D(tGather, vUv + vec2(o.x * 0.4, -o.y)) * 0.175;
  gl_FragColor = s;
}
`;

export const BLOOM_DOWN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uHalfTexel;  // the source's (half-res) texel
uniform float uThreshold;
vec3 bright(vec2 uv) {
  vec3 c = texture2D(tSrc, uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  return c * clamp((l - uThreshold) / max(l, 1e-4), 0.0, 1.0);
}
void main() {
  vec3 c = bright(vUv + uHalfTexel * vec2(1.0, 1.0)) + bright(vUv + uHalfTexel * vec2(-1.0, 1.0))
    + bright(vUv + uHalfTexel * vec2(1.0, -1.0)) + bright(vUv + uHalfTexel * vec2(-1.0, -1.0));
  gl_FragColor = vec4(min(c * 0.25, vec3(8.0)), 1.0);
}
`;

export const BLUR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uDir;  // texel * direction
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
  c += (texture2D(tSrc, vUv + uDir * 1.384615).rgb + texture2D(tSrc, vUv - uDir * 1.384615).rgb) * 0.316216;
  c += (texture2D(tSrc, vUv + uDir * 3.230769).rgb + texture2D(tSrc, vUv - uDir * 3.230769).rgb) * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}
`;

export const COMPOSITE_FRAG = COMMON + /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBlur;
uniform sampler2D tBloom;
uniform sampler2D tSpill;
uniform sampler2D tAo;
uniform vec2 uTexel;      // full-res texel
uniform vec4 uTone;       // exposure, contrast, saturation, shadow lift
uniform vec3 uShadowTint; // sRGB: it lifts the darkest tones after the tone curve
uniform vec3 uTint;       // white balance before the tone curve
uniform vec4 uLens;       // vignette, grain, grain size (px), edge chroma (px)
uniform vec3 uVignetteColor; // what the vignette darkens toward (pre-compensated for the tone curve)
uniform vec4 uFx;         // bloom, rim strength, rim width (px), frame seed
uniform float uSharpen;
uniform float uSpill;
uniform vec3 uAoTint;
uniform vec3 uRimColor;   // multiplier on the piece's own colour (a darker card edge)
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  float rawD = textureLod(tDepth, vUv, 0.0).r;
  float z = viewZ(rawD);
  float coc = cocAt(vUv, z);
  float rw = uFx.z;
  vec2 ox = vec2(uTexel.x * rw, 0.0), oy = vec2(0.0, uTexel.y * rw);
  float zl = viewZ(textureLod(tDepth, vUv - ox, 0.0).r), zr = viewZ(textureLod(tDepth, vUv + ox, 0.0).r);
  float zd = viewZ(textureLod(tDepth, vUv - oy, 0.0).r), zu = viewZ(textureLod(tDepth, vUv + oy, 0.0).r);

  // --- sharp layer: a very slight chromatic softness toward the frame edge, then an unsharp mask in the focus band
  // (the bite of a macro lens) -------------------------------------------------------------------------------------
  vec3 sharp = sceneAt(tScene, vUv);
  vec2 cd = vUv - 0.5;
  vec2 co = cd * dot(cd, cd) * 4.0 * uLens.w * uTexel;
  sharp.r = sceneAt(tScene, vUv + co).r;
  sharp.b = sceneAt(tScene, vUv - co).b;
  float ac = abs(coc);
  // papertrails: 4 taps round the pixel, an unsharp mask inside the focus band turning into a small full-res blur for
  // CoC 0.5 - 3 px, so detail fades out gradually before the half-res bokeh layer takes over
  vec2 mo = uTexel * max(0.75, ac * 0.8);
  vec3 sb = 0.25 * (sceneAt(tScene, vUv + mo * vec2(1.0, 0.4)) + sceneAt(tScene, vUv + mo * vec2(-1.0, -0.4))
    + sceneAt(tScene, vUv + mo * vec2(-0.4, 1.0)) + sceneAt(tScene, vUv + mo * vec2(0.4, -1.0)));
  vec3 crisp = max(sharp + clamp(sharp - sb, vec3(-0.25), vec3(0.25)) * uSharpen, vec3(0.0));
  sharp = mix(crisp, mix(sharp, sb, 0.8), smoothstep(0.4, 1.6, ac));
  sharp = gradeWorld(sharp, vUv, z, rawD);
  vec2 t2 = uTexel * 2.0;
  float ao = 0.25 * (texture2D(tAo, vUv + t2 * vec2(0.6, 0.6)).r + texture2D(tAo, vUv + t2 * vec2(-0.6, 0.6)).r
    + texture2D(tAo, vUv + t2 * vec2(0.6, -0.6)).r + texture2D(tAo, vUv + t2 * vec2(-0.6, -0.6)).r);
  sharp *= mix(uAoTint, vec3(1.0), ao);

  // --- a thin darker card edge where this pixel is the front of a depth silhouette (the die-cut edge) --
  // papertrails' two rings (axis taps, then diagonal taps 1.55 x further out) give a smooth band, not a dotted line;
  // the depth step is relative to the view distance, so far cards keep their edge
  float zfar = max(max(zl, zr), max(zd, zu));
  vec2 od = uTexel * rw * 1.55;
  float zfar2 = max(max(viewZ(textureLod(tDepth, vUv + od, 0.0).r), viewZ(textureLod(tDepth, vUv - od, 0.0).r)),
    max(viewZ(textureLod(tDepth, vUv + vec2(od.x, -od.y), 0.0).r), viewZ(textureLod(tDepth, vUv + vec2(-od.x, od.y), 0.0).r)));
  float zs = 0.0035 * z;
  float rim = max(smoothstep(zs, zs * 2.6, zfar - z), 0.55 * smoothstep(zs * 1.4, zs * 3.4, zfar2 - z)) * uFx.y;
  rim *= 1.0 - smoothstep(1.5, 4.0, ac);
  sharp = mix(sharp, sharp * uRimColor, clamp(rim, 0.0, 1.0));

  // --- blur layer, pushed away from sharp silhouettes so they do not halo ------------------------------
  vec2 g = vec2(abs(cocAt(vUv + ox, zr)) - abs(cocAt(vUv - ox, zl)), abs(cocAt(vUv + oy, zu)) - abs(cocAt(vUv - oy, zd)));
  float gl = length(g);
  vec2 shift = gl > 1e-4 ? g / gl * min(gl * 0.35, 1.0) * 2.2 : vec2(0.0);
  vec4 blur = texture2D(tBlur, vUv + shift * uTexel);
  float blend = max(smoothstep(1.2, 3.6, ac), blur.a);
  vec3 col = mix(sharp, blur.rgb, blend);
  col += texture2D(tBloom, vUv).rgb * uFx.x;
  // papertrails' light spill: the very wide blur of the glowing panes and lanterns lights the paper round them
  if (uSpill > 0.0) {
    float cl = max(col.r, max(col.g, col.b));
    col += texture2D(tSpill, vUv).rgb * uSpill * (col * 5.0 + 0.035) * (1.0 - smoothstep(0.5, 1.4, cl));
  }

  // --- lens + film -----------------------------------------------------------------------------------
  vec2 vc = (vUv - 0.5) * vec2(uProj.w / 1.7778, 1.0) * vec2(1.0, 1.12);
  float vr = dot(vc, vc) * 2.4;
  col = mix(col, uVignetteColor, uLens.x * smoothstep(0.12, 1.25, vr) * 1.25);
  col = aces(col * uTone.x * uTint);
  float l = luma(col);
  col = mix(vec3(l), col, uTone.z);
  col = toSRGB(max(col, 0.0));
  col = (col - 0.42) * uTone.y + 0.42;
  // yellow-green grass under the warm key reads as a video game: pull only those hues toward sage (after
  // papertrails; cream, ochre, terracotta and the teal sea are outside the mask)
  float gm = smoothstep(0.1, 0.3, col.g - col.b) * smoothstep(-0.2, -0.05, col.g - col.r) * uDofC.y;
  col = mix(col, mix(vec3(luma(col)), col, 0.45) * vec3(0.97, 1.0, 1.03), clamp(gm, 0.0, 1.0));
  col += uShadowTint * uTone.w * (1.0 - smoothstep(0.0, 0.45, l));
  // a very slight warm-left / cool-right grade: the lamp is at screen-left
  float sx = vUv.x * 2.0 - 1.0;
  col *= vec3(1.0 - uDofC.z * sx, 1.0 - uDofC.z * 0.25 * sx, 1.0 + uDofC.z * 1.3 * sx);
  vec2 gp = gl_FragCoord.xy / uLens.z;
  vec2 gi = floor(gp), gf = fract(gp);
  vec2 so = vec2(uFx.w * 0.618, uFx.w * 0.377);
  float n00 = hash12(gi + so), n10 = hash12(gi + vec2(1.0, 0.0) + so), n01 = hash12(gi + vec2(0.0, 1.0) + so), n11 = hash12(gi + vec2(1.0, 1.0) + so);
  float n = mix(mix(n00, n10, gf.x), mix(n01, n11, gf.x), gf.y) + hash12(gl_FragCoord.xy + so * 1.7) * 0.5 - 0.75;
  float gl2 = luma(col);
  col += n * uLens.y * 2.2 * (0.35 + 1.3 * sqrt(clamp(gl2, 0.0, 1.0)) * (1.0 - 0.6 * gl2));
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
