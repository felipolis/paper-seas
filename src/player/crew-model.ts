/**
 * The captains as small 3D paper models, built the way papertrails builds its traveller (public/models/traveller.glb
 * there, read piece by piece): every piece a die-cut slab of card in one flat colour, its cut edge pale cream, the
 * pieces layered and slotted through each other so the figure reads from every side:
 *   - the head: a frontal face card (its back the hair's colour) with the head's profile card slotted through its
 *     middle, whose front edge is the nose and the chin; a thicker card of hair round the profile, a card of hair
 *     behind the face, small eye cards on the face and on both sides of the profile; a neck card below;
 *   - the body: a frontal and a profile card slotted into a cross, and what is worn on it layered in front (a
 *     waistcoat, its braid, a jabot, a scarf, a belt or a sash slotted into a cross of its own) and behind (the coat's
 *     back);
 *   - the arms and the legs: profile cards only (a sleeve bent forward, a thicker cuff, a hand; trousers, a thicker
 *     boot cuff, a boot with its toe), the right hand carrying the lantern in front of the body as the traveller does;
 *   - the hat: level discs stacked from the brim up, tilted a little back.
 * What hangs below the waist (a coat's tails, an apron) is cut in two and hung on the legs, so it swings with
 * them; nothing that moves against another piece cuts into it (tools/qa/crew-clips.mjs; pieces on one joint are
 * slotted through each other on purpose and never move apart).
 * The figure faces +z, stands on y = 0 and is papertrails' 0.6 tall (times its outfit's height). Its nodes, each on
 * its joint so the puppet moves them by rotation only: body (on the hips, carrying the arms and the head), leg_l and
 * leg_r, arm_l and arm_r, head, and the lantern below the right hand.
 */
import * as THREE from 'three';
import type { Outfit } from '../config/ships';
import { createPaperMaterial } from '../render/paper-material';
import { mix, tone } from '../art/paper-colour';
import type { Pt } from '../world/polyline';

export type PartName = 'body' | 'head' | 'leg_l' | 'leg_r' | 'arm_l' | 'arm_r' | 'lantern';

export interface CaptainModel {
  root: THREE.Group;
  parts: Record<PartName, THREE.Object3D>;
  /** Every piece, named (the clip check reports by name). */
  cards: THREE.Mesh[];
}

/** papertrails' cut edge, its boot cuff, its lantern's frame; the warm dark of an eye. */
const CREAM = '#fbf6ea';
const CUFF = '#e8d3ac';
const FRAME = '#513424';
const EYE = '#2a1a10';
const GAPS = '#4a3c30';
/** Gold braid and buckles, lace, a cook's apron, a sash, leather straps, a wooden peg. */
const GOLD = '#d9a341';
const LACE = '#f4efe4';
const APRON = '#f4efe4';
const SASH = '#b8443a';
const LEATHER = '#4a2a18';
const WOOD = '#8a5a34';
/** papertrails' card thicknesses: a card, a thicker band (a cuff, a belt), a thin layer laid on another, an eye. */
const CARD = 0.011;
const BAND = 0.017;
const LAYER = 0.004;
const INK = 0.001;

// ---- the pieces ----------------------------------------------------------------------------------------------------

/** A slab's colours: its front face, its back face and its cut edge. */
interface Colours {
  front: string;
  back?: string;
  edge?: string;
}

let paper: THREE.Material | null = null;
/** One matte card material for every piece: its colours are the slab's vertex colours. */
function paperMaterial(): THREE.Material {
  if (!paper) {
    paper = createPaperMaterial({ back: null, side: THREE.FrontSide });
    (paper as THREE.MeshLambertMaterial).vertexColors = true;
  }
  return paper;
}

/** A die-cut slab: the outline pts (and holes) extruded by t round z = 0, coloured front, back and edge. */
function slab(pts: readonly Pt[], t: number, c: Colours, holes: readonly Pt[][] = []): THREE.BufferGeometry {
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

/** A node of the puppet: its joint (absolute, in the figure's frame) and the pieces hung on it. */
class Node {
  readonly group = new THREE.Group();

  constructor(
    name: string,
    readonly pivot: THREE.Vector3,
    private readonly pieces: THREE.Mesh[],
    parent?: Node,
  ) {
    this.group.name = name;
    this.group.position.copy(parent ? pivot.clone().sub(parent.pivot) : pivot);
    parent?.group.add(this.group);
  }

  /** A slab cut to pts (its own x, y), placed by at (its frame to the figure's). */
  piece(name: string, pts: readonly Pt[], t: number, c: Colours, at: THREE.Matrix4, holes?: readonly Pt[][]): THREE.Mesh {
    const mesh = new THREE.Mesh(slab(pts, t, c, holes), paperMaterial());
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // its outline, thickness and joint, for the clip check
    mesh.userData = { outline: pts, thickness: t, joint: this.group.name };
    mesh.applyMatrix4(new THREE.Matrix4().makeTranslation(-this.pivot.x, -this.pivot.y, -this.pivot.z).multiply(at));
    this.group.add(mesh);
    this.pieces.push(mesh);
    return mesh;
  }

  /** A frontal piece in the plane z: pts are (x, y) in the figure's frame. */
  front(name: string, pts: readonly Pt[], z: number, t: number, c: Colours, holes?: readonly Pt[][]): THREE.Mesh {
    return this.piece(name, pts, t, c, new THREE.Matrix4().makeTranslation(0, 0, z), holes);
  }

  /** A profile piece in the plane x: pts are (z, y) in the figure's frame; its front faces +x. */
  side(name: string, pts: readonly Pt[], x: number, t: number, c: Colours, holes?: readonly Pt[][]): THREE.Mesh {
    return this.piece(name, pts, t, c, new THREE.Matrix4().makeTranslation(x, 0, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)), holes);
  }

  /** A level piece at height y: pts are (x, -z) in the figure's frame; its front faces up. */
  level(name: string, pts: readonly Pt[], y: number, t: number, c: Colours, tilt?: THREE.Matrix4): THREE.Mesh {
    const at = new THREE.Matrix4().makeTranslation(0, y, 0).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    return this.piece(name, pts, t, c, tilt ? tilt.clone().multiply(at) : at);
  }
}

const mirrorX = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]) => [-x, y] as Pt).reverse();
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** A disc of n corners (a hat's tier): rx across, rz deep, round (cx, cz), as a level piece's (x, -z). */
const disc = (rx: number, rz: number, n: number, cx = 0, cz = 0): Pt[] =>
  Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    return [cx + Math.cos(a) * rx, -(cz + Math.sin(a) * rz)] as Pt;
  });
