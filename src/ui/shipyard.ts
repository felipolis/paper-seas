/**
 * The shipyard (from the pause menu): a sheet of paper cards to pick the ship and the captain at the helm. Each
 * ship card shows its printed hull with its flag, its name, a line about her and her handling; each captain card
 * shows the figure. "Set sail" keeps the choice and reloads the voyage with it (the world and the voyage log stay).
 */
import './shipyard.css';
import { CAPTAINS, SHIP_TYPES, activeCaptain, activeShip, chooseCrew } from '../config/ships';

const art = (name: string) => `${import.meta.env.BASE_URL}art/${name}.png`;

export class Shipyard {
  private readonly root: HTMLElement;
  private ship = activeShip().id;
  private captain = activeCaptain().id;

  constructor(parent: HTMLElement, private readonly onClose: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'yard';
    const fastest = Math.max(...SHIP_TYPES.map((s) => s.maxSpeed));
    const nimblest = Math.max(...SHIP_TYPES.map((s) => s.turnRate));
    const bar = (v: number) => `<span class="yard-bar"><i style="width:${Math.round(v * 100)}%"></i></span>`;
    this.root.innerHTML = `
      <div class="yard-sheet" role="dialog" aria-label="Shipyard">
        <div class="yard-title">The Shipyard</div>
        <div class="yard-sub">Choose your ship and the captain at her helm</div>
        <div class="yard-ships">
          ${SHIP_TYPES.map((s) => `
            <button class="yard-ship" data-ship="${s.id}">
              <span class="yard-art"><img src="${art(s.picture)}" alt=""><img class="yard-flag" src="${art(s.flag)}" alt=""></span>
              <span class="yard-name">${s.name}</span>
              <span class="yard-blurb">${s.blurb}</span>
              <span class="yard-stats"><span>Speed ${bar(s.maxSpeed / fastest)}</span><span>Helm ${bar(s.turnRate / nimblest)}</span></span>
            </button>`).join('')}
        </div>
        <div class="yard-crew">
          ${CAPTAINS.map((c) => `
            <button class="yard-captain" data-captain="${c.id}" title="${c.name}">
              <img src="${art(c.sprite)}" alt="">
              <span>${c.name}</span>
            </button>`).join('')}
        </div>
        <div class="yard-buttons">
          <button data-act="back">Back</button>
          <button data-act="sail" class="primary">Set sail</button>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('button');
      if (!el) return;
      if (el.dataset.ship) this.ship = el.dataset.ship;
      if (el.dataset.captain) this.captain = el.dataset.captain;
      if (el.dataset.act === 'back') this.hide();
      if (el.dataset.act === 'sail') {
        const changed = this.ship !== activeShip().id || this.captain !== activeCaptain().id;
        chooseCrew(this.ship, this.captain);
        if (changed) window.location.reload();
        else this.hide();
      }
      this.render();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) {
        e.stopImmediatePropagation();
        this.hide();
      }
    }, true);
  }

  get isOpen(): boolean {
    return this.root.classList.contains('on');
  }

  show(): void {
    this.ship = activeShip().id;
    this.captain = activeCaptain().id;
    this.render();
    this.root.classList.add('on');
  }

  hide(): void {
    this.root.classList.remove('on');
    this.onClose();
  }

  private render(): void {
    this.root.querySelectorAll<HTMLElement>('.yard-ship').forEach((b) => b.classList.toggle('chosen', b.dataset.ship === this.ship));
    this.root.querySelectorAll<HTMLElement>('.yard-captain').forEach((b) => b.classList.toggle('chosen', b.dataset.captain === this.captain));
  }
}
