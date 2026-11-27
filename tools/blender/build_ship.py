"""
Builds a ship of the Paper Seas as a paper model and exports it to public/models/ship-<id>.glb.

    bash tools/ship/build-ships.sh            (all ships: exports the shapes, then builds each)
    SHIP_ID=galleon "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/build_ship.py

The shape comes from assets-src/models/ship-shape-<id>.json (sampled from src/ship/hull-shape.ts on the ship's
HullSpec), so the game's decks, masts and rigging stand exactly on this hull. The structure is built from the spec:

  hull         printed planking lofted from the keel to the rail, banded: planks below the wale, the painted wale
               strake along the gun deck, the upper works above; a stem post at the bow (or a junk's flat bow board),
               a raked transom at the stern, a keel and a rudder on its pintles
  bulwarks     the inside of the sides above each deck, a card thickness inboard, and a rail cap along the top
  decks        main deck, quarterdeck, poop and forecastle as solid planked slabs following the hull
  cabins       the great cabin under the quarterdeck: its front wall with a double door at the break, the captain's
               cabin under the poop with its row of windows; a forecastle front wall; balustrades along every break
  stern        the gallery of lit windows across the transom, a smaller row below, the carved crest above, quarter
               galleries (bay windows) on each side, the posts of her stern lanterns (one, two or three)
  bow          a beakhead with head rails and her own carved figurehead, a raider's iron ram at the waterline, a
               junk's painted eyes, catheads with their anchors
  guns         a printed gun port with a cannon run out of it, for every gun of every gun deck, both sides
  outboard     chainwales with deadeyes for the shrouds of every stayed mast
  fittings     companion ladders, capstan, hatch with its grating (both clear of the masts), guns on carriages, barrels,
               rope, binnacle
  helm         the ship's wheel where her spec stands it, on its own node (origin on the axle: the game turns it with
               the rudder)
  wreck        (a broken ship) rails torn through at a few breaches with splintered ends, weed hanging over the
               rails and slung along the side, holes torn in the upper works

Materials are named for the game (src/ship/ship-mesh.ts): tiling printed wood (lower, wale, upper, inner, deck) has
its UVs in world units; printed details (gallery, windows, cabin-door, gunport, scroll, crest, grating, her figurehead,
eye) span 0..1, cut to their texture's aspect and to its drawing (assets-src/models/ship-details.json, traced by
tools/ship/trace-details.mjs), a glued-on layer thick; the rest is plain coloured paper (rail, dark, wood, gold, iron,
rope, weed).
Game frame: y up, forward -z, starboard +x (converted to Blender's z-up on creation).
"""
import json
import math
import os
import random

import bpy
from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHIP_ID = os.environ.get("SHIP_ID", "galleon")
S = json.load(open(os.path.join(ROOT, "assets-src", "models", f"ship-shape-{SHIP_ID}.json")))
OUTLINES = json.load(open(os.path.join(ROOT, "assets-src", "models", "ship-details.json")))
OUT = os.path.join(ROOT, "public", "models", f"ship-{SHIP_ID}.glb")
SPEC = S["spec"]
L = S["length"]
ST = S["stations"]
NT = len(ST) - 1
THICK = 0.035  # bulwark thickness
DECK_THICK = 0.025
LAYER = 0.004  # a printed detail glued on
PORT_OPENING = (0.344, 0.418)  # the middle of the gun port print's opening (a across, b up), where its barrel runs out
WOOD_UV = 3.2  # texture repeats per world unit on the planking
DECK_UV = 3.0
BROKEN = bool(SPEC.get("broken"))
RNG = random.Random(7)
# A wreck, but a whole one: her rails run unbroken but for a few breaches, each torn clean through with splintered
# ends (gaps scattered at random all along read as a broken model, not a broken ship). (side, t0, t1)
BREACHES = [(1, 0.5, 0.58), (-1, 0.26, 0.31), (-1, 0.63, 0.67)] if BROKEN else []


def breached(side, t):
    return any(s == side and a <= t <= b for s, a, b in BREACHES)

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def V(x, y, z):
    return Vector((x, y, z))


def lerp(a, b, f):
    return a + (b - a) * f


def smooth(a, b, x):
    k = min(1.0, max(0.0, (x - a) / (b - a)))
    return k * k * (3 - 2 * k)


def z_of(t):
    return -(t - 0.5) * L


def at(field, t):
    f = min(max(t, 0.0), 1.0) * NT
    i = min(NT - 1, int(f))
    return lerp(ST[i][field], ST[i + 1][field], f - i)


def sheer(t):
    return at("sheer", t)


def deck_y(t):
    return at("deck", t)


TOP = max(s["sheer"] for s in ST)
RAKE = 0.07  # the transom leans aft toward the top


def rake(t, y):
    """How far aft the stern stands at height y (the transom rakes back over the counter)."""
    return RAKE * max(0.0, y) / TOP * (1 - smooth(0.0, 0.12, t))


def half_beam(t, y):
    """Half beam of the hull at t, y (interpolated from the exported rows of the two nearest stations)."""
    f = min(max(t, 0.0), 1.0) * NT
    i = min(NT - 1, int(f))
    out = []
    for s in (ST[i], ST[i + 1]):
        rows = s["rows"]
        if y <= rows[0]["y"]:
            out.append(rows[0]["halfBeam"])
            continue
        hb = rows[-1]["halfBeam"]
        for a, b in zip(rows, rows[1:]):
            if y <= b["y"]:
                hb = lerp(a["halfBeam"], b["halfBeam"], (y - a["y"]) / max(1e-9, b["y"] - a["y"]))
                break
        out.append(hb)
    return lerp(out[0], out[1], f - i)


def hull_pt(side, t, y, inset=0.0):
    return V(side * max(0.004, half_beam(t, y) - inset), y, z_of(t) + rake(t, y))


