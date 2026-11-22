/**
 * Limited warm cardstock palette (sRGB hex) for what is painted in code (the sea page, the streams, lanterns, card
 * backs and edges), so it reads as one set of papers with the printed art.
 */
export const PALETTE = {
  // papers
  kraft: '#e1c9a0',
  cutEdge: '#fbf3e1',
  ink: '#5a3a28',

  // sea: the world's floor, printed pale (the skill: sea-foam for water, the floor paler and less saturated than the
  // pieces on it), and authored a step bluer than it lands: the warm grade turns teal ~25 degrees toward green on screen
  sea: '#7ac0d9',
  seaDeep: '#58a0c2',
  seaLight: '#91d4e6',
  seaShallow: '#a6e6f0',
  foam: '#f6e6bc',

  // wood and trims
  wood: '#7a4a2c',
  woodDark: '#4f2f1c',
  hullDark: '#2f1b12',
  goldDark: '#a77a2c',

  // cloth
  sailShade: '#dccaa3',

  // light
  lantern: '#ffc45a',
} as const;
