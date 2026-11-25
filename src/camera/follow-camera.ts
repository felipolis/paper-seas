/**
 * Diorama camera: in the plain view north is up and the pitch fixed, so every card faces the viewer like a pop-up book
 * on a table (the V views turn and tip it, the sight assist and the open chart a little more).
 *
 * On foot it is a follow camera:
 *   - the look target is a critically damped spring, stepped exactly toward the goal at the middle of the step, so it
 *     moves the same at any frame rate;
 *   - the goal comes from the camera window: a still zone round the captain where the camera does not move at all,
 *     a soft zone where it picks up his step gradually (none at the still edge, all of it at the hard edge, which he
 *     can never cross), and after a moment of steady walking one way the window travels with him and slides ahead
 *     (lookAhead, more when he walks toward the camera), never faster than leadRate times his speed;
 *   - the target sits screenUp toward the top of the screen at his feet' height: he stands a little below centre;
 *   - a very slow, tiny drift keeps the frame alive, like a hand-set tripod head;
 *   - sight assist: when a building hides him for a moment, the lens eases up and / or round, the gentlest offset that
 *     clears him, and eases back once the plain view has been clear for a while.
 * Every window size is set for the on-foot distance and scales with the zoom.
 *
 * At sea the ship has the same window, its sizes scaled with the zoom, so the camera stands still while the ship idles
 * or turns about and only travels once it sails on (a calm camera that never chases); the sight assist is
 * for the captain only. A change of view (boarding, going ashore) glides over VIEW_GLIDE seconds on a smoothstep of
 * every key (distance, pitch, field of view), never an exponential ease or a cut. The wheel zooms. V cycles the
 * views (config/view.ts VIEWS), each a share or offset of the pose, eased the same way.
 */
import * as THREE from 'three';
import { CAMERA, ON_FOOT, VIEWS } from '../config/view';
import { PLAYER } from '../config/player';
import { DEG, clamp, smoothstep } from '../core/math';

/** Does the ray from (ox, oy, oz) along the unit (dx, dy, dz) meet a large piece within len? */
export type SightTest = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number) => boolean;

const SIGHT_HEIGHTS = [0.35, 0.65, 0.95];

/** How long a change of view (boarding, going ashore) takes (s). */
const VIEW_GLIDE = 0.9;

/** A tile, in world units (the unit of a view's reach). */
const TILE = 2;

/**
 * A camera view against the plain pose: distance and screen-up as shares of it, pitch, field of view and yaw as
 * offsets (degrees), and the reach (world units).
 */
interface ViewPose {
  distance: number;
  up: number;
  pitch: number;
  fov: number;
  yaw: number;
  reach: number;
}

/** A VIEWS entry as a pose against ON_FOOT's (the plain pose). */
function viewPose(v: (typeof VIEWS)[number]): ViewPose {
  return {
    distance: (v.distance ?? ON_FOOT.distance) / ON_FOOT.distance,
    up: (v.screenUp ?? ON_FOOT.screenUp) / ON_FOOT.screenUp,
    pitch: (v.pitchDeg ?? ON_FOOT.pitchDeg) - ON_FOOT.pitchDeg,
    fov: (v.fov ?? ON_FOOT.fov) - ON_FOOT.fov,
    yaw: v.yawDeg ?? 0,
    reach: (v.reach ?? 0) * TILE,
  };
}
const POSES = VIEWS.map(viewPose);

const _v = new THREE.Vector3();
const _goal = new THREE.Vector3();
const _cam = new THREE.Vector3();

/** springStep's answer (one shared object: it runs several times a frame). */
const _spring = { x: 0, v: 0 };

/**
 * One step of a critically damped spring of angular frequency omega pulling x (moving at v) toward goal, exact for
 * any dt (the camera's chase and the sight assist): the new x and v.
 */
function springStep(x: number, v: number, goal: number, omega: number, dt: number): { x: number; v: number } {
  const e = Math.exp(-omega * dt);
  const d = x - goal;
  const tmp = (v + omega * d) * dt;
  _spring.v = (v - omega * tmp) * e;
  _spring.x = goal + (d + tmp) * e;
  return _spring;
}

