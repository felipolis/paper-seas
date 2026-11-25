/**
 * Click / tap / drag to walk, papertrails' way (player/controls.js there). The pointer is cast onto the ground; the
 * captain heads straight for that point while the way is clear, and when it is not, a route is planned round what
 * stands in the way (player/route.ts) and walked leg by leg; with no route he feels his way round, trying the
 * directions turned STEER away from it. He eases in and stops on the mark, and the walk is let go when he gets there,
 * when he has been held still for a while, or when he has stopped getting nearer. Holding and dragging keeps re-aiming;
 * a key walking him lets it go. The only feedback is the inked mark on the page (player/target-mark.ts).
 */
import * as THREE from 'three';
import { CLICK_WALK, PLAYER } from '../config/player';
import { RouteFinder, type Passable } from './route';
import { TargetMark } from './target-mark';

/** Steering offsets (rad) tried in turn when the straight way to the target is blocked and no route is found. */
const STEER = [0.6, 1.2, 1.75];
/** After a failed plan, the wait before the next (s). */
const REPLAN_WAIT = 0.5;
/** Held still this long on a route, it is planned again (s). */
const ROUTE_STUCK = 0.35;
/** A waypoint counts as passed this near (u); a drag this far from the planned target plans again (u). */
const WAYPOINT_REACH = 0.12;
const DRAG_REPLAN = 0.3;
/** Within this of the target, the straight way is trusted only if the whole of it is clear (u). */
const NEAR_CHECK = 1.2;
/** Slower than this share of the walking speed, he counts as held still. */
const STILL = 0.15;
/** The slowest share of the speed while easing in to the mark. */
const EASE_MIN = 0.14;
/** A click on the water or inside a blocker: the step back toward him at which a standing spot is sought (u). */
const BACK_STEP = 0.08;
const BACK_STEPS = 60;
/** Passes refining where the pointer's ray meets the ground (each takes the ground's height where the last landed). */
const PICK_PASSES = 4;

export interface Feet {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export class ClickWalk {
  readonly mark = new TargetMark();
  /** Taking clicks (on foot, nothing open over the scene): set by the game every frame. */
  enabled = false;
  private readonly route: RouteFinder;
  private target: { x: number; z: number } | null = null;
  private waypoints: number[] = [];
  private waypoint = 0;
  /** The target the route was planned for. */
  private routeFor: { x: number; z: number } | null = null;
  private clock = 0;
  private replanAt = 0;
  private stuck = 0;
  private noProgress = 0;
  private best = Infinity;
  /** Which way round an obstacle he is feeling (-1, 0, 1), and how long it is kept. */
  private side = 0;
  private sideHold = 0;
  private pointer: number | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private readonly out = { x: 0, z: 0 };

  /**
   * canPass: room there for his body; ground: the height of what he would stand on; feet: where he is now (and how
   * fast he goes).
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly canPass: Passable,
    private readonly ground: (x: number, z: number) => number,
    private readonly feet: () => Feet,
  ) {
    this.route = new RouteFinder(canPass);
    // no long-press menu, no selection, no browser panning or zooming on the canvas
    const st = canvas.style;
    st.touchAction = 'none';
    st.userSelect = 'none';
    st.webkitUserSelect = 'none';
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointer) this.pick(e, true);
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.pointer) return;
      this.pointer = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    for (const type of ['contextmenu', 'selectstart', 'dragstart']) canvas.addEventListener(type, (e) => e.preventDefault());
  }

  /** Ends the walk at once, its mark gone too (he went back aboard, or was set down elsewhere). */
  cancel(): void {
    this.drop();
    this.mark.hide();
  }

  /** Lets the walk go, its mark fading (a key walks him). */
  drop(): void {
    this.target = null;
    this.side = 0;
    this.waypoints = [];
    this.routeFor = null;
    this.mark.fade();
  }

