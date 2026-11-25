/**
 * Every standing card of the land (trees, rocks, props, animals...) in one instanced field: one InstancedMesh per
 * sprite, facing, biome tint and piece (a card, or a cross's front or back half card), so thousands of cards cost a few
 * dozen draw calls.
 *
 * Each card has its own paper spring, but the land rises and folds by cells, like papertrails' tiles (which cells,
 * when, and how the rise ripples outward: world/reveal.ts): the cards of one cell start one after another over STAGGER
 * seconds in flat-stack order (they fold back, so the nearest lies on top and rises first) and fold down in the reverse
 * order, lying flat on the page, face up, until they rise again. A crossed card is papertrails' slotted cross (its
 * tiles.glb: tree + tree_xf + tree_xb): the card, and two half cards hinged on its two faces down its middle, folded
 * flat against it while it lies and pulled open by it as it rises (the spring's NESTED linkage), so a lying cross is
 * one card and a standing one two planes square to each other. Nothing stands plumb: each card leans a little (LEAN),
 * only as it stands, so it still lies exactly flat. A card settled upright rocks in the wind about its hinge
 * (world/wind.ts), fading in over SWAY_FADE_IN and relaxing away over SWAY_RELEASE once it moves; the animals live and
 * take the captain as world/critters.ts has them.
 */
import * as THREE from 'three';
import { bus } from '../core/events';
import { POPUP } from '../config/popup';
import { Flap, FixedStepper, flapConstants } from '../popup/spring';
import { CARD_THICKNESS, cardGeometry, materialFor, thickCardGeometry, thickMaterial } from '../popup/card';
import { CROSSED, heightOf, type Awake } from '../config/flora';
import { cardWidth, spriteArt } from '../art/sprites';
import { PAPER_FLAT_ATTRIBUTE, pencilPlan } from '../render/paper-material';
import { CELL, cellGesture, cellJitter, type Reveal } from './reveal';
import { SWAY_FADE_IN, SWAY_RADIUS, SWAY_RELEASE, swayAngle, swayOf, type Sway, windStrength } from './wind';
import { Critters, type Habitat } from './critters';
import { tintMaterial } from '../render/biome-tint';
import { BIOMES, type Biome } from './land';
import { clamp } from '../core/math';
import { cellKey } from '../core/grid';
import { overlaps, type Box } from './polyline';
import type { Lamp } from '../render/lamp-pools';

/** papertrails' in-tile stagger span: the cards of a cell start one after another over this many seconds. */
const STAGGER = 0.34;
/** Each card leans up to this far (rad) toward or away from the camera once upright (the skill: +-2.5 degrees). */
const LEAN = 2.5 * (Math.PI / 180);
/** Crossed cards (papertrails' crossDeg): the nearer plane stands this far off the view axis, the other square to it. */
export const CROSS_PLANES = [24 * (Math.PI / 180), -66 * (Math.PI / 180)];
/**
 * A cross's half cards (papertrails' tree_xf / tree_xb): about 40 % of a card thick, printed as the card is (folded
 * against it they read as the card itself), their mid-planes clear of the card's faces they fold against, with half a
 * millimetre of air between (so no face of a half card ever lies in the plane of one of the card's).
 */
const HALF_THICKNESS = 0.4 * CARD_THICKNESS;
const HALF_OFFSET = CARD_THICKNESS / 2 + HALF_THICKNESS / 2 + 0.0005;
/** How far above a lying cross's card face its front half card's face lies (the back one lies under the card). */
const HALF_RISE = HALF_OFFSET + HALF_THICKNESS / 2 - CARD_THICKNESS / 2;
/**
 * Which of a cross's pieces a batch draws: the card, or the half card on its front face (the second plane's side
 * x >= 0) or on its back face (x <= 0).
 */
type Part = 'card' | 'front' | 'back';
const HALF_SIDE = { front: 1, back: -1 } as const;
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
  /** A slotted cross: the card and two half cards square to it (CROSS_PLANES off the view), like a pop-up tree. */
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
  /** An animal about by day or by night only (papertrails' d and n): out of its hours it is not there. */
  awake?: Awake;
  /** Too low to stop the feet (papertrails' pen fences, under its lowest blocking height): they step over it. */
  passable?: boolean;
}

