/**
 * Wires the world together and runs the frame loop:
 *   input -> ship (helm, physics, sails) -> camera -> world (terrain chunks, land cards) -> waves -> sea life
 *   -> voyage progress -> day / night -> sound -> HUD -> post
 */
import * as THREE from 'three';
import { CAMERA, ON_FOOT, VIEWS } from '../config/view';
import { WORLD } from '../config/world';
import { Input } from '../core/input';
import { FollowCamera } from '../camera/follow-camera';
import { createRenderer, pixelRatio } from '../render/renderer';
import { Lights } from '../render/lights';
import { PostChain } from '../render/post';
import { DayNight } from '../render/day-night';
import { updatePools } from '../render/lamp-pools';
import { BiomeLook } from '../render/biome-look';
import { SeaSurface } from '../sea/sea-surface';
import { WaveField } from '../sea/wave-field';
import { DistanceMap } from '../sea/distance-map';
import { frameMirrorRipple, setMirror } from '../sea/mirror';
import { Reflection } from '../render/reflection';
import { World } from '../world/world';
import { SeaLife, type ShipState } from '../life/sea-life';
import { Flotsam } from '../life/flotsam';
import { Ambience } from '../life/ambience';
import { Marvels } from '../life/marvels';
import { Walker, type WalkWorld } from '../player/walker';
import { ClickWalk } from '../player/click-walk';
import { CELL, Reveal } from '../world/reveal';
import { PLAYER } from '../config/player';
import { Smoke } from '../life/smoke';
import { ClearLine } from '../life/clear-line';
import { activeCaptain } from '../config/ships';
import { nextVoyageSeed } from '../config/seed';
import { Progress } from '../game/progress';
import { Ship } from '../ship/ship';
import { Sound } from '../audio/sound';
import { Hud, type HudState } from '../ui/hud';
import { Menu } from '../ui/menu';
import { Shipyard } from '../ui/shipyard';
import { Chart } from '../ui/chart';
import { Exploration } from '../game/exploration';
import { spriteArt } from '../art/sprites';
import { SPRITE_NAMES, hasTag } from '../config/flora';
import { createCard, prewarmSilhouettes } from '../popup/card';
import { buildModel } from '../world/models';
import { setPageFocus } from '../render/paper-material';
import { BIOMES } from '../world/land';
import { pondWater } from '../world/stream-mesh';
import { lilyPads } from '../world/lily-pads';

/**
 * Going ashore: the landing spots tried round a ship lying still, on rings from first to reach out (world units),
 * around points on each, a spot taken where the shore distance lies within beach (inland of the waterline); the search
 * is skipped while the ship lies further than reach + beach[0] + slack off the shore (slack: the shore distance
 * estimate's error away from the coast).
 */
const ASHORE = { first: 0.6, reach: 2.8, rings: 11, around: 24, beach: [0.3, 1.4], slack: 2 } as const;
/** Knots shown per world unit / s (a playful scale: full sail reads about 12 kn). */
const KNOTS_PER_UNIT = 3.6;
/**
 * The camera views add a reach to the ring that stands up: none in the on-foot framing (10.8 away), 0.9 tiles in the
 * wide view (14.5 away). The zoom is a continuum too: past the view's own reach, the reach follows that line with the
 * lens's distance (world units of reach per unit of distance; world/reveal.ts caps it at 1.5 tiles).
 */
