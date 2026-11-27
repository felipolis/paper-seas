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
  // everything downloads at once; the models' paper material waits only for the cardstock maps
  const maps = loadPaperMaps();
  await Promise.all([loadSprites(), maps, loadModels(maps), loadShipMesh()]);
  const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
  const game = new Game(canvas, document.body);
  game.start();
  // the loading card (index.html) lifts away once the first frames are drawn
  const loading = document.getElementById('loading');
  if (loading) {
    const lift = () => {
      if (game.frames < 3) return requestAnimationFrame(lift);
      loading.classList.add('gone');
      if (getComputedStyle(loading).transitionDuration.split(',').some((d) => parseFloat(d) > 0)) {
        loading.addEventListener('transitionend', (e) => e.target === loading && loading.remove());
      } else loading.remove();
    };
    requestAnimationFrame(lift);
  }
  if (import.meta.env.DEV) window.game = game;
}

/**
 * The voyage could not start (an asset that would not download or decode, a graphics context the browser refused):
 * the loading card says so instead of folding the sea forever, and the console keeps the cause.
 */
function showBootFailure(err: unknown): void {
  console.error('Paper Seas could not set sail:', err);
  const loading = document.getElementById('loading');
  const line = loading?.querySelector('.line');
  if (!loading || !line) return;
  loading.setAttribute('aria-label', 'Paper Seas could not set sail');
  line.textContent = 'The sea would not fold. Reload the page to try again.';
}

boot().catch(showBootFailure);
