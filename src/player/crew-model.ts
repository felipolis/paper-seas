/**
 * The captains as small 3D paper models: every piece a die-cut slab of card in one flat colour, its cut edge pale
 * cream, the pieces layered and slotted through each other so the figure reads from every side:
 *   - the head: a frontal face card (its back the hair's colour) with the head's profile card slotted through its
 *     middle, whose front edge is the nose and the chin; a thicker card of hair round the profile, a card of hair
 *     behind the face, small eye cards on the face and on both sides of the profile; a neck card below;
 *   - the body: a frontal and a profile card slotted into a cross, and what is worn on it layered in front (a
 *     waistcoat, its braid, a jabot, a scarf, a belt or a sash slotted into a cross of its own) and behind (the coat's
 *     back);
 *   - the arms and the legs: profile cards only (a sleeve bent forward, a thicker cuff, a hand; trousers, a thicker
 *     boot cuff, a boot with its toe), the right hand carrying the lantern in front of the body;
 *   - the hat: level discs stacked from the brim up, tilted a little back.
 * What hangs below the waist (a coat's tails, an apron) is cut in two and hung on the legs, so it swings with them;
 * nothing that moves against another piece cuts into it (tools/qa/crew-clips.mjs; pieces on one joint are slotted
 * through each other on purpose and never move apart).
 * The figure faces +z, stands on y = 0 and is 0.6 tall (times its outfit's height). Its joints, each a
 * node the puppet moves by rotation only: body (on the hips, carrying the arms and the head), leg_l and leg_r, arm_l
 * and arm_r, head, and the lantern below the right hand. The pieces on a joint are merged into one mesh (one draw).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config/palette';
import type { Outfit } from '../config/ships';
import { createPaperMaterial } from '../render/paper-material';
import { mix, tone } from '../art/paper-colour';
import type { Pt } from '../core/polyline';

export type PartName = 'body' | 'head' | 'leg_l' | 'leg_r' | 'arm_l' | 'arm_r' | 'lantern';

/** One piece of a captain, for the clip check: its outline (and holes) in its own frame, its thickness, its joint. */
export interface Piece {
  name: string;
  joint: THREE.Object3D;
  /** The piece's frame in its joint's space (its outline lies in this frame's xy plane, centred on z = 0). */
  frame: THREE.Matrix4;
  outline: readonly Pt[];
  holes: readonly (readonly Pt[])[];
  thickness: number;
}

export interface CaptainModel {
  root: THREE.Group;
  parts: Record<PartName, THREE.Object3D>;
  /** Every piece, named (the clip check reports by name). */
  pieces: Piece[];
}

// ---- the palette and the card -------------------------------------------------------------------------------------

/**
 * The cut edge, the boot cuff, the lantern's frame (its glow is the palette's lantern); the warm dark of an eye, of a
 * skull's hollows.
 */
const CREAM = '#fbf6ea';
const CUFF = '#e8d3ac';
const FRAME = '#513424';
const EYE = '#2a1a10';
const HOLLOW = '#2a1e16';
/** Gold braid and buckles; linen (lace, an apron, gloves); a sash and red lips; leather; a wooden peg; a tin ladle. */
const GOLD = '#d9a341';
const LINEN = '#f4efe4';
const RED = '#b8443a';
const LEATHER = '#4a2a18';
const WOOD = '#8a5a34';
const TIN = '#a8a49a';
/** A cheek's flush, the mouth in a beard, the hat band, the parrot's green and its red tail. */
const BLUSH = '#e0705a';
const MOUTH = '#5a2a1e';
const HAT_BAND = '#bb6140';
const PARROT = '#5e9a4a';
const PARROT_TAIL = '#b4442e';

/**
 * The card thicknesses: a card, a thicker band (a cuff, a collar), a thin layer laid on another, an eye's
 * ink; the face, the head's cards (its profile, the neck, the hair behind the face), the hair round the profile, a
 * hand. GAP: the air between a layer and what it lies on.
 */
const CARD = 0.011;
const BAND = 0.017;
const LAYER = 0.004;
const INK = 0.001;
const FACE = 0.012;
const HEAD = 0.014;
const HAIR = 0.025;
const HAND = 0.015;
const GAP = 0.0005;
/** A hand's radius. */
const HAND_R = 0.018;
/** The mid-plane of a piece t thick laid on the front of one `under` thick whose mid-plane is at z. */
const above = (z: number, under: number, t: number) => z + under / 2 + GAP + t / 2;
/** The two sides of a figure: its left (+x) and its right. */
const SIDES = [[1, 'l'], [-1, 'r']] as const;

// ---- the pieces ---------------------------------------------------------------------------------------------------

/** A slab's colours: its front face, its back face and its cut edge. */
interface Colours {
  front: string;
  back?: string;
  edge?: string;
}

/** One colour, edge and all (an eye, a freckle: too small to show a cut edge). */
const ink = (c: string): Colours => ({ front: c, edge: c });

let paper: THREE.MeshLambertMaterial | null = null;
/** One matte card material for every piece: its colours are the slabs' vertex colours. */
function paperMaterial(): THREE.MeshLambertMaterial {
  if (!paper) {
    paper = createPaperMaterial({ back: null, side: THREE.FrontSide });
    paper.vertexColors = true;
  }
  return paper;
}

let glow: THREE.MeshBasicMaterial | null = null;
/** The lantern's warm pane. */
function glowMaterial(): THREE.MeshBasicMaterial {
  return (glow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lantern).multiplyScalar(3), side: THREE.DoubleSide }));
}

/** A die-cut slab: the outline pts (and holes) extruded by t round z = 0, coloured front, back and edge. */
function slab(pts: readonly Pt[], t: number, c: Colours, holes: readonly (readonly Pt[])[]): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -t / 2);
  const front = new THREE.Color(c.front);
  const back = new THREE.Color(c.back ?? c.front);
  const edge = new THREE.Color(c.edge ?? CREAM);
  const wall = g.groups.find((gr) => gr.materialIndex === 1);
  const N = g.getAttribute('normal');
  const col = new Float32Array(N.count * 3);
  for (let i = 0; i < N.count; i++) {
    const k = wall && i >= wall.start && i < wall.start + wall.count ? edge : N.getZ(i) > 0 ? front : back;
    col.set([k.r, k.g, k.b], i * 3);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.clearGroups();
  return g;
}

/** The pieces of a captain and its joints, as they are built. */
interface Rig {
  pieces: Piece[];
  nodes: Node[];
}

/** A joint of the puppet: its pivot (absolute, in the figure's frame) and the pieces hung on it. */
class Node {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(
    name: string,
    readonly pivot: THREE.Vector3,
    private readonly rig: Rig,
    parent?: Node,
  ) {
    this.group.name = name;
    this.group.position.copy(parent ? pivot.clone().sub(parent.pivot) : pivot);
    parent?.group.add(this.group);
    rig.nodes.push(this);
  }

  /** A joint riding on this one. */
  child(name: string, pivot: THREE.Vector3): Node {
    return new Node(name, pivot, this.rig, this);
  }

  /** A slab cut to pts (its own x, y), placed by at (its frame to the figure's). */
  piece(name: string, pts: readonly Pt[], t: number, c: Colours, at: THREE.Matrix4, holes: readonly (readonly Pt[])[] = []): void {
    const frame = new THREE.Matrix4().makeTranslation(-this.pivot.x, -this.pivot.y, -this.pivot.z).multiply(at);
    this.geometries.push(slab(pts, t, c, holes).applyMatrix4(frame));
    this.rig.pieces.push({ name, joint: this.group, frame, outline: pts, holes, thickness: t });
  }

  /** A frontal piece in the plane z: pts are (x, y) in the figure's frame. */
  front(name: string, pts: readonly Pt[], z: number, t: number, c: Colours, holes?: readonly (readonly Pt[])[]): void {
    this.piece(name, pts, t, c, new THREE.Matrix4().makeTranslation(0, 0, z), holes);
  }

