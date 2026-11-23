/**
 * Wires the world together and runs the frame loop:
 *   input -> ship (helm, physics, sails) -> camera -> world (terrain chunks, land cards) -> waves -> sea life
 *   -> voyage progress -> day / night -> sound -> HUD -> post
 */
import * as THREE from 'three';
import { CAMERA, ON_FOOT } from '../config/view';
import { WORLD } from '../config/world';
import { Input } from '../core/input';
import { FollowCamera } from '../camera/follow-camera';
import { createRenderer } from '../render/renderer';
import { Lights } from '../render/lights';
import { PostChain } from '../render/post';
import { DayNight } from '../render/day-night';
import { SeaSurface } from '../sea/sea-surface';
import { WaveField } from '../sea/wave-field';
import { DistanceMap } from '../sea/distance-map';
import { Reflection } from '../render/reflection';
import { World } from '../world/world';
import { SeaLife } from '../life/sea-life';
import { Flotsam } from '../life/flotsam';
import { Ambience } from '../life/ambience';
import { Marvels } from '../life/marvels';
import { Walker, type WalkWorld } from '../player/walker';
import { Reveal } from '../world/reveal';
import { Smoke } from '../life/smoke';
import { ClearLine } from '../life/clear-line';
import { activeCaptain } from '../config/ships';
import { nextVoyageSeed } from '../config/seed';
import { Progress } from '../game/progress';
import { Ship } from '../ship/ship';
import { Sound } from '../audio/sound';
import { Hud } from '../ui/hud';
import { Menu } from '../ui/menu';
import { Shipyard } from '../ui/shipyard';
import { Chart } from '../ui/chart';
import { Exploration } from '../game/exploration';
import { spriteArt } from '../art/sprites';
import { HEIGHT } from '../config/flora';
import { createCard, prewarmSilhouettes } from '../popup/card';
import { buildModel } from '../world/models';
import { setPageFocus } from '../render/paper-material';
import { BIOMES } from '../world/land';

/** Knots shown per world unit / s (a playful scale: full sail reads about 12 kn). */
const KNOTS_PER_UNIT = 3.6;
/**
 * papertrails' camera views add a reach to the ring that stands up (camera/views.js there): none in its own framing
 * (10.8 away), 0.9 tiles in its wide view (14.5 away). Our zoom is a continuum: the reach follows that line with the
 * camera's distance (world units of reach per unit of distance; world/reveal.ts caps it at papertrails' 1.5 tiles).
 */
const REACH_FROM = ON_FOOT.distance;
const REACH_PER_UNIT = 1.8 / (14.5 - ON_FOOT.distance);
export class Game {
  readonly scene = new THREE.Scene();
  readonly input = new Input();
  readonly renderer: THREE.WebGLRenderer;
  readonly view: FollowCamera;
  readonly lights = new Lights();
  readonly sea = new SeaSurface();
  readonly world = new World();
  readonly waves: WaveField;
  readonly life: SeaLife;
  readonly flotsam: Flotsam;
  readonly ambience: Ambience;
  readonly marvels: Marvels;
  readonly walker = new Walker(activeCaptain().id);
  /** The camera -> captain line that living pieces keep clear of. */
  private readonly clearLine = new ClearLine();
  private readonly smoke = new Smoke(this.clearLine);
  private readonly walkWorld: WalkWorld;
  readonly ship = new Ship();
  readonly progress = new Progress();
  readonly sound = new Sound();
  readonly dayNight: DayNight;
  readonly distanceMap: DistanceMap;
  readonly reflection = new Reflection(0.5);
  private time = 0;
  private readonly post: PostChain;
  private readonly hud: Hud;
  readonly menu: Menu;
  readonly shipyard: Shipyard;
  readonly exploration: Exploration;
  private readonly chart: Chart;
  private quality: 'high' | 'low' = 'high';
  private readonly focus = new THREE.Vector3();
  private readonly lensFocus = new THREE.Vector3();
  private last = 0;
  /** Centre of the circle the land rises in (eased toward a point ahead of the ship / captain). */
  private readonly reveal = new Reveal();
  private running = false;
  frames = 0;

