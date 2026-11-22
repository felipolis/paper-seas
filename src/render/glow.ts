/**
 * Things that light up at night: the printed lit windows and lamp rooms of the buildings and of the ship (each through
 * an emissive mask of exactly those pixels) and the lantern cards. The day / night cycle sets one global level.
 */
import * as THREE from 'three';
import { PALETTE } from '../config/palette';

const glowing = new Set<THREE.MeshLambertMaterial>();
let level = 0;
/** Emissive strength of lit windows at full night (bright enough for the bloom to halo them). */
const WINDOW_GLOW = 9;

/** Makes a material glow at night through a prepared emissive mask (the Blender models' atlas-glow.png). */
export function addGlowMap(mat: THREE.MeshLambertMaterial, mask: THREE.Texture): void {
  mat.emissive.set(PALETTE.lantern);
  mat.emissiveMap = mask;
  mat.emissiveIntensity = level * WINDOW_GLOW;
  mat.needsUpdate = true;
  glowing.add(mat);
}

/** A copy of a glowing material glows with it (until the copy is disposed). */
export function glowLike(copy: THREE.Material, source: THREE.Material): void {
  if (!glowing.has(source as THREE.MeshLambertMaterial)) return;
  const m = copy as THREE.MeshLambertMaterial;
  glowing.add(m);
  m.emissiveIntensity = (source as THREE.MeshLambertMaterial).emissiveIntensity;
  m.addEventListener('dispose', () => glowing.delete(m));
}

/** Registers a plain emissive material (lantern cards) to follow the night level. */
export function registerGlow(mat: THREE.MeshLambertMaterial): void {
  glowing.add(mat);
  mat.emissiveIntensity = 0.15 + level * 1.6;
}

export function setGlowLevel(v: number): void {
  if (Math.abs(v - level) < 1e-3) return;
  level = v;
  for (const m of glowing) m.emissiveIntensity = m.emissiveMap ? level * WINDOW_GLOW : 0.15 + level * 1.6;
}
