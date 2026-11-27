/**
 * The little animals among the cards, and how they live and take the captain. Each behaves as one of these:
 *
 *   pet    (cat, dog)                 wanders and sits near home; a cat naps, a dog gets up and wags as he passes
 *   graze  (goat, pig, tortoise,      slow drift, head down; lifts the head as he passes, a goat or a pig shuffles a
 *           pelican, flamingo, heron,  few steps aside; a duck on the bank waddles to the water's edge
 *           duck)
 *   peck   (hen, chick, parrot,       pecks and stands in quick turns; scatters a short hop away, or (the birds)
 *           toucan, hummingbird)       flutters up and away
 *   shy    (monkey, rabbit, boar,     freezes when he comes near, then bounds away from him and peeks back
 *           frog, crab, gecko, iguana)
 *   float  (a duck on a stream)       drifts in slow arcs, turning back at the bank
 *   perch  (owl)                      sits still, rocking a little
 *
 * Between its reactions an animal turns from idling to walking a few steps about its home and back (think /
 * wander); where it ran or flew to is its home from then on. A card has one printed frame, so a walk is a hop and a
 * rock per step, and a head-down pose (graze, peck) is the card tipped forward. By night the grazers stand still
 * and the cats nap. A card turning round flips like paper: it turns through edge-on, and since both its faces are
 * printed it comes round mirrored.
 */
import type { Card } from './card-field';
import { mulberry32 } from '../core/rng';
import { SPRITE_NAMES, hasTag, type Sprite } from '../config/flora';

/** An idle pose as one print shows it: standing (or sitting), head down (graze, peck), asleep. */
type Idle = 'stand' | 'down' | 'sleep';

/**
 * A species' numbers: speeds in u/s, step: ground per walk frame, hop / rock: lift and roll per step, roam: wander
 * radius.
 */
interface Gait {
  idle: Idle[];
  speed: number;
  /** Running (fleeing) speed; the walking speed when absent. */
  run?: number;
  step: number;
  hop: number;
  rock: number;
  roam: number;
  /** It bounds (`air`) when it runs, and a shy one when it walks too; `leap`: only when it flees. */
  air?: boolean;
  leap?: boolean;
}
/** How near he may come before it freezes, how far it flees, how wide it zig-zags. */
interface Shy extends Gait {
  b: 'shy';
  alert: number;
  flee: number;
  zig?: number;
}
/** How far it scatters; a bird flutters up and away instead of hopping. */
interface Pecker extends Gait {
  b: 'peck';
  flee: number;
  fly?: boolean;
}
/** How far it shuffles aside when he comes close; a swimmer's arc radius range and drift speed. */
interface Grazer extends Gait {
  b: 'graze';
  shuffle?: number;
  swim?: { arc: [number, number]; drift: number };
}
/** A dog gets up and wags as he passes. */
interface Pet extends Gait {
  b: 'pet';
  wag?: boolean;
}
interface Percher extends Gait {
  b: 'perch';
}
type Species = Shy | Pecker | Grazer | Pet | Percher;

