/**
 * Limited warm cardstock palette (sRGB hex) for what is painted in code (the sea page, the streams, lanterns, card
 * backs and edges), so it reads as one set of papers with the printed art.
 */
export const PALETTE = {
  // papers
  kraft: '#e1c9a0',
  cutEdge: '#fbf3e1',
  ink: '#5a3a28',

  // sea: papertrails' water (render/water.js there: shallow #6fc4b0, deep #1f8f8a, rim #f6e6bc), no ink on it
  sea: '#3ea79c',
  seaDeep: '#1f8f8a',
  seaLight: '#58b8a8',
  seaShallow: '#6fc4b0',
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