  /** A profile piece in the plane x: pts are (z, y) in the figure's frame; its front faces -x. */
  side(name: string, pts: readonly Pt[], x: number, t: number, c: Colours, holes?: readonly (readonly Pt[])[]): void {
    this.piece(name, pts, t, c, new THREE.Matrix4().makeTranslation(x, 0, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)), holes);
  }

  /** A level piece at height y: pts are (x, -z) in the figure's frame; its front faces up. */
  level(name: string, pts: readonly Pt[], y: number, t: number, c: Colours, tilt?: THREE.Matrix4): void {
    const at = new THREE.Matrix4().makeTranslation(0, y, 0).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    this.piece(name, pts, t, c, tilt ? tilt.clone().multiply(at) : at);
  }

  /** Merges the pieces hung here into one mesh: one draw (and one shadow draw) per joint. */
  finish(): void {
    if (!this.geometries.length) return;
    const merged = mergeGeometries(this.geometries);
    for (const g of this.geometries) g.dispose();
    const mesh = new THREE.Mesh(merged, paperMaterial());
    mesh.name = `${this.group.name} pieces`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }
}

const mirrorX = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]) => [-x, y] as Pt).reverse();
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** n points round an ellipse, rx across and ry up, centred on (cx, cy). */
const oval = (rx: number, ry: number, n: number, cx = 0, cy = 0): Pt[] =>
  Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as Pt;
  });
/** A disc (a hat's tier) seen from above: rx across, rz deep, round (cx, cz), as a level piece's (x, -z). */
const disc = (rx: number, rz: number, n: number, cx = 0, cz = 0): Pt[] => oval(rx, rz, n, cx, cz).map(([x, z]) => [x, -z] as Pt);
/** A band across the stroke from a to b, w wide. */
function bar(a: Pt, b: Pt, w: number): Pt[] {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = (-(b[1] - a[1]) / l) * (w / 2);
  const ny = ((b[0] - a[0]) / l) * (w / 2);
  return [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]];
}

// ---- the captain --------------------------------------------------------------------------------------------------

/** The colours and the joints' heights every part of a captain is cut from. */
interface Look {
  o: Outfit;
  s: number;
  g: number;
  hip: number;
  shoulder: number;
  neck: number;
  /** A skull's bone, or the skin a touch lighter than the outfit's (faces read pale in the shade). */
  skin: string;
  /** The coat's colour (null: no coat), and what is worn on the body's cards (the coat, or the shirt). */
  coat: string | null;
  cloth: string;
  /** Braid and buttons. */
  accent: string;
  extras: ReadonlySet<NonNullable<Outfit['extras']>[number]>;
}

export function buildCaptain(o: Outfit): CaptainModel {
  const s = o.height;
  const coat = o.cut === 'coat' || o.cut === 'navy' ? o.coat : null;
  const look: Look = {
    o, s, g: o.girth,
    hip: 0.197 * s,
    shoulder: 0.354 * s,
    neck: 0.371 * s,
    skin: o.cut === 'bones' ? o.skin : tone(o.skin, 0.1),
    coat,
    cloth: coat ?? o.shirt,
    accent: o.trim ?? mix(o.shirt, GOLD, 0.55),
    extras: new Set(o.extras ?? []),
  };
  const rig: Rig = { pieces: [], nodes: [] };
  const root = new THREE.Group();
  const body = new Node('body', new THREE.Vector3(0, look.hip, 0), rig);
  root.add(body.group);
  const torso = buildTorso(body, look);
  buildNeckwear(body, look, torso);
  const armX = coat ? armXFor(look.g, torso.wTop * 1.06, CARD) : armXFor(look.g, torso.wChest, shortSleeve(o));
  if (look.extras.has('epaulettes')) buildEpaulettes(body, look.shoulder, armX, look.accent);
  if (look.extras.has('parrot')) buildParrot(body, look.shoulder, armX);
  const arms = buildArms(body, look, armX);
  const legs = buildLegs(rig, root, look, torso);
  const head = body.child('head', new THREE.Vector3(0, look.neck, 0.004));
  buildHead(head, look);
  for (const n of rig.nodes) n.finish();
  return {
    root,
    parts: { body: body.group, head: head.group, ...arms, ...legs },
    pieces: rig.pieces,
  };
}

/**
 * Where the arms hang: on the shoulders, outside the body wherever the sleeve crosses its front (a coat's sleeve
 * near the shoulders, against wTop; a short sleeve, thicker with its stripes or its roll, swings across the chest).
 */
const armXFor = (g: number, body: number, sleeve: number) => Math.max(0.071 * g, body + sleeve / 2 + 0.006);
/** A short sleeve's thickest piece: its stripes, laid on both its faces, or a cook's roll. */
const STRIPED_SLEEVE = BAND + 2 * (LAYER + GAP);
const ROLL = BAND + 0.006;
const shortSleeve = (o: Outfit) => Math.max(BAND, o.stripes ? STRIPED_SLEEVE : 0, o.cut === 'apron' ? ROLL : 0);

// ---- the body -----------------------------------------------------------------------------------------------------

/** Where the body's cards are, for what is worn on them and hung below them. */
interface Torso {
  /** Its foot and its top; its half width at the foot, the chest and the shoulders. */
  foot: number;
  top: number;
  wFoot: number;
  wChest: number;
  wTop: number;
  /** Its depth before and behind the cross; the coat's back card. */
  zFront: number;
  zBack: number;
  backZ: number;
  /** The planes of the layers laid on its front, one on another. */
  z1: number;
  z2: number;
  z3: number;
  /** The waist's band (a belt, a sash): its foot and its top, if one is worn. */
  waist: readonly [number, number] | null;
}

function buildTorso(body: Node, look: Look): Torso {
  const { o, s, g, hip, extras } = look;
  const dg = Math.sqrt(g);
  const top = 0.366 * s;
  const foot = hip + 0.006;
  const wFoot = 0.07 * g;
  const wChest = 0.066 * g;
  const wTop = 0.058 * g;
  const zFront = 0.052 * dg;
  const zBack = -0.048 * dg;
  const chestY = 0.275 * s;
  const z1 = above(0, CARD, LAYER);
  const z2 = above(z1, LAYER, LAYER);
  const t: Torso = {
    foot, top, wFoot, wChest, wTop, zFront, zBack,
    backZ: zBack + 0.004,
    z1, z2, z3: above(z2, LAYER, LAYER),
    waist: extras.has('sash') ? [foot + 0.024 * s, foot + 0.054 * s] : extras.has('belt') ? [foot + 0.024 * s, foot + 0.044 * s] : null,
  };
  // its foot (a shirt torn at its hem: notches cut up into it)
  const hem: Pt[] = o.ragged ? Array.from({ length: 9 }, (_, i) => [-wFoot + (2 * wFoot * i) / 8, foot + (i % 2 ? 0.012 * s : 0)] as Pt) : [[-wFoot, foot], [wFoot, foot]];
  body.front('torso', [...hem, [wChest, chestY], [wTop, top], [-wTop, top], [-wChest, chestY]], 0, CARD, { front: look.cloth, back: tone(look.cloth, -0.06) });
  body.side('torso side', [[zBack, foot], [zFront, foot], [zFront * 0.92, chestY], [zFront * 0.7, top], [zBack * 0.7, top], [zBack, chestY]], 0, CARD, { front: tone(look.cloth, -0.05) });
  if (look.coat) {
    // the coat's back, a step behind the cross, narrower at its foot than the tails hung below it
    // (its foot higher than the front's: a leg swinging back turns its upper back up behind the hips)
    const backFoot = hip + 0.024 * s;
    body.front('coat back', [[-wFoot * 0.86, backFoot], [wFoot * 0.86, backFoot], [wChest, chestY], [wTop * 0.92, top], [-wTop * 0.92, top], [-wChest, chestY]], t.backZ, CARD, { front: tone(look.coat, -0.08), back: tone(look.coat, -0.04) });
  }
  // (the layers laid on the front start a little above the body's foot, where a leg's top swinging forward passes under
  // them, or above a waist band, which they would otherwise stand in front of)
  const lay = t.waist ? t.waist[1] + 0.002 : foot + 0.008 + (o.ragged ? 0.012 * s : 0);
  const widthAt = (y: number) => (y < chestY ? wFoot + ((wChest - wFoot) * (y - foot)) / (chestY - foot) : wChest + ((wTop - wChest) * (y - chestY)) / (top - chestY));
  if (o.cut === 'coat') printCoat(body, look, o.coat, t, lay);
  else if (o.cut === 'navy') printNavy(body, look, o.coat, t, lay);
  else printShirt(body, look, t, lay, widthAt);
  buildWaist(body, look, t);
  return t;
}

