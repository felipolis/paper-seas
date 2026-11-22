/**
 * WebGL renderer. The scene renders into a multisampled HDR target (render/post.ts); tone mapping, grading and
 * the sRGB encode happen in the post composite, so the renderer itself does none.
 */
import * as THREE from 'three';
import { installPaperShadows } from './shadows';

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  // the basic filter, replaced by papertrails' PCSS (render/shadows.ts)
  installPaperShadows();
  renderer.shadowMap.type = THREE.BasicShadowMap;
  return renderer;
}