def on_side(side, t, y):
    """A point on the side at t, y and the frame of the planking there: along it (the way a card laid on it reads, aft
    to forward seen from outboard), up it (leaning in with the tumblehome) and out of it. A flat card laid in this frame
    sits on the planking instead of sinking into it."""
    on = hull_pt(side, t, y)
    up = (hull_pt(side, t, y + 0.02) - hull_pt(side, t, y - 0.02)).normalized()
    right = (hull_pt(side, t + 0.01, y) - hull_pt(side, t - 0.01, y)).normalized() * side
    return on, right, up, right.cross(up).normalized()


# ------------------------------------------------------------------------------------------------------------------
# meshes

class Mesh:
    def __init__(self):
        self.verts, self.faces, self.uvs = [], [], []

    def poly(self, pts, uvs=None):
        base = len(self.verts)
        self.verts += pts
        self.faces.append(list(range(base, base + len(pts))))
        self.uvs.append(uvs or [(0.5, 0.5)] * len(pts))


PARTS = {}


def part(name):
    if name not in PARTS:
        PARTS[name] = Mesh()
    return PARTS[name]


def wood_uv(pts, along="z"):
    """World-unit UVs for tiling planks: u along the hull, v up (or across, for decks)."""
    return [((-p.z if along == "z" else p.x) * WOOD_UV, p.y * WOOD_UV) for p in pts]


ASPECTS = {}


def aspect(name):
    """Width over height of a printed detail (its cut texture in public/models/tex)."""
    if name not in ASPECTS:
        w, h = bpy.data.images.load(os.path.join(ROOT, "public", "models", "tex", f"{name}.png")).size
        ASPECTS[name] = w / h
    return ASPECTS[name]


def detail(mat, centre, right, up, w, h, out, depth=LAYER):
    """
    A printed detail (UV 0..1) centred at `centre`, spanning w along `right` and h along `up`, seen from `out` and depth
    thick behind it, glued on what lies there: cut to its drawing's traced outline, with its cut edge round it.
    """
    r = right.normalized() * (w / 2)
    u = up.normalized() * (h / 2)

    def P(a, b):
        return centre + r * (2 * a - 1) + u * (2 * b - 1)

    loops = [loop for o in OUTLINES[mat] for loop in (o["outer"], *o["holes"])]
    # (outer loops run counter-clockwise in the print, holes clockwise: reversed where the print faces away from out)
    if (P(1, 0) - P(0, 0)).cross(P(0, 1) - P(0, 0)).dot(out) < 0:
        loops = [loop[::-1] for loop in loops]
    ab = [tuple(p) for loop in loops for p in loop]
    front = [P(a, b) for a, b in ab]
    back = [p - out.normalized() * depth for p in front]
    m = part(mat)
    for t in tessellate_polygon([[Vector((a, b, 0)) for a, b in loop] for loop in loops]):
        tri = list(t)
        n = (front[tri[1]] - front[tri[0]]).cross(front[tri[2]] - front[tri[0]])
        if n.dot(out) < 0:
            tri.reverse()
        m.poly([front[i] for i in tri], [ab[i] for i in tri])
        m.poly([back[i] for i in reversed(tri)], [ab[i] for i in reversed(tri)])
    # the cut edge, coloured through (the outline runs just inside the print)
    start = 0
    for loop in loops:
        k = len(loop)
        for i in range(k):
            p, q = start + i, start + (i + 1) % k
            m.poly([front[q], front[p], back[p], back[q]], [ab[q], ab[p], ab[p], ab[q]])
        start += k


def box(mat, c, size, rot=None):
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    p = [V(-hx, -hy, -hz), V(hx, -hy, -hz), V(hx, hy, -hz), V(-hx, hy, -hz), V(-hx, -hy, hz), V(hx, -hy, hz), V(hx, hy, hz), V(-hx, hy, hz)]
    m = Matrix.Translation(c) @ (rot.to_4x4() if rot is not None else Matrix.Identity(4))
    p = [(m @ v.to_4d()).to_3d() for v in p]
    for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]:
        part(mat).poly([p[i] for i in f])


def lathe(mat, base, axis, profile, seg=12):
    axis = axis.normalized()
    ref = V(1, 0, 0) if abs(axis.x) < 0.9 else V(0, 1, 0)
    e1 = axis.cross(ref).normalized()
    e2 = axis.cross(e1)
    ring = lambda r, h, k: base + axis * h + (e1 * math.cos(2 * math.pi * k / seg) + e2 * math.sin(2 * math.pi * k / seg)) * r
    m = part(mat)
    for (r0, h0), (r1, h1) in zip(profile, profile[1:]):
        for k in range(seg):
            m.poly([ring(r0, h0, k), ring(r0, h0, k + 1), ring(r1, h1, k + 1), ring(r1, h1, k)])
    r0, h0 = profile[0]
    r1, h1 = profile[-1]
    if r0 > 1e-4:
        m.poly([ring(r0, h0, k) for k in reversed(range(seg))])
    if r1 > 1e-4:
        m.poly([ring(r1, h1, k) for k in range(seg)])


def cylinder(mat, p0, p1, r0, r1, seg=10):
    d = p1 - p0
    lathe(mat, p0, d, [(r0, 0), (r1, d.length)], seg)


def torus(mat, centre, axis, R, r, seg=24, sides=6):
    axis = axis.normalized()
    ref = V(1, 0, 0) if abs(axis.x) < 0.9 else V(0, 1, 0)
    e1 = axis.cross(ref).normalized()
    e2 = axis.cross(e1)

    def p(i, j):
        a = 2 * math.pi * i / seg
        b = 2 * math.pi * j / sides
        radial = e1 * math.cos(a) + e2 * math.sin(a)
        return centre + radial * (R + r * math.cos(b)) + axis * (r * math.sin(b))

    for i in range(seg):
        for j in range(sides):
            part(mat).poly([p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1)])