const SQUIRREL: Shy = { b: 'shy', idle: ['stand'], air: true, speed: 0.6, run: 2.4, step: 0.24, hop: 0.035, rock: 0.02, roam: 0.45, alert: 1.1, flee: 1.4 };
const RABBIT: Shy = { b: 'shy', idle: ['stand'], air: true, speed: 0.5, run: 2.2, step: 0.26, hop: 0.06, rock: 0.02, roam: 0.4, alert: 1.25, flee: 1.6, zig: 0.55 };
const FOX: Shy = { b: 'shy', idle: ['stand'], speed: 0.3, run: 2.3, step: 0.13, hop: 0.012, rock: 0.04, roam: 0.6, alert: 1.5, flee: 1.9 };
const FROG: Shy = { b: 'shy', idle: ['stand'], leap: true, speed: 0.3, run: 0.9, step: 0.22, hop: 0.07, rock: 0, roam: 0.15, alert: 0.5, flee: 0.35 };
const LIZARD: Shy = { b: 'shy', idle: ['stand'], speed: 0.9, run: 2.6, step: 0.04, hop: 0, rock: 0.09, roam: 0.5, alert: 0.9, flee: 1.0, zig: 0.35 };
const HEN: Pecker = { b: 'peck', idle: ['down', 'stand'], speed: 0.2, run: 1.5, step: 0.05, hop: 0.02, rock: 0.07, roam: 0.35, flee: 0.55 };
const CHICK: Pecker = { b: 'peck', idle: ['stand'], speed: 0.22, run: 1.3, step: 0.03, hop: 0.012, rock: 0.09, roam: 0.3, flee: 0.45 };
const SONGBIRD: Pecker = { b: 'peck', fly: true, idle: ['down', 'stand'], speed: 0.2, run: 1.6, step: 0.04, hop: 0.02, rock: 0.06, roam: 0.3, flee: 1.7 };
const SHEEP: Grazer = { b: 'graze', idle: ['down', 'down', 'down', 'stand'], speed: 0.13, step: 0.09, hop: 0.006, rock: 0.03, roam: 0.45, shuffle: 0.5 };
const COW: Grazer = { b: 'graze', idle: ['down', 'down', 'stand'], speed: 0.09, step: 0.11, hop: 0.006, rock: 0.025, roam: 0.35, shuffle: 0.35 };
/** A grazer at the hedgehog's slow pace. */
const TORTOISE: Grazer = { b: 'graze', idle: ['stand'], speed: 0.08, step: 0.025, hop: 0.003, rock: 0.05, roam: 0.3 };
/** The duck's waddle: a wading bird walks it, and the duck itself swims too. */
const WADER: Grazer = { b: 'graze', idle: ['stand'], speed: 0.16, step: 0.05, hop: 0.005, rock: 0.08, roam: 0.22 };
const DUCK: Grazer = { ...WADER, swim: { arc: [0.1, 0.26], drift: 0.07 } };
/** The cat: sits, stands or stretches (all the standing print), or sleeps; it never follows him. */
const CAT: Pet = { b: 'pet', idle: ['stand', 'stand', 'stand', 'stand', 'sleep'], speed: 0.42, run: 2.75, step: 0.085, hop: 0.012, rock: 0.05, roam: 0.7 };
const DOG: Pet = { b: 'pet', idle: ['stand'], wag: true, speed: 0.5, run: 2.75, step: 0.1, hop: 0.014, rock: 0.05, roam: 0.6 };
const OWL: Percher = { b: 'perch', idle: ['stand'], speed: 0, step: 1, hop: 0, rock: 0.03, roam: 0 };

interface Kind {
  sp: Species;
  /**
   * Which way the print looks (checked by eye on the cut sprites; again whenever they are regenerated): 1 right, -1
   * left, 0 straight out (it never needs to turn).
   */
  art: 1 | -1 | 0;
  /** Placed on the water: it floats. */
  float?: boolean;
}

/** Every animal's behaviour, by its sprite: exactly the sprites whose sheet is an 'animal' (config/flora.ts). */
const CRITTERS: Record<string, Kind> = {
  monkey: { sp: SQUIRREL, art: 0 },
  crab: { sp: LIZARD, art: 0 },
  parrot: { sp: SONGBIRD, art: 1 },
  toucan: { sp: SONGBIRD, art: 1 },
  pelican: { sp: WADER, art: 1 },
  flamingo: { sp: WADER, art: -1 },
  iguana: { sp: LIZARD, art: 1 },
  duck: { sp: DUCK, art: 1 },
  'duck-float': { sp: DUCK, art: 1, float: true },
  hen: { sp: HEN, art: 1 },
  chick: { sp: CHICK, art: 1 },
  goat: { sp: SHEEP, art: 1 },
  pig: { sp: COW, art: 1 },
  tortoise: { sp: TORTOISE, art: 1 },
  heron: { sp: WADER, art: -1 },
  cat: { sp: CAT, art: 0 },
  owl: { sp: OWL, art: 0 },
  dog: { sp: DOG, art: 1 },
  rabbit: { sp: RABBIT, art: -1 },
  frog: { sp: FROG, art: 0 },
  boar: { sp: FOX, art: 1 },
  gecko: { sp: LIZARD, art: 0 },
  hummingbird: { sp: SONGBIRD, art: -1 },
} satisfies Partial<Record<Sprite, Kind>>;
for (const sprite of SPRITE_NAMES) {
  if (hasTag(sprite, 'animal') !== sprite in CRITTERS) throw new Error(`"${sprite}": its sheet and the animals' behaviours disagree on whether it is an animal`);
}

