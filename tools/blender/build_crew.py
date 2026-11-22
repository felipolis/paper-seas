"""
Builds the captains as paper puppets cut the way papertrails' traveller is (its public/models/traveller.glb) and
exports public/models/crew.glb.

    node tools/ship/export-crew.mjs
    "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/build_crew.py

Like the traveller, every piece is a flat card with a thickness: a profile card (in the figure's side plane) crossed
with a front card where a part needs both (the torso, the head), thin profile cards for the legs and arms, stepped
discs for a hat. Each card is printed in one flat colour by vertex colour (the front face in the colour, the back a
shade darker, the cut edge the paper's own cream #fbf6e9); a card laid over another is cut a little thicker so its
faces stand clear. Hats, beards and the extras (a parrot, epaulettes, a ladle) are cards too.

Hierarchy (the traveller's): crew_<id> -> body (arm_l, arm_r and head on it, the lantern on arm_r) and leg_l /
leg_r, each node on its joint so the game moves them by rotation only. Materials: "paper" (white, the colour is in
the vertices) and "glow" (the lantern's pane). The figure faces +z (game frame: y up), stands on y = 0, and is
papertrails' 0.6 tall (times its outfit height).
"""
import json
import math
import os

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CREW = json.load(open(os.path.join(ROOT, "assets-src", "models", "crew.json")))
OUT = os.path.join(ROOT, "public", "models", "crew.glb")
# game frame (x, y up, z forward) -> Blender (x, -z, y); the glTF export turns it back
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))

EDGE = "#fbf6e9"
# the traveller's back faces and undersides are about 0.87 of the front colour
SHADE = 0.87
# card thicknesses (the traveller's legs 0.018, arms 0.014, body and head cards about 0.012)
LEG_T = 0.018
ARM_T = 0.014
CARD_T = 0.012
# a card laid over another is cut this much thicker, so its faces stand clear of the one under it
OVER = 0.005
SIDES = 14


def V(x, y, z):
    return Vector((x, y, z))


def rgb(hexstr):
    """'#rrggbb' -> (r, g, b) in 0..1 (a colour already given as a tuple passes through)."""
    if isinstance(hexstr, tuple):
        return hexstr
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def shade(c, k=SHADE):
    return tuple(v * k for v in c)



class Part:
    """One node of the puppet: its joint (absolute, in the figure's frame), its faces (in the joint's frame), each with
    a colour, and the parent node it hangs on."""

    def __init__(self, name, pivot, parent=None):
        self.name, self.pivot, self.parent = name, pivot, parent
        self.verts, self.faces, self.colours = [], [], []
        self.glow = []

    def face(self, pts, colour):
        base = len(self.verts)
        self.verts += pts
        self.faces.append(list(range(base, base + len(pts))))
        self.colours.append(colour)


def newell(pts):
    n = V(0, 0, 0)
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def slab(part, pts, normal, thick, colour, edge=EDGE):
    """A flat card: the polygon pts (3D, in a plane with the given normal) cut thick, front in colour, back shaded,
    the cut edge in the paper's cream."""
    if newell(pts).dot(normal) < 0:
        pts = list(reversed(pts))
    off = normal.normalized() * (thick / 2)
    front = [p + off for p in pts]
    back = [p - off for p in pts]
    c = rgb(colour) if isinstance(colour, str) else colour
    e = rgb(edge) if isinstance(edge, str) else edge
    part.face(front, c)
    part.face(list(reversed(back)), shade(c))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        part.face([back[i], back[j], front[j], front[i]], e)


def front_card(part, pts2, z, thick, colour, s=1.0):
    """A card in the figure's front plane: pts2 are (x, y) at depth z (y scaled by s)."""
    slab(part, [V(x, y * s, z) for x, y in pts2], V(0, 0, 1), thick, colour)


def side_card(part, pts2, x, thick, colour, s=1.0):
    """A card in the figure's side (profile) plane: pts2 are (z, y) at x (y scaled by s)."""
    slab(part, [V(x, y * s, z) for z, y in pts2], V(1, 0, 0), thick, colour)