def ribbon(mat, pts, width, thick):
    """A square-section rail along a polyline (cap rails, head rails, mouldings)."""
    for a, b in zip(pts, pts[1:]):
        d = b - a
        if d.length < 1e-6:
            continue
        mid = (a + b) / 2
        yaw = math.atan2(d.x, d.z)
        pitch = -math.atan2(d.y, math.hypot(d.x, d.z))
        rot = Matrix.Rotation(yaw, 3, "Y") @ Matrix.Rotation(pitch, 3, "X")
        box(mat, mid, (width, thick, d.length + width * 0.5), rot)


def baluster(mat, base, h):
    prof = [(0.007, 0), (0.0045, h * 0.15), (0.0085, h * 0.4), (0.005, h * 0.7), (0.0045, h * 0.85), (0.0075, h * 0.93), (0.0075, h)]
    lathe(mat, base, V(0, 1, 0), prof, 6)


# ------------------------------------------------------------------------------------------------------------------
# hull

def band(y):
    w0, w1 = SPEC["wale"]
    return "lower" if y < w0 - 1e-4 else ("wale" if y < w1 - 1e-4 else "upper")


def hull():
    nrow = len(ST[0]["rows"])
    for side in (1, -1):
        for i in range(NT):
            a, b = ST[i], ST[i + 1]
            for j in range(nrow - 1):
                ya0, ya1 = a["rows"][j]["y"], a["rows"][j + 1]["y"]
                yb0, yb1 = b["rows"][j]["y"], b["rows"][j + 1]["y"]
                p = [hull_pt(side, a["t"], ya0), hull_pt(side, b["t"], yb0), hull_pt(side, b["t"], yb1), hull_pt(side, a["t"], ya1)]
                if side < 0:
                    p = [p[1], p[0], p[3], p[2]]
                part(band((ya0 + ya1) / 2)).poly(p, wood_uv(p))
    # transom: across the stern at t = 0, raked aft
    s0 = ST[0]
    rows = s0["rows"]
    for j in range(len(rows) - 1):
        y0, y1 = rows[j]["y"], rows[j + 1]["y"]
        p = [hull_pt(1, 0, y0), hull_pt(-1, 0, y0), hull_pt(-1, 0, y1), hull_pt(1, 0, y1)]
        part(band((y0 + y1) / 2)).poly(p, [(q.x * WOOD_UV, q.y * WOOD_UV) for q in p])
    # bow: a flat bow board for a junk, a stem post for a stemmed ship
    s1 = ST[-1]
    if SPEC["bowWidth"] > 0.05:
        r1 = s1["rows"]
        for j in range(len(r1) - 1):
            y0, y1 = r1[j]["y"], r1[j + 1]["y"]
            p = [hull_pt(-1, 1, y0), hull_pt(1, 1, y0), hull_pt(1, 1, y1), hull_pt(-1, 1, y1)]
            part(band((y0 + y1) / 2)).poly(p, [(q.x * WOOD_UV, q.y * WOOD_UV) for q in p])
    else:
        pts = []
        for k in range(12):
            y = lerp(-SPEC["draft"], s1["sheer"] + 0.05, k / 11)
            t = 1 - 0.03 * (1 - k / 11) ** 2
            pts.append(V(0, y, z_of(t) - 0.012))
        ribbon("dark", pts, 0.03, 0.03)
    # keel along the bottom, and the rudder on the sternpost
    ribbon("dark", [V(0, -SPEC["draft"] + 0.01, z_of(t)) for t in (0.0, 0.5, 0.97)], 0.03, 0.03)
    zr = z_of(0) + 0.025
    ytop = SPEC["wale"][1] + 0.02
    box("dark", V(0, (ytop - SPEC["draft"]) / 2, zr + 0.04), (0.025, ytop + SPEC["draft"], 0.09))
    for y in (ytop - 0.06, 0.05, -0.08):
        box("iron", V(0, y, zr + 0.005), (0.04, 0.012, 0.03))
    # bottom closed under the keel line (the hull heels: never hollow)
    for i in range(NT):
        a, b = ST[i], ST[i + 1]
        y = a["rows"][0]["y"]
        p = [hull_pt(-1, a["t"], y), hull_pt(-1, b["t"], y), hull_pt(1, b["t"], y), hull_pt(1, a["t"], y)]
        part("dark").poly(p)


def bulwarks():
    """Inside face of the sides above each deck, and the rail cap along the top."""
    n = 5
    for side in (1, -1):
        for i in range(NT):
            a, b = ST[i], ST[i + 1]
            for k in range(n):
                q = []
                for s in (a, b):
                    y0 = s["deck"] - 0.02
                    q.append([hull_pt(side, s["t"], lerp(y0, s["sheer"], k / n), THICK), hull_pt(side, s["t"], lerp(y0, s["sheer"], (k + 1) / n), THICK)])
                p = [q[0][0], q[1][0], q[1][1], q[0][1]]
                if side > 0:
                    p = [p[1], p[0], p[3], p[2]]
                part("inner").poly(p, wood_uv(p))
        # the rail cap (torn through at a wreck's breaches, with splintered ends)
        for i in range(0, NT, 2):
            ta, tb = ST[i]["t"], ST[min(NT, i + 2)]["t"]
            pa = hull_pt(side, ta, sheer(ta), THICK / 2) + V(0, 0.006, 0)
            pb = hull_pt(side, tb, sheer(tb), THICK / 2) + V(0, 0.006, 0)
            if breached(side, ta) or breached(side, tb):
                continue
            ribbon("rail", [pa, pb], THICK + 0.014, 0.014)
        for s, t0, t1 in BREACHES:
            if s == side:
                splinters(side, t0, -1)
                splinters(side, t1, 1)
    # across the transom top
    yt = sheer(0)
    ribbon("rail", [hull_pt(1, 0, yt, THICK / 2) + V(0, 0.006, 0), hull_pt(-1, 0, yt, THICK / 2) + V(0, 0.006, 0)], THICK + 0.014, 0.014)
    # the inside of the transom bulwark
    y0 = deck_y(0) - 0.02
    p = [hull_pt(-1, 0.004, y0, THICK), hull_pt(1, 0.004, y0, THICK), hull_pt(1, 0.004, yt, THICK), hull_pt(-1, 0.004, yt, THICK)]
    for q in p:
        q.z -= THICK
    part("inner").poly(p, [(q.x * WOOD_UV, q.y * WOOD_UV) for q in p])