/** Reaction radii: heads up, scatter (peck), wag (dog), slide (bank duck), shuffle (graze). */
const HEADS_UP = 1.35;
const SCATTER = 0.75;
const WAG = 1.3;
const SLIDE = 0.85;
const SHUFFLE = 0.62;
/** A bank duck stands within this of the water. */
const BANK = 0.3;
/** Vignettes: how often one keeps its place when it thinks of wandering, and its leap down from a seat (s). */
const STAY = 0.75;
const LEAP = 0.42;
/** The flight directions off straight away from him (rad), the paper flip (1/s), the fastest walk-frame swap (1/s). */
const FLEE_OFFS = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3];
const FLIP_RATE = 11;
/** The flip is cut at its middle: the card's width never shows below this share, it jumps across the edge-on. */
const FLIP_CUT = 0.3;
const STEP_RATE = 9;
/** How far the print tips forward for the head-down pose (rad). */
const HEAD_DOWN = 0.22;

/**
 * What the animals ask of the world: where they may stand (land, out of the streams), where a stream's water is,
 * whether it is night.
 */
export interface Habitat {
  canStand(x: number, z: number): boolean;
  water(x: number, z: number): boolean;
  night(): boolean;
}

/** A step toward a target: under way, there, or blocked. */
type Step = 'on' | 'there' | 'blocked';

interface State {
  /**
   * Where it is, its home, where it is heading and where a flight or a slide began (or a float's centre): offsets from
   * the card's spot.
   */
  x: number;
  z: number;
  hx: number;
  hz: number;
  tx: number;
  tz: number;
  fx: number;
  fz: number;
  st: 'idle' | 'walk' | 'freeze' | 'flee' | 'fly' | 'float' | 'perch' | 'slide' | 'leap';
  /** How far it has come down from its vignette's seat (0 up on it .. seat on the ground). */
  down: number;
  /**
   * Time in the state and how long it lasts (s), walking speed, bounding, walk-frame phase, time blocked, reaction
   * cool-down (s).
   */
  t: number;
  dur: number;
  v: number;
  air: boolean;
  ph: number;
  stuck: number;
  cool: number;
  mv: boolean;
  idle: Idle;
  /** Facing: +1 the print as drawn, -1 turned round; `faceK` eases toward it, jumping across the edge-on middle. */
  face: number;
  faceK: number;
  /**
   * Which way it swerves when it flees, a floater's arc (angle, radius, direction, turn rate in rad/s), standing by the
   * water.
   */
  side: number;
  ang: number;
  rad: number;
  dir: number;
  spin: number;
  bank: boolean;
  /** Its own random sequence. */
  rand: () => number;
  /** Where it heads once down from its seat, whether it was fleeing, and whether it bounds there. */
  leapTo: [number, number] | null;
  leapFlee: boolean;
  leapAir: boolean;
}

/** The pose of an animal this frame, relative to its card's spot: offset, lift, extra yaw and roll. */
export interface Pose {
  dx: number;
  dy: number;
  dz: number;
  yaw: number;
  lean: number;
}

const POSE: Pose = { dx: 0, dy: 0, dz: 0, yaw: 0, lean: 0 };

export class Critters {
  private readonly states = new WeakMap<Card, State>();

  constructor(private readonly habitat: Habitat) {}