export interface Card extends CardSpec {
  id: number;
  flap: Flap;
  /** A cross's half cards, riding on the card (NESTED: they open as it rises, never ahead of it). */
  halves: Flap | null;
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
  /** How far it is there (0..1): an animal of the day or the night pops up in its hours and away out of them. */
  shown: number;
  /** The page it covers lying folded flat (see flatBounds). */
  flatBox: Box;
  /**
   * The height it lies at folded flat, on its cell's stack (layFlat); standing it stands at y, its foot on the page, and
   * rising it comes down that far as it goes up (the skill: no stand-up floats by its stack layer).
   */
  flatY: number;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  part: Part;
  cards: Card[];
  dirty: boolean;
  /** A card batch of crosses: the batches of their half cards, which redraw when a card of this one moves. */
  halves: Batch[];
}

/**
 * The bounds of the page a card covers lying folded flat: it folds back (away from the camera) about its hinge, so it
 * lies from its foot back by its height, as wide as it is drawn (a cross lies as its card, the half cards folded on it).
 */
function flatBounds(s: CardSpec): Box {
  const half = cardWidth(s.sprite, s.height) / 2;
  const yaw = s.cross ? s.yaw + CROSS_PLANES[0] : s.yaw;
  const ax = Math.cos(yaw) * half;
  const az = -Math.sin(yaw) * half;
  const bx = -Math.sin(yaw) * s.height;
  const bz = -Math.cos(yaw) * s.height;
  const xs = [s.x - ax, s.x + ax, s.x - ax + bx, s.x + ax + bx];
  const zs = [s.z - az, s.z + az, s.z - az + bz, s.z + az + bz];
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}

/** The cards that are lamps (papertrails' lamp nodes: they pool light on the page at night, render/lamp-pools.ts). */
const LAMPS = new Set(['lantern-post', 'campfire']);

/** papertrails' animal cards pop up at this rate and away at this one (1/s) as the day or the night comes. */
const POP_RATE = 4.5;
const HIDE_RATE = 10;

/** Side of the squares the folded cards are filed under (world units), to find the ones a card lies over. */
const FLAT_CELL = 1;

