/**
 * Each biome's character, in one place:
 *   look  the look it takes: its light and grade (render/biome-look.ts) and the tints of its ground, its pieces, its
 *         roads and its water (render/biome-tint.ts): the plain heartland, the peach and lilac blossom, the misty teal
 *         pinewood
 *   life  what fills its air (life/, config/life.ts): leaves in the heartland, petals in the blossom, rain and mist in
 *         the pinewood; the beach's sand takes the desert's dust motes
 *   wind  how strongly the wind rocks its standing cards (world/wind.ts): the pine woods all but still
 * What grows and lives there is in config/flora.ts (TILES, ANIMALS).
 */
import type { Biome } from '../world/land';

/** A biome look (render/biome-look.ts, render/biome-tint.ts). */
export type LookRow = 'heartland' | 'blossom' | 'pinewood';
/** A biome's life (config/life.ts biomes). */
export type LifeRow = LookRow | 'desert';

export const BIOME = {
  jungle: { look: 'heartland', life: 'heartland', wind: 1 },
  rocky: { look: 'heartland', life: 'heartland', wind: 1 },
  beach: { look: 'heartland', life: 'desert', wind: 1 },
  meadow: { look: 'blossom', life: 'blossom', wind: 0.85 },
  pine: { look: 'pinewood', life: 'pinewood', wind: 0.32 },
} as const satisfies Record<Biome, { look: LookRow; life: LifeRow; wind: number }>;
