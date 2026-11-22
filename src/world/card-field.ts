/**
 * Every standing card of the land (trees, rocks, props, animals...) in one instanced field: one InstancedMesh per
 * sprite (and per mirrored sprite), so thousands of cards cost a few dozen draw calls.
 *
 * Each card has its own paper spring, but the land rises and folds by cells, like papertrails' tiles (which cells,
 * when, and how the rise ripples outward: world/reveal.ts): the cards of one cell start one after another over
 * STAGGER seconds in flat-stack order (they fold back, so the nearest lies on top and rises first) and fold down in the
 * reverse order, lying flat on the page, face up, until they rise again. Nothing stands plumb: each card leans a
 * little (LEAN), only as it stands, so it still lies exactly flat. At each card's foot the page carries its score line
 * and glue tabs (world/page-marks.ts). A card settled upright rocks in the wind about its hinge (world/wind.ts),
 * fading in over SWAY_FADE_IN and relaxing away over SWAY_RELEASE once it moves; the animals live and take the captain
 * as world/critters.ts has them.
 */
import * as THREE from 'three';
import { bus } from '../core/events';
import { POPUP } from '../config/popup';
import { Flap, FixedStepper, flapConstants } from '../popup/spring';
import { CARD_THICKNESS, cardGeometry, materialFor, thickCardGeometry, thickMaterial } from '../popup/card';
import { heightOf } from '../config/flora';
import { spriteArt, spriteInfo } from '../art/sprites';
import { PAPER_FLAT_ATTRIBUTE, pencilPlan } from '../render/paper-material';
import { CELL, cellJitter, type Reveal } from './reveal';
import { SWAY_FADE_IN, SWAY_RADIUS, SWAY_RELEASE, swayAngle, swayOf, type Sway, windStrength } from './wind';
import { Critters, type Habitat } from './critters';
import { tintMaterial } from '../render/biome-tint';
import { BIOMES, type Biome } from './land';
import { clamp } from '../core/math';
import { PageMarks, type Foot } from './page-marks';

/** papertrails' in-tile stagger span: the cards of a cell start one after another over this many seconds. */
const STAGGER = 0.34;
/** Each card leans up to this far (rad) toward or away from the camera once upright (the skill: +-2.5 degrees). */
const LEAN = 2.5 * (Math.PI / 180);
/** Crossed cards (papertrails' crossDeg): the nearer plane stands this far off the view axis, the other square to it. */
export const CROSS_PLANES = [24 * (Math.PI / 180), -66 * (Math.PI / 180)];
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);


export interface CardSpec {
  sprite: string;
  x: number;
  y: number;
  z: number;
  height: number;
  yaw: number;
  flip: boolean;
  /** Extra start delay (s) when rising. */
  delay: number;
  /** Two cards crossing at right angles (each 45 degrees off the view), like a slotted pop-up tree. */
  cross?: boolean;
  /**
   * papertrails' vignette: an animal tied to a piece beside it (sitting on it, by it, at a door, behind it), which
   * keeps its place; seat: how far above the ground it sits (on a fence, a barrel, the top of a tower).
   */
  vignette?: { seat: number };
  /** The biome it stands in (papertrails' prop tint, render/biome-tint.ts); a heartland if not given. */
  biome?: Biome;
  /** papertrails' clump shading: the whole card printed this much darker (1, as drawn, if not given). */
  tone?: number;
}

export interface Card extends CardSpec {
  id: number;
  flap: Flap;
  hidden: boolean;
  phase: number;
  /** Centre of the card's cell, its place (0..1) in the cell's rise order, the cell's ripple jitter (s). */
  cx: number;
  cz: number;
  order: number;
  jitter: number;
  flipAt: number;
  /** Seconds its cell has waited to rise while the traveller crosses it (world/reveal.ts). */
  held: number;
  /** How far it leans once upright (rad, about its hinge; seeded by its place). */
  lean: number;
  /** How it rocks in the wind (see wind.ts), its sway now (rad) and how far the sway has faded in (0..1). */
  wind: Sway;
  sway: number;
  swayLevel: number;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  cards: Card[];
  dirty: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _tone = new THREE.Color();


export class CardField {
  readonly group = new THREE.Group();
  private readonly batches = new Map<string, Batch>();
  private readonly stepper = new FixedStepper();
  private nextId = 1;
  private time = 0;
  private readonly critters: Critters;
  /** The score lines and glue tabs printed at the cards' feet, and whether they need printing again. */
  private readonly marks = new PageMarks();
  private marksDirty = false;
  /** This frame's step and focus, for the animals. */
  private dt = 0;
  private focusX = 0;
  private focusZ = 0;

