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
import { POST, NIGHT } from '../config/view';
import { clamp } from '../core/math';
import { CloudShadows } from './cloud-shadows';
import { AO_FRAG, BLOOM_DOWN_FRAG, BLUR_FRAG, COMPOSITE_FRAG, FILL_FRAG, GATHER_FRAG, PRE_FRAG, TILE_FRAG, VERT } from './post-shaders';

/** papertrails' reference framing: the focus 17 units from the camera (the gobo and the haze scale from it). */
const FRAMING = 17;

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

// ---- papertrails' JS mirror of the tone curve, to pre-compensate colours that must come out exact on screen ----
interface Tone {
  exposure: number;
  contrast: number;
  saturation: number;
  tint: THREE.Vector3;
}
const acesJS = (x: number) => clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1);
const toSRGBJS = (c: number) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
/** The composite's tone curve at the centre of the frame (no vignette, grain or shadow lift). */
function toneJS(rgb: number[], P: Tone): number[] {
  const t = rgb.map((v, i) => acesJS(v * P.exposure * P.tint.getComponent(i)));
  const l = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  return t.map((v) => (toSRGBJS(Math.max(0, l + (v - l) * P.saturation)) - 0.42) * P.contrast + 0.42);
}
const _srgb = { r: 0, g: 0, b: 0 };
/** The linear scene colour whose tone-mapped result is the given colour (papertrails' inverseTone). */
function inverseTone(colour: THREE.Color, P: Tone, out: THREE.Color): THREE.Color {
  colour.getRGB(_srgb, THREE.SRGBColorSpace);
  const want = [_srgb.r, _srgb.g, _srgb.b];
  const x = [0.02, 0.02, 0.02];
  for (let it = 0; it < 60; it++) {
    const got = toneJS(x, P);
    for (let i = 0; i < 3; i++) {
      const ratio = (want[i] + 0.02) / (Math.max(got[i], -0.015) + 0.02);
      x[i] = clamp(x[i] * Math.pow(ratio, 0.8), 1e-5, 8);
    }
  }
  return out.setRGB(x[0], x[1], x[2], THREE.LinearSRGBColorSpace);
}

