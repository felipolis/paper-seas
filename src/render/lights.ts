/**
 * The light rig: a key light from screen-left that casts the soft PCSS shadows, a fill from the right and a
 * hemisphere ambient. Key and fill are aimed relative to the camera, and the key's shadow frustum is fitted to the
 * camera's footprint on the page every frame (its centre snapped to shadow texels, so the shadows do not shimmer). Colours, intensities and angles are set by the day / night look (render/day-night.ts).
 */
import * as THREE from 'three';
import { LIGHTS } from '../config/view';
import { DEG } from '../core/math';
import { SHADOW } from './shadows';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class Lights {
  readonly group = new THREE.Group();
  readonly key: THREE.DirectionalLight;
  readonly fill: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** Key and fill angles (deg); azimuth 0 = from the camera side, negative = from screen-left. */
  keyAzimuth: number = LIGHTS.key.azimuthDeg;
  keyElevation: number = LIGHTS.key.elevationDeg;
  fillElevation: number = LIGHTS.fill.elevationDeg;
  /** Current half size of the shadow frustum (world). */
  private extent = -1;
  private readonly keyDir = new THREE.Vector3();
  private readonly fillDir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly lightRight = new THREE.Vector3();
  private readonly lightUp = new THREE.Vector3();

  constructor() {
    const L = LIGHTS;
    this.key = new THREE.DirectionalLight(L.key.color, L.key.intensity);
    this.key.castShadow = true;
    const s = this.key.shadow;
    s.mapSize.set(L.shadow.mapSize, L.shadow.mapSize);
    s.camera.near = SHADOW.near;
    s.camera.far = SHADOW.far;
    // the PCSS reads these stock uniforms as: radius = the shadow map's world size (follow()), bias = the light size
    s.bias = SHADOW.lightSize;
    s.normalBias = L.shadow.normalBias;
    this.fill = new THREE.DirectionalLight(L.fill.color, L.fill.intensity);
    this.hemi = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
    this.group.add(this.key, this.key.target, this.fill, this.fill.target, this.hemi);
  }

  /** The PCSS light size: penumbra width per unit of blocker distance (render/shadows.ts). */
  set lightSize(size: number) {
    this.key.shadow.bias = size;
  }

  /**
   * Aims key and fill from the camera and fits the key's shadow frustum to the page the camera sees. focus: the
   * camera's focus, the frame's centre should the camera ever look above the page.
   */
  follow(camera: THREE.PerspectiveCamera, focus: THREE.Vector3): void {
    const S = LIGHTS.shadow;
    // --- the camera's frame on the ground plane ---
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    this.right.set(e[0], 0, e[2]);
    this.up.set(e[4], 0, e[6]);
    this.fwd.set(-e[8], -e[9], -e[10]);
    const sinPitch = Math.min(1, Math.max(0.2, -this.fwd.y));
    // forward on the ground (the camera's up vector takes over when it looks straight down)
    this.back.set(-(this.fwd.x + this.up.x), 0, -(this.fwd.z + this.up.z));
    if (this.back.lengthSq() < 1e-8) this.back.set(0, 0, 1);
    this.back.normalize();
    if (this.right.lengthSq() < 1e-8) this.right.set(1, 0, 0);
    this.right.normalize();
    // the ground point at the centre of the screen
    this.eye.setFromMatrixPosition(camera.matrixWorld);
    let dist: number;
    if (this.fwd.y < -0.05) {
      dist = Math.min(200, this.eye.y / -this.fwd.y);
      this.centre.copy(this.eye).addScaledVector(this.fwd, dist);
      this.centre.y = 0;
    } else {
      this.centre.set(focus.x, 0, focus.z);
      dist = this.eye.distanceTo(this.centre);
    }
    this.aim(this.keyDir, this.keyAzimuth, this.keyElevation);
    this.aim(this.fillDir, LIGHTS.fill.azimuthDeg, this.fillElevation);

    // --- key shadow frustum: fitted to the visible ground, its size quantised, its centre texel-snapped ---
    const fovTan = Math.tan((camera.fov * DEG) / 2);
    const halfW = dist * fovTan * camera.aspect;
    const halfD = (dist * fovTan) / sinPitch;
    const want = Math.min(S.maxExtent, Math.max(S.minExtent, Math.ceil((Math.max(halfW, halfD) * S.fit + S.pad) * 2) / 2));
    const sc = this.key.shadow.camera;
    if (want !== this.extent) {
      this.extent = want;
      sc.left = -want;
      sc.right = want;
      sc.top = want;
      sc.bottom = -want;
      sc.updateProjectionMatrix();
      this.key.shadow.radius = 2 * want;
    }
    const texel = (2 * this.extent) / S.mapSize;
    this.lightRight.crossVectors(WORLD_UP, this.keyDir).normalize();
    this.lightUp.crossVectors(this.keyDir, this.lightRight).normalize();
    const a = Math.round(this.centre.dot(this.lightRight) / texel) * texel;
    const b = Math.round(this.centre.dot(this.lightUp) / texel) * texel;
    this.key.target.position.set(0, 0, 0).addScaledVector(this.lightRight, a).addScaledVector(this.lightUp, b).addScaledVector(this.keyDir, this.centre.dot(this.keyDir));
    this.key.position.copy(this.key.target.position).addScaledVector(this.keyDir, S.distance);

    this.fill.target.position.copy(this.centre);
    this.fill.position.copy(this.centre).addScaledVector(this.fillDir, 30);
  }

  /** Direction toward a light at this azimuth / elevation (deg) in the camera's ground frame. */
  private aim(out: THREE.Vector3, azimuthDeg: number, elevationDeg: number): void {
    const az = azimuthDeg * DEG;
    const el = elevationDeg * DEG;
    out.copy(this.back).multiplyScalar(Math.cos(az) * Math.cos(el)).addScaledVector(this.right, Math.sin(az) * Math.cos(el));
    out.y = Math.sin(el);
    out.normalize();
  }
}
