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
  /** Real seconds a press of T takes to carry the clock through the evening (or the morning): papertrails' N. */
  toggleSeconds: 1.6,
  /** Clock hours the day begins and ends. */
  dawn: 6,
  dusk: 19.5,
  /** Clock hours the evening (and the morning) takes to ease between the two looks. */
  fadeHours: 1.5,
} as const;