/** A band across the stroke from a to b, w wide. */
function bar(a: Pt, b: Pt, w: number): Pt[] {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = (-(b[1] - a[1]) / l) * (w / 2);
  const ny = ((b[0] - a[0]) / l) * (w / 2);
  return [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]];
}

// ---- the captain -----------------------------------------------------------------------------------------------

export function buildCaptain(o: Outfit): CaptainModel {
  const s = o.height;
  const g = o.girth;
  const dg = Math.sqrt(g);
  const pieces: THREE.Mesh[] = [];
  const root = new THREE.Group();
  const parts: Partial<Record<PartName, THREE.Object3D>> = {};
  const extras = new Set(o.extras ?? []);
  const hip = 0.197 * s;
  const shoulder = 0.354 * s;
  const neck = 0.371 * s;
  const bones = o.cut === 'bones';
  const coated = o.cut === 'coat' || o.cut === 'navy';
  const skin = bones ? o.skin : tone(o.skin, 0.1);
  const accent = o.trim ?? mix(o.shirt, GOLD, 0.55);
  const coatColour = coated ? o.coat : o.shirt;

  // ---- the body: a frontal and a profile card in a cross, what is worn layered on them ----
  const body = new Node('body', new THREE.Vector3(0, hip, 0), pieces);
  root.add(body.group);
  parts.body = body.group;
  const top = 0.366 * s;
  // its half width at the foot, the chest and the shoulders; its depth before and behind the cross
  const foot = hip + 0.006;
  const wFoot = 0.07 * g;
  const wChest = 0.066 * g;
  const wTop = 0.058 * g;
  const zFront = 0.052 * dg;
  const zBack = -0.048 * dg;
  const chestY = 0.275 * s;
  const widthAt = (y: number) => (y < chestY ? wFoot + ((wChest - wFoot) * (y - foot)) / (chestY - foot) : wChest + ((wTop - wChest) * (y - chestY)) / (top - chestY));
  // its foot (a shirt torn at its hem: notches cut up into it)
  const hemEdge: Pt[] = o.ragged ? Array.from({ length: 9 }, (_, i) => [-wFoot + (2 * wFoot * i) / 8, foot + (i % 2 ? 0.012 * s : 0)] as Pt) : [[-wFoot, foot], [wFoot, foot]];
  const front: Pt[] = [...hemEdge, [wChest, chestY], [wTop, top], [-wTop, top], [-wChest, chestY]];
  body.front('torso', front, 0, CARD, { front: coatColour, back: tone(coatColour, -0.06) });
  body.side('torso side', [[zBack, foot], [zFront, foot], [zFront * 0.92, chestY], [zFront * 0.7, top], [zBack * 0.7, top], [zBack, chestY]], 0, CARD, { front: tone(coatColour, -0.05) });
  const backZ = zBack + 0.004;
  if (coated) {
    // the coat's back, a step behind the cross, narrower at its foot than the tails hung below it
    // (its foot higher than the front's: a leg swinging back turns its upper back up behind the hips)
    const backFoot = hip + 0.024 * s;
    body.front('coat back', [[-wFoot * 0.86, backFoot], [wFoot * 0.86, backFoot], [wChest, chestY], [wTop * 0.92, top], [-wTop * 0.92, top], [-wChest, chestY]], backZ, CARD, { front: tone(o.coat, -0.08), back: tone(o.coat, -0.04) });
  }
  // what shows at the front, in layers: the shirt (a waistcoat between a coat's fronts), braid, buttons, an apron
  const z1 = CARD / 2 + LAYER / 2 + 0.0005;
  const z2 = z1 + LAYER + 0.0005;
  const z3 = z2 + LAYER + 0.0005;
  // (the layers in front start a little above the body's foot: a leg's top swinging forward passes under them)
  const lay = foot + 0.008 + (o.ragged ? 0.012 * s : 0);
  if (o.cut === 'coat') {
    const open = (y: number) => 0.016 + 0.014 * ((y - foot) / (top - foot));
    const shirtPts: Pt[] = [[-open(foot), lay], [open(foot), lay], [open(top), top - 0.006], [0, top - 0.03 * s], [-open(top), top - 0.006]];
    body.front('shirt', shirtPts, z1, LAYER, { front: o.shirt });
    for (const side of [1, -1]) {
      // the coat's front edge, faced in a darker cloth, and its lapel at the neck
      const lapel = Math.min(open(top) + 0.03, wTop - 0.004);
      const edge: Pt[] = [[open(foot) + 0.002, lay], [open(foot) + 0.012, lay], [open(top) + 0.014, top - 0.014], [lapel, top], [open(top) + 0.006, top], [open(top) + 0.002, top - 0.03 * s]];
      body.front(`facing ${side > 0 ? 'l' : 'r'}`, side > 0 ? edge : mirrorX(edge), z1, LAYER, { front: tone(o.coat, -0.14) });
      // braid across the front, as frogging
      for (let k = 0; k < 3; k++) {
        const y = foot + 0.045 * s + k * 0.03 * s;
        const x0 = side * (open(y) + 0.012);
        body.front(`braid ${side > 0 ? 'l' : 'r'} ${k}`, bar([x0, y], [x0 + side * Math.min(0.026, wChest * 0.92 - open(y) - 0.012), y], 0.007), z2, LAYER, { front: accent });
      }
    }
    for (let k = 0; k < 3; k++) body.front(`button ${k}`, box(-0.004, foot + 0.05 * s + k * 0.026 * s, 0.004, foot + 0.058 * s + k * 0.026 * s), z2, LAYER, { front: accent });
  } else if (o.cut === 'navy') {
    // buttoned double: a lighter breast panel, two rows of gold buttons
    body.front('breast', [[-0.034 * g, lay], [0.034 * g, lay], [0.042 * g, top - 0.004], [-0.042 * g, top - 0.004]], z1, LAYER, { front: tone(o.coat, 0.08) });
    for (let k = 0; k < 4; k++) {
      for (const side of [1, -1]) {
        const y = foot + 0.04 * s + k * 0.03 * s;
        body.front(`button ${side > 0 ? 'l' : 'r'} ${k}`, box(side * 0.018 - 0.0045, y, side * 0.018 + 0.0045, y + 0.009), z2, LAYER, { front: accent });
      }
    }
  } else {
    // a shirt (or the shirt under an apron): open at the neck, its stripes front and back
    if (o.stripes) {
      for (let y = lay + 0.006 * s; y < top - 0.03 * s; y += 0.026 * s) {
        const w = widthAt(y + 0.006 * s) - 0.002;
        for (const [z, tag] of [[z1, 'front'], [-z1, 'back']] as const) body.front(`stripe ${tag} ${y.toFixed(3)}`, box(-w, y, w, y + 0.011 * s), z, LAYER, { front: o.stripes });
      }
    }
    body.front('open neck', [[-0.02, top + 0.001], [0.02, top + 0.001], [0, top - 0.04 * s]], z2, LAYER, { front: bones ? GAPS : tone(skin, -0.04) });
    if (bones) body.front('collarbone', bar([-0.016, top - 0.012], [0.016, top - 0.012], 0.006), z3, LAYER, { front: o.skin });
    if (o.cut === 'apron') {
      // (further forward than the shirt's layers, so higher off the foot: a leg's top swings up further there)
      body.front('apron bib', [[-0.046 * g, lay + 0.012], [0.046 * g, lay + 0.012], [0.04 * g, 0.31 * s], [-0.04 * g, 0.31 * s]], z3, LAYER, { front: APRON });
      body.front('apron pocket', box(-0.02 * g, 0.24 * s, 0.02 * g, 0.27 * s), z3 + LAYER + 0.0005, LAYER, { front: tone(APRON, -0.08) });
      for (const side of [1, -1]) body.front(`apron strap ${side > 0 ? 'l' : 'r'}`, bar([side * 0.036 * g, 0.31 * s], [side * 0.03 * g, top], 0.008), z3, LAYER, { front: APRON });
    }
  }
  // the collar round the neck: a frontal band and a profile band (papertrails' scarf)
  const collar = o.neck?.kind === 'scarf' ? o.neck.colour : coated ? tone(o.coat, -0.12) : bones ? o.skin : tone(o.shirt, -0.06);
  // (below the neck's joint: the head turns and nods above it)
  const collarTop = neck - 0.004;
  const collarFoot = top - 0.022 * s;
  body.front('collar', [[-wTop, collarFoot], [wTop, collarFoot], [wTop * 0.8, collarTop], [-wTop * 0.8, collarTop]], 0, BAND, { front: collar, back: tone(collar, -0.06) });
  body.side('collar side', [[zBack * 0.8, collarFoot], [zFront * 0.8, collarFoot], [zFront * 0.7, collarTop], [zBack * 0.7, collarTop]], 0, BAND, { front: collar });
  const onCollar = BAND / 2 + LAYER / 2 + 0.0005;
  if (o.cut === 'navy') body.front('collar braid', box(-wTop * 0.8, collarTop - 0.006, wTop * 0.8, collarTop - 0.002), onCollar, LAYER, { front: accent });
  if (o.neck?.kind === 'scarf') {
    // a striped scarf: stripes round the collar, its two ends hanging down the chest
    const stripe = o.neck.stripes ?? tone(collar, -0.3);
    for (const x of [-0.03, -0.006, 0.018]) body.front(`scarf stripe ${x}`, box(x, collarFoot + 0.002, x + 0.01, collarTop - 0.002), onCollar, LAYER, { front: stripe });
    for (const [i, x0, drop] of [[0, 0.01, 0.075], [1, 0.03, 0.06]] as const) {
      const y1 = collarFoot - drop * s;
      const fringe: Pt[] = Array.from({ length: 5 }, (_, k) => [x0 + 0.02 - (0.02 * k) / 4, y1 + (k % 2 ? 0.006 : 0)] as Pt);
      body.front(`scarf end ${i}`, [[x0, collarFoot + 0.004], [x0 + 0.02, collarFoot + 0.004], ...fringe], z2 + i * (LAYER + 0.0005), LAYER, { front: collar });
      for (let k = 0; k < 2; k++) {
        const y = collarFoot - (0.018 + k * 0.022) * s;
        body.front(`scarf end ${i} stripe ${k}`, box(x0, y, x0 + 0.02, y + 0.007), z3 + 0.001 + i * (LAYER + 0.0005), LAYER, { front: stripe });
      }
    }
  }
  if (o.neck?.kind === 'jabot') {
    // a lace jabot falling from the collar, in two tiers
    const tierPts = (w: number, y0: number, y1: number): Pt[] => [[-w, y0], [w, y0], [w * 1.1, y0 - (y0 - y1) * 0.5], [w * 0.5, y0 - (y0 - y1) * 0.62], [w * 0.7, y0 - (y0 - y1) * 0.8], [0, y1], [-w * 0.7, y0 - (y0 - y1) * 0.8], [-w * 0.5, y0 - (y0 - y1) * 0.62], [-w * 1.1, y0 - (y0 - y1) * 0.5]];
    body.front('jabot', tierPts(0.02, collarFoot + 0.004, collarFoot - 0.06 * s), z3, LAYER, { front: o.neck.colour });
    body.front('jabot tier', tierPts(0.013, collarFoot + 0.002, collarFoot - 0.036 * s), z3 + LAYER + 0.0005, LAYER, { front: tone(o.neck.colour, -0.06) });
  }
  // round the waist: a belt or a sash, each a band slotted into a cross of its own round the body
  const waistBand = (name: string, colour: string, h: number) => {
    const y0 = foot + 0.024 * s;
    const y1 = y0 + h * s;
    body.front(name, box(-wFoot - 0.002, y0, wFoot + 0.002, y1), 0, BAND, { front: colour });
    body.side(`${name} side`, box(zBack - 0.003, y0, zFront + 0.003, y1), 0, BAND, { front: colour });
    return [y0, y1] as const;
  };
  const onBand = BAND / 2 + LAYER / 2 + 0.0005;
  if (extras.has('sash')) {
    const [y0, y1] = waistBand('sash', SASH, 0.03);
    body.front('sash knot', [[wFoot * 0.55, y1 + 0.004], [wFoot * 0.85, y1 + 0.002], [wFoot * 0.92, y0 - 0.002], [wFoot * 0.6, y0 - 0.004]], onBand, LAYER, { front: tone(SASH, -0.12) });
  } else if (extras.has('belt') || o.cut === 'coat') {
    const [y0, y1] = waistBand('belt', LEATHER, 0.02);
    body.front('buckle', box(-0.013, y0 - 0.003, 0.013, y1 + 0.003), onBand, LAYER, { front: '#d9a341' });
  }
  if (extras.has('strap')) {
    // a baldric from the right shoulder down to the left hip, its buckle on the chest
    const a: Pt = [-wTop * 0.75, top - 0.004];
    const b: Pt = [wFoot * 0.8, foot + 0.064 * s];
    body.front('strap', bar(a, b, 0.016), z3, LAYER, { front: LEATHER });
    const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    body.front('strap buckle', box(m[0] - 0.007, m[1] - 0.007, m[0] + 0.007, m[1] + 0.007), z3 + LAYER + 0.0005, LAYER, { front: GOLD });
  }
  const armX = coated ? armXFor(g, wTop * 1.06, CARD) : armXFor(g, wChest, BAND + 0.006);
  if (extras.has('epaulettes')) buildEpaulettes(body, shoulder, armX, accent);
  if (extras.has('parrot')) buildParrot(body, shoulder, armX);

  // ---- the arms: profile cards on the shoulders beside the body, bent forward; the lantern in the right hand ----
  const short = !coated;
  const hand = extras.has('gloves') ? LACE : skin;
  for (const side of [1, -1]) {
    const name: PartName = side > 0 ? 'arm_l' : 'arm_r';
    const tag = side > 0 ? 'l' : 'r';
    const arm = new Node(name, new THREE.Vector3(side * armX, shoulder, 0), pieces, body);
    parts[name] = arm.group;
    const x = side * armX;
    // papertrails' sleeves (z, y from the shoulder): the right one reaches forward to the lantern, the left hangs lower
    const reach: Pt = side < 0 ? [0.11, -0.095] : [0.058, -0.138];
    const along = (t: number): Pt => [reach[0] * t, shoulder + reach[1] * t * s];
    const elbow: Pt = [reach[0] * 0.15, shoulder + 0.01 * s];
    if (short) {
      // a short sleeve to the elbow (rolled up on a cook), the forearm bare below it
      const end = o.cut === 'apron' ? 0.5 : 0.46;
      arm.side(`forearm ${tag}`, bar(along(end - 0.06), along(0.92), bones ? 0.011 : 0.024), x, bones ? 0.009 : CARD, { front: skin });
      arm.side(`sleeve ${tag}`, bar(elbow, along(end), 0.034), x, BAND, { front: o.shirt });
      if (o.stripes) for (const t of [0.22, 0.38]) arm.side(`sleeve ${tag} stripe ${t}`, bar(along(t - 0.04), along(t + 0.02), 0.036), x, BAND + 2 * LAYER + 0.001, { front: o.stripes });
      if (o.cut === 'apron') arm.side(`roll ${tag}`, bar(along(end - 0.08), along(end + 0.02), 0.038), x, BAND + 0.006, { front: tone(o.shirt, 0.18) });
    } else {
      arm.side(`sleeve ${tag}`, bar(elbow, along(0.9), 0.034), x, CARD, { front: o.coat });
      arm.side(`cuff ${tag}`, bar(along(0.74), along(0.9), 0.036), x, BAND, { front: o.cut === 'navy' ? o.coat : accent });
      if (o.cut === 'navy') for (const t of [0.78, 0.84]) arm.side(`cuff ${tag} braid ${t}`, bar(along(t), along(t + 0.025), 0.037), x, BAND + 2 * LAYER + 0.001, { front: accent });
    }
    const hc = along(1);
    arm.side(`hand ${tag}`, Array.from({ length: 7 }, (_, k) => [hc[0] + Math.cos((2 * Math.PI * k) / 7) * 0.018, hc[1] + Math.sin((2 * Math.PI * k) / 7) * 0.018] as Pt), x, 0.015, { front: hand });
    if (extras.has('ladle') && side > 0) {
      // carried beside the hand, never across the arm
      const [lz, ly] = hc;
      const ladle: Pt[] = [[lz - 0.004, ly + 0.012], [lz + 0.004, ly + 0.012], [lz + 0.004, ly - 0.05], [lz + 0.018, ly - 0.06], [lz + 0.018, ly - 0.078], [lz, ly - 0.086], [lz - 0.018, ly - 0.078], [lz - 0.018, ly - 0.06], [lz - 0.004, ly - 0.05]];
      arm.side('ladle', ladle, x + 0.0075 + CARD / 2 + 0.004, CARD, { front: '#a8a49a' });
    }
    if (side < 0) parts.lantern = buildLantern(arm, armX, shoulder, s, pieces).group;
  }

  // ---- the legs: profile cards on the hips (trousers, cuff, boot), and what of the coat hangs below the waist ----
  const legX = Math.max(0.031 * g, 0.022);
  const hem = (o.cut === 'coat' ? 0.085 : o.cut === 'navy' ? 0.1 : 0.08) * s;
  const skirt = coated || o.cut === 'apron';
  // (the tails' sides just outside the body's foot, so a side turned up as its leg swings back never meets it)
  const tailW = o.cut === 'apron' ? 0.055 * g : wFoot + 0.008;
  for (const side of [1, -1]) {
    const name: PartName = side > 0 ? 'leg_l' : 'leg_r';
    const tag = side > 0 ? 'l' : 'r';
    const leg = new Node(name, new THREE.Vector3(side * legX, hip, 0), pieces);
    root.add(leg.group);
    parts[name] = leg.group;
    buildLeg(leg, o, side * legX, hip, s, tag, extras.has('peg') && side < 0, skin);
    if (skirt) {
      // the tail on this leg: its front in the hip joint's plane (so its top turns in place), its side outside the body
      const colour = o.cut === 'apron' ? APRON : o.coat;
      const inner = side * 0.01;
      const outer = side * tailW;
      const flare = side * 0.008;
      const tTop = hip - 0.002;
      const tail: Pt[] = side > 0 ? [[inner, hem], [outer + flare, hem], [outer, tTop], [inner, tTop]] : [[outer + flare, hem], [inner, hem], [inner, tTop], [outer, tTop]];
      leg.front(`tail ${tag}`, tail, 0, CARD, { front: colour, back: tone(colour, -0.1) });
      if (o.cut !== 'apron') {
        leg.front(`tail hem ${tag}`, side > 0 ? box(inner, hem, outer + flare, hem + 0.016 * s) : box(outer + flare, hem, inner, hem + 0.016 * s), z1, LAYER, { front: accent });
        leg.side(`tail side ${tag}`, [[backZ, hem], [0, hem], [0, tTop], [backZ * 0.9, tTop]], outer + flare * 0.5, CARD, { front: tone(colour, -0.06) });
      }
    }
  }

  // ---- the head: the face and the profile slotted through it, the hair round them, the eyes, the hat ----
  const head = new Node('head', new THREE.Vector3(0, neck, 0.004), pieces, body);
  parts.head = head.group;
  buildHead(head, o, s, skin);
  return { root, parts: parts as Record<PartName, THREE.Object3D>, cards: pieces };
}

