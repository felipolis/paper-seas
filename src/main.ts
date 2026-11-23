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
  await Promise.all([loadSprites(), loadPaperMaps()]);
  // (the models' paper material needs the cardstock maps)
  await Promise.all([loadModels(), loadShipMesh()]);
  const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
  const game = new Game(canvas, document.body);
  game.start();
  if (import.meta.env.DEV) window.game = game;
}

void boot();