def splinters(side, t, away):
    """The torn end of the rail cap at a breach (t), the splinters pointing into the gap (away: -1 toward the stern)."""
    base = hull_pt(side, t, sheer(t), THICK / 2) + V(0, 0.006, 0)
    for k, (length, tilt, off) in enumerate(((0.05, 0.25, -0.008), (0.034, -0.35, 0.006), (0.022, 0.6, 0.0))):
        d = V(0, math.sin(tilt) * 0.5, -away * math.cos(tilt)).normalized()
        a = base + V(side * off, 0, 0)
        ribbon("rail", [a, a + d * length], 0.012 - k * 0.002, 0.008)


def weed_strand(side, t, top, length, width, sway, phase):
    """One strand of weed hanging down the side from (t, top): it tapers, and waves a little along the hull."""
    n = 9
    pts = []
    for s in range(n + 1):
        u = s / n
        tt = t + (sway * u + 0.012 * math.sin(phase + u * 7.0) * u) / L
        pts.append(hull_pt(side, tt, top - length * u) + V(side * (0.006 + 0.004 * u), 0, 0))
    for s, (a, b) in enumerate(zip(pts, pts[1:])):
        ribbon("weed", [a, b], width * (1 - 0.7 * s / n), 0.003)


def wreck():
    """What the sea left on her: weed hanging over the rails in clumps and slung in loops along the side, and a few
    holes torn in the upper works (as on her picture in the shipyard)."""
    rng = random.Random(11)
    w0, w1 = SPEC["wale"]
    for side in (1, -1):
        # clumps of two or three strands hanging from the rail
        for k in range(11):
            t = 0.07 + 0.86 * (k + rng.random() * 0.5) / 11
            if breached(side, t):
                continue
            for j in range(2 + int(rng.random() * 2)):
                weed_strand(side, t + (j - 1) * 0.006, sheer(t) + 0.004, 0.05 + rng.random() * 0.17, 0.009 + rng.random() * 0.005, (rng.random() - 0.5) * 0.03, rng.random() * 6.3)
        # loops slung along the upper works
        for k in range(5):
            t0 = 0.12 + 0.75 * k / 5 + rng.random() * 0.03
            t1 = t0 + 0.07 + rng.random() * 0.05
            y0 = sheer(t0) - 0.03
            y1 = sheer(t1) - 0.03
            pts = [hull_pt(side, lerp(t0, t1, u / 10), lerp(y0, y1, u / 10) - 0.045 * math.sin(math.pi * u / 10)) + V(side * 0.006, 0, 0) for u in range(11)]
            ribbon("weed", pts, 0.008, 0.003)
    # holes torn in the upper works, clear of the gun ports and the chains: a ragged tear of dark paper with the pale
    # splintered wood round it, proud of the hull
    for side, t, r in ((1, 0.21, 0.05), (1, 0.69, 0.04), (-1, 0.25, 0.052)):
        on, right, up, normal = on_side(side, t, w1 + 0.065)
        jag = [(0.6 + 0.4 * rng.random()) * (1.0 if k % 2 == 0 else 0.6) for k in range(13)]
        for mat, scale, lift in (("rail", 1.25, 0.005), ("dark", 1.0, 0.007)):
            centre = on + normal * lift
            pts = []
            for k in range(13):
                a = 2 * math.pi * k / 13
                rr = r * scale * jag[k]
                pts.append(centre + right * (math.cos(a) * rr * 1.3) + up * (math.sin(a) * rr))
            part(mat).poly(pts)

def mouldings():
    """Rub rails standing proud of the hull: along both edges of the wale, under the rail, and a gilded one along the
    castles; and open balustrades on top of the castle bulwarks (the castles rise in tiers of carved rail)."""
    w0, w1 = SPEC["wale"]
    for side in (1, -1):
        for y, mat, size in ((w0, "dark", 0.02), (w1, "dark", 0.022), (SPEC["main"] - 0.01, "rail", 0.016)):
            pts = [hull_pt(side, t, y) + V(side * size * 0.35, 0, 0) for t in [k / 48 for k in range(1, 48)]]
            ribbon(mat, pts, size, size)
        # a gilded moulding just under the rail, stepping with it
        pts = [hull_pt(side, t, sheer(t) - 0.035) + V(side * 0.006, 0, 0) for t in [k / 64 for k in range(1, 64)]]
        ribbon("rail", pts, 0.014, 0.014)
        # balustrades along the castle tops
        for (t0, t1) in castle_spans():
            n = max(2, int((t1 - t0) * L / 0.055))
            tops = []
            run = []
            for k in range(n + 1):
                t = lerp(t0, t1, k / n)
                p = hull_pt(side, t, sheer(t), THICK / 2) + V(0, 0.013, 0)
                if breached(side, t):
                    # the top rail torn through here: what stands is a run either side
                    if len(run) > 1:
                        ribbon("rail", run, 0.022, 0.014)
                    run = []
                    continue
                run.append(p + V(0, 0.085, 0))
                baluster("wood", p, 0.085)
            if len(run) > 1:
                ribbon("rail", run, 0.022, 0.014)
    # across the stern
    n = 9
    tops = []
    for k in range(n + 1):
        x = lerp(-1, 1, k / n) * (half_beam(0, sheer(0)) - THICK / 2)
        p = V(x, sheer(0) + 0.013, z_of(0) + rake(0, sheer(0)) - THICK / 2)
        baluster("wood", p, 0.085)
        tops.append(p + V(0, 0.085, 0))
    ribbon("rail", tops, 0.022, 0.014)


