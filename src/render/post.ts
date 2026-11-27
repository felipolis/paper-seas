/**
 * Post chain (shaders in post-shaders.ts):
 *
 *   scene -> HDR multisampled target + depth texture                              [full res]
 *   AO -> PRE (downsample x AO, CoC) -> GATHER (bokeh, near / far aware) -> FILL      [half res]
 *   TILE (largest near-field CoC: the foreground blurs over the sharp band)        [1/8 res]
 *   bloom (threshold + 2 blur passes)                                              [quarter res]
 *   spill (3 wider blurs of the bloom, night only)                                 [1/16 res]
 *   COMPOSITE -> screen (tone map, grade, grain, sRGB)
 *
 * The miniature look: a tilt-shift whose blur mixes screen height and depth around the ship, contact darkening
 * where cards meet the page, a darker die-cut edge on every silhouette, and a warm haze where the table ends.
 */
import * as THREE from 'three';
import { CAMERA, POST, NIGHT } from '../config/view';
import { clamp, smoothstep } from '../core/math';
import { CloudShadows } from './cloud-shadows';
import { blend, pair } from './colour-pair';
import type { BiomeLook } from './biome-look';
import { AO_FRAG, BLOOM_DOWN_FRAG, BLUR_FRAG, COMPOSITE_FRAG, FILL_FRAG, GATHER_FRAG, PRE_FRAG, TILE_FRAG, TONE_CURVE, VERT } from './post-shaders';

/**
 * The most the depth scale turns a depth difference into (a share of the frame height per unit of relative depth): it
 * grows without bound as the camera looks straight down.
 */
const MAX_DEPTH_SCALE = 9;

function vogelTaps(n: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.pow((i + 0.5) / n, 0.75);
    const a = i * 2.399963229728653;
    out.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return out;
}

function target(w: number, h: number, type: THREE.TextureDataType = THREE.HalfFloatType): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
}

// ---- a JS mirror of the tone curve, to pre-compensate colours that must come out exact on screen ----
interface Tone {
  exposure: number;
  contrast: number;
  saturation: number;
  tint: THREE.Vector3;
}
const { aces: ACES, srgb: SRGB, pivot: PIVOT, luma: LUMA } = TONE_CURVE;
const acesJS = (x: number) => clamp((x * (ACES.a * x + ACES.b)) / (x * (ACES.c * x + ACES.d) + ACES.e), 0, 1);
const toSRGBJS = (c: number) => (c < SRGB.cut ? c * SRGB.slope : SRGB.scale * Math.pow(c, 1 / SRGB.gamma) - SRGB.offset);
/** The composite's tone curve at the centre of the frame (no vignette, grain or shadow lift), rgb into out. */
function toneJS(rgb: Float64Array, P: Tone, out: Float64Array): void {
  for (let i = 0; i < 3; i++) out[i] = acesJS(rgb[i] * P.exposure * P.tint.getComponent(i));
  const l = LUMA[0] * out[0] + LUMA[1] * out[1] + LUMA[2] * out[2];
  for (let i = 0; i < 3; i++) out[i] = (toSRGBJS(Math.max(0, l + (out[i] - l) * P.saturation)) - PIVOT) * P.contrast + PIVOT;
}
const _srgb = { r: 0, g: 0, b: 0 };
const _want = new Float64Array(3);
const _x = new Float64Array(3);
const _got = new Float64Array(3);
/** The linear scene colour whose tone-mapped result is the given colour. */
function inverseTone(colour: THREE.Color, P: Tone, out: THREE.Color): THREE.Color {
  colour.getRGB(_srgb, THREE.SRGBColorSpace);
  _want[0] = _srgb.r;
  _want[1] = _srgb.g;
  _want[2] = _srgb.b;
  _x.fill(0.02);
  for (let it = 0; it < 60; it++) {
    toneJS(_x, P, _got);
    for (let i = 0; i < 3; i++) {
      const ratio = (_want[i] + 0.02) / (Math.max(_got[i], -0.015) + 0.02);
      _x[i] = clamp(_x[i] * Math.pow(ratio, 0.8), 1e-5, 8);
    }
  }
  return out.setRGB(_x[0], _x[1], _x[2], THREE.LinearSRGBColorSpace);
}

/** setNight's steps from day to night. */
const NIGHT_STEPS = 200;