  /** The animal's pose now; (fx, fz): the captain (or the ship), t: the field's clock. */
  pose(c: Card, dt: number, t: number, fx: number, fz: number): Pose {
    const kind = CRITTERS[c.sprite];
    const sp = kind.sp;
    const s = this.states.get(c) ?? this.spawn(c, kind);
    const dx = fx - (c.x + s.x);
    const dz = fz - (c.z + s.z);
    const d2 = dx * dx + dz * dz;
    // the animals are desynced by the card's phase, taken as a slot index (0..55)
    const i = c.phase * 56;
    s.t += dt;
    if (s.cool > 0) s.cool -= dt;
    s.mv = false;
    let shown = s.idle;
    let rock = 0;
    let lift = 0;
    switch (s.st) {
      case 'idle': {
        if (sp.b === 'pet') {
          // up on its feet, wagging
          if (sp.wag && d2 < WAG * WAG && shown !== 'sleep') {
            shown = 'stand';
            rock = Math.sin(t * 13 + i) * 0.07;
            this.faceToward(s, c, kind, dx, dz, 0.15);
          }
        } else if (sp.b === 'graze') {
          if (s.bank && s.cool <= 0 && d2 < SLIDE * SLIDE && this.startSlide(s, c, dx, dz)) break;
          // a few steps aside, at a brisk walk
          if (sp.shuffle && s.cool <= 0 && d2 < SHUFFLE * SHUFFLE && this.startFlee(s, c, kind, dx, dz, sp.shuffle, false, sp.speed * 2.4)) {
            s.cool = 3;
            break;
          }
          if (d2 < HEADS_UP * HEADS_UP) {
            shown = 'stand';
            this.faceToward(s, c, kind, dx, dz, 0.2);
          }
        } else if (sp.b === 'peck') {
          if (d2 < SCATTER * SCATTER && this.startFlee(s, c, kind, dx, dz, sp.flee, !!sp.fly)) break;
        } else if (sp.b === 'shy') {
          const ar = sp.alert * (s.cool > 0 ? 0.55 : 1);
          if (d2 < ar * ar) {
            this.freeze(s, 0.35 + s.rand() * 0.4);
            this.faceToward(s, c, kind, dx, dz, 0.1);
            break;
          }
        }
        if (s.t >= s.dur) this.think(s, c, sp);
        break;
      }
      case 'walk':
      case 'flee': {
        if (s.st === 'walk') {
          if (sp.b === 'peck' && d2 < SCATTER * SCATTER && this.startFlee(s, c, kind, dx, dz, sp.flee, !!sp.fly)) break;
          if (sp.b === 'shy' && s.cool <= 0 && d2 < sp.alert * sp.alert) {
            this.freeze(s, 0.3 + s.rand() * 0.3);
            break;
          }
        }
        let gx = s.tx;
        let gz = s.tz;
        if (s.st === 'flee' && sp.b === 'shy' && sp.zig) {
          // bolts in zig-zags: the aim swings from side to side until the last stretch
          const ex = s.tx - s.x;
          const ez = s.tz - s.z;
          const el = Math.hypot(ex, ez);
          if (el > 0.3) {
            const w = (Math.sin(s.t * 13 + i) > 0 ? 1 : -1) * sp.zig * el;
            gx += (-ez / el) * w;
            gz += (ex / el) * w;
          }
        }
        let r = this.advance(s, c, kind, gx, gz, s.v, dt);
        if (r === 'blocked' && (gx !== s.tx || gz !== s.tz)) r = this.advance(s, c, kind, s.tx, s.tz, s.v, dt);
        s.stuck = r === 'blocked' ? s.stuck + dt : 0;
        if (r === 'there' || s.stuck > 0.5 || s.t > 14) this.settleDown(s, c, kind, dx, dz);
        break;
      }
      case 'freeze': {
        // (only the shy freeze)
        if (sp.b === 'shy' && s.t >= s.dur) {
          const ar = sp.alert * 1.25;
          // cornered: it stays frozen a while longer
          if (d2 < ar * ar) {
            if (!this.startFlee(s, c, kind, dx, dz, sp.flee, false)) s.dur = s.t + 1.2;
          } else {
            s.st = 'idle';
            s.t = 0;
            s.dur = 1.5 + s.rand() * 2;
            s.cool = 2;
          }
        }
        break;
      }
      case 'fly': {
        // up and down again over the flight, wings beating
        const u = Math.min(1, s.t / s.dur);
        const e = u * u * (3 - 2 * u);
        s.x = s.fx + (s.tx - s.fx) * e;
        s.z = s.fz + (s.tz - s.fz) * e;
        this.faceToward(s, c, kind, s.tx - s.fx, s.tz - s.fz, 0.1);
        const arc = Math.sin(u * Math.PI);
        lift = arc * (0.35 + 0.25 * s.dur * 0.4);
        rock = Math.sin(t * 38 + i) * 0.3 * arc + 0.25 * arc * (1 - 2 * u);
        shown = 'stand';
        if (u >= 1) this.settleDown(s, c, kind, dx, dz);
        break;
      }
      case 'float': {
        // slow arcs, turning back at the bank
        const na = s.ang + s.dir * s.spin * dt;
        const nx = s.fx + Math.cos(na) * s.rad;
        const nz = s.fz + Math.sin(na) * s.rad;
        const vx = -Math.sin(na) * s.dir;
        const vz = Math.cos(na) * s.dir;
        if (this.habitat.water(c.x + nx, c.z + nz) && this.habitat.water(c.x + nx + vx * 0.13, c.z + nz + vz * 0.13)) {
          s.ang = na;
          s.x = nx;
          s.z = nz;
          this.faceToward(s, c, kind, vx, vz, 0.45);
        } else if (s.t > 0.5) {
          s.dir = -s.dir;
          s.t = 0;
        }
        rock = Math.sin(t * 0.9 + i * 1.7) * 0.035;
        lift = Math.sin(t * 1.4 + i) * 0.003;
        shown = 'stand';
        break;
      }
      case 'slide': {
        // a bank duck (a standing print) waddles to the water's edge
        const u = Math.min(1, s.t / s.dur);
        const e = u * u * (3 - 2 * u);
        s.x = s.fx + (s.tx - s.fx) * e;
        s.z = s.fz + (s.tz - s.fz) * e;
        this.faceToward(s, c, kind, s.tx - s.fx, s.tz - s.fz, 0.08);
        rock = Math.sin(s.t * 15) * 0.09 * (1 - u);
        lift = Math.abs(Math.sin(s.t * 9 * Math.PI)) * sp.hop;
        shown = 'stand';
        if (u >= 1) this.settleDown(s, c, kind, dx, dz);
        break;
      }
      case 'perch':
        rock = Math.sin(t * 0.7 + i) * sp.rock;
        break;
      case 'leap': {
        // the paper leap down from a seat: over to the spot beside it, dropping to the ground
        const u = Math.min(1, s.t / LEAP);
        const seat = c.vignette?.seat ?? 0;
        s.x = s.fx + (s.tx - s.fx) * u;
        s.z = s.fz + (s.tz - s.fz) * u;
        s.down = seat * u * u;
        this.faceToward(s, c, kind, s.tx - s.fx, s.tz - s.fz, 0.1);
        lift = Math.sin(u * Math.PI) * 0.2;
        rock = (0.5 - u) * 0.5 * s.faceK;
        shown = 'stand';
        if (u >= 1) {
          s.down = seat;
          this.settleDown(s, c, kind, dx, dz);
          // (it heads on where it meant to go)
          if (s.leapTo) {
            [s.tx, s.tz] = s.leapTo;
            s.st = s.leapFlee ? 'flee' : 'walk';
            s.air = s.leapAir;
            s.leapTo = null;
          }
        }
        break;
      }
    }
    if (s.mv) {
      // the paper walk, on the one print: a hop and a roll per step, or a bound per stride
      shown = 'stand';
      if (s.air) {
        const f = s.ph - Math.floor(s.ph);
        if (f < 0.76) {
          lift = Math.sin((f / 0.76) * Math.PI) * sp.hop;
          rock = (0.38 - f) * 0.25;
        }
      } else {
        const fast = s.v > sp.speed * 1.8 ? 1.8 : 1;
        lift = Math.abs(Math.sin(s.ph * Math.PI)) * sp.hop * fast;
        rock = Math.sin(s.ph * Math.PI) * sp.rock;
      }
    } else if (s.st === 'idle' && shown !== 'sleep') rock += Math.sin(t * 1.1 + i * 2.3) * 0.012; // a breath of life
    s.faceK += (s.face - s.faceK) * (1 - Math.exp(-FLIP_RATE * dt));
    // (cut at the middle: never seen edge-on, a sliver; it jumps across to the turned side)
    if (Math.abs(s.faceK) < FLIP_CUT) s.faceK = FLIP_CUT * Math.sign(s.face);

    const p = POSE;
    p.dx = s.x;
    p.dz = s.z;
    p.dy = lift - s.down;
    // the paper flip: a yaw from 0 (as printed) to pi (turned round), cut across edge-on
    p.yaw = kind.art === 0 ? 0 : Math.acos(Math.max(-1, Math.min(1, s.faceK)));
    // the picture rolls on screen, so a turned card (seen from its back) rolls the other way; head down,
    // the print tips toward its nose
    p.lean = (s.faceK < 0 ? -rock : rock) - (shown === 'down' ? HEAD_DOWN * kind.art * (c.flip ? -1 : 1) : 0);
    return p;
  }