/**
 * Where the arms hang: papertrails' shoulders, outside the body wherever the sleeve crosses its front (a coat's sleeve
 * near the shoulders, wTop; a short sleeve, thicker with its stripes or its roll, swings across the chest, wChest).
 */
const armXFor = (g: number, body: number, sleeve: number) => Math.max(0.071 * g, body + sleeve / 2 + 0.006);

/**
 * A leg, papertrails' (z, y from the hip, its top just below the joint so it never rises into the body): trousers,
 * their cuff and a boot; trousers to mid-shin (rolled up, or torn) over a bare shin and a shoe or a bone's foot; tall
 * boots to the knee; a wooden peg.
 */
function buildLeg(leg: Node, o: Outfit, x: number, hip: number, s: number, tag: string, peg: boolean, skin: string): void {
  const y = (v: number) => hip + v * s;
  const short = o.shins !== undefined;
  // (long trousers come down to the boot's cuff, or to the shoe)
  const foot = short ? y(-0.112) : o.feet === 'shoes' ? 0.026 : y(-0.119);
  const torn: Pt[] = o.shins === 'torn' ? [[-0.016, foot + 0.002], [-0.006, foot + 0.012], [0.004, foot], [0.012, foot + 0.01]] : [];
  leg.side(`trousers ${tag}`, [[-0.026, foot], ...torn, [0.024, foot], [0.029, hip - 0.006], [-0.031, hip - 0.006]], x, CARD, { front: o.trousers });
  if (o.shins === 'rolled') leg.side(`turn-up ${tag}`, box(-0.03, foot, 0.028, foot + 0.02 * s), x, BAND, { front: tone(o.trousers, 0.18) });
  if (peg) {
    leg.side(`peg ${tag}`, [[-0.006, 0], [0.006, 0], [0.014, foot + 0.004], [-0.014, foot + 0.004]], x, CARD, { front: WOOD });
    leg.side(`peg band ${tag}`, box(-0.016, foot - 0.012, 0.016, foot - 0.004), x, BAND, { front: tone(WOOD, -0.3) });
    return;
  }
  if (short) {
    const bone = o.feet === 'bones';
    leg.side(`shin ${tag}`, box(bone ? -0.006 : -0.014, 0.012, bone ? 0.006 : 0.012, foot + 0.004), x, bone ? 0.009 : CARD, { front: skin });
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

// ---- the head ----------------------------------------------------------------------------------------------------

function buildHead(head: Node, o: Outfit, s: number, skin: string): void {
  const neck = head.pivot.y;
  const pz = head.pivot.z;
  const bones = o.cut === 'bones';
  const marks = new Set(o.face ?? []);
  const k = 1 + (o.girth - 1) * 0.4;
  // (z, y) from the head's joint; (x, y) from the neck
  const zy = (pts: readonly Pt[]): Pt[] => pts.map(([z, y]) => [pz + z, neck + y * s] as Pt);
  const xy = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]) => [x * k, neck + y * s] as Pt);
  const hair = bones ? o.skin : o.hair;
  // the neck (from its joint up: the collar stands below it)
  head.side('neck', zy([[-0.026, 0.001], [0.021, 0.001], [0.021, 0.032], [-0.026, 0.032]]), 0, 0.014, { front: tone(skin, -0.08) });
  // the face: papertrails' ten-sided card, its back the hair
  const faceZ = pz + 0.011;
  const onFace = faceZ + 0.006 + INK;
  const face = xy([[0.067, 0.08], [0.054, 0.12], [0.021, 0.145], [-0.021, 0.145], [-0.054, 0.12], [-0.067, 0.08], [-0.054, 0.039], [-0.021, 0.014], [0.021, 0.014], [0.054, 0.039]]);
  head.front('face', face, faceZ, 0.012, { front: skin, back: hair });
  // the profile slotted through it: its front edge the nose and the chin, the back of the head behind
  const nose: Pt[] =
    o.beard === 'full' || (marks.has('blush') && o.girth > 1.1)
      ? [[0.069, 0.056], [0.084, 0.056], [0.096, 0.066], [0.09, 0.08], [0.074, 0.087]]
      : o.cut === 'navy' || o.beard === 'goatee'
        ? [[0.069, 0.06], [0.1, 0.062], [0.074, 0.09]]
        : o.hairdo
          ? [[0.069, 0.062], [0.084, 0.068], [0.072, 0.084]]
          : [[0.069, 0.06], [0.091, 0.068], [0.074, 0.087]];
  head.side('head side', zy(bones ? [[-0.064, 0.03], [0.019, 0.004], [0.06, 0.02], [0.07, 0.06], [0.066, 0.113], [0.031, 0.143], [-0.029, 0.149], [-0.07, 0.119], [-0.083, 0.077]] : [[-0.064, 0.03], [0.019, 0.013], [0.055, 0.03], ...nose, [0.064, 0.113], [0.031, 0.143], [-0.029, 0.149], [-0.07, 0.119], [-0.083, 0.077]]), 0, 0.014, { front: skin });
  // the eyes: small cards on the face and on both sides of the profile
  const eyeY = 0.077;
  for (const side of [1, -1]) {
    const tag = side > 0 ? 'l' : 'r';
    if (bones) {
      head.front(`socket ${tag}`, xy(box(side * 0.014, 0.07, side * 0.036, 0.098)), onFace, INK, { front: GAPS, edge: GAPS });
      continue;
    }
    head.front(`eye ${tag}`, xy(box(side * 0.019, eyeY, side * 0.033, eyeY + 0.017)), onFace, INK, { front: EYE, edge: EYE });
    head.side(`eye side ${tag}`, zy(box(0.038, eyeY, 0.052, eyeY + 0.017)), side * (0.007 + INK), INK, { front: EYE, edge: EYE });
    // lashes: a small flick off the eye's outer corner
    if (marks.has('lips')) head.front(`lash ${tag}`, xy([[side * 0.029, eyeY + 0.017], [side * 0.034, eyeY + 0.012], [side * 0.039, eyeY + 0.019], [side * 0.036, eyeY + 0.021]]), onFace, INK, { front: EYE, edge: EYE });
    if (marks.has('blush')) head.front(`cheek ${tag}`, xy(disc(0.011, 0.007, 6, side * 0.044, 0).map(([px, pzz]) => [px, -pzz + 0.05] as Pt)), onFace, INK, { front: mix(skin, '#e0705a', 0.45), edge: mix(skin, '#e0705a', 0.45) });
    if (marks.has('hoops')) {
      const hx = side * 0.064 * k;
      head.front(`hoop ${tag}`, disc(0.008, 0.008, 8, hx, 0).map(([px, pzz]) => [px, -pzz + neck + 0.042 * s] as Pt), faceZ, 0.004, { front: GOLD, edge: GOLD }, [disc(0.0048, 0.0048, 8, hx, 0).map(([px, pzz]) => [px, -pzz + neck + 0.042 * s] as Pt)]);
    }
  }
  if (marks.has('freckles')) for (const [fx, fy] of [[-0.03, 0.06], [-0.022, 0.054], [-0.038, 0.054], [0.03, 0.06], [0.022, 0.054], [0.038, 0.054]]) head.front(`freckle ${fx} ${fy}`, xy(box(fx - 0.002, fy - 0.002, fx + 0.002, fy + 0.002)), onFace, INK, { front: tone(skin, -0.35), edge: tone(skin, -0.35) });
  if (bones) {
    head.front('nose hole', xy([[-0.007, 0.05], [0.007, 0.05], [0, 0.066]]), onFace, INK, { front: GAPS, edge: GAPS });
    head.front('teeth', xy(box(-0.03, 0.022, 0.03, 0.034)), onFace, INK, { front: GAPS, edge: GAPS });
    for (let i = -2; i <= 2; i++) head.front(`tooth ${i}`, xy(box(i * 0.012 - 0.0045, 0.024, i * 0.012 + 0.0045, 0.032)), onFace + INK + 0.0002, INK, { front: o.skin, edge: o.skin });
  } else {
    buildHair(head, o, faceZ, zy, xy, hair);
    buildWhiskers(head, o, faceZ, xy, zy, hair, skin, marks.has('lips'));
  }
  buildHat(head, o, s, neck + 0.16 * s, pz - 0.008);
}