/** A long coat open on what is under it: a waistcoat (or a shirt) between its faced fronts, braid across them. */
function printCoat(body: Node, look: Look, coat: string, t: Torso, lay: number): void {
  const { s, accent } = look;
  const { foot, top, wTop, wChest, z1, z2 } = t;
  const open = (y: number) => 0.016 + 0.014 * ((y - foot) / (top - foot));
  body.front('shirt', [[-open(foot), lay], [open(foot), lay], [open(top), top - 0.006], [0, top - 0.03 * s], [-open(top), top - 0.006]], z1, LAYER, { front: look.o.shirt });
  // the coat's front edge, faced in a darker cloth, and its lapel at the neck
  const lapel = Math.min(open(top) + 0.03, wTop - 0.004);
  const edge: Pt[] = [[open(foot) + 0.002, lay], [open(foot) + 0.012, lay], [open(top) + 0.014, top - 0.014], [lapel, top], [open(top) + 0.006, top], [open(top) + 0.002, top - 0.03 * s]];
  // the braid across the fronts, as frogging, above a waist band
  const braid0 = Math.max(foot + 0.045 * s, (t.waist?.[1] ?? 0) + 0.012);
  for (const [side, tag] of SIDES) {
    body.front(`facing ${tag}`, side > 0 ? edge : mirrorX(edge), z1, LAYER, { front: tone(coat, -0.14) });
    for (let k = 0; k < 3; k++) {
      const y = braid0 + k * 0.03 * s;
      const x0 = side * (open(y) + 0.012);
      const len = Math.max(0.008, Math.min(0.026, wChest * 0.92 - open(y) - 0.012));
      body.front(`braid ${tag} ${k}`, bar([x0, y], [x0 + side * len, y], 0.007), z2, LAYER, { front: accent });
    }
  }
  for (let k = 0; k < 3; k++) body.front(`button ${k}`, box(-0.004, foot + 0.05 * s + k * 0.026 * s, 0.004, foot + 0.058 * s + k * 0.026 * s), z2, LAYER, { front: accent });
}

/** A navy officer's coat buttoned double: a lighter breast panel, two rows of gold buttons. */
function printNavy(body: Node, look: Look, coat: string, t: Torso, lay: number): void {
  const { s, g } = look;
  const { foot, top, z1, z2 } = t;
  body.front('breast', [[-0.034 * g, lay], [0.034 * g, lay], [0.042 * g, top - 0.004], [-0.042 * g, top - 0.004]], z1, LAYER, { front: tone(coat, 0.08) });
  for (let k = 0; k < 4; k++) {
    const y = foot + 0.04 * s + k * 0.03 * s;
    for (const [side, tag] of SIDES) body.front(`button ${tag} ${k}`, box(side * 0.018 - 0.0045, y, side * 0.018 + 0.0045, y + 0.009), z2, LAYER, { front: look.accent });
  }
}

/** A shirt (or the shirt under an apron, or a skeleton's): open at the neck, its stripes front and back. */
function printShirt(body: Node, look: Look, t: Torso, lay: number, widthAt: (y: number) => number): void {
  const { o, s, g } = look;
  const { top, z1, z2, z3 } = t;
  const bones = o.cut === 'bones';
  if (o.stripes) {
    for (let y = lay + 0.006 * s; y < top - 0.03 * s; y += 0.026 * s) {
      const w = widthAt(y + 0.006 * s) - 0.002;
      for (const [z, tag] of [[z1, 'front'], [-z1, 'back']] as const) body.front(`stripe ${tag} ${y.toFixed(3)}`, box(-w, y, w, y + 0.011 * s), z, LAYER, { front: o.stripes });
    }
  }
  body.front('open neck', [[-0.02, top + 0.001], [0.02, top + 0.001], [0, top - 0.04 * s]], z2, LAYER, { front: bones ? HOLLOW : tone(look.skin, -0.04) });
  if (bones) body.front('collarbone', bar([-0.016, top - 0.012], [0.016, top - 0.012], 0.006), z3, LAYER, { front: o.skin });
  if (o.cut === 'apron') {
    // (further forward than the shirt's layers, so higher off the foot: a leg's top swings up further there)
    body.front('apron bib', [[-0.046 * g, lay + 0.012], [0.046 * g, lay + 0.012], [0.04 * g, 0.31 * s], [-0.04 * g, 0.31 * s]], z3, LAYER, { front: LINEN });
    body.front('apron pocket', box(-0.02 * g, 0.24 * s, 0.02 * g, 0.27 * s), above(z3, LAYER, LAYER), LAYER, { front: tone(LINEN, -0.08) });
    for (const [side, tag] of SIDES) body.front(`apron strap ${tag}`, bar([side * 0.036 * g, 0.31 * s], [side * 0.03 * g, t.top], 0.008), z3, LAYER, { front: LINEN });
  }
}

/**
 * Round the waist: a belt with its buckle, or a sash knotted on the hip, each a band slotted into a cross of its own
 * round the body; a baldric across the chest.
 */
function buildWaist(body: Node, look: Look, t: Torso): void {
  const { s, extras } = look;
  const { wFoot, zFront, zBack, foot, top } = t;
  const onBand = above(0, BAND, LAYER);
  if (t.waist) {
    const [y0, y1] = t.waist;
    const sash = extras.has('sash');
    const colour = sash ? RED : LEATHER;
    const name = sash ? 'sash' : 'belt';
    body.front(name, box(-wFoot - 0.002, y0, wFoot + 0.002, y1), 0, BAND, { front: colour });
    body.side(`${name} side`, box(zBack - 0.003, y0, zFront + 0.003, y1), 0, BAND, { front: colour });
    if (sash) body.front('sash knot', [[wFoot * 0.55, y1 + 0.004], [wFoot * 0.85, y1 + 0.002], [wFoot * 0.92, y0 - 0.002], [wFoot * 0.6, y0 - 0.004]], onBand, LAYER, { front: tone(RED, -0.12) });
    else body.front('buckle', box(-0.013, y0 - 0.003, 0.013, y1 + 0.003), onBand, LAYER, { front: GOLD });
  }
  if (extras.has('strap')) {
    // a baldric from the right shoulder down to the left hip, its buckle on the chest
    const a: Pt = [-t.wTop * 0.75, top - 0.004];
    const b: Pt = [wFoot * 0.8, foot + 0.064 * s];
    body.front('strap', bar(a, b, 0.016), t.z3, LAYER, { front: LEATHER });
    const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    body.front('strap buckle', box(m[0] - 0.007, m[1] - 0.007, m[0] + 0.007, m[1] + 0.007), above(t.z3, LAYER, LAYER), LAYER, { front: GOLD });
  }
}

