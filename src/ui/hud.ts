/**
 * The HUD, with no chrome (feedback is paper, ink and light in the scene): the sails show how much canvas is set, the
 * flag the wind, the wake the speed, the chart (E) the voyage's counts. What is left is two lines of controls that fade
 * away once you get under way (and the walking keys, the first time ashore), a small paper prompt over the scene ("F go
 * ashore"), a paper card for discoveries that slides down like a sheet and back up, and a slip naming the camera view
 * for a moment after V. Plain DOM.
 */
import './hud.css';
import { bus } from '../core/events';

/** How long the walking keys show the first time ashore (s). */
const FOOT_HINT = 7;
/** How long the view's slip stays after a press of V (s). */
const VIEW_SHOWN = 1.2;

export interface HudState {
  sailSetting: number;
  knots: number;
  /** The music is off (M). */
  musicOff: boolean;
  /** The captain is ashore. */
  onFoot: boolean;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly toastTitle: HTMLElement;
  private readonly toastLine: HTMLElement;
  private readonly viewSlip: HTMLElement;
  private hintTimer = 0;
  private musicOff = false;
  private readonly footHint: HTMLElement;
  /** Seconds ashore so far (the walking keys show the first time, then go). */
  private ashore = 0;
  private toastTimer = 0;
  private viewTimer = 0;
  private readonly queue: Array<{ title: string; line: string }> = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-toast paper-card"><div class="hud-toast-title"></div><div class="hud-toast-line"></div></div>
      <div class="hud-prompt paper-card"></div>
      <div class="hud-view paper-card"></div>
      <div class="hud-hint"><div>W / S sails &nbsp;·&nbsp; A / D helm &nbsp;·&nbsp; E chart &nbsp;·&nbsp; F go ashore</div><div>V view &nbsp;·&nbsp; T day / night &nbsp;·&nbsp; M music &nbsp;·&nbsp; Esc pause</div></div>
      <div class="hud-hint faded">WASD or click to walk &nbsp;·&nbsp; Shift run &nbsp;·&nbsp; Ctrl stroll &nbsp;·&nbsp; F back aboard</div>
    `;
    parent.appendChild(this.root);
    [this.hint, this.footHint] = [...this.root.querySelectorAll<HTMLElement>('.hud-hint')];
    this.prompt = this.root.querySelector('.hud-prompt')!;
    this.toast = this.root.querySelector('.hud-toast')!;
    this.toastTitle = this.root.querySelector('.hud-toast-title')!;
    this.toastLine = this.root.querySelector('.hud-toast-line')!;
    this.viewSlip = this.root.querySelector('.hud-view')!;

    bus.on('discovered', (e) => this.queue.push({ title: e.name, line: e.coast ? 'Coast discovered' : 'Island discovered' }));
    bus.on('treasure', (e) => this.queue.push({ title: 'Treasure found!', line: `on ${e.name}` }));
    bus.on('marvel', (e) => this.queue.push({ title: e.title, line: e.line }));
    bus.on('bottle', (e) => this.queue.push({ title: 'Message in a bottle', line: `“${e.message}”` }));
  }

  /** A small paper prompt over the scene ("F go ashore"), or none. */
  setPrompt(html: string | null): void {
    if (html === null) this.prompt.classList.remove('on');
    else {
      if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
      this.prompt.classList.add('on');
    }
  }

  /**
   * V: names the camera view now (its name, and which of how many) for VIEW_SHOWN seconds; another press renames it.
   */
  showView(name: string, index: number, count: number): void {
    this.viewSlip.innerHTML = `<b>${name}</b> view <span>${index + 1} / ${count}</span>`;
    this.viewSlip.classList.add('on');
    this.viewTimer = VIEW_SHOWN;
  }

  update(dt: number, s: HudState): void {
    if (this.viewTimer > 0 && (this.viewTimer -= dt) <= 0) this.viewSlip.classList.remove('on');
    // the hint goes as soon as you are under way (or ashore)
    if (s.sailSetting > 0 || s.knots > 0.3 || s.onFoot) this.hintTimer += dt;
    this.hint.classList.toggle('faded', this.hintTimer > 0.6);
    // the walking keys, the first time ashore, for FOOT_HINT seconds
    if (s.onFoot) this.ashore += dt;
    this.footHint.classList.toggle('faded', !s.onFoot || this.ashore > FOOT_HINT);
    if (s.musicOff !== this.musicOff) {
      this.musicOff = s.musicOff;
      this.queue.push({ title: s.musicOff ? 'Music off' : 'Music on', line: 'M' });
    }

    // the discovery cards, one at a time
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) {
      const next = this.queue.shift();
      if (next) {
        this.toastTitle.textContent = next.title;
        this.toastLine.textContent = next.line;
        this.toastTimer = 3.2;
      }
    }
    this.toast.classList.toggle('on', this.toastTimer > 0.6);
  }
}