/**
 * The hair: a thick card round the profile and a card behind the face, wider than it, a fringe under the hat; a tail
 * tied behind; a bob or a curly wig framing the face, cut longer, with a lock beside each cheek.
 */
function buildHair(head: Node, o: Outfit, faceZ: number, zy: (p: readonly Pt[]) => Pt[], xy: (p: readonly Pt[]) => Pt[], hair: string): void {
  const pz = head.pivot.z;
  const long = o.hairdo === 'bob' || o.hairdo === 'curls';
  const curls = o.hairdo === 'curls';
  // (a long cut ends just above the neck's joint, clear of the collar and the shoulders)
  const low = curls ? 0.022 : 0.034;
  const wavy = (x0: number, x1: number, y: number, n: number): Pt[] => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y + (curls && i % 2 ? 0.012 : 0)] as Pt);
  head.side('hair side', zy(long
    ? [[-0.05, 0.07], [-0.019, 0.101], [0.031, 0.121], [0.064, 0.113], [0.074, 0.139], [0.019, 0.17], [-0.04, 0.17], [-0.1, 0.139], [-0.122, 0.1], ...wavy(-0.12, -0.04, low, 6)]
    : [[-0.091, 0.042], [-0.046, 0.056], [-0.019, 0.101], [0.031, 0.121], [0.064, 0.113], [0.074, 0.139], [0.019, 0.17], [-0.04, 0.17], [-0.091, 0.139], [-0.112, 0.113], [-0.095, 0.092], [-0.117, 0.068]]), 0, 0.025, { front: hair });
  head.front('hair back', xy(long
    ? [[-0.06, 0.13], [-0.09, 0.1], ...wavy(-0.092, 0.092, low, 10), [0.09, 0.1], [0.06, 0.13], [0.036, 0.16], [-0.036, 0.16]]
    : [[-0.06, 0.124], [-0.083, 0.096], [-0.066, 0.065], [-0.058, 0.033], [-0.025, 0.024], [0.005, 0.011], [0.032, 0.028], [0.068, 0.044], [0.071, 0.081], [0.081, 0.109], [0.055, 0.129], [0.036, 0.16], [-0.002, 0.155], [-0.042, 0.157]]), pz - 0.033, 0.014, { front: tone(hair, -0.08), back: hair });
  head.front('fringe', xy([[-0.062, 0.112], [0.062, 0.112], [0.05, 0.13], [0.021, 0.147], [-0.021, 0.147], [-0.05, 0.13]]), faceZ + 0.006 + LAYER / 2 + 0.0005, LAYER, { front: hair });
  if (long) {
    // a lock beside each cheek, between the face and the hair behind
    for (const side of [1, -1]) {
      const lock = xy([[0.056, 0.13], [0.082, 0.12], [0.094, 0.08], ...wavy(0.092, 0.06, low + 0.004, 3), [0.06, 0.06]]);
      head.front(`lock ${side > 0 ? 'l' : 'r'}`, side > 0 ? lock : mirrorX(lock), faceZ - 0.006 - 0.0005 - CARD / 2, CARD, { front: tone(hair, 0.06), back: hair });
    }
  }
  if (o.hairdo === 'ponytail') {
    head.side('ponytail', zy([[-0.1, 0.075], [-0.118, 0.094], [-0.136, 0.062], [-0.142, -0.02], [-0.128, -0.075], [-0.116, -0.036], [-0.11, 0.024]]), 0, 0.02, { front: hair });
    head.side('ponytail tie', zy(box(-0.13, 0.052, -0.106, 0.064)), 0, 0.03, { front: LEATHER });
  }
}