const _m = new THREE.Matrix4();
const _mh = new THREE.Matrix4();
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
  /** Every card filed under each FLAT_CELL square its folded bounds reach. */
  private readonly flats = new Map<number, Card[]>();
  private readonly critters: Critters;
  /** The lamp cards (see LAMPS). */
  private lampCards: Card[] = [];
  /** This frame's step and focus, for the animals. */
  private dt = 0;
  private focusX = 0;
  private focusZ = 0;

  /** habitat: where the animals may walk and swim, and whether it is night. */
  constructor(private readonly habitat: Habitat) {
    this.critters = new Critters(habitat);
  }

  /** Whether a card of these hours is about now (1) or not (0). */
  private awakeNow(awake: Awake | undefined): number {
    return !awake || (awake === 'night') === this.habitat.night() ? 1 : 0;
  }

  /** Adds cards (returns them, so their owner can remove them later). */
  add(specs: CardSpec[]): Card[] {
    const out: Card[] = [];
    const cells = new Map<string, Card[]>();
    for (const s of specs) {
      const i = Math.floor(s.x / CELL);
      const j = Math.floor(s.z / CELL);
      const constants = flapConstants({ size: s.height, seed: s.x * 0.137 + s.z * 0.291, wobble: 1 });
      const flap = new Flap(constants);
      const card: Card = {
        ...s,
        id: this.nextId++,
        flap,
        halves: s.cross ? new Flap(constants) : null,
        hidden: false,
        phase: Math.abs(Math.sin(s.x * 12.9898 + s.z * 78.233)) % 1,
        cx: (i + 0.5) * CELL,
        cz: (j + 0.5) * CELL,
        order: 0,
        jitter: cellJitter(s.x, s.z),
        flipAt: -99,
        held: 0,
        lean: ((Math.abs(Math.sin(s.x * 39.346 + s.z * 11.135) * 43758.5453) % 1) * 2 - 1) * LEAN,
        wind: swayOf(s.sprite, s.height, cardWidth(s.sprite, s.height), s.x, s.z),
        sway: 0,
        swayLevel: 0,
        shown: this.awakeNow(s.awake),
        flatBox: flatBounds(s),
        flatY: s.y,
      };
      if (card.halves) card.halves.parent = flap;
      const key = `${i},${j}`;
      let cell = cells.get(key);
      if (!cell) cells.set(key, (cell = []));
      cell.push(card);
      for (const b of this.batchesOf(card)) {
        b.cards.push(card);
        b.dirty = true;
      }
      out.push(card);
      if (LAMPS.has(s.sprite)) this.lampCards.push(card);
    }
    // the rise order inside each cell, the flat stack's: the nearest first (the camera looks north, so the largest z),
    // the farthest last (a chunk holds whole cells)
    for (const cell of cells.values()) {
      cell.sort((a, b) => b.z - a.z || a.phase - b.phase);
      cell.forEach((c, k) => (c.order = cell.length > 1 ? k / (cell.length - 1) : 0));
    }
    // (laid bottom of the stack first: the cards that rise last)
    for (const c of [...out].sort((a, b) => b.order - a.order)) this.layFlat(c);
    return out;
  }

  /**
   * Lays a new card in the flat stack. It lies above every card of its cell it overlaps that rises after it (the skill's
   * flat stack: the top of the stack rises first, so no card swings up through one lying over it, and folding down is
   * the same film run backward). And it keeps off the plane of every card it overlaps: two faces in one plane flicker,
   * the depth test picking either one frame by frame; it goes up in POPUP.flatStep layers until it is at least that far
   * from each of them (the lowest such height, so the flat stacks stay a few hundredths thin).
   */
  private layFlat(c: Card): void {
    // (a lying cross shows two faces: its card's and, above it, its front half card's)
    const faces = (o: Card) => (o.cross ? [0, HALF_RISE] : [0]);
    const [x0, z0, x1, z1] = c.flatBox;
    const over = new Set<Card>();
    for (let j = Math.floor(z0 / FLAT_CELL); j <= Math.floor(z1 / FLAT_CELL); j++) {
      for (let i = Math.floor(x0 / FLAT_CELL); i <= Math.floor(x1 / FLAT_CELL); i++) {
        const key = cellKey(i, j);
        const list = this.flats.get(key);
        for (const o of list ?? []) if (overlaps(o.flatBox, c.flatBox)) over.add(o);
        if (list) list.push(c);
        else this.flats.set(key, [c]);
      }
    }
    for (const o of over) {
      if (o.cx === c.cx && o.cz === c.cz && o.order > c.order) c.flatY = Math.max(c.flatY, o.flatY + Math.max(...faces(o)) + POPUP.flatStep);
    }
    const heights = [...over].flatMap((o) => faces(o).map((f) => o.flatY + f));
    const fights = () => faces(c).some((f) => heights.some((y) => Math.abs(y - c.flatY - f) < POPUP.flatNear));
    while (fights()) c.flatY += POPUP.flatStep;
  }

  remove(cards: Card[]): void {
    const dead = new Set(cards);
    this.lampCards = this.lampCards.filter((c) => !dead.has(c));
    for (const [key, list] of this.flats) {
      const kept = list.filter((c) => !dead.has(c));
      if (kept.length) this.flats.set(key, kept);
      else this.flats.delete(key);
    }
    for (const b of this.batches.values()) {
      const before = b.cards.length;
      b.cards = b.cards.filter((c) => !dead.has(c));
      if (b.cards.length !== before) b.dirty = true;
    }
  }

  /**
   * Creates the batches of every given sprite (both facings, a cross's half cards too) up front, so their shaders
   * compile and their shapes are cut at load time; and one of the first in every biome, for the biome tints' shader
   * variants.
   */
  prewarm(sprites: string[]): void {
    for (const sprite of sprites) {
      for (const flip of [false, true]) this.batchesOf({ sprite, flip, cross: CROSSED.has(sprite) });
    }
    for (const biome of BIOMES) this.batch(sprites[0], false, biome);
  }

  /** The lamps standing or rising (their cards' feet, heights and progress), for the night's pools. */
  lamps(): Lamp[] {
    return this.lampCards
      .filter((c) => !c.hidden && c.flap.p > 0)
      .map((c) => ({ x: c.x, y: c.y, z: c.z, height: c.height, risen: c.flap.p }));
  }

  /** The standing card nearest (x, z) within r whose sprite passes test (its foot), or null. */
  nearest(x: number, z: number, r: number, test: (sprite: string) => boolean): Card | null {
    let best: Card | null = null;
    let bestD = r;
    for (let j = Math.floor((z - r) / FLAT_CELL); j <= Math.floor((z + r) / FLAT_CELL); j++) {
      for (let i = Math.floor((x - r) / FLAT_CELL); i <= Math.floor((x + r) / FLAT_CELL); i++) {
        for (const c of this.flats.get(cellKey(i, j)) ?? []) {
          if (c.hidden || c.flap.p < 0.9 || !test(c.sprite)) continue;
          const d = Math.hypot(c.x - x, c.z - z);
          if (d < bestD) [best, bestD] = [c, d];
        }
      }
    }
    return best;
  }

  /** Hides a card for good (a collected chest). */
  hide(card: Card): void {
    card.hidden = true;
    for (const b of this.batchesOf(card)) b.dirty = true;
  }

  /** The batches drawing a card: its own, and a cross's two half cards' (filed on its own). */
  private batchesOf(c: Pick<CardSpec, 'sprite' | 'flip' | 'biome' | 'cross'>): Batch[] {
    const card = this.batch(c.sprite, c.flip, c.biome, 'card');
    if (!c.cross) return [card];
    if (!card.halves.length) card.halves = [this.batch(c.sprite, c.flip, c.biome, 'front'), this.batch(c.sprite, c.flip, c.biome, 'back')];
    return [card, ...card.halves];
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
    // (a card moves once, from its own batch; the batches of its cross's half cards redraw after, marked by it)
    for (const b of this.batches.values()) {
      if (b.part !== 'card') continue;
      let animate = b.dirty;
      for (const c of b.cards) {
        let stirred = false;
        const d = Math.hypot(c.x - focusX, c.z - focusZ);
        const f = c.flap;
        // (a rise still waiting for its ripple is called off once the cell is no longer wanted: papertrails' pending
        // tile)
        if (f.target === 0 && f.pendingTarget === 1 && !reveal.wanted(c.cx, c.cz)) {
          f.setTarget(0);
          c.halves?.setTarget(0);
          bus.emit('paperCancel', { key: cellGesture(c.x, c.z) });
        }
        const up = f.target === 1 || f.pendingTarget === 1;
        const may = reveal.mayFlip(c.cx, c.cz, c.flipAt, this.time);
        if (!up) {
          if (may && reveal.wantsUp(c.cx, c.cz)) {
            if (reveal.holds(c.cx, c.cz, c.held)) c.held += dt;
            else if (reveal.claimRise(c.cx, c.cz)) {
              const delay = c.delay + reveal.riseDelay(c.cx, c.cz, c.jitter) + c.order * STAGGER;
              f.setTarget(1, delay);
              c.halves?.setTarget(1, delay + POPUP.nested.lag);
              c.flipAt = this.time;
              c.held = 0;
              if (!c.hidden) bus.emit('paper', { x: c.x, z: c.z, height: c.height, up: true, delay, key: cellGesture(c.x, c.z) });
            }
          } else c.held = 0;
        } else if (may && reveal.wantsDown(c.cx, c.cz)) {
          // folding, the cell closes in the reverse order: the farthest first
          const delay = reveal.foldDelay(c.cx, c.cz, c.jitter) + (1 - c.order) * STAGGER;
          f.setTarget(0, delay);
          c.halves?.setTarget(0, delay);
          c.flipAt = this.time;
          if (!c.hidden) bus.emit('paper', { x: c.x, z: c.z, height: c.height, up: false, delay, key: cellGesture(c.x, c.z) });
        }
        const hv = c.halves;
        if (f.active || hv?.active) {
          // (the card before the half cards riding on it, every fixed step)
          for (let i = 0; i < steps; i++) {
            f.step(h);
            hv?.step(h);
          }
          stirred = true;
        }
        f.interpolate(this.stepper.alpha);
        hv?.interpolate(this.stepper.alpha);
        if (f.target === 1 && f.atRest && f.pendingTarget < 0) {
          // settled upright: near the focus the wind owns the sway, fading in
          if (c.wind.amp > 0 && d < SWAY_RADIUS) {
            c.swayLevel = Math.min(1, c.swayLevel + dt / SWAY_FADE_IN);
            const yaw = c.cross ? c.yaw + CROSS_PLANES[0] : c.yaw;
            c.sway = c.swayLevel * swayAngle(c.wind, c.x, c.z, -Math.sin(yaw), -Math.cos(yaw), this.time, windStrength(c.biome));
            stirred = true;
          }
        } else if (c.swayLevel > 0) {
          // the spring owns the card again: whatever sway is left relaxes away
          c.swayLevel *= relax;
          c.sway *= relax;
          if (c.swayLevel < 1e-4) c.swayLevel = c.sway = 0;
          stirred = true;
        }
        if (Critters.is(c.sprite) && f.p > 0.5 && d < SWAY_RADIUS) stirred = true;
        if (c.awake) {
          const want = this.awakeNow(c.awake);
          if (c.shown !== want) {
            c.shown = want > c.shown ? Math.min(1, c.shown + dt * POP_RATE) : Math.max(0, c.shown - dt * HIDE_RATE);
            stirred = true;
          }
        }
        if (stirred) animate = true;
      }
      if (animate) {
        this.rebuild(b);
        for (const half of b.halves) half.dirty = true;
      }
    }
    for (const b of this.batches.values()) if (b.part !== 'card' && b.dirty) this.rebuild(b);
  }

  private rebuild(b: Batch): void {
    let n = 0;
    if (b.mesh.instanceMatrix.count < b.cards.length) this.grow(b);
    const mesh = b.mesh;
    const flat = mesh.geometry.getAttribute(PAPER_FLAT_ATTRIBUTE) as THREE.InstancedBufferAttribute;
    for (const c of b.cards) {
      const p = c.flap.p;
      // a folded card is not gone: it lies flat on the page, face up, like papertrails' folded flaps (it is seen
      // from afar, and seen to fold down and to stand up again)
      if (c.hidden || c.shown <= 0) continue;
      const sw = c.sway;
      _p.set(c.x, c.y + (c.flatY - c.y) * clamp(1 - p, 0, 1), c.z);
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
      // the wind rocks the card about its hinge, the top tipping the way it folds, and twists it about its long axis;
      // its lean grows with it as it stands; a cross's half cards ride on it
      const yaw = (c.cross ? c.yaw + CROSS_PLANES[0] : c.yaw) + turn;
      const tilt = sw + c.lean * p;
      _q.setFromAxisAngle(Y_AXIS, yaw);
      if (tilt !== 0) {
        _q.multiply(_qa.setFromAxisAngle(X_AXIS, -tilt));
        _q.multiply(_qa.setFromAxisAngle(Y_AXIS, sw * c.wind.twist));
      }
      _q.multiply(_qa.setFromAxisAngle(X_AXIS, (-Math.PI / 2) * (1 - p)));
      if (lean !== 0) _q.multiply(_qa.setFromAxisAngle(Z_AXIS, lean));
      if (c.flap.twist !== 0) _q.multiply(_qa.setFromAxisAngle(Y_AXIS, c.flap.twist));
      // (an animal popping up or away: papertrails' pop, a smoothstep of its scale)
      const pop = c.shown < 1 ? c.shown * c.shown * (3 - 2 * c.shown) : 1;
      if (b.part === 'card') {
        _m.compose(_p, _q, _s.set(c.height * pop, c.height * pop, CARD_THICKNESS));
      } else {
        // a half card on the card's front or back face, hinged down its middle: folded flat against the face while the
        // card lies (0), square to it standing (1); both turn the same way round, so together they make the cross's
        // second plane
        _m.compose(_p, _q, _s.set(1, 1, 1));
        _mh.makeRotationY((-Math.PI / 2) * c.halves!.p).scale(_s.set(c.height, c.height, HALF_THICKNESS));
        _m.multiply(_mh.setPosition(0, 0, HALF_SIDE[b.part] * HALF_OFFSET));
      }
      mesh.setColorAt(n, _tone.setScalar(c.tone ?? 1));
      flat.setX(n, clamp(1 - p, 0, 1));
      mesh.setMatrixAt(n++, _m);
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
    // (the shape's attributes and index are shared with this sprite's other batches: only the old flatness goes)
    const g = old.geometry;
    for (const name of Object.keys(g.attributes)) if (name !== PAPER_FLAT_ATTRIBUTE) g.deleteAttribute(name);
    g.setIndex(null);
    g.dispose();
    old.dispose();
    this.group.add(mesh);
    b.mesh = mesh;
  }

  private batch(sprite: string, flip: boolean, biome: Biome = 'jungle', part: Part = 'card'): Batch {
    const key = `${sprite}|${flip ? 'f' : ''}|${biome}|${part}`;
    let b = this.batches.get(key);
    if (!b) {
      const art = spriteArt(sprite, { height: 1 });
      const print = materialFor(art);
      pencilPlan(print);
      // thick die-cut cardstock (unit height and depth: the instance scale sets height and thickness)
      // (its contact shading measured at the height the sprite is usually drawn)
      const height = heightOf(sprite, 0.5);
      const thick = thickCardGeometry(art, { flipX: flip, unit: true, height, half: part === 'card' ? undefined : HALF_SIDE[part] });
      let g: THREE.BufferGeometry;
      let material: THREE.Material | THREE.Material[];
      if (thick) {
        g = thick;
        material = tintMaterial(thickMaterial(print), biome, sprite);
      } else {
        // (a plane card has no outline to cut in half)
        if (part !== 'card') throw new Error(`no outline for the half cards of "${sprite}"`);
        g = cardGeometry(art, { height });
        if (flip) {
          const uv = g.getAttribute('uv') as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
        }
        material = tintMaterial(print, biome, sprite);
      }
      const mesh = batchMesh(g, material, 64);
      this.group.add(mesh);
      b = { mesh, part, cards: [], dirty: true, halves: [] };
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
