/**
 * The ship's cloth: square sails that roll down from their yards and belly out with the wind, head sails that
 * unfurl along their stay, and the black flag streaming downwind. Setting and furling run on the same paper
 * springs as every pop-up (so a sail snaps open, overshoots a touch and settles), the billow is a smoothed
 * response to the wind actually filling the sail.
 */
import * as THREE from 'three';
import { POPUP } from '../config/popup';
import { clamp } from '../core/math';
import { Flap, flapConstants } from '../popup/spring';
import { createPaperMaterial } from '../render/paper-material';
import { PALETTE } from '../config/palette';
import type { CardArt } from '../art/card-painter';
import type { SailCorners } from '../config/ships';

const clothMaterials = new WeakMap<CardArt, THREE.MeshLambertMaterial>();
function clothMaterial(art: CardArt): THREE.MeshLambertMaterial {
  let m = clothMaterials.get(art);
  if (!m) {
    // cloth: printed on both faces, softer fibre
    m = createPaperMaterial({ map: art.texture, back: null });
    clothMaterials.set(art, m);
  }
  return m;
}

/** Grid geometry over a card's rectangle with UVs; positions are rewritten every frame by the cloth. */
function gridGeometry(nx: number, ny: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const count = (nx + 1) * (ny + 1);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const uv = new Float32Array(count * 2);
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i;
      uv[k * 2] = i / nx;
      uv[k * 2 + 1] = j / ny;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const index: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  g.setIndex(index);
  return g;
}

/** The wind on the sails this frame. */
export interface ClothWind {
  /** How full the sails are, 0..1 (0 = slack), and how much a slack sail shivers, 0..1. */
  fill: number;
  luff: number;
  /** Which side the wind blows a sail set fore and aft to (+1 starboard, -1 port). */
  side: number;
  time: number;
}

/** Shared furl/set spring behaviour of every sail. */
abstract class Cloth {
  readonly flap: Flap;
  protected billow = 0;

  constructor(size: number, seed: number) {
    this.flap = new Flap(flapConstants({ size, seed, wobble: 1.6, stiffness: 0.8 }));
  }

  /** Set (true) or furl (false) the sail after `delay` seconds. */
  set(on: boolean, delay = 0): void {
    this.flap.setTarget(on ? 1 : 0, delay);
  }

  /** How much of the sail is set (0 furled .. 1 fully set). */
  get area(): number {
    return clamp(this.flap.p, 0, 1);
  }

  abstract update(steps: number, alpha: number, dt: number, wind: ClothWind): void;

  protected advance(steps: number, alpha: number, billowTarget: number, dt: number): void {
    if (this.flap.active) for (let i = 0; i < steps; i++) this.flap.step(POPUP.step);
    this.flap.interpolate(alpha);
    this.billow += (billowTarget - this.billow) * (1 - Math.exp(-dt * 2.2));
  }
}

/**
 * A sail hanging from its yard: x across, y down from the yard (0) to the foot (-h), bellying out along -z: a square
 * sail across the ship bellies forward; a junk's battened sail, turned into the centre plane (foreAndAft), bellies to
 * whichever side the wind blows it.
 */
export class SquareSail extends Cloth {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly bundle: THREE.Mesh;
  private readonly baseX: Float32Array;
  private readonly baseY: Float32Array;
  private readonly nx = 10;
  private readonly ny = 8;
  /** Phase of its shiver (the sails of a ship do not shiver in step). */
  private readonly phase: number;

  constructor(art: CardArt, private readonly w: number, private readonly h: number, seed: number, private readonly foreAndAft: boolean) {
    super(h, seed);
    this.phase = seed * 2.3;
    const g = gridGeometry(this.nx, this.ny);
    const count = (this.nx + 1) * (this.ny + 1);
    this.baseX = new Float32Array(count);
    this.baseY = new Float32Array(count);
    for (let j = 0; j <= this.ny; j++) {
      for (let i = 0; i <= this.nx; i++) {
        const k = j * (this.nx + 1) + i;
        this.baseX[k] = art.left + (art.right - art.left) * (i / this.nx);
        this.baseY[k] = art.bottom + (art.top - art.bottom) * (j / this.ny);
      }
    }
    this.mesh = new THREE.Mesh(g, clothMaterial(art));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    // the furled sail: a roll of cloth lashed along the yard
    const roll = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
    roll.rotateZ(Math.PI / 2);
    this.bundle = new THREE.Mesh(roll, createPaperMaterial({ color: PALETTE.sailShade, back: null }));
    this.bundle.castShadow = true;
    this.bundle.position.set(0, -0.02, 0);
    this.group.add(this.bundle);
    this.flap.snap(0);
  }