/** The collar round the neck (a frontal band and a profile band), and a jabot or a scarf on it. */
function buildNeckwear(body: Node, look: Look, t: Torso): void {
  const { o, s } = look;
  const { top, wTop, zFront, zBack, z2, z3 } = t;
  const neckwear = o.neck;
  const collar = neckwear?.kind === 'scarf' ? neckwear.colour : look.coat ? tone(look.coat, -0.12) : o.cut === 'bones' ? o.skin : tone(o.shirt, -0.06);
  // (below the neck's joint: the head turns and nods above it)
  const collarTop = look.neck - 0.004;
  const collarFoot = top - 0.022 * s;
  body.front('collar', [[-wTop, collarFoot], [wTop, collarFoot], [wTop * 0.8, collarTop], [-wTop * 0.8, collarTop]], 0, BAND, { front: collar, back: tone(collar, -0.06) });
  body.side('collar side', [[zBack * 0.8, collarFoot], [zFront * 0.8, collarFoot], [zFront * 0.7, collarTop], [zBack * 0.7, collarTop]], 0, BAND, { front: collar });
  const onCollar = above(0, BAND, LAYER);
  if (o.cut === 'navy') body.front('collar braid', box(-wTop * 0.8, collarTop - 0.006, wTop * 0.8, collarTop - 0.002), onCollar, LAYER, { front: look.accent });
  if (neckwear?.kind === 'scarf') {
    // a striped scarf: stripes round the collar, its two ends hanging down the chest
    const stripe = neckwear.stripes ?? tone(collar, -0.3);
    for (const x of [-0.03, -0.006, 0.018]) body.front(`scarf stripe ${x}`, box(x, collarFoot + 0.002, x + 0.01, collarTop - 0.002), onCollar, LAYER, { front: stripe });
    for (const [i, x0, drop] of [[0, 0.01, 0.075], [1, 0.03, 0.06]] as const) {
      const y1 = collarFoot - drop * s;
      const fringe: Pt[] = Array.from({ length: 5 }, (_, k) => [x0 + 0.02 - (0.02 * k) / 4, y1 + (k % 2 ? 0.006 : 0)] as Pt);
      const endZ = z2 + i * (LAYER + GAP);
      body.front(`scarf end ${i}`, [[x0, collarFoot + 0.004], [x0 + 0.02, collarFoot + 0.004], ...fringe], endZ, LAYER, { front: collar });
      for (let k = 0; k < 2; k++) {
        const y = collarFoot - (0.018 + k * 0.022) * s;
        body.front(`scarf end ${i} stripe ${k}`, box(x0, y, x0 + 0.02, y + 0.007), above(endZ, LAYER, LAYER), LAYER, { front: stripe });
      }
    }
  }
  if (neckwear?.kind === 'jabot') {
    // a lace jabot falling from the collar, in two tiers
    const tier = (w: number, y0: number, y1: number): Pt[] => {
      const at = (k: number) => y0 - (y0 - y1) * k;
      return [[-w, y0], [w, y0], [w * 1.1, at(0.5)], [w * 0.5, at(0.62)], [w * 0.7, at(0.8)], [0, y1], [-w * 0.7, at(0.8)], [-w * 0.5, at(0.62)], [-w * 1.1, at(0.5)]];
    };
    body.front('jabot', tier(0.02, collarFoot + 0.004, collarFoot - 0.06 * s), z3, LAYER, { front: neckwear.colour });
    body.front('jabot tier', tier(0.013, collarFoot + 0.002, collarFoot - 0.036 * s), above(z3, LAYER, LAYER), LAYER, { front: tone(neckwear.colour, -0.06) });
  }
}

// ---- the arms -----------------------------------------------------------------------------------------------------

/**
 * The arms: profile cards on the shoulders beside the body, bent forward (z, y from the shoulder: the right one
 * reaches forward to the lantern, the left hangs lower); a coat's long sleeve and turned-back cuff, or a short sleeve
 * and the bare forearm; a hand; the lantern below the right hand, a ladle beside the left.
 */
function buildArms(body: Node, look: Look, armX: number): Record<'arm_l' | 'arm_r' | 'lantern', THREE.Object3D> {
  const { o, s, shoulder, extras } = look;
  const bones = o.cut === 'bones';
  const hand = extras.has('gloves') ? LINEN : look.skin;
  const parts = {} as Record<'arm_l' | 'arm_r' | 'lantern', THREE.Object3D>;
  for (const [side, tag] of SIDES) {
    const arm = body.child(`arm_${tag}`, new THREE.Vector3(side * armX, shoulder, 0));
    parts[`arm_${tag}`] = arm.group;
    const x = side * armX;
    const reach: Pt = side < 0 ? [0.11, -0.095] : [0.058, -0.138];
    const along = (k: number): Pt => [reach[0] * k, shoulder + reach[1] * k * s];
    const sleeveTop: Pt = [reach[0] * 0.15, shoulder + 0.01 * s];
    if (look.coat) {
      arm.side(`sleeve ${tag}`, bar(sleeveTop, along(0.9), 0.034), x, CARD, { front: look.coat });
      arm.side(`cuff ${tag}`, bar(along(0.74), along(0.9), 0.036), x, BAND, { front: o.cut === 'navy' ? look.coat : look.accent });
      if (o.cut === 'navy') for (const k of [0.78, 0.84]) arm.side(`cuff ${tag} braid ${k}`, bar(along(k), along(k + 0.025), 0.037), x, STRIPED_SLEEVE, { front: look.accent });
    } else {
      // a short sleeve to the elbow (rolled up on a cook), the forearm bare below it
      const end = o.cut === 'apron' ? 0.5 : 0.46;
      arm.side(`forearm ${tag}`, bar(along(end - 0.06), along(0.92), bones ? 0.011 : 0.024), x, bones ? 0.009 : CARD, { front: look.skin });
      arm.side(`sleeve ${tag}`, bar(sleeveTop, along(end), 0.034), x, BAND, { front: o.shirt });
      if (o.stripes) for (const k of [0.22, 0.38]) arm.side(`sleeve ${tag} stripe ${k}`, bar(along(k - 0.04), along(k + 0.02), 0.036), x, STRIPED_SLEEVE, { front: o.stripes });
      if (o.cut === 'apron') arm.side(`roll ${tag}`, bar(along(end - 0.08), along(end + 0.02), 0.038), x, ROLL, { front: tone(o.shirt, 0.18) });
    }
    const hc = along(1);
    arm.side(`hand ${tag}`, oval(HAND_R, HAND_R, 7, hc[0], hc[1]), x, HAND, { front: hand });
    if (side < 0) parts.lantern = buildLantern(arm, x, hc).group;
    else if (extras.has('ladle')) {
      // carried beside the hand, never across the arm
      const [lz, ly] = hc;
      const ladle: Pt[] = [[lz - 0.004, ly + 0.012], [lz + 0.004, ly + 0.012], [lz + 0.004, ly - 0.05], [lz + 0.018, ly - 0.06], [lz + 0.018, ly - 0.078], [lz, ly - 0.086], [lz - 0.018, ly - 0.078], [lz - 0.018, ly - 0.06], [lz - 0.004, ly - 0.05]];
      arm.side('ladle', ladle, x + HAND / 2 + CARD / 2 + 0.004, CARD, { front: TIN });
    }
  }
  return parts;
}

/**
 * The lantern: two window frames slotted in a cross round a glowing cross, a cap, a hook and a base; hung on
 * its own joint just below the hand (hx: the hand's plane, hand: its centre), on the hand's outer side, so it swings
 * clear of the hand and the legs.
 */
function buildLantern(arm: Node, hx: number, hand: Pt): Node {
  const x = hx - 0.012;
  const lan = arm.child('lantern', new THREE.Vector3(x, hand[1] - HAND_R - 0.004, hand[0]));
  const { y: y0, z: z0 } = lan.pivot;
  const frame = { front: FRAME };
  const top = y0 - 0.032;
  const bottom = y0 - 0.095;
  const window = (u: number): Pt[] => box(u - 0.024, bottom, u + 0.024, top);
  const pane = (u: number): Pt[] => box(u - 0.016, bottom + 0.008, u + 0.016, top - 0.008);
  const cap = (u: number): Pt[] => [[u - 0.03, top], [u + 0.03, top], [u, y0 - 0.014]];
  lan.front('lantern frame', window(x), z0, 0.009, frame, [pane(x)]);
  lan.side('lantern frame side', window(z0), x, 0.009, frame, [pane(z0)]);
  lan.front('lantern cap', cap(x), z0, 0.013, frame);
  lan.side('lantern cap side', cap(z0), x, 0.013, frame);
  lan.side('lantern hook', box(z0 - 0.004, top + 0.002, z0 + 0.004, y0 - 0.001), x, 0.005, frame);
  const base = 0.005;
  lan.level('lantern base', box(x - 0.026, -z0 - 0.026, x + 0.026, -z0 + 0.026), bottom - base / 2, base, frame);
  const glowA = new THREE.Mesh(new THREE.PlaneGeometry(0.037, top - bottom - 0.015), glowMaterial());
  glowA.name = 'lantern glow';
  glowA.position.set(0, (top + bottom) / 2 - y0, 0);
  const glowB = glowA.clone();
  glowB.rotation.y = Math.PI / 2;
  lan.group.add(glowA, glowB);
  return lan;
}

