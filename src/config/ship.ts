/**
 * Ship handling and the feel of its inertia. World units are metres-ish (ship ~2.6 long). The handling comes from the
 * ship chosen in the shipyard (config/ships.ts), as does the hull's size (ship/hull-shape.ts).
 */
import { activeShip } from './ships';

const TYPE = activeShip();

export const SHIP = {
  // ---- sailing ----
  /** Sail settings the player steps through with W / S (0 = sails furled). */
  sailLevels: [0, 0.5, 1] as const,
  /** Top speed (units / s) with full sails and a following wind. */
  maxSpeed: TYPE.maxSpeed,
  /** Forward thrust at full sail (units / s^2). Drag balances it at maxSpeed. */
  thrust: TYPE.thrust,
  /** Linear + quadratic water drag along the keel. */
  dragLinear: 0.18,
  /** Sideways drag: the keel bites hard, so the hull only slips a little in a turn. */
  dragLateral: 2.6,
  /** Back-paddling with S while the sails are furled (units / s^2, max units / s). */
  reverseThrust: 0.55,
  reverseMax: 0.6,
  /** How much a head wind costs: thrust x (1 - windPenalty * (1 - cos(angle)) / 2). */
  windPenalty: 0.35,

  // ---- steering ----
  /** Rudder angle follows the key with this rate (1 / s): the helm takes a moment to come over. */
  rudderRate: 2.4,
  /** Max yaw rate (rad / s) at speed with the rudder hard over. */
  turnRate: TYPE.turnRate,
  /** Yaw rate eases toward its target with this response (1 / s): the hull has rotational inertia. */
  yawResponse: 2.2,
  /** Share of the turn rate available at a standstill (a ship barely turns without way on). */
  turnAtRest: 0.12,

  // ---- body motion ----
  /** Heel (roll) into the turn per (speed x yaw rate), rad; the roll is an under-damped spring. */
  heelGain: 0.09,
  heelHz: 0.9,
  heelDamping: 0.35,
  /** Pitch from acceleration (rad per unit / s^2) and the swell. */
  pitchGain: 0.05,
  swellPitch: 0.025,
  swellRoll: 0.03,
  swellBob: 0.03,
  swellHz: 0.32,

  // ---- collisions ----
  /** Extra clearance kept from an island shore (world units). */
  shorePadding: 0.25,
  restitution: 0.25,
} as const;