  /**
   * Where the walk wants him to go this frame: a direction on the page, its length the share of his speed (easing in
   * to the mark), or null with no target (or while it takes no clicks: the chart is open).
   */
  steer(dt: number): { x: number; z: number } | null {
    this.clock += dt;
    this.mark.update(dt);
    if (!this.enabled) {
      this.pointer = null;
      return null;
    }
    const t = this.target;
    if (!t) return null;
    const f = this.feet();
    const px = f.x;
    const pz = f.z;
    const tx = t.x - px;
    const tz = t.z - pz;
    const d = Math.hypot(tx, tz);
    if (d < CLICK_WALK.arriveRadius) return this.letGo();

    // let go when held still or when hugging an obstacle without getting any nearer
    if (dt > 0) {
      if (Math.hypot(f.vx, f.vz) < PLAYER.speed * STILL) this.stuck += dt;
      else this.stuck = 0;
      // (a route that does not move him is planned again)
      if (this.stuck > ROUTE_STUCK) this.waypoints = [];
      if (d < this.best - 0.02) {
        this.best = d;
        this.noProgress = 0;
      } else this.noProgress += dt;
      if (this.stuck >= CLICK_WALK.stuckTime || this.noProgress >= CLICK_WALK.noProgressTime) return this.letGo();
    }

    // straight at the target while that is clear; else along a planned route; else feeling the way round
    let dx = tx / d;
    let dz = tz / d;
    let routed = false;
    if (this.waypoints.length > 0) {
      const w = this.waypoints;
      // (past the waypoints already reached, and ahead to the next one in plain sight)
      while (this.waypoint < w.length - 2 && Math.hypot(w[this.waypoint] - px, w[this.waypoint + 1] - pz) < WAYPOINT_REACH) this.waypoint += 2;
      while (this.waypoint < w.length - 2 && this.route.segClear(px, pz, w[this.waypoint + 2], w[this.waypoint + 3])) this.waypoint += 2;
      const wx = w[this.waypoint] - px;
      const wz = w[this.waypoint + 1] - pz;
      const wl = Math.hypot(wx, wz);
      if (this.waypoint >= w.length - 2 && wl < CLICK_WALK.arriveRadius) {
        // the route's end: short of the target when that could not be reached, as near as it gets
        if (Math.hypot(w[this.waypoint] - t.x, w[this.waypoint + 1] - t.z) > 1e-3) return this.letGo();
        this.waypoints = [];
      } else if (wl > 1e-4) {
        dx = wx / wl;
        dz = wz / wl;
        routed = true;
      }
    }
    const probe = Math.min(CLICK_WALK.probe, d);
    if (routed) {
      // on a route
    } else if (this.clear(px, pz, dx, dz, probe) && (d > NEAR_CHECK || this.route.segClear(px, pz, t.x, t.z))) {
      if (this.side !== 0 && dt > 0) {
        this.sideHold -= dt;
        if (this.sideHold <= 0) this.side = 0;
      }
    } else if (this.clock >= this.replanAt && this.plan(px, pz, t.x, t.z)) {
      const wl = Math.hypot(this.waypoints[0] - px, this.waypoints[1] - pz);
      if (wl > 1e-4) {
        dx = (this.waypoints[0] - px) / wl;
        dz = (this.waypoints[1] - pz) / wl;
      }
      routed = true;
    } else {
      // no route: feel the way round, the side already taken first (nothing clear: push on and slide, the stuck timer
      // ends it)
      if (this.clock >= this.replanAt) this.replanAt = this.clock + REPLAN_WAIT;
      const base = Math.atan2(dx, dz);
      search: for (const sign of [this.side || 1, -(this.side || 1)]) {
        for (const off of STEER) {
          const sx = Math.sin(base + sign * off);
          const sz = Math.cos(base + sign * off);
          if (this.clear(px, pz, sx, sz, CLICK_WALK.probe)) {
            dx = sx;
            dz = sz;
            this.side = sign;
            this.sideHold = 0.3;
            break search;
          }
        }
      }
    }
    // (a route may lead away from the target first; the stuck timer still guards it)
    if (routed) this.noProgress = 0;

    // easing in, so he stops on the mark rather than circling it
    const s = Math.max(EASE_MIN, Math.min(1, Math.sqrt(PLAYER.accel * Math.max(0, d - CLICK_WALK.arriveRadius * 0.5)) / PLAYER.speed));
    this.out.x = dx * s;
    this.out.z = dz * s;
    return this.out;
  }

  private plan(px: number, pz: number, tx: number, tz: number): boolean {
    const w = this.route.plan(px, pz, tx, tz);
    if (!w) return false;
    this.waypoints = w;
    this.waypoint = 0;
    this.routeFor = { x: tx, z: tz };
    this.stuck = 0;
    this.noProgress = 0;
    this.best = Infinity;
    return true;
  }

  private letGo(): null {
    this.drop();
    return null;
  }

  /** The short way from him along (dx, dz) is clear (at its end and half way). */
  private clear(px: number, pz: number, dx: number, dz: number, dist: number): boolean {
    return this.canPass(px + dx * dist, pz + dz * dist) && this.canPass(px + dx * dist * 0.5, pz + dz * dist * 0.5);
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // (a second finger is ignored)
    if (this.pointer !== null && e.pointerId !== this.pointer) return;
    this.pointer = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.pick(e, false);
  }

  /** The pointer cast onto the ground: where its ray meets the ground's height there, refined a few times. */
  private pick(e: PointerEvent, drag: boolean): void {
    if (!this.enabled) return;
    const r = this.canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const f = this.feet();
    let y = this.ground(f.x, f.z);
    for (let k = 0; k < PICK_PASSES; k++) {
      this.plane.constant = -y;
      if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return;
      y = this.ground(this.hit.x, this.hit.z);
    }
    this.aim(this.hit.x, this.hit.z, drag);
  }

  private aim(x: number, z: number, drag: boolean): void {
    // a click on the water or inside a blocker walks to the nearest standing spot on the way there
    if (!this.canPass(x, z)) {
      const f = this.feet();
      const d = Math.hypot(f.x - x, f.z - z);
      const n = Math.min(BACK_STEPS, Math.floor(d / BACK_STEP));
      for (let i = 1; i <= n; i++) {
        const k = (i * BACK_STEP) / d;
        const qx = x + (f.x - x) * k;
        const qz = z + (f.z - z) * k;
        if (this.canPass(qx, qz)) {
          x = qx;
          z = qz;
          break;
        }
      }
    }
    this.target = { x, z };
    this.stuck = 0;
    this.noProgress = 0;
    this.best = Infinity;
    if (!drag) {
      this.side = 0;
      this.sideHold = 0;
    }
    if (!drag || (this.routeFor && Math.hypot(x - this.routeFor.x, z - this.routeFor.z) > DRAG_REPLAN)) {
      this.waypoints = [];
      this.routeFor = null;
      this.replanAt = 0;
    }
    this.mark.stamp(x, this.ground(x, z), z);
  }
}