/** Gold epaulettes: a level disc over each shoulder (clear above the arm), its fringe hanging outside the arm. */
function buildEpaulettes(body: Node, shoulder: number, armX: number, gold: string): void {
  for (const [side, tag] of SIDES) {
    // (over the arm's outer half, clear of the head as it turns and of the arm's top as it reaches)
    body.level(`epaulette ${tag}`, disc(0.02, 0.022, 8, side * (armX + 0.01), 0), shoulder + 0.044, 0.008, { front: gold, back: tone(gold, -0.25) });
    body.side(`epaulette fringe ${tag}`, box(-0.02, shoulder + 0.018, 0.02, shoulder + 0.04), side * (armX + CARD / 2 + 0.012), CARD, { front: tone(gold, -0.1) });
  }
}

/** The parrot over the right shoulder: a profile body slotted through a frontal head, a wing, a beak, its tail. */
function buildParrot(body: Node, shoulder: number, armX: number): void {
  // (beyond the arm's plane, clear of the head as it turns)
  const x = -(armX + 0.02);
  const y = shoulder + 0.034;
  body.side('parrot', [[-0.016, y], [0.016, y], [0.022, y + 0.04], [0.016, y + 0.072], [-0.004, y + 0.082], [-0.016, y + 0.062], [-0.044, y - 0.03], [-0.034, y - 0.036]], x, CARD, { front: PARROT });
  body.side('parrot wing', [[-0.012, y + 0.012], [0.008, y + 0.046], [-0.006, y + 0.05], [-0.036, y - 0.02]], x, BAND, { front: tone(PARROT, -0.18) });
  body.side('parrot tail', [[-0.03, y - 0.018], [-0.022, y - 0.024], [-0.05, y - 0.05], [-0.058, y - 0.044]], x, BAND, { front: PARROT_TAIL });
  body.side('parrot beak', [[0.012, y + 0.07], [0.03, y + 0.062], [0.014, y + 0.052]], x, 0.014, { front: GOLD });
  body.front('parrot face', box(x - 0.01, y + 0.054, x + 0.01, y + 0.078), 0.008, CARD, { front: tone(PARROT, 0.12) });
  for (const [side, tag] of SIDES) body.side(`parrot eye ${tag}`, box(0.002, y + 0.064, 0.01, y + 0.072), x + side * (CARD / 2 + INK), INK, ink(EYE));
}

// ---- the legs -----------------------------------------------------------------------------------------------------

/** The legs on the hips, and what of the coat hangs below the waist. */
function buildLegs(rig: Rig, root: THREE.Group, look: Look, t: Torso): Record<'leg_l' | 'leg_r', THREE.Object3D> {
  const { o, s, g, hip, extras } = look;
  const legX = Math.max(0.031 * g, 0.022);
  const hem = (o.cut === 'coat' ? 0.085 : o.cut === 'navy' ? 0.1 : 0.08) * s;
  // (the tails' sides just outside the body's foot, so a side turned up as its leg swings back never meets it)
  const tailW = o.cut === 'apron' ? 0.055 * g : t.wFoot + 0.008;
  const parts = {} as Record<'leg_l' | 'leg_r', THREE.Object3D>;
  for (const [side, tag] of SIDES) {
    const leg = new Node(`leg_${tag}`, new THREE.Vector3(side * legX, hip, 0), rig);
    root.add(leg.group);
    parts[`leg_${tag}`] = leg.group;
    buildLeg(leg, look, tag, extras.has('peg') && side < 0);
    if (!look.coat && o.cut !== 'apron') continue;
    // the tail on this leg: its front in the hip joint's plane (so its top turns in place), its side outside the body
    const colour = look.coat ?? LINEN;
    const inner = side * 0.01;
    const outer = side * tailW;
    const flare = side * 0.008;
    const tTop = hip - 0.002;
    const tail: Pt[] = side > 0 ? [[inner, hem], [outer + flare, hem], [outer, tTop], [inner, tTop]] : [[outer + flare, hem], [inner, hem], [inner, tTop], [outer, tTop]];
    leg.front(`tail ${tag}`, tail, 0, CARD, { front: colour, back: tone(colour, -0.1) });
    if (look.coat) {
      leg.front(`tail hem ${tag}`, side > 0 ? box(inner, hem, outer + flare, hem + 0.016 * s) : box(outer + flare, hem, inner, hem + 0.016 * s), t.z1, LAYER, { front: look.accent });
      leg.side(`tail side ${tag}`, [[t.backZ, hem], [0, hem], [0, tTop], [t.backZ * 0.9, tTop]], outer + flare * 0.5, CARD, { front: tone(colour, -0.06) });
    }
  }
  return parts;
}

/**
 * A leg (z, y from the hip, its top just below the joint so it never rises into the body): trousers,
 * their cuff and a boot; trousers to mid-shin (rolled up, or torn) over a bare shin and a shoe or a bone's foot; tall
 * boots to the knee; a wooden peg.
 */
function buildLeg(leg: Node, look: Look, tag: string, peg: boolean): void {
  const { o, s, hip } = look;
  const x = leg.pivot.x;
  const y = (v: number) => hip + v * s;
  const bareShin = o.shins !== undefined;
  // (long trousers come down to the boot's cuff, or to the shoe)
  const end = bareShin ? y(-0.112) : o.feet === 'shoes' ? 0.026 : y(-0.119);
  const torn: Pt[] = o.shins === 'torn' ? [[-0.016, end + 0.002], [-0.006, end + 0.012], [0.004, end], [0.012, end + 0.01]] : [];
  leg.side(`trousers ${tag}`, [[-0.026, end], ...torn, [0.024, end], [0.029, hip - 0.006], [-0.031, hip - 0.006]], x, CARD, { front: o.trousers });
  if (o.shins === 'rolled') leg.side(`turn-up ${tag}`, box(-0.03, end, 0.028, end + 0.02 * s), x, BAND, { front: tone(o.trousers, 0.18) });
  if (peg) {
    leg.side(`peg ${tag}`, [[-0.006, 0], [0.006, 0], [0.014, end + 0.004], [-0.014, end + 0.004]], x, CARD, { front: WOOD });
    leg.side(`peg band ${tag}`, box(-0.016, end - 0.012, 0.016, end - 0.004), x, BAND, { front: tone(WOOD, -0.3) });
    return;
  }
  if (bareShin) {
    const bone = o.feet === 'bones';
    leg.side(`shin ${tag}`, box(bone ? -0.006 : -0.014, 0.012, bone ? 0.006 : 0.012, end + 0.004), x, bone ? 0.009 : CARD, { front: look.skin });
  } else if (o.feet === undefined) {
    leg.side(`cuff ${tag}`, [[-0.033, y(-0.116)], [0.031, y(-0.116)], [0.031, y(-0.094)], [-0.033, y(-0.094)]], x, BAND, { front: CUFF });
  }
  switch (o.feet) {
    case 'shoes':
      leg.side(`shoe ${tag}`, [[-0.026, 0], [0.056, 0], [0.058, 0.014], [0.03, 0.028], [-0.026, 0.028]], x, 0.015, { front: o.boots });
      break;
    case 'bones':
      leg.side(`foot ${tag}`, [[-0.018, 0], [0.05, 0], [0.05, 0.01], [0.012, 0.02], [-0.018, 0.02]], x, 0.012, { front: o.boots });
      break;
    case 'tall':
      leg.side(`boot ${tag}`, [[-0.029, 0], [0.064, 0], [0.068, y(-0.177)], [0.033, y(-0.151)], [0.03, y(-0.07)], [-0.03, y(-0.07)]], x, 0.015, { front: o.boots });
      leg.side(`boot top ${tag}`, [[-0.034, y(-0.082)], [0.034, y(-0.082)], [0.036, y(-0.058)], [-0.036, y(-0.058)]], x, BAND + 0.002, { front: tone(o.boots, 0.12) });
      break;
    default:
      leg.side(`boot ${tag}`, [[-0.029, 0], [0.064, 0], [0.068, y(-0.177)], [0.033, y(-0.151)], [0.027, y(-0.105)], [-0.029, y(-0.105)]], x, 0.015, { front: o.boots });
  }
}

// ---- the head -----------------------------------------------------------------------------------------------------

