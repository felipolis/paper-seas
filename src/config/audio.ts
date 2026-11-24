/**
 * Sound tunables (src/audio). Times in seconds, frequencies in Hz (at pitch factor 1), gains linear unless a key
 * ends in Db. The paper-flap voicing and the voice allocation follow papertrails by xikhar (MIT), see
 * src/audio/paper-synth.ts.
 */
export const AUDIO = {
  /** Final output gain after the soft limiter. */
  masterGain: 0.95,
  /** Paper / effect voices sounding at once; on overflow the quietest is faded out (stealFade) and replaced. */
  maxVoices: 10,
  spareVoices: 4,
  stealFade: 0.008,
  /**
   * Distance law for world sounds: gain = 1 / (1 + (d / falloff)^falloffPow), faded out from earshotFade to earshot (the
   * skill's and papertrails': near events stay present, far ones fall away fast, none beyond ~2.4 x falloff).
   */
  falloff: 9,
  falloffPow: 4,
  earshotFade: 16,
  earshot: 21.6,
  /** Voices quieter than this are not played at all. */
  minGain: 0.004,
  sampleRate: 48000,
  /** Fraction of the full pan used at |pan| = 1 (the skill: half the range). */
  panWidth: 0.5,
  /** World units across which a sound pans from centre to full side. */
  panSpan: 14,
  /** New-voice rate limit (token bucket); reserve: the last tokens, kept from detail flaps for the next real one. */
  rate: { perSecond: 30, burst: 9, reserve: 3 },
  /** Flap onsets are spread over up to one frame (events arrive on the frame grid), and rippleJitter more when busy. */
  onsetJitter: 0.016,
  rippleJitter: 0.012,
  /**
   * Detail flaps (size under below + range, the smallest pieces) give way first when the page is busy: ducked duck x
   * harder, and costing up to 1 + cost of the rate budget.
   */
  detail: { below: 0.12, range: 0.3, duck: 1.6, cost: 1.2 },
  densityDuck: 0.22,
  overlapDuck: 0.5,
  densityTickDuck: 0.55,
  /** Cards rising around the ship: a soft flap now and then, not a continuous rustle. */
  flaps: {
    /** A flap's size: its piece's upright height in papertrails' tiles (world units), minSize .. 1 (fold.js there). */
    tile: 2,
    minSize: 0.05,
    /** Minimum time between flap onsets (+- jitter): 0.35-0.75 s, two flaps a second at most (the skill). */
    spacing: 0.55,
    spacingJitter: 0.2,
    /**
     * A flap that would start later than this after its piece moved is dropped; one that waited is up to deferDb
     * quieter.
     */
    maxDefer: 0.08,
    deferDb: 3.5,
    /** Rising pieces win the next slot against pieces folding away. */
    downScore: 0.7,
    /** Flaps are started this far ahead of the audio clock. */
    lookahead: 0.03,
    /**
     * One sound per gesture: the flaps of one gesture (a cell's pieces, the same way) within this window (s) speak as
     * one, its largest piece while it waits for its slot.
     */
    groupWindow: 0.5,
  },

  flap: {
    gain: 0.13,
    downGainDb: -9,
    downBright: 0.9,
    sizeGainMin: 0.85,
    durMin: 0.096,
    durMax: 0.23,
    durCurve: 1.4,
    durPitch: 0.3,
    durJitter: 0.035,
    pitchMin: 0.5,
    pitchMax: 0.82,
    pitchRandSt: 4.3,
    pitchSizeSt: 0.4,
    pitchMinStepSt: 0.7,
    brightSmall: 0.95,
    brightLarge: 0.72,
    brightFrom: 0.25,
    brightTo: 0.75,
    bedHz: 2500,
    bedQ: 0.4,
    bedGain: 0.45,
    bedGainDown: 0.4,
    resHz: [1350, 2750, 4900],
    resQ: [1.5, 1.8, 2.0],
    resGain: [0.3, 0.15, 0.05],
    grainDirect: 0.7,
    tiltSmall: 4200,
    tiltLarge: 1700,
    tiltSmallDown: 3400,
    tiltLargeDown: 1700,
    tiltTrack: 0.5,
    airTilt: 0.45,
    airLp: 0.35,
    lpHz: 2600,
    stopShare: 0.3,
    patGain: 2.4,
    resJitter: 0.06,
    resGainJitter: 0.18,
    decayFast: 8,
    decayFastMix: 0.42,
    decayNepers: 2.2,
    downHp: 0.78,
    bedDecayDown: 1.1,
    lumpMin: 0.2,
    lumpEvery: 0.022,
    gateEvery: 0.00035,
    bedSmooth: 0.35,
    refCrest: 8,
    downTick: 1.15,
    downGrains: 0.5,
    grainThin: 3.2,
    grainAmp: 0.1,
    microAmp: 0.025,
    tailFrom: 0.82,
    hpHz: 520,
    grainsMin: 16,
    grainsMax: 38,
    microMin: 50,
    microMax: 130,
    tick: 0.04,
    onsetGrains: 5,
    stopTick: 0.15,
    thump: 0.5,
    thumpHz: 430,
    thumpQ: 1.6,
    thumpGain: 1.0,
    thumpDown: 0.4,
    airHz: 1100,
    airQ: 0.75,
    airLpHz: 2400,
    airGain: 0.55,
    airGainDown: 0.3,
    airSmall: 0.7,
    airRise: 0.016,
    airRiseDown: 0.03,
    lowHz: 190,
    lowQ: 1.1,
    lowGain: 2.2,
    lowFrom: 0.4,
    lowTau: 0.014,
    lowDown: 0.1,
    downSwell: 0.022,
    downSwellFrom: 0.3,
    downStop: 0.5,
    peakKnee: 0.42,
    loudNorm: 0.85,
    normLo: 0.8,
    normHi: 1.25,
    attackUp: 0.0022,
    attackDown: 0.0048,
  },

  /** Wooden knock of the hull on a shore (a hollow card deck, struck). */
  knock: { gain: 0.5, dur: 0.16, bedHz: 800, bedQ: 0.7, bedGain: 0.55, resHz: [180, 420, 950], resQ: [2.2, 1.8, 1.5], lpHz: 1500, knock: 0.9 },

  /**
   * The captain's footsteps ashore (papertrails' step voice): soft paper taps, quiet (papertrails keeps them at 0.15 of
   * a flap), a little apart in pitch and pan from foot to foot, the timbre set by what is underfoot.
   */
  step: {
    gain: 0.02,
    refCrest: 7,
    /** To -40 dB (longer = softer). */
    dur: 0.07,
    pitchRandSt: 1.6,
    footSt: 0.5,
    footPan: 0.07,
    surfaces: {
      grass: { bedHz: 1100, bedQ: 0.6, bedGain: 0.8, resHz: [700, 1300], resQ: [1.0, 1.1], grain: 0.15, grains: 3, lpHz: 1700, knock: 0, gain: 0.9 },
      path: { bedHz: 1400, bedQ: 0.6, bedGain: 0.6, resHz: [900, 1700], resQ: [1.1, 1.2], grain: 0.22, grains: 2, lpHz: 2100, knock: 0, gain: 1.0 },
      /** A pier's or a bridge's hollow card deck. */
      bridge: { bedHz: 800, bedQ: 0.7, bedGain: 0.55, resHz: [420, 950], resQ: [1.8, 1.5], grain: 0.2, grains: 2, lpHz: 1600, knock: 0.5, gain: 1.0 },
    },
  },

  /** Early reflections: the diorama stands on a table in a small warm room. */
  room: {
    length: 0.05,
    taps: [
      [0.0013, 0.26, 0],
      [0.0049, 0.13, -0.6],
      [0.0071, 0.12, 0.6],
      [0.0117, 0.08, -0.8],
      [0.0143, 0.075, 0.8],
      [0.0196, 0.05, -0.4],
      [0.0233, 0.045, 0.5],
    ] as Array<[number, number, number]>,
    tail: 0.03,
    tailDecay: 0.009,
    tailLpHz: 3200,
  },
  /** Soft-knee waveshaper limiter: linear below `knee`, tanh above, never above `ceiling`. */
  limiter: { knee: 0.6, range: 2, ceiling: 0.9 },

  /** The felt-piano barcarolle (src/audio/music.ts). bpm counts eighth notes (6/8 time). */
  music: { gain: 1.2, bpm: 112, reverb: 0.42, fadeIn: 5 },

  /**
   * The sea under the table as the skill's room tone, so the silence between flaps is never digital black: a slow warm
   * wash low-passed at lpHz, normalised, at ~-63 dBFS RMS (gain), faded in over fadeIn seconds.
   */
  sea: { gain: 0.001, length: 12, lpHz: 240, swell: 0.55, fadeIn: 1.5 },
} as const;