  /** habitat: where the animals may walk and swim, and whether it is night. */
  constructor(habitat: Habitat) {
    this.critters = new Critters(habitat);
    this.group.add(this.marks.group);
  }

  /** Adds cards (returns them, so their owner can remove them later). */
  add(specs: CardSpec[]): Card[] {
    const out: Card[] = [];
    const cells = new Map<string, Card[]>();
    for (const s of specs) {
      const i = Math.floor(s.x / CELL);
      const j = Math.floor(s.z / CELL);
      const card: Card = {
        ...s,
        id: this.nextId++,
        flap: new Flap(flapConstants({ size: s.height, seed: (s.x * 0.137 + s.z * 0.291) % 1, wobble: 1 })),
        hidden: false,
        phase: Math.abs(Math.sin(s.x * 12.9898 + s.z * 78.233)) % 1,
        cx: (i + 0.5) * CELL,
        cz: (j + 0.5) * CELL,
        order: 0,
        jitter: cellJitter(s.x, s.z),
        flipAt: -99,
        held: 0,
        lean: ((Math.abs(Math.sin(s.x * 39.346 + s.z * 11.135) * 43758.5453) % 1) * 2 - 1) * LEAN,
        wind: swayOf(s.sprite, s.height, (s.height * spriteInfo(s.sprite).w) / spriteInfo(s.sprite).h, s.x, s.z),
        sway: 0,
        swayLevel: 0,
      };
      const key = `${i},${j}`;
      let cell = cells.get(key);
      if (!cell) cells.set(key, (cell = []));
      cell.push(card);
      const b = this.batch(s.sprite, s.flip, s.biome);
      b.cards.push(card);
      b.dirty = true;
      out.push(card);
    }
    // the rise order inside each cell, the flat stack's: the nearest first (the camera looks north, so the largest z),
    // the farthest last (a chunk holds whole cells)
    for (const cell of cells.values()) {
      cell.sort((a, b) => b.z - a.z || a.phase - b.phase);
      cell.forEach((c, k) => (c.order = cell.length > 1 ? k / (cell.length - 1) : 0));
    }
    this.marksDirty = true;
    return out;
  }

  remove(cards: Card[]): void {
    const dead = new Set(cards);
    for (const b of this.batches.values()) {
      const before = b.cards.length;
      b.cards = b.cards.filter((c) => !dead.has(c));
      if (b.cards.length !== before) b.dirty = true;
    }
    this.marksDirty = true;
  }

  /**
   * Creates the batch of every given sprite (both facings) up front, so their shaders compile at load time; and one of
   * the first in every biome, for the biome tints' shader variants.
   */
  prewarm(sprites: string[]): void {
    for (const s of sprites) {
      this.batch(s, false);
      this.batch(s, true);
    }
    for (const biome of BIOMES) this.batch(sprites[0], false, biome);
  }

  /** Hides a card for good (a collected chest). */
  hide(card: Card): void {
    card.hidden = true;
    this.batch(card.sprite, card.flip, card.biome).dirty = true;
    this.marksDirty = true;
  }

  get count(): number {
    let n = 0;
    for (const b of this.batches.values()) n += b.cards.length;
    return n;
  }

