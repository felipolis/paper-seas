/**
 * The captains as small 3D paper models (the papercraft skill's characters from cards, mechanisms.md section 12),
 * built from their outfits (config/ships.ts) out of the game's own printed cards (art/painters/paper-print.ts,
 * popup/card.ts): every card a slab of cardstock printed as a layered paper collage, its cut edge printed with it and
 * its side the print's own tone darkened.
 *
 * Built the way a paper doll is built, so no card ever cuts into another, standing, mid-stride or at the helm
 * (tools/qa/crew-clips.mjs checks it):
 *   - every part is a T: a frontal card with a profile card standing wholly BEHIND it (a cross would put an edge line
 *     through the face), a step darker, so the build reads as construction;
 *   - overlapping cards sit in their own layers, a card's thickness and a gap apart, front to back: the hat, the face,
 *     the coat, the coat's tails, the legs, then the profiles, the coat's back and the hair;
 *   - the arms hang beside the body (their shoulders just outside its widest), the legs side by side, never overlapping;
 *   - what hangs below the waist (a long coat's tails, a robe, an apron) is cut in two and hung on the legs, like a
 *     paper doll's skirt, so it swings with them instead of being swept through;
 *   - every hat sits on a level disc over the head (a brim, a band, a bandana's crown), the head's cards below it.
 * The figure faces +z, stands on y = 0 and is papertrails' 0.6 tall (times its outfit's height). Its nodes, each on
 * its joint so the puppet moves them by rotation only: body (on the hips, carrying the arms and the head), leg_l and
 * leg_r, arm_l and arm_r, head, and the lantern on the right hand.
 */
import * as THREE from 'three';
import type { Outfit } from '../config/ships';
import { CARD_THICKNESS, createCard } from '../popup/card';
import { createPaperMaterial } from '../render/paper-material';
import { polygonPath } from '../art/card-painter';
import { chevrons, dots, ellipse, mix, printCard, rect, tone, type Print, type Pt } from '../art/painters/paper-print';

export type PartName = 'body' | 'head' | 'leg_l' | 'leg_r' | 'arm_l' | 'arm_r' | 'lantern';

const T = CARD_THICKNESS;
/** Air between two layers, and between two cards side by side. */
const GAP = 0.008;
const SIDE = 0.006;
/** From one layer's mid-plane to the next. */
const STEP = T + GAP;
/** A profile card's front edge stands this far behind its frontal card's mid-plane. */
const BEHIND = T / 2 + GAP;
/** The profile cards and the backs a step darker than the fronts. */
const PROFILE_TONE = -0.07;
/** Between cards on one joint (a head and its hat): they never move apart, so a hair's breadth of air is enough. */
const TOUCH = 0.002;
const BACK_TONE = -0.04;
/** papertrails' cream boot cuff; the lantern's dark frame; a bone's dark gaps. */
const CUFF = '#e7d2ab';
const FRAME = '#523729';
const GAPS = '#4a3c30';
const INK = '#2a1608';

/** A node of the puppet: its joint (absolute, in the figure's frame) and the cards hung on it. */
class Node {
  readonly group = new THREE.Group();

  constructor(
    name: string,
    readonly pivot: THREE.Vector3,
    private readonly cards: THREE.Mesh[],
    parent?: Node,
  ) {
    this.group.name = name;
    this.group.position.copy(parent ? pivot.clone().sub(parent.pivot) : pivot);
    parent?.group.add(this.group);
  }

  private add(name: string, pts: readonly Pt[], base: string, paint: (p: Print) => void, place: (m: THREE.Mesh) => void, back?: string): void {
    const art = printCard(pts, base, paint);
    // (a plain back: the print shows on the front only, its back in one colour, the skill's plain() back)
    const mesh = createCard(art, { contact: false, material: back ? createPaperMaterial({ back, map: art.texture }) : undefined });
    mesh.name = name;
    // its outline in card units, for the clip check (tools/qa/crew-clips.mjs)
    mesh.userData.outline = pts;
    place(mesh);
    this.group.add(mesh);
    this.cards.push(mesh);
  }

  /** A frontal card in the plane z: pts are (x, y) in the figure's frame; back, a plain colour for its back. */
  front(name: string, pts: readonly Pt[], z: number, base: string, paint: (p: Print) => void, back?: string): void {
    this.add(name, pts, base, paint, (m) => m.position.set(-this.pivot.x, -this.pivot.y, z - this.pivot.z), back);
  }

