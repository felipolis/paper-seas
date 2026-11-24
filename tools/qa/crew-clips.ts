/**
 * The captains' clip check (the papercraft skill's __papercraft.clips(), mechanisms.md section 12), run in the dev
 * build's page by tools/qa/crew-clips.mjs: each captain is posed standing, through two stride cycles walking straight
 * and turning, and at the helm, and every pair of its pieces on different joints is tested for cutting into each
 * other (pieces on one joint never move apart; papertrails slots them through each other on purpose). A piece is its
 * outline, less its holes, extruded by its thickness (the model's Piece list); points sampled through piece A's slab
 * are taken into piece B's frame and counted when they fall inside B's slab.
 */
import * as THREE from 'three';
import { CAPTAINS } from '../../src/config/ships';
import { PLAYER } from '../../src/config/player';
import { Puppet } from '../../src/player/puppet';
import type { Piece } from '../../src/player/crew-model';

type Pt = readonly [number, number];

interface Slab {
  name: string;
  /** Its joint (the node it hangs on), and half its thickness. */
  joint: THREE.Object3D;
  half: number;
  outline: readonly Pt[];
  holes: readonly (readonly Pt[])[];
  toWorld: THREE.Matrix4;
  toLocal: THREE.Matrix4;
  samples: THREE.Vector3[];
}

const SPACING = 0.004;

function inPolygon(poly: readonly Pt[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Inside a piece: within its outline, out of its holes (a lantern's panes). */
const inside = (s: Pick<Slab, 'outline' | 'holes'>, x: number, y: number) => inPolygon(s.outline, x, y) && !s.holes.some((h) => inPolygon(h, x, y));

/** Points through a piece's slab, in its own frame: a grid over it, at its two faces and its middle. */
function samplesOf(piece: Piece, half: number): THREE.Vector3[] {
  const xs = piece.outline.map((p) => p[0]);
  const ys = piece.outline.map((p) => p[1]);
  const out: THREE.Vector3[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += SPACING) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += SPACING) {
      if (!inside(piece, x, y)) continue;
      for (const z of [-half * 0.95, 0, half * 0.95]) out.push(new THREE.Vector3(x, y, z));
    }
  }
  return out;
}

function slabs(p: Puppet): Slab[] {
  p.root.updateMatrixWorld(true);
  return p.pieces.map((piece) => {
    const half = piece.thickness / 2;
    const toWorld = piece.joint.matrixWorld.clone().multiply(piece.frame);
    return { name: piece.name, joint: piece.joint, half, outline: piece.outline, holes: piece.holes, toWorld, toLocal: toWorld.clone().invert(), samples: samplesOf(piece, half) };
  });
}

/**
 * The pairs of pieces cutting into each other in the current pose: how many sample points of one fall inside the other,
 * and where (the deepest one, in the first piece's units).
 */
function clips(p: Puppet): Map<string, { points: number; at: string }> {
  const s = slabs(p);
  const found = new Map<string, { points: number; at: string }>();
  const v = new THREE.Vector3();
  for (let a = 0; a < s.length; a++) {
    for (let b = 0; b < s.length; b++) {
      if (s[a].joint === s[b].joint) continue;
      let n = 0;
      let deepest = Infinity;
      let at = '';
      for (const q of s[a].samples) {
        v.copy(q).applyMatrix4(s[a].toWorld).applyMatrix4(s[b].toLocal);
        if (Math.abs(v.z) < s[b].half && inside(s[b], v.x, v.y)) {
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
    const report: ClipReport = { captain: c.id, cards: p.pieces.length, clips: [] };
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
