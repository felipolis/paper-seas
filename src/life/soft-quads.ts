/**
 * papertrails' soft quads (life/life.js there): premultiplied soft shapes that write no depth: mist cards and bird
 * shadows. Each piece has a colour and alpha, an opacity (1 = over, 0 = additive), a `front` flag (ground shadows are
 * pulled to the near plane, so they darken whatever stands on them) and a shape (0 = round falloff, 1 = a soft blob
 * with a wavy outline, its phase per piece).
 */
import * as THREE from 'three';
import { SOFT_PATCH_GLSL } from '../render/soft-patch';
import { hideMatrix, putMatrix } from './paper-bits';

const VERT = /* glsl */ `
attribute vec4 aCol;
attribute vec4 aPar;
varying vec4 vCol;
varying vec4 vPar;
varying vec2 vUv;
void main() {
  vCol = aCol;
  vPar = aPar;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  if (aPar.y > 0.5) gl_Position.z = -0.999 * gl_Position.w;
}`;

const FRAG = /* glsl */ `
varying vec4 vCol;
varying vec4 vPar;
varying vec2 vUv;
${SOFT_PATCH_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float a = vPar.w < 0.5 ? pow(max(0.0, 1.0 - length(p)), 2.2) : softPatch(p, vPar.z);
  a *= vCol.a;
  gl_FragColor = vec4(vCol.rgb * a, a * vPar.x);
}`;

export class SoftQuads {
  readonly mesh: THREE.InstancedMesh;
  private readonly col: THREE.InstancedBufferAttribute;
  private readonly par: THREE.InstancedBufferAttribute;

  /** phase: each piece's outline phase (0..1). */
  constructor(count: number, phase: (i: number) => number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.par = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.col.setUsage(THREE.DynamicDrawUsage);
    this.par.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) this.par.array[i * 4 + 2] = phase(i);
    geo.setAttribute('aCol', this.col);
    geo.setAttribute('aPar', this.par);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.InstancedMesh(geo, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    const A = this.mesh.instanceMatrix.array;
    A.fill(0);
    for (let i = 0; i < count; i++) A[i * 16 + 15] = 1;
  }

  /** Places piece i (yaw / pitch as putMatrix, no roll) with its colour, alpha, opacity, front flag and shape. */
  put(i: number, x: number, y: number, z: number, yaw: number, pitch: number, sx: number, sy: number, color: THREE.Color, alpha: number, opacity: number, front: number, shape: number): void {
    putMatrix(this.mesh.instanceMatrix.array, i, x, y, z, yaw, pitch, 0, sx, sy);
    const c = this.col.array;
    const p = this.par.array;
    const o = i * 4;
    c[o] = color.r;
    c[o + 1] = color.g;
    c[o + 2] = color.b;
    c[o + 3] = alpha;
    p[o] = opacity;
    p[o + 1] = front;
    p[o + 3] = shape;
  }

  hide(i: number): void {
    hideMatrix(this.mesh.instanceMatrix.array, i);
    this.col.array[i * 4 + 3] = 0;
  }

  /** Uploads this frame's pieces. */
  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.col.needsUpdate = true;
    this.par.needsUpdate = true;
  }
}