  /** A profile card in the plane x: pts are (z, y) in the figure's frame (its print's +x faces forward). */
  profile(name: string, pts: readonly Pt[], x: number, base: string, paint: (p: Print) => void): void {
    this.add(name, pts, base, paint, (m) => {
      m.rotation.y = -Math.PI / 2;
      m.position.set(x - this.pivot.x, -this.pivot.y, -this.pivot.z);
    });
  }

  /** A level card (a disc, a brim) at height y: pts are (x, -z) in the figure's frame (its print seen from above). */
  level(name: string, pts: readonly Pt[], y: number, base: string, paint: (p: Print) => void): void {
    this.add(name, pts, base, paint, (m) => {
      m.rotation.x = -Math.PI / 2;
      m.position.set(-this.pivot.x, y - this.pivot.y, -this.pivot.z);
    });
  }
}

const mirrorX = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]) => [-x, y] as Pt).reverse();
const circle = (cx: number, cy: number, rx: number, ry: number, n = 18): Pt[] =>
  Array.from({ length: n }, (_, k) => [cx + Math.cos((2 * Math.PI * k) / n) * rx, cy + Math.sin((2 * Math.PI * k) / n) * ry] as Pt);

export interface CaptainModel {
  root: THREE.Group;
  parts: Record<PartName, THREE.Object3D>;
  /** Every card, named (the clip check reports by name). */
  cards: THREE.Mesh[];
}

