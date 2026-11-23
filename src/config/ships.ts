/**
 * The ships the player can sail, and the captains who can stand at the helm. The choice is made in the shipyard
 * (Esc menu) and kept in the browser (core/storage.ts); a new choice reloads the page, so every module sees one ship from the start
 * (config/ship.ts takes the hull size and the handling from it).
 *
 * Each ship has its own structure (HullSpec: which decks and castles she has, how high, her plan and sweep, her gun
 * decks, cabins and carvings), built in Blender from paper and printed wood (public/models/ship-<id>.glb, by
 * tools/blender/build_ship.py on the shape exported from src/ship/hull-shape.ts), her own sails, flag and handling.
 * Each captain is a small paper model of printed T-cards, built from its outfit (player/crew-model.ts).
 */
import { DEG } from '../core/math';
import { loadText, saveText } from '../core/storage';

/**
 * How a mast is rigged: square sails hung across the ship from their yards; a lateen, one triangular sail laced to a
 * long yard slung slantwise across the mast (its fore end low, its peak high aft); or a junk's battened sails, hung
 * fore and aft in the ship's centre plane, mostly abaft the mast.
 */
export type Rig = 'square' | 'lateen' | 'battened';

/** Texture-space corners (u, v from the bottom left) of a triangular sail's print: tack, head (or peak) and clew. */
export interface SailCorners {
  tack: [number, number];
  head: [number, number];
  clew: [number, number];
}

/** A sail: its print (a sprite) and size; a lateen's print also names its corners. */
export interface SailSpec {
  sprite: string;
  width: number;
  height: number;
  corners?: SailCorners;
}

export interface MastSpec {
  /** Position along the hull (0 stern .. 1 bow) and height above the deck it stands on. */
  t: number;
  height: number;
  rig: Rig;
  /**
   * Square and battened: the sails from the lowest up (course, topsail, topgallant). Lateen: the one sail, its width
   * the fore-and-aft run of the yard and its height the drop from the yard's peak to the clew.
   */
  sails: SailSpec[];
  /** Rake aft (rad; a junk's foremast rakes forward) and a list to starboard (rad: a wreck's crooked masts). */
  rake?: number;
  lean?: number;
  /** The topmast snapped off at the head and left hanging in its rigging. */
  sprung?: boolean;
}

export interface HullSpec {
  /** Depth of the keel below the waterline. */
  draft: number;
  /** Main deck height above the waterline, and the bulwark (rail) height above any deck. */
  main: number;
  bulwark: number;
  /** Raised decks: quarterdeck and poop aft (from the stern to t = end), forecastle forward (from t = start). */
  quarter?: { end: number; height: number };
  poop?: { end: number; height: number };
  forecastle?: { start: number; height: number };
  /** Where the wheel stands (t; on whatever deck is there): clear of the masts, the ladders and the cabin fronts. */
  helm: number;
  /** Extra rise of the rail at the very stern and bow, and a long crescent rise toward both ends (a carrack's sheer). */
  sternSweep: number;
  bowSweep: number;
  crescent?: number;
  /** Width of the transom (share of the beam) and of the bow at the stem (0 = a pointed stem, ~0.4 = a junk). */
  transom: number;
  bowWidth: number;
  /**
   * The plan: where the quarters have swelled out to the full beam (t) and where the bow starts to close in (t), and
   * how the bow closes (an exponent: ~0.6 a bluff round bow, ~1.2 a long fine entry).
   */
  plan: { aft: number; fore: number; entry: number };
  /** How much the sides lean in toward the rail. */
  tumblehome: number;
  /** Rows of gun ports: height, from t0 to t1, count (on each side). */
  guns: Array<{ y: number; t0: number; t1: number; count: number }>;
  /** Printed wood (tools/art/ship-sheets.json): under the wale, the wale strake, the upper works, the decks. */
  wood: { lower: string; wale: string; upper: string; deck: string };
  /** Heights of the wale strake (a painted band along the gun deck). */
  wale: [number, number];
  /** A carved beakhead at the bow (galleons) and the printed figurehead under it; quarter galleries (bay windows) aft. */
  beakhead: boolean;
  figurehead?: string;
  galleries: boolean;
  /** An iron-shod ram at the waterline (a raider's); eyes painted on the bows (a junk's). */
  ram?: boolean;
  eyes?: boolean;
  /** Stern lanterns: 1 (a great one on the centreline), 2 (one each quarter) or 3 (both, the centre one taller). */
  lanterns: 1 | 2 | 3;
  /** A wreck raised from the deep (rails torn through at a few breaches, weed, slime, holes): the ghost ship. */
  broken?: boolean;
  /** Colour of the rail cap and carvings. */
  trim: string;
  /** Colour of the deck fittings (ladders, barrels, the wheel, balusters); a warm oak unless given. */
  fittings?: string;
  /** Colour of the light in her windows at night; warm candlelight unless given. */
  windowLight?: string;
  /** A tint over her printed carvings and windows by day (the ghost ship's are drowned green). */
  detailTint?: string;
}