  /** reveal decides which cells stand; (focusX, focusZ): where the animals stir and the wind sways the cards. */
  update(dt: number, reveal: Reveal, focusX: number, focusZ: number): void {
    const relax = Math.exp(-dt / SWAY_RELEASE);
    this.time += dt;
    this.dt = dt;
    this.focusX = focusX;
    this.focusZ = focusZ;
    const steps = this.stepper.advance(dt);
    const h = POPUP.step;
    if (this.marksDirty) {
      this.marks.rebuild(this.feet());
      this.marksDirty = false;
    }
    for (const b of this.batches.values()) {
      let animate = b.dirty;
      for (const c of b.cards) {
        const d = Math.hypot(c.x - focusX, c.z - focusZ);
        const f = c.flap;
        const up = f.target === 1 || f.pendingTarget === 1;
        const may = reveal.mayFlip(c.cx, c.cz, c.flipAt, this.time);
        if (!up) {
          if (may && reveal.wantsUp(c.cx, c.cz)) {
            if (reveal.holds(c.cx, c.cz, c.held)) c.held += dt;
            else if (reveal.claimRise(c.cx, c.cz)) {
              const delay = c.delay + reveal.riseDelay(c.cx, c.cz, c.jitter) + c.order * STAGGER;
              f.setTarget(1, delay);
              c.flipAt = this.time;
              c.held = 0;
              if (!c.hidden) bus.emit('paper', { x: c.x, z: c.z, count: 1, size: Math.min(1, c.height / 3), up: true, delay, key: `c${c.cx},${c.cz}` });
            }
          } else c.held = 0;
        } else if (may && reveal.wantsDown(c.cx, c.cz)) {
          // folding, the cell closes in the reverse order: the farthest first
          const delay = reveal.foldDelay(c.cx, c.cz, c.jitter) + (1 - c.order) * STAGGER;
          f.setTarget(0, delay);
          c.flipAt = this.time;
          if (!c.hidden) bus.emit('paper', { x: c.x, z: c.z, count: 1, size: Math.min(1, c.height / 3), up: false, delay, key: `c${c.cx},${c.cz}` });
        }
        if (f.active) {
          for (let i = 0; i < steps; i++) f.step(h);
          animate = true;
        }
        f.interpolate(this.stepper.alpha);
        if (f.target === 1 && f.atRest && f.pendingTarget < 0) {
          // settled upright: near the focus the wind owns the sway, fading in
          if (c.wind.amp > 0 && d < SWAY_RADIUS) {
            c.swayLevel = Math.min(1, c.swayLevel + dt / SWAY_FADE_IN);
            const yaw = c.cross ? c.yaw + CROSS_PLANES[0] : c.yaw;
            c.sway = c.swayLevel * swayAngle(c.wind, c.x, c.z, -Math.sin(yaw), -Math.cos(yaw), this.time, windStrength(c.biome));
            animate = true;
          }
        } else if (c.swayLevel > 0) {
          // the spring owns the card again: whatever sway is left relaxes away
          c.swayLevel *= relax;
          c.sway *= relax;
          if (c.swayLevel < 1e-4) c.swayLevel = c.sway = 0;
          animate = true;
        }
        if (Critters.is(c.sprite) && f.p > 0.5 && d < SWAY_RADIUS) animate = true;
      }
      if (animate) this.rebuild(b);
    }
  }

  /**
   * The feet that carry a score line and tabs: every card that stays where it was planted (not the animals, which
   * walk off, nor a vignette up on its seat), a crossed card at its first plane.
   */
  private *feet(): Generator<Foot> {
    for (const b of this.batches.values()) {
      for (const c of b.cards) {
        if (c.hidden || Critters.is(c.sprite) || c.vignette) continue;
        yield { sprite: c.sprite, flip: c.flip, x: c.x, y: c.y, z: c.z, height: c.height, yaw: c.cross ? c.yaw + CROSS_PLANES[0] : c.yaw };
      }
    }
  }

