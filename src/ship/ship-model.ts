/**
 * The paper pirate ship, built like a pop-up model, every ship to her own plan (config/ships.ts).
 *
 *   root (position + heading)
 *   └ body (pitch, heel, bob)
 *     ├ hull: built in Blender (ship-mesh.ts): printed sides, bulwarks, beak, transom, decks, fittings, wheel;
 *     │       stern lanterns and bowsprit here
 *     ├ head sails on their stays (unfurl along the stay)
 *     ├ mast hinges (fold flat aft, pop up at launch), each raked and listed to its ship's plan → mast and its rig:
 *     │   square: yards, fighting tops, square sails across the ship
 *     │   lateen: a long slanted yard and its triangular sail in the centre plane
 *     │   battened: a junk's battened sail in the centre plane, mostly abaft the mast
 *     │   and the flag on the tallest
 *     └ rigging threads, re-strung every frame between the hull and the (moving) masts
 *
 * Ship-local axes: forward is -z, starboard is +x.
 */
import * as THREE from 'three';
import { PALETTE } from '../config/palette';
import { FixedStepper } from '../popup/spring';
import { FoldGroup } from '../popup/fold-group';
import { createCard } from '../popup/card';
import { buildShipMesh } from './ship-mesh';
import { activeCaptain, activeShip, type MastSpec, type SailSpec } from '../config/ships';
import { createPaperMaterial } from '../render/paper-material';
import { registerGlow } from '../render/glow';
import { lanternArt } from '../art/painters/lantern-art';
import { spriteArt } from '../art/sprites';
import { Puppet } from '../player/puppet';
import { Flag, HeadSail, SquareSail, type ClothWind } from './cloth';
import { MASTS, deckHeightAt, halfBeamAt, lanternSpots, sheer, zOf } from './hull-shape';

/** The ship chosen in the shipyard: her rig, prints, spars and lanterns. */
const TYPE = activeShip();

/** Head sail corners in texture space (tack, head, clew): every jib print is a right triangle, luff on the left. */
const JIB_CORNERS = { tack: [0.05, 0.06] as [number, number], head: [0.05, 0.96] as [number, number], clew: [0.95, 0.06] as [number, number] };
const JIB_SPRITES = TYPE.jibs.map((name) => ({ name, ...JIB_CORNERS }));

/** What the model needs from the simulation each frame. */
export interface ShipPose {
  /** Rudder angle -1..1 (the wheel turns with it). */
  rudder: number;
  pitch: number;
  roll: number;
  bob: number;
  /** Wind fill of the sails 0..1 (0 = slack / luffing). */
  fill: number;
  /** Sideways component of the apparent wind (sign picks the side the fore-and-aft sails belly to). */
  windSide: number;
  /** Direction the flag streams to, ship-local (rad about +y, 0 = +x). */
  flagAngle: number;
  time: number;
}

interface Mast {
  spec: MastSpec;
  hinge: THREE.Group;
  /** The hinge's upright pose (the masts are folded flat until the launch). */
  rest: THREE.Matrix4;
  /** Heights above the mast's foot: where the lower shrouds meet it, and its head (its highest yard or truck). */
  hounds: number;
  head: number;
  /** The sails from the lowest up: the lowest is set with the courses, the rest with all sails. */
  sails: Array<SquareSail | HeadSail>;
}

/** A rigging thread end: in body space, in a mast's hinge space, or a point part way along another thread. */
type RigEnd = { mast: number; p: THREE.Vector3 } | { along: [RigEnd, RigEnd]; f: number };

/** Chainwales (built in Blender, tools/blender/build_ship.py): their drop below the rail and reach outboard. */
const CHAIN_DROP = 0.11;
const CHAIN_OUT = 0.07;

