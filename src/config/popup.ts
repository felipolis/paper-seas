/**
 * Spring tunables for the pop-up flaps (src/popup/spring.ts).
 *
 * Target feel: a flap snaps up in ~0.25 s, whips 8-15 % past upright, then the card quivers 2-3 times
 * (4-7 Hz) before it is dead still at ~0.6-1.1 s. Folding down is softer and ends in a tiny slap-bounce on
 * the page. Large flaps are a little slower than small ones; neighbours never move in lockstep.
 */
export const POPUP = {
  /** RISE: p'' = k (1 - p) - c p' at frequency scale 1 (light damping: the card arrives upright with speed). */
  stiffness: 62,
  damping: 5.0,
  /** Rise damping multiplier for the largest flaps: big cards arrive faster -> more overshoot. */
  dampingLarge: 0.5,
  /** FALL: p'' = -k p - c p' - pull. */
  downStiffness: 10,
  downDamping: 4.5,
  downPull: 5,
  /** A flap resting upright flicks a little further before it falls (anticipation), 1/s. */
  downAnticipation: 1.2,
  /** Seconds over which the flaps of one group start, ordered by their delay (0..1). */
  staggerSpan: 0.34,

  /** LOCKED: once upright the card flutters about upright: p'' = -w^2 (p - 1) - (2 z w + drag |p'|) p' - friction. */
  flutterHz: 4.5,
  flutterDamping: 0.04,
  flutterDrag: 3.5,
  flutterFriction: 2.2,
  flutterFrictionLarge: 1.8,
  wobble: 1.0,
  wobbleLarge: 2.0,
  /** Twist about the card's own vertical axis proportional to the flutter (rad per unit of progress). */
  twist: 1.1,

  /** Size response (size = upright height in world units). */
  sizeSmall: 0.24,
  sizeLarge: 1.4,
  freqSmall: 1.14,
  freqLarge: 0.88,
  /** Deterministic +- variation of the frequency per flap. */
  jitter: 0.03,

  /** Page stop on fold-down. */
  restitution: 0.25,
  minBounceSpeed: 0.5,

  /** Settled when |p - target| < eps and |v| < 12 eps for every flap. */
  settleEps: 0.002,
  /** Fixed simulation step (s): the motion is identical at any frame rate. */
  step: 1 / 240,
  maxSubSteps: 30,

  /** Height gap between stacked flat paper layers (avoids z-fighting of folded cards). */
  layerGap: 0.004,
} as const;