const VIGNETTE = pair(POST.vignetteColor, NIGHT.vignetteColor);

export class PostChain {
  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly aoTarget = target(1, 1, THREE.UnsignedByteType);
  private readonly preTarget = target(1, 1);
  private readonly tileTarget = target(1, 1);
  private readonly gatherTarget = target(1, 1);
  private readonly fillTarget = target(1, 1);
  private readonly bloomA = target(1, 1);
  private readonly bloomB = target(1, 1);
  private readonly spillA = target(1, 1);
  private readonly spillB = target(1, 1);

  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;

  /** The cloud shadows (their uniforms are shared by the passes that grade the world). */
  private readonly clouds = new CloudShadows();
  /** Uniforms shared by every pass that reads depth (the day / night values are set by setNight()). */
  private readonly common = {
    uProj: { value: new THREE.Vector4(1, 100, 0.23, 1.78) },
    uDofA: { value: new THREE.Vector4(CAMERA.distance, 0.5, 2.7, POST.depthWeight) },
    uDofB: { value: new THREE.Vector4(POST.focusBand / 2, POST.ramp, POST.maxBlurPx, POST.nearGain) },
    uDofC: { value: new THREE.Vector3(POST.farGain, POST.greenPull, POST.split) },
    uCamWorld: { value: new THREE.Matrix4() },
    uFocusW: { value: new THREE.Vector3() },
    uGobo: { value: new THREE.Vector4(1, 0, 1 / POST.gobo.radius, POST.gobo.key) },
    uGobo2: { value: new THREE.Vector4(POST.gobo.tint, POST.fade.start, POST.fade.end, POST.fade.amount) },
    uFade: { value: new THREE.Color() },
    uCloudA: { value: this.clouds.a },
    uCloudB: { value: this.clouds.b },
    uCloudColor: { value: this.clouds.color },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uAoTint: { value: new THREE.Color() },
  };