def castle_spans():
    out = []
    aft = SPEC.get("poop") or SPEC.get("quarter")
    if aft:
        out.append((0.006, aft["end"] - 0.02))
    if SPEC.get("forecastle"):
        out.append((SPEC["forecastle"]["start"] + 0.03, 0.985))
    return out


def decks():
    for d in S["decks"]:
        t0, t1, y = d["t0"], d["t1"], d["y"]
        n = max(4, int((t1 - t0) * 60))
        ts = [lerp(t0 + 0.002, t1 - 0.002, k / n) for k in range(n + 1)]
        edge = lambda t: max(0.0, half_beam(t, y) - THICK * 0.9)
        for a, b in zip(ts, ts[1:]):
            ha, hb = edge(a), edge(b)
            za, zb = z_of(a) + rake(a, y), z_of(b) + rake(b, y)
            p = [V(-ha, y, za), V(ha, y, za), V(hb, y, zb), V(-hb, y, zb)]
            part("deck").poly(p, [(q.x * DECK_UV, -q.z * DECK_UV) for q in p])
            # the underside (seen through the waist from the main deck, and where a deck overhangs a break)
            part("dark").poly([V(-ha, y - DECK_THICK, za), V(-hb, y - DECK_THICK, zb), V(hb, y - DECK_THICK, zb), V(ha, y - DECK_THICK, za)])


def break_wall(t, y_low, y_high, facing, kind):
    """A wall across the ship at a deck break (cabin fronts), facing forward (-1) or aft (+1), with its printed door
    or windows in the middle and planking either side; a balustrade along the top edge."""
    z = z_of(t) + facing * 0.002
    hb = half_beam(t, y_high) - THICK
    h = y_high - y_low
    # planking across the whole wall
    p = [V(-hb, y_low, z), V(hb, y_low, z), V(hb, y_high, z), V(-hb, y_high, z)]
    if facing > 0:
        p = [p[1], p[0], p[3], p[2]]
    part("upper").poly(p, [(q.x * WOOD_UV, q.y * WOOD_UV) for q in p])
    if kind:
        aspect = {"cabin-door": 1.32, "windows": 1.9}[kind]
        w = min(hb * 1.7, h * 0.92 * aspect)
        hh = w / aspect
        detail(kind, V(0, y_low + h * 0.47, z + facing * 0.003), V(-facing, 0, 0), V(0, 1, 0), w, hh, V(0, 0, facing))
    # a moulding along the top edge and a balustrade standing on it
    ribbon("rail", [V(-hb, y_high - 0.004, z + facing * 0.008), V(hb, y_high - 0.004, z + facing * 0.008)], 0.02, 0.012)
    x = -hb + 0.04
    k = 0
    while x < hb - 0.03:
        # a wreck has lost one baluster of each balustrade (the second from the port end)
        if not (BROKEN and k == 1):
            baluster("wood", V(x, y_high, z - facing * 0.01), 0.1)
        x += 0.055
        k += 1
    ribbon("rail", [V(-hb, y_high + 0.1, z - facing * 0.01), V(hb, y_high + 0.1, z - facing * 0.01)], 0.022, 0.014)


def cabins():
    q, p, f = SPEC.get("quarter"), SPEC.get("poop"), SPEC.get("forecastle")
    if q:
        break_wall(q["end"], SPEC["main"], q["height"], -1, "cabin-door")
    if p:
        break_wall(p["end"], q["height"] if q else SPEC["main"], p["height"], -1, "windows")
    if f:
        break_wall(f["start"], SPEC["main"], f["height"], 1, "cabin-door" if f["height"] - SPEC["main"] > 0.11 else None)