  constructor(private readonly canvas: HTMLCanvasElement, hudParent: HTMLElement) {
    this.renderer = createRenderer(canvas);
    this.distanceMap = new DistanceMap(this.world.land);
    this.view = new FollowCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight), (ox, oy, oz, dx, dy, dz, len) => this.world.terrain.sightBlocked(ox, oy, oz, dx, dy, dz, len));
    const openWater = (x: number, z: number, m: number) => this.world.isOpenWater(x, z, m);
    this.waves = new WaveField(openWater);
    this.life = new SeaLife(openWater, (x, z) => this.world.terrain.distanceAt(x, z), () => this.dayNight.lanterns > 0.5, this.clearLine);
    this.flotsam = new Flotsam(openWater);
    this.marvels = new Marvels(openWater);
    this.walkWorld = {
      distance: (x, z) => this.world.terrain.distanceAt(x, z),
      ground: (x, z) => this.world.land.groundHeight(x, z),
      blockers: (x, z, r) => this.world.terrain.blockersNear(x, z, r),
      bank: (x, z) => this.world.places.streams.bankDistance(x, z),
      deck: (x, z) => this.world.terrain.deckAt(x, z),
      onPath: (x, z) => this.world.terrain.onPath(x, z),
    };
    this.ambience = new Ambience({
      distance: (x, z) => this.world.terrain.distanceAt(x, z),
      bank: (x, z) => this.world.places.streams.bankDistance(x, z),
      biome: (x, z) => this.world.land.biome(x, z, this.world.terrain.distanceAt(x, z)),
    }, this.clearLine, this.lights.key);
    this.scene.add(this.lights.group, this.sea.mesh, this.world.group, this.waves.group, this.life.group, this.flotsam.group, this.ambience.group, this.marvels.group, this.walker.group, this.walker.lantern, this.smoke.group, this.ship.model.root);
    this.post = new PostChain(this.renderer, this.scene, this.view.camera);
    this.dayNight = new DayNight(this.lights, this.post, this.ship.model.light);
    this.hud = new Hud(hudParent);
    this.exploration = new Exploration(this.world.land);
    this.chart = new Chart(
      hudParent,
      this.exploration,
      this.progress,
      () => ({ x: this.ship.physics.x, z: this.ship.physics.z, heading: this.ship.physics.heading, onFoot: this.walker.active ? { x: this.walker.x, z: this.walker.z } : null }),
      () => ({ bottles: this.flotsam.bottlesFound }),
    );
    window.addEventListener('keydown', (e) => {
      if ((e.code === 'KeyE' || e.code === 'Tab') && !e.repeat && !this.menu.isOpen) {
        e.preventDefault();
        this.chart.toggle();
      }
    });
    this.shipyard = new Shipyard(hudParent);
    this.menu = new Menu(
      hudParent,
      {
        onResume: () => this.menu.hide(),
        onShipyard: () => this.shipyard.show(),
        onToggleSound: () => this.sound.toggleMute(),
        onToggleQuality: () => this.setQuality(this.quality === 'high' ? 'low' : 'high'),
        onNewVoyage: (seed?: number) => {
          nextVoyageSeed(seed);
          this.progress.reset();
          this.exploration.reset();
          this.flotsam.reset();
          window.location.reload();
        },
      },
      () => ({
        lands: this.progress.discovered.size,
        treasures: this.progress.treasures.size,
        bottles: this.flotsam.bottlesFound,
        muted: this.sound.isMuted,
        quality: this.quality,
        seed: WORLD.seed,
      }),
    );
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (this.chart.isOpen) this.chart.close();
      else if (this.menu.isOpen) this.menu.hide();
      else this.menu.show();
    });
    // an unfocused tab pauses too
    document.addEventListener('visibilitychange', () => { if (document.hidden && !this.menu.isOpen) this.menu.show(); });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    const [sx, sz, sh] = this.world.findStart();
    this.ship.physics.x = sx;
    this.ship.physics.z = sz;
    this.ship.physics.heading = sh;
    this.world.terrain.uploadTexture = (t) => this.renderer.initTexture(t);
    this.world.prime(sx, sz);
    this.distanceMap.prime(sx, sz);
    this.prewarm();
    // shadows are drawn once per frame, before the mirror pass (see step)
    this.renderer.shadowMap.autoUpdate = false;
    this.ship.launch(0.6);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      if (this.menu.isOpen) this.input.endFrame();
      else this.step(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
  }

  // ---- for the dev tools (tools/qa, tools/media drive the dev build through window.game) ----

  /** Moves the ship to (x, z) at once, stopped, with the land round it built and the camera placed afresh. */
  moveShip(x: number, z: number): void {
    const p = this.ship.physics;
    p.x = x;
    p.z = z;
    p.vx = p.vz = 0;
    this.view.recenter();
    this.world.prime(x, z);
    this.distanceMap.prime(x, z);
  }

  /** Puts the captain ashore at (x, z), the land round him built. */
  landCaptain(x: number, z: number): void {
    this.world.prime(x, z);
    this.walker.land(x, z, this.walkWorld);
  }

  /** Whether the captain could stand at (x, z). */
  canStand(x: number, z: number): boolean {
    return this.walker.canStand(x, z, this.walkWorld);
  }

  /** Opens the voyage chart (it settles over the scene in a second or so). */
  openChart(): void {
    if (!this.chart.isOpen) this.chart.toggle();
  }

  get chartSettled(): boolean {
    return this.chart.settled;
  }

  /** Advances the simulation by dt seconds and renders one frame. */
  step(dt: number): void {
    const ship = this.ship;
    const p = ship.physics;
    // once the chart has settled over the scene the diorama behind it holds still (and is not redrawn): only the
    // chart, the sound and the input run, so panning and zooming the map get the whole frame
    if (this.chart.settled) {
      // (the wheel zooms the chart itself: the camera's notches are dropped)
      this.input.takeWheel();
      this.chart.update(dt);
      this.sound.update(p.x, p.z);
      this.input.endFrame();
      this.frames++;
      return;
    }
    // the keys go to the helm at sea and to the captain ashore (the ship then lies at anchor); while the chart is open
    // the helm is let go and no one reads them
    const walking = this.walker.active;
    const keys = this.chart.isOpen ? null : this.input;
    ship.update(dt, walking ? null : keys, this.world, this.chart.isOpen || walking);
    if (walking) {
      p.vx *= Math.max(0, 1 - dt * 3);
      p.vz *= Math.max(0, 1 - dt * 3);
    }
    this.walker.update(dt, keys, this.walkWorld);
    this.shoreLeave(keys);
    const fx = walking ? this.walker.x : p.x;
    const fz = walking ? this.walker.z : p.z;
    // (with the chart open the camera lifts off the diorama and the wheel is the chart's)
    this.view.lift += ((this.chart.isOpen ? 1 : 0) - this.view.lift) * Math.min(1, dt * 4);
    const wheel = this.input.takeWheel();
    this.view.update(dt, fx, fz, walking ? this.walker.vx : p.vx, walking ? this.walker.vz : p.vz, keys ? wheel : 0, walking, this.walker.group.position.y);

    // streaming focus: ahead of the ship along its velocity
    const lead = Math.min(WORLD.focusLeadMax, WORLD.focusLead * p.speed);
    const sp = p.speed || 1;
    if (walking) this.focus.set(fx, 0, fz);
    else this.focus.set(p.x + (p.vx / sp) * lead, 0, p.z + (p.vz / sp) * lead);


    // papertrails' rules: the ring that stands up (centred ahead of the traveller, world/reveal.ts) is its own, grown by
    // the view's reach as the camera pulls back (the haze beyond it scales with the focus distance in render/post.ts)
    const reach = (this.view.distance - REACH_FROM) * REACH_PER_UNIT;
    this.reveal.update(dt, fx, fz, walking ? this.walker.vx : p.vx, walking ? this.walker.vz : p.vz, reach);
    this.world.update(dt, this.reveal, fx, fz, this.dayNight.lanterns);
    // (everything in view exists: what the ring has not raised lies folded flat, face up, as papertrails shows it)
    const viewReach = this.view.groundRadius(fx, fz);
    this.waves.update(dt, this.focus.x, this.focus.z, ship.wakeSource, this.reveal, viewReach);
    this.clearLine.update(this.view.camera, this.view.focus.x, this.view.focus.z);
    this.life.update(dt, { x: p.x, z: p.z, vx: p.vx, vz: p.vz, fx: p.forwardX, fz: p.forwardZ });
    this.flotsam.update(dt, p.x, p.z, this.reveal, viewReach);
    this.marvels.update(dt, p.x, p.z, this.dayNight.hour, this.dayNight.lanterns > 0.5);
    this.walker.updateLantern(this.dayNight.lanterns);
    this.smoke.update(dt, this.world.terrain.chimneysNear(fx, fz, 14), fx, fz, ship.wind.x, ship.wind.z, this.dayNight.lanterns, this.view.camera);
    this.ambience.update(dt, this.view.focus.x, this.view.focus.z, ship.wind.x, ship.wind.z, this.dayNight.lanterns, this.view.camera);
    this.progress.update(dt, this.world, p.x, p.z);
    this.exploration.update(dt, fx, fz, this.chart.isOpen ? 0 : 0.6);
    this.chart.update(dt);
    this.dayNight.update(dt, !!keys?.isDown('KeyT'));
    this.sound.update(p.x, p.z);
    this.time += dt;
    // (round what the camera looks at: the captain ashore, else the ship)
    this.distanceMap.update(this.view.focus.x, this.view.focus.z);
    this.sea.follow(this.view.focus.x, this.view.focus.z);
    this.sea.setDistanceMap(this.distanceMap);
    this.sea.update(this.time, this.view.distance, this.view.focus.x, this.view.focus.z);
    this.lights.follow(this.view.camera, this.view.focus);
    this.hud.update(dt, {
      sailSetting: ship.sailSetting,
      knots: Math.max(0, p.surge) * KNOTS_PER_UNIT,
      muted: this.sound.isMuted,
      onFoot: walking,
    });
    this.input.endFrame();
    this.post.driftClouds(dt, fx, fz, ship.wind.x, ship.wind.z, this.dayNight.lanterns);
    // (on foot papertrails' focus point: his chest)
    this.lensFocus.set(fx, walking ? this.walker.group.position.y + 0.58 * ON_FOOT.focusHeight : 0.5, fz);
    // (papertrails' page: full colour round the traveller, the unpainted book further out)
    setPageFocus(fx, fz);
    this.post.setFocus(this.lensFocus);
    // mirror pass first (it also refreshes the shadow map for this frame), then the main render
    this.renderer.shadowMap.needsUpdate = true;
    if (this.quality === 'high' && !this.chart.isOpen) {
      this.reflection.render(this.renderer, this.scene, this.view.camera, [this.sea.mesh]);
      this.sea.setReflection(this.reflection);
    } else this.sea.setReflection(null);
    this.post.render(this.time);
    this.frames++;
  }

  /**
   * Load-time warm-up: the silhouette of every sprite that stands on the land is traced, its card batch exists, and
   * every shader variant the game will need (instanced and not) is compiled now, so nothing new ever has to compile
   * in the middle of a voyage.
   */
  private prewarm(): void {
    const names = Object.keys(HEIGHT);
    prewarmSilhouettes(names.map((n) => spriteArt(n, { height: 1 })));
    this.world.cards.prewarm(names);
    // a loose (non-instanced) thick card and plain card for the creatures / flotsam variants
    const warm = new THREE.Group();
    const art = spriteArt('crab', { height: 1 });
    warm.add(createCard(art), createCard(art, { thin: true }));
    // a Blender-built building (the skinned paper variant)
    // (one per biome: the biome tints' shader variants)
    const houses = BIOMES.map((biome) => {
      const house = buildModel('cottage', 0, 0, 0, 0, biome);
      house.fold.snap(1);
      warm.add(house.root);
      return house;
    });
    warm.position.set(this.ship.physics.x, -50, this.ship.physics.z);
    this.scene.add(warm);
    const cam = this.view.camera;
    this.renderer.compile(this.scene, cam);
    this.scene.remove(warm);
    for (const house of houses) house.dispose(true);
  }

  /** F: go ashore when the ship lies by a coast, back aboard when the captain stands by the ship (keys: as in step). */
  private shoreLeave(keys: Input | null): void {
    const p = this.ship.physics;
    const w = this.walker;
    const press = !!keys?.wasPressed('KeyF');
    if (w.active) {
      const near = Math.hypot(w.x - p.x, w.z - p.z) < 2.6;
      this.hud.setPrompt(near ? '<b>F</b> back aboard' : null);
      if (press && near) {
        w.leave();
        this.ship.model.showCaptain(true);
        this.view.targetDistance = CAMERA.distance;
      }
      return;
    }
    if (p.speed > 0.8 || this.chart.isOpen) {
      this.hud.setPrompt(null);
      return;
    }
    // the nearest spot a little up the beach (or on a pier alongside) within reach of the ship, with room to stand
    const spots: Array<[number, number, number]> = [];
    for (let r = 0.6; r <= 2.8; r += 0.2) {
      for (let k = 0; k < 24; k++) {
        const x = p.x + Math.cos((k / 24) * Math.PI * 2) * r;
        const z = p.z + Math.sin((k / 24) * Math.PI * 2) * r;
        const d = this.world.terrain.distanceAt(x, z);
        if (d < -0.3 && d > -1.4) spots.push([x, z, r]);
      }
    }
    for (const [x, z] of this.world.terrain.piersNear(p.x, p.z, 2.8)) {
      const r = Math.hypot(x - p.x, z - p.z);
      if (r > 0.4) spots.push([x, z, r]);
    }
    spots.sort((u, v) => u[2] - v[2]);
    let best: [number, number] | null = null;
    for (const [x, z] of spots.slice(0, 40)) {
      if (w.canStand(x, z, this.walkWorld)) {
        best = [x, z];
        break;
      }
    }
    this.hud.setPrompt(best ? '<b>F</b> go ashore' : null);
    if (press && best) {
      w.land(best[0], best[1], this.walkWorld);
      // on foot the camera comes down to papertrails' distance
      this.view.targetDistance = ON_FOOT.distance;
      this.ship.model.showCaptain(false);
    }
  }

  /** 'low' halves the resolution and skips the mirror pass. */
  setQuality(q: 'high' | 'low'): void {
    this.quality = q;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 0.75);
    this.resize();
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.view.setAspect(w / h);
    this.post.setSize(w, h);
    const dpr = this.renderer.getPixelRatio();
    this.reflection.setSize(w * dpr, h * dpr);
  }
}
