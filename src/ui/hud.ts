/**
 * The HUD, kept as quiet as papertrails' (which shows nothing but one line of hints): the sail setting, speed and
 * compass while sailing (gone ashore), a paper toast for discoveries, and one line of controls that fades away as soon
 * as you get under way. The voyage's counts are on the chart (E). Plain DOM.
 */
import './hud.css';
import { bus } from '../core/events';

const SAIL_NAMES = ['Sails furled', 'Courses set', 'All sails'];

export interface HudState {
  sailSetting: number;
  knots: number;
  /** Heading as the ship root's rotation.y. */
  heading: number;
  windX: number;
  windZ: number;
  muted: boolean;
  /** The captain is ashore: the ship's panel goes. */
  onFoot: boolean;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly sails: HTMLElement;
  private readonly pips: HTMLElement[];
  private readonly speed: HTMLElement;
  private readonly needle: HTMLElement;
  private readonly wind: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly prompt: HTMLElement;

  /** A small paper prompt over the scene ("F go ashore"), or none. */
  setPrompt(html: string | null): void {
    if (html === null) this.prompt.classList.remove('on');
    else {
      if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
      this.prompt.classList.add('on');
    }
  }
  private readonly panel: HTMLElement;
  private readonly toast: HTMLElement;
  private hintTimer = 0;
  private muted = false;
  private toastTimer = 0;
  private readonly queue: Array<{ title: string; line: string }> = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-toast"><div class="hud-toast-title"></div><div class="hud-toast-line"></div></div>
      <div class="hud-panel">
        <div class="hud-compass">
          <div class="hud-rose">N</div>
          <div class="hud-wind" title="Wind"></div>
          <div class="hud-needle"></div>
        </div>
        <div class="hud-readout">
          <div class="hud-speed"><span>0.0</span> kn</div>
          <div class="hud-pips"><i></i><i></i></div>
          <div class="hud-sails">Sails furled</div>
        </div>
      </div>
      <div class="hud-hint">W / S sails &nbsp;·&nbsp; A / D helm &nbsp;·&nbsp; E chart &nbsp;·&nbsp; F go ashore</div>
    `;
    parent.appendChild(this.root);
    this.sails = this.root.querySelector('.hud-sails')!;
    this.pips = Array.from(this.root.querySelectorAll<HTMLElement>('.hud-pips i'));
    this.speed = this.root.querySelector('.hud-speed span')!;
    this.needle = this.root.querySelector('.hud-needle')!;
    this.wind = this.root.querySelector('.hud-wind')!;
    this.hint = this.root.querySelector('.hud-hint')!;
    this.prompt = document.createElement('div');
    this.prompt.className = 'hud-prompt';
    this.root.appendChild(this.prompt);
    this.panel = this.root.querySelector('.hud-panel')!;
    this.toast = this.root.querySelector('.hud-toast')!;

    bus.on('discovered', (e) => this.queue.push({ title: e.name, line: e.name.endsWith(' Coast') ? 'Coast discovered' : 'Island discovered' }));
    bus.on('treasure', (e) => this.queue.push({ title: 'Treasure found!', line: `on ${e.name}` }));
    bus.on('marvel', (e) => this.queue.push({ title: e.title, line: e.line }));
    bus.on('bottle', (e) => this.queue.push({ title: 'Message in a bottle', line: `“${e.message}”` }));
  }

  update(dt: number, s: HudState): void {
    this.sails.textContent = SAIL_NAMES[s.sailSetting] ?? '';
    this.pips.forEach((p, i) => p.classList.toggle('on', i < s.sailSetting));
    this.speed.textContent = s.knots.toFixed(1);
    // screen: north up; heading 0 = north, rotation.y grows counter-clockwise seen from above
    this.needle.style.transform = `translate(-50%, -100%) rotate(${(-s.heading * 180) / Math.PI}deg)`;
    const windDeg = (Math.atan2(s.windX, -s.windZ) * 180) / Math.PI;
    this.wind.style.transform = `translate(-50%, -50%) rotate(${windDeg}deg)`;
    // the hint goes as soon as you are under way (or ashore)
    if (s.sailSetting > 0 || s.knots > 0.3 || s.onFoot) this.hintTimer += dt;
    this.hint.classList.toggle('faded', this.hintTimer > 0.6);
    this.panel.classList.toggle('faded', s.onFoot);
    if (s.muted !== this.muted) {
      this.muted = s.muted;
      this.queue.push({ title: s.muted ? 'Sound off' : 'Sound on', line: 'M' });
    }

    // toasts, one at a time
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) {
      const next = this.queue.shift();
      if (next) {
        (this.toast.querySelector('.hud-toast-title') as HTMLElement).textContent = next.title;
        (this.toast.querySelector('.hud-toast-line') as HTMLElement).textContent = next.line;
        this.toastTimer = 3.2;
      }
    }
    this.toast.classList.toggle('on', this.toastTimer > 0.4);
  }
}
