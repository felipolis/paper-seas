/**
 * The constructions' clip check: every Blender-built model (buildings, piers, bridges, heights) unfolds from flat to
 * standing through its own paper springs, and at a few dozen poses on the way every pair of its pieces is tested for
 * cutting into each other. A piece is the triangles skinned to one bone; two pieces cut into each other where an edge of one passes through the inside of a triangle of
 * the other (well clear of that triangle's own edges, so pieces meeting along a hinge or a corner never count) and
 * reaches more than DEPTH beyond its plane on the shorter side (paper overlapping by a hair at a corner is not a cut).
 * Flat on the page (progress under FLAT) the pieces lie stacked, a lift apart: that pose is not tested.
 * Run in the dev build's page by tools/qa/model-clips.mjs.
 */
import * as THREE from 'three';
import { buildModel, modelNames } from '../../src/world/models';

/** How far inside a triangle a crossing must be to count (world units): a hinge's or a corner's touch is not a cut. */
const INSET = 0.006;
/** How far an edge must reach through the other piece to be a cut (world units; a house is about 1.1 tall). */
const DEPTH = 0.02;
/** Below this progress the pieces lie flat on the page. */
const FLAT = 0.1;
/** Simulated time of the unfolding, and the poses tested on the way. */
const DURATION = 3.2;
const POSES = 32;

interface Tri {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
}

/** The triangles of each piece (bone index) in their current pose, in the building's world space. */
function piecesOf(mesh: THREE.SkinnedMesh): Map<number, Tri[]> {
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const g = mesh.geometry;
  const index = g.getIndex();
  const skin = g.getAttribute('skinIndex');
  const n = index ? index.count : g.getAttribute('position').count;
  const at = (k: number) => (index ? index.getX(k) : k);
  const v = (i: number) => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
  const pieces = new Map<number, Tri[]>();
  for (let k = 0; k < n; k += 3) {
    const i0 = at(k);
    const bone = skin.getX(i0);
    const tri = { a: v(i0), b: v(at(k + 1)), c: v(at(k + 2)) };
    (pieces.get(bone) ?? pieces.set(bone, []).get(bone)!).push(tri);
  }
  return pieces;
}

const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const p = new THREE.Vector3();
const q = new THREE.Vector3();
const s = new THREE.Vector3();
const d = new THREE.Vector3();
const hit = new THREE.Vector3();

/** Distance from point x to segment ab. */
function toSegment(x: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = q.subVectors(b, a);
  const t = Math.max(0, Math.min(1, s.subVectors(x, a).dot(ab) / Math.max(ab.lengthSq(), 1e-12)));
  return x.distanceTo(new THREE.Vector3().copy(a).addScaledVector(ab, t));
}

/** Where segment from-to crosses triangle t well inside it, or null. */
function crossing(from: THREE.Vector3, to: THREE.Vector3, t: Tri): THREE.Vector3 | null {
  d.subVectors(to, from);
  e1.subVectors(t.b, t.a);
  e2.subVectors(t.c, t.a);
  p.crossVectors(d, e2);
  const det = e1.dot(p);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  s.subVectors(from, t.a);
  const u = s.dot(p) * inv;
  if (u < 0 || u > 1) return null;
  const qv = new THREE.Vector3().crossVectors(s, e1);
  const w = d.dot(qv) * inv;
  if (w < 0 || u + w > 1) return null;
  const k = e2.dot(qv) * inv;
  if (k <= 0 || k >= 1) return null;
  // (how far the edge reaches through: its shorter part beyond the triangle's plane)
  const nrm = new THREE.Vector3().crossVectors(e1, e2).normalize();
  const depth = Math.min(Math.abs(nrm.dot(new THREE.Vector3().subVectors(from, t.a))), Math.abs(nrm.dot(new THREE.Vector3().subVectors(to, t.a))));
  if (depth < DEPTH) return null;
  hit.copy(from).addScaledVector(d, k);
  if (toSegment(hit, t.a, t.b) < INSET || toSegment(hit, t.b, t.c) < INSET || toSegment(hit, t.c, t.a) < INSET) return null;
  // (and not at the very end of the crossing edge: a piece's corner resting on another is a touch)
  if (hit.distanceTo(from) < INSET || hit.distanceTo(to) < INSET) return null;
  return hit.clone();
}

function boxOf(tris: Tri[]): THREE.Box3 {
  const b = new THREE.Box3();
  for (const t of tris) b.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
  return b;
}

/** The pairs of pieces cutting into each other in this pose, each with one crossing point. */
function clips(mesh: THREE.SkinnedMesh): Map<string, THREE.Vector3> {
  const pieces = [...piecesOf(mesh).entries()];
  const boxes = pieces.map(([, tris]) => boxOf(tris).expandByScalar(INSET));
  const found = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pieces.length; i++) {
    for (let j = 0; j < pieces.length; j++) {
      if (i === j || !boxes[i].intersectsBox(boxes[j])) continue;
      const key = [pieces[i][0], pieces[j][0]].sort((x, y) => x - y).join('/');
      if (found.has(key)) continue;
      search: for (const a of pieces[i][1]) {
        for (const [from, to] of [[a.a, a.b], [a.b, a.c], [a.c, a.a]] as const) {
          for (const b of pieces[j][1]) {
            const x = crossing(from, to, b);
            if (x) {
              found.set(key, x);
              break search;
            }
          }
        }
      }
    }
  }
  return found;
}

export interface ModelClipReport {
  model: string;
  pieces: number;
  clips: { pair: string; progress: number; at: [number, number, number] }[];
  /** The pairs still cutting into each other once it stands at rest. */
  standing: string[];
}

export function checkAll(only?: string[]): ModelClipReport[] {
  const reports: ModelClipReport[] = [];
  for (const name of modelNames()) {
    if (only && !only.includes(name)) continue;
    const b = buildModel(name, 0, 0, 0, 0, 'meadow');
    const mesh = b.root as THREE.SkinnedMesh;
    const report: ModelClipReport = { model: name, pieces: mesh.skeleton.bones.length - 1, clips: [], standing: [] };
    const seen = new Set<string>();
    b.fold.setTarget(1);
    const dt = DURATION / POSES;
    for (let k = 0; k <= POSES; k++) {
      for (const [pair, at] of b.fold.progress < FLAT ? [] : clips(mesh)) {
        if (seen.has(pair)) continue;
        seen.add(pair);
        report.clips.push({ pair: pair.split('/').map((i) => mesh.skeleton.bones[+i].name || `#${i}`).join(' / '), progress: +b.fold.progress.toFixed(2), at: [+at.x.toFixed(3), +at.y.toFixed(3), +at.z.toFixed(3)] });
      }
      // (sub-stepped like the game)
      for (let i = 0; i < 4; i++) b.fold.update(dt / 4);
    }
    b.fold.snap(1);
    const label = (pair: string) => pair.split('/').map((i) => mesh.skeleton.bones[+i].name || `#${i}`).join(' / ');
    report.standing = [...clips(mesh).keys()].map(label);
    b.dispose();
    reports.push(report);
  }
  return reports;
}
