/**
 * A set of hinged cards that rise and fold together (an island's props, the ship's masts).
 *
 * Every hinge is an Object3D whose origin sits on the fold line and whose local X axis is the hinge axis.
 * Its rest quaternion (the upright pose, including any yaw) is captured when the hinge is added; the drawn pose is
 *     quaternion = rest * RotX(foldAngle * (1 - p)) * RotY(flutter twist)
 * so a card with foldAngle -PI/2 lies flat face-up behind its hinge and stands up toward the camera.
 */
import * as THREE from 'three';
import { POPUP } from '../config/popup';
import { Flap, FixedStepper, flapConstants, type FlapTuning } from './spring';

export interface HingeOptions extends FlapTuning {
  /** Rotation about the hinge (rad) between upright and flat; -PI/2 folds the card back, face up. */
  foldAngle?: number;
  /** Start order inside the group, 0..1 (times POPUP.staggerSpan, or the group's own span). */
  delay?: number;
  /**
   * While folded the card stands off its own face by this much (world units, along its normal), easing to 0 as it
   * rises: cards folded onto each other lie in stacked layers instead of fighting over one plane.
   */
  lift?: number;
}

interface Hinge {
  node: THREE.Object3D;
  rest: THREE.Quaternion;
  restPos: THREE.Vector3;
  lift: number;
  flap: Flap;
  foldAngle: number;
  delayUp: number;
  delayDown: number;
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _qFold = new THREE.Quaternion();
const _qTwist = new THREE.Quaternion();
const _n = new THREE.Vector3();

export class FoldGroup {
  private readonly hinges: Hinge[] = [];
  private readonly stepper = new FixedStepper();
  private target_: 0 | 1 = 0;

  /** The side it is going to (or resting on): 1 up, 0 flat. */
  get target(): 0 | 1 {
    return this.target_;
  }
  private settled = true;

  constructor(private readonly staggerSpan: number = POPUP.staggerSpan) {}

  /** Registers `node` as a hinge. Call while the node is in its upright rest pose. */
  add(node: THREE.Object3D, options: HingeOptions): void {
    const flap = new Flap(flapConstants(options));
    const delay = Math.min(1, Math.max(0, options.delay ?? 0)) * this.staggerSpan;
    this.hinges.push({ node, rest: node.quaternion.clone(), restPos: node.position.clone(), lift: options.lift ?? 0, flap, foldAngle: options.foldAngle ?? -Math.PI / 2, delayUp: delay, delayDown: 0 });
    // fold-down runs in exact reverse: the last card up is the first one down
    let span = 0;
    for (const h of this.hinges) span = Math.max(span, h.delayUp);
    for (const h of this.hinges) h.delayDown = span - h.delayUp;
    flap.snap(this.target);
    this.pose(this.hinges[this.hinges.length - 1]);
  }

  get count(): number {
    return this.hinges.length;
  }

  get isSettled(): boolean {
    return this.settled;
  }

  get currentTarget(): 0 | 1 {
    return this.target;
  }

  /** True while every card lies flat and still (a creature that has dived, a prop not yet risen). */
  get isDown(): boolean {
    return this.settled && this.target === 0;
  }

  /** Mean progress of the group (0 flat .. 1 upright). */
  get progress(): number {
    if (this.hinges.length === 0) return this.target;
    let sum = 0;
    for (const h of this.hinges) sum += h.flap.p;
    return sum / this.hinges.length;
  }

  /** 1 = rise, 0 = fold flat, after `delay` seconds for the whole group. Returns true if the target changed. */
  setTarget(target: 0 | 1, delay = 0): boolean {
    if (target === this.target_) return false;
    this.target_ = target;
    for (const h of this.hinges) h.flap.setTarget(target, delay + (target === 1 ? h.delayUp : h.delayDown) + 1e-6);
    this.settled = false;
    return true;
  }

  /** Instantly places every hinge at p (0 or 1). */
  snap(p: 0 | 1): void {
    this.target_ = p;
    for (const h of this.hinges) {
      h.flap.snap(p);
      this.pose(h);
    }
    this.settled = true;
  }

  update(dt: number): void {
    if (this.settled) return;
    const steps = this.stepper.advance(dt);
    const h = POPUP.step;
    let busy = false;
    for (const hinge of this.hinges) {
      const flap = hinge.flap;
      for (let i = 0; i < steps; i++) flap.step(h);
      flap.interpolate(this.stepper.alpha);
      this.pose(hinge);
      if (flap.active) busy = true;
    }
    this.settled = !busy;
  }

  private pose(h: Hinge): void {
    const flap = h.flap;
    _qFold.setFromAxisAngle(X_AXIS, h.foldAngle * (1 - flap.p));
    h.node.quaternion.copy(h.rest).multiply(_qFold);
    const twist = flap.twist;
    if (twist !== 0) h.node.quaternion.multiply(_qTwist.setFromAxisAngle(Y_AXIS, twist));
    if (h.lift) {
      const k = h.lift * Math.max(0, 1 - flap.p);
      h.node.position.copy(h.restPos).addScaledVector(_n.set(0, 0, 1).applyQuaternion(h.node.quaternion), k);
    }
  }
}