def disc(part, c, rx, rz, y0, y1, colour, side=None, sides=SIDES, rot=0.0):
    """A flat paper disc (a hat's brim or crown step): top in the colour, the underside shaded, its rim in side
    (the cut cream by default)."""
    col = rgb(colour)
    rim = rgb(side) if side else rgb(EDGE)
    lo = [c + V(math.cos(rot + 2 * math.pi * k / sides) * rx, y0, math.sin(rot + 2 * math.pi * k / sides) * rz) for k in range(sides)]
    hi = [p + V(0, y1 - y0, 0) for p in lo]
    part.face(list(reversed(hi)), col)
    part.face(lo, shade(col))
    for k in range(sides):
        j = (k + 1) % sides
        part.face([lo[k], lo[j], hi[j], hi[k]], rim)


def plate(part, outline, y0, y1, colour, side=None):
    """A flat plate cut to an outline in the ground plane (x, z) from y0 to y1 (a tricorn's brim)."""
    col = rgb(colour)
    rim = rgb(side) if side else rgb(EDGE)
    lo = [V(x, y0, z) for x, z in outline]
    if newell(lo).y > 0:
        lo = list(reversed(lo))
    hi = [p + V(0, y1 - y0, 0) for p in lo]
    part.face(list(reversed(hi)), col)
    part.face(lo, shade(col))
    for k in range(len(lo)):
        j = (k + 1) % len(lo)
        part.face([lo[k], lo[j], hi[j], hi[k]], rim)


def mirror(pts2):
    return [(-x, y) for x, y in reversed(pts2)]