def stern():
    top = sheer(0)
    q, p = SPEC.get("quarter"), SPEC.get("poop")
    y_main = SPEC["main"]
    y_q = q["height"] if q else y_main + 0.12
    y_p = p["height"] if p else None

    def on_transom(y):
        return V(0, y, z_of(0) + rake(0, y) + 0.004)

    hb = half_beam(0, y_q)
    nrm = V(0, 0, 1)
    if y_p is not None:
        # the captain's gallery across the poop, the great cabin's windows below it
        h = (y_p - y_q) * 0.9
        detail("gallery", on_transom(y_q + (y_p - y_q) * 0.5), V(1, 0, 0), V(0, 1, 0.0), min(hb * 1.7, h * 1.3), h, nrm)
        h2 = (y_q - y_main) * 0.8
        detail("windows", on_transom(y_main + (y_q - y_main) * 0.5), V(1, 0, 0), V(0, 1, 0), min(hb * 1.5, h2 * 1.9), h2, nrm)
        crest_y = y_p + (top - y_p) * 0.45
    else:
        h = (y_q - y_main) * 0.9
        detail("gallery", on_transom(y_main + (y_q - y_main) * 0.5), V(1, 0, 0), V(0, 1, 0), min(hb * 1.7, h * 1.3), h, nrm)
        crest_y = y_q + (top - y_q) * 0.45
    ch = max(0.06, (top - crest_y) * 1.4)
    detail("crest", on_transom(crest_y + ch * 0.15), V(1, 0, 0), V(0, 1, 0), ch * 1.55, ch, nrm)
    # a carved band across the transom under the windows
    detail("scroll", on_transom(y_main - 0.035), V(1, 0, 0), V(0, 1, 0), hb * 1.6, 0.05, nrm)
    # stern lantern posts (the lanterns themselves are cards in the game, hung beside the post heads)
    zl = z_of(0) + rake(0, top) + 0.04
    for spot in S["lanterns"]:
        x = spot["x"]
        cylinder("gold", V(x, top, zl), V(x, top + 0.12 + spot["lift"], zl), 0.008, 0.006, 6)

    if not SPEC["galleries"]:
        return
    # quarter galleries: a bay of windows on each side over the quarters
    y0 = y_q - 0.05
    y1 = (y_p if y_p is not None else top) - 0.02
    for side in (1, -1):
        ta, tb = 0.03, 0.15
        out = 0.06
        corners = []
        for t in (ta, tb):
            for y in (y0, y1):
                corners.append(hull_pt(side, t, y))
        a0, a1, b0, b1 = corners
        oa0, oa1 = a0 + V(side * out, 0, 0), a1 + V(side * out, 0, 0)
        ob0, ob1 = b0 + V(side * out, 0, 0), b1 + V(side * out, 0, 0)
        # the windows face outboard
        face = [oa0, ob0, ob1, oa1] if side > 0 else [ob0, oa0, oa1, ob1]
        part("windows").poly(face, [(0, 0), (1, 0), (1, 1), (0, 1)])
        # ends and a gilded roof, a tapered drop below
        for pts in ([a0, oa0, oa1, a1], [ob0, b0, b1, ob1]):
            part("dark").poly(pts if side > 0 else list(reversed(pts)))
        roof_top = (a1 + b1) / 2 + V(side * 0.01, 0.06, 0)
        for pts in ([oa1, ob1, roof_top], [a1, oa1, roof_top], [ob1, b1, roof_top]):
            part("gold").poly(pts if side > 0 else list(reversed(pts)))
        drop = (a0 + b0) / 2 + V(side * 0.015, -0.09, 0)
        for pts in ([ob0, oa0, drop], [oa0, a0, drop], [b0, ob0, drop]):
            part("dark").poly(pts if side > 0 else list(reversed(pts)))


def bow():
    s1 = ST[-1]
    top = s1["sheer"]
    if SPEC.get("ram"):
        ram()
    if SPEC.get("eyes"):
        eyes()
    if SPEC["beakhead"]:
        # the beak stands off the forecastle (or the main deck); over a ram it is raised to the rail, clear of it
        y = top - 0.1 if SPEC.get("ram") else (SPEC.get("forecastle") or {"height": SPEC["main"]})["height"] - 0.06
        z0 = z_of(1)
        tip = V(0, y + 0.02, z0 - 0.3)
        # the beakhead platform, a gilded rail sweeping from each bow down to the figurehead
        part("deck").poly([V(-0.1, y, z0 + 0.06), V(0.1, y, z0 + 0.06), tip], [(0, 0), (1, 0), (0.5, 1)])
        part("dark").poly([tip, V(0.1, y - 0.02, z0 + 0.06), V(-0.1, y - 0.02, z0 + 0.06)])
        for side in (1, -1):
            pts = []
            for k in range(8):
                f = k / 7
                pts.append(V(side * lerp(half_beam(0.97, top - 0.05) * 0.9, 0.01, f), lerp(top - 0.03, y + 0.04, f ** 0.8), lerp(z_of(0.97), tip.z + 0.02, f)))
            ribbon("gold", pts, 0.014, 0.014)
            pts2 = [p + V(0, -0.07, 0.01) for p in pts[:6]]
            ribbon("gold", pts2, 0.012, 0.012)
        # her figurehead under the tip, leaning forward, printed on both faces: two prints back to back, each as
        # thick as it stands off the stem's middle
        fh = 0.26
        off = 0.003
        c = tip + V(0, -fh * 0.42, 0.03)
        up = V(0, 1, -0.35)
        for flip in (False, True):
            side = V(1 if flip else -1, 0, 0)
            detail(SPEC["figurehead"], c + side * off, V(0, 0, -1) if not flip else V(0, 0, 1), up, fh * aspect(SPEC["figurehead"]), fh, side, depth=off)
    # catheads with their anchors
    t = 0.88
    yc = sheer(t) - 0.03
    for side in (1, -1):
        hb = half_beam(t, yc)
        box("dark", V(side * (hb + 0.05), yc, z_of(t)), (0.12, 0.03, 0.03))
        x = side * (hb + 0.07)
        top_a = yc - 0.03
        shank = 0.22
        cylinder("iron", V(x, top_a - shank, z_of(t)), V(x, top_a, z_of(t)), 0.008, 0.006, 8)
        cylinder("iron", V(x, top_a - 0.012, z_of(t) - 0.065), V(x, top_a - 0.012, z_of(t) + 0.065), 0.006, 0.006, 6)
        torus("iron", V(x, top_a + 0.012, z_of(t)), V(1, 0, 0), 0.013, 0.004, 12, 4)
        for s2 in (1, -1):
            a0 = V(x, top_a - shank, z_of(t))
            a1 = a0 + V(0, 0.065, s2 * 0.065)
            cylinder("iron", a0, a1, 0.008, 0.007, 6)


def ram():
    """A raider's ram: an iron-shod beak jutting forward from the stem at the waterline, a gilded collar round its
    root."""
    z0 = z_of(0.99)
    tip = V(0, 0.015, z_of(1) - 0.34)
    y0, y1, hw = -0.04, 0.1, 0.045
    root = [V(-hw, y0, z0), V(hw, y0, z0), V(hw, y1, z0), V(-hw, y1, z0)]
    for a, b in zip(root, root[1:] + root[:1]):
        part("iron").poly([b, a, tip])
    box("gold", V(0, (y0 + y1) / 2, z0 - 0.02), (hw * 2 + 0.02, y1 - y0 + 0.02, 0.025))
    # a band of iron straps round the beak
    for f in (0.35, 0.65):
        box("dark", V(0, lerp((y0 + y1) / 2, tip.y, f), lerp(z0, tip.z, f)), (hw * 2 * (1 - f) + 0.008, (y1 - y0) * (1 - f) + 0.008, 0.012))