/** A beard (a card over the jaw and its profile over the chin, the mouth and the moustache on it), a moustache, a goatee. */
function buildWhiskers(head: Node, o: Outfit, faceZ: number, xy: (p: readonly Pt[]) => Pt[], zy: (p: readonly Pt[]) => Pt[], hair: string, skin: string, red: boolean): void {
  const on = faceZ + 0.006 + LAYER / 2 + 0.0005;
  const onFace = faceZ + 0.006 + INK;
  const mouthColour = red ? '#b8443a' : tone(skin, -0.45);
  const moustache = xy([[-0.004, 0.058], [-0.03, 0.052], [-0.046, 0.04], [-0.036, 0.036], [-0.014, 0.044], [0, 0.046], [0.014, 0.044], [0.036, 0.036], [0.046, 0.04], [0.03, 0.052], [0.004, 0.058]]);
  switch (o.beard) {
    case 'full':
      // (down to the neck's joint, no further: the collar and the chest are below it)
      head.front('beard', xy([[-0.066, 0.078], [-0.04, 0.05], [0.04, 0.05], [0.066, 0.078], [0.058, 0.03], [0.03, 0.006], [0, 0.001], [-0.03, 0.006], [-0.058, 0.03]]), on, LAYER, { front: hair });
      head.side('beard side', zy([[-0.04, 0.072], [-0.004, 0.044], [0.05, 0.05], [0.072, 0.05], [0.07, 0.03], [0.05, 0.006], [0.02, 0.001], [-0.02, 0.006], [-0.05, 0.04]]), 0, 0.02, { front: hair });
      head.front('mouth', xy([[-0.012, 0.03], [0.012, 0.03], [0.008, 0.022], [-0.008, 0.022]]), on + LAYER / 2 + INK / 2 + 0.0003, INK, { front: '#5a2a1e', edge: '#5a2a1e' });
      head.front('moustache', moustache, on + LAYER + 0.0005, LAYER, { front: tone(hair, 0.12) });
      return;
    case 'moustache':
      head.front('moustache', moustache, on, LAYER, { front: hair });
      head.front('mouth', xy([[-0.01, 0.031], [0.01, 0.031], [0.006, 0.025], [-0.006, 0.025]]), onFace, INK, { front: mouthColour, edge: mouthColour });
      return;
    case 'goatee':
      // (a thin moustache, its ends turned up)
      head.front('moustache', xy([[-0.004, 0.054], [-0.026, 0.05], [-0.042, 0.058], [-0.036, 0.05], [-0.014, 0.045], [0, 0.046], [0.014, 0.045], [0.036, 0.05], [0.042, 0.058], [0.026, 0.05], [0.004, 0.054]]), on, LAYER, { front: hair });
      head.front('mouth', xy([[-0.01, 0.034], [0.01, 0.034], [0.006, 0.029], [-0.006, 0.029]]), onFace, INK, { front: mouthColour, edge: mouthColour });
      head.front('goatee', xy([[-0.009, 0.026], [0.009, 0.026], [0.006, 0.01], [0, 0.002], [-0.006, 0.01]]), on, LAYER, { front: hair });
      return;
    default:
      head.front('mouth', xy([[-0.012, 0.034], [0.012, 0.034], [0.007, 0.027], [-0.007, 0.027]]), onFace, INK, { front: mouthColour, edge: mouthColour });
  }
}

