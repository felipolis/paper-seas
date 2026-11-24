// The browser every tool drives (Playwright on the installed Edge) and the dev build's address (npm run dev).
//   GAME_URL   the dev build (default http://localhost:5180/)
//   EDGE_PATH  the Edge executable (default: its usual place on Windows)
import { chromium } from 'playwright-core';

export const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5180/';
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/** Headless Edge; gpu: on the real GPU (the tools that run the game), else the art tools' plain 2D canvases. */
export function launch({ gpu = false } = {}) {
  return chromium.launch({ executablePath: EDGE, headless: true, args: gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });
}
