import type { LifeRow } from './biomes';

/** Sea life: how often creatures show up around the ship and how they move. */
export const LIFE = {
  /** Seconds between two creature appearances (random in this range): now and then, never filling the sea. */
  spawnInterval: [9, 18] as [number, number],
  /** At most this many encounters at once. */
  maxActive: 2,
  /**
   * The sea's environments, by the ship's distance from the nearest shore (a living world: 3-5 kinds of life chosen
   * for each environment, never one list everywhere): the encounters of each, as relative chances, and whether its
   * gulls fly there (they keep within sight of land). The last reaches out to the deep.
   */
  zones: [
    // coastal water: the shallows' small life, gulls overhead
    { until: 7, gulls: true, weights: { turtle: 0.25, jellyfish: 0.25, fishSchool: 0.3, octopus: 0.2 } },
    // the open sea: what crosses it, gulls still about
    { until: 16, gulls: true, weights: { dolphins: 0.35, flyingFish: 0.25, manta: 0.2, ship: 0.2 } },
    // the deep, out of sight of land: the great and the strange
    { until: Infinity, gulls: false, weights: { whale: 0.35, shark: 0.3, kraken: 0.18, serpent: 0.17 } },
  ],
  /** Encounters appear this far from the ship (world units), on the side it is heading to. */
  spawnDistance: [4, 6.5] as [number, number],
  /**
   * Gulls, each circling a spot of its own over the sea; once the ship is gullRange from it, it shrinks away and comes
   * back over a spot gullAhead ahead of the ship.
   */
  gulls: 3,
  gullHeight: [2.6, 3.4] as [number, number],
  gullRadius: [2.5, 4.5] as [number, number],
  gullRange: 11,
  gullAhead: [3, 8] as [number, number],
} as const;

/** The ground shadow colour: the soft shadows lying on the page (the birds', the clouds'). */
export const GROUND_SHADOW = '#0b0a1c';

/** The kinds of ambient life whose numbers follow the biome and the night. */
export type LifeKind = 'leaves' | 'petals' | 'dust' | 'rain' | 'mist' | 'butterflies' | 'fireflies' | 'birds';

/**
 * Ambient life and weather round the focus. Fallers: size in world units, fall in units / s, sway = side-to-side
 * amplitude, tumble = spin speed (rad / s), land = seconds a piece rests on the ground while it shrinks away, wind =
 * drift speed along the wind.
 */
export const AMBIENT = {
  /** Wrap box (world units) round the focus in which the weather lives, and the spawn height of fallers. */
  box: { w: 19, d: 17, h: 4.6 },
  /**
   * The share of each kind's pool that is out (by rank), per row. The pinewood row is the pine woods', cross-faded at
   * their border by the biome weights; the other rows have no rain or mist.
   */
  biomes: {
    heartland: { leaves: 0.8, petals: 0, dust: 0, rain: 0, mist: 0, butterflies: 0.5, fireflies: 0.3, birds: 1 },
    desert: { leaves: 0, petals: 0, dust: 1, rain: 0, mist: 0, butterflies: 0, fireflies: 0, birds: 0.5 },
    blossom: { leaves: 0, petals: 1, dust: 0, rain: 0, mist: 0, butterflies: 1, fireflies: 0.75, birds: 1 },
    pinewood: { leaves: 0.12, petals: 0, dust: 0, rain: 1, mist: 1, butterflies: 0, fireflies: 1, birds: 0.6 },
  } satisfies Record<LifeRow, Record<LifeKind, number>>,
  /** Multipliers at full night (day = 1); fireflies come out with the night itself. Our motes hang in the sunlight. */
  night: { butterflies: 0, birds: 0.35, fireflies: 1, mist: 1.25, dust: 0 } satisfies Partial<Record<LifeKind, number>>,
  leaves: { count: 40, size: [0.13, 0.2], fall: [0.42, 0.7], sway: 0.35, tumble: 1.5, land: 9.0, wind: 0.55, colors: ['#d9822b', '#c8552a', '#e0a83a', '#a8452a', '#b98a2e'] },
  petals: { count: 110, size: [0.085, 0.135], fall: [0.34, 0.6], sway: 0.4, tumble: 1.8, land: 4.5, wind: 0.45, colors: ['#f7b9c8', '#f29db4', '#fbd3dc', '#fff4f2'] },
  /** Thin, short, slanted streaks; land = seconds a splash ring lasts, splash = its size. */
  rain: { count: 700, size: [0.11, 0.19], width: 0.008, fall: [6.5, 8.0], land: 0.2, wind: 1.7, splash: 0.07, colors: ['#a9bcbb', '#98adae'] },
  /** speed = drift along the wind (units / s). */
  dust: { count: 60, size: [0.022, 0.038], speed: [0.12, 0.3], height: [0.15, 1.5], colors: ['#f1dfb6', '#f6e9c9', '#e6cf9f'] },
  /** Soft cards drifting with the wind, in the day / night colour. */
  mist: { count: 9, size: [3.2, 4.6], height: 0.75, y: 0.46, alpha: 0.1, drift: 0.14, day: '#e3e9ea', night: '#2a3350' },
  /**
   * flowers: over flowers they come out whatever their rank, up to this share; flowerReach: how far from its home one
   * looks for a flower; flowerRoam: its loop round one, a share of roam.
   */
  butterflies: { count: 18, size: 0.13, roam: 1.1, height: [0.3, 0.75], flap: 11, flowers: 0.9, flowerReach: 2.4, flowerRoam: 0.6, colors: ['#fff6e0', '#f6c64a', '#ef8a3c', '#9cc3e8', '#f3a6c0'] },
  /** water: over a bank they come out whatever their rank, up to this share; rainCut: the share the rain removes. */
  fireflies: { count: 64, size: 0.12, roam: 0.55, height: [0.22, 1.0], glow: 3.6, color: '#ffd45a', water: 0.9, rainCut: 0.4 },
  /**
   * Flocks of 3 to flockSize in a V crossing the view: one every `period` s (each later flock 23 % slower) for `cross`
   * s, over `span` units, just above the treetops; wing = half span; shadow = the strength of their ground shadows.
   */
  birds: { flocks: 5, flockSize: 5, period: 30, cross: 15, span: 34, height: 2.1, wing: 0.2, flap: 6.5, shadow: 0.2, shadowColor: GROUND_SHADOW, colors: ['#f6f1e6', '#e9e2d4'] },
} as const;
