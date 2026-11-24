/** A day colour and its night colour, blended in linear RGB as papertrails blends them (render/biomegrade.js there). */
import * as THREE from 'three';

export type Pair = readonly [day: THREE.Color, night: THREE.Color];

export const pair = (day: THREE.ColorRepresentation, night: THREE.ColorRepresentation): Pair => [new THREE.Color(day), new THREE.Color(night)];

/** The pair blended n of the way (0 day .. 1 night) into out. */
export function blend(out: THREE.Color, [day, night]: Pair, n: number): THREE.Color {
  return out.copy(day).lerp(night, n);
}