/** Height of a square sail's foot above the mast's foot (clear of the deck), and of a junk's (clear of the helm). */
const SQUARE_FOOT = 0.32;
const BATTENED_FOOT = 0.62;
/** Share of a junk's battened sail forward of her mast. */
const BATTENED_FORE = 0.3;
/** A lateen yard: its rise aft (rad), where it crosses the mast (share of the mast's height) and its share forward. */
const LATEEN_SLANT = 0.49;
const LATEEN_CROSS = 0.82;
const LATEEN_FORE = 0.55;

const Y_AXIS = new THREE.Vector3(0, 1, 0);

function spar(radiusTop: number, radiusBottom: number, length: number, color: string): THREE.Mesh {
  const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 10, 1);
  g.translate(0, length / 2, 0);
  const mesh = new THREE.Mesh(g, createPaperMaterial({ color, back: null }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A spar from a to b. */
function sparBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, color: string): THREE.Mesh {
  const d = b.clone().sub(a);
  const s = spar(radius * 0.8, radius, d.length(), color);
  s.position.copy(a);
  s.quaternion.setFromUnitVectors(Y_AXIS, d.normalize());
  return s;
}

const sailArt = (sail: SailSpec) => spriteArt(sail.sprite, { width: sail.width * 1.04, height: sail.height * 1.04, bottom: -sail.height * 1.04 });

/** The captain at the wheel, against his size ashore. */
const SHIP_CAPTAIN_SCALE = 0.75;

export class ShipModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  /** Stern lantern light, lit at night. */
  readonly light = new THREE.PointLight(TYPE.lantern, 0, 7, 1.3);
  private readonly masts: Mast[] = [];
  private readonly headSails: HeadSail[] = [];
  private readonly mastFold = new FoldGroup(0.55);
  private readonly stepper = new FixedStepper();
  private readonly flag: Flag;
  private readonly rig: Array<[RigEnd, RigEnd]> = [];
  private readonly rigLines: THREE.LineSegments;
  /** The end of the bowsprit (if she has one). */
  private readonly bowspritTip: THREE.Vector3 | null;
  private readonly wind: ClothWind = { fill: 0, luff: 0, side: 1, time: 0 };
  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();
  /** The far end of an `along` rigging end (they are never nested: see endPoint). */
  private readonly _c = new THREE.Vector3();
  /** The captain at the wheel (a layered paper puppet). */
  private puppet: Puppet | null = null;
  /** The ship's wheel (turned with the rudder). */
  private helm: THREE.Group | null = null;

  constructor() {
    this.root.name = 'pirate-ship';
    this.root.add(this.body);
    this.buildHull();
    this.bowspritTip = this.buildBowsprit();
    this.buildMasts();
    this.flag = this.buildFlag();
    this.buildHeadSails();
    this.rigLines = this.buildRigging();
  }

  // ---------------------------------------------------------------------------------------------
  // construction
  // ---------------------------------------------------------------------------------------------

  private buildHull(): void {
    const { meshes, helm } = buildShipMesh();
    for (const m of meshes) this.body.add(m);
    this.body.add(helm);
    this.helm = helm;
    this.buildCaptain(helm.position);

    // stern lanterns (glow at night later), on the posts Blender stands over the taffrail
    const lantern = lanternArt();
    const lanternMat = createPaperMaterial({ map: lantern.texture, emissive: TYPE.lantern, emissiveIntensity: 0.2 });
    registerGlow(lanternMat);
    // the warm light the ship carries at night (driven by the day / night cycle)
    this.light.position.set(0, sheer(0.01) + 0.6, zOf(0.05));
    this.body.add(this.light);
    for (const spot of lanternSpots()) {
      const l = createCard(lantern, { material: lanternMat });
      l.scale.setScalar(spot.scale);
      l.position.set(spot.x, sheer(0.01) + spot.lift, zOf(0) + 0.04);
      this.body.add(l);
    }
  }

  /** The captain leaves the wheel (going ashore) or takes it again. */
  showCaptain(on: boolean): void {
    if (this.puppet) this.puppet.root.visible = on;
  }

  /** The chosen captain stands just aft of the wheel, facing the bow, hands on its spokes. */
  private buildCaptain(wheel: THREE.Vector3): void {
    const puppet = new Puppet(activeCaptain().id);
    // papertrails' traveller is 0.6 tall: at the wheel he is cut smaller to the ship's scale, and leaves the lantern
    puppet.root.scale.setScalar(SHIP_CAPTAIN_SCALE);
    puppet.lanternShown = false;
    puppet.root.position.set(wheel.x, wheel.y - 0.24, wheel.z + 0.13);
    puppet.root.rotation.y = Math.PI; // the figure faces +z: turn it to the bow
    this.body.add(puppet.root);
    this.puppet = puppet;
  }

  private buildBowsprit(): THREE.Vector3 | null {
    if (!TYPE.bowsprit) return null;
    const { length, steeve } = TYPE.bowsprit;
    const base = new THREE.Vector3(0, sheer(1) - 0.06, zOf(1) + 0.25);
    const dir = new THREE.Vector3(0, Math.sin(steeve), -Math.cos(steeve));
    const tip = base.clone().addScaledVector(dir, length + 0.25);
    const sprit = spar(0.018, 0.03, length + 0.25, TYPE.spar);
    sprit.position.copy(base);
    sprit.quaternion.setFromUnitVectors(Y_AXIS, dir);
    this.body.add(sprit);
    return tip;
  }

  private buildMasts(): void {
    MASTS.forEach((spec, index) => {
      const hinge = new THREE.Group();
      hinge.position.set(0, deckHeightAt(spec.t), zOf(spec.t));
      // raked aft (+x rotation tips the top toward +z) and listed to starboard
      hinge.rotation.set(spec.rake ?? 0, 0, -(spec.lean ?? 0));
      this.body.add(hinge);
      hinge.add(spar(0.022, 0.038, spec.height, TYPE.spar));
      hinge.updateMatrix();
      const rig = spec.rig === 'lateen' ? this.lateen(hinge, spec, index) : this.yards(hinge, spec, index);
      if (spec.sprung) this.sprung(hinge, spec);
      this.mastFold.add(hinge, { size: spec.height, seed: 0.17 + index * 0.31, delay: index / Math.max(1, MASTS.length - 1), foldAngle: Math.PI / 2, wobble: 0.9 });
      this.masts.push({ spec, hinge, rest: hinge.matrix.clone(), ...rig });
    });
    this.mastFold.snap(0);
  }

  /**
   * Square sails on their yards across the ship (a fighting top above the course yard, crosstrees at each topmast
   * head), or a junk's battened sails turned into the centre plane.
   */
  private yards(hinge: THREE.Group, spec: MastSpec, index: number): Pick<Mast, 'hounds' | 'head' | 'sails'> {
    const square = spec.rig === 'square';
    const sails: SquareSail[] = [];
    let y = square ? SQUARE_FOOT : BATTENED_FOOT;
    spec.sails.forEach((s, k) => {
      y += (k > 0 ? 0.06 : 0) + s.height;
      const sail = new SquareSail(sailArt(s), s.width, s.height, 0.3 + index * 0.21 + k * 0.13, !square);
      if (square) {
        const yard = spar(0.016, 0.02, s.width + 0.12, TYPE.spar);
        yard.rotation.z = Math.PI / 2;
        yard.position.set((s.width + 0.12) / 2, y, -0.035);
        hinge.add(yard);
        sail.group.position.set(0, y, -0.06);
      } else {
        // the print's luff (its left edge) forward: turned so its right edge points aft, mostly abaft the mast
        sail.group.rotation.y = -Math.PI / 2;
        sail.group.position.set(0, y, (0.5 - BATTENED_FORE) * s.width);
      }
      hinge.add(sail.group);
      sails.push(sail);
    });
    const course = SQUARE_FOOT + spec.sails[0].height;
    if (square && sails.length > 1) {
      // the fighting top: a crow's nest on its platform just above the course yard
      const nest = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.085, 0.08, 14, 1, true),
        createPaperMaterial({ color: PALETTE.wood, back: PALETTE.woodDark, side: THREE.DoubleSide }),
      );
      nest.position.set(0, course + 0.1, 0);
      nest.castShadow = true;
      hinge.add(nest);
      const platform = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.022, 16), createPaperMaterial({ color: TYPE.spar, back: null }));
      platform.position.set(0, course + 0.055, 0);
      platform.castShadow = true;
      hinge.add(platform);
      // crosstrees at the head of each topmast
      let yy = course;
      for (const s of spec.sails.slice(1)) {
        yy += 0.06 + s.height;
        const cross = spar(0.008, 0.008, 0.3, TYPE.spar);
        cross.rotation.z = Math.PI / 2;
        cross.position.set(0.15, yy + 0.05, 0);
        hinge.add(cross);
      }
    }
    return { hounds: square ? course + 0.08 : spec.height * 0.6, head: square ? y : spec.height - 0.04, sails };
  }

  /** A lateen: its long yard slung slantwise across the mast, fore end low, and the sail laced under it. */
  private lateen(hinge: THREE.Group, spec: MastSpec, index: number): Pick<Mast, 'hounds' | 'head' | 'sails'> {
    const s = spec.sails[0];
    if (!s.corners) throw new Error(`lateen sail "${s.sprite}" has no corners`);
    const cross =new THREE.Vector3(0, spec.height * LATEEN_CROSS, -0.04);
    const run = s.width / Math.cos(LATEEN_SLANT);
    const dir = new THREE.Vector3(0, Math.sin(LATEEN_SLANT), Math.cos(LATEEN_SLANT));
    const tack = cross.clone().addScaledVector(dir, -run * LATEEN_FORE);
    const peak = cross.clone().addScaledVector(dir, run * (1 - LATEEN_FORE));
    const clew = new THREE.Vector3(0, peak.y - s.height, peak.z - s.width * 0.08);
    hinge.add(sparBetween(tack.clone().addScaledVector(dir, -0.06), peak.clone().addScaledVector(dir, 0.06), 0.016, TYPE.spar));
    const sail = new HeadSail(spriteArt(s.sprite, { height: 1 }), tack, peak, clew, 41 + index, s.corners);
    hinge.add(sail.mesh);
    return { hounds: cross.y - 0.06, head: spec.height - 0.04, sails: [sail] };
  }

  /** A sprung topmast: snapped at the mast head and hanging down its side, held by its rigging. */
  private sprung(hinge: THREE.Group, spec: MastSpec): void {
    const top = new THREE.Vector3(0.02, spec.height - 0.02, 0);
    const end = top.clone().add(new THREE.Vector3(0.24, -0.4, 0.08));
    hinge.add(sparBetween(end, top, 0.016, TYPE.spar));
    const yardMid = top.clone().lerp(end, 0.7);
    hinge.add(sparBetween(yardMid.clone().add(new THREE.Vector3(-0.2, 0.18, -0.05)), yardMid.clone().add(new THREE.Vector3(0.22, -0.2, 0.05)), 0.011, TYPE.spar));
  }

  /** The flag at the head of the tallest mast. */
  private buildFlag(): Flag {
    const tallest = this.masts.reduce((a, m) => (m.hinge.position.y + m.spec.height > a.hinge.position.y + a.spec.height ? m : a));
    const flag = new Flag(spriteArt(TYPE.flag, { height: 0.36, bottom: -0.36, anchor: 'left' }));
    flag.group.position.set(0, tallest.spec.height - 0.02, 0);
    tallest.hinge.add(flag.group);
    return flag;
  }

  /** A point given in a mast's frame, in body space with the mast standing. */
  private onMast(m: Mast, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(0, y, z).applyMatrix4(m.rest);
  }

  /** Head sails on the stays: the jib from the bowsprit's end, the fore staysail from the stem, both to the foremast. */
  private buildHeadSails(): void {
    const tip = this.bowspritTip;
    if (!tip) return;
    const fore = this.masts[0];
    const foreZ = fore.hinge.position.z;
    const course = SQUARE_FOOT + fore.spec.sails[0].height;
    const specs = [
      { tack: tip.clone(), head: this.onMast(fore, fore.head - 0.08, -0.05), clew: new THREE.Vector3(0, tip.y + 0.04, foreZ - 0.55), seed: 31 },
      { tack: new THREE.Vector3(0, sheer(1) + 0.08, zOf(1) - 0.3), head: this.onMast(fore, course + 0.05, -0.05), clew: new THREE.Vector3(0, sheer(1) + 0.12, foreZ - 0.3), seed: 32 },
    ];
    JIB_SPRITES.forEach((jib, i) => {
      const s = specs[i];
      const sail = new HeadSail(spriteArt(jib.name, { height: 1 }), s.tack, s.head, s.clew, s.seed, jib);
      this.body.add(sail.mesh);
      this.headSails.push(sail);
    });
  }

  private buildRigging(): THREE.LineSegments {
    const body = (x: number, y: number, z: number): RigEnd => ({ mast: -1, p: new THREE.Vector3(x, y, z) });
    const mast = (i: number, x: number, y: number, z = 0): RigEnd => ({ mast: i, p: new THREE.Vector3(x, y, z) });
    this.masts.forEach((m, i) => {
      if (m.spec.rig === 'battened') {
        // a junk's masts stand unstayed: only the halyard down the mast and the lift to the peak of the sail (its
        // print peaks a tenth of its width abaft the middle)
        const s = m.spec.sails[0];
        this.rig.push([mast(i, 0.03, m.head), mast(i, 0.03, 0.12)]);
        this.rig.push([mast(i, 0, m.head), mast(i, 0, BATTENED_FOOT + s.height, (0.6 - BATTENED_FORE) * s.width)]);
        return;
      }
      const t = m.spec.t;
      for (const side of [-1, 1]) {
        // shrouds: from the hounds down to the deadeyes on the chainwale, outside the hull; ratlines between them
        const shrouds: Array<[RigEnd, RigEnd]> = [];
        const yc = sheer(t) - CHAIN_DROP + 0.045;
        for (const dt of [-0.07, -0.025, 0.02]) {
          const tt = t + dt;
          const shroud: [RigEnd, RigEnd] = [mast(i, side * 0.03, m.hounds), body(side * (halfBeamAt(tt, yc) + CHAIN_OUT - 0.012), yc, zOf(tt))];
          this.rig.push(shroud);
          shrouds.push(shroud);
        }
        for (let f = 0.14; f < 0.9; f += 0.075) {
          for (let k = 0; k + 1 < shrouds.length; k++) {
            this.rig.push([{ along: [shrouds[k][1], shrouds[k][0]], f }, { along: [shrouds[k + 1][1], shrouds[k + 1][0]], f }]);
          }
        }
        // topmast shrouds from the top's rim to the head
        if (m.spec.rig === 'square' && m.sails.length > 1) this.rig.push([mast(i, 0, m.head + 0.04), mast(i, side * 0.1, m.hounds + 0.02)]);
      }
      // stays: the foremast's to the bowsprit and the stem, every other mast's to the mast ahead of it
      if (i === 0) {
        if (this.bowspritTip) this.rig.push([mast(0, 0, m.head + 0.02), { mast: -1, p: this.bowspritTip.clone() }]);
        this.rig.push([mast(0, 0, m.hounds), body(0, sheer(1) + 0.05, zOf(1) - 0.2)]);
      } else {
        const ahead = this.masts[i - 1];
        this.rig.push([mast(i, 0, m.head + 0.02), mast(i - 1, 0, ahead.hounds + 0.02)]);
        this.rig.push([mast(i, 0, m.hounds), mast(i - 1, 0, Math.min(0.55, ahead.hounds * 0.5))]);
      }
    });
    // the backstay from the aftmost mast's head to the taffrail
    const last = this.masts.length - 1;
    if (this.masts[last].spec.rig !== 'battened') this.rig.push([mast(last, 0, this.masts[last].head - 0.05), body(0, sheer(0) + 0.02, zOf(0) + 0.02)]);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.rig.length * 6), 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#3a2a1e', transparent: true, opacity: 0.85 }));
    lines.frustumCulled = false;
    this.body.add(lines);
    return lines;
  }

  // ---------------------------------------------------------------------------------------------
  // control and animation
  // ---------------------------------------------------------------------------------------------

  /** Masts pop up (true) or fold flat (false). */
  raiseMasts(up: boolean, delay = 0): void {
    this.mastFold.setTarget(up ? 1 : 0, delay);
  }

  /** Sail plan for a sail setting 0..1: the lowest sail of every mast and the head sails from 0.5, the rest at full. */
  setSails(level: number): void {
    const courses = level > 0.01;
    const tops = level > 0.75;
    this.masts.forEach((m, i) => m.sails.forEach((s, k) => (k === 0 ? s.set(courses, i * 0.12) : s.set(tops, 0.15 * k + i * 0.12))));
    this.headSails.forEach((s, i) => s.set(courses, 0.25 + i * 0.1));
  }

  /** Effective sail area 0..1 actually set right now (thrust follows the cloth, not the order). */
  get sailArea(): number {
    let area = 0;
    let total = 0;
    for (const m of this.masts) {
      m.sails.forEach((s, k) => {
        const weight = k === 0 ? 0.22 : 0.13;
        area += s.area * weight;
        total += weight;
      });
    }
    for (const s of this.headSails) {
      area += s.area * 0.05;
      total += 0.05;
    }
    return (area / total) * Math.min(1, this.mastFold.progress);
  }

  update(dt: number, pose: ShipPose): void {
    // (on her waterline: y = 0 is the sea, every hull floats at its own draft)
    this.body.position.y = pose.bob;
    this.body.rotation.set(pose.pitch, 0, pose.roll, 'YXZ');
    this.mastFold.update(dt);
    if (this.helm) this.helm.rotation.z = -pose.rudder * 2.4;
    this.puppet?.helm(dt, pose.rudder);

    const steps = this.stepper.advance(dt);
    const alpha = this.stepper.alpha;
    const wind = this.wind;
    wind.fill = pose.fill;
    wind.luff = Math.max(0, 1 - pose.fill * 1.6);
    wind.side = pose.windSide >= 0 ? 1 : -1;
    wind.time = pose.time;
    for (const m of this.masts) for (const s of m.sails) s.update(steps, alpha, dt, wind);
    for (const s of this.headSails) s.update(steps, alpha, dt, wind);
    this.flag.update(dt, pose.time, pose.flagAngle, Math.max(0.3, pose.fill));
    this.updateRigging();
  }

  private updateRigging(): void {
    const pos = this.rigLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (const m of this.masts) m.hinge.updateMatrix();
    this.rig.forEach(([a, b], i) => {
      this.endPoint(a, this._a);
      this.endPoint(b, this._b);
      pos.setXYZ(i * 2, this._a.x, this._a.y, this._a.z);
      pos.setXYZ(i * 2 + 1, this._b.x, this._b.y, this._b.z);
    });
    pos.needsUpdate = true;
  }

  private endPoint(end: RigEnd, out: THREE.Vector3): THREE.Vector3 {
    if ('along' in end) {
      // (an `along` end lies between two fixed ends: never between two `along` ones, so one scratch will do)
      this.endPoint(end.along[0], out);
      return out.lerp(this.endPoint(end.along[1], this._c), end.f);
    }
    out.copy(end.p);
    if (end.mast >= 0) out.applyMatrix4(this.masts[end.mast].hinge.matrix);
    return out;
  }
}
