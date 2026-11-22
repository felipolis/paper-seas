import { Game } from './app/game';
import { loadSprites } from './art/sprites';
import { loadPaperMaps } from './art/paper-maps';
import { loadModels } from './world/models';
import { loadShipMesh } from './ship/ship-mesh';
import { loadCrew } from './player/puppet';

async function boot(): Promise<void> {
  await Promise.all([loadSprites(), loadPaperMaps()]);
  // (the models' paper material needs the cardstock maps)
  await Promise.all([loadModels(), loadShipMesh(), loadCrew()]);
  const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
  const game = new Game(canvas, document.body);
  game.start();
  if (import.meta.env.DEV) {
    // handle for debugging in the browser console
    (window as unknown as { game: Game }).game = game;
  }
}

void boot();
