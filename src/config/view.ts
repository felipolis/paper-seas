/** Camera, lights and post. The camera yaw is fixed (north is up): the world is a diorama seen from one side. */
export const CAMERA = {
  fov: 26,
  pitchDeg: 40,
  distance: 18,
  minDistance: 10,
  maxDistance: 26,
  /** World units the camera leads in the direction of travel (per unit / s of speed), clamped. */
  lead: 1.0,
  leadMax: 3.4,
  /** Critically damped follow time constant (s). */
  smoothTime: 0.55,
  /** The ship sits a little below the centre of the frame (world units pushed toward the top of the screen). */
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
 * papertrails' day light rig (config/render.js `lights` there). Azimuths are relative to the camera (0 = from the
 * camera side, negative = from screen-left), so the key always comes from screen-left.
 */
export const LIGHTS = {
  key: { color: '#ffd29c', intensity: 2.9, azimuthDeg: -58, elevationDeg: 60 },
  fill: { color: '#f3cfa6', intensity: 0.95, azimuthDeg: 108, elevationDeg: 24 },
  hemi: { sky: '#ffe9cc', ground: '#b98858', intensity: 0.42 },
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
  /** Warm light leaking into the key's shadow (papertrails: #7c5634). */
  shadowLeak: '#7c5634',
} as const;

export const POST = {
  /**
   * The far page melts into a warm haze (papertrails' `lights.fade`): start, end (world units from the focus at its
   * 17-unit framing, scaled with the focus distance), amount, and its colour on the left / right of the frame.
   */
  fade: { start: 6.5, end: 13.5, amount: 0.72, color: '#a8804f', colorRight: '#9c7a54' },
  /** What shows past the page (papertrails' `lights.background`). */
  background: '#96744a',
  /**
   * papertrails' gobo: the key's left-to-right falloff round the focus (screen-left brighter: a lamp over the table).
   * radius (world at the 17-unit framing), key falloff, warm-left / cool-right tint, share of the falloff removed in
   * macro framing.
   */
  gobo: { radius: 9, key: 0.12, tint: 0.07, closeRelief: 0.7 },

  // ---- depth of field: papertrails' tilt-shift (config/render.js `dof`, render/post.js there) ----
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

  // ---- grade ----
  exposure: 0.79,
  /** Exposure multiplier in macro framing (focus closer than 4 units, blending out by 8): lit cream does not clip. */
  closeExposure: 0.82,
  contrast: 1.1,
  saturation: 0.92,
  tint: [1.05, 0.96, 1.0] as const,
  shadowTint: '#3a200c',
  shadowLift: 0.03,
  /** Pulls yellow-green toward sage (0 = off). */
  greenPull: 0.7,
  /** Warm-left / cool-right grade. */
  split: 0.025,
  vignette: 0.1,
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
 * The night look (papertrails' NIGHT_BASE, render/biomegrade.js there): a dark navy ambient, the moon key carrying the
 * shapes and the shadows, warm only at the lights; the whole picture turns, not only the light.
 */
export const NIGHT = {
  key: { color: '#8fb0f0', intensity: 1.05, azimuthDeg: -62, elevationDeg: 50 },
  fill: { color: '#3a58ac', intensity: 0.38, elevationDeg: 20 },
  hemi: { sky: '#4666c8', ground: '#16285c', intensity: 0.5 },
  /** Paper response: faces turned from the moon keep their colour; back-lit card glows cool; a navy shadow leak. */
  paper: { wrap: 0.42, translucency: 0.12, translucencyTint: '#7fa0d8', shadowLeak: '#16286a' },
  /** PCSS light size (penumbra per unit of blocker distance). */
  lightSize: 0.22,
  gobo: { key: 0.2, tint: 0.05 },
  fade: { start: 5.0, end: 11.5, amount: 0.92, color: '#070c2a', colorRight: '#060922' },
  background: '#070a24',

  exposure: 0.92,
  bloom: 0.3,
  bloomThreshold: 1.25,
  spill: 7.5,
  tint: [0.82, 0.97, 1.2] as const,
  shadowTint: '#091638',
  shadowLift: 0.042,
  saturation: 0.74,
  contrast: 1.1,
  vignette: 0.34,
  aoTint: '#081030',
  greenPull: 0.45,
  split: 0.02,
  /** The dark die-cut edge stays (papertrails keeps its dark rim colour at night, only weaker). */
  rim: 0.6,
  aoIntensity: 1.0,
  aoRadius: 0.22,
  grain: 0.02,
  /** Depth of field: a wider blur, less of it toward the camera. */
  maxBlurPx: 16,
  nearGain: 1.2,
} as const;
