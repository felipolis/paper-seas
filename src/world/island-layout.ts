/**
 * Where the islands are and what shape they have, as a pure function of the seed. The ocean is cut into square
 * regions; each region holds at most one island (jittered inside it, kept clear of its neighbours by its extent).
 * Islands come in many shapes: round, long ridges, crescents with a bay, atolls with a lagoon and a passage, twin
 * islands with a channel between them, archipelagos of islets, big islands, and lone sea stacks.
 */
import { WORLD } from '../config/world';
import { Rng, hash01, hash2, pickWeighted } from '../core/rng';
import { shapeDistance, type Blob, type Cut, type IslandShape, type Lump } from './island-shape';
import { cellKey } from '../core/grid';

export type IslandKind = 'tropical' | 'jungle' | 'rocky' | 'skull' | 'village' | 'sandbar' | 'volcano' | 'ruins';
export type IslandForm = 'round' | 'long' | 'crescent' | 'atoll' | 'twin' | 'archipelago' | 'big' | 'stack';

export interface IslandSpec {
  id: number;
  kind: IslandKind;
  x: number;
  z: number;
  /** Salt for what is drawn from the island (its name). */
  seed: number;
  shape: IslandShape;
}

/** Width of the shallow-water ring printed around every island (world units). */
const SHALLOW_WIDTH = 1.0;
/**
 * Largest extent of any island (bounds the neighbour search): the 'big' form's farthest satellite reaches 4.5 + 3.8 x
 * 1.3 (stretch) x 1.33 (its lumps at their largest), about 11.1; every other form stays under 9.5.
 */
const MAX_EXTENT = 11.5;

const FORMS: ReadonlyArray<{ form: IslandForm; weight: number }> = [
  { form: 'round', weight: 0.22 },
  { form: 'long', weight: 0.12 },
  { form: 'crescent', weight: 0.11 },
  { form: 'atoll', weight: 0.09 },
  { form: 'twin', weight: 0.1 },
  { form: 'archipelago', weight: 0.12 },
  { form: 'big', weight: 0.12 },
  { form: 'stack', weight: 0.12 },
];

/** Which themes suit which forms (weights). */
const KINDS_BY_FORM: Record<IslandForm, Array<[IslandKind, number]>> = {
  round: [['tropical', 3], ['skull', 1.2], ['village', 1.2], ['rocky', 1], ['ruins', 0.6]],
  long: [['jungle', 2], ['tropical', 2], ['village', 1], ['rocky', 1]],
  crescent: [['village', 2], ['tropical', 2], ['skull', 1], ['ruins', 1]],
  atoll: [['tropical', 3], ['sandbar', 1], ['village', 1]],
  twin: [['jungle', 1.5], ['tropical', 2], ['volcano', 1], ['rocky', 1]],
  archipelago: [['tropical', 2], ['sandbar', 2], ['rocky', 1]],
  big: [['jungle', 2], ['volcano', 1.5], ['village', 1.5], ['ruins', 1.5]],
  stack: [['rocky', 3], ['sandbar', 2]],
};

function lumps(rng: Rng, strength: number): Lump[] {
  return [2, 3, 5].map((k, n) => ({ k, amp: (strength / (n + 1)) * (0.5 + rng.float()), phase: rng.float() * Math.PI * 2 }));
}

function blob(rng: Rng, x: number, z: number, r: number, stretch = 1, rot = rng.float() * Math.PI, lumpiness = 0.12): Blob {
  return { x, z, rx: r * stretch, rz: r / Math.sqrt(stretch), rot, lumps: lumps(rng, lumpiness) };
}

