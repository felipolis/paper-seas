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