  /** Where a rising or folding animal lies: its last spot and facing, without moving. */
  still(c: Card): Pose {
    const s = this.states.get(c);
    const p = POSE;
    p.dx = s ? s.x : 0;
    p.dz = s ? s.z : 0;
    p.dy = s ? -s.down : 0;
    p.yaw = s && CRITTERS[c.sprite].art !== 0 ? Math.acos(Math.max(-1, Math.min(1, s.faceK))) : 0;
    p.lean = 0;
    return p;
  }

  /** A new animal at its card's spot; the terrain's random mirroring of the card is its facing. */
  private spawn(c: Card, kind: Kind): State {
    const s: State = {
      x: 0, z: 0, hx: 0, hz: 0, tx: 0, tz: 0, fx: 0, fz: 0, st: 'idle', t: 0, dur: 0, v: 0, air: false, ph: 0, stuck: 0,
      cool: 0, mv: false, idle: 'stand', face: 1, faceK: 1, side: 1, ang: 0, rad: 0, dir: 1, spin: 0, bank: false, down: 0,
      leapTo: null, leapFlee: false, leapAir: false,
      rand: mulberry32(Math.floor(c.phase * 4294967296)),
    };
    const sp = kind.sp;
    s.dur = s.rand() * 4;
    s.side = s.rand() < 0.5 ? -1 : 1;
    s.idle = sp.idle[Math.floor(s.rand() * sp.idle.length)];
    if (sp.b === 'perch') s.st = 'perch';
    else if (sp.b === 'graze' && sp.swim && kind.float) {
      const [lo, hi] = sp.swim.arc;
      s.st = 'float';
      s.rad = lo + s.rand() * (hi - lo);
      s.ang = s.rand() * Math.PI * 2;
      s.dir = s.rand() < 0.5 ? -1 : 1;
      s.spin = sp.swim.drift / Math.max(0.08, s.rad);
      s.fx = -Math.cos(s.ang) * s.rad;
      s.fz = -Math.sin(s.ang) * s.rad;
    } else if (sp.b === 'graze' && sp.swim) {
      for (let k = 0; k < 8 && !s.bank; k++) {
        const a = (k / 8) * Math.PI * 2;
        s.bank = this.habitat.water(c.x + Math.cos(a) * BANK, c.z + Math.sin(a) * BANK);
      }
    }
    this.states.set(c, s);
    return s;
  }