  update(steps: number, alpha: number, dt: number, { fill, luff, side, time }: ClothWind): void {
    this.advance(steps, alpha, fill, dt);
    const out = this.foreAndAft ? side : 1;
    const r = clamp(0.04 + 0.96 * this.flap.p, 0.04, 1.06);
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const w = this.w;
    const h = this.h;
    const belly = 0.04 + 0.2 * this.billow;
    for (let k = 0; k < this.baseX.length; k++) {
      const x = this.baseX[k];
      const y0 = this.baseY[k];
      const down = clamp(-y0 / h, 0, 1);
      const across = clamp((2 * x) / w, -1, 1);
      // belly: deepest in the middle of the cloth, pinned at the yard, softer at the leeches
      let z = belly * (1 - 0.8 * across * across) * Math.sin(Math.PI * Math.min(1, down * 0.85 + 0.08));
      // a slack sail shivers
      z += luff * 0.035 * Math.sin(9 * x + (time + this.phase) * 11 + down * 4) * down;
      pos.setXYZ(k, x, y0 * r, -out * z * Math.min(1, r * 1.3));
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.visible = r > 0.06;
    const rollR = 0.012 + 0.032 * (1 - clamp(r, 0, 1));
    this.bundle.scale.set(this.w * 0.98, rollR, rollR);
    this.bundle.visible = r < 0.97;
  }
}

/**
 * A triangular sail in the ship's centre plane: a head sail on its stay (points in ship-body coordinates) or a lateen
 * on its yard (points in its mast's frame). It furls toward its luff (the stay, the yard).
 */
export class HeadSail extends Cloth {
  readonly mesh: THREE.Mesh;
  private readonly ns = 10;
  private readonly nq = 6;

  constructor(
    art: CardArt,
    private readonly tack: THREE.Vector3,
    private readonly head: THREE.Vector3,
    private readonly clew: THREE.Vector3,
    seed: number,
    corners: SailCorners,
  ) {
    super(head.y - tack.y, seed);
    const g = gridGeometry(this.ns, this.nq);
    // the sprite's triangle is mapped corner to corner, with the same (s, q) parametrisation as the cloth
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const [tu, tv] = corners.tack;
    const [hu, hv] = corners.head;
    const [cu, cv] = corners.clew;
    for (let j = 0; j <= this.nq; j++) {
      for (let i = 0; i <= this.ns; i++) {
        const k = j * (this.ns + 1) + i;
        const sAlong = i / this.ns;
        const q = (j / this.nq) * (1 - sAlong);
        uv.setXY(k, tu + (hu - tu) * sAlong + (cu - tu) * q, tv + (hv - tv) * sAlong + (cv - tv) * q);
      }
    }
    this.mesh = new THREE.Mesh(g, clothMaterial(art));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.flap.snap(0);
  }

  private readonly _p = new THREE.Vector3();

  /** s along the luff (tack -> head), q from the luff toward the clew; r = furl, bulge = sideways belly. */
  private point(s: number, q: number, r: number, bulge: number): THREE.Vector3 {
    const { tack, head, clew } = this;
    const qq = q * r;
    this._p.set(
      tack.x + (head.x - tack.x) * s + (clew.x - tack.x) * qq * (1 - s),
      tack.y + (head.y - tack.y) * s + (clew.y - tack.y) * qq * (1 - s),
      tack.z + (head.z - tack.z) * s + (clew.z - tack.z) * qq * (1 - s),
    );
    this._p.x += bulge * Math.sin(Math.PI * qq) * Math.sin(Math.PI * Math.min(1, s * 1.2 + 0.1));
    return this._p;
  }

  update(steps: number, alpha: number, dt: number, { fill, luff, side, time }: ClothWind): void {
    this.advance(steps, alpha, fill, dt);
    const r = clamp(this.flap.p, 0, 1.05);
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const bulge = side * (0.03 + 0.16 * this.billow);
    for (let j = 0; j <= this.nq; j++) {
      for (let i = 0; i <= this.ns; i++) {
        const k = j * (this.ns + 1) + i;
        const p = this.point(i / this.ns, j / this.nq, r, bulge);
        p.x += luff * 0.03 * Math.sin(time * 12 + i * 0.9) * (j / this.nq);
        pos.setXYZ(k, p.x, p.y, p.z);
      }
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.visible = r > 0.04;
  }
}

/** The flag at the head of the tallest mast, streaming downwind and rippling. */
export class Flag {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly baseX: Float32Array;
  private readonly baseY: Float32Array;
  private readonly width: number;
  /**
   * The ripple's phase (rad), advanced every frame at the speed the wind gives it now: a phase of time times speed
   * would leap whenever the speed changes (in a turn, a bump), the further into the voyage the more.
   */
  private phase = 0;

  constructor(art: CardArt) {
    this.width = art.right - art.left;
    const nx = 10;
    const ny = 4;
    const g = gridGeometry(nx, ny);
    const count = (nx + 1) * (ny + 1);
    this.baseX = new Float32Array(count);
    this.baseY = new Float32Array(count);
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const k = j * (nx + 1) + i;
        this.baseX[k] = art.left + (art.right - art.left) * (i / nx);
        this.baseY[k] = art.bottom + (art.top - art.bottom) * (j / ny);
      }
    }
    this.mesh = new THREE.Mesh(g, clothMaterial(art));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  /** windAngle: direction the flag streams to, in the parent's frame (rad about +y, 0 = +x). */
  update(dt: number, windAngle: number, strength: number): void {
    // the flag swings round to the wind with a little lag
    const cur = this.group.rotation.y;
    let diff = windAngle - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.group.rotation.y = cur + diff * (1 - Math.exp(-dt * 3));
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const amp = 0.03 + 0.03 * strength;
    this.phase = (this.phase + dt * (8 + 4 * strength)) % (2 * Math.PI);
    for (let k = 0; k < this.baseX.length; k++) {
      const x = this.baseX[k];
      const y = this.baseY[k];
      const f = Math.max(0, x) / this.width;
      const z = Math.sin(x * 11 - this.phase + y * 3) * amp * f;
      pos.setXYZ(k, x * (1 - 0.06 * f * f), y - 0.05 * f * f * (1 - strength), z);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}