/** Where the head's pieces go: its joint, its face's plane, and the two ways a head's outline is drawn. */
interface Head {
  node: Node;
  look: Look;
  neck: number;
  /** How much wider the head is (a stout captain's). */
  k: number;
  /** The head's joint's z; the face card's plane, and the plane of an ink laid on the face. */
  pz: number;
  faceZ: number;
  onFace: number;
  /**
   * A profile outline (z from the joint, y from the neck) or a frontal one (x, y from the neck) in the figure's frame.
   */
  zy(pts: readonly Pt[]): Pt[];
  xy(pts: readonly Pt[]): Pt[];
}

/** The hat's brim, above the neck (times the height). */
const BRIM = 0.16;
/**
 * A bandana's band: its foot below the brim; the hair under it stops just below that at the front, and under its cap
 * behind.
 */
const BANDANA_DROP = 0.04;
const TUCK_FRONT = BRIM - BANDANA_DROP - 0.004;
const TUCK_BACK = BRIM - 0.004;

function buildHead(node: Node, look: Look): void {
  const { o, s, skin } = look;
  const neck = node.pivot.y;
  const pz = node.pivot.z;
  // (a stout captain's head a little wider)
  const k = 1 + (o.girth - 1) * 0.4;
  const faceZ = pz + 0.011;
  const h: Head = {
    node, look, neck, k, pz, faceZ,
    onFace: above(faceZ, FACE, INK),
    zy: (pts) => pts.map(([z, y]) => [pz + z, neck + y * s] as Pt),
    xy: (pts) => pts.map(([x, y]) => [x * k, neck + y * s] as Pt),
  };
  // the neck (from its joint up: the collar stands below it)
  node.side('neck', h.zy([[-0.026, 0.001], [0.021, 0.001], [0.021, 0.032], [-0.026, 0.032]]), 0, HEAD, { front: tone(skin, -0.08) });
  if (o.cut === 'bones') buildSkull(h);
  else buildFace(h);
  buildHat(h);
}

/** The noses on the profile's front edge (z, y): a plain one, a round bulb, a long straight one, a small one. */
const NOSES: Record<NonNullable<Outfit['nose']> | 'plain', Pt[]> = {
  plain: [[0.069, 0.06], [0.091, 0.068], [0.074, 0.087]],
  bulb: [[0.069, 0.056], [0.084, 0.056], [0.096, 0.066], [0.09, 0.08], [0.074, 0.087]],
  long: [[0.069, 0.06], [0.1, 0.062], [0.074, 0.09]],
  small: [[0.069, 0.062], [0.084, 0.068], [0.072, 0.084]],
};

/** A face: a ten-sided card, the profile slotted through it, the eyes, the face's touches, hair, whiskers. */
function buildFace(h: Head): void {
  const { node, look, xy, zy, faceZ, onFace } = h;
  const { o, skin } = look;
  const marks = new Set(o.face ?? []);
  node.front('face', xy([[0.067, 0.08], [0.054, 0.12], [0.021, 0.145], [-0.021, 0.145], [-0.054, 0.12], [-0.067, 0.08], [-0.054, 0.039], [-0.021, 0.014], [0.021, 0.014], [0.054, 0.039]]), faceZ, FACE, { front: skin, back: o.hair });
  node.side('head side', zy([[-0.064, 0.03], [0.019, 0.013], [0.055, 0.03], ...NOSES[o.nose ?? 'plain'], [0.064, 0.113], [0.031, 0.143], [-0.029, 0.149], [-0.07, 0.119], [-0.083, 0.077]]), 0, HEAD, { front: skin });
  // the eyes: small cards on the face and on both sides of the profile
  const eyeY = 0.077;
  for (const [side, tag] of SIDES) {
    node.front(`eye ${tag}`, xy(box(side * 0.019, eyeY, side * 0.033, eyeY + 0.017)), onFace, INK, ink(EYE));
    node.side(`eye side ${tag}`, zy(box(0.038, eyeY, 0.052, eyeY + 0.017)), side * (HEAD / 2 + INK), INK, ink(EYE));
    // lashes: a small flick off the eye's outer corner
    if (marks.has('lashes')) node.front(`lash ${tag}`, xy([[side * 0.029, eyeY + 0.017], [side * 0.034, eyeY + 0.012], [side * 0.039, eyeY + 0.019], [side * 0.036, eyeY + 0.021]]), onFace, INK, ink(EYE));
    if (marks.has('blush')) node.front(`cheek ${tag}`, xy(oval(0.011, 0.007, 6, side * 0.044, 0.05)), onFace, INK, ink(mix(skin, BLUSH, 0.45)));
    if (marks.has('hoops')) {
      // a gold ring hanging below the ear, beside the jaw
      const ring = (r: number) => oval(r, r, 8, side * 0.064 * h.k, h.neck + 0.042 * look.s);
      node.front(`hoop ${tag}`, ring(0.008), faceZ, 0.004, ink(GOLD), [ring(0.0048)]);
    }
  }
  if (marks.has('freckles')) for (const [fx, fy] of [[-0.03, 0.06], [-0.022, 0.054], [-0.038, 0.054], [0.03, 0.06], [0.022, 0.054], [0.038, 0.054]]) node.front(`freckle ${fx} ${fy}`, xy(box(fx - 0.002, fy - 0.002, fx + 0.002, fy + 0.002)), onFace, INK, ink(tone(skin, -0.35)));
  buildHair(h);
  buildWhiskers(h, marks.has('lips'));
}

/**
 * A skull, built as the faces are: a round cranium card pinched at the cheekbones, its profile slotted through it
 * (flush with its front, so nothing stands across the nose), a jaw card in front of it with a grin of teeth; big round
 * sockets, an upturned heart of a nose, hollows under the cheekbones, a crack at the temple.
 */
function buildSkull(h: Head): void {
  const { node, xy, zy, faceZ, onFace } = h;
  const bone = h.look.o.skin;
  const dark = ink(HOLLOW);
  node.front('skull', xy([[0.07, 0.095], [0.066, 0.124], [0.046, 0.146], [0.016, 0.154], [-0.016, 0.154], [-0.046, 0.146], [-0.066, 0.124], [-0.07, 0.095], [-0.063, 0.066], [-0.05, 0.05], [-0.034, 0.04], [0.034, 0.04], [0.05, 0.05], [0.063, 0.066]]), faceZ, FACE, { front: bone, back: tone(bone, -0.08) });
  node.side('skull side', zy([[-0.05, 0.04], [-0.072, 0.056], [-0.086, 0.09], [-0.078, 0.126], [-0.044, 0.15], [0, 0.156], [0.011, 0.15], [0.011, 0.04], [0, 0.03], [-0.03, 0.032]]), 0, HEAD, { front: tone(bone, -0.04) });
  for (const [side, tag] of SIDES) {
    node.front(`socket ${tag}`, xy(oval(0.0155, 0.0165, 8, side * 0.024, 0.084)), onFace, INK, dark);
    // the socket seen from the side, the hollow under the cheekbone, the ear's hole
    const onSide = side * (HEAD / 2 + INK);
    node.side(`socket side ${tag}`, zy(oval(0.008, 0.012, 6, 0.002, 0.084)), onSide, INK, dark);
    node.front(`cheek ${tag}`, xy([[side * 0.062, 0.066], [side * 0.044, 0.062], [side * 0.04, 0.048], [side * 0.05, 0.05]]), onFace, INK, ink(tone(bone, -0.22)));
    node.side(`ear hole ${tag}`, zy(oval(0.007, 0.008, 6, -0.036, 0.07)), onSide, INK, dark);
  }
  node.front('nose hole', xy([[0, 0.068], [0.0085, 0.054], [0.0045, 0.049], [0, 0.053], [-0.0045, 0.049], [-0.0085, 0.054]]), onFace, INK, dark);
  const crack: Pt[] = [[0.042, 0.136], [0.05, 0.122], [0.045, 0.112], [0.053, 0.098]];
  node.front('crack', xy([...crack.map(([x, y]) => [x + 0.0015, y] as Pt), ...[...crack].reverse().map(([x, y]) => [x - 0.0015, y] as Pt)]), onFace, INK, dark);
  // the jaw, a card in front of the cranium, its grin: a dark gap and a row of teeth on it
  const jawZ = above(faceZ, FACE, CARD);
  const onJaw = above(jawZ, CARD, INK);
  node.front('jaw', xy([[-0.039, 0.046], [0.039, 0.046], [0.037, 0.02], [0.022, 0.005], [-0.022, 0.005], [-0.037, 0.02]]), jawZ, CARD, { front: tone(bone, -0.05), back: tone(bone, -0.12) });
  node.front('grin', xy(box(-0.031, 0.021, 0.031, 0.037)), onJaw, INK, dark);
  for (let i = 0; i < 6; i++) {
    const x = -0.028 + i * 0.0112;
    node.front(`tooth ${i}`, xy(box(x, 0.0235, x + 0.0088, 0.0345)), above(onJaw, INK, INK), INK, ink(tone(bone, 0.25)));
  }
}