// ---- the hat -----------------------------------------------------------------------------------------------------

/**
 * The hat on its brim at height brim: level discs stacked from the brim up (papertrails' straw hat: a brim, a band,
 * two tiers of crown), tilted a little back; a tricorn's brim a rounded triangle with three flaps turned up on it.
 */
function buildHat(head: Node, o: Outfit, s: number, brim: number, cz: number): void {
  const c = o.hatColour;
  const shade = tone(c, -0.18);
  const tilt = new THREE.Matrix4().makeTranslation(0, brim, cz).multiply(new THREE.Matrix4().makeRotationX(-0.1)).multiply(new THREE.Matrix4().makeTranslation(0, -brim, -cz));
  // a tier: a disc of n corners, its bottom at y, t thick
  const tier = (name: string, rx: number, rz: number, n: number, y: number, t: number, colour: string, edge = tone(colour, -0.15)) =>
    head.level(name, disc(rx, rz, n, 0, cz), y + t / 2, t, { front: colour, back: tone(colour, -0.2), edge }, tilt);
  switch (o.hat) {
    case 'wide':
      tier('hat brim', 0.157, 0.168, 16, brim - 0.006, 0.012, c, CREAM);
      tier('hat band', 0.088, 0.092, 12, brim + 0.002, 0.02 * s, '#bb6140');
      tier('hat crown', 0.079, 0.083, 12, brim + 0.016 * s, 0.026 * s, c, shade);
      tier('hat top', 0.06, 0.06, 10, brim + 0.04 * s, 0.022 * s, tone(c, 0.12), shade);
      if (o.feather) plume(head, o.feather, 0.1, brim + 0.012, cz, s, 1, tilt);
      break;
    case 'tricorn': {
      // the brim seen from above: a triangle, its point forward, its corners rounded; gold along its cut edge
      const tri: Pt[] = [];
      const corners: Pt[] = [[0, cz + 0.17], [0.15, cz - 0.1], [-0.15, cz - 0.1]];
      for (let i = 0; i < 3; i++) {
        const [ax, az] = corners[i];
        const [bx, bz] = corners[(i + 1) % 3];
        for (const t of [0.1, 0.5, 0.9]) tri.push([ax + (bx - ax) * t, -(az + (bz - az) * t)]);
      }
      head.level('hat brim', tri, brim, 0.012, { front: c, back: shade, edge: GOLD }, tilt);
      tier('hat crown', 0.072, 0.07, 10, brim + 0.006, 0.03 * s, c, shade);
      tier('hat top', 0.056, 0.054, 10, brim + 0.006 + 0.028 * s, 0.02 * s, tone(c, 0.1), shade);
      // the flaps turned up along the brim's sides, leaning out
      for (let i = 0; i < 3; i++) {
        const a = new THREE.Vector3(corners[i][0], 0, corners[i][1]);
        const b = new THREE.Vector3(corners[(i + 1) % 3][0], 0, corners[(i + 1) % 3][1]);
        const ex = b.clone().sub(a).normalize();
        const out = new THREE.Vector3(0, 1, 0).cross(ex).negate();
        const ey = new THREE.Vector3(0, Math.cos(0.35), 0).addScaledVector(out, Math.sin(0.35));
        const ez = ex.clone().cross(ey);
        const len = a.distanceTo(b);
        const h = 0.045 * s;
        const flap: Pt[] = [[len * 0.12, 0], [len * 0.88, 0], [len * 0.84, h * 0.6], [len * 0.65, h], [len * 0.35, h], [len * 0.16, h * 0.6]];
        const at = new THREE.Matrix4().makeBasis(ex, ey, ez).setPosition(a.x + out.x * 0.008, brim + 0.006, a.z + out.z * 0.008);
        head.piece(`hat flap ${i}`, flap, CARD, { front: c, back: shade, edge: GOLD }, tilt.clone().multiply(at));
      }
      // (a plume rises inside the flaps, beside the crown)
      if (o.feather) plume(head, o.feather, -0.086, brim + 0.016, cz - 0.01, s, 0.75, tilt);
      break;
    }
    case 'bicorne': {
      tier('hat band', 0.074, 0.076, 12, brim - 0.006, 0.014, tone(c, -0.1));
      // a half moon from the front, slotted through a profile card of its own
      const moon: Pt[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * (i / 10);
        moon.push([Math.cos(a) * 0.15, brim + 0.008 + Math.sin(a) * 0.075 * s]);
      }
      head.piece('hat', moon, 0.016, { front: c, back: shade, edge: GOLD }, tilt.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, cz)));
      head.piece('hat side', [[cz - 0.05, brim + 0.008], [cz + 0.05, brim + 0.008], [cz + 0.02, brim + 0.07 * s], [cz - 0.02, brim + 0.07 * s]], 0.014, { front: tone(c, -0.08), edge: GOLD }, tilt.clone().multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)));
      head.piece('cockade', disc(0.014, 0.014, 8).map(([x, y]) => [x - 0.07, -y + brim + 0.045 * s] as Pt), LAYER, { front: GOLD }, tilt.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, cz + 0.008 + LAYER / 2 + 0.0005)));
      break;
    }
    case 'bandana': {
      // a cloth cap over the head and its band round the brow, slotted in a cross; the knot and its tails behind
      tier('bandana', 0.074, 0.084, 12, brim - 0.016, 0.022, c);
      const y0 = brim - 0.04 * s;
      const y1 = brim - 0.008;
      const bandZ = head.pivot.z + 0.011;
      head.front('bandana band', box(-0.072, y0, 0.072, y1), bandZ, BAND, { front: c, back: tone(c, -0.08) });
      head.side('bandana band side', box(cz - 0.112, y0, cz + 0.082, y1), 0, BAND + 0.012, { front: c });
      if (o.dots) {
        for (const [dx, dy] of [[-0.05, 0.012], [-0.024, 0.022], [0, 0.01], [0.024, 0.022], [0.05, 0.012]]) {
          head.front(`dot ${dx}`, disc(0.0045, 0.0045, 6).map(([x, y]) => [x + dx, -y + y0 + dy * s] as Pt), bandZ + BAND / 2 + INK, INK, { front: o.dots, edge: o.dots });
        }
        for (const [dx, dz] of [[-0.04, 0.02], [0.02, 0.04], [0.03, -0.03], [-0.02, -0.04]]) head.level(`dot top ${dx}`, disc(0.006, 0.006, 6, dx, cz + dz), brim + 0.006 + INK, INK, { front: o.dots, edge: o.dots }, tilt);
      }
      head.front('knot', disc(0.016, 0.014, 6).map(([x, y]) => [x - 0.03, -y + y0 + 0.012] as Pt), cz - 0.122, BAND, { front: tone(c, -0.08) });
      head.front('knot tail', [[-0.04, y0 + 0.006], [-0.026, y0 + 0.004], [-0.06, y0 - 0.07 * s], [-0.074, y0 - 0.064 * s]], cz - 0.122 - BAND / 2 - CARD / 2 - 0.002, CARD, { front: c });
      break;
    }
    case 'cap':
      // a cook's low cap: a band in his shirt's colour, a puffed crown
      tier('cap band', 0.076, 0.08, 12, brim - 0.014, 0.018 * s, o.coat);
      tier('cap', 0.084, 0.088, 12, brim + 0.004, 0.022 * s, c, tone(c, -0.1));
      tier('cap top', 0.07, 0.072, 12, brim + 0.026 * s, 0.012 * s, tone(c, 0.04), tone(c, -0.1));
      break;
  }
}