  /** Think: the next idle pose, or a walk about home; a vignette mostly keeps its place, or goes back. */
  private think(s: State, c: Card, sp: Species): void {
    s.t = 0;
    const night = this.habitat.night();
    if (c.vignette && s.rand() < STAY) {
      if (s.x * s.x + s.z * s.z < 0.01) {
        // still at its piece: the same pose again
        if (s.idle !== 'sleep') s.idle = sp.idle[0];
        s.dur = 6 + s.rand() * 10;
        return;
      }
      // back to it (only on the ground: a seat is not reached again)
      if (!c.vignette.seat && sp.speed > 0 && this.habitat.canStand(c.x, c.z)) {
        s.tx = 0;
        s.tz = 0;
        s.st = 'walk';
        s.v = sp.speed;
        s.air = false;
        s.stuck = 0;
        return;
      }
    }
    let walkP = sp.b === 'pet' ? 0.45 : sp.b === 'graze' ? 0.55 : sp.b === 'peck' ? 0.25 : 0.3;
    if (night && sp.b === 'graze') walkP = 0.04;
    else if (night && sp.b === 'pet') walkP = 0.22;
    if ((s.idle !== 'sleep' || s.rand() < 0.5) && s.rand() < walkP && this.wander(s, c, sp)) return;
    let pose = sp.idle[Math.floor(s.rand() * sp.idle.length)];
    if (night && sp.b === 'pet' && sp.idle.includes('sleep') && s.rand() < 0.5) pose = 'sleep';
    else if (night && sp.b === 'graze') pose = 'stand';
    s.idle = pose;
    s.dur = pose === 'sleep' ? 12 + s.rand() * 16 : sp.b === 'peck' ? 0.35 + s.rand() * 1.3 : sp.b === 'graze' ? 3 + s.rand() * 6 : 2.5 + s.rand() * 5;
  }

