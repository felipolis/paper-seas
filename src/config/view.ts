/** Camera, lights and post. The camera yaw is fixed (north is up): the world is a diorama seen from one side. */
export const CAMERA = {
  fov: 26,
  pitchDeg: 40,
  distance: 18,
  minDistance: 10,
  maxDistance: 26,
  /** Critically damped follow time constant (s) while tipped toward the map (otherwise the window's, ON_FOOT.zone). */
  smoothTime: 0.55,
  /** Tipped toward the map, the ship sits a little below the centre of the frame (world units toward the top). */
  screenUp: 0.8,
  near: 0.5,
  far: 120,
} as const;

/** On foot, papertrails' follow camera, its numbers as they are (config/player.js camera, camera/follow.js there). */
export const ON_FOOT = {
  fov: 27,
  pitchDeg: 42,
  distance: 10.8,
  /** World units the window leads him once he walks steadily, and more when he walks toward the camera. */
  lookAhead: 1.0,
  lookAheadSouth: 2.4,
  /** The look target sits this far toward the top of the screen from him, at his feet: he stands a little low. */
  screenUp: 0.6,
  /** Where the lens is sharp: his chest (this share of his height above his feet). */
  focusHeight: 0.6,
  /** The tripod head's slow drift (world units, Hz). */
  driftAmp: 0.035,
  driftHz: 0.07,
  /**
   * The camera window (world units on the ground at this distance, scaled with the zoom): still zone, hard edges,
   * steady walking before the lead (s), the lead's time constant (s) and top speed (times his), the spring (s).
   */
  zone: { stillR: 1.0, stillUp: 0.4, stillDown: 0.6, hardR: 2.2, hardUp: 1.1, hardDown: 1.4, leadAfter: [0.35, 1.1], leadTau: 0.7, leadRate: 1.2, smoothTime: 0.28 },
  /** Sight assist: delay / release (s), largest lift and turn (degrees), ease (s), test interval (s), rethink (s), wider tier. */
  assist: { delay: 0.4, release: 0.6, pitchMax: 10, yawMax: 14, ease: 0.8, interval: 0.1, rethink: 1.2, far: 1.3 },
} as const;

/**
 * The papercraft skill's clear day (look.md sections 5 and 8, its 3D template's light): a warm key from screen-left,
 * 45 degrees up and a little toward the camera, so shadows fall sideways and behind where they are seen; a warm
 * frontal fill from the camera side at ~0.27 of it (camera-facing cards never go grey); a warm sky. Azimuths are
 * relative to the camera (0 = from the camera side, negative = from screen-left).
 */
export const LIGHTS = {
  key: { color: '#ffdcb2', intensity: 3.0, azimuthDeg: -56, elevationDeg: 45 },
  fill: { color: '#f2dcc2', intensity: 0.8, azimuthDeg: 24, elevationDeg: 24 },
  hemi: { sky: '#fff0da', ground: '#b39a78', intensity: 0.42 },
  /**
   * The key's shadow map; the filter is papertrails' PCSS (render/shadows.ts). Its frustum is fitted to the camera's
   * footprint every frame: half size = visible ground radius x fit + pad, clamped; the light stands `distance` back.
   */
  shadow: { mapSize: 4096, fit: 1.12, pad: 1.5, minExtent: 3.5, maxExtent: 20, distance: 35, normalBias: 0.0015 },
} as const;

/** Paper response of every card (render/paper-material.ts). */
export const PAPER = {
  /** Wrap diffuse: a soft terminator instead of a plastic falloff. */
  wrap: 0.3,
  /** Warm glow of thin card lit from behind. */
  translucency: 0.3,
  translucencyTint: '#ffb070',
  /** Warm amber leaking into the key's shadow, so shadows on the warm ground come out warmer than it, never grey (the skill's day leak). */
  shadowLeak: '#a0602c',
  /** Albedo swing of the paper's 0.15-0.3 unit mottling (papertrails' fibreCloud). */
  cloud: 0.085,
} as const;

