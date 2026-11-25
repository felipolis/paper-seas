// The browser every tool drives (Playwright on the installed Edge) and the dev build's address (npm run dev).
//   GAME_URL   the dev build (default http://localhost:5180/)
//   EDGE_PATH  the Edge executable (default: its usual place on Windows)
import { chromium } from 'playwright-core';

const GAME_URL = process.env.GAME_URL ?? 'http://localhost:5180/';
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
/** Where the game keeps the world's seed (src/config/seed.ts KEY). */
const SEED_KEY = 'paper-seas:seed';
/** How long the dev build may take to load and draw its first frames (ms). */
const BOOT_TIMEOUT = 90000;

/** Headless Edge; gpu: on the real GPU (the tools that run the game), else the art tools' plain 2D canvases. */
export function launch({ gpu = false } = {}) {
  return chromium.launch({ executablePath: EDGE, headless: true, args: gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });
}

/**
 * Opens the dev build in a new page of browser (launched with gpu) and waits until the game has drawn a few frames
 * (window.game is the dev build's handle).
 *   viewport        the page's size (default: Playwright's)
 *   seed            the world to play (default: whatever the page draws)
 *   onPageError     called with the message of every uncaught error in the page
 *   onConsoleError  called with the text of every console.error in the page
 */
export async function openGame(browser, { viewport, seed, onPageError, onConsoleError } = {}) {
  const page = await browser.newPage(viewport ? { viewport } : {});
  if (onPageError) page.on('pageerror', (e) => onPageError(e.message));
  if (onConsoleError) page.on('console', (m) => m.type() === 'error' && onConsoleError(m.text()));
  if (seed !== undefined) await page.addInitScript(([key, s]) => localStorage.setItem(key, s), [SEED_KEY, String(seed)]);
  await page.goto(GAME_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.game && window.game.frames > 2, null, { timeout: BOOT_TIMEOUT });
  return page;
}