export interface ShipType {
  id: string;
  name: string;
  blurb: string;
  hull: HullSpec;
  /** The masts, from the bow aft. */
  masts: MastSpec[];
  /** The bowsprit: its length beyond the stem and its steeve (rad above the horizontal); a junk has none. */
  bowsprit?: { length: number; steeve: number };
  /** Head sails on the stays from the bowsprit to the foremast, from the outer jib in (none without a bowsprit). */
  jibs: string[];
  /** Flown from the head of the tallest mast. */
  flag: string;
  /** Picture of her in the shipyard (a sprite). */
  picture: string;
  length: number;
  halfBeam: number;
  maxSpeed: number;
  turnRate: number;
  thrust: number;
  /** Colour of the stern lanterns and the light they cast. */
  lantern: string;
  /** Colour of the spars. */
  spar: string;
}

/**
 * Every ship is known by her silhouette:
 *   galleon  a towering three-tier stern castle with a gilded gallery and three lanterns, two rows of guns, a lion at
 *            the beakhead; three masts, the main crossing three yards, a lateen on the mizzen
 *   shadow   long, low and black, no castles but a low quarterdeck; a fine entry ending in an iron ram under a sea
 *            serpent; two masts raked hard aft with great dark courses, a lateen mizzen, a long low bowsprit
 *   ghost    a gaunt carrack: a towering narrow stern and a high forecastle over a deep waist, sides falling in
 *            steeply; four crooked masts, the mizzen sprung, torn sails, a lateen bonaventure, one green lantern
 *   navy     a long flush-decked frigate with two rows of guns and three square-rigged masts
 *   junk     a high swept-up square stern and a blunt bow with painted eyes; three unstayed masts with battened sails
 *            set fore and aft, the foremast raked forward, no bowsprit
 */
