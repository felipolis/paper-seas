// (first: the interface's paper base must come before every panel's own styles)
import { installPaper } from './ui/paper-sheet';
import { Game } from './app/game';
import { loadSprites } from './art/sprites';
import { loadPaperMaps } from './art/paper-maps';
import { loadModels } from './world/models';
import { loadShipMesh } from './ship/ship-mesh';

declare global {
  interface Window {
    /** The dev build's handle on the game: the browser console, the world QA and the screenshot tool use it. */
    game?: Game;
  }
}

async function boot(): Promise<void> {
  installPaper();
  await Promise.all([loadSprites(), loadPaperMaps()]);
  // (the models' paper material needs the cardstock maps)
  await Promise.all([loadModels(), loadShipMesh()]);
  const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
  const game = new Game(canvas, document.body);
  game.start();
  // the loading card (index.html) lifts away once the first frames are drawn
  const loading = document.getElementById('loading');
  if (loading) {
    const lift = () => {
      if (game.frames < 3) return requestAnimationFrame(lift);
      loading.classList.add('gone');
      loading.addEventListener('transitionend', (e) => e.target === loading && loading.remove());
    };
    requestAnimationFrame(lift);
  }
  if (import.meta.env.DEV) window.game = game;
}

void boot();