export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** The look target. */
  readonly focus = new THREE.Vector3();
  distance: number = CAMERA.distance;
  targetDistance: number = CAMERA.distance;
  /** 0..1: the camera pulls back and tips toward a top-down view (the chart is open). */
  lift = 0;
  private readonly targetVel = new THREE.Vector3();
  private readonly prevGoal = new THREE.Vector3();
  private initialised = false;

  /** On its next update the camera jumps to its goal instead of easing there (after a jump of what it follows). */
  recenter(): void {
    this.initialised = false;
    this.zoneLive = false;
  }
  /** 0..1: on foot (the plain pose) or at sea, as the glide has it now. */
  private foot = 0;
  /** The view change under way: how far (0..1), and the distance and pose it set out from; null when none is. */
  private glide: { t: number; distance: number; foot: number } | null = null;
  private onFoot = false;
  private clock = 0;
  // ---- the V views: which one, the pose now and the one it eases from, how far (0..1) ----
  private viewIndex = 0;
  private readonly pose: ViewPose = { ...POSES[0] };
  private readonly poseFrom: ViewPose = { ...POSES[0] };
  private poseT = 1;
  // ---- the camera window ----
  private readonly zc = new THREE.Vector3();
  private readonly zPrev = new THREE.Vector3();
  private readonly zDir = new THREE.Vector2();
  private walkT = 0;
  private zoneLive = false;
  // ---- sight assist: eased offsets (degrees), their rates and goals, and its clocks ----
  private aYaw = 0;
  private aPitch = 0;
  private aYawV = 0;
  private aPitchV = 0;
  private gYaw = 0;
  private gPitch = 0;
  private occT = 0;
  private clearT = 0;
  private checkT = 0;
  private heldT = 0;

  constructor(aspect: number, private readonly sight: SightTest) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
  }

  /**
   * Radius around (x, z) that the camera can see on the ground: the farthest of the four frustum corner rays where
   * they meet the page (rays that miss it count as 80).
   */
  groundRadius(x: number, z: number): number {
    const cam = this.camera;
    cam.updateMatrixWorld();
    let r = 0;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      _v.set(sx, sy, 0.5).unproject(cam).sub(cam.position).normalize();
      const t = _v.y < -0.02 ? -cam.position.y / _v.y : 80;
      r = Math.max(r, Math.hypot(cam.position.x + _v.x * Math.min(t, 80) - x, cam.position.z + _v.z * Math.min(t, 80) - z));
    }
    return r;
  }

  /** The lens's distance from the look target: the zoom, as the view has it. */
  get lensDistance(): number {
    return this.distance * this.pose.distance;
  }

  /** How far past the ring that stands up the view sees (world units). */
  get viewReach(): number {
    return this.pose.reach;
  }

  /** V: on to the next view, eased over VIEW_GLIDE seconds; its index in VIEWS. */
  nextView(): number {
    this.viewIndex = (this.viewIndex + 1) % POSES.length;
    Object.assign(this.poseFrom, this.pose);
    this.poseT = 0;
    return this.viewIndex;
  }

  /** The lens's turn round the vertical now (radians; 0: looking north), the view's and the sight assist's. */
  get yaw(): number {
    return (this.pose.yaw + this.aYaw) * DEG;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** The pose's pitch now (degrees, before the sight assist): sea or foot, tipped up by the chart. */
  private get basePitch(): number {
    const e = this.lift * this.lift * (3 - 2 * this.lift);
    const p = CAMERA.pitchDeg + (ON_FOOT.pitchDeg - CAMERA.pitchDeg) * this.foot + this.pose.pitch;
    return p + (70 - p) * e;
  }

  /**
   * (x, z): the ship or the captain; (vx, vz) its velocity; wheel: notches (+ = zoom out); onFoot: the captain is
   * ashore, standing at height y.
   */
  update(dt: number, x: number, z: number, vx: number, vz: number, wheel: number, onFoot = false, y = 0): void {
    if (wheel !== 0) this.targetDistance = clamp(this.targetDistance * (1 + wheel * 0.1), CAMERA.minDistance, CAMERA.maxDistance);
    if (onFoot !== this.onFoot) {
      this.onFoot = onFoot;
      this.glide = { t: 0, distance: this.distance, foot: this.foot };
      // (the window starts again round whichever it follows now)
      this.zoneLive = false;
    }
    if (this.glide) {
      // a change of view: every key on one smoothstep over VIEW_GLIDE seconds
      const gl = this.glide;
      gl.t = Math.min(1, gl.t + dt / VIEW_GLIDE);
      const e = smoothstep(0, 1, gl.t);
      this.distance = gl.distance + (this.targetDistance - gl.distance) * e;
      this.foot = gl.foot + ((onFoot ? 1 : 0) - gl.foot) * e;
      if (gl.t >= 1) this.glide = null;
    } else this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-dt * 6));
    this.easeView(dt);
    // the window for the captain and the ship alike (not tipped toward the map); the sight assist on foot only
    const zone = this.basePitch <= 60;
    if (!zone) this.zoneLive = false;

    const goal = zone ? this.zoneStep(dt, x, y, z, vx, vz) : this.liftGoal(x, z);
    if (!this.initialised) {
      this.focus.copy(goal);
      this.prevGoal.copy(goal);
      this.targetVel.set(0, 0, 0);
      this.initialised = true;
    } else if (dt > 0) {
      this.clock += dt;
      const omega = 2 / Math.max(0.01, zone ? ON_FOOT.zone.smoothTime : CAMERA.smoothTime);
      // chase the goal at the middle of the step (second order for a moving goal: the path does not depend on the
      // frame rate)
      for (const axis of ['x', 'y', 'z'] as const) {
        const s = springStep(this.focus[axis], this.targetVel[axis], (goal[axis] + this.prevGoal[axis]) * 0.5, omega, dt);
        this.focus[axis] = s.x;
        this.targetVel[axis] = s.v;
      }
      this.prevGoal.copy(goal);
    }
    this.updateAssist(dt, zone && onFoot, x, y, z);
    this.place();
  }

  /** The view's pose toward the chosen one: every key on one smoothstep over VIEW_GLIDE seconds. */
  private easeView(dt: number): void {
    if (this.poseT >= 1) return;
    this.poseT = Math.min(1, this.poseT + dt / VIEW_GLIDE);
    const e = smoothstep(0, 1, this.poseT);
    const to = POSES[this.viewIndex];
    for (const key of Object.keys(to) as Array<keyof ViewPose>) this.pose[key] = this.poseFrom[key] + (to[key] - this.poseFrom[key]) * e;
  }

  /** Tipped toward the map (the chart is open): the camera rises over what it follows, a little below the middle. */
  private liftGoal(x: number, z: number): THREE.Vector3 {
    return _goal.set(x, 0, z - CAMERA.screenUp * (this.distance / CAMERA.distance));
  }

  /** The camera window round the captain, and the look target it gives. */
  private zoneStep(dt: number, px: number, py: number, pz: number, vx: number, vz: number): THREE.Vector3 {
    const ZN = ON_FOOT.zone;
    if (!this.zoneLive) {
      this.zc.set(px, py, pz);
      this.zPrev.set(px, py, pz);
      this.zDir.set(0, 0);
      this.walkT = 0;
      this.zoneLive = true;
    }
    const yaw = this.yaw;
    const ux = -Math.sin(yaw);
    const uz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const k = this.lensDistance / ON_FOOT.distance;
    // his offset from the window's centre, and his step, in screen axes (right, up)
    let oR = (px - this.zc.x) * rx + (pz - this.zc.z) * rz;
    let oU = (px - this.zc.x) * ux + (pz - this.zc.z) * uz;
    const dR = (px - this.zPrev.x) * rx + (pz - this.zPrev.z) * rz;
    const dU = (px - this.zPrev.x) * ux + (pz - this.zPrev.z) * uz;
    this.zPrev.set(px, py, pz);
    const sR = ZN.stillR * k;
    const hR = ZN.hardR * k;
    const sU = (oU >= 0 ? ZN.stillUp : ZN.stillDown) * k;
    const hU = (oU >= 0 ? ZN.hardUp : ZN.hardDown) * k;
    // steady walking one way -> w (0..1): the window travels with him and slides ahead of him
    const v = Math.hypot(vx, vz);
    if (v > 0.25 && dt > 0) {
      const nx = vx / v;
      const nz = vz / v;
      const a = 1 - Math.exp(-dt / 0.35);
      if (this.zDir.lengthSq() < 0.01) this.zDir.set(nx, nz);
      else {
        this.zDir.x += (nx - this.zDir.x) * a;
        this.zDir.y += (nz - this.zDir.y) * a;
      }
      const dl = this.zDir.length() || 1;
      // (a wiggle or a slide round a stone does not reset it)
      this.walkT = (nx * this.zDir.x + nz * this.zDir.y) / dl > 0.7 ? this.walkT + dt : Math.max(0, this.walkT - 3 * dt);
    } else this.walkT = 0;
    const w = smoothstep(ZN.leadAfter[0], ZN.leadAfter[1], this.walkT - dt * 0.5);
    // follow his step outward through the soft zone (factor at the middle of the step), or all of it once carried along
    const fR = dR * oR > 0 ? smoothstep(sR, hR, Math.abs(oR - dR * 0.5)) : 0;
    const fU = dU * oU > 0 ? smoothstep(sU, hU, Math.abs(oU - dU * 0.5)) : 0;
    let mR = dR * Math.max(fR, w);
    let mU = dU * Math.max(fU, w);
    oR -= mR;
    oU -= mU;
    if (w > 0 && dt > 0) {
      const nx = vx / v;
      const nz = vz / v;
      const down = Math.max(0, -(nx * ux + nz * uz));
      // the look-ahead (more down the screen) plus the lag of the smoothing spring
      const look = (ON_FOOT.lookAhead + (ON_FOOT.lookAheadSouth - ON_FOOT.lookAhead) * down) * k + v * ZN.smoothTime;
      // the offset he should have from the centre (the centre `look` ahead of him), kept inside the hard edges
      let lR = -(nx * rx + nz * rz) * look;
      let lU = -(nx * ux + nz * uz) * look;
      lR = clamp(lR, -(hR - 0.1 * k), hR - 0.1 * k);
      lU = clamp(lU, -(ZN.hardDown - 0.1) * k, (ZN.hardUp - 0.1) * k);
      // slide toward it: exponential (leadTau), never faster than leadRate times his speed, so the catch-up is calm
      const gR = oR - lR;
      const gU = oU - lU;
      const g = Math.hypot(gR, gU);
      if (g > 1e-5) {
        const d = Math.min(g * (1 - Math.exp(-dt / ZN.leadTau)), ZN.leadRate * v * dt) * w;
        mR += (gR / g) * d;
        mU += (gU / g) * d;
        oR -= (gR / g) * d;
        oU -= (gU / g) * d;
      }
    }
    // hard edges: he never leaves the window
    const hU2 = (oU >= 0 ? ZN.hardUp : ZN.hardDown) * k;
    if (Math.abs(oR) > hR) mR += oR - Math.sign(oR) * hR;
    if (Math.abs(oU) > hU2) mU += oU - Math.sign(oU) * hU2;
    this.zc.x += mR * rx + mU * ux;
    this.zc.z += mR * rz + mU * uz;
    this.zc.y = py;
    // (the screen-up is the view's own and scales with the zoom only)
    const su = ON_FOOT.screenUp * this.pose.up * (this.distance / ON_FOOT.distance);
    return _goal.set(this.zc.x + ux * su, py, this.zc.z + uz * su);
  }

  /** The sight assist: decide ten times a second, ease critically damped. */
  private updateAssist(dt: number, on: boolean, px: number, py: number, pz: number): void {
    const AS = ON_FOOT.assist;
    if (!on) {
      this.gYaw = this.gPitch = 0;
      this.occT = this.clearT = 0;
    } else {
      this.checkT -= dt;
      this.heldT += dt;
      if (this.checkT <= 0) {
        this.checkT = AS.interval;
        const baseN = this.blocked(px, py, pz, 0, 0);
        // two of thigh / chest / hat covered
        const hidden = baseN >= 2;
        if (hidden) {
          this.occT += AS.interval;
          this.clearT = 0;
        } else {
          this.clearT += AS.interval;
          this.occT = 0;
        }
        if (this.gYaw === 0 && this.gPitch === 0) {
          if (hidden && this.occT >= AS.delay) this.pick(px, py, pz, baseN);
        } else if (!hidden) {
          if (this.clearT >= AS.release) this.gYaw = this.gPitch = 0;
        } else if (this.heldT > AS.rethink && this.blocked(px, py, pz, this.gYaw, this.gPitch) >= 2) {
          // the chosen offset no longer clears him (he walked on behind the house): look again, from the gentlest
          const [py0, pp0] = [this.gYaw, this.gPitch];
          this.gYaw = this.gPitch = 0;
          this.pick(px, py, pz, baseN);
          if (this.gYaw === 0 && this.gPitch === 0) {
            [this.gYaw, this.gPitch] = [py0, pp0];
            this.heldT = 0;
          }
        }
      }
    }
    if (dt <= 0) return;
    const om = 2 / Math.max(0.05, AS.ease);
    let s = springStep(this.aYaw, this.aYawV, this.gYaw, om, dt);
    this.aYaw = s.x;
    this.aYawV = s.v;
    s = springStep(this.aPitch, this.aPitchV, this.gPitch, om, dt);
    this.aPitch = s.x;
    this.aPitchV = s.v;
    if (this.gYaw === 0 && Math.abs(this.aYaw) < 1e-3 && Math.abs(this.aYawV) < 1e-3) this.aYaw = this.aYawV = 0;
    if (this.gPitch === 0 && Math.abs(this.aPitch) < 1e-3 && Math.abs(this.aPitchV) < 1e-3) this.aPitch = this.aPitchV = 0;
  }

  /** How many of the three sight rays (thigh, chest, hat) from him to the lens at these offsets a building blocks. */
  private blocked(px: number, py: number, pz: number, yawOff: number, pitchOff: number): number {
    const yaw = (this.pose.yaw + yawOff) * DEG;
    const pitch = Math.min(80, this.basePitch + pitchOff) * DEG;
    const dist = this.lensDistance;
    const h = Math.cos(pitch) * dist;
    _cam.set(this.focus.x + Math.sin(yaw) * h, this.focus.y + Math.sin(pitch) * dist, this.focus.z + Math.cos(yaw) * h);
    let n = 0;
    for (const f of SIGHT_HEIGHTS) {
      const oy = py + PLAYER.height * f;
      _v.set(_cam.x - px, _cam.y - oy, _cam.z - pz);
      const l = _v.length() || 1;
      _v.divideScalar(l);
      if (this.sight(px, oy, pz, _v.x, _v.y, _v.z, l - this.camera.near)) n++;
    }
    return n;
  }

  /** The gentlest offset that clears him: a small lift, a small slide either way, then the full amounts, then both. */
  private pick(px: number, py: number, pz: number, baseN: number): void {
    const AS = ON_FOOT.assist;
    const P = AS.pitchMax;
    const Y = AS.yawMax;
    const cand: Array<[number, number]> = [[0, P * 0.5], [Y * 0.5, 0], [-Y * 0.5, 0], [0, P], [Y, 0], [-Y, 0], [Y * 0.5, P * 0.5], [-Y * 0.5, P * 0.5], [Y, P], [-Y, P]];
    const found: { offset: [number, number] | null; n: number } = { offset: null, n: baseN };
    const tryAll = (list: Array<[number, number]>) => {
      for (const c of list) {
        if (this.basePitch + c[1] > 62) continue;
        const n = this.blocked(px, py, pz, c[0], c[1]);
        if (n < found.n) {
          found.n = n;
          found.offset = c;
          if (n === 0) return;
        }
      }
    };
    tryAll(cand);
    // still partly hidden (he stands right behind a house): one wider tier, taken only when it shows more of him
    if (found.n >= 1) {
      const f = AS.far;
      tryAll([[0, P * f], [Y * f, P], [-Y * f, P], [Y * f, P * f], [-Y * f, P * f]]);
    }
    if (found.offset) {
      [this.gYaw, this.gPitch] = found.offset;
      this.heldT = 0;
    }
  }

  /** Stands the camera at its pose round the look target, with the tripod's slow drift. */
  private place(): void {
    const e = this.lift * this.lift * (3 - 2 * this.lift);
    const pitch = (this.basePitch + this.aPitch) * DEG;
    const yaw = this.yaw;
    const dist = this.lensDistance * (1 + 0.7 * e);
    const h = Math.cos(pitch) * dist;
    const cam = this.camera;
    cam.position.set(this.focus.x + Math.sin(yaw) * h, this.focus.y + Math.sin(pitch) * dist, this.focus.z + Math.cos(yaw) * h);
    // slow drift across and along the lens axis plane; the look target does not move
    const w = Math.PI * 2 * ON_FOOT.driftHz;
    const a = ON_FOOT.driftAmp * Math.sin(this.clock * w);
    const b = ON_FOOT.driftAmp * 0.6 * Math.sin(this.clock * w * 1.37 + 1.7);
    cam.position.x += Math.cos(yaw) * a - Math.sin(yaw) * Math.sin(pitch) * b;
    cam.position.y += Math.cos(pitch) * b;
    cam.position.z += -Math.sin(yaw) * a - Math.cos(yaw) * Math.sin(pitch) * b;
    // never let the lens sink into the page
    cam.position.y = Math.max(cam.position.y, this.focus.y + cam.near + 0.35);
    const fov = CAMERA.fov + (ON_FOOT.fov - CAMERA.fov) * this.foot + this.pose.fov;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.lookAt(this.focus);
  }
}
