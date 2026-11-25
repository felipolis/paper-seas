/**
 * The click-to-walk target mark: a hand-inked dashed ring with a small cross, one flat mesh printed on the page where
 * he is walking to. It inks in over 0.1 s, each stamp at its own angle, and fades away once he gets there or the walk
 * is let go.
 */
import * as THREE from 'three';
import { CLICK_WALK } from '../config/player';
import { PALETTE } from '../config/palette';
import { mulberry32 } from '../core/rng';

/** The ring's dashes, the strokes in each, and its stroke width (share of the radius). */
const DASHES = 9;
const DASH_SEGMENTS = 3;
const STROKE = 0.085;
/** How long it takes to ink in (s), and its lift off the ground (u). */
const INK_IN = 0.1;
const LIFT = 0.012;

export class TargetMark {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  /** Seconds since it was stamped, and since it began to fade (null: still wanted). */
  private age = 0;
  private fading: number | null = null;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      color: PALETTE.ink,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(markGeometry(CLICK_WALK.markSize), this.material);
    this.mesh.name = 'target-mark';
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
  }

  /** Printed at (x, y, z) on the ground (inks in again unless it is already showing). */
  stamp(x: number, y: number, z: number): void {
    this.mesh.position.set(x, y + LIFT, z);
    this.mesh.rotation.y = (((x * 12.9898 + z * 78.233) % 1) + 1) % 1 * Math.PI;
    if (!this.mesh.visible || this.fading !== null) this.age = 0;
    this.fading = null;
    this.mesh.visible = true;
  }

  /** Starts it fading away. */
  fade(): void {
    if (this.mesh.visible && this.fading === null) this.fading = 0;
  }

  /** Hidden at once (he went back aboard). */
  hide(): void {
    this.mesh.visible = false;
    this.fading = null;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    this.age += dt;
    let o = Math.min(1, this.age / INK_IN);
    if (this.fading !== null) {
      this.fading += dt;
      o *= Math.max(0, 1 - this.fading / CLICK_WALK.markFade);
      if (o <= 0) this.hide();
    }
    this.material.opacity = o * CLICK_WALK.markOpacity;
  }
}

/** The dashed ring and its cross, as triangles lying flat (normal up). */
function markGeometry(radius: number): THREE.BufferGeometry {
  const rng = mulberry32(0x1a7e5);
  const pos: number[] = [];
  // a stroke from a to b, slightly wider at one end than the other
  const quad = (ax: number, az: number, bx: number, bz: number, w0: number, w1: number) => {
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / l;
    const nz = (bx - ax) / l;
    pos.push(
      ax + nx * w0, 0, az + nz * w0, bx + nx * w1, 0, bz + nz * w1, bx - nx * w1, 0, bz - nz * w1,
      ax + nx * w0, 0, az + nz * w0, bx - nx * w1, 0, bz - nz * w1, ax - nx * w0, 0, az - nz * w0,
    );
  };
  const stroke = radius * STROKE;
  for (let i = 0; i < DASHES; i++) {
    const a0 = (i / DASHES) * Math.PI * 2 + (rng() - 0.5) * 0.12;
    const span = ((Math.PI * 2) / DASHES) * (0.5 + rng() * 0.16);
    const r0 = radius * (0.96 + rng() * 0.08);
    for (let s = 0; s < DASH_SEGMENTS; s++) {
      const u0 = a0 + (span * s) / DASH_SEGMENTS;
      const u1 = a0 + (span * (s + 1)) / DASH_SEGMENTS;
      const ra = r0 * (1 + (rng() - 0.5) * 0.03);
      const rb = r0 * (1 + (rng() - 0.5) * 0.03);
      quad(Math.cos(u0) * ra, Math.sin(u0) * ra, Math.cos(u1) * rb, Math.sin(u1) * rb, stroke * (0.75 + rng() * 0.5), stroke * (0.75 + rng() * 0.5));
    }
  }
  const c = radius * 0.2;
  quad(-c, -c * 0.9, c, c * 1.05, stroke * 0.9, stroke * 0.7);
  quad(-c * 0.95, c, c * 1.05, -c * 0.9, stroke * 0.8, stroke * 0.95);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}