def eyes():
    """A junk's painted eyes, one on each bow, looking ahead."""
    t = 0.92
    y = (SPEC["wale"][1] + sheer(t)) / 2
    size = min(0.22, (sheer(t) - SPEC["wale"][1]) * 0.85)
    for side in (1, -1):
        on, right, up, normal = on_side(side, t, y)
        detail("eye", on + normal * 0.004, right, up, size * aspect("eye"), size, normal)


def guns():
    for row in SPEC["guns"]:
        n = row["count"]
        for k in range(n):
            t = lerp(row["t0"], row["t1"], k / max(1, n - 1))
            y = row["y"]
            for side in (1, -1):
                p = hull_pt(side, t, y)
                # the side's direction along the hull and its outward normal here
                pa, pb = hull_pt(side, t - 0.01, y), hull_pt(side, t + 0.01, y)
                along = (pb - pa).normalized()
                up = (hull_pt(side, t, y + 0.02) - hull_pt(side, t, y - 0.02)).normalized()
                normal = along.cross(up).normalized() * side * -1
                if normal.x * side < 0:
                    normal = -normal
                size = 0.125
                right = along * (-side)
                detail("gunport", p + normal * 0.004, right, up, size, size, normal)
                # the barrel run out through the middle of its opening, its muzzle a ring round a bore
                prof = [(0.017, 0), (0.017, 0.012), (0.013, 0.02), (0.011, 0.08), (0.0135, 0.086), (0.0135, 0.1), (0.008, 0.102), (0.007, 0.07)]
                mouth = p + right * ((PORT_OPENING[0] - 0.5) * size) + up * ((PORT_OPENING[1] - 0.5) * size)
                lathe("iron", mouth - normal * 0.03, normal, prof, 10)


def chainwales():
    """For every stayed mast (a junk's stand unstayed): the chainwale on each side, its deadeyes and chains."""
    drop, out = 0.11, 0.07
    for m in S["masts"]:
        if m["rig"] == "battened":
            continue
        t = m["t"]
        y = sheer(t) - drop
        for side in (1, -1):
            ta, tb = t - 0.1, t + 0.05
            pts0, pts1 = [], []
            for k in range(7):
                tt = lerp(ta, tb, k / 6)
                p = hull_pt(side, tt, y)
                pts0.append(p)
                pts1.append(p + V(side * out, 0, 0))
            for k in range(6):
                a, b, c, d = pts0[k], pts0[k + 1], pts1[k + 1], pts1[k]
                top = [a + V(0, 0.012, 0), b + V(0, 0.012, 0), c + V(0, 0.012, 0), d + V(0, 0.012, 0)]
                part("dark").poly(top if side < 0 else list(reversed(top)))
                part("dark").poly([d, c, c + V(0, 0.012, 0), d + V(0, 0.012, 0)] if side > 0 else [c, d, d + V(0, 0.012, 0), c + V(0, 0.012, 0)])
            for dt in (-0.07, -0.025, 0.02):
                p = hull_pt(side, t + dt, y) + V(side * (out - 0.012), 0, 0)
                cylinder("dark", p + V(0, 0.012, 0), p + V(0, 0.045, 0), 0.011, 0.011, 8)
                cylinder("iron", p + V(0, -0.06, 0), p + V(0, 0.012, 0), 0.004, 0.004, 5)


def clear_of_masts(lo, hi):
    """The spot between lo and hi (t) farthest from every mast."""
    ts = [lerp(lo, hi, k / 40) for k in range(41)]
    return max(ts, key=lambda t: min(abs(t - m["t"]) for m in S["masts"]))


