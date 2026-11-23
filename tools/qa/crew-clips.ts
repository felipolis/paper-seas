/**
 * The captains' clip check (the papercraft skill's __papercraft.clips(), mechanisms.md section 12), run in the dev
 * build's page by tools/qa/crew-clips.mjs: each captain is posed standing, through two stride cycles walking straight
 * and turning, and at the helm, and every pair of its cards is tested for cutting into each other. A card is its
 * outline (card units, mesh.userData.outline) extruded by the card's thickness; points sampled through card A's slab
 * are taken into card B's frame and counted when they fall inside B's slab.
 */
import * as THREE from 'three';
import { CAPTAINS } from '../../src/config/ships';
import { PLAYER } from '../../src/config/player';
import { CARD_THICKNESS } from '../../src/popup/card';
import { Puppet } from '../../src/player/puppet';

type Pt = readonly [number, number];

interface Slab {
  name: string;
  outline: readonly Pt[];
  toWorld: THREE.Matrix4;
  toLocal: THREE.Matrix4;
  samples: THREE.Vector3[];
}

const SPACING = 0.004;
const HALF = CARD_THICKNESS / 2;

function inside(poly: readonly Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Points through a card's slab, in its own frame: a grid over its outline, at its two faces and its middle. */
function samplesOf(outline: readonly Pt[]): THREE.Vector3[] {
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  const out: THREE.Vector3[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += SPACING) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += SPACING) {
      if (!inside(outline, x, y)) continue;
      for (const z of [-HALF * 0.95, 0, HALF * 0.95]) out.push(new THREE.Vector3(x, y, z));
    }
  }
  return out;
}

function slabs(p: Puppet): Slab[] {
  p.root.updateMatrixWorld(true);
  return p.cards.map((m) => {
    const outline = m.userData.outline as readonly Pt[];
    return { name: m.name, outline, toWorld: m.matrixWorld.clone(), toLocal: m.matrixWorld.clone().invert(), samples: samplesOf(outline) };
  });
}

/**
 * The pairs of cards cutting into each other in the current pose: how many sample points of one fall inside the other,
 * and where (the deepest one, in the first card's units).
 */
function clips(p: Puppet): Map<string, { points: number; at: string }> {
  const s = slabs(p);
  const found = new Map<string, { points: number; at: string }>();
  const v = new THREE.Vector3();
  for (let a = 0; a < s.length; a++) {
    for (let b = 0; b < s.length; b++) {
      if (a === b) continue;
      let n = 0;
      let deepest = Infinity;
      let at = '';
      for (const q of s[a].samples) {
        v.copy(q).applyMatrix4(s[a].toWorld).applyMatrix4(s[b].toLocal);
        if (Math.abs(v.z) < HALF && inside(s[b].outline, v.x, v.y)) {
          n++;
          if (Math.abs(v.z) < deepest) [deepest, at] = [Math.abs(v.z), `${s[a].name} at (${q.x.toFixed(3)}, ${q.y.toFixed(3)})`];
        }
      }
      const key = [s[a].name, s[b].name].sort().join(' / ');
      if (n && n > (found.get(key)?.points ?? 0)) found.set(key, { points: n, at });
    }
  }
  return found;
}

export interface ClipReport {
  captain: string;
  cards: number;
  clips: { pair: string; pose: string; points: number; at: string }[];
}

export function checkAll(): ClipReport[] {
  const reports: ClipReport[] = [];
  for (const c of CAPTAINS) {
    const p = new Puppet(c.id);
    const report: ClipReport = { captain: c.id, cards: p.cards.length, clips: [] };
    const seen = new Set<string>();
    const note = (pose: string) => {
      for (const [pair, { points, at }] of clips(p)) {
        if (seen.has(pair)) continue;
        seen.add(pair);
        report.clips.push({ pair, pose, points, at });
      }
    };
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) p.walk(dt, 0, 0, 0, 0);
    note('standing');
    for (const [label, yawRate] of [['walking', 0], ['turning left', 2.5], ['turning right', -2.5]] as const) {
      const v = PLAYER.speed;
      for (let i = 0; i < 150; i++) {
        p.walk(dt, v * dt, v, v, yawRate);
        if (i > 40 && i % 4 === 0) note(`${label} ${i}`);
      }
      for (let i = 0; i < 90; i++) {
        p.walk(dt, 0, 0, 0, 0);
        if (i % 10 === 0) note(`${label} stopping ${i}`);
      }
    }
    for (const steer of [-1, 0, 1]) {
      p.helm(dt, steer);
      note(`helm ${steer}`);
    }
    reports.push(report);
  }
  return reports;
}
