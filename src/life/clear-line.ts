/**
 * The clear line: a living piece fades away where it would come between the camera and the one we follow (the
 * captain or the ship), and close to the lens, where the bokeh would blow it up into a big pale disc. One shared
 * line, set once a frame.
 */
import * as THREE from 'three';
import { smoothstep } from '../core/math';

/** Pieces within this band of the line fade away (0.24 -> 0.42). */
const BAND: [number, number] = [0.24, 0.42];
/** ...and pieces nearer the lens than this (2.2 -> 5). */
const LENS: [number, number] = [2.2, 5];
/** The line ends at this height (the captain's head, which the camera looks at), above the focus point. */
const HEAD = 0.4;


export class ClearLine {
  private readonly eye = new THREE.Vector3();
  /** The unit direction from the eye to the head, and the length of the line. */
  private readonly dir = new THREE.Vector3();
  private length = 0;

  update(camera: THREE.Camera, focusX: number, focusZ: number): void {
    camera.getWorldPosition(this.eye);
    this.dir.set(focusX - this.eye.x, HEAD - this.eye.y, focusZ - this.eye.z);
    this.length = this.dir.length();
    this.dir.divideScalar(this.length || 1);
  }

  /** 1 where a piece at (x, y, z) is clear of the line and the lens, easing to 0 on them. */
  k(x: number, y: number, z: number): number {
    const rx = x - this.eye.x;
    const ry = y - this.eye.y;
    const rz = z - this.eye.z;
    const lens = smoothstep(LENS[0], LENS[1], Math.hypot(rx, ry, rz));
    const t = rx * this.dir.x + ry * this.dir.y + rz * this.dir.z;
    if (t < 0 || t > this.length + 0.1) return lens;
    const off = Math.hypot(rx - this.dir.x * t, ry - this.dir.y * t, rz - this.dir.z * t);
    return lens * smoothstep(BAND[0], BAND[1], off);
  }
}
