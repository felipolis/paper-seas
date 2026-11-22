/**
 * Planar mirror of the world in the sea: the scene is rendered (at half resolution, at most MAX_WIDTH wide) from the
 * main camera mirrored below the water plane; the sea shader projects its own position into this image (matrix) and
 * shows it rippled and tinted. Everything under the surface is cut away by an oblique near plane on the water (not
 * by clipping planes, which would compile a second variant of every material and slow every one of them down).
 *
 * Materials in mirrorSkip are left out of the mirror: the printed tops of the land's paper layers. A ray reflected
 * up off the water meets a layer's cut wall before it could reach its top, so the tops never show in the sea, and
 * they are most of the pixels the mirror would otherwise shade.
 */
import * as THREE from 'three';

/** Materials never drawn in the mirror (see above). */
export const mirrorSkip = new Set<THREE.Material>();

const _target = new THREE.Vector3();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const UP = new THREE.Vector3(0, 1, 0);
/** The mirror is rippled and tinted: it never needs more than this many pixels across. */
const MAX_WIDTH = 1024;
/** Height of the water plane cut (just above the sea, so flat things lying on it are not mirrored). */
const CLIP_Y = 0.012;
const _dir = new THREE.Vector3();

export class Reflection {
  readonly target: THREE.WebGLRenderTarget;
  /** World position -> mirror image uv (with w), for the sea shader. */
  readonly matrix = new THREE.Matrix4();
  private readonly camera = new THREE.PerspectiveCamera();
  private readonly bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  constructor(private readonly scale = 0.5) {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  }

  setSize(width: number, height: number): void {
    const s = Math.min(this.scale, MAX_WIDTH / Math.max(1, width));
    this.target.setSize(Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s)));
  }

  /** Renders the mirror image; `hidden` objects (the sea itself) are left out. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, main: THREE.PerspectiveCamera, hidden: THREE.Object3D[]): void {
    const cam = this.camera;
    cam.copy(main);
    main.getWorldDirection(_dir);
    _target.copy(main.position).add(_dir);
    cam.position.set(main.position.x, -main.position.y, main.position.z);
    cam.up.set(0, -1, 0);
    cam.lookAt(_target.x, -_target.y, _target.z);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    obliqueNearPlane(cam, CLIP_Y);
    this.matrix.copy(this.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    const was = hidden.map((o) => o.visible);
    hidden.forEach((o) => { o.visible = false; });
    for (const m of mirrorSkip) m.visible = false;
    // transparent background: alpha = where something is mirrored (the sea keeps its own colour elsewhere)
    const oldBg = scene.background;
    const oldClear = renderer.getClearColor(new THREE.Color());
    const oldAlpha = renderer.getClearAlpha();
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    renderer.setClearColor(oldClear, oldAlpha);
    scene.background = oldBg;
    hidden.forEach((o, i) => { o.visible = was[i]; });
    for (const m of mirrorSkip) m.visible = true;
  }
}

/** Replaces the camera's near plane by the world plane y = h (Lengyel's oblique frustum, as three's Reflector). */
function obliqueNearPlane(cam: THREE.PerspectiveCamera, h: number): void {
  _plane.set(UP, -h).applyMatrix4(cam.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const e = cam.projectionMatrix.elements;
  _q.set((Math.sign(_clip.x) + e[8]) / e[0], (Math.sign(_clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  _clip.multiplyScalar(2 / _clip.dot(_q));
  e[2] = _clip.x;
  e[6] = _clip.y;
  e[10] = _clip.z + 1;
  e[14] = _clip.w;
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}