/** Builds the shape of an island of the given form. Coordinates are island-local. */
function makeShape(form: IslandForm, rng: Rng): IslandShape {
  const blobs: Blob[] = [];
  const cuts: Cut[] = [];
  switch (form) {
    case 'round':
      blobs.push(blob(rng, 0, 0, rng.range(2.4, 3.8), rng.range(1, 1.35)));
      break;
    case 'long': {
      // a bent ridge of overlapping blobs
      const n = rng.int(3, 5);
      const a = rng.float() * Math.PI;
      const bend = rng.range(-0.35, 0.35);
      const step = rng.range(1.8, 2.3);
      for (let i = 0; i < n; i++) {
        const s = (i - (n - 1) / 2) * step;
        const ang = a + bend * s * 0.3;
        blobs.push(blob(rng, Math.cos(ang) * s, Math.sin(ang) * s + bend * s * s * 0.15, rng.range(1.4, 2.1), 1.2, ang, 0.1));
      }
      break;
    }
    case 'crescent': {
      const r = rng.range(3.6, 4.8);
      blobs.push(blob(rng, 0, 0, r, 1.1, rng.float() * Math.PI, 0.06));
      const a = rng.float() * Math.PI * 2;
      cuts.push({ type: 'circle', x: Math.cos(a) * r * 0.62, z: Math.sin(a) * r * 0.62, r: r * 0.72 });
      break;
    }
    case 'atoll': {
      // a ring of land round a lagoon, with a passage the ship can sail through
      const r = rng.range(4.6, 5.8);
      blobs.push(blob(rng, 0, 0, r, 1.05, rng.float() * Math.PI, 0.05));
      cuts.push({ type: 'circle', x: 0, z: 0, r: r * 0.62 });
      const a = rng.float() * Math.PI * 2;
      cuts.push({ type: 'capsule', x1: 0, z1: 0, x2: Math.cos(a) * (r + 2), z2: Math.sin(a) * (r + 2), r: 1.05 });
      if (rng.chance(0.5)) {
        const b = a + Math.PI + rng.range(-0.6, 0.6);
        cuts.push({ type: 'capsule', x1: 0, z1: 0, x2: Math.cos(b) * (r + 2), z2: Math.sin(b) * (r + 2), r: 0.9 });
      }
      break;
    }
    case 'twin': {
      // two islands with a sailable channel between them
      const a = rng.float() * Math.PI;
      const r1 = rng.range(2.6, 3.6);
      const r2 = rng.range(2.2, 3.2);
      const gap = rng.range(2.2, 2.8);
      const d = (r1 + r2 + gap) / 2;
      blobs.push(blob(rng, -Math.cos(a) * d * 0.95, -Math.sin(a) * d * 0.95, r1, 1.15));
      blobs.push(blob(rng, Math.cos(a) * d, Math.sin(a) * d, r2, 1.15));
      break;
    }
    case 'archipelago': {
      const n = rng.int(4, 6);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const d = i === 0 ? 0 : rng.range(3.2, 5.6);
        blobs.push(blob(rng, Math.cos(a) * d, Math.sin(a) * d, rng.range(0.9, 1.9), rng.range(1, 1.4)));
      }
      break;
    }
    case 'big': {
      const n = rng.int(3, 5);
      blobs.push(blob(rng, 0, 0, rng.range(4, 5), 1.2));
      for (let i = 1; i < n; i++) {
        const a = rng.float() * Math.PI * 2;
        const d = rng.range(3, 4.5);
        blobs.push(blob(rng, Math.cos(a) * d, Math.sin(a) * d, rng.range(2.6, 3.8), rng.range(1, 1.3)));
      }
      if (rng.chance(0.35)) {
        // an inland lake
        const a = rng.float() * Math.PI * 2;
        cuts.push({ type: 'circle', x: Math.cos(a) * 1.2, z: Math.sin(a) * 1.2, r: rng.range(1.0, 1.5) });
      }
      break;
    }
    case 'stack':
      blobs.push(blob(rng, 0, 0, rng.range(0.7, 1.3), rng.range(1, 1.3), rng.float() * Math.PI, 0.18));
      break;
  }
  let extent = 0;
  for (const b of blobs) {
    let k = 1;
    for (const l of b.lumps) k += Math.abs(l.amp);
    extent = Math.max(extent, Math.hypot(b.x, b.z) + Math.max(b.rx, b.rz) * k);
  }
  return { blobs, cuts, extent };
}

/** Signed distance from (x, z) (world) to the island's shore: > 0 in the water, < 0 on land. */
export function shoreDistance(spec: IslandSpec, x: number, z: number): number {
  return shapeDistance(spec.shape, x - spec.x, z - spec.z);
}

export class IslandLayout {
  private readonly cache = new Map<number, IslandSpec | null>();

  constructor(private readonly seed: number = WORLD.seed) {}

  /** The island of region (i, j), or null. */
  region(i: number, j: number): IslandSpec | null {
    const key = cellKey(i, j);
    if (this.cache.has(key)) return this.cache.get(key)!;
    const spec = this.generate(i, j, key);
    this.cache.set(key, spec);
    return spec;
  }

  /** Islands whose land may lie within `r` of (x, z) (callers test the actual distance). */
  near(x: number, z: number, r: number, out: IslandSpec[] = []): IslandSpec[] {
    out.length = 0;
    const size = WORLD.regionSize;
    const rr = r + MAX_EXTENT;
    const i0 = Math.floor((x - rr) / size);
    const i1 = Math.floor((x + rr) / size);
    const j0 = Math.floor((z - rr) / size);
    const j1 = Math.floor((z + rr) / size);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const s = this.region(i, j);
        if (s && Math.hypot(s.x - x, s.z - z) < r + s.shape.extent) out.push(s);
      }
    }
    return out;
  }

  private generate(i: number, j: number, key: number): IslandSpec | null {
    const seed = this.seed;
    if (hash01(seed, i, j) > WORLD.islandChance) return null;
    const islandSeed = hash2(seed + 15, i, j);
    const rng = new Rng(islandSeed);

    const { form } = pickWeighted(FORMS, (f) => f.weight, rng.float());
    const shape = makeShape(form, rng);
    // keep the island (plus its shallows) inside its region so neighbours never touch
    const size = WORLD.regionSize;
    const margin = Math.min(0.45, (shape.extent + SHALLOW_WIDTH + 1.5) / size);
    const x = (i + margin + (1 - 2 * margin) * rng.float()) * size;
    const z = (j + margin + (1 - 2 * margin) * rng.float()) * size;
    if (Math.hypot(x, z) < WORLD.spawnClearRadius + shape.extent + SHALLOW_WIDTH) return null;

    const [kind] = pickWeighted(KINDS_BY_FORM[form], ([, w]) => w, rng.float());
    return { id: key, kind, x, z, seed: islandSeed, shape };
  }
}