export const SHIP_TYPES: ShipType[] = [
  {
    id: 'galleon',
    name: 'The Crimson Galleon',
    blurb: 'A towering galleon turned pirate: a three-tier stern castle, a gilded gallery, two gun decks, oak and crimson.',
    hull: {
      draft: 0.2, main: 0.34, bulwark: 0.13,
      quarter: { end: 0.37, height: 0.58 }, poop: { end: 0.2, height: 0.86 }, forecastle: { start: 0.8, height: 0.54 },
      helm: 0.285,
      sternSweep: 0.1, bowSweep: 0.05, crescent: 0.02, transom: 0.64, bowWidth: 0,
      plan: { aft: 0.32, fore: 0.58, entry: 0.75 }, tumblehome: 0.16,
      guns: [{ y: 0.155, t0: 0.3, t1: 0.78, count: 7 }, { y: 0.275, t0: 0.4, t1: 0.74, count: 5 }],
      wood: { lower: 'plank-oak', wale: 'strake-ochre', upper: 'strake-crimson', deck: 'deck' },
      wale: [0.1, 0.205], beakhead: true, figurehead: 'figurehead-lion', galleries: true, lanterns: 3, trim: '#c9973f',
    },
    masts: [
      { t: 0.71, height: 2.15, rig: 'square', sails: [{ sprite: 'sail-patched', width: 1.15, height: 0.8 }, { sprite: 'sail-plain', width: 0.85, height: 0.58 }] },
      {
        t: 0.5, height: 2.8, rig: 'square',
        sails: [{ sprite: 'sail-emblem', width: 1.38, height: 0.95 }, { sprite: 'sail-patched', width: 1.02, height: 0.68 }, { sprite: 'sail-plain', width: 0.66, height: 0.42 }],
      },
      { t: 0.1, height: 1.75, rig: 'lateen', sails: [{ sprite: 'lateen-galleon', width: 1.2, height: 0.95, corners: { tack: [0.04, 0.05], head: [0.96, 0.97], clew: [0.97, 0.06] } }] },
    ],
    bowsprit: { length: 1.0, steeve: 20 * DEG },
    jibs: ['jib-0', 'jib-1'],
    flag: 'flag',
    picture: 'hull',
    length: 2.75,
    halfBeam: 0.5,
    maxSpeed: 3.3,
    turnRate: 0.9,
    thrust: 1.65,
    lantern: '#ffa86a',
    spar: '#c08a58',
  },
  {
    id: 'shadow',
    name: 'The Midnight Corsair',
    blurb: 'Long, low and black, raked masts and great dark sails, an iron ram under her serpent. The fastest thing on the water.',
    hull: {
      draft: 0.19, main: 0.24, bulwark: 0.12,
      quarter: { end: 0.26, height: 0.38 },
      helm: 0.17,
      sternSweep: 0.03, bowSweep: 0.06, transom: 0.5, bowWidth: 0,
      plan: { aft: 0.22, fore: 0.42, entry: 1.25 }, tumblehome: 0.12,
      guns: [{ y: 0.155, t0: 0.3, t1: 0.84, count: 9 }],
      wood: { lower: 'plank-black', wale: 'strake-crimson', upper: 'plank-black', deck: 'deck' },
      wale: [0.12, 0.2], beakhead: true, figurehead: 'figurehead-serpent', galleries: false, ram: true, lanterns: 2, trim: '#b08a3a',
    },
    masts: [
      { t: 0.68, height: 2.35, rig: 'square', rake: 0.1, sails: [{ sprite: 'sail-shadow-1', width: 1.32, height: 1.05 }, { sprite: 'sail-shadow-2', width: 0.95, height: 0.62 }] },
      { t: 0.45, height: 2.85, rig: 'square', rake: 0.12, sails: [{ sprite: 'sail-shadow-0', width: 1.55, height: 1.2 }, { sprite: 'sail-shadow-1', width: 1.1, height: 0.74 }] },
      { t: 0.07, height: 1.9, rig: 'lateen', rake: 0.14, sails: [{ sprite: 'lateen-shadow', width: 1.15, height: 0.9, corners: { tack: [0.04, 0.05], head: [0.96, 0.97], clew: [0.97, 0.06] } }] },
    ],
    bowsprit: { length: 1.25, steeve: 10 * DEG },
    jibs: ['jib-shadow-0', 'jib-shadow-1'],
    flag: 'flag-shadow',
    picture: 'hull-shadow',
    length: 3.15,
    halfBeam: 0.43,
    maxSpeed: 4.0,
    turnRate: 0.88,
    thrust: 1.95,
    lantern: '#ff7a4a',
    spar: '#4a3628',
  },
  {
    id: 'ghost',
    name: 'The Drowned Lantern',
    blurb: 'An old carrack raised from the deep: a towering stern, crooked masts, rotten planks, torn sails, one green lantern.',
    hull: {
      draft: 0.2, main: 0.3, bulwark: 0.13,
      quarter: { end: 0.36, height: 0.6 }, poop: { end: 0.18, height: 0.9 }, forecastle: { start: 0.76, height: 0.66 },
      helm: 0.265,
      sternSweep: 0.1, bowSweep: 0.1, crescent: 0.06, transom: 0.42, bowWidth: 0,
      plan: { aft: 0.38, fore: 0.62, entry: 0.6 }, tumblehome: 0.3,
      guns: [{ y: 0.19, t0: 0.42, t1: 0.7, count: 4 }],
      wood: { lower: 'plank-rotten', wale: 'plank-rotten', upper: 'plank-rotten', deck: 'plank-rotten' },
      wale: [0.14, 0.24], beakhead: true, figurehead: 'figurehead-maiden', galleries: true, broken: true, lanterns: 1, trim: '#7d8a78',
      fittings: '#6f7768', windowLight: '#8dffb0', detailTint: '#b9d6bf',
    },
    masts: [
      { t: 0.86, height: 1.75, rig: 'square', rake: -0.04, lean: -0.07, sails: [{ sprite: 'sail-ghost-2', width: 0.95, height: 0.7 }, { sprite: 'sail-ghost-1', width: 0.7, height: 0.46 }] },
      { t: 0.57, height: 2.5, rig: 'square', lean: 0.045, sails: [{ sprite: 'sail-ghost-0', width: 1.3, height: 0.98 }, { sprite: 'sail-ghost-1', width: 0.92, height: 0.62 }] },
      { t: 0.4, height: 1.3, rig: 'square', rake: 0.05, lean: -0.05, sprung: true, sails: [{ sprite: 'sail-ghost-1', width: 0.88, height: 0.62 }] },
      { t: 0.07, height: 1.3, rig: 'lateen', rake: 0.08, lean: 0.06, sails: [{ sprite: 'lateen-ghost', width: 0.85, height: 0.75, corners: { tack: [0.04, 0.05], head: [0.95, 0.97], clew: [0.95, 0.08] } }] },
    ],
    bowsprit: { length: 0.7, steeve: 32 * DEG },
    jibs: ['jib-ghost-0', 'jib-ghost-1'],
    flag: 'flag-ghost',
    picture: 'hull-ghost',
    length: 2.6,
    halfBeam: 0.47,
    maxSpeed: 3.2,
    turnRate: 1.0,
    thrust: 1.6,
    lantern: '#8dffb0',
    spar: '#6f7466',
  },
  {
    id: 'navy',
    name: 'The Royal Frigate',
    blurb: 'A long flush-decked frigate with two rows of guns, navy blue and gold. She cuts through a turn like a blade.',
    hull: {
      draft: 0.2, main: 0.32, bulwark: 0.12,
      quarter: { end: 0.3, height: 0.42 }, forecastle: { start: 0.8, height: 0.4 },
      helm: 0.1,
      sternSweep: 0.02, bowSweep: 0.03, transom: 0.6, bowWidth: 0,
      plan: { aft: 0.3, fore: 0.54, entry: 0.9 }, tumblehome: 0.1,
      guns: [{ y: 0.11, t0: 0.2, t1: 0.82, count: 9 }, { y: 0.255, t0: 0.34, t1: 0.78, count: 6 }],
      wood: { lower: 'plank-navy', wale: 'strake-ochre', upper: 'plank-navy', deck: 'deck' },
      wale: [0.065, 0.155], beakhead: true, figurehead: 'figurehead', galleries: true, lanterns: 2, trim: '#d8b04a',
    },
    masts: [
      { t: 0.72, height: 2.2, rig: 'square', sails: [{ sprite: 'sail-navy-1', width: 1.1, height: 0.82 }, { sprite: 'sail-navy-2', width: 0.82, height: 0.6 }] },
      { t: 0.49, height: 2.65, rig: 'square', sails: [{ sprite: 'sail-navy-0', width: 1.3, height: 0.98 }, { sprite: 'sail-navy-1', width: 0.98, height: 0.72 }] },
      { t: 0.25, height: 1.9, rig: 'square', sails: [{ sprite: 'sail-navy-2', width: 0.95, height: 0.66 }, { sprite: 'sail-navy-2', width: 0.7, height: 0.46 }] },
    ],
    bowsprit: { length: 0.95, steeve: 17 * DEG },
    jibs: ['jib-navy-0', 'jib-navy-1'],
    flag: 'flag-navy',
    picture: 'hull-navy',
    length: 3.05,
    halfBeam: 0.44,
    maxSpeed: 3.7,
    turnRate: 1.08,
    thrust: 1.85,
    lantern: '#ffd28a',
    spar: '#c9a06a',
  },
  {
    id: 'junk',
    name: 'The Jade Junk',
    blurb: 'An eastern war junk: a great swept-up stern, a blunt bow with painted eyes and battened sails like dragon fins.',
    hull: {
      draft: 0.18, main: 0.27, bulwark: 0.12,
      quarter: { end: 0.3, height: 0.48 }, poop: { end: 0.14, height: 0.74 }, forecastle: { start: 0.86, height: 0.4 },
      helm: 0.225,
      sternSweep: 0.2, bowSweep: 0.1, transom: 0.86, bowWidth: 0.42,
      plan: { aft: 0.2, fore: 0.62, entry: 0.9 }, tumblehome: 0.06,
      guns: [{ y: 0.18, t0: 0.36, t1: 0.76, count: 5 }],
      wood: { lower: 'plank-oak', wale: 'strake-ochre', upper: 'plank-red', deck: 'deck' },
      wale: [0.12, 0.2], beakhead: false, galleries: false, eyes: true, lanterns: 2, trim: '#3f8a6a',
    },
    masts: [
      { t: 0.83, height: 1.95, rig: 'battened', rake: -0.2, sails: [{ sprite: 'sail-junk-1', width: 0.85, height: 1.25 }] },
      { t: 0.55, height: 2.65, rig: 'battened', sails: [{ sprite: 'sail-junk-0', width: 1.25, height: 1.8 }] },
      { t: 0.07, height: 1.6, rig: 'battened', rake: 0.04, sails: [{ sprite: 'sail-junk-2', width: 0.75, height: 1.05 }] },
    ],
    jibs: [],
    flag: 'flag-junk',
    picture: 'hull-junk',
    length: 2.75,
    halfBeam: 0.5,
    maxSpeed: 3.5,
    turnRate: 0.95,
    thrust: 1.55,
    lantern: '#ff9a5a',
    spar: '#8a5a34',
  },
];

