/**
 * Pause menu (Esc): a sheet of paper that slides up over the scene (the papercraft skill's sheet: from below, turned
 * a little) with the voyage log, sound and quality toggles, the controls and a
 * fresh-voyage option. While it is open the world stops.
 */
import './menu.css';
import { bus } from '../core/events';

export interface MenuState {
  lands: number;
  treasures: number;
  bottles: number;
  musicOff: boolean;
  quality: 'high' | 'low';
  seed: number;
}

export interface MenuActions {
  onResume(): void;
  onToggleMusic(): void;
  onShipyard(): void;
  onToggleQuality(): void;
  /** A new world: the typed seed, or a random one when empty. */
  onNewVoyage(seed?: number): void;
}

export class Menu {
  private readonly root: HTMLElement;
  private open = false;

  constructor(parent: HTMLElement, private readonly actions: MenuActions, private readonly state: () => MenuState) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.innerHTML = `
      <div class="menu-card paper-card" role="dialog" aria-label="Paused">
        <div class="menu-title">Paper Seas</div>
        <div class="menu-sub">The voyage is paused</div>
        <div class="menu-log"></div>
        <div class="menu-buttons">
          <button class="paper-btn primary" data-act="resume">Set sail again</button>
          <button class="paper-btn" data-act="yard">Shipyard: ship &amp; captain</button>
          <button class="paper-btn" data-act="music"></button>
          <button class="paper-btn" data-act="quality"></button>
          <div class="menu-seed">World seed <b class="menu-seed-now"></b></div>
          <div class="menu-new"><input class="menu-seed-in" inputmode="numeric" placeholder="seed (empty = random)" maxlength="7"><button class="paper-btn" data-act="new">New voyage</button></div>
        </div>
        <div class="menu-keys">
          <span><b>W</b>/<b>S</b> sails</span><span><b>A</b>/<b>D</b> helm</span><span><b>Wheel</b> zoom</span>
          <span><b>E</b> chart</span><span><b>F</b> go ashore / aboard</span><span><b>Shift</b> run</span><span><b>Ctrl</b> stroll</span>
          <span><b>V</b> view</span><span><b>T</b> day / night</span><span><b>M</b> music</span><span><b>Esc</b> pause</span>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.root.inert = true;
    // (M turns the music off from anywhere: the music button follows)
    bus.on('music', () => this.render());
    this.root.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (act === 'resume') this.actions.onResume();
      else if (act === 'yard') this.actions.onShipyard();
      else if (act === 'music') this.actions.onToggleMusic();
      else if (act === 'quality') this.actions.onToggleQuality();
      else if (act === 'new') {
        const typed = Number((this.root.querySelector('.menu-seed-in') as HTMLInputElement).value.replace(/\D/g, ''));
        if (window.confirm('Start a new voyage in a new world? Discoveries and treasure will be forgotten.')) this.actions.onNewVoyage(typed || undefined);
      }
      this.render();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.render();
    this.root.inert = false;
    this.root.classList.add('on');
  }

  hide(): void {
    this.open = false;
    this.root.inert = true;
    this.root.classList.remove('on');
  }

  private render(): void {
    const s = this.state();
    (this.root.querySelector('.menu-log') as HTMLElement).innerHTML =
      `<div><b>${s.lands}</b> lands discovered</div><div><b>${s.treasures}</b> treasures found</div><div><b>${s.bottles}</b> bottles read</div>`;
    (this.root.querySelector('[data-act="music"]') as HTMLElement).textContent = s.musicOff ? 'Music: off' : 'Music: on';
    (this.root.querySelector('.menu-seed-now') as HTMLElement).textContent = String(s.seed);
    (this.root.querySelector('[data-act="quality"]') as HTMLElement).textContent = s.quality === 'high' ? 'Quality: high' : 'Quality: fast';
  }
}