export function buildCaptain(o: Outfit): CaptainModel {
  const s = o.height;
  const g = o.girth;
  const cards: THREE.Mesh[] = [];
  const root = new THREE.Group();
  const hip = 0.197 * s;
  const shoulder = 0.354 * s;
  const neck = 0.371 * s;
  const torsoTop = 0.362 * s;
  const coated = o.cut === 'coat' || o.cut === 'jacket' || o.cut === 'robe';
  const skin = o.cut === 'bones' ? o.skin : tone(o.skin, 0.1);
  const accent = o.extra === 'epaulettes' ? '#d8b04a' : mix(o.shirt, '#d9a441', 0.55);
  // what the coat is cut down to: below the hips it hangs on the legs
  const hem = { coat: 0.085, robe: 0.03, apron: 0.08, jacket: 0.165, bones: hip / s }[o.cut] * s;
  const skirt = hem < hip - 0.01;
  // the body's half width at the waist and at the chest (the arms hang outside the widest)
  const waist = (coated ? 0.084 : 0.064) * g;
  const chest = (coated ? 0.074 : 0.07) * g;
  const halfWide = Math.max(waist, chest);
  const torsoDepth = 0.08 * Math.sqrt(g);

  // ---- the body (on the hips): the coat's front (its back printed plain) and its profile behind ----
  const body = new Node('body', new THREE.Vector3(0, hip, 0), cards);
  root.add(body.group);
  // (its foot just above the hip joint, the tails' tops just below: a tail leaning forward stays clear of it)
  const coatFoot = hip + 0.006;
  const torsoFront: Pt[] = [[-waist, coatFoot], [waist, coatFoot], [chest, 0.33 * s], [0.058 * g, torsoTop], [-0.058 * g, torsoTop], [-chest, 0.33 * s]];
  const profileFront = -BEHIND;
  const profileBack = profileFront - torsoDepth;
  const torsoSide: Pt[] = [[profileFront, hip + 0.03], [profileBack, hip + 0.03], [profileBack, 0.33 * s], [profileBack + 0.016, torsoTop - 0.002], [profileFront - 0.016, torsoTop - 0.002], [profileFront, 0.33 * s]];
  const coatBase = o.cut === 'robe' ? o.coat : o.cut === 'bones' ? o.skin : o.shirt;
  const coatBack = tone(coated ? o.coat : o.cut === 'bones' ? o.skin : o.shirt, BACK_TONE);
  body.front('coat', torsoFront, 0, coatBase, (p) => printTorsoFront(p, o, s, g, accent), coatBack);
  const sideColour = tone(coated ? o.coat : o.cut === 'bones' ? o.skin : o.shirt, PROFILE_TONE);
  body.profile('coat side', torsoSide, 0, sideColour, (p) => {
    p.paper();
    if (o.cut === 'bones') {
      for (let k = 0; k < 4; k++) p.ink(rect(profileBack, 0.22 * s + k * 0.03 * s, profileFront, 0.229 * s + k * 0.03 * s), GAPS);
      return;
    }
    p.line(polygonPath([[(profileFront + profileBack) / 2, hip + 0.03], [(profileFront + profileBack) / 2, torsoTop]], false), tone(sideColour, -0.25), 0.003);
    if (coated) p.layer(rect(profileFront - 0.028, 0.24 * s, profileFront - 0.008, 0.265 * s), tone(sideColour, -0.12));
  });
  if (o.extra === 'epaulettes') {
    for (const k of [1, -1]) {
      const ep: Pt[] = [[0.042 * g, 0.352 * s], [0.08 * g, 0.352 * s], [0.08 * g, 0.322 * s], [0.042 * g, 0.322 * s]];
      body.front(k > 0 ? 'epaulette l' : 'epaulette r', k > 0 ? ep : mirrorX(ep), STEP, '#d8b04a', (p) => {
        p.paper();
        for (let i = 0; i < 4; i++) p.ink(rect(k * (0.046 + i * 0.009) * g, 0.322 * s, k * (0.05 + i * 0.009) * g, 0.334 * s), '#a8802a');
      });
    }
  }
  if (o.extra === 'parrot') {
    const x = 0.078 * g;
    const y0 = shoulder + 0.022;
    const bird: Pt[] = [[-0.014, y0], [0.016, y0], [0.022, y0 + 0.04], [0.016, y0 + 0.074], [-0.004, y0 + 0.084], [-0.016, y0 + 0.064], [-0.044, y0 - 0.034], [-0.034, y0 - 0.04]];
    body.profile('parrot', bird, x, '#5e9a4a', (p) => {
      p.paper();
      p.layer(polygonPath([[-0.012, y0 + 0.01], [0.0, y0 + 0.012], [-0.04, y0 - 0.036], [-0.046, y0 - 0.03]]), '#b4442e');
      p.layer(polygonPath([[0.012, y0 + 0.07], [0.03, y0 + 0.062], [0.014, y0 + 0.052]]), '#d9a441');
      p.ink(ellipse(0.006, y0 + 0.068, 0.0035, 0.0035), INK);
      p.layer(ellipse(0.002, y0 + 0.035, 0.012, 0.02), tone('#5e9a4a', 0.15));
    });
  }

  // ---- arms (on the shoulders, just outside the body's widest): sleeve, cuff and hand; the lantern in the right ----
  const armHalf = 0.02;
  const sx = halfWide + armHalf + SIDE;
  const sleeve = coated ? o.coat : o.cut === 'bones' ? o.skin : o.shirt;
  const parts: Partial<Record<PartName, THREE.Object3D>> = { body: body.group };
  let rightArm: Node | null = null;
  for (const side of [1, -1]) {
    const name: PartName = side > 0 ? 'arm_l' : 'arm_r';
    const arm = new Node(name, new THREE.Vector3(side * sx, shoulder, 0), cards, body);
    parts[name] = arm.group;
    if (side < 0) rightArm = arm;
    const x = side * sx;
    const y = (v: number) => shoulder + v * s;
    const outline: Pt[] = [[x - 0.02, y(0.008)], [x + 0.02, y(0.008)], [x + 0.018, y(-0.15)], [x + 0.015, y(-0.17)], [x + 0.008, y(-0.186)], [x - 0.01, y(-0.186)], [x - 0.015, y(-0.17)], [x - 0.018, y(-0.15)]];
    const paintArm = (c: string) => (p: Print) => {
      p.paper(c);
      if (coated) {
        p.layer(rect(x - 0.019, y(-0.152), x + 0.019, y(-0.126)), o.shirt);
        p.ink(chevrons(x - 0.019, x + 0.019, y(-0.122), y(-0.108), 3), accent);
      }
      p.layer(polygonPath([[x - 0.015, y(-0.15)], [x + 0.015, y(-0.15)], [x + 0.015, y(-0.17)], [x + 0.008, y(-0.186)], [x - 0.01, y(-0.186)], [x - 0.015, y(-0.17)]]), skin);
    };
    arm.front(`arm ${side > 0 ? 'l' : 'r'}`, outline, 0, sleeve, paintArm(sleeve));
    const zf = -BEHIND;
    const sideOutline: Pt[] = [[zf, y(0.004)], [zf - 0.032, y(0.004)], [zf - 0.03, y(-0.15)], [zf - 0.026, y(-0.18)], [zf - 0.006, y(-0.184)], [zf, y(-0.15)]];
    arm.profile(`arm ${side > 0 ? 'l' : 'r'} side`, sideOutline, x, tone(sleeve, PROFILE_TONE), (p) => {
      p.paper();
      if (coated) p.layer(rect(zf - 0.031, y(-0.152), zf, y(-0.126)), tone(o.shirt, PROFILE_TONE));
      p.layer(polygonPath([[zf, y(-0.15)], [zf - 0.03, y(-0.15)], [zf - 0.026, y(-0.18)], [zf - 0.006, y(-0.184)]]), tone(skin, PROFILE_TONE));
    });
    if (o.extra === 'ladle' && side > 0) {
      // carried beside the hand, never across the arm
      const lx = x + armHalf + SIDE + T / 2;
      const ladle: Pt[] = [[0.0, y(-0.17)], [0.008, y(-0.17)], [0.046, y(-0.05)], [0.07, y(-0.05)], [0.066, y(-0.018)], [0.05, y(-0.008)], [0.034, y(-0.018)], [0.038, y(-0.046)]];
      arm.profile('ladle', ladle, lx, '#a8a49a', (p) => {
        p.paper();
        p.layer(ellipse(0.052, y(-0.03), 0.012, 0.012), tone('#a8a49a', -0.2));
      });
    }
  }

  // the lantern: a box of four dark frame cards round a glowing cross, a cap and a base, hung from the right hand
  const lanY = shoulder - 0.186 * s - GAP;
  const lanX = -(sx + 0.028);
  const lantern = new Node('lantern', new THREE.Vector3(lanX, lanY, 0.006), cards, rightArm!);
  parts.lantern = lantern.group;
  {
    const h = 0.024;
    const inner = h - T / 2 - GAP;
    const lx = lanX;
    const lz = 0.006;
    // the box's frame cards from top to bottom below the joint; the cap and base discs a gap clear of them
    const top = lanY - 0.04;
    const bottom = lanY - 0.1;
    const capY = top + T / 2 + GAP / 2 + 0.002;
    const framePts = (w: number): Pt[] => [[-w, bottom], [w, bottom], [w, top], [-w, top]];
    const paintFrame = (cx: number, w: number) => (p: Print) => {
      p.paper();
      const win = rect(cx - w + 0.006, bottom + 0.008, cx + w - 0.006, top - 0.008);
      p.ctx.save();
      p.ctx.globalCompositeOperation = 'destination-out';
      p.ctx.fill(win);
      p.ctx.restore();
      p.line(win, tone(FRAME, -0.4), 0.003);
    };
    lantern.front('lantern front', framePts(inner).map(([x, y]) => [x + lx, y] as Pt), lz + h, FRAME, paintFrame(lx, inner));
    lantern.front('lantern back', framePts(inner).map(([x, y]) => [x + lx, y] as Pt), lz - h, FRAME, paintFrame(lx, inner));
    for (const k of [1, -1]) {
      lantern.profile(`lantern side ${k > 0 ? 'l' : 'r'}`, framePts(h + T / 2).map(([z, y]) => [z + lz, y] as Pt), lx + k * h, FRAME, paintFrame(lz, h + T / 2));
    }
    lantern.level('lantern cap', circle(lx, -lz, 0.03, 0.03, 8), capY, FRAME, (p) => p.paper());
    lantern.level('lantern base', circle(lx, -lz, 0.03, 0.03, 8), bottom - T / 2 - GAP / 2 - 0.002, FRAME, (p) => p.paper());
    // the bail it hangs by, from the cap up to the joint below the hand
    const y0 = capY + T / 2 + GAP / 2;
    const bail: Pt[] = [[lz - 0.016, y0], [lz - 0.01, y0], [lz - 0.006, lanY - 0.006], [lz + 0.006, lanY - 0.006], [lz + 0.01, y0], [lz + 0.016, y0], [lz + 0.01, lanY], [lz - 0.01, lanY]];
    lantern.profile('lantern bail', bail, lx, FRAME, (p) => p.paper());
    const glowA = new THREE.Mesh(new THREE.PlaneGeometry(0.03, top - bottom - 0.012), glowMaterial());
    glowA.name = 'lantern glow';
    glowA.position.set(lx - lanX, (top + bottom) / 2 - lanY, 0);
    const glowB = glowA.clone();
    glowB.rotation.y = Math.PI / 2;
    lantern.group.add(glowA, glowB);
  }

  // ---- legs (on the hips, side by side): trousers and boot, and what of the coat hangs below the waist ----
  const hx = Math.max(0.022 + T / 2 + SIDE, 0.032 * g);
  const tailZ = -STEP;
  const legZ = -2 * STEP;
  for (const side of [1, -1]) {
    const name: PartName = side > 0 ? 'leg_l' : 'leg_r';
    // (the hip joint in the tails' plane: a tail swings in its own plane, never up through the coat; the legs behind
    // it dip as they swing forward)
    const leg = new Node(name, new THREE.Vector3(side * hx, hip, tailZ), cards);
    root.add(leg.group);
    parts[name] = leg.group;
    const x = side * hx;
    const boot = 0.074 * s;
    const outline: Pt[] = [[x - 0.022, hip + 0.006], [x + 0.022, hip + 0.006], [x + 0.021, boot], [x + 0.026, boot], [x + 0.026, 0], [x - 0.026, 0], [x - 0.026, boot], [x - 0.021, boot]];
    const tag = side > 0 ? 'l' : 'r';
    leg.front(`leg ${tag}`, outline, legZ, o.trousers, (p) => {
      p.paper();
      p.line(polygonPath([[x, hip], [x, boot]], false), tone(o.trousers, -0.25), 0.0025);
      p.layer(rect(x - 0.026, 0, x + 0.026, boot + 0.002), o.boots);
      p.layer(rect(x - 0.025, boot - 0.004, x + 0.025, boot + 0.012), CUFF);
    });
    const zf = legZ - BEHIND;
    const sideOutline: Pt[] = [[zf, hip], [zf - 0.024, hip], [zf - 0.024, boot + 0.01], [zf - 0.036, boot], [zf - 0.036, 0], [zf, 0]];
    leg.profile(`leg ${tag} side`, sideOutline, x, tone(o.trousers, PROFILE_TONE), (p) => {
      p.paper();
      p.layer(rect(zf - 0.036, 0, zf, boot + 0.002), tone(o.boots, PROFILE_TONE));
      p.layer(rect(zf - 0.035, boot - 0.004, zf, boot + 0.012), tone(CUFF, PROFILE_TONE));
    });
    if (skirt) {
      // the coat's tail (the robe's half, the apron's half) on this leg, a layer in front of it
      const innerX = side * (T / 2 + SIDE + 0.002);
      const outerX = side * (o.cut === 'apron' ? 0.058 * g : waist);
      // (its top just above the joint: leaning back it comes forward less than a gap)
      const tt = hip + 0.004;
      const tail: Pt[] = side > 0 ? [[innerX, tt], [outerX, tt], [outerX, hem], [innerX, hem]] : [[outerX, tt], [innerX, tt], [innerX, hem], [outerX, hem]];
      const colour = o.cut === 'apron' ? '#f4efe4' : o.coat;
      leg.front(`tail ${tag}`, tail, tailZ, colour, (p) => {
        p.paper();
        const lo = Math.min(innerX, outerX);
        const hi = Math.max(innerX, outerX);
        if (o.cut === 'apron') {
          p.ink(dots(lo + 0.008, hi - 0.008, hem + 0.012, 0.003, 4), tone(o.shirt, -0.1));
          return;
        }
        if (o.cut === 'robe') p.layer(rect(side > 0 ? lo : hi - 0.016, hem, side > 0 ? lo + 0.016 : hi, tt), o.shirt);
        p.layer(rect(lo, hem, hi, hem + 0.022), tone(o.coat, -0.18));
        p.ink(chevrons(lo, hi, hem + 0.004, hem + 0.018, 3), accent);
        if (o.cut === 'coat') p.layer(rect(side > 0 ? hi - 0.034 : lo + 0.008, hip - 0.04, side > 0 ? hi - 0.008 : lo + 0.034, hip - 0.03), tone(o.coat, -0.14));
      });
    }
  }

  // ---- head (on the neck): the face in front of the coat, its profile behind, the hair at the back ----
  const head = new Node('head', new THREE.Vector3(0, neck, 0.004), cards, body);
  parts.head = head.group;
  // (a little more than a layer forward: a beard below the chin clears the coat when the head turns at the helm)
  const faceZ = STEP + 0.01;
  const brimY = neck + 0.15 * s;
  const headTop = brimY - T / 2 - TOUCH;
  const faceTop = headTop;
  const full = o.beard === 'full';
  const chin = full ? neck - 0.03 * s : neck;
  const face: Pt[] = full
    ? [[-0.05, neck], [-0.02, chin], [0.02, chin], [0.05, neck], [0.062, neck + 0.03 * s], [0.062, neck + 0.11 * s], [0.045, faceTop], [-0.045, faceTop], [-0.062, neck + 0.11 * s], [-0.062, neck + 0.03 * s]]
    : [[-0.045, neck], [0.045, neck], [0.062, neck + 0.03 * s], [0.062, neck + 0.11 * s], [0.045, faceTop], [-0.045, faceTop], [-0.062, neck + 0.11 * s], [-0.062, neck + 0.03 * s]];
  const bones = o.cut === 'bones';
  head.front('face', face, faceZ, skin, (p) => {
    p.paper();
    const ey = neck + 0.075 * s;
    if (bones) {
      for (const x of [-0.024, 0.024]) p.ink(ellipse(x, ey, 0.013, 0.015), GAPS);
      p.ink(polygonPath([[-0.007, neck + 0.04 * s], [0.007, neck + 0.04 * s], [0, neck + 0.056 * s]]), GAPS);
      p.ink(rect(-0.03, neck + 0.016 * s, 0.03, neck + 0.027 * s), GAPS);
      for (let k = -2; k <= 2; k++) p.ink(rect(k * 0.012 - 0.0015, neck + 0.016 * s, k * 0.012 + 0.0015, neck + 0.027 * s), o.skin);
    } else {
      p.layer(rect(-0.062, faceTop - 0.022 * s, 0.062, faceTop), o.hair);
      for (const x of [-0.022, 0.022]) p.ink(ellipse(x, ey, 0.0065, 0.0085), INK);
      for (const x of [-0.034, 0.034]) p.ink(ellipse(x, ey - 0.02 * s, 0.009, 0.006), mix(skin, '#d0684a', 0.35));
      if (full) {
        p.layer(polygonPath([[-0.062, neck + 0.062 * s], [-0.04, neck + 0.05 * s], [0.04, neck + 0.05 * s], [0.062, neck + 0.062 * s], [0.05, neck], [0.02, chin], [-0.02, chin], [-0.05, neck]]), o.hair);
      } else if (o.beard === 'moustache') {
        p.layer(polygonPath([[-0.034, neck + 0.036 * s], [0, neck + 0.046 * s], [0.034, neck + 0.036 * s], [0.03, neck + 0.028 * s], [0, neck + 0.036 * s], [-0.03, neck + 0.028 * s]]), o.hair);
      } else {
        p.line(polygonPath([[-0.01, neck + 0.03 * s], [0.01, neck + 0.03 * s]], false), tone(skin, -0.45), 0.003);
      }
    }
    printHatBand(p, o, s, faceTop, -0.062, 0.062);
  }, bones ? tone(o.skin, BACK_TONE) : tone(o.hair, BACK_TONE));
  const hzf = faceZ - BEHIND;
  const hzb = hzf - 0.105;
  const hy0 = torsoTop + GAP;
  const headSide: Pt[] = [[hzf, hy0], [hzf - 0.05, hy0], [hzb + 0.02, hy0 + 0.02], [hzb, neck + 0.1 * s], [hzb + 0.025, headTop], [hzf - 0.01, headTop], [hzf, neck + 0.1 * s]];
  head.profile('head side', headSide, 0, tone(skin, PROFILE_TONE), (p) => {
    p.paper();
    if (!bones) {
      p.layer(polygonPath([[hzb, neck + 0.02 * s], [hzf - 0.05, neck + 0.04 * s], [hzf - 0.03, headTop], [hzb, headTop]]), tone(o.hair, PROFILE_TONE));
      p.layer(ellipse(hzf - 0.055, neck + 0.07 * s, 0.009, 0.013), tone(skin, -0.05));
      p.ink(ellipse(hzf - 0.008, neck + 0.075 * s, 0.004, 0.006), INK);
      if (full) p.layer(polygonPath([[hzf, neck + 0.06 * s], [hzf - 0.045, neck + 0.05 * s], [hzf - 0.04, hy0], [hzf, hy0]]), tone(o.hair, PROFILE_TONE));
    } else {
      p.ink(ellipse(hzf - 0.014, neck + 0.075 * s, 0.009, 0.012), GAPS);
    }
    printHatBand(p, o, s, headTop, hzb, hzf);
  });
  buildHat(head, o, s, brimY, faceZ, hzb);

  return { root, parts: parts as Record<PartName, THREE.Object3D>, cards };
}

