/**
 * Which way each directional print of the sea looks as it is drawn (public/art, checked by eye on the cut sprites; to
 * be checked again whenever the sprites are regenerated): 1 to the right, -1 to the left. A creature or a ship heading
 * the other way shows its print mirrored. (The land's animals keep theirs with their behaviour, world/critters.ts.)
 */
const FACES: Record<string, 1 | -1> = {
  whale: 1,
  // (seen from behind: either way)
  'whale-tail': 1,
  // a leap: the head up ahead, the tail down behind
  'dolphin-0': 1,
  'dolphin-1': -1,
  'flying-fish': -1,
  'fish-school': -1,
  turtle: -1,
  // the tail trails behind, at the lower right
  manta: -1,
  // (seen from the front: either way)
  octopus: 1,
  // a fin rakes back, its tip trailing: this one swims to the right
  'shark-fin': 1,
  'serpent-head': -1,
  // the tail curls away behind a serpent swimming to the left
  'serpent-tail': -1,
  // the bowsprit ahead
  'merchant-ship': 1,
  'ghost-ship': 1,
  'gull-up': 1,
  'gull-down': 1,
  'gull-glide': 1,
};

/** True if the print must be mirrored to head along dir (> 0: to the right, < 0: to the left). */
export function mirrorFor(sprite: string, dir: number): boolean {
  const face = FACES[sprite];
  if (!face) throw new Error(`no facing for "${sprite}"`);
  return (dir < 0 ? -1 : 1) !== face;
}
