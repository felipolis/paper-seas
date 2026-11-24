/**
 * A window of the shore-distance field around the ship, as a texture the sea shader reads (depth tones, shallows,
 * foam lapping at the beaches). It is recomputed a few rows per frame into a staging buffer whenever the ship has
 * moved far enough, then swapped in (the last step, the true-distance pass over the whole window, takes one frame).
 */
import * as THREE from 'three';
import type { LandField } from '../world/land';
import { trueDistance } from '../world/terrain';

const N = 192;
const CELL = 0.5;
const SIZE = N * CELL;
const RECENTRE = 14;
const ROWS_PER_FRAME = 3;
const FAR = 12;

export class DistanceMap {
  readonly texture: THREE.DataTexture;
  /** World position of texel (0, 0) and the world size covered (shader uniforms). */
  readonly origin = new THREE.Vector2();
  readonly size = SIZE;
  private readonly data = new Uint16Array(N * N);
  private readonly staging = new Float32Array(N * N);
  private stagingOrigin: [number, number] | null = null;
  private row = 0;
  private hasData = false;

  constructor(private readonly land: LandField) {
    this.texture = new THREE.DataTexture(this.data, N, N, THREE.RedFormat, THREE.HalfFloatType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.data.fill(THREE.DataUtils.toHalfFloat(FAR));
    this.texture.needsUpdate = true;
  }

  /** Computes the whole window at once (start of the voyage). */
  prime(x: number, z: number): void {
    this.begin(x, z);
    while (this.stagingOrigin) this.work(N);
  }

  update(x: number, z: number): void {
    const cx = this.origin.x + SIZE / 2;
    const cz = this.origin.y + SIZE / 2;
    if (!this.stagingOrigin && (!this.hasData || Math.hypot(x - cx, z - cz) > RECENTRE)) this.begin(x, z);
    if (this.stagingOrigin) this.work(ROWS_PER_FRAME);
  }

  private begin(x: number, z: number): void {
    const ox = Math.round(x / 4) * 4 - SIZE / 2;
    const oz = Math.round(z / 4) * 4 - SIZE / 2;
    this.stagingOrigin = [ox, oz];
    this.row = 0;
  }

  private work(rows: number): void {
    const [ox, oz] = this.stagingOrigin!;
    const end = Math.min(N, this.row + rows);
    for (let j = this.row; j < end; j++) {
      const z = oz + (j + 0.5) * CELL;
      for (let i = 0; i < N; i++) {
        const d = this.land.distance(ox + (i + 0.5) * CELL, z);
        this.staging[j * N + i] = Math.max(-3, Math.min(FAR, d));
      }
    }
    this.row = end;
    if (this.row >= N) {
      // true distances (see trueDistance): the shallows only print where land really is near
      const t = trueDistance(this.staging, N, CELL);
      for (let k = 0; k < t.length; k++) this.data[k] = THREE.DataUtils.toHalfFloat(Math.max(-3, Math.min(FAR, t[k])));
      this.origin.set(ox, oz);
      this.texture.needsUpdate = true;
      this.stagingOrigin = null;
      this.hasData = true;
    }
  }
}