/** The coat's front: shirt between open coat panels, buttons, belt and collar (or the robe, the apron, the ribs). */
function printTorsoFront(p: Print, o: Outfit, s: number, g: number, accent: string): void {
  const hip = 0.197 * s;
  const top = 0.362 * s;
  const waist = 0.084 * g;
  p.paper();
  if (o.cut === 'coat' || o.cut === 'jacket') {
    for (const k of [1, -1]) {
      const panel: Pt[] = [[k * 0.018 * g, hip], [k * waist, hip], [k * 0.074 * g, 0.33 * s], [k * 0.058 * g, top], [k * 0.03 * g, top], [k * 0.016 * g, 0.27 * s]];
      p.layer(polygonPath(panel), o.coat);
      p.layer(polygonPath([[k * 0.03 * g, top], [k * 0.016 * g, 0.27 * s], [k * 0.03 * g, 0.29 * s], [k * 0.045 * g, top]]), tone(o.coat, -0.15));
      p.ink(dots(k * 0.028 * g, k * 0.028 * g, 0.25 * s, 0.0035, 1), accent);
      p.ink(dots(k * 0.024 * g, k * 0.024 * g, 0.225 * s, 0.0035, 1), accent);
    }
    p.layer(polygonPath([[-0.022, top], [0.022, top], [0, 0.322 * s]]), tone(o.shirt, 0.12));
  } else if (o.cut === 'robe') {
    p.layer(rect(-0.014, hip, 0.014, top), o.shirt);
    p.ink(chevrons(-0.014, 0.014, 0.3 * s, 0.32 * s, 1), accent);
    p.layer(polygonPath([[-0.058 * g, top], [0.058 * g, top], [0.03 * g, top - 0.02], [-0.03 * g, top - 0.02]]), tone(o.coat, -0.18));
    p.layer(rect(-waist, hip + 0.004, waist, hip + 0.02), accent);
  } else if (o.cut === 'apron') {
    p.layer(polygonPath([[-0.058 * g, hip], [0.058 * g, hip], [0.056 * g, 0.3 * s], [0.035 * g, 0.33 * s], [-0.035 * g, 0.33 * s], [-0.056 * g, 0.3 * s]]), '#f4efe4');
    p.layer(rect(-0.02 * g, 0.24 * s, 0.02 * g, 0.27 * s), tone('#f4efe4', -0.08));
    p.ink(dots(-0.04 * g, 0.04 * g, 0.315 * s, 0.003, 5), tone(o.shirt, -0.1));
  } else {
    for (let k = 0; k < 4; k++) p.ink(rect(-0.05 * g, 0.22 * s + k * 0.03 * s, 0.05 * g, 0.229 * s + k * 0.03 * s), GAPS);
    p.ink(rect(-0.004, hip, 0.004, top), GAPS);
  }
  if (o.extra === 'belt' || o.cut === 'coat' || o.cut === 'jacket') {
    p.layer(rect(-waist, hip, waist, hip + 0.01), '#3a2418');
    p.layer(rect(-0.012, hip, 0.012, hip + 0.012), '#c9973f');
  }
}