const REACH_FROM = ON_FOOT.distance;
const WIDE = VIEWS.find((v) => v.name === 'wide')!;
const REACH_PER_UNIT = (WIDE.reach! * CELL) / (WIDE.distance! - ON_FOOT.distance);
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
  /** Click / tap / drag to walk ashore. */
  private readonly clickWalk: ClickWalk;
  readonly ship = new Ship();
  readonly progress = new Progress();
  readonly sound = new Sound();
  readonly dayNight: DayNight;
  /** The biome's light and grade round the one we follow. */
  private readonly biomeLook = new BiomeLook();
  readonly distanceMap: DistanceMap;
  readonly reflection = new Reflection();
  /** What the mirror leaves out: the sea itself. */
  private readonly unmirrored: THREE.Object3D[] = [this.sea.mesh];
  private time = 0;
  private readonly post: PostChain;
  private readonly hud: Hud;
  readonly menu: Menu;
  readonly shipyard: Shipyard;
  readonly exploration: Exploration;
  private readonly chart: Chart;
  private quality: 'high' | 'low' = 'high';
  /** The frame the loop has asked for (cancelled by stop). */
  private frameId = 0;
  private readonly focus = new THREE.Vector3();
  private readonly lensFocus = new THREE.Vector3();
  /** What the sea life and the HUD read every frame, refilled in place. */
  private readonly shipState: ShipState = { x: 0, z: 0, fx: 0, fz: 0 };
  private readonly hudState: HudState = { sailSetting: 0, knots: 0, musicOff: false, onFoot: false };
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
      room: (x, z) => this.world.terrain.roomAt(x, z),
      bank: (x, z) => this.world.places.waterDistance(x, z),
      deck: (x, z) => this.world.terrain.deckAt(x, z),
      onPath: (x, z) => this.world.terrain.onPath(x, z),
    };
    this.clickWalk = new ClickWalk(canvas, this.view.camera, (x, z) => this.walker.canStand(x, z, this.walkWorld), (x, z) => this.walkWorld.deck(x, z) ?? this.walkWorld.ground(x, z), () => this.walker);
    this.ambience = new Ambience({
      distance: (x, z) => this.world.terrain.distanceAt(x, z),
      bank: (x, z) => this.world.places.waterDistance(x, z),
      flower: (x, z, r) => {
        const c = this.world.cards.nearest(x, z, r, (s) => hasTag(s, 'flower'));
        return c ? [c.x, c.z] : null;
      },
      biome: (x, z) => this.world.land.biome(x, z, this.world.terrain.distanceAt(x, z)),
    }, this.clearLine, this.lights.key);
    this.scene.add(this.lights.group, this.sea.mesh, this.world.group, this.waves.group, this.life.group, this.flotsam.group, this.ambience.group, this.marvels.group, this.walker.group, this.walker.lantern, this.clickWalk.mark.mesh, this.smoke.group, this.ship.model.root);
    this.post = new PostChain(this.renderer, this.scene, this.view.camera, this.biomeLook);
    this.dayNight = new DayNight(this.lights, this.post, this.ship.model.light, this.biomeLook);
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
        onToggleMusic: () => this.sound.toggleMusic(),
        onToggleQuality: () => this.setQuality(this.quality === 'high' ? 'low' : 'high'),
        onNewVoyage: (seed?: number) => {
          nextVoyageSeed(seed);
          this.progress.forgetVoyage();
          this.exploration.forgetVoyage();
          this.flotsam.forgetVoyage();
          window.location.reload();
        },
      },
      () => ({
        lands: this.progress.discovered.size,
        treasures: this.progress.treasures.size,
        bottles: this.flotsam.bottlesFound,
        musicOff: this.sound.isMusicOff,
        quality: this.quality,
        seed: WORLD.seed,
      }),
    );
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || e.repeat) return;
      // (the menu first: it can be shown over the chart when the tab goes hidden)
      if (this.menu.isOpen) this.menu.hide();
      else if (this.chart.isOpen) this.chart.close();
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
      const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      if (this.menu.isOpen) {
        // (paused: the wheel's notches go to the menu's lists, not to the camera on resume)
        this.input.takeWheel();
        this.input.endFrame();
      } else this.step(dt);
      this.frameId = requestAnimationFrame(frame);
    };
    this.frameId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  // ---- for the dev tools (tools/qa, tools/media drive the dev build through window.game) ----

  /**
   * Moves the ship to (x, z) at once, stopped dead (no way, turn or heel left), with the land round it built and the
   * camera placed afresh.
   */
  moveShip(x: number, z: number): void {
    const p = this.ship.physics;
    p.x = x;
    p.z = z;
    p.stop();
    this.view.recenter();
    this.world.prime(x, z);
    this.distanceMap.prime(x, z);
  }

  /** Puts the captain ashore at (x, z), the land round him built and the camera placed afresh. */
  landCaptain(x: number, z: number): void {
    this.world.prime(x, z);
    this.goAshore(x, z);
    this.view.recenter();
  }

  /** The captain steps ashore at (x, z): he leaves the wheel, and the camera comes down to its on-foot distance. */
  private goAshore(x: number, z: number): void {
    this.walker.land(x, z, this.walkWorld);
    this.clickWalk.cancel();
    this.view.targetDistance = ON_FOOT.distance;
    this.ship.model.showCaptain(false);
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
      this.sound.update(this.walker.active ? this.walker.x : p.x, this.walker.active ? this.walker.z : p.z);
      this.input.endFrame();
      this.frames++;
      return;
    }
    // the keys go to the helm at sea and to the captain ashore (the ship then lies at anchor); while the chart is open
    // the helm is let go and no one reads them
    const keys = this.chart.isOpen ? null : this.input;
    // (F first: the frame that goes ashore or back aboard is already the captain's or the ship's, so the camera starts
    // its glide on that frame instead of taking one plain step toward the new distance before it)
    this.shoreLeave(keys);
    const walking = this.walker.active;
    ship.update(dt, walking ? null : keys, this.world, this.chart.isOpen || walking);
    if (walking) p.anchor(dt);
    // (a click walks him while no key does; a key lets the click's walk go)
    this.clickWalk.enabled = walking && !this.chart.isOpen;
    this.walker.update(dt, keys, this.walkWorld, this.view.yaw, this.clickWalk.steer(dt));
    if (this.walker.keyed) this.clickWalk.drop();
    const fx = walking ? this.walker.x : p.x;
    const fz = walking ? this.walker.z : p.z;
    // (with the chart open the camera lifts off the diorama and the wheel is the chart's)
    this.view.lift += ((this.chart.isOpen ? 1 : 0) - this.view.lift) * (1 - Math.exp(-4 * dt));
    if (keys?.wasPressed('KeyV')) {
      const i = this.view.nextView();
      this.hud.showView(VIEWS[i].name, i, VIEWS.length);
    }
    const wheel = this.input.takeWheel();
    this.view.update(dt, fx, fz, walking ? this.walker.vx : p.vx, walking ? this.walker.vz : p.vz, keys ? wheel : 0, walking, walking ? this.walker.group.position.y : 0);

    // streaming focus: ahead of the ship along its velocity
    const lead = Math.min(WORLD.focusLeadMax, WORLD.focusLead * p.speed);
    const sp = p.speed || 1;
    if (walking) this.focus.set(fx, 0, fz);
    else this.focus.set(p.x + (p.vx / sp) * lead, 0, p.z + (p.vz / sp) * lead);

    // the ring that stands up (centred ahead of the one we follow, world/reveal.ts) is its own, grown by the view's
    // reach as the camera pulls back (the haze beyond it scales with the focus distance in render/post.ts)
    const reach = Math.max(this.view.viewReach, (this.view.lensDistance - REACH_FROM) * REACH_PER_UNIT);
    this.reveal.update(dt, fx, fz, walking ? this.walker.vx : p.vx, walking ? this.walker.vz : p.vz, reach);
    this.world.update(dt, this.reveal, fx, fz, this.dayNight.lanterns);
    // (everything in view exists: what the ring has not raised lies folded flat, face up)
    const viewReach = this.view.groundRadius(fx, fz);
    this.waves.update(dt, this.focus.x, this.focus.z, ship.wakeSource, this.reveal, viewReach);
    // (the living pieces keep clear of the one we follow, and their weather and biomes are his)
    this.clearLine.update(this.view.camera, fx, fz);
    const st = this.shipState;
    st.x = p.x;
    st.z = p.z;
    st.fx = p.forwardX;
    st.fz = p.forwardZ;
    this.life.update(dt, st);
    this.flotsam.update(dt, p.x, p.z, this.reveal, viewReach);
    this.marvels.update(dt, p.x, p.z, this.dayNight.hour, this.dayNight.lanterns > 0.5, !walking);
    this.walker.updateLantern(dt, this.dayNight.lanterns);
    updatePools(this.dayNight.lanterns, fx, fz, this.world.cards.lamps);
    this.smoke.update(dt, this.world.terrain.chimneysNear(fx, fz, 14), fx, fz, ship.wind.x, ship.wind.z, this.dayNight.lanterns, this.view.camera);
    this.ambience.update(dt, fx, fz, ship.wind.x, ship.wind.z, this.dayNight.lanterns, this.view.camera);
    this.progress.update(dt, this.world, p.x, p.z);
    this.exploration.update(dt, fx, fz, this.chart.isOpen ? 0 : 0.6);
    this.chart.update(dt);
    this.biomeLook.update(dt, this.world.land, fx, fz);
    if (keys?.wasPressed('KeyT')) this.dayNight.toggle();
    this.dayNight.update(dt);
    this.sound.update(fx, fz);
    this.time += dt;
    // (round what the camera looks at: the captain ashore, else the ship)
    this.distanceMap.update(this.view.focus.x, this.view.focus.z);
    this.sea.follow(this.view.focus.x, this.view.focus.z);
    this.sea.setDistanceMap(this.distanceMap);
    this.sea.update(this.time);
    frameMirrorRipple(this.view.lensDistance, this.view.focus.x, this.view.focus.z);
    this.lights.follow(this.view.camera, this.view.focus);
    const hs = this.hudState;
    hs.sailSetting = ship.sailSetting;
    hs.knots = Math.max(0, p.surge) * KNOTS_PER_UNIT;
    hs.musicOff = this.sound.isMusicOff;
    hs.onFoot = walking;
    this.hud.update(dt, hs);
    this.input.endFrame();
    this.post.driftClouds(dt, fx, fz, ship.wind.x, ship.wind.z, this.dayNight.lanterns);
    // (on foot the focus point is his chest)
    this.lensFocus.set(fx, walking ? this.walker.group.position.y + PLAYER.height * ON_FOOT.focusHeight : 0.5, fz);
    // (the page: full colour round the one we follow, the unpainted book further out)
    setPageFocus(fx, fz);
    this.post.setFocus(this.lensFocus);
    // mirror pass first, then the main render; the sea and the streams read the one image (sea/mirror.ts). The shadow
    // map is refreshed by the main render, the first after needsUpdate: the mirror pass hides the land's printed tops
    // (mirrorSkip), and a shadow map drawn then would lose their shadows (the mirror makes do with last frame's)
    const mirror = this.quality === 'high' && !this.chart.isOpen;
    if (mirror) this.reflection.render(this.renderer, this.scene, this.view.camera, this.unmirrored);
    setMirror(mirror ? this.reflection : null);
    this.renderer.shadowMap.needsUpdate = true;
    this.post.render(this.time);
    this.frames++;
  }

  /**
   * Load-time warm-up: the silhouette of every sprite that stands on the land is traced, its card batch exists, and
   * every shader variant the game will need (instanced and not) is compiled now, so nothing new ever has to compile
   * in the middle of a voyage.
   */
  private prewarm(): void {
    const names = SPRITE_NAMES;
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
    // a pond's still water and its lily pads (their own shaders)
    const pond = { id: 1, x: 0, z: 0, r: 1, wave: [0, 0, 0, 0] as [number, number, number, number] };
    const ponds = [pondWater([pond], () => 'meadow'), lilyPads([pond])].filter((m): m is THREE.Mesh => !!m);
    warm.add(...ponds);
    warm.position.set(this.ship.physics.x, -50, this.ship.physics.z);
    this.scene.add(warm);
    const cam = this.view.camera;
    this.renderer.compile(this.scene, cam);
    this.scene.remove(warm);
    for (const house of houses) house.dispose(true);
    for (const mesh of ponds) mesh.geometry.dispose();
  }

  /** F: go ashore when the ship lies by a coast, back aboard when the captain stands by the ship (keys: as in step). */
  private shoreLeave(keys: Input | null): void {
    const p = this.ship.physics;
    const w = this.walker;
    const press = !!keys?.wasPressed('KeyF');
    if (w.active) {
      // (no prompt over the chart: its keys are the chart's)
      const near = !this.chart.isOpen && Math.hypot(w.x - p.x, w.z - p.z) < 2.6;
      this.hud.setPrompt(near ? '<b>F</b> back aboard' : null);
      if (press && near) {
        w.leave();
        this.clickWalk.cancel();
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
    // (searched only when the shore can be in reach: this runs every frame the ship lies still)
    const spots: Array<[number, number, number]> = [];
    if (this.world.terrain.distanceAt(p.x, p.z) < ASHORE.reach + ASHORE.beach[0] + ASHORE.slack) {
      for (let s = 0; s <= ASHORE.rings; s++) {
        const r = ASHORE.first + ((ASHORE.reach - ASHORE.first) * s) / ASHORE.rings;
        for (let k = 0; k < ASHORE.around; k++) {
          const x = p.x + Math.cos((k / ASHORE.around) * Math.PI * 2) * r;
          const z = p.z + Math.sin((k / ASHORE.around) * Math.PI * 2) * r;
          const d = this.world.terrain.distanceAt(x, z);
          if (d < -ASHORE.beach[0] && d > -ASHORE.beach[1]) spots.push([x, z, r]);
        }
      }
    }
    for (const [x, z] of this.world.terrain.piersNear(p.x, p.z, ASHORE.reach)) {
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
    if (press && best) this.goAshore(best[0], best[1]);
  }

  /** 'low' draws at 0.75 of a CSS pixel (render/renderer.ts pixelRatio) and skips the mirror pass. */
  setQuality(q: 'high' | 'low'): void {
    this.quality = q;
    this.resize();
  }

  private resize(): void {
    this.renderer.setPixelRatio(pixelRatio(this.quality));
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.view.setAspect(w / h);
    this.post.setSize(w, h);
    const dpr = this.renderer.getPixelRatio();
    this.reflection.setSize(w * dpr, h * dpr);
  }
}