def build(o):
    s = o["height"]
    g = o["girth"]
    cut = o["cut"]
    hip, shoulder, neck = 0.197 * s, 0.354 * s, 0.371 * s
    skin, hair, coat, shirt = o["skin"], o["hair"], o["coat"], o["shirt"]
    parts = {}

    # ---- legs: a trouser card, a boot with its toe forward, a cream cuff over the join (the traveller's) ----
    for side, name in ((1, "leg_l"), (-1, "leg_r")):
        p = Part(name, V(side * 0.031 * g, hip, 0))
        parts[name] = p
        h = hip / s
        side_card(p, [(-0.024, 0.012), (0.026, 0.012), (0.021, 0.07 - h), (-0.021, 0.07 - h)], 0, LEG_T, o["trousers"], s)
        side_card(p, [(-0.026, 0.074 - h), (0.022, 0.074 - h), (0.023, 0.026 - h), (0.058, 0.018 - h), (0.066, -h), (-0.028, -h)], 0, LEG_T, o["boots"], s)
        side_card(p, [(-0.027, 0.08 - h), (0.024, 0.08 - h), (0.024, 0.06 - h), (-0.027, 0.06 - h)], 0, LEG_T + OVER, "#e7d2ab", s)

    # ---- body: a front card crossed with a profile card, the coat cut over them ----
    body = Part("body", V(0, 0, 0))
    parts["body"] = body
    long_cut = cut in ("coat", "robe")
    hem = {"coat": 0.085, "robe": 0.03, "jacket": 0.165}.get(cut, 0.165)
    torso_x = [(-0.062 * g, 0.162), (0.062 * g, 0.162), (0.07 * g, 0.33), (0.055 * g, 0.362), (-0.055 * g, 0.362), (-0.07 * g, 0.33)]
    front_card(body, torso_x, 0, CARD_T, skin if cut == "bones" else shirt, s)
    bottom = hem if long_cut else 0.162
    side_colour = coat if cut in ("coat", "jacket", "robe") else (skin if cut == "bones" else shirt)
    side_card(body, [(-0.046, bottom), (0.048, bottom), (0.045, 0.33), (0.03, 0.364), (-0.03, 0.364), (-0.046, 0.33)], 0, CARD_T, side_colour, s)
    if cut in ("coat", "jacket"):
        # open at the front over the shirt: two front panels and a back panel
        panel = [(0.018 * g, hem), (0.082 * g, hem), (0.074 * g, 0.33), (0.058 * g, 0.36), (0.03 * g, 0.345), (0.016 * g, 0.27)]
        front_card(body, panel, 0.02, CARD_T, coat, s)
        front_card(body, mirror(panel), 0.02, CARD_T, coat, s)
        front_card(body, [(-0.084 * g, hem), (0.084 * g, hem), (0.074 * g, 0.345), (-0.074 * g, 0.345)], -0.02, CARD_T, coat, s)
    elif cut == "robe":
        front_card(body, [(-0.086 * g, hem), (0.086 * g, hem), (0.074 * g, 0.33), (0.058 * g, 0.36), (-0.058 * g, 0.36), (-0.074 * g, 0.33)], 0.02, CARD_T, coat, s)
        front_card(body, [(-0.084 * g, hem), (0.084 * g, hem), (0.074 * g, 0.345), (-0.074 * g, 0.345)], -0.02, CARD_T, coat, s)
        front_card(body, [(-0.012, hem), (0.012, hem), (0.012, 0.345), (-0.012, 0.345)], 0.026, CARD_T, shirt, s)
    elif cut == "apron":
        front_card(body, [(-0.06 * g, 0.08), (0.06 * g, 0.08), (0.058 * g, 0.3), (0.035 * g, 0.33), (-0.035 * g, 0.33), (-0.058 * g, 0.3)], 0.02, CARD_T, "#f4efe4", s)
    elif cut == "bones":
        for k in range(4):
            y = 0.22 + k * 0.03
            front_card(body, [(-0.05 * g, y), (0.05 * g, y), (0.05 * g, y + 0.009), (-0.05 * g, y + 0.009)], 0.012, CARD_T, "#4a3c30", s)
    # the shirt's collar at the neck
    front_card(body, [(-0.026, 0.364), (0.026, 0.364), (0.0, 0.322)], 0.026, CARD_T, shirt, s)
    if o.get("extra") == "belt" or cut in ("coat", "jacket"):
        front_card(body, [(-0.084 * g, 0.197), (0.084 * g, 0.197), (0.084 * g, 0.219), (-0.084 * g, 0.219)], 0.032, CARD_T, "#3a2418", s)
        front_card(body, [(-0.013, 0.194), (0.013, 0.194), (0.013, 0.222), (-0.013, 0.222)], 0.038, CARD_T, "#c9973f", s)
    if o.get("extra") == "epaulettes":
        for k in (1, -1):
            ep = [(0.048 * g, 0.35), (0.09 * g, 0.35), (0.094 * g, 0.334), (0.048 * g, 0.334)]
            front_card(body, ep if k > 0 else mirror(ep), 0.028, CARD_T, "#d8b04a", s)
            fr = [(0.05 * g, 0.336), (0.092 * g, 0.336), (0.09 * g, 0.322), (0.052 * g, 0.322)]
            front_card(body, fr if k > 0 else mirror(fr), 0.026, CARD_T, "#b8902e", s)
    if o.get("extra") == "parrot":
        x = 0.062 * g
        side_card(body, [(-0.012, 0.362), (0.014, 0.362), (0.02, 0.4), (0.014, 0.44), (-0.004, 0.452), (-0.014, 0.43), (-0.016, 0.39)], x, ARM_T, "#5e9a4a", s)
        side_card(body, [(-0.012, 0.372), (-0.002, 0.372), (-0.03, 0.312), (-0.038, 0.322)], x, ARM_T + OVER, "#b4442e", s)
        side_card(body, [(0.014, 0.436), (0.03, 0.428), (0.014, 0.418)], x, ARM_T + OVER, "#d9a441", s)
        side_card(body, [(0.004, 0.436), (0.01, 0.436), (0.01, 0.43), (0.004, 0.43)], x, ARM_T + OVER, "#2a1a12", s)

    # ---- arms: a sleeve card, a cuff, the hand (pivot on the shoulder) ----
    sleeve = coat if cut in ("coat", "jacket", "robe") else (skin if cut == "bones" else shirt)
    for side, name in ((1, "arm_l"), (-1, "arm_r")):
        p = Part(name, V(side * (0.074 * g + 0.01), shoulder, 0), "body")
        parts[name] = p
        side_card(p, [(-0.02, 0.016), (0.02, 0.016), (0.017, -0.15), (-0.017, -0.15)], 0, ARM_T, sleeve, s)
        if cut in ("coat", "robe", "jacket"):
            side_card(p, [(-0.02, -0.128), (0.02, -0.128), (0.02, -0.152), (-0.02, -0.152)], 0, ARM_T + OVER, shirt, s)
        side_card(p, [(-0.014, -0.15), (0.014, -0.15), (0.015, -0.17), (0.008, -0.186), (-0.01, -0.186), (-0.015, -0.17)], 0, ARM_T, skin, s)
        if o.get("extra") == "ladle" and side > 0:
            side_card(p, [(0.004, -0.17), (0.011, -0.17), (0.05, -0.04), (0.043, -0.04)], 0, 0.008, "#a8a49a", s)
            side_card(p, [(0.03, -0.04), (0.066, -0.04), (0.062, -0.01), (0.048, 0.0), (0.034, -0.01)], 0, 0.01, "#a8a49a", s)

    # ---- the lantern on the right hand (the traveller's: dark frame cards round a glowing pane) ----
    lan = Part("lantern", parts["arm_r"].pivot + V(0, -0.176 * s, 0.006), "arm_r")
    parts["lantern"] = lan
    frame = "#523729"
    for card in (front_card, side_card):
        card(lan, [(-0.024, -0.02), (0.024, -0.02), (0.024, -0.026), (-0.024, -0.026)], 0, 0.05, frame)
        card(lan, [(-0.024, -0.082), (0.024, -0.082), (0.024, -0.09), (-0.024, -0.09)], 0, 0.05, frame)
        card(lan, [(-0.03, -0.02), (0.03, -0.02), (0.0, 0.0)], 0, 0.006, frame)
    for x in (-0.022, 0.022):
        for z in (-0.022, 0.022):
            slab(lan, [V(x - 0.003, -0.026, z), V(x + 0.003, -0.026, z), V(x + 0.003, -0.082, z), V(x - 0.003, -0.082, z)], V(0, 0, 1), 0.006, frame)
    lan.glow = [V(x, y, z) for x, y, z in ((-0.018, -0.028, 0.0), (0.018, -0.08, 0.0))]

    # ---- head: a face card crossed with a profile card, hair behind, two dot eyes (the traveller's) ----
    head = Part("head", V(0, neck, 0.004), "body")
    parts["head"] = head
    bones = cut == "bones"
    front_card(head, [(-0.07, 0.03), (0.07, 0.03), (0.074, 0.12), (0.05, 0.158), (-0.05, 0.158), (-0.074, 0.12)], 0.012, CARD_T, hair, s)
    front_card(head, [(-0.045, 0.0), (0.045, 0.0), (0.062, 0.03), (0.062, 0.11), (0.045, 0.142), (-0.045, 0.142), (-0.062, 0.11), (-0.062, 0.03)], 0.028, CARD_T, skin, s)
    side_card(head, [(-0.065, 0.02), (-0.02, 0.0), (0.03, 0.0), (0.04, 0.03), (0.052, 0.06), (0.04, 0.075), (0.04, 0.13), (0.02, 0.155), (-0.04, 0.158), (-0.07, 0.12)], 0, CARD_T, skin, s)
    side_card(head, [(-0.07, 0.03), (-0.012, 0.05), (0.0, 0.128), (0.03, 0.148), (0.02, 0.16), (-0.04, 0.164), (-0.076, 0.12)], 0, CARD_T + OVER, hair, s)
    eye = 0.02 if bones else 0.012
    for x in (-0.022, 0.022):
        front_card(head, [(x - eye / 2, 0.07), (x + eye / 2, 0.07), (x + eye / 2, 0.07 + eye * 1.15), (x - eye / 2, 0.07 + eye * 1.15)], 0.036, CARD_T, "#3a2418", s)
    if bones:
        front_card(head, [(-0.008, 0.045), (0.008, 0.045), (0.0, 0.06)], 0.036, CARD_T, "#3a2418", s)
        front_card(head, [(-0.03, 0.016), (0.03, 0.016), (0.03, 0.026), (-0.03, 0.026)], 0.036, CARD_T, "#4a3c30", s)
    beard = o.get("beard")
    if beard == "full":
        front_card(head, [(-0.062, 0.062), (-0.04, 0.05), (0.04, 0.05), (0.062, 0.062), (0.05, 0.0), (0.02, -0.03), (-0.02, -0.03), (-0.05, 0.0)], 0.036, CARD_T, hair, s)
        side_card(head, [(0.0, 0.06), (0.044, 0.05), (0.034, 0.0), (0.006, -0.03), (-0.03, 0.0)], 0, CARD_T + 2 * OVER, hair, s)
    elif beard == "moustache":
        front_card(head, [(-0.034, 0.036), (0.0, 0.046), (0.034, 0.036), (0.03, 0.03), (0.0, 0.038), (-0.03, 0.03)], 0.036, CARD_T, hair, s)

    # ---- hat (stepped paper discs and cut cards, the traveller's straw hat for the wide one) ----
    hc = o["hatColour"]
    top = 0.15 * s
    kind = o["hat"]
    if kind == "wide":
        disc(head, V(0, 0, 0), 0.15, 0.15, top - 0.012, top, hc)
        disc(head, V(0, 0, 0), 0.075, 0.075, top, top + 0.04, hc, side=shade(rgb(hc)))
        disc(head, V(0, 0, 0), 0.06, 0.06, top + 0.04, top + 0.06, hc, side=shade(rgb(hc)))
        disc(head, V(0, 0, 0), 0.078, 0.078, top, top + 0.013, "#b4442e", side="#a33c28")
        side_card(head, [(-0.03, top / s + 0.03), (0.0, top / s + 0.04), (-0.07, top / s + 0.13), (-0.08, top / s + 0.12)], 0.05, ARM_T, "#efe0c2", s)
    elif kind == "tricorn":
        lobes = []
        for k in range(3):
            a = math.pi / 2 + k * 2 * math.pi / 3
            for d in (-0.5, 0.0, 0.5):
                r = 0.14 if d == 0.0 else 0.09
                lobes.append((math.cos(a + d) * r, math.sin(a + d) * r))
        plate(head, lobes, top - 0.012, top, hc)
        disc(head, V(0, 0, 0), 0.066, 0.066, top, top + 0.05, hc, side=shade(rgb(hc)))
        # the brim turned up along its three sides
        for k in range(3):
            a0 = math.pi / 2 + k * 2 * math.pi / 3
            a1 = a0 + 2 * math.pi / 3
            p0 = V(math.cos(a0) * 0.14, top, math.sin(a0) * 0.14)
            p1 = V(math.cos(a1) * 0.14, top, math.sin(a1) * 0.14)
            m0, m1 = p0.lerp(p1, 0.18), p0.lerp(p1, 0.82)
            n = (p1 - p0).cross(V(0, 1, 0)).normalized()
            slab(head, [m0, m1, m1 + V(0, 0.058, 0), (m0 + m1) / 2 + V(0, 0.07, 0), m0 + V(0, 0.058, 0)], n, CARD_T, hc)
        disc(head, V(0, 0, 0), 0.068, 0.068, top, top + 0.012, "#c9973f", side="#b0842f")
    elif kind == "bicorne":
        disc(head, V(0, 0, 0), 0.07, 0.07, top - 0.02, top + 0.02, hc, side=shade(rgb(hc)))
        front_card(head, [(-0.15, top / s), (-0.1, top / s + 0.045), (-0.04, top / s + 0.075), (0.04, top / s + 0.075), (0.1, top / s + 0.045), (0.15, top / s), (0.08, top / s - 0.015), (-0.08, top / s - 0.015)], 0.0, 0.018, hc, s)
        front_card(head, [(0.05, top / s + 0.02), (0.07, top / s + 0.02), (0.07, top / s + 0.042), (0.05, top / s + 0.042)], 0.014, CARD_T, "#c9973f", s)
    elif kind in ("bandana", "scarf"):
        disc(head, V(0, 0, 0), 0.072, 0.078, top - 0.04, top + 0.012, hc, side=shade(rgb(hc)))
        side_card(head, [(-0.074, top / s - 0.025), (-0.064, top / s - 0.005), (-0.11, top / s - 0.07), (-0.122, top / s - 0.058)], 0, ARM_T, hc, s)
        side_card(head, [(-0.074, top / s - 0.025), (-0.07, top / s - 0.012), (-0.1, top / s - 0.09), (-0.11, top / s - 0.085)], 0.012, ARM_T, shade(rgb(hc), 0.92), s)
    elif kind == "round":
        disc(head, V(0, 0, 0), 0.09, 0.09, top - 0.01, top, hc)
        disc(head, V(0, 0, 0), 0.07, 0.07, top, top + 0.035, hc, side=shade(rgb(hc)))
        disc(head, V(0, 0, 0), 0.012, 0.012, top + 0.035, top + 0.05, "#b4442e", side="#a33c28", sides=8)
    elif kind == "chef":
        disc(head, V(0, 0, 0), 0.062, 0.062, top - 0.02, top + 0.06, hc, side=shade(rgb(hc), 0.93))
        disc(head, V(0, 0, 0), 0.085, 0.085, top + 0.06, top + 0.1, hc, side=shade(rgb(hc), 0.93))

    # the body hangs on the hips (its torso rocks there): built in the figure's frame, moved into the hip's
    body.verts = [v - V(0, hip, 0) for v in body.verts]
    body.pivot = V(0, hip, 0)
    return parts