/** A plume rising from a hat's side and sweeping back: a profile card cut with barbs, its quill on it. */
function plume(head: Node, colour: string, x: number, y0: number, cz: number, s: number, size: number, tilt: THREE.Matrix4): void {
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
  head.piece('plume', [...up, ...down.reverse()], CARD, { front: colour, back: tone(colour, -0.08) }, at);
  const quill = Array.from({ length: 7 }, (_, i) => spine(i / 6));
  head.piece('plume quill', [...quill.map(([z, y]) => [z + 0.0015, y] as Pt), ...quill.reverse().map(([z, y]) => [z - 0.0015, y] as Pt)], CARD + 2 * INK + 0.001, { front: tone(colour, -0.3) }, at);
}

// ---- what is carried and worn on the shoulders ----------------------------------------------------------------

/** papertrails' lantern: two window frames slotted in a cross round a glowing cross, a cap, a hook and a base. */
function buildLantern(right: Node, armX: number, shoulder: number, s: number, pieces: THREE.Mesh[]): Node {
  // (hung on the hand's outer side, so it swings clear of the legs)
  const x = -(armX + 0.012);
  // (its joint just below the hand: the hook hangs from it, clear of the hand as it swings)
  const lan = new Node('lantern', new THREE.Vector3(x, shoulder - 0.117 * s, 0.11), pieces, right);
  const { y: y0, z: z0 } = lan.pivot;
  const frame = { front: FRAME };
  const window = (u: number): Pt[] => box(u - 0.024, y0 - 0.095, u + 0.024, y0 - 0.032);
  const pane = (u: number): Pt[] => box(u - 0.016, y0 - 0.087, u + 0.016, y0 - 0.04);
  lan.front('lantern frame', window(x), z0, 0.009, frame, [pane(x)]);
  lan.side('lantern frame side', window(z0), x, 0.009, frame, [pane(z0)]);
  lan.front('lantern cap', [[x - 0.03, y0 - 0.032], [x + 0.03, y0 - 0.032], [x, y0 - 0.014]], z0, 0.013, frame);
  lan.side('lantern cap side', [[z0 - 0.03, y0 - 0.032], [z0 + 0.03, y0 - 0.032], [z0, y0 - 0.014]], x, 0.013, frame);
  lan.side('lantern hook', box(z0 - 0.004, y0 - 0.03, z0 + 0.004, y0 - 0.001), x, 0.005, frame);
  lan.level('lantern base', box(x - 0.026, -z0 - 0.026, x + 0.026, -z0 + 0.026), y0 - 0.0975, 0.005, frame);
  const glowA = new THREE.Mesh(new THREE.PlaneGeometry(0.037, 0.048), glowMaterial());
  glowA.name = 'lantern glow';
  glowA.position.set(0, -0.063, 0);
  const glowB = glowA.clone();
  glowB.rotation.y = Math.PI / 2;
  lan.group.add(glowA, glowB);
  return lan;
}

