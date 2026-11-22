/**
 * Day / night cycle. papertrails has two looks, day and night (render/daynight.js there), and fades between them;
 * here the clock picks the look: day from dawn to dusk, night otherwise, the evening easing slowly from papertrails' day
 * into its night (and the morning back) over fadeHours of the clock, centred on dusk and on dawn. Nothing but those two
 * looks is ever shown, only mixed. The looks themselves are LIGHTS / POST (day) and NIGHT (config/view.ts).
 */
export const TIME = {
  /** Real seconds for a full 24 h cycle. */
  cycleSeconds: 360,
  /** Clock hour at launch. */
  startHour: 9.5,
  /** Hold T to run the clock this many times faster. */
  fastForward: 40,
  /** Clock hours the day begins and ends. */
  dawn: 6,
  dusk: 19.5,
  /** Clock hours the evening (and the morning) takes to ease between the two looks. */
  fadeHours: 1.5,
} as const;
