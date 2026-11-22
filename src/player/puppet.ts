/**
 * The captains as paper puppets cut like papertrails' traveller (tools/blender/build_crew.py -> public/models/crew.glb):
 * flat cards printed in one colour each by vertex colour, a profile card crossed with a front card for the torso and
 * the head, thin profile cards for the legs and arms, a lantern in the right hand. Every part hangs on its joint and
 * moves by rotation only: papertrails' walk ashore (walk), steering at the helm (helm).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER } from '../config/player';
import { createPaperMaterial } from '../render/paper-material';

let crew: THREE.Object3D | null = null;

export async function loadCrew(): Promise<void> {
  crew = (await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/crew.glb`)).scene;
}

/** papertrails' cardstock: one white paper material, the colour in the vertices; and the lantern's warm pane. */
let paperMat: THREE.Material | null = null;
let glowMat: THREE.Material | null = null;
function material(name: string): THREE.Material {
  if (name === 'glow') return (glowMat ??= new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc35a').multiplyScalar(3), side: THREE.DoubleSide }));
  return (paperMat ??= createPaperMaterial({ back: null, vertexColors: true }));
}

const DEG = Math.PI / 180;
/** papertrails' gait and lantern (config/player.js there). */
const WALK = {
  /** Distance per half-cycle (one footfall). */
  stride: 0.35,
  /** The gait weight eases at this rate and is full at this share of walking speed. */
  gaitRate: 16,
  saturate: 0.55,
  settleRate: 14,
  hop: 0.02,
  leg: 34 * DEG,
  arm: 22 * DEG,
  /** Swing of the arm carrying the lantern, and of the other (the traveller's staff arm). */
  holdArm: 0.22,
  freeArm: 0.4,
  waddle: 1.6 * DEG,
  twist: 2.2 * DEG,
  nod: 1.8 * DEG,
  /** The torso rocks about the hips twice per stride, lagging the footfall; the head lags it a little more. */
  torsoLag: 1.8 * DEG,
  secondaryLag: 1.2,
  hatLag: 0.7,
  /** Lean into the walk at full walking speed, and the spring it rides on. */
  lean: 3.5 * DEG,
  springHz: 3.4,
  springDamping: 0.75,
  /** Roll into turns: rad per rad / s of turning, at most turnRoll; its spring's damping. */
  rollPerYaw: 0.035,
  turnRoll: 4 * DEG,
  rollDamping: 0.6,
  idleHz: 0.32,
  idleSway: 0.9 * DEG,
  /** The lantern: a lagging pendulum (Hz, damping), rad of lag per unit / s² of acceleration, swing per step, limit. */
  lanternHz: 1.5,
  lanternDamping: 0.22,
  lanternDrive: 0.03,
  lanternStep: 5 * DEG,
  lanternMax: 28 * DEG,
} as const;

type PartName = 'body' | 'head' | 'leg_l' | 'leg_r' | 'arm_l' | 'arm_r' | 'lantern';
const PARTS: PartName[] = ['body', 'head', 'leg_l', 'leg_r', 'arm_l', 'arm_r', 'lantern'];

export class Puppet {
  readonly root = new THREE.Group();
  /** Hop, lean, twist and roll of the whole figure. */
  private readonly rig = new THREE.Group();
  private readonly parts: Partial<Record<PartName, THREE.Object3D>> = {};
  private phase = 0;
  private t = Math.random() * 10;
  private gait = 0;
  private lean = 0;
  private leanV = 0;
  private roll = 0;
  private rollV = 0;
  private lanX = 0;
  private lanVX = 0;
  private lanZ = 0;
  private lanVZ = 0;
  private prevForward = 0;

  constructor(id: string) {
    if (!crew) throw new Error('crew not loaded');
    const model = (crew.getObjectByName(`crew_${id}`) ?? crew.children[0]).clone(true);
    model.position.set(0, 0, 0);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.material = material((mesh.material as THREE.Material).name);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return;
      }
      const key = o.name.replace(/^.*__/, '') as PartName;
      if (PARTS.includes(key)) this.parts[key] = o;
    });
    this.rig.add(model);
    this.root.add(this.rig);
  }

  /** The lantern is carried ashore only. */
  set lanternShown(on: boolean) {
    if (this.parts.lantern) this.parts.lantern.visible = on;
  }

  /**
   * Walking ashore, papertrails' gait (player/traveller.js there): the step's phase follows the distance walked
   * (stride per half-cycle, so the feet never skate), a gait weight eases between standing and walking, the lean is
   * an under-damped spring on the forward speed (he rocks back when he stops, leans back braking), he rolls into turns,
   * the torso and head lag the footfall, the lantern swings as a pendulum. moved: distance this frame; speed and
   * forward: speed and its forward part (u/s); yawRate: rad / s.
   * Returns the foot that came down this frame (0 / 1, each whole half-cycle), or null.
   */
  walk(dt: number, moved: number, speed: number, forward: number, yawRate: number): 0 | 1 | null {
    const W = WALK;
    this.t += dt;
    const stepBefore = Math.floor(this.phase / Math.PI);
    const frac = speed / PLAYER.speed;
    this.gait += (Math.min(1, frac / W.saturate) - this.gait) * (1 - Math.exp(-W.gaitRate * dt));
    if (moved > 1e-5) this.phase += (moved / W.stride) * Math.PI;
    else {
      // standing still: the feet come together (the phase eases to the nearest whole step)
      const rest = Math.round(this.phase / Math.PI) * Math.PI;
      this.phase += (rest - this.phase) * (1 - Math.exp(-W.settleRate * dt));
    }
    // springs, sub-stepped: the lean, the roll, the lantern's two swings
    const A = PLAYER.accel;
    const accF = dt > 0 ? Math.max(-A, Math.min(A, (forward - this.prevForward) / dt)) : 0;
    this.prevForward = forward;
    const accL = Math.max(-A, Math.min(A, speed * yawRate));
    const leanTarget = W.lean * Math.max(-0.4, Math.min(1, forward / PLAYER.speed));
    const rollTarget = Math.max(-W.turnRoll, Math.min(W.turnRoll, -yawRate * W.rollPerYaw)) * Math.min(1, frac);
    const lanTX = W.lanternDrive * accF + W.lanternStep * this.gait * Math.sin(this.phase);
    const lanTZ = -W.lanternDrive * accL + W.lanternStep * 0.6 * this.gait * Math.cos(this.phase);
    const wl = 2 * Math.PI * W.springHz;
    const wp = 2 * Math.PI * W.lanternHz;
    const sub = Math.max(1, Math.ceil(dt * 120));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      this.leanV += (wl * wl * (leanTarget - this.lean) - 2 * W.springDamping * wl * this.leanV) * h;
      this.lean += this.leanV * h;
      this.rollV += (wl * wl * (rollTarget - this.roll) - 2 * W.rollDamping * wl * this.rollV) * h;
      this.roll += this.rollV * h;
      this.lanVX += (wp * wp * (lanTX - this.lanX) - 2 * W.lanternDamping * wp * this.lanVX) * h;
      this.lanX += this.lanVX * h;
      this.lanVZ += (wp * wp * (lanTZ - this.lanZ) - 2 * W.lanternDamping * wp * this.lanVZ) * h;
      this.lanZ += this.lanVZ * h;
    }
    if (Math.abs(this.lanX) > W.lanternMax) [this.lanX, this.lanVX] = [Math.sign(this.lanX) * W.lanternMax, 0];
    if (Math.abs(this.lanZ) > W.lanternMax) [this.lanZ, this.lanVZ] = [Math.sign(this.lanZ) * W.lanternMax, 0];
    this.pose();
    const step = Math.floor(this.phase / Math.PI);
    return moved > 1e-5 && step > stepBefore ? ((step & 1) as 0 | 1) : null;
  }

  /** papertrails' applyPose: everything from the phase, the gait weight, the springs and the idle breath. */
  private pose(): void {
    const W = WALK;
    const P = this.parts;
    const g = this.gait;
    const idle = 1 - g;
    const sinP = Math.sin(this.phase);
    const cosP = Math.cos(this.phase);
    const breathe = Math.sin(this.t * 2 * Math.PI * W.idleHz);
    const breathe2 = Math.sin(this.t * 2 * Math.PI * W.idleHz * 0.63 + 1.3);
    const sway = W.idleSway * idle;
    this.rig.position.y = W.hop * g * Math.abs(sinP);
    this.rig.rotation.set(this.lean + sway * 0.5 * breathe2, W.twist * g * sinP, this.roll + W.waddle * g * sinP + sway * breathe);
    const leg = W.leg * g * cosP;
    P.leg_l?.rotation.set(-leg, 0, 0);
    P.leg_r?.rotation.set(leg, 0, 0);
    const arm = W.arm * g * cosP;
    const armIdle = sway * 1.5 * breathe2;
    P.arm_l?.rotation.set(arm * W.freeArm + armIdle, 0, 0);
    P.arm_r?.rotation.set(-arm * W.holdArm - armIdle, 0, 0);
    P.body?.rotation.set(W.torsoLag * g * Math.sin(this.phase * 2 - W.secondaryLag), 0, 0);
    P.head?.rotation.set(W.nod * (g * Math.sin(this.phase * 2 - W.secondaryLag - W.hatLag) + idle * 0.5 * breathe), 0, 0);
    P.lantern?.rotation.set(this.lanX, 0, this.lanZ);
  }

  /** At the helm: both hands forward on the spokes, leaning into the turn. steer: -1..1 (the wheel's turn). */
  helm(dt: number, steer: number): void {
    this.t += dt;
    const P = this.parts;
    P.arm_l?.rotation.set(-1.05 + steer * 0.25, 0, 0.25);
    P.arm_r?.rotation.set(-1.05 - steer * 0.25, 0, -0.25);
    P.leg_l?.rotation.set(0, 0, 0);
    P.leg_r?.rotation.set(0, 0, 0);
    P.body?.rotation.set(0, 0, 0);
    P.head?.rotation.set(-0.05, -steer * 0.25 + Math.sin(this.t * 0.4) * 0.05, 0);
    this.rig.position.y = 0;
    this.rig.rotation.set(0.04, 0, steer * 0.08 + Math.sin(this.t * 1.3) * 0.015);
  }
}
