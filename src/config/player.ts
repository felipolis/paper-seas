/** The captain ashore: papertrails' traveller (config/player.js there), who is as tall as the captain. */
export const PLAYER = {
  /**
   * Walking speed (u/s), Shift's run multiplier, the slow stroll's (a lone tap of Ctrl toggles it, papertrails'
   * slowMul), the acceleration toward the wanted velocity (u/s²).
   */
  speed: 1.15,
  runMul: 1.8,
  slowMul: 0.6,
  accel: 17,
} as const;

/** Click / tap / drag to walk: papertrails' values (config/player.js there). */
export const CLICK_WALK = {
  /** How near the target counts as arrived (u). */
  arriveRadius: 0.12,
  /** The target is let go after this long without real movement (s), or this long without getting nearer (s). */
  stuckTime: 1.2,
  noProgressTime: 1.0,
  /** The route finder's grid cell and the side of the square it searches (u), centred between him and the target. */
  routeCell: 0.15,
  routeSpan: 12,
  /** The look-ahead for feeling the way round an obstacle when no route is found (u). */
  probe: 0.45,
  /** The inked mark on the page at the target: its radius (u), its fade after arrival (s) and its opacity. */
  markSize: 0.13,
  markFade: 0.9,
  markOpacity: 0.5,
} as const;
