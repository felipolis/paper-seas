/**
 * Lamp pools: at night a warm pool of light on the page and the paper round each lit lamp, with no real light: the six
 * lamps nearest the ship or the captain are written into every paper material's uniforms, and its shader adds the pools to the paper
 * (render/paper-material.ts). A lamp pools only once its card stands, and the pools fade out 9-12 units away.
 */
import * as THREE from 'three';
import { smoothstep } from '../core/math';

/** The pools: the reach from the lamp itself (world units), strength at full night, colour. */
const POOLS = { radius: 1.5, strength: 1, colour: '#ffc878' } as const;
/** How many lamps pool at once (the shader's loop). */
export const POOL_COUNT = 6;
/** The pools fade out between these distances from the ship or the captain. */
const FADE: [number, number] = [9, 12];
/** A lamp sits this share of its card's height up, no lower than LAMP_MIN. */
const LAMP_HEIGHT = 0.72;
const LAMP_MIN = 0.22;

/** The paper's pool uniforms (spread into every paper material): xyz lamp, w strength; rgb colour, w reach (0: off). */
export const poolUniforms = {
  uPaperPool: { value: Array.from({ length: POOL_COUNT }, () => new THREE.Vector4()) },
  uPaperPoolCol: { value: new THREE.Vector4() },
};

/** A lamp the pools may light: where it stands, how tall its card is and how far it has risen (0 flat .. 1 up). */
export interface Lamp {
  x: number;
  y: number;
  z: number;
  height: number;
  risen: number;
}

const colour = new THREE.Color(POOLS.colour);
const used = new Set<Lamp>();

/** Writes this frame's pools: night 0..1, the ship or the captain at (fx, fz), the lamps standing round it. */
export function updatePools(night: number, fx: number, fz: number, lamps: Iterable<Lamp>): void {
  const k = night * POOLS.strength;
  const col = poolUniforms.uPaperPoolCol.value;
  if (k <= 0.004) {
    col.w = 0;
    return;
  }
  col.set(colour.r * k, colour.g * k, colour.b * k, POOLS.radius);
  used.clear();
  const list = [...lamps];
  for (const slot of poolUniforms.uPaperPool.value) {
    let best: Lamp | null = null;
    let bestD = FADE[1] * FADE[1];
    for (const l of list) {
      if (used.has(l) || l.risen <= 0) continue;
      const d = (l.x - fx) ** 2 + (l.z - fz) ** 2;
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    if (!best) {
      slot.w = 0;
      continue;
    }
    used.add(best);
    // (it lights as its card stands up, and fades with the distance from the ship or the captain)
    const strength = smoothstep(0.6, 1, best.risen) * (1 - smoothstep(FADE[0], FADE[1], Math.sqrt(bestD)));
    slot.set(best.x, best.y + Math.max(LAMP_MIN, best.height * LAMP_HEIGHT), best.z, strength);
  }
}
