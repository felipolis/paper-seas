/**
 * The world QA's checks, run in the dev build's page by tools/qa/world-qa.mjs (which lists what they look for): the
 * game is driven through window.game, a few places are visited, and every issue is returned with where it is.
 */
import * as THREE from 'three';
import { CHUNK } from '../../src/world/terrain';
import { CROSS_PLANES } from '../../src/world/card-field';
import type { Pt } from '../../src/world/polyline';

export interface Issue {
  kind: string;
  at: [number, number];
  note: string;
}

export interface WorldReport {
  issues: Issue[];
  places: number;
  cards: number;
  buildings: number;
  roads: number;
}

/** More than this share of the world as land is an issue (there is more water than land). */
const MAX_LAND = 0.35;
/** Cards that stand in the sea by design. */
const SEA_CARDS = new Set(['flamingo', 'sea-arch', 'rock-spire']);
/** Cards that belong on a river's water: a duck afloat, and the mound and back crag of the river_source in its pool. */
const STREAM_CARDS = new Set(['duck-float', 'spring', 'crag-0']);
const DOWN = new THREE.Vector3(0, -1, 0);

export async function checkWorld(): Promise<WorldReport> {
  // (the dev build sets window.game before the QA can open the page: tools/browser.mjs openGame waits for it)
  const g = window.game!;
  g.stop();
  // the checks' own random choices are seeded, so a run can be repeated exactly
  let rs = 0x2545f491;
  const rand = () => (rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296;
  const T = g.world.terrain;
  const L = g.world.land;
  const P = g.world.places;
  const W = g.walker;
  const issues: Issue[] = [];
  const add = (kind: string, x: number, z: number, note: string) => issues.push({ kind, at: [x, z], note });
  const step = (n: number) => { for (let i = 0; i < n; i++) g.step(1 / 60); };
  const key = (code: string, down: boolean) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  const wetSeen = new Set<object>();
  const manifest = (await (await fetch('/art/manifest.json')).json()) as Record<string, { w: number; h: number }>;
  const ray = new THREE.Raycaster();
  const from = new THREE.Vector3();
  let cards = 0;
  let buildings = 0;
  let roadsChecked = 0;

  // ---- sea: the world is mostly water (sampled over 2000 x 2000 round the start) ----
  let landN = 0;
  for (let j = 0; j < 100; j++) for (let i = 0; i < 100; i++) if (L.distance((i - 50) * 20 + 7, (j - 50) * 20 + 3) < 0) landN++;
  if (landN / 10000 > MAX_LAND) add('sea', 0, 0, `${Math.round(landN / 100)}% of the world is land (at most ${MAX_LAND * 100}%)`);

  // the places: settlements with roads, then a couple of wild spots well inland
  const places: Pt[] = [];
  for (const s of P.sitesNear(0, 0, 500)) {
    if (places.length >= 4) break;
    if (s.kind !== 'ruins' && P.roadsOf(s).length) places.push([s.x, s.z]);
  }
  for (let k = 0; k < 4000 && places.length < 6; k++) {
    const x = (rand() - 0.5) * 800;
    const z = (rand() - 0.5) * 800;
    if (L.distance(x, z) < -6) places.push([x, z]);
  }

  for (const [px, pz] of places) {
    // the ship in the nearest open water, the captain ashore at the place
    let spot: Pt | null = null;
    for (let r = 2; r < 90 && !spot; r += 0.5) {
      for (let a = 0; a < 48; a++) {
        const x = px + Math.cos((a / 48) * 6.283) * r;
        const z = pz + Math.sin((a / 48) * 6.283) * r;
        if (L.distance(x, z) > 1.5 && L.distance(x, z) < 3) { spot = [x, z]; break; }
      }
    }
    if (!spot) continue;
    g.moveShip(spot[0], spot[1]);
    g.landCaptain(px, pz);
    step(240);

    // ---- holes: land with no paper under it ----
    const grounds: THREE.Object3D[] = [];
    for (const c of T.chunkList()) if (c.ground) grounds.push(c.ground);
    const built = (x: number, z: number) => [...T.chunkList()].some((c) => c.ground && c.i === Math.floor(x / CHUNK) && c.j === Math.floor(z / CHUNK));
    const groundUnder = (x: number, z: number) => {
      ray.set(from.set(x, 5, z), DOWN);
      return ray.intersectObjects(grounds, true).length > 0;
    };
    for (let k = 0; k < 300; k++) {
      const x = px + (rand() - 0.5) * 14;
      const z = pz + (rand() - 0.5) * 14;
      if (T.distanceAt(x, z) > -0.35 || !built(x, z)) continue;
      if (!groundUnder(x, z)) add('holes', x, z, 'no ground under land');
    }

    // ... and every chunk seam and corner near here, finely (where two or four sheets of paper meet)
    for (let cx = Math.ceil((px - 10) / CHUNK) * CHUNK; cx <= px + 10; cx += CHUNK) {
      for (let cz = Math.ceil((pz - 10) / CHUNK) * CHUNK; cz <= pz + 10; cz += CHUNK) {
        for (let k = -8; k <= 8; k++) {
          // (a few mm off the seam line itself: a ray exactly along a shared edge is ambiguous)
          const o = k * 0.04 + 0.013;
          for (const [x, z] of [[cx + o, cz + 0.011], [cx + 0.011, cz + o], [cx + o, cz + o * 0.9], [cx + o, cz - o * 0.9]]) {
            if (T.distanceAt(x, z) > -0.35 || !built(x, z)) continue;
            if (!groundUnder(x, z)) add('holes', x, z, 'no ground at a chunk seam');
          }
        }
      }
    }

    // ---- standing cards near the captain ----
    const near = (x: number, z: number, r: number) => Math.hypot(x - px, z - pz) < r;
    const ground = (x: number, z: number) => (T.distanceAt(x, z) > 0 ? -1 : L.groundHeight(x, z));
    const roads = P.roadsNear([px - 8, pz - 8, px + 8, pz + 8]);
    const layouts = P.layoutsNear([px - 8, pz - 8, px + 8, pz + 8]);
    const lanes = layouts.flatMap((l) => l.lanes);
    const streams = P.streams.near([px - 8, pz - 8, px + 8, pz + 8]);
    const onLine = (pts: readonly Pt[], x: number, z: number, r: number) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const dx = bx - ax, dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r) return true;
      }
      return false;
    };
    for (const c of T.chunkList()) {
      for (const card of c.cards) {
        if (card.hidden || card.flap.p < 0.9 || !near(card.x, card.z, 7)) continue;
        cards++;
        const d = T.distanceAt(card.x, card.z);
        if (d > 0 && !SEA_CARDS.has(card.sprite)) add('wet', card.x, card.z, card.sprite);
        // the base line of the card (every plane): its ends must stand on ground no lower than its foot
        const m = manifest[card.sprite];
        const w = ((card.height * m.w) / m.h / 2) * 0.9;
        let hangs = false;
        for (const a of card.cross ? CROSS_PLANES.map((p) => card.yaw + p) : [card.yaw]) {
          for (const s of [-1, 1]) if (card.y - ground(card.x + Math.cos(a) * w * s, card.z - Math.sin(a) * w * s) > 0.05) hangs = true;
        }
        // (a vignette, an animal tied to a piece, sits up on its seat, and may sit by a door on a lane)
        const seat = card.vignette?.seat ?? 0;
        if (hangs && !seat && !SEA_CARDS.has(card.sprite)) add('floating', card.x, card.z, `${card.sprite} (end over lower ground)`);
        if (card.y - seat - ground(card.x, card.z) > 0.05 && !SEA_CARDS.has(card.sprite)) add('floating', card.x, card.z, `${card.sprite} (foot above ground)`);
        if (card.vignette) continue;
        if (roads.some((r) => onLine(r.pts, card.x, card.z, 0.25)) || lanes.some((l) => onLine(l, card.x, card.z, 0.18))) add('overlap', card.x, card.z, `${card.sprite} on a road`);
        if (!STREAM_CARDS.has(card.sprite) && streams.some((s) => onLine(s.pts, card.x, card.z, 0.3))) add('overlap', card.x, card.z, `${card.sprite} in a stream`);
      }
      for (const h of c.houses) {
        if (h.name !== 'pier' && h.name !== 'bridge') {
          // (every loaded building, standing or folded: the ends of its footprint's walls on the drawn land)
          const cs = Math.cos(h.yaw);
          const sn = Math.sin(h.yaw);
          const wet = h.foot.some(([ax, az, bx, bz]) => [[ax, az], [bx, bz]].some(([u, v]) => T.distanceAt(h.x + u * cs + v * sn, h.z - u * sn + v * cs) > 0));
          if (wet && !wetSeen.has(h)) { wetSeen.add(h); add('wet', h.x, h.z, `${h.name} with a corner in the sea`); }
        }
        if (!near(h.x, h.z, 8) || h.fold.progress < 0.9) continue;
        buildings++;
        if (h.name === 'pier' || h.name === 'bridge') continue;
        // (its bounds as it stands now, every vertex as its bones pose it: the model's own box spans it standing and
        // folded flat, for culling, world/models.ts, and folded it reaches out round its foot by its height)
        h.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(h.root, true);
        const foot = box.min.y;
        for (const [cx, cz] of [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.min.x, box.max.z], [box.max.x, box.max.z]]) {
          // a corner of the model's bounds over clearly lower ground
          if (foot - ground((cx + h.x) / 2, (cz + h.z) / 2) > 0.06) { add('floating', h.x, h.z, `${h.name} (corner over lower ground)`); break; }
        }
        for (const o of c.houses) {
          if (o === h || o.name === 'pier' || o.name === 'bridge' || o.fold.progress < 0.9) continue;
          if (Math.hypot(o.x - h.x, o.z - h.z) < 0.5) add('overlap', h.x, h.z, `${h.name} inside ${o.name}`);
        }
      }
    }

    // ---- bridges ----
    for (const r of roads) {
      for (const b of r.bridges) if (near(b.x, b.z, 7) && T.deckAt(b.x, b.z) === null) add('bridges', b.x, b.z, 'road crosses a stream with no bridge');
    }

    // ---- stuck: from a few points, blocked ahead is fine, blocked in every direction is not ----
    const dirs = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];
    for (let k = 0; k < 6; k++) {
      const a = rand() * 6.283;
      const sx = px + Math.cos(a) * 2.5;
      const sz = pz + Math.sin(a) * 2.5;
      // (only where he could be: the game never lets him stand inside a wall)
      if (T.distanceAt(sx, sz) > -0.6 || !g.canStand(sx, sz)) continue;
      W.x = sx;
      W.z = sz;
      step(2);
      // walk into whatever is ahead for a while
      const ahead = dirs[k % 4];
      key(ahead, true); step(90); key(ahead, false); step(10);
      let moved = false;
      for (const dk of dirs) {
        const x0 = W.x, z0 = W.z;
        key(dk, true); step(20); key(dk, false); step(5);
        if (Math.hypot(W.x - x0, W.z - z0) > 0.08) { moved = true; break; }
      }
      if (!moved) add('stuck', W.x, W.z, 'the captain cannot move in any direction');
    }

    // ---- roads: the captain walks along each road near here ----
    for (const r of roads.slice(0, 2)) {
      roadsChecked++;
      const pts = r.pts.filter(([x, z]) => near(x, z, 6));
      if (pts.length < 12) continue;
      W.x = pts[0][0];
      W.z = pts[0][1];
      step(2);
      for (let i = 0; i + 6 < pts.length; i += 6) {
        // steer toward the point six samples on (screen keys: x right, z down)
        const [tx, tz] = pts[i + 6];
        // walk toward it for as long as walking there takes (plus half again), re-aiming as he goes
        const frames = Math.ceil((Math.hypot(tx - W.x, tz - W.z) / 1.15) * 60 * 1.5) + 10;
        for (let f = 0; f < frames && Math.hypot(W.x - tx, W.z - tz) > 0.25; f += 5) {
          const ex = tx - W.x, ez = tz - W.z;
          const want: string[] = [];
          if (ex > 0.12) want.push('KeyD');
          if (ex < -0.12) want.push('KeyA');
          if (ez > 0.12) want.push('KeyS');
          if (ez < -0.12) want.push('KeyW');
          for (const k2 of dirs) key(k2, want.includes(k2));
          step(5);
        }
        for (const k2 of dirs) key(k2, false);
        if (Math.hypot(W.x - tx, W.z - tz) > 0.6) {
          const room = T.roomAt(W.x, W.z);
          add('roads', W.x, W.z, `held up on the way to ${tx.toFixed(1)}, ${tz.toFixed(1)} (room ${room.toFixed(2)}, deck ${T.deckAt(W.x, W.z) !== null}, bank ${P.streams.bankDistance(W.x, W.z).toFixed(2)})`);
          W.x = tx;
          W.z = tz;
          step(2);
        }
      }
    }
  }
  return { issues, places: places.length, cards, buildings, roads: roadsChecked };
}