/**
 * The hair: a thick card round the profile and a card behind the face, wider than it, a fringe under the hat; a tail
 * tied behind; a bob or a curly wig framing the face, cut longer, with a lock beside each cheek.
 */
function buildHair(h: Head): void {
  const { node, look, xy, zy, pz, faceZ } = h;
  const { o } = look;
  const hair = o.hair;
  const long = o.hairdo === 'bob' || o.hairdo === 'curls';
  const curls = o.hairdo === 'curls';
  // (a long cut ends just above the neck's joint, clear of the collar and the shoulders)
  const low = curls ? 0.022 : 0.034;
  const wavy = (x0: number, x1: number, y: number, n: number): Pt[] => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y + (curls && i % 2 ? 0.012 : 0)] as Pt);
  // under a bandana the hair stops at the band's foot at the front, and under its cap behind, never poking through
  const bandana = o.hat === 'bandana';
  const tuckSide = (pts: readonly Pt[]): Pt[] => (bandana ? pts.map(([z, y]) => [z, Math.min(y, z > -0.03 ? TUCK_FRONT : TUCK_BACK)] as Pt) : [...pts]);
  const tuckFront = (pts: readonly Pt[]): Pt[] => (bandana ? pts.map(([x, y]) => [x, Math.min(y, TUCK_FRONT)] as Pt) : [...pts]);
  node.side('hair side', zy(tuckSide(long
    ? [[-0.05, 0.07], [-0.019, 0.101], [0.031, 0.121], [0.064, 0.113], [0.074, 0.139], [0.019, 0.17], [-0.04, 0.17], [-0.1, 0.139], [-0.122, 0.1], ...wavy(-0.12, -0.04, low, 6)]
    : [[-0.091, 0.042], [-0.046, 0.056], [-0.019, 0.101], [0.031, 0.121], [0.064, 0.113], [0.074, 0.139], [0.019, 0.17], [-0.04, 0.17], [-0.091, 0.139], [-0.112, 0.113], [-0.095, 0.092], [-0.117, 0.068]])), 0, HAIR, { front: hair });
  node.front('hair back', xy(long
    ? [[-0.06, 0.13], [-0.09, 0.1], ...wavy(-0.092, 0.092, low, 10), [0.09, 0.1], [0.06, 0.13], [0.036, 0.16], [-0.036, 0.16]]
    : [[-0.06, 0.124], [-0.083, 0.096], [-0.066, 0.065], [-0.058, 0.033], [-0.025, 0.024], [0.005, 0.011], [0.032, 0.028], [0.068, 0.044], [0.071, 0.081], [0.081, 0.109], [0.055, 0.129], [0.036, 0.16], [-0.002, 0.155], [-0.042, 0.157]]), pz - 0.033, HEAD, { front: tone(hair, -0.08), back: hair });
  node.front('fringe', xy(tuckFront([[-0.062, 0.112], [0.062, 0.112], [0.05, 0.13], [0.021, 0.147], [-0.021, 0.147], [-0.05, 0.13]])), above(faceZ, FACE, LAYER), LAYER, { front: hair });
  if (long) {
    // a lock beside each cheek, between the face and the hair behind
    const lock = xy([[0.056, 0.13], [0.082, 0.12], [0.094, 0.08], ...wavy(0.092, 0.06, low + 0.004, 3), [0.06, 0.06]]);
    for (const [side, tag] of SIDES) node.front(`lock ${tag}`, side > 0 ? lock : mirrorX(lock), faceZ - FACE / 2 - GAP - CARD / 2, CARD, { front: tone(hair, 0.06), back: hair });
  }
  if (o.hairdo === 'ponytail') {
    node.side('ponytail', zy([[-0.1, 0.075], [-0.118, 0.094], [-0.136, 0.062], [-0.142, -0.02], [-0.128, -0.075], [-0.116, -0.036], [-0.11, 0.024]]), 0, 0.02, { front: hair });
    node.side('ponytail tie', zy(box(-0.13, 0.052, -0.106, 0.064)), 0, 0.03, { front: LEATHER });
  }
}

/**
 * A beard (a card over the jaw and its profile over the chin, the mouth and the moustache on it), a goatee, a mouth.
 */
function buildWhiskers(h: Head, red: boolean): void {
  const { node, look, xy, zy, faceZ, onFace } = h;
  const { o, skin } = look;
  const hair = o.hair;
  const on = above(faceZ, FACE, LAYER);
  const mouthColour = red ? RED : tone(skin, -0.45);
  switch (o.beard) {
    case 'full':
      // (down to the neck's joint, no further: the collar and the chest are below it)
      node.front('beard', xy([[-0.066, 0.078], [-0.04, 0.05], [0.04, 0.05], [0.066, 0.078], [0.058, 0.03], [0.03, 0.006], [0, 0.001], [-0.03, 0.006], [-0.058, 0.03]]), on, LAYER, { front: hair });
      node.side('beard side', zy([[-0.04, 0.072], [-0.004, 0.044], [0.05, 0.05], [0.072, 0.05], [0.07, 0.03], [0.05, 0.006], [0.02, 0.001], [-0.02, 0.006], [-0.05, 0.04]]), 0, 0.02, { front: hair });
      node.front('mouth', xy([[-0.012, 0.03], [0.012, 0.03], [0.008, 0.022], [-0.008, 0.022]]), above(on, LAYER, INK), INK, ink(MOUTH));
      node.front('moustache', xy([[-0.004, 0.058], [-0.03, 0.052], [-0.046, 0.04], [-0.036, 0.036], [-0.014, 0.044], [0, 0.046], [0.014, 0.044], [0.036, 0.036], [0.046, 0.04], [0.03, 0.052], [0.004, 0.058]]), above(on, LAYER, LAYER), LAYER, { front: tone(hair, 0.12) });
      return;
    case 'goatee':
      // (a thin moustache, its ends turned up)
      node.front('moustache', xy([[-0.004, 0.054], [-0.026, 0.05], [-0.042, 0.058], [-0.036, 0.05], [-0.014, 0.045], [0, 0.046], [0.014, 0.045], [0.036, 0.05], [0.042, 0.058], [0.026, 0.05], [0.004, 0.054]]), on, LAYER, { front: hair });
      node.front('mouth', xy([[-0.01, 0.034], [0.01, 0.034], [0.006, 0.029], [-0.006, 0.029]]), onFace, INK, ink(mouthColour));
      node.front('goatee', xy([[-0.009, 0.026], [0.009, 0.026], [0.006, 0.01], [0, 0.002], [-0.006, 0.01]]), on, LAYER, { front: hair });
      return;
    default:
      node.front('mouth', xy([[-0.012, 0.034], [0.012, 0.034], [0.007, 0.027], [-0.007, 0.027]]), onFace, INK, ink(mouthColour));
  }
}

// ---- the hat ------------------------------------------------------------------------------------------------------

/**
 * The hat on its brim: level discs stacked from the brim up (a brim, a band, two tiers of crown), tilted a little
 * back; a tricorn's brim a rounded triangle with three flaps turned up on it.
 */