type Pair = readonly [day: THREE.Color, night: THREE.Color];
/** A day colour and its night colour, blended in linear RGB as papertrails blends them. */
const pair = (day: string, night: string): Pair => [new THREE.Color(day), new THREE.Color(night)];
const COLOURS = {
  background: pair(POST.background, NIGHT.background),
  fadeLeft: pair(POST.fade.color, NIGHT.fade.color),
  fadeRight: pair(POST.fade.colorRight, NIGHT.fade.colorRight),
  shadowTint: pair(POST.shadowTint, NIGHT.shadowTint),
  aoTint: pair(POST.aoTint, NIGHT.aoTint),
};

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

  /** papertrails' cloud shadows (their uniforms are shared by the passes that grade the world). */
  private readonly clouds = new CloudShadows();
  /** Uniforms shared by every pass that reads depth (the day / night values are set by setNight()). */
  private readonly common = {
    uProj: { value: new THREE.Vector4(1, 100, 0.23, 1.78) },
    uDofA: { value: new THREE.Vector4(18, 0.5, 2.7, POST.depthWeight) },
    uDofB: { value: new THREE.Vector4(POST.focusBand / 2, POST.ramp, POST.maxBlurPx, POST.nearGain) },
    uDofC: { value: new THREE.Vector4(POST.farGain, 1, POST.greenPull, POST.split) },
    uCamWorld: { value: new THREE.Matrix4() },
    uFocusW: { value: new THREE.Vector3() },
    uGobo: { value: new THREE.Vector4(1, 0, 1 / POST.gobo.radius, POST.gobo.key) },
    uGobo2: { value: new THREE.Vector4(POST.gobo.tint, POST.fade.start, POST.fade.end, POST.fade.amount) },
    uFadeA: { value: new THREE.Color() },
    uFadeB: { value: new THREE.Color() },
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
  private readonly look: Record<'exposure' | 'maxBlurPx' | 'goboKey' | 'fadeStart' | 'fadeEnd', number> = { exposure: POST.exposure, maxBlurPx: POST.maxBlurPx, goboKey: POST.gobo.key, fadeStart: POST.fade.start, fadeEnd: POST.fade.end };
  private readonly focusWorld = new THREE.Vector3();
  private readonly _v = new THREE.Vector3();
  private readonly _c = new THREE.Color();
  private height = 1;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera) {
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
      uFx: { value: new THREE.Vector4(POST.bloom, POST.rim, POST.rimPx, 0) },
      uSharpen: { value: POST.sharpen },
      uSpill: { value: POST.spill },
      uRimColor: { value: new THREE.Color(POST.rimColor) },
    });
    this.setNight(0);
  }

  /**
   * night: 0 day .. 1 night; blends every term of the look toward papertrails' night (NIGHT_BASE), and pre-compensates
   * the surround and the haze for the tone curve so they come out exactly their colour on screen.
   */
  setNight(night: number): void {
    if (night === this.night) return;
    this.night = night;
    const mix = (day: number, nightValue: number) => day + (nightValue - day) * night;
    const blend = (out: THREE.Color, [day, nightColour]: Pair) => out.copy(day).lerp(nightColour, night);
    const C = this.common;
    const u = this.compositeMat.uniforms;
    const L = this.look;
    L.exposure = mix(POST.exposure, NIGHT.exposure);
    L.maxBlurPx = mix(POST.maxBlurPx, NIGHT.maxBlurPx);
    L.goboKey = mix(POST.gobo.key, NIGHT.gobo.key);
    L.fadeStart = mix(POST.fade.start, NIGHT.fade.start);
    L.fadeEnd = mix(POST.fade.end, NIGHT.fade.end);

    const tone = u.uTone.value as THREE.Vector4;
    tone.y = mix(POST.contrast, NIGHT.contrast);
    tone.z = mix(POST.saturation, NIGHT.saturation);
    tone.w = mix(POST.shadowLift, NIGHT.shadowLift);
    const tint = u.uTint.value as THREE.Vector3;
    tint.set(mix(POST.tint[0], NIGHT.tint[0]), mix(POST.tint[1], NIGHT.tint[1]), mix(POST.tint[2], NIGHT.tint[2]));
    // (papertrails adds its shadow tint after the tone curve, as an sRGB colour)
    blend(u.uShadowTint.value as THREE.Color, COLOURS.shadowTint).convertLinearToSRGB();
    u.uLens.value.x = mix(POST.vignette, NIGHT.vignette);
    u.uLens.value.y = mix(POST.grain, NIGHT.grain);
    u.uFx.value.x = mix(POST.bloom, NIGHT.bloom);
    u.uFx.value.y = mix(POST.rim, NIGHT.rim);
    u.uSpill.value = mix(POST.spill, NIGHT.spill);
    this.bloomDownMat.uniforms.uThreshold.value = mix(POST.bloomThreshold, NIGHT.bloomThreshold);
    (this.aoMat.uniforms.uAo.value as THREE.Vector3).set(mix(POST.aoRadius, NIGHT.aoRadius), mix(POST.aoIntensity, NIGHT.aoIntensity), POST.aoBias);
    blend(C.uAoTint.value, COLOURS.aoTint);
    C.uDofB.value.w = mix(POST.nearGain, NIGHT.nearGain);
    C.uDofC.value.z = mix(POST.greenPull, NIGHT.greenPull);
    C.uDofC.value.w = mix(POST.split, NIGHT.split);
    C.uGobo2.value.x = mix(POST.gobo.tint, NIGHT.gobo.tint);
    C.uGobo2.value.w = mix(POST.fade.amount, NIGHT.fade.amount);

    const P: Tone = { exposure: L.exposure, contrast: tone.y, saturation: tone.z, tint };
    inverseTone(blend(this._c, COLOURS.background), P, this.background);
    inverseTone(blend(this._c, COLOURS.fadeLeft), P, C.uFadeA.value);
    inverseTone(blend(this._c, COLOURS.fadeRight), P, C.uFadeB.value);
  }

  /** Drifts the cloud shadows on with the wind round the traveller (fx, fz); they are gone at night (0..1). */
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
    // papertrails' bloom and spill sizes: a half and an eighth of the half-res buffers
    this.bloomA.setSize(Math.max(1, hw >> 1), Math.max(1, hh >> 1));
    this.bloomB.setSize(Math.max(1, hw >> 1), Math.max(1, hh >> 1));
    this.spillA.setSize(Math.max(1, hw >> 3), Math.max(1, hh >> 3));
    this.spillB.setSize(Math.max(1, hw >> 3), Math.max(1, hh >> 3));
    this.common.uTexel.value.set(1 / W, 1 / H);
    (this.bloomDownMat.uniforms.uHalfTexel.value as THREE.Vector2).set(1 / hw, 1 / hh);
    const lens = this.compositeMat.uniforms.uLens.value as THREE.Vector4;
    // papertrails: the grain's cell grows with the picture (grainSize px at 900 px high, never under 1 px), the edge
    // chroma is chroma px at 1080 px high
    lens.z = Math.max(1, (POST.grainSize * H) / 900);
    lens.w = (POST.chroma * H) / 1080;
  }

  /** time: the game clock (s): the film grain is drawn from it, as papertrails draws it from state.time. */
  render(time: number): void {
    const r = this.renderer;
    const cam = this.camera;
    const C = this.common;
    const H = this.height;
    const u = this.compositeMat.uniforms;

    // per-frame uniforms: projection, focus depth + screen height, camera, key axis
    C.uProj.value.set(cam.near, cam.far, Math.tan((cam.fov * Math.PI) / 360), cam.aspect);
    cam.updateMatrixWorld();
    C.uCamWorld.value.copy(cam.matrixWorld);
    // papertrails' focus: the focus point's view depth and screen height; kD turns a depth difference into a share of
    // the frame height for the camera's tilt, and a close camera keeps a taller band sharp
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    this._v.copy(this.focusWorld).applyMatrix4(cam.matrixWorldInverse);
    const fz = Math.max(0.01, -this._v.z);
    const fy = 0.5 + (0.5 * this._v.y) / (fz * tanHalf);
    const e = cam.matrixWorld.elements;
    const sinP = Math.min(0.9999, Math.max(0.05, e[9]));
    const cot = Math.max(0.1, Math.sqrt(1 - sinP * sinP) / sinP);
    C.uDofA.value.set(fz, Math.min(0.9, Math.max(0.1, fy)), Math.min(9, 1 / (2 * Math.atan(tanHalf) * cot)), POST.depthWeight);
    const bandScale = Math.min(POST.closeBandScale, Math.max(1, 12 / fz));
    const blurPx = (this.look.maxBlurPx * H) / 1080;
    C.uDofB.value.x = (POST.focusBand * bandScale) / 2;
    C.uDofB.value.z = blurPx;
    (this.fillMat.uniforms.uFill.value as THREE.Vector2).y = blurPx;
    C.uFocusW.value.copy(this.focusWorld);
    // papertrails' world falloff, scaled with the focus distance: the gobo follows the camera's right and spans the
    // visible width; in macro framing (closer than 8) its key falloff relaxes and the exposure stops down a little
    const closeT = clamp((8 - fz) / 4, 0, 1);
    const rl = Math.hypot(e[0], e[2]) || 1;
    C.uGobo.value.set(e[0] / rl, e[2] / rl, 1 / Math.max(0.5, POST.gobo.radius * Math.min(3, fz / FRAMING)), this.look.goboKey * (1 - POST.gobo.closeRelief * closeT));
    const ks = clamp(fz / FRAMING, 0.82, 3);
    C.uGobo2.value.y = this.look.fadeStart * ks;
    C.uGobo2.value.z = this.look.fadeEnd * ks;
    u.uTone.value.x = this.look.exposure * (1 + (POST.closeExposure - 1) * closeT);
    // papertrails' die-cut edge: wider on a tall picture and in a close frame
    u.uFx.value.z = POST.rimPx * Math.max(1, H / 900) * (fz < 9 ? 1.5 : 1);
    // papertrails' grain seed: a new pattern every 60th of a second of game time, 1024 of them
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
    // spill: three ever wider blurs of the bloom at 1/16 res (papertrails: 1.7 x wider pools each step)
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