  private readonly aoMat: THREE.ShaderMaterial;
  private readonly preMat: THREE.ShaderMaterial;
  private readonly tileMat: THREE.ShaderMaterial;
  private readonly gatherMat: THREE.ShaderMaterial;
  private readonly fillMat: THREE.ShaderMaterial;
  private readonly bloomDownMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;
  /** The page's surround, written into the scene's background (pre-compensated for the tone curve). */
  private readonly background = new THREE.Color();
  /** The night amount the look was last blended for, and the blended values that are finished per frame. */
  private night = -1;
  private readonly look: Record<'exposure' | 'goboKey' | 'fadeStart' | 'fadeEnd' | 'maxBlurPx' | 'focusBand', number> = { exposure: POST.exposure, goboKey: POST.gobo.key, fadeStart: POST.fade.start, fadeEnd: POST.fade.end, maxBlurPx: POST.maxBlurPx, focusBand: POST.focusBand };
  /** The biome look's version the grade was last blended for. */
  private version = -1;
  private readonly focusWorld = new THREE.Vector3();
  private readonly _v = new THREE.Vector3();
  private readonly _c = new THREE.Color();
  private height = 1;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera, look: BiomeLook) {
    scene.background = this.background;
    const depth = new THREE.DepthTexture(1, 1);
    depth.type = THREE.UnsignedIntType;
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true, depthTexture: depth });

    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(tri);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const C = this.common;
    const mat = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, number> = {}) =>
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false });

    this.aoMat = mat(AO_FRAG, {
      ...C,
      tDepth: { value: depth },
      uAo: { value: new THREE.Vector3(POST.aoRadius, POST.aoIntensity, POST.aoBias) },
    }, { AO_TAPS: POST.aoTaps });
    this.preMat = mat(PRE_FRAG, {
      ...C,
      tScene: { value: this.sceneTarget.texture },
      tDepth: { value: depth },
      tAo: { value: this.aoTarget.texture },
    });
    this.tileMat = mat(TILE_FRAG, { tPre: { value: this.preTarget.texture }, uHalfTexel: { value: new THREE.Vector2() } });
    this.gatherMat = mat(GATHER_FRAG, {
      tPre: { value: this.preTarget.texture },
      tTile: { value: this.tileTarget.texture },
      uTexel: C.uTexel,
      uTileTexel: { value: new THREE.Vector2() },
      uTaps: { value: vogelTaps(POST.dofTaps) },
      uBoost: { value: POST.highlightBoost },
    }, { DOF_TAPS: POST.dofTaps });
    this.fillMat = mat(FILL_FRAG, {
      tGather: { value: this.gatherTarget.texture },
      tPre: { value: this.preTarget.texture },
      uTexel: C.uTexel,
      uFill: { value: new THREE.Vector2(1.9 / Math.sqrt(POST.dofTaps), POST.maxBlurPx) },
    });
    this.bloomDownMat = mat(BLOOM_DOWN_FRAG, {
      tSrc: { value: this.preTarget.texture },
      uHalfTexel: { value: new THREE.Vector2() },
      uThreshold: { value: POST.bloomThreshold },
    });
    this.blurMat = mat(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.compositeMat = mat(COMPOSITE_FRAG, {
      ...C,
      tScene: { value: this.sceneTarget.texture },
      tDepth: { value: depth },
      tBlur: { value: this.fillTarget.texture },
      tBloom: { value: this.bloomA.texture },
      tSpill: { value: this.spillA.texture },
      tAo: { value: this.aoTarget.texture },
      uTone: { value: new THREE.Vector4(POST.exposure, POST.contrast, POST.saturation, POST.shadowLift) },
      uShadowTint: { value: new THREE.Color() },
      uTint: { value: new THREE.Vector3(...POST.tint) },
      uLens: { value: new THREE.Vector4(POST.vignette, POST.grain, POST.grainSize, POST.chroma) },
      uVignetteColor: { value: new THREE.Color() },
      uFx: { value: new THREE.Vector4(POST.bloom, POST.rim, POST.rimPx, 0) },
      uSharpen: { value: POST.sharpen },
      uSpill: { value: POST.spill },
      uRimColor: { value: new THREE.Color(POST.rimColor) },
    });
    this.setLook(look, 0);
  }

  /**
   * look: the biome's look by day and by night (render/biome-look.ts); night: 0 day .. 1 night; blends every term of
   * the look toward the night set, and pre-compensates the surround, the
   * haze and the vignette's colour for the tone curve at the normal framing (the vignette's and the haze's come out
   * their colour on screen; the surround is then hazed like any far pixel). It works in NIGHT_STEPS steps: the colours
   * move by a fraction of a percent between two, and each step costs three tone inversions.
   */
  setLook(biome: BiomeLook, amount: number): void {
    const night = Math.round(amount * NIGHT_STEPS) / NIGHT_STEPS;
    if (night === this.night && biome.version === this.version) return;
    this.night = night;
    this.version = biome.version;
    const D = biome.day;
    const N = biome.night;
    const mix = (day: number, nightValue: number) => day + (nightValue - day) * night;
    const tween = (out: THREE.Color, day: THREE.Color, nightColour: THREE.Color) => out.copy(day).lerp(nightColour, night);
    const C = this.common;
    const u = this.compositeMat.uniforms;
    const L = this.look;
    L.exposure = mix(D.exposure, N.exposure);
    L.goboKey = mix(D.gobo.key, N.gobo.key);
    L.fadeStart = mix(D.fade.start, N.fade.start);
    L.fadeEnd = mix(D.fade.end, N.fade.end);
    L.focusBand = mix(D.focusBand, N.focusBand);
    C.uDofC.value.x = mix(D.farGain, N.farGain);
    L.maxBlurPx = mix(POST.maxBlurPx, NIGHT.maxBlurPx);
    C.uDofB.value.w = mix(POST.nearGain, NIGHT.nearGain);

    const tone = u.uTone.value as THREE.Vector4;
    tone.y = mix(D.contrast, N.contrast);
    tone.z = mix(D.saturation, N.saturation);
    tone.w = mix(POST.shadowLift, NIGHT.shadowLift);
    const tint = u.uTint.value as THREE.Vector3;
    tint.set(mix(D.tint[0], N.tint[0]), mix(D.tint[1], N.tint[1]), mix(D.tint[2], N.tint[2]));
    // (the shadow tint is added after the tone curve, as an sRGB colour)
    tween(u.uShadowTint.value as THREE.Color, D.shadowTint, N.shadowTint).convertLinearToSRGB();
    u.uLens.value.x = mix(D.vignette, N.vignette);
    u.uLens.value.y = mix(POST.grain, NIGHT.grain);
    u.uFx.value.x = mix(POST.bloom, NIGHT.bloom);
    u.uFx.value.y = mix(POST.rim, NIGHT.rim);
    u.uSpill.value = mix(POST.spill, NIGHT.spill);
    this.bloomDownMat.uniforms.uThreshold.value = mix(POST.bloomThreshold, NIGHT.bloomThreshold);
    (this.aoMat.uniforms.uAo.value as THREE.Vector3).set(mix(POST.aoRadius, NIGHT.aoRadius), mix(POST.aoIntensity, NIGHT.aoIntensity), POST.aoBias);
    tween(C.uAoTint.value, D.aoTint, N.aoTint);
    C.uDofC.value.y = mix(D.greenPull, N.greenPull);
    C.uDofC.value.z = mix(D.split, N.split);
    C.uGobo2.value.x = mix(D.gobo.tint, N.gobo.tint);
    C.uGobo2.value.w = mix(POST.fade.amount, NIGHT.fade.amount);

    const P: Tone = { exposure: L.exposure, contrast: tone.y, saturation: tone.z, tint };
    inverseTone(tween(this._c, D.background, N.background), P, this.background);
    inverseTone(tween(this._c, D.fade.color, N.fade.color), P, C.uFade.value);
    inverseTone(blend(this._c, VIGNETTE, night), P, u.uVignetteColor.value as THREE.Color);
  }

  /**
   * Drifts the cloud shadows on with the wind round the ship or the captain (fx, fz); they are gone at night (0..1).
   */
  driftClouds(dt: number, fx: number, fz: number, windX: number, windZ: number, night: number): void {
    this.clouds.update(dt, fx, fz, windX, windZ, night);
  }

  /** The world point the lens focuses on (the ship). */
  setFocus(p: THREE.Vector3): void {
    this.focusWorld.copy(p);
  }

  setSize(width: number, height: number): void {
    const dpr = this.renderer.getPixelRatio();
    const W = Math.round(width * dpr);
    const H = Math.round(height * dpr);
    this.height = H;
    this.sceneTarget.setSize(W, H);
    const hw = Math.ceil(W / 2);
    const hh = Math.ceil(H / 2);
    this.aoTarget.setSize(hw, hh);
    this.preTarget.setSize(hw, hh);
    this.gatherTarget.setSize(hw, hh);
    this.fillTarget.setSize(hw, hh);
    const tw = Math.ceil(W / 8);
    const th = Math.ceil(H / 8);
    this.tileTarget.setSize(tw, th);
    (this.tileMat.uniforms.uHalfTexel.value as THREE.Vector2).set(1 / hw, 1 / hh);
    (this.gatherMat.uniforms.uTileTexel.value as THREE.Vector2).set(1 / tw, 1 / th);
    // the bloom and spill sizes: a half and an eighth of the half-res buffers
    this.bloomA.setSize(Math.max(1, hw >> 1), Math.max(1, hh >> 1));
    this.bloomB.setSize(Math.max(1, hw >> 1), Math.max(1, hh >> 1));
    this.spillA.setSize(Math.max(1, hw >> 3), Math.max(1, hh >> 3));
    this.spillB.setSize(Math.max(1, hw >> 3), Math.max(1, hh >> 3));
    this.common.uTexel.value.set(1 / W, 1 / H);
    (this.bloomDownMat.uniforms.uHalfTexel.value as THREE.Vector2).set(1 / hw, 1 / hh);
    const lens = this.compositeMat.uniforms.uLens.value as THREE.Vector4;
    // the grain's cell grows with the picture (grainSize px at 900 px high, never under 1 px), the edge
    // chroma is chroma px at 1080 px high
    lens.z = Math.max(1, (POST.grainSize * H) / 900);
    lens.w = (POST.chroma * H) / 1080;
  }

  /** time: the game clock (s): the film grain is drawn from it. */
  render(time: number): void {
    const r = this.renderer;
    const cam = this.camera;
    const C = this.common;
    const H = this.height;
    const u = this.compositeMat.uniforms;

    // per-frame uniforms: projection, focus depth + screen height, camera, key axis
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    C.uProj.value.set(cam.near, cam.far, tanHalf, cam.aspect);
    cam.updateMatrixWorld();
    C.uCamWorld.value.copy(cam.matrixWorld);
    // the focus: the focus point's view depth and screen height; the depth scale turns a depth difference into a share
    // of the frame height for the camera's tilt, and a close camera keeps a taller band sharp
    this._v.copy(this.focusWorld).applyMatrix4(cam.matrixWorldInverse);
    const fz = Math.max(0.01, -this._v.z);
    const fy = 0.5 + (0.5 * this._v.y) / (fz * tanHalf);
    const e = cam.matrixWorld.elements;
    const sinP = Math.min(0.9999, Math.max(0.05, e[9]));
    const cot = Math.max(0.1, Math.sqrt(1 - sinP * sinP) / sinP);
    const dof = C.uDofA.value;
    dof.x = fz;
    dof.y = Math.min(0.9, Math.max(0.1, fy));
    dof.z = Math.min(MAX_DEPTH_SCALE, 1 / (2 * Math.atan(tanHalf) * cot));
    const bandScale = Math.min(POST.closeBandScale, Math.max(1, POST.closeBandFrom / fz));
    const blurPx = (this.look.maxBlurPx * H) / 1080;
    C.uDofB.value.x = (this.look.focusBand * bandScale) / 2;
    C.uDofB.value.z = blurPx;
    (this.fillMat.uniforms.uFill.value as THREE.Vector2).y = blurPx;
    C.uFocusW.value.copy(this.focusWorld);
    // the world falloff, scaled with the focus distance: the gobo follows the camera's right and spans the
    // visible width; in macro framing (POST.macro) its key falloff relaxes and the exposure stops down a little
    const closeT = clamp((POST.macro[1] - fz) / (POST.macro[1] - POST.macro[0]), 0, 1);
    const rl = Math.hypot(e[0], e[2]) || 1;
    const goboRadius = Math.max(POST.gobo.minRadius, POST.gobo.radius * Math.min(POST.framingScale[1], fz / POST.framing));
    C.uGobo.value.set(e[0] / rl, e[2] / rl, 1 / goboRadius, this.look.goboKey * (1 - POST.gobo.closeRelief * closeT));
    const ks = clamp(fz / POST.framing, POST.framingScale[0], POST.framingScale[1]);
    C.uGobo2.value.y = this.look.fadeStart * ks;
    C.uGobo2.value.z = this.look.fadeEnd * ks;
    u.uTone.value.x = this.look.exposure * (1 + (POST.closeExposure - 1) * closeT);
    // the die-cut edge: wider on a tall picture and in a close frame
    const rc = POST.rimClose;
    u.uFx.value.z = POST.rimPx * Math.max(1, H / 900) * (1 + (rc.widen - 1) * smoothstep(rc.from, rc.to, fz));
    // the grain seed: a new pattern every 60th of a second of game time, 1024 of them
    u.uFx.value.w = Math.floor(time * 60) % 1024;

    r.setRenderTarget(this.sceneTarget);
    r.render(this.scene, cam);

    this.pass(this.aoMat, this.aoTarget);
    this.pass(this.preMat, this.preTarget);
    this.pass(this.tileMat, this.tileTarget);
    this.pass(this.gatherMat, this.gatherTarget);
    this.pass(this.fillMat, this.fillTarget);

    // bloom: quarter-res threshold, then H + V blur (B -> A)
    this.pass(this.bloomDownMat, this.bloomA);
    this.blur(this.bloomA, this.bloomB, this.bloomA, 1);
    // spill: three ever wider blurs of the bloom at 1/16 res (1.7 x wider pools each step)
    if (u.uSpill.value > 0) {
      let src = this.bloomA;
      for (let i = 0; i < 3; i++) {
        this.blur(src, this.spillB, this.spillA, 1.7 + i * 1.5);
        src = this.spillA;
      }
    }

    this.pass(this.compositeMat, null);
  }

  /** Separable gaussian: src -> (horizontal) -> mid -> (vertical) -> out, k texels of out per tap step. */
  private blur(src: THREE.WebGLRenderTarget, mid: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, k: number): void {
    const b = this.blurMat.uniforms;
    b.tSrc.value = src.texture;
    (b.uDir.value as THREE.Vector2).set(k / out.width, 0);
    this.pass(this.blurMat, mid);
    b.tSrc.value = mid.texture;
    (b.uDir.value as THREE.Vector2).set(0, k / out.height);
    this.pass(this.blurMat, out);
  }

  private pass(material: THREE.ShaderMaterial, out: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(out);
    this.renderer.render(this.quadScene, this.quadCamera);
  }
}