let glow: THREE.Material | null = null;
/** The lantern's warm pane. */
function glowMaterial(): THREE.Material {
  return (glow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc35a').multiplyScalar(3), side: THREE.DoubleSide }));
}

/** Gold epaulettes: a level disc over each shoulder (clear above the arm), its fringe hanging outside the arm. */
function buildEpaulettes(body: Node, shoulder: number, armX: number, gold: string): void {
  for (const side of [1, -1]) {
    const tag = side > 0 ? 'l' : 'r';
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
  const green = '#5e9a4a';
  body.side('parrot', [[-0.016, y], [0.016, y], [0.022, y + 0.04], [0.016, y + 0.072], [-0.004, y + 0.082], [-0.016, y + 0.062], [-0.044, y - 0.03], [-0.034, y - 0.036]], x, CARD, { front: green });
  body.side('parrot wing', [[-0.012, y + 0.012], [0.008, y + 0.046], [-0.006, y + 0.05], [-0.036, y - 0.02]], x, BAND, { front: tone(green, -0.18) });
  body.side('parrot tail', [[-0.03, y - 0.018], [-0.022, y - 0.024], [-0.05, y - 0.05], [-0.058, y - 0.044]], x, BAND, { front: '#b4442e' });
  body.side('parrot beak', [[0.012, y + 0.07], [0.03, y + 0.062], [0.014, y + 0.052]], x, 0.014, { front: '#d9a441' });
  body.front('parrot face', box(x - 0.01, y + 0.054, x + 0.01, y + 0.078), 0.008, CARD, { front: tone(green, 0.12) });
  for (const side of [1, -1]) body.side(`parrot eye ${side > 0 ? 'l' : 'r'}`, box(0.002, y + 0.064, 0.01, y + 0.072), x + side * (CARD / 2 + INK), INK, { front: EYE, edge: EYE });
}