  private rebuild(b: Batch): void {
    let n = 0;
    if (b.mesh.instanceMatrix.count < b.cards.length * 2) this.grow(b);
    const mesh = b.mesh;
    const flat = mesh.geometry.getAttribute(PAPER_FLAT_ATTRIBUTE) as THREE.InstancedBufferAttribute;
    for (const c of b.cards) {
      const p = c.flap.p;
      // a folded card is not gone: it lies flat on the page, face up, like papertrails' folded flaps (it is seen
      // from afar, and seen to fold down and to stand up again)
      if (c.hidden) continue;
      const sw = c.sway;
      const tw = c.flap.twist;
      _p.set(c.x, c.y, c.z);
      _s.set(c.height, c.height, CARD_THICKNESS);
      let lean = 0;
      let turn = 0;
      if (Critters.is(c.sprite)) {
        // an animal lives while its card stands; rising or folding, the card lies where it last stood
        const pose = p > 0.9 ? this.critters.pose(c, this.dt, this.time, this.focusX, this.focusZ) : this.critters.still(c);
        _p.x += pose.dx;
        _p.y += pose.dy;
        _p.z += pose.dz;
        lean = pose.lean;
        turn = pose.yaw;
      }
      // a crossed card's second plane lies folded under the first while it is flat
      const planes = c.cross && p > 0.04 ? 2 : 1;
      const yaw0 = (c.cross ? c.yaw + CROSS_PLANES[0] : c.yaw) + turn;
      for (let k = 0; k < planes; k++) {
        // crossed cards: two planes slotted together (the nearer 24 degrees off the view); the second folds the other way
        const yaw = (c.cross ? c.yaw + CROSS_PLANES[k] : c.yaw) + turn;
        // the wind rocks the card about its (first plane's) hinge, the top tipping the way it folds, and twists it about
        // its long axis; its lean grows with it as it stands; a crossed card rocks and leans as one piece
        const tilt = sw + c.lean * p;
        if (tilt !== 0) {
          _q.setFromAxisAngle(Y_AXIS, yaw0);
          _q.multiply(_qa.setFromAxisAngle(X_AXIS, -tilt));
          _q.multiply(_qa.setFromAxisAngle(Y_AXIS, sw * c.wind.twist + yaw - yaw0));
        } else _q.setFromAxisAngle(Y_AXIS, yaw);
        _qa.setFromAxisAngle(X_AXIS, ((k === 0 ? -1 : 1) * Math.PI) / 2 * (1 - p));
        _q.multiply(_qa);
        if (lean !== 0) _q.multiply(_qa.setFromAxisAngle(Z_AXIS, lean));
        if (tw !== 0) _q.multiply(_qa.setFromAxisAngle(Y_AXIS, k === 0 ? tw : -tw));
        _m.compose(_p, _q, _s);
        flat.setX(n, clamp(1 - p, 0, 1));
        mesh.setColorAt(n, _tone.setScalar(c.tone ?? 1));
        mesh.setMatrixAt(n++, _m);
      }
    }
    mesh.count = n;
    // (kept visible even when empty: an InstancedMesh with count 0 draws nothing, and its shader stays compiled)
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    flat.needsUpdate = true;
    b.dirty = false;
  }

  private grow(b: Batch): void {
    const old = b.mesh;
    const cap = Math.max(64, Math.ceil(b.cards.length * 3));
    const mesh = batchMesh(old.geometry, old.material, cap);
    this.group.remove(old);
    old.geometry.dispose();
    old.dispose();
    this.group.add(mesh);
    b.mesh = mesh;
  }

  private batch(sprite: string, flip: boolean, biome: Biome = 'jungle'): Batch {
    const key = `${sprite}|${flip ? 'f' : ''}|${biome}`;
    let b = this.batches.get(key);
    if (!b) {
      const art = spriteArt(sprite, { height: 1 });
      const print = materialFor(art);
      pencilPlan(print);
      // thick die-cut cardstock (unit height and depth: the instance scale sets height and thickness)
      // (its contact shading measured at the height the sprite is usually drawn)
      const height = heightOf(sprite, 0.5);
      const thick = thickCardGeometry(art, { flipX: flip, unit: true, height });
      let g: THREE.BufferGeometry;
      let material: THREE.Material | THREE.Material[];
      if (thick) {
        g = thick;
        material = tintMaterial(thickMaterial(print), biome, sprite);
      } else {
        g = cardGeometry(art, { height });
        if (flip) {
          const uv = g.getAttribute('uv') as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
        }
        material = tintMaterial(print, biome, sprite);
      }
      const mesh = batchMesh(g, material, 64);
      this.group.add(mesh);
      b = { mesh, cards: [], dirty: true };
      this.batches.set(key, b);
    }
    return b;
  }
}

/**
 * A batch's mesh, room for capacity cards: its own geometry (see batchGeometry), and a tone per card (its instance
 * colour, there from the start so its shader is the one compiled at load time).
 */
function batchMesh(shape: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], capacity: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(batchGeometry(shape, capacity), material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

/**
 * A batch's own geometry: the card's shape (its attributes shared with the other batches of the sprite, a batch per
 * biome) and the cards' flatness per instance (0 standing .. 1 lying flat, for the paper material's pencil plan), as
 * many as the batch holds.
 */
function batchGeometry(shape: THREE.BufferGeometry, capacity: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(shape.attributes)) if (name !== PAPER_FLAT_ATTRIBUTE) g.setAttribute(name, attr);
  g.setIndex(shape.index);
  g.boundingBox = shape.boundingBox;
  g.boundingSphere = shape.boundingSphere;
  const flat = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  flat.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(PAPER_FLAT_ATTRIBUTE, flat);
  return g;
}