  /** A walk to a spot within its roam of home. */
  private wander(s: State, c: Card, sp: Species): boolean {
    const tx = s.hx + (s.rand() - 0.5) * 2 * sp.roam;
    const tz = s.hz + (s.rand() - 0.5) * 2 * sp.roam;
    if (!this.habitat.canStand(c.x + tx, c.z + tz)) return false;
    const air = !!sp.air && sp.b === 'shy';
    if (this.leapDown(s, c, tx, tz, false, air)) return true;
    s.tx = tx;
    s.tz = tz;
    s.st = 'walk';
    s.t = 0;
    s.stuck = 0;
    s.v = sp.speed;
    s.air = air;
    return true;
  }

  /** Frozen for `dur` seconds, standing. */
  private freeze(s: State, dur: number): void {
    s.st = 'freeze';
    s.t = 0;
    s.dur = dur;
    s.idle = 'stand';
  }

  /**
   * Away from him ((dx, dz): toward him): a spot `dist` off that it can stand on, tried at widening angles; it runs
   * there (flies with `fly`), or walks at `walk` when given (a grazer's shuffle). Up on a seat it leaps down first.
   */
  private startFlee(s: State, c: Card, kind: Kind, dx: number, dz: number, dist: number, fly: boolean, walk?: number): boolean {
    const ok = (x: number, z: number) => this.habitat.canStand(c.x + x, c.z + z);
    const base = Math.atan2(-dz, -dx);
    // (it bounds when it runs, not when it walks aside)
    const air = walk === undefined && (!!kind.sp.air || !!kind.sp.leap);
    for (const d of [dist, dist * 0.6]) {
      for (const off of FLEE_OFFS) {
        const a = base + off * s.side;
        const tx = s.x + Math.cos(a) * d;
        const tz = s.z + Math.sin(a) * d;
        if (!ok(tx, tz) || (!fly && !ok((s.x + tx) / 2, (s.z + tz) / 2))) continue;
        if (!fly && this.leapDown(s, c, tx, tz, true, air)) return true;
        s.tx = tx;
        s.tz = tz;
        s.t = 0;
        s.stuck = 0;
        if (fly) {
          s.st = 'fly';
          s.fx = s.x;
          s.fz = s.z;
          s.dur = 1.3 + d * 0.5;
        } else if (walk !== undefined) {
          s.st = 'walk';
          s.v = walk;
          s.air = false;
        } else {
          s.st = 'flee';
          s.v = kind.sp.run ?? kind.sp.speed;
          s.air = air;
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Up on a seat, a walk or a flight starts with the leap down to the ground beside the piece, toward
   * (tx, tz), where it goes on afterwards (bounding with `air`); false when it is already on the ground (or finds no
   * spot to land on).
   */
  private leapDown(s: State, c: Card, tx: number, tz: number, flee: boolean, air: boolean): boolean {
    const seat = c.vignette?.seat ?? 0;
    if (seat <= 0 || s.down >= seat) return false;
    const ex = tx - s.x;
    const ez = tz - s.z;
    const el = Math.hypot(ex, ez) || 1;
    for (const d of [0.3, 0.42, 0.22]) {
      const lx = s.x + (ex / el) * d;
      const lz = s.z + (ez / el) * d;
      if (!this.habitat.canStand(c.x + lx, c.z + lz)) continue;
      s.fx = s.x;
      s.fz = s.z;
      s.tx = lx;
      s.tz = lz;
      s.leapTo = [tx, tz];
      s.leapFlee = flee;
      s.leapAir = air;
      s.st = 'leap';
      s.t = 0;
      s.v = flee ? (CRITTERS[c.sprite].sp.run ?? CRITTERS[c.sprite].sp.speed) : CRITTERS[c.sprite].sp.speed;
      return true;
    }
    return false;
  }

  /** A bank duck heads for the water beside it, away from him: to the last spot it can stand on before the water. */
  private startSlide(s: State, c: Card, dx: number, dz: number): boolean {
    const { canStand, water } = this.habitat;
    const wet = (x: number, z: number) => water(c.x + x, c.z + z);
    const base = Math.atan2(-dz, -dx);
    for (let ri = 0; ri < 4; ri++) {
      const r = 0.3 + ri * 0.14;
      for (const off of FLEE_OFFS) {
        const a = base + off * s.side;
        const ux = Math.cos(a);
        const uz = Math.sin(a);
        const tx = s.x + ux * r;
        const tz = s.z + uz * r;
        if (!wet(tx, tz) || !wet(tx + 0.13, tz) || !wet(tx - 0.13, tz) || !wet(tx, tz + 0.13) || !wet(tx, tz - 0.13)) continue;
        let edge = 0;
        while (edge + 0.02 < r && canStand(c.x + s.x + ux * (edge + 0.02), c.z + s.z + uz * (edge + 0.02))) edge += 0.02;
        if (edge < 0.02) continue;
        s.fx = s.x;
        s.fz = s.z;
        s.tx = s.x + ux * edge;
        s.tz = s.z + uz * edge;
        s.st = 'slide';
        s.t = 0;
        s.dur = 0.45 + r * 1.3;
        s.stuck = 0;
        s.air = false;
        return true;
      }
    }
    // no water within reach: it looks again later
    s.cool = 2.5;
    return false;
  }

  /** Idle again; after a flight (or at the water's edge) it peeks back at him from there, its home from now on. */
  private settleDown(s: State, c: Card, kind: Kind, dx: number, dz: number): void {
    const was = s.st;
    s.st = 'idle';
    s.t = 0;
    s.stuck = 0;
    s.air = false;
    if (was === 'flee' || was === 'fly' || was === 'slide') {
      s.cool = 5;
      s.hx = s.x;
      s.hz = s.z;
      s.idle = 'stand';
      this.faceToward(s, c, kind, dx, dz, 0.1);
      s.dur = 2.5 + s.rand() * 3;
    } else {
      s.idle = kind.sp.idle[Math.floor(s.rand() * kind.sp.idle.length)];
      s.dur = kind.sp.b === 'pet' ? 2 + s.rand() * 5 : 0.6 + s.rand() * 2.5;
    }
  }

  /** One step toward (tx, tz), sliding along what blocks it on one axis. */
  private advance(s: State, c: Card, kind: Kind, tx: number, tz: number, speed: number, dt: number): Step {
    const ok = (x: number, z: number) => this.habitat.canStand(c.x + x, c.z + z);
    const ex = tx - s.x;
    const ez = tz - s.z;
    const el = Math.hypot(ex, ez);
    if (el < 0.02) return 'there';
    const st = Math.min(el, speed * dt);
    if (st <= 0) return 'on';
    const nx = s.x + (ex / el) * st;
    const nz = s.z + (ez / el) * st;
    if (ok(nx, nz)) {
      s.x = nx;
      s.z = nz;
    } else if (Math.abs(ex) > 0.03 && ok(s.x + Math.sign(ex) * st, s.z)) s.x += Math.sign(ex) * st;
    else if (Math.abs(ez) > 0.03 && ok(s.x, s.z + Math.sign(ez) * st)) s.z += Math.sign(ez) * st;
    else return 'blocked';
    // a trot swaps frames no faster than paper can flap
    s.ph += Math.min(st / kind.sp.step, dt * STEP_RATE);
    s.mv = true;
    this.faceToward(s, c, kind, ex, ez, 0.3 * el);
    return st >= el ? 'there' : 'on';
  }

  /** Turns the print toward the world direction (dx, dz) once it runs more than `min` across the card's face. */
  private faceToward(s: State, c: Card, kind: Kind, dx: number, dz: number, min: number): void {
    if (kind.art === 0) return;
    const across = dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw);
    if (Math.abs(across) <= min) return;
    const printed = kind.art * (c.flip ? -1 : 1);
    s.face = Math.sign(across) === printed ? 1 : -1;
  }
}