/** How a captain's paper model is cut and coloured (player/crew-model.ts). */
export interface Outfit {
  skin: string;
  /** A beard or a moustache cut from the hair's card, if any. */
  beard?: 'full' | 'moustache';
  /** Hair (the back and sides of the head). */
  hair: string;
  coat: string;
  /** Long coat (to the knees), short jacket, robe (to the feet), apron over a shirt, bare bones. */
  cut: 'coat' | 'jacket' | 'robe' | 'apron' | 'bones';
  shirt: string;
  trousers: string;
  boots: string;
  hat: 'tricorn' | 'wide' | 'bicorne' | 'bandana' | 'round' | 'chef' | 'scarf';
  hatColour: string;
  /** Width of the body (stout 1.2 .. slim 0.85). */
  girth: number;
  height: number;
  extra?: 'parrot' | 'belt' | 'epaulettes' | 'ladle';
}

export interface Captain {
  id: string;
  name: string;
  /** Picture in the shipyard (a sprite). */
  sprite: string;
  outfit: Outfit;
}

export const CAPTAINS: Captain[] = [
  { id: 'rogue', name: 'Captain Rufus Redwhisker', sprite: 'captain-rogue', outfit: { beard: 'full', skin: '#f2c3a0', hair: '#c9773a', coat: '#3f7f84', cut: 'coat', shirt: '#d9a441', trousers: '#5a3a28', boots: '#3a2418', hat: 'tricorn', hatColour: '#2f4f4a', girth: 1.2, height: 1, extra: 'belt' } },
  { id: 'scarlet', name: 'Captain Ines Scarlet', sprite: 'captain-scarlet', outfit: { skin: '#f0c4a4', hair: '#9a4a2e', coat: '#7a2a2e', cut: 'coat', shirt: '#efe0c2', trousers: '#c9b48a', boots: '#4a2e1e', hat: 'wide', hatColour: '#6a2226', girth: 0.88, height: 1, extra: 'belt' } },
  { id: 'oldsalt', name: 'Old Salt Barnaby', sprite: 'captain-oldsalt', outfit: { beard: 'full', skin: '#e8b898', hair: '#a8a49a', coat: '#6f8a62', cut: 'jacket', shirt: '#e8e0d0', trousers: '#6a4a32', boots: '#3a2418', hat: 'tricorn', hatColour: '#4a4440', girth: 1.05, height: 0.97, extra: 'parrot' } },
  { id: 'commodore', name: 'Commodore Ashworth', sprite: 'captain-commodore', outfit: { beard: 'moustache', skin: '#f2cdb0', hair: '#e8e4da', coat: '#2a3a5e', cut: 'coat', shirt: '#f4efe4', trousers: '#f0ead8', boots: '#1e1a18', hat: 'bicorne', hatColour: '#1e2638', girth: 0.85, height: 1.05, extra: 'epaulettes' } },
  { id: 'bones', name: 'Mister Bones', sprite: 'captain-bones', outfit: { skin: '#ece2c8', hair: '#ece2c8', coat: '#5e9c9a', cut: 'bones', shirt: '#e8e0d0', trousers: '#3f6a64', boots: '#ece2c8', hat: 'bandana', hatColour: '#3f7f84', girth: 0.85, height: 1 } },
  { id: 'wren', name: 'Wren the Deckhand', sprite: 'captain-wren', outfit: { skin: '#f4caa8', hair: '#c9773a', coat: '#e8e0d0', cut: 'jacket', shirt: '#e8e0d0', trousers: '#7f9a86', boots: '#6a4a32', hat: 'scarf', hatColour: '#c9773a', girth: 0.88, height: 0.85 } },
  { id: 'lord', name: 'Lord Shen of the Jade Sea', sprite: 'captain-lord', outfit: { beard: 'moustache', skin: '#e6c08e', hair: '#2a2420', coat: '#b4442e', cut: 'robe', shirt: '#d9a441', trousers: '#5a2a20', boots: '#2a1a12', hat: 'round', hatColour: '#3a2418', girth: 1, height: 1.02 } },
  { id: 'cook', name: 'Cookie the Galley Cook', sprite: 'captain-cook', outfit: { beard: 'moustache', skin: '#f2c3a0', hair: '#6a4a32', coat: '#8fb0a8', cut: 'apron', shirt: '#8fb0a8', trousers: '#6a5a4a', boots: '#3a2418', hat: 'chef', hatColour: '#f4efe4', girth: 1.25, height: 0.95, extra: 'ladle' } },
];

const SHIP_KEY = 'paper-seas:ship';
const CAPTAIN_KEY = 'paper-seas:captain';

/** The ship sailed this session. */
export function activeShip(): ShipType {
  const id = loadText(SHIP_KEY);
  return SHIP_TYPES.find((s) => s.id === id) ?? SHIP_TYPES[0];
}

export function activeCaptain(): Captain {
  const id = loadText(CAPTAIN_KEY);
  return CAPTAINS.find((c) => c.id === id) ?? CAPTAINS[0];
}

/** Keeps a new choice (the page is reloaded to apply it). */
export function chooseCrew(shipId: string, captainId: string): void {
  saveText(SHIP_KEY, shipId);
  saveText(CAPTAIN_KEY, captainId);
}
