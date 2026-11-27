/**
 * The Blender-built models (public/models, docs/art-pipeline.md): what each one is in the world, and its size there.
 *   home      a house: a bed of flowers may grow by its door (world/sites.ts)
 *   store     a village building that is not a home (a warehouse)
 *   landmark  a lighthouse or a fort: no cat sits at its door
 *   landform  a mountain or an outcrop: ground itself, its whole footprint blocks and it stands without a contact patch
 *   deck      a pier or a bridge: walked on, over the water, without a contact patch
 */
export type ModelRole = 'home' | 'store' | 'landmark' | 'landform' | 'deck';

/**
 * A model's sheet: its role, and its size in the world against the model as built (1 if not given), in proportion to
 * the captain (0.6 tall): a house about 1.1 tall, a church steeple 1.55, a watchtower 1.5.
 */
export interface ModelSheet {
  role: ModelRole;
  scale?: number;
}

/** Every model, and its sheet. A model without one fails loudly (modelSheet). */
const MODELS = {
  cottage: { role: 'home' },
  tavern: { role: 'home', scale: 0.85 },
  chapel: { role: 'home', scale: 0.72 },
  hut: { role: 'home', scale: 0.72 },
  warehouse: { role: 'store' },
  lighthouse: { role: 'landmark', scale: 0.8 },
  fort: { role: 'landmark' },
  pier: { role: 'deck' },
  bridge: { role: 'deck' },
  'ridge-forest': { role: 'landform' },
  'ridge-forest-b': { role: 'landform' },
  'ridge-hill': { role: 'landform' },
  'ridge-rock': { role: 'landform' },
  'ridge-rock-b': { role: 'landform' },
  'ridge-sand': { role: 'landform' },
  'ridge-snow': { role: 'landform' },
  'ridge-snow-b': { role: 'landform' },
  'ridge-volcano': { role: 'landform' },
  'outcrop-moss': { role: 'landform' },
  'outcrop-rock': { role: 'landform' },
  'outcrop-sandstone': { role: 'landform' },
} satisfies Record<string, ModelSheet>;

/** The sheet of a model (a name without one is a bug: it throws). */
export function modelSheet(name: string): ModelSheet {
  const sheet: ModelSheet | undefined = (MODELS as Record<string, ModelSheet>)[name];
  if (!sheet) throw new Error(`no sheet for the model "${name}"`);
  return sheet;
}
