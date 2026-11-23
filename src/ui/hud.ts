/**
 * The HUD, with no chrome (the papercraft skill's paper-ui.md: feedback is paper, ink and light in the scene): the
 * sails show how much canvas is set, the flag the wind, the wake the speed, the chart (E) the voyage's counts. What
 * is left is one line of controls that fades away once you get under way, a small paper prompt over the scene
 * ("F go ashore") and a paper card for discoveries that slides down like a sheet and back up. Plain DOM.
 */
import './hud.css';
import { bus } from '../core/events';

export interface HudState {
  sailSetting: number;
  knots: number;
  muted: boolean;
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
  private hintTimer = 0;
  private muted = false;
  private toastTimer = 0;
  private readonly queue: Array<{ title: string; line: string }> = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-toast paper-card"><div class="hud-toast-title"></div><div class="hud-toast-line"></div></div>
      <div class="hud-prompt paper-card"></div>
      <div class="hud-hint">W / S sails &nbsp;·&nbsp; A / D helm &nbsp;·&nbsp; E chart &nbsp;·&nbsp; F go ashore</div>
    `;
    parent.appendChild(this.root);
    this.hint = this.root.querySelector('.hud-hint')!;
    this.prompt = this.root.querySelector('.hud-prompt')!;
    this.toast = this.root.querySelector('.hud-toast')!;
    this.toastTitle = this.root.querySelector('.hud-toast-title')!;
    this.toastLine = this.root.querySelector('.hud-toast-line')!;

    bus.on('discovered', (e) => this.queue.push({ title: e.name, line: e.name.endsWith(' Coast') ? 'Coast discovered' : 'Island discovered' }));
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

  update(dt: number, s: HudState): void {
    // the hint goes as soon as you are under way (or ashore)
    if (s.sailSetting > 0 || s.knots > 0.3 || s.onFoot) this.hintTimer += dt;
    this.hint.classList.toggle('faded', this.hintTimer > 0.6);
    if (s.muted !== this.muted) {
      this.muted = s.muted;
      this.queue.push({ title: s.muted ? 'Sound off' : 'Sound on', line: 'M' });
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