def fittings():
    main = SPEC["main"]
    q = SPEC.get("quarter")
    f = SPEC.get("forecastle")
    q_end = q["end"] if q else 0.26
    f_start = f["start"] if f else 1.0
    # companion ladders up to the quarterdeck, both sides
    if q:
        rise = q["height"] - main
        zf = z_of(q["end"])
        run, width, steps = 0.3, 0.13, 5
        for side in (1, -1):
            x = side * (half_beam(q["end"], main) - THICK - width / 2 - 0.03)
            for k in range(steps):
                fr = (k + 1) / steps
                box("wood", V(x, main + rise * fr - 0.007, zf - run + (k + 0.5) * run / steps), (width, 0.014, run / steps + 0.01))
            ang = math.atan2(rise, run)
            for s2 in (1, -1):
                box("dark", V(x + s2 * width / 2, main + rise / 2, zf - run / 2), (0.014, 0.045, math.hypot(run, rise)), Matrix.Rotation(-ang, 3, "X"))
    # forecastle ladder (one, to port)
    if f:
        rise = f["height"] - main
        zf = z_of(f["start"])
        x = -0.12
        for k in range(4):
            box("wood", V(x, main + rise * (k + 1) / 4 - 0.007, zf + 0.22 - (k + 0.5) * 0.055), (0.12, 0.014, 0.065))
    # the capstan just forward of the quarterdeck and the main hatch with its grating forward of it, in the waist (where
    # the beam is still full), both clear of the masts
    tc = clear_of_masts(q_end + 0.04, q_end + 0.14)
    tm = clear_of_masts(tc + 0.1, max(tc + 0.1, min(f_start - 0.1, SPEC["plan"]["fore"] + 0.12)))
    hz = z_of(tm)
    for (sx, sz, ox, oz) in ((0.32, 0.025, 0, 0.15), (0.32, 0.025, 0, -0.15), (0.025, 0.32, 0.16, 0), (0.025, 0.32, -0.16, 0)):
        box("dark", V(ox, main + 0.016, hz + oz), (sx, 0.032, sz))
    detail("grating", V(0, main + 0.03, hz), V(1, 0, 0), V(0, 0, -1), 0.29, 0.28, V(0, 1, 0))
    cx, cz = 0.0, z_of(tc)
    lathe("dark", V(cx, main, cz), V(0, 1, 0), [(0.06, 0), (0.06, 0.012), (0.042, 0.02), (0.036, 0.07), (0.042, 0.09), (0.05, 0.1), (0.05, 0.125), (0.0, 0.13)], 14)
    for k in range(4):
        box("wood", V(cx, main + 0.112, cz), (0.24, 0.012, 0.014), Matrix.Rotation(k * math.pi / 4, 3, "Y"))
    # two guns on their carriages in the waist each side
    for t in (0.47, 0.56):
        z = z_of(t)
        hb = half_beam(t, main) - THICK
        for side in (1, -1):
            x = side * (hb - 0.075)
            box("dark", V(x, main + 0.03, z), (0.1, 0.04, 0.075))
            for dx in (-0.03, 0.03):
                for dz in (-0.044, 0.044):
                    cylinder("wood", V(x + dx, main + 0.02, z + dz - 0.006), V(x + dx, main + 0.02, z + dz + 0.006), 0.02, 0.02, 10)
            lathe("iron", V(x - side * 0.05, main + 0.07, z), V(side, 0, 0), [(0.024, 0), (0.024, 0.02), (0.019, 0.03), (0.016, 0.12), (0.019, 0.13), (0.019, 0.15), (0.011, 0.152)], 12)
    # barrels and a coil of rope under the forecastle (just forward of the hatch on a flush-decked ship)
    ty = f_start - 0.04 if f else tm + 0.11
    for (bx, dt) in ((0.12, 0.0), (0.05, 0.015), (0.1, 0.035)):
        bz = z_of(ty - dt)
        lathe("wood", V(bx, main, bz), V(0, 1, 0), [(0.032, 0), (0.038, 0.02), (0.041, 0.045), (0.038, 0.07), (0.032, 0.09)], 12)
        for h in (0.018, 0.072):
            torus("dark", V(bx, main + h, bz), V(0, 1, 0), 0.038, 0.004, 16, 4)
    for k in range(3):
        torus("rope", V(-0.15, main + 0.008 + k * 0.009, z_of(ty)), V(0, 1, 0), 0.05 - k * 0.008, 0.006, 20, 5)


def helm_parts():
    """The wheel round its axle (local z), and its pedestal and the binnacle in front (ship frame), where her spec
    stands it: clear of the masts, the ladders and the cabin fronts, so the captain has room behind it."""
    t = SPEC["helm"]
    y = deck_y(t)
    z = z_of(t)
    box("dark", V(0, y + 0.1, z), (0.06, 0.2, 0.08))
    lathe("wood", V(0, y, z - 0.2), V(0, 1, 0), [(0.045, 0), (0.04, 0.02), (0.035, 0.1), (0.042, 0.13), (0.042, 0.14)], 12)
    lathe("gold", V(0, y + 0.14, z - 0.2), V(0, 1, 0), [(0.036, 0), (0.033, 0.015), (0.024, 0.03), (0.0, 0.038)], 12)
    for name in ("wheel_wood", "wheel_gold"):
        PARTS[name] = Mesh()
    torus("wheel_wood", V(0, 0, 0), V(0, 0, 1), 0.12, 0.012, 32, 6)
    torus("wheel_wood", V(0, 0, 0), V(0, 0, 1), 0.06, 0.008, 20, 5)
    cylinder("wheel_gold", V(0, 0, -0.025), V(0, 0, 0.025), 0.026, 0.026, 12)
    for k in range(8):
        a = 2 * math.pi * k / 8
        d = V(math.cos(a), math.sin(a), 0)
        lathe("wheel_wood", d * 0.022, d, [(0.007, 0), (0.006, 0.1), (0.008, 0.112), (0.006, 0.125), (0.01, 0.14), (0.009, 0.16), (0.0, 0.17)], 6)
    return V(0, y + 0.24, z - 0.05)


# ------------------------------------------------------------------------------------------------------------------
# Blender

MATERIALS = {}


def material(name):
    if name not in MATERIALS:
        MATERIALS[name] = bpy.data.materials.new(name)
    return MATERIALS[name]


def make(name, mesh, mat, parent=None, origin=V(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(C @ (v - origin)) for v in mesh.verts], [], mesh.faces)
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    for poly, corner in zip(me.polygons, mesh.uvs):
        for k, li in enumerate(poly.loop_indices):
            uv.data[li].uv = corner[k] if k < len(corner) else (0.5, 0.5)
    me.materials.append(material(mat))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    ob.location = C @ origin
    return ob


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    hull()
    bulwarks()
    mouldings()
    decks()
    cabins()
    stern()
    bow()
    guns()
    chainwales()
    fittings()
    if BROKEN:
        wreck()
    axle = helm_parts()
    root = bpy.data.objects.new("ship", None)
    root["model"] = "ship"
    bpy.context.scene.collection.objects.link(root)
    for name, mesh in PARTS.items():
        if not mesh.faces or name.startswith("wheel_"):
            continue
        make(f"ship_{name}", mesh, name, root)
    holder = bpy.data.objects.new("helm", None)
    bpy.context.scene.collection.objects.link(holder)
    holder.parent = root
    holder.location = C @ axle
    make("helm_wood", PARTS["wheel_wood"], "wood", holder)
    make("helm_gold", PARTS["wheel_gold"], "gold", holder)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_extras=True, export_apply=False,
                              export_materials="EXPORT", export_animations=False)
    n = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"ship: {SHIP_ID} {len([o for o in bpy.data.objects if o.type == 'MESH'])} meshes, {n} faces -> {OUT}")


main()
