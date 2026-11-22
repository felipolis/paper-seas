/** Procedural world: island placement, streaming radii, wave cards. */
import { VOYAGE_SEED } from './seed';

export const WORLD = {
  /** The voyage's own seed (config/seed.ts): every new voyage is a new world. */
  seed: VOYAGE_SEED,

  // ---- islands ----
  /** Islands are placed one candidate per region cell (jittered), so the ocean never clumps or empties. */
  regionSize: 30,
  islandChance: 0.72,
  /** No island closer than this to the start (the ship needs open water to pop up in). */
  spawnClearRadius: 9,

  // ---- wave cards ----
  /** Wave cards sit on a 2 x 2 grid; this share of cells holds one. */
  waveCell: 2,
  waveChance: 0.72,
  /** Waves exist (lying flat, printed on the sea) within the view, at least waveSpawnRadius, and stand up by the ring. */
  waveSpawnRadius: 17,
  /** Ripple delay (s per unit of distance from the ship) so a ring of waves rises outward. */
  waveRipple: 0.025,
  /** The bow presses waves flat inside this extra half-width around the hull; they spring back after waveHold s. */
  wakeHalfWidth: 0.35,
  waveHold: 0.45,
  /** Idle swell: waves rock about their hinge (deg), travelling with the swell. */
  swayDeg: 9,
  swayHz: 0.32,
  swayLength: 9,

  /** The streaming focus leads the ship by its velocity x this (s), clamped. */
  focusLead: 0.5,
  focusLeadMax: 1.6,
} as const;