/** A bandana's or a scarf's band round the top of the head, printed on the head's cards. */
function printHatBand(p: Print, o: Outfit, s: number, top: number, x0: number, x1: number): void {
  if (o.hat !== 'bandana' && o.hat !== 'scarf') return;
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  p.layer(rect(lo, top - 0.032 * s, hi, top), o.hatColour);
  p.ink(dots(lo + 0.01, hi - 0.01, top - 0.016 * s, 0.003, Math.max(2, Math.round((hi - lo) / 0.022))), tone(o.hatColour, 0.4));
}

/**
 * The hat on its level disc at brimY (a brim, a band, a bandana's crown): its crown a T standing on the disc, centred
 * over the head, between the face's layer and the back of the head's profile.
 */
function buildHat(head: Node, o: Outfit, s: number, brimY: number, faceZ: number, backZ: number): void {
  const c = o.hatColour;
  const cz = (faceZ + backZ) / 2;
  const on = brimY + T / 2 + TOUCH;
  const disc = (name: string, r: number, colour: string, paint?: (p: Print) => void) =>
    head.level(name, circle(0, -cz, r, r, 20), brimY, colour, paint ?? ((p) => {
      p.paper();
      p.layer(ellipse(0, -cz, r * 0.55, r * 0.55), tone(colour, -0.12), { lip: 0.003, shadow: 0 });
    }));
  const crown = (w: number, h: number, depth: number, colour: string, band?: string) => {
    const zf = cz + depth / 2;
    const pts: Pt[] = [[-w, on], [w, on], [w * 0.92, on + h * 0.85], [w * 0.6, on + h], [-w * 0.6, on + h], [-w * 0.92, on + h * 0.85]];
    head.front('hat', pts, zf, colour, (p) => {
      p.paper();
      if (band) p.layer(rect(-w, on, w, on + h * 0.25), band);
    });
    const pzf = zf - BEHIND;
    const pzb = cz - depth / 2;
    if (pzf - pzb > 0.012) {
      const side: Pt[] = [[pzf, on], [pzb, on], [pzb + 0.004, on + h * 0.85], [pzb + 0.012, on + h - 0.004], [pzf - 0.006, on + h - 0.004], [pzf, on + h * 0.85]];
      head.profile('hat side', side, 0, tone(colour, PROFILE_TONE), (p) => {
        p.paper();
        if (band) p.layer(rect(pzb, on, pzf, on + h * 0.25), tone(band, PROFILE_TONE));
      });
    }
  };
  switch (o.hat) {
    case 'wide':
      disc('brim', 0.15, c);
      crown(0.07, 0.06 * s, 0.13, c, '#b4442e');
      head.profile('feather', [[cz - 0.02, on + 0.02], [cz - 0.004, on + 0.03], [cz - 0.06, on + 0.12], [cz - 0.072, on + 0.11]], 0.05, '#efe0c2', (p) => {
        p.paper();
        p.line(polygonPath([[cz - 0.012, on + 0.025], [cz - 0.066, on + 0.115]], false), tone('#efe0c2', -0.3), 0.002);
      });
      break;
    case 'tricorn': {
      const lobes: Pt[] = [];
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + (k * 2 * Math.PI) / 3;
        for (const d of [-0.5, 0, 0.5]) {
          const r = d === 0 ? 0.14 : 0.09;
          // (x, -z): the lobe at a = pi/2 points forward (+z)
          lobes.push([Math.cos(a + d) * r, -cz - Math.sin(a + d) * r]);
        }
      }
      head.level('brim', lobes, brimY, c, (p) => {
        p.paper();
        p.line(polygonPath(lobes), '#c9973f', 0.008);
      });
      crown(0.062, 0.05 * s, 0.11, c, '#c9973f');
      break;
    }
    case 'round':
      disc('brim', 0.09, c);
      crown(0.066, 0.035 * s, 0.11, c);
      break;
    case 'chef':
      disc('band', 0.07, c);
      crown(0.08, 0.1 * s, 0.11, c, tone(c, -0.06));
      break;
    case 'bicorne': {
      disc('band', 0.072, c);
      const y = on;
      const pts: Pt[] = [[-0.15, y], [-0.1, y + 0.045], [-0.04, y + 0.075], [0.04, y + 0.075], [0.1, y + 0.045], [0.15, y], [0.08, y + 0.012], [-0.08, y + 0.012]];
      head.front('hat', pts, cz + 0.01, c, (p) => {
        p.paper();
        p.line(polygonPath(pts), '#c9973f', 0.006);
        p.layer(ellipse(0.06, y + 0.035, 0.01, 0.012), '#c9973f');
      });
      head.profile('hat side', [[cz + 0.01 - BEHIND, y], [cz - 0.05, y], [cz - 0.03, y + 0.05], [cz + 0.01 - BEHIND, y + 0.06]], 0, tone(c, PROFILE_TONE), (p) => p.paper());
      break;
    }
    case 'bandana':
    case 'scarf':
      disc('bandana', 0.075, c, (p) => {
        p.paper();
        p.ink(dots(-0.04, 0.04, -cz, 0.004, 4), tone(c, 0.4));
      });
      head.front('knot', [[0.01, brimY - 0.03 * s], [0.03, brimY - 0.02 * s], [0.07, brimY - 0.09 * s], [0.055, brimY - 0.1 * s]], backZ - BEHIND, tone(c, -0.05), (p) => p.paper());
      break;
  }
}

let glow: THREE.Material | null = null;
/** The lantern's warm pane. */
function glowMaterial(): THREE.Material {
  return (glow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc35a').multiplyScalar(3), side: THREE.DoubleSide }));
}