function buildHat(h: Head): void {
  const { node, look } = h;
  const { o, s } = look;
  const brim = h.neck + BRIM * s;
  const cz = h.pz - 0.008;
  const c = o.hatColour;
  const shade = tone(c, -0.18);
  const tilt = new THREE.Matrix4().makeTranslation(0, brim, cz).multiply(new THREE.Matrix4().makeRotationX(-0.1)).multiply(new THREE.Matrix4().makeTranslation(0, -brim, -cz));
  const tilted = (m: THREE.Matrix4) => tilt.clone().multiply(m);
  // a tier: a disc of n corners, its bottom at y, t thick
  const tier = (name: string, rx: number, rz: number, n: number, y: number, t: number, colour: string, edge = tone(colour, -0.15)) =>
    node.level(name, disc(rx, rz, n, 0, cz), y + t / 2, t, { front: colour, back: tone(colour, -0.2), edge }, tilt);
  switch (o.hat) {
    case 'wide':
      tier('hat brim', 0.157, 0.168, 16, brim - 0.006, 0.012, c, CREAM);
      tier('hat band', 0.088, 0.092, 12, brim + 0.002, 0.02 * s, HAT_BAND);
      tier('hat crown', 0.079, 0.083, 12, brim + 0.016 * s, 0.026 * s, c, shade);
      tier('hat top', 0.06, 0.06, 10, brim + 0.04 * s, 0.022 * s, tone(c, 0.12), shade);
      if (o.feather) plume(node, o.feather, 0.1, brim + 0.012, cz, s, 1, tilt);
      break;
    case 'tricorn': {
      // the brim seen from above: a triangle, its point forward, its corners rounded; gold along its cut edge
      const corners: Pt[] = [[0, cz + 0.17], [0.15, cz - 0.1], [-0.15, cz - 0.1]];
      const tri: Pt[] = [];
      for (let i = 0; i < 3; i++) {
        const [ax, az] = corners[i];
        const [bx, bz] = corners[(i + 1) % 3];
        for (const t of [0.1, 0.5, 0.9]) tri.push([ax + (bx - ax) * t, -(az + (bz - az) * t)]);
      }
      node.level('hat brim', tri, brim, 0.012, { front: c, back: shade, edge: GOLD }, tilt);
      tier('hat crown', 0.072, 0.07, 10, brim + 0.006, 0.03 * s, c, shade);
      tier('hat top', 0.056, 0.054, 10, brim + 0.006 + 0.028 * s, 0.02 * s, tone(c, 0.1), shade);
      // the flaps turned up along the brim's sides, leaning out
      const lean = 0.35;
      const rise = 0.045 * s;
      for (let i = 0; i < 3; i++) {
        const a = new THREE.Vector3(corners[i][0], 0, corners[i][1]);
        const b = new THREE.Vector3(corners[(i + 1) % 3][0], 0, corners[(i + 1) % 3][1]);
        const ex = b.clone().sub(a).normalize();
        const out = new THREE.Vector3(0, 1, 0).cross(ex).negate();
        const ey = new THREE.Vector3(0, Math.cos(lean), 0).addScaledVector(out, Math.sin(lean));
        const ez = ex.clone().cross(ey);
        const len = a.distanceTo(b);
        const flap: Pt[] = [[len * 0.12, 0], [len * 0.88, 0], [len * 0.84, rise * 0.6], [len * 0.65, rise], [len * 0.35, rise], [len * 0.16, rise * 0.6]];
        const at = new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(a.x + out.x * 0.008, brim + 0.006, a.z + out.z * 0.008);
        node.piece(`hat flap ${i}`, flap, CARD, { front: c, back: shade, edge: GOLD }, tilted(at));
      }
      // (a plume rises inside the flaps, beside the crown)
      if (o.feather) plume(node, o.feather, -0.086, brim + 0.016, cz - 0.01, s, 0.75, tilt);
      break;
    }
    case 'bicorne': {
      tier('hat band', 0.074, 0.076, 12, brim - 0.006, 0.014, tone(c, -0.1));
      // a half moon from the front, slotted through a profile card of its own
      const moon: Pt[] = Array.from({ length: 11 }, (_, i) => [Math.cos((Math.PI * i) / 10) * 0.15, brim + 0.008 + Math.sin((Math.PI * i) / 10) * 0.075 * s] as Pt);
      const moonT = 0.016;
      node.piece('hat', moon, moonT, { front: c, back: shade, edge: GOLD }, tilted(new THREE.Matrix4().makeTranslation(0, 0, cz)));
      node.piece('hat side', [[cz - 0.05, brim + 0.008], [cz + 0.05, brim + 0.008], [cz + 0.02, brim + 0.07 * s], [cz - 0.02, brim + 0.07 * s]], HEAD, { front: tone(c, -0.08), edge: GOLD }, tilted(new THREE.Matrix4().makeRotationY(-Math.PI / 2)));
      node.piece('cockade', oval(0.014, 0.014, 8, -0.07, brim + 0.045 * s), LAYER, { front: GOLD }, tilted(new THREE.Matrix4().makeTranslation(0, 0, above(cz, moonT, LAYER))));
      break;
    }
    case 'bandana': {
      // a cloth cap over the head and its band round the brow, slotted in a cross; the knot and its tails behind
      tier('bandana', 0.074, 0.084, 12, brim - 0.016, 0.022, c);
      const y0 = brim - BANDANA_DROP * s;
      const y1 = brim - 0.008;
      node.front('bandana band', box(-0.072, y0, 0.072, y1), h.faceZ, BAND, { front: c, back: tone(c, -0.08) });
      // (its front end inside the brow band, so it never shows on the forehead)
      node.side('bandana band side', box(cz - 0.112, y0, h.faceZ - 0.004, y1), 0, BAND + 0.012, { front: c });
      if (o.dots) {
        for (const [dx, dy] of [[-0.05, 0.012], [-0.024, 0.022], [0, 0.01], [0.024, 0.022], [0.05, 0.012]]) node.front(`dot ${dx}`, oval(0.0045, 0.0045, 6, dx, y0 + dy * s), above(h.faceZ, BAND, INK), INK, ink(o.dots));
        for (const [dx, dz] of [[-0.04, 0.02], [0.02, 0.04], [0.03, -0.03], [-0.02, -0.04]]) node.level(`dot top ${dx}`, disc(0.006, 0.006, 6, dx, cz + dz), brim + 0.006 + INK, INK, ink(o.dots), tilt);
      }
      const knotZ = cz - 0.122;
      node.front('knot', oval(0.016, 0.014, 6, -0.03, y0 + 0.012), knotZ, BAND, { front: tone(c, -0.08) });
      node.front('knot tail', [[-0.04, y0 + 0.006], [-0.026, y0 + 0.004], [-0.06, y0 - 0.07 * s], [-0.074, y0 - 0.064 * s]], knotZ - BAND / 2 - CARD / 2 - 0.002, CARD, { front: c });
      break;
    }
    case 'cap':
      // a cook's low cap: a band in the shirt's colour, a puffed crown
      tier('cap band', 0.076, 0.08, 12, brim - 0.014, 0.018 * s, o.shirt);
      tier('cap', 0.084, 0.088, 12, brim + 0.004, 0.022 * s, c, tone(c, -0.1));
      tier('cap top', 0.07, 0.072, 12, brim + 0.026 * s, 0.012 * s, tone(c, 0.04), tone(c, -0.1));
      break;
  }
}

/** A plume rising from a hat's side and sweeping back: a profile card cut with barbs, its quill on it. */
function plume(node: Node, colour: string, x: number, y0: number, cz: number, s: number, size: number, tilt: THREE.Matrix4): void {
  const spine = (t: number): Pt => [cz + 0.01 - 0.1 * size * t * t, y0 + 0.13 * size * s * Math.sin((t * Math.PI) / 2)];
  const up: Pt[] = [];
  const down: Pt[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const [z, y] = spine(t);
    const w = 0.018 * size * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.002;
    up.push([z + w * 0.6, y + w * (i % 2 ? 1.25 : 1)]);
    down.push([z - w * 0.6, y - w * (i % 2 ? 1.25 : 1)]);
  }
  // (a profile card turned a little out from the side, so it never stands edge-on to the front)
  const at = tilt.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0, cz)).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2 - Math.sign(x) * 0.6)).multiply(new THREE.Matrix4().makeTranslation(-cz, 0, 0));
  node.piece('plume', [...up, ...down.reverse()], CARD, { front: colour, back: tone(colour, -0.08) }, at);
  const quill = Array.from({ length: 7 }, (_, i) => spine(i / 6));
  node.piece('plume quill', [...quill.map(([z, y]) => [z + 0.0015, y] as Pt), ...[...quill].reverse().map(([z, y]) => [z - 0.0015, y] as Pt)], CARD + 2 * (INK + GAP), { front: tone(colour, -0.3) }, at);
}