export const POST = {
  /**
   * A subtle haze, only far away, in one mid-tone colour by ground distance from the focus (the skill: never a colour
   * fog over the frame, never a screen gradient): start, end (world units from the focus at the 17-unit framing,
   * scaled with the focus distance: on foot ~9 to ~26 hero heights), amount, colour.
   */
  fade: { start: 6.7, end: 18.7, amount: 0.3, color: '#d8bf8e' },
  /** What shows past the page (papertrails' `lights.background`). */
  background: '#96744a',
  /**
   * papertrails' gobo: the key's left-to-right falloff round the focus (screen-left brighter: a lamp over the table).
   * radius (world at the 17-unit framing), key falloff, warm-left / cool-right tint, share of the falloff removed in
   * macro framing.
   */
  gobo: { radius: 9, key: 0.12, tint: 0.07, closeRelief: 0.7 },

  // ---- depth of field: tilt-shift, papertrails' (config/render.js dof there; its night blurs more, see NIGHT) ----
  /** Fraction of the frame height around the focus that stays fully sharp. */
  focusBand: 0.36,
  /** Fraction of the frame height over which blur ramps up beyond the band. */
  ramp: 0.42,
  /** Blur radius (px at 1080p). */
  maxBlurPx: 12.5,
  /** 0 = pure screen-space tilt-shift, 1 = pure depth-based blur (the layers: each piece blurred by its depth). */
  depthWeight: 0.8,
  /** The sharp band grows up to this factor when the camera is closer than 12 units. */
  closeBandScale: 1.8,
  /** Extra blur toward the camera / the bottom of the frame, and away from it. */
  nearGain: 1.6,
  farGain: 1.0,
  dofTaps: 36,
  /** Extra weight of bright taps in the bokeh (lanterns, windows). */
  highlightBoost: 0.35,

  // ---- AO ----
  aoTaps: 10,
  aoRadius: 0.26,
  aoIntensity: 1.25,
  aoBias: 0.012,
  aoTint: '#5a3214',

  // ---- bloom ----
  bloom: 0.5,
  bloomThreshold: 1.7,
  /** Lamp light washing the paper round the glowing panes (papertrails' screen-space spill; only the night raises it). */
  spill: 0,

  // ---- grade (the skill's: look.md section 7) ----
  exposure: 0.82,
  /** Exposure multiplier in macro framing (focus closer than 4 units, blending out by 8): lit cream does not clip. */
  closeExposure: 0.82,
  contrast: 1.18,
  saturation: 0.96,
  tint: [1.03, 0.985, 0.98] as const,
  shadowTint: '#3a200c',
  shadowLift: 0.03,
  /**
   * Pulls saturated yellow-green toward a muted paper green (0 = off; the skill's template 0.3). It masks by g > b, so
   * the sea's teal is left alone; lower would let the land's grass turn lime.
   */
  greenPull: 0.3,
  /** Warm-left / cool-right grade. */
  split: 0.025,
  /** Vignette amount, toward this colour (warm umber by day; the corners never black). */
  vignette: 0.03,
  vignetteColor: '#3a200c',
  grain: 0.008,
  grainSize: 1.35,
  /** Chromatic softness at the frame edge (px of red / blue shift at 1080p). */
  chroma: 0.55,
  sharpen: 0.35,
  /**
   * Darker die-cut edge on depth silhouettes: strength, inner ring radius (px at 900 px frame height; the outer ring is
   * 1.55 x), colour multiplier.
   */
  rim: 0.8,
  rimPx: 0.9,
  rimColor: '#c2aa94',
} as const;

/**
 * The night look (the skill's night set, look.md section 8): an even, saturated pale-blue moon (about half the day key)
 * with a blue fill and sky keeps every card readable and coloured; the warm windows and lanterns carry the warmth, and
 * navy lives in the far haze and the deep shadows, never as a filter over the frame.
 */
export const NIGHT = {
  key: { color: '#c8d6ff', intensity: 1.6, azimuthDeg: -56, elevationDeg: 45 },
  fill: { color: '#7890d0', intensity: 0.7, elevationDeg: 24 },
  hemi: { sky: '#3a56b0', ground: '#22243a', intensity: 0.85 },
  /** Paper response: faces turned from the moon keep their colour; back-lit card glows cool; a navy shadow leak. */
  paper: { wrap: 0.4, translucency: 0.12, translucencyTint: '#7fa0d8', shadowLeak: '#26368a', cloud: 0.05 },
  /** PCSS light size (penumbra per unit of blocker distance). */
  lightSize: 0.22,
  gobo: { key: 0.2, tint: 0.05 },
  /** The navy of the distance (on foot ~4 to ~15 hero heights). */
  fade: { start: 2.75, end: 10.8, amount: 0.9, color: '#0e1a44' },
  background: '#070a24',

  exposure: 1.0,
  /** papertrails' night depth of field (render/biomegrade.js there): a wider blur, less of it toward the camera. */
  maxBlurPx: 16,
  nearGain: 1.2,
  bloom: 0.3,
  bloomThreshold: 1.25,
  spill: 7.5,
  tint: [0.98, 0.98, 1.03] as const,
  shadowTint: '#141c48',
  shadowLift: 0.04,
  saturation: 1.12,
  contrast: 1.18,
  // (mild, as by day: a heavy one took the corners near black, measure.py cornerCentre)
  vignette: 0.06,
  vignetteColor: '#0a0c24',
  aoTint: '#081030',
  greenPull: 0.3,
  split: 0.02,
  /** The dark die-cut edge stays (papertrails keeps its dark rim colour at night, only weaker). */
  rim: 0.6,
  aoIntensity: 1.0,
  aoRadius: 0.22,
  grain: 0.02,
} as const;