def material(name, glow=False):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if glow:
        m["glow"] = 1
    return m


def emit(o, parts, col_):
    root = bpy.data.objects.new(f"crew_{o['id']}", None)
    root["captain"] = o["id"]
    col_.objects.link(root)
    nodes = {}
    # parents before children: body before its arms and head, the right arm before its lantern
    order = ["leg_l", "leg_r", "body", "arm_l", "arm_r", "head", "lantern"]
    for name in order:
        p = parts[name]
        node = bpy.data.objects.new(f"{o['id']}__{name}", None)
        col_.objects.link(node)
        node.parent = nodes[p.parent] if p.parent else root
        node.location = C @ (p.pivot - (parts[p.parent].pivot if p.parent else V(0, 0, 0)))
        nodes[name] = node
        if p.faces:
            me = bpy.data.meshes.new(f"{o['id']}__{name}__paper")
            me.from_pydata([tuple(C @ v) for v in p.verts], [], p.faces)
            me.update()
            attr = me.color_attributes.new(name="Col", type="BYTE_COLOR", domain="CORNER")
            for poly, colour in zip(me.polygons, p.colours):
                for li in poly.loop_indices:
                    attr.data[li].color_srgb = (*colour, 1.0)
            me.materials.append(material("paper"))
            ob = bpy.data.objects.new(me.name, me)
            col_.objects.link(ob)
            ob.parent = node
        if p.glow:
            (x0, y0, _), (x1, y1, _) = p.glow
            quad = [V(x0, y0, 0), V(x1, y0, 0), V(x1, y1, 0), V(x0, y1, 0)]
            # the pane: a cross of two glowing cards inside the frame
            verts = [C @ v for v in quad] + [C @ V(0, v.y, v.x) for v in quad]
            me = bpy.data.meshes.new(f"{o['id']}__{name}__glow")
            me.from_pydata([tuple(v) for v in verts], [], [[0, 1, 2, 3], [4, 5, 6, 7]])
            me.update()
            me.materials.append(material("glow", glow=True))
            ob = bpy.data.objects.new(me.name, me)
            col_.objects.link(ob)
            ob.parent = node


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col_ = bpy.context.scene.collection
    for o in CREW:
        emit(o, build(o), col_)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_extras=True, export_apply=False,
                              export_materials="EXPORT", export_vertex_color="ACTIVE", export_animations=False)
    print("crew:", len(CREW), "->", OUT)


main()
