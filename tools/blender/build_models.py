"""
Builds the pop-up models of Paper Seas (buildings) as real paper constructions and exports them to
public/models/models.glb.

    "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup \
        -P tools/blender/build_models.py

Every model is a tree of paper pieces joined by hinges, like a pop-up page (after papertrails by xikhar, MIT):
the front wall stands up off the page, the side walls swing out from the front, the roof planes fold over from the
side walls, the chimney pops up from the roof... Each piece is a node whose origin lies on its fold line and whose
local X axis is the hinge axis; its rest pose is the assembled model, and the game draws it at
    quaternion = rest * RotX(foldAngle * (1 - p))
so at p = 0 every piece lies folded flat onto its parent (or onto the page). Node extras (glTF): hinge, foldAngle,
delay (0..1 start order). The model root carries extras { model }.

The printed faces come from the atlas (tools/art/pack-atlas.mjs -> assets-src/models/atlas.json +
public/models/atlas.png); their gable measurements size the walls and roofs, so a roof sits exactly on its gable.
Solid pieces are real card: printed face, kraft back and a cut edge coloured like the print around them; cut-out pieces (the
sign, crenellated walls, the belfry) are a single printed sheet whose alpha cuts the outline in the game.

Geometry is written in the game's frame (Y up, the model's front facing +Z) and converted to Blender's Z-up on
creation; the glTF exporter converts it back.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ATLAS = json.load(open(os.path.join(ROOT, "assets-src", "models", "atlas.json")))
DOMES = json.load(open(os.path.join(ROOT, "assets-src", "models", "domes.json")))  # tools/art/paint-domes.mjs
OUT = os.path.join(ROOT, "public", "models", "models.glb")
SIZE = ATLAS["size"][0]
THICK = 0.016  # card thickness (world units): papertrails' cardThickness

# game frame (x, y up, z front) -> Blender (x, -z, y)
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
C_INV = C.inverted()


def V(x, y, z):
    return Vector((x, y, z))


# ------------------------------------------------------------------------------------------------------------------
# atlas lookups

def face(name):
    return ATLAS["faces"][name]


def uv_of(name, a, b):
    """Atlas UV (Blender convention, v up) of a point (a across, b up, 0..1) of a face or patch."""
    rect = ATLAS["faces"][name]["rect"] if name in ATLAS["faces"] else ATLAS["patches"][name]
    x, y, w, h = rect
    px = x + a * w
    py = y + (1 - b) * h
    return (px / SIZE, 1 - py / SIZE)


def patch_uv(name):
    return uv_of(name, 0.5, 0.5)


# ------------------------------------------------------------------------------------------------------------------
# pieces

class Piece:
    def __init__(self, model, name, parent, frame, fold, delay, verts, uvs, faces, thin):
        self.model = model
        self.name = name
        self.parent = parent
        self.frame = frame  # 4x4, game frame, world (model) space at rest
        self.fold = fold
        self.delay = delay
        self.verts = verts  # world positions
        self.uvs = uvs  # per face-corner lists, parallel to faces
        self.faces = faces
        self.thin = thin
        self.layer = 0  # stacking order when folded flat (higher lies on top)


class Model:
    def __init__(self, name):
        self.name = name
        self.pieces = []

    def card(self, name, parent, art, corners, poly, hinge, flat, delay, thin=False, open_edges=(), back="print"):
        """
        A planar card.
          art       atlas face printed on it
          corners   world positions of the face's corners (a, b) = (0,0), (1,0), (1,1), (0,1) (bilinear)
          poly      the card's outline in face coordinates (a across, b up), counter-clockwise seen from the front
          hinge     (point, axis): its fold line, in world space
          flat      world direction the card lies along when folded flat (perpendicular to the hinge)
        Solid cards get a back and a cut edge (except along open_edges, given as outline indices: edge i runs from
        poly[i] to poly[i + 1]). The back carries the same print (as papertrails' cards: whichever way a piece folds
        flat, no blank kraft ever lies face up); back="kraft" gives a plain back instead.
        """
        c00, c10, c11, c01 = corners

        def P(a, b):
            return c00 * ((1 - a) * (1 - b)) + c10 * (a * (1 - b)) + c11 * (a * b) + c01 * ((1 - a) * b)

        pts = [P(a, b) for a, b in poly]
        normal = (c10 - c00).cross(c01 - c00).normalized()
        centroid = sum(pts, Vector()) / len(pts)
        h0, axis = hinge
        X = axis.normalized()
        Y = centroid - h0
        Y = (Y - X * Y.dot(X)).normalized()
        Z = X.cross(Y)
        if Z.dot(normal) < 0:
            X = -X
            Z = X.cross(Y)
        frame = Matrix.Identity(4)
        for i in range(3):
            frame[i][0], frame[i][1], frame[i][2], frame[i][3] = X[i], Y[i], Z[i], h0[i]
        d = flat - X * flat.dot(X)
        fold = math.atan2(d.dot(Z), d.dot(Y))

        verts, faces, uvs = [], [], []
        n = len(pts)
        # printed face (a fan: every outline here is convex)
        verts += pts
        faces.append(list(range(n)))
        uvs.append([uv_of(art, a, b) for a, b in poly])
        if not thin:
            back_pts = [p - normal * THICK for p in pts]
            base = len(verts)
            verts += back_pts
            faces.append([base + i for i in reversed(range(n))])
            if back == "print":
                uvs.append([uv_of(art, a, b) for a, b in reversed(poly)])
            else:
                k = patch_uv(back)
                uvs.append([k] * n)
            # the cut edge is the card itself, coloured through: it takes the print's colour just inside the edge
            # (never a pale rim around a dark roof)
            ca = sum(a for a, _ in poly) / n
            cb = sum(b for _, b in poly) / n
            inner = [uv_of(art, a + (ca - a) * 0.04, b + (cb - b) * 0.04) for a, b in poly]
            for i in range(n):
                if i in open_edges:
                    continue
                j = (i + 1) % n
                faces.append([j, i, base + i, base + j])
                uvs.append([inner[j], inner[i], inner[i], inner[j]])
        piece = Piece(self, name, parent, frame, fold, delay, verts, uvs, faces, thin)
        self.pieces.append(piece)
        return piece

    def dome_card(self, name, art, a0, a1, height, bow, flat_sign, delay, layer=0, cols=30, rows=6):
        """
        A curved card cut to a printed profile (domes.json), standing on the page: its foot runs from a0 to a1 (points
        on the page) and bows by `bow` toward the viewer at the middle, its top follows the profile, `height` tall.
        Hinged on the chord of its foot; flat_sign +1 folds it back (lying face up behind its foot), -1 forward.
        """
        prof = DOMES[art]["profile"]
        n = len(prof)

        def top(a):
            f = min(n - 1.0, max(0.0, a * (n - 1)))
            i = int(f)
            j = min(n - 1, i + 1)
            return prof[i] + (prof[j] - prof[i]) * (f - i)

        if a1.x < a0.x:
            a0, a1 = a1, a0
        chord = a1 - a0
        X = chord.normalized()
        fwd = V(0, 1, 0).cross(X).normalized()  # the card's front (toward +z for a foot running along +x)
        if fwd.z < 0:
            fwd = -fwd

        def foot(a):
            return a0 + chord * a + fwd * (bow * math.sin(math.pi * a))

        def nrm(a):
            d = chord + fwd * (bow * math.pi * math.cos(math.pi * a))
            nn = V(0, 1, 0).cross(d.normalized()).normalized()
            return nn if nn.dot(fwd) > 0 else -nn

        verts, faces, uvs = [], [], []
        grid = []
        for c in range(cols + 1):
            a = c / cols
            col = []
            for r in range(rows + 1):
                b = top(a) * r / rows
                col.append((len(verts), a, b))
                verts.append(foot(a) + V(0, height * b, 0))
            grid.append(col)
        back = []
        for c in range(cols + 1):
            a = c / cols
            bcol = []
            for r in range(rows + 1):
                bcol.append(len(verts))
                verts.append(verts[grid[c][r][0]] - nrm(a) * THICK)
            back.append(bcol)
        for c in range(cols):
            for r in range(rows):
                i00, a00, b00 = grid[c][r]
                i10, a10, b10 = grid[c + 1][r]
                i11, a11, b11 = grid[c + 1][r + 1]
                i01, a01, b01 = grid[c][r + 1]
                faces.append([i00, i10, i11, i01])
                uvs.append([uv_of(art, a00, b00), uv_of(art, a10, b10), uv_of(art, a11, b11), uv_of(art, a01, b01)])
                # the back carries the same print (a dome folded either way never shows blank kraft)
                faces.append([back[c][r], back[c][r + 1], back[c + 1][r + 1], back[c + 1][r]])
                uvs.append([uv_of(art, a00, b00), uv_of(art, a01, b01), uv_of(art, a11, b11), uv_of(art, a10, b10)])

        def edge_uv(a, b):
            return uv_of(art, 0.5 + (a - 0.5) * 0.96, b * 0.96)

        # cut edges: the top run, both ends, the foot
        for c in range(cols):
            ia, aa, ba = grid[c][rows]
            ib, ab, bb = grid[c + 1][rows]
            faces.append([ib, ia, back[c][rows], back[c + 1][rows]])
            uvs.append([edge_uv(ab, bb), edge_uv(aa, ba), edge_uv(aa, ba), edge_uv(ab, bb)])
            ia, aa, ba = grid[c][0]
            ib, ab, bb = grid[c + 1][0]
            faces.append([ia, ib, back[c + 1][0], back[c][0]])
            uvs.append([edge_uv(aa, ba), edge_uv(ab, bb), edge_uv(ab, bb), edge_uv(aa, ba)])
        for r in range(rows):
            ia, aa, ba = grid[0][r]
            ib, ab, bb = grid[0][r + 1]
            faces.append([ib, ia, back[0][r], back[0][r + 1]])
            uvs.append([edge_uv(ab, bb), edge_uv(aa, ba), edge_uv(aa, ba), edge_uv(ab, bb)])
            ia, aa, ba = grid[cols][r]
            ib, ab, bb = grid[cols][r + 1]
            faces.append([ia, ib, back[cols][r + 1], back[cols][r]])
            uvs.append([edge_uv(aa, ba), edge_uv(ab, bb), edge_uv(ab, bb), edge_uv(aa, ba)])

        h0 = (a0 + a1) / 2
        Y = V(0, 1, 0)
        Z = X.cross(Y)
        if Z.dot(fwd) < 0:
            X = -X
            Z = X.cross(Y)
        frame = Matrix.Identity(4)
        for i in range(3):
            frame[i][0], frame[i][1], frame[i][2], frame[i][3] = X[i], Y[i], Z[i], h0[i]
        flat = -fwd * flat_sign
        fold = math.atan2(flat.dot(Z), flat.dot(Y))
        piece = Piece(self, name, None, frame, fold, delay, verts, uvs, faces, False)
        piece.layer = layer
        self.pieces.append(piece)
        return piece


def rect_corners(o, across, up):
    """Corners of a rectangular face: origin o (bottom-left seen from the front), across and up vectors."""
    return (o, o + across, o + across + up, o + up)


FULL = [(0, 0), (1, 0), (1, 1), (0, 1)]


# ------------------------------------------------------------------------------------------------------------------
# a gabled house: front and back gables, two side walls, two roof planes, optional chimney and sign

def gable_house(name, W, front, side, roof, depth_scale=1.0, chimney=None, sign=None, over=0.07, back=None):
    m = Model(name)
    g = face(front)["gable"]
    fw, fh = face(front)["rect"][2:]
    face_w = W / (g["wallR"] - g["wallL"])
    face_h = face_w * fh / fw
    H = g["eave"] * face_h
    A = g["apex"] * face_h
    sw, sh = face(side)["rect"][2:]
    D = H * sw / sh * depth_scale
    left = -W / 2 - g["wallL"] * face_w  # x of the face's left edge

    # outline of the gable in face coordinates: the wall and its triangle (wall edges at wallL / wallR)
    def gable_poly():
        return [(g["wallL"], 0), (g["wallR"], 0), (g["wallR"], g["eave"]), ((g["wallL"] + g["wallR"]) / 2, g["apex"]), (g["wallL"], g["eave"])]

    up = V(0, face_h, 0)
    # front: stands on its bottom edge, lies flat into the house
    fr = m.card("front", None, front, rect_corners(V(left, 0, D / 2), V(face_w, 0, 0), up), gable_poly(),
                (V(0, 0, D / 2), V(1, 0, 0)), V(0, 0, -1), 0.0)
    # back: the same gable seen from behind (mirrored print), lies flat away from the house
    bk = m.card("back", None, back or front, rect_corners(V(-left, 0, -D / 2), V(-face_w, 0, 0), up), gable_poly(),
                (V(0, 0, -D / 2), V(1, 0, 0)), V(0, 0, -1), 0.15)
    # side walls: hinged on the front's vertical edges, folded flat onto the front
    # (the side walls stop just inside the gables' card thickness: no two faces share a plane at the corners)
    gap = THICK + 0.003
    wl = m.card("wall_l", fr, side, rect_corners(V(-W / 2, 0, -D / 2 + gap), V(0, 0, D - 2 * gap), V(0, H, 0)), FULL,
                (V(-W / 2, 0, D / 2), V(0, 1, 0)), V(1, 0, 0), 0.25)
    wr = m.card("wall_r", fr, side, rect_corners(V(W / 2, 0, D / 2 - gap), V(0, 0, -D + 2 * gap), V(0, H, 0)), FULL,
                (V(W / 2, 0, D / 2), V(0, 1, 0)), V(-1, 0, 0), 0.25)
    # roof planes: hinged at the eaves (top of each side wall), folded up flat as the wall's continuation
    half = W / 2
    rise = A - H
    pitch = math.atan2(rise, half)
    slope = math.hypot(half, rise)
    dl = V(math.cos(pitch), math.sin(pitch), 0)  # up the left slope
    dr = V(-math.cos(pitch), math.sin(pitch), 0)
    ext = slope + THICK * 0.6  # just to the ridge: the two planes meet there (no kraft underside poking out)
    zf, zb = D / 2 + over, -D / 2 - over
    # the roof planes sit one card thickness above the gables' sloped edges (so they never share a plane with them)
    nl = V(-math.sin(pitch), math.cos(pitch), 0) * (THICK + 0.003)
    nr = V(math.sin(pitch), math.cos(pitch), 0) * (THICK + 0.003)
    el = V(-half, H, 0) - dl * over + nl
    er = V(half, H, 0) - dr * over + nr
    rl = m.card("roof_l", wl, roof, (el + V(0, 0, zb), el + V(0, 0, zf), el + V(0, 0, zf) + dl * (ext + over), el + V(0, 0, zb) + dl * (ext + over)), FULL,
                (V(-half, H, 0), V(0, 0, 1)), V(0, 1, 0), 0.55)
    rr = m.card("roof_r", wr, roof, (er + V(0, 0, zf), er + V(0, 0, zb), er + V(0, 0, zb) + dr * (ext + over), er + V(0, 0, zf) + dr * (ext + over)), FULL,
                (V(half, H, 0), V(0, 0, 1)), V(0, 1, 0), 0.62)
    if chimney:
        cw, chh = face(chimney)["rect"][2:]
        width = 0.13
        height = width * chh / cw
        cx = half * 0.45
        top_y = H + rise * (1 - cx / half)
        base_y = top_y - 0.18
        cz = -D * 0.18
        # two crossed cards: one across the roof (hinged on the slope), one along it (hinged on the first)
        ca = m.card("chimney", rr, chimney, rect_corners(V(cx - width / 2, base_y, cz), V(width, 0, 0), V(0, height, 0)), FULL,
                    (V(cx, top_y, cz), V(1, 0, 0)), V(0, 0, -1), 0.85, thin=True)
        m.card("chimney_x", ca, chimney, rect_corners(V(cx, base_y, cz + width / 2), V(0, 0, -width), V(0, height, 0)), FULL,
               (V(cx, base_y, cz + width / 2), V(0, 1, 0)), V(1, 0, 0), 0.9, thin=True)
    if sign:
        sw2, sh2 = face(sign)["rect"][2:]
        width = 0.36
        height = width * sh2 / sw2
        y0 = H * 0.42
        # the bracket juts out from the left wall near the front corner, the board faces the street
        zc = D / 2 - 0.12
        m.card("sign", wl, sign, rect_corners(V(-W / 2 - width, y0, zc), V(width, 0, 0), V(0, height, 0)), FULL,
               (V(-W / 2, y0, zc), V(0, 1, 0)), V(0, 0, -1), 0.8, thin=True)
    return m, {"W": W, "D": D, "H": A}


# ------------------------------------------------------------------------------------------------------------------
# a square tower: four walls (front, then sides hinged on it, then the back on the left side) and a top

def box_walls(m, prefix, cx, cz, base_y, w_bot, w_top, height, arts, delay0, parent=None, thin=False, back="print", open_top=False):
    """Four (optionally tapered) walls around (cx, cz). arts = (front, side, back). Returns (front, left, right, back)."""
    hb, ht = w_bot / 2, w_top / 2
    y0, y1 = base_y, base_y + height

    def corners(art, b0, b1, t1, t0):
        # face corners from the measured print spans, so the print's edges sit on the tower's corners
        sp = face(art)["spans"]
        lb, rb = sp["bottom"]
        lt, rt = sp["top"]
        # extend the face so its bottom span [lb, rb] lands on b0..b1 and its top span on t0..t1
        acr_b = (b1 - b0) / max(1e-6, rb - lb)
        acr_t = (t1 - t0) / max(1e-6, rt - lt)
        c00 = b0 - acr_b * lb
        c10 = c00 + acr_b
        c01 = t0 - acr_t * lt
        c11 = c01 + acr_t
        return (c00, c10, c11, c01)

    def wall(name, art, a, b, par, hinge, flat, delay, inset=0.0):
        # a: bottom-left -> bottom-right direction corners (world, at y0), b: the same at the top; inset pulls both
        # ends in (the side walls stop inside the front and back walls' thickness: no shared planes at the corners)
        if inset:
            da = (a[1] - a[0]).normalized() * inset
            db = (b[1] - b[0]).normalized() * inset
            a = (a[0] + da, a[1] - da)
            b = (b[0] + db, b[1] - db)
        cs = corners(art, a[0], a[1], b[1], b[0])
        # the card follows the print's outline (a tapered print leaves no kraft beside it)
        sp = face(art)["spans"]
        poly = [(sp["bottom"][0], 0), (sp["bottom"][1], 0), (sp["top"][1], 1), (sp["top"][0], 1)]
        return m.card(name, par, art, cs, poly, hinge, flat, delay, thin=thin, back=back, open_edges=(2,) if open_top else ())

    def pt(x, y, z):
        return V(cx + x, y, cz + z)

    # bottom and top corners: front-left, front-right, back-right, back-left
    FLb, FRb, BRb, BLb = pt(-hb, y0, hb), pt(hb, y0, hb), pt(hb, y0, -hb), pt(-hb, y0, -hb)
    FLt, FRt, BRt, BLt = pt(-ht, y1, ht), pt(ht, y1, ht), pt(ht, y1, -ht), pt(-ht, y1, -ht)
    art_front, art_side, art_back = arts
    fr = wall(prefix + "front", art_front, (FLb, FRb), (FLt, FRt), parent, (pt(0, y0, hb), V(1, 0, 0)), V(0, 0, -1), delay0)
    lf = wall(prefix + "left", art_side, (BLb, FLb), (BLt, FLt), fr, (FLb, FLt - FLb), (FRb - FLb), delay0 + 0.12, inset=THICK + 0.003)
    rt = wall(prefix + "right", art_side, (FRb, BRb), (FRt, BRt), fr, (FRb, FRt - FRb), (FLb - FRb), delay0 + 0.12, inset=THICK + 0.003)
    bk = wall(prefix + "back", art_back, (BRb, BLb), (BRt, BLt), lf, (BLb, BLt - BLb), FLb - BLb, delay0 + 0.22)
    return fr, lf, rt, bk, (FLt, FRt, BRt, BLt)


def pyramid(m, prefix, top_corners, apex_h, art, walls, delay):
    """Four triangles on a square top, each hinged on the top edge of its wall, folded up as the wall's continuation."""
    FLt, FRt, BRt, BLt = top_corners
    centre = (FLt + FRt + BRt + BLt) / 4
    apex = centre + V(0, apex_h, 0)
    sp = face(art)["spans"]["bottom"]
    edges = [(FLt, FRt), (BLt, FLt), (FRt, BRt), (BRt, BLt)]
    for k, ((a, b), wall) in enumerate(zip(edges, walls)):
        # the triangle's print: its bottom span on the edge a..b, its apex on the apex
        acr = (b - a) / max(1e-6, sp[1] - sp[0])
        c00 = a - acr * sp[0]
        c10 = c00 + acr
        mid = (a + b) / 2
        upv = apex - mid
        c01 = c00 + upv
        c11 = c10 + upv
        poly = [(sp[0], 0), (sp[1], 0), ((sp[0] + sp[1]) / 2, 1)]
        m.card(f"{prefix}{k}", wall, art, (c00, c10, c11, c01), poly, (a, b - a), V(0, 1, 0), delay + k * 0.04)


def fort_tower(name):
    m = Model(name)
    w = 0.85
    fw, fh = face("fort-wall")["rect"][2:]
    sp = face("fort-wall")["spans"]["bottom"]
    height = w / (sp[1] - sp[0]) * fh / fw
    # (printed inside too, so the crenellations are cut on both faces; open along their top)
    fr, lf, rt, bk, top = box_walls(m, "", 0, 0, 0, w, w, height, ("fort-door", "fort-wall", "fort-wall"), 0.0, back="print", open_top=True)
    # the stone floor of the battlement, hinged on the back wall just under the crenellations
    yb = height * 0.86
    hb = w / 2 - 0.01
    m.card("deck", bk, "stone", rect_corners(V(-hb, yb, hb), V(2 * hb, 0, 0), V(0, 0, -2 * hb)), FULL,
           (V(0, yb, -hb), V(1, 0, 0)), V(0, -1, 0), 0.5)
    return m, {"W": w, "D": w, "H": height}


def lighthouse(name):
    m = Model(name)
    wb = 0.7
    fw, fh = face("lighthouse-wall")["rect"][2:]
    sp = face("lighthouse-wall")["spans"]
    face_w = wb / (sp["bottom"][1] - sp["bottom"][0])
    height = face_w * fh / fw
    wt = face_w * (sp["top"][1] - sp["top"][0])
    fr, lf, rt, bk, top = box_walls(m, "", 0, 0, 0, wb, wt, height, ("lighthouse-wall",) * 3, 0.0)
    # the lantern room on top, then its cap
    lw = wt * 0.82
    gw, gh = face("lighthouse-glass")["rect"][2:]
    gsp = face("lighthouse-glass")["spans"]["bottom"]
    lh = lw / (gsp[1] - gsp[0]) * gh / gw
    lfr, llf, lrt, lbk, ltop = box_walls(m, "lantern_", 0, 0, height, lw, lw, lh, ("lighthouse-glass",) * 3, 0.55, parent=fr, thin=True)
    cw, ch = face("lighthouse-cap")["rect"][2:]
    csp = face("lighthouse-cap")["spans"]["bottom"]
    cap_w = lw * 1.25
    cap_h = cap_w / (csp[1] - csp[0]) * ch / cw * 0.75
    # the cap slightly wider than the room: its corners pushed out
    c = V(0, height + lh, 0)
    hb = cap_w / 2
    cap_corners = (c + V(-hb, 0, hb), c + V(hb, 0, hb), c + V(hb, 0, -hb), c + V(-hb, 0, -hb))
    pyramid(m, "cap_", cap_corners, cap_h, "lighthouse-cap", (lfr, llf, lrt, lbk), 0.8)
    return m, {"W": wb, "D": wb, "H": height + lh + cap_h}


def chapel(name):
    m, dims = gable_house(name, 0.95, "chapel-front", "chapel-side", "chapel-roof", depth_scale=1.3)
    # the belfry: a small square tower astride the ridge at the front, with a slate spire
    g = face("chapel-front")["gable"]
    fw, fh = face("chapel-front")["rect"][2:]
    face_w = 0.95 / (g["wallR"] - g["wallL"])
    A = g["apex"] * face_w * fh / fw
    tw = 0.3
    tw_art, th_art = face("chapel-tower")["rect"][2:]
    th = tw * th_art / tw_art
    zc = dims["D"] / 2 - tw / 2 - 0.06
    base_y = A - 0.22
    roof_l = next(p for p in m.pieces if p.name == "roof_l")
    fr, lf, rt, bk, top = box_walls(m, "belfry_", 0, zc, base_y, tw, tw, th, ("chapel-tower",) * 3, 0.7, parent=roof_l, thin=True)
    sw, sh = face("chapel-spire")["rect"][2:]
    ssp = face("chapel-spire")["spans"]["bottom"]
    spire_h = tw / (ssp[1] - ssp[0]) * sh / sw * 0.85
    pyramid(m, "spire_", top, spire_h, "chapel-spire", (fr, lf, rt, bk), 0.85)
    dims["H"] = base_y + th + spire_h
    return m, dims


def stilt_hut(name):
    m = Model(name)
    w = 0.8
    stilt = 0.34
    fw, fh = face("hut-front")["rect"][2:]
    sp = face("hut-front")["spans"]["bottom"]
    height = w / (sp[1] - sp[0]) * fh / fw
    hb = w / 2
    # four posts at the corners (thin wood cards facing the front), the floor hinged on the front pair
    posts = []
    for k, (x, z) in enumerate([(-hb + 0.05, hb - 0.04), (hb - 0.05, hb - 0.04), (-hb + 0.05, -hb + 0.04), (hb - 0.05, -hb + 0.04)]):
        posts.append(m.card(f"post{k}", None, "wood", rect_corners(V(x - 0.035, 0, z), V(0.07, 0, 0), V(0, stilt + 0.02, 0)), FULL,
                            (V(x, 0, z), V(1, 0, 0)), V(0, 0, -1), 0.04 * k))
    floor = m.card("floor", posts[0], "wood", rect_corners(V(-hb - 0.04, stilt, hb + 0.04), V(w + 0.08, 0, 0), V(0, 0, -w - 0.08)), FULL,
                   (V(0, stilt, hb + 0.04), V(1, 0, 0)), V(0, -1, 0), 0.2)
    fr, lf, rt, bk, top = box_walls(m, "", 0, 0, stilt, w, w, height, ("hut-front", "hut-side", "hut-side"), 0.3, parent=floor)
    rw, rh = face("hut-roof")["rect"][2:]
    # a thatched pyramid, overhanging the walls
    over = 0.12
    yt = stilt + height
    c = V(0, yt - 0.04, 0)
    h2 = hb + over
    pyramid(m, "roof_", (c + V(-h2, 0, h2), c + V(h2, 0, h2), c + V(h2, 0, -h2), c + V(-h2, 0, -h2)), 0.5, "hut-roof", (fr, lf, rt, bk), 0.6)
    return m, {"W": w, "D": w, "H": yt + 0.5}


# ------------------------------------------------------------------------------------------------------------------
# mountains (after papertrails' dunes, hills and rocks): no solids, cards. A tall pair of curved dome cards set in a V
# at the back, a smaller pair in front of it, a long low dome at the foot and outcrops of rounded stone slabs, each
# stone a pair (a taller one behind, a smaller one overlapping it in front). Every card stands up off the page on the
# chord of its foot; folded, they lie face up behind their feet, the front ones stacked on top (layer).



def stone_pair(m, tag, stone, x, z, w, h, yaw, delay, layer):
    """A rounded stone: a taller slab with a smaller one overlapping it in front, a little to one side."""
    d = V(math.cos(yaw), 0, math.sin(yaw))
    f = V(-d.z, 0, d.x)
    if f.z < 0:
        f = -f
    c = V(x, 0, z)
    m.dome_card(f"{tag}_rear", f"stone-{stone}-0", c - d * (w / 2), c + d * (w / 2), h, 0.04, 1, delay, layer)
    c2 = c + d * (w * 0.22) + f * 0.12
    w2 = w * 0.68
    m.dome_card(f"{tag}", f"stone-{stone}-1", c2 - d * (w2 / 2), c2 + d * (w2 / 2), h * 0.72, 0.03, 1, delay + 0.06, layer + 1)


def ridge(name, kind, stone, seed, scale=1.0):
    import random as _r
    rng = _r.Random(seed)
    m = Model(name)
    s = scale
    mir = -1 if rng.random() < 0.5 else 1
    j = lambda a: rng.uniform(-a, a)
    P = lambda x, z: V(mir * x * s, 0, z * s)
    back, mid, low = f"dome-{kind}-0", f"dome-{kind}-1", f"dome-{'rock' if kind == 'snow' else kind}-2"
    # the tall pair, a V opening toward the viewer, its arms crossing at the back
    m.dome_card("back_l", back, P(-2.1 + j(0.15), -0.15 + j(0.1)), P(0.35, -1.05), 3.0 * s * rng.uniform(0.95, 1.05), 0.22 * s, 1, 0.0, 0)
    m.dome_card("back_r", back if kind != "snow" else "dome-snow-1", P(-0.3, -1.14), P(2.0 + j(0.15), -0.3 + j(0.1)), 2.6 * s * rng.uniform(0.95, 1.06), 0.2 * s, 1, 0.08, 0)
    # the smaller pair in front of it
    m.dome_card("mid_l", mid, P(-1.55 + j(0.1), 0.55), P(0.2, 0.05), 1.75 * s * rng.uniform(0.92, 1.08), 0.15 * s, 1, 0.28, 1)
    m.dome_card("mid_r", mid, P(-0.02, -0.02), P(1.45 + j(0.1), 0.5), 1.45 * s * rng.uniform(0.92, 1.08), 0.14 * s, 1, 0.36, 1)
    # the long low dome at the foot
    m.dome_card("foot", low, P(-1.25 + j(0.15), 1.05), P(1.05 + j(0.15), 1.18), 0.75 * s, 0.12 * s, 1, 0.5, 2)
    # stone outcrops round the foot
    spots = [(-2.0, 0.8, 0.8, 0.6), (1.85, 0.85, 0.7, 0.52), (0.45, 1.6, 0.6, 0.42)]
    for i, (x, z, w, h) in enumerate(spots):
        q = P(x + j(0.12), z + j(0.08))
        stone_pair(m, f"stone{i}", stone, q.x, q.z, w * s, h * s, j(0.35), 0.62 + i * 0.1, 3)
    return m, {"W": 4.6 * s, "D": 3.0 * s, "H": 3.0 * s}


def outcrop(name, stone, seed, scale=1.0):
    """A rock outcrop like papertrails' rocks tile: overlapping stone pairs, the big ones at the back."""
    import random as _r
    rng = _r.Random(seed)
    m = Model(name)
    s = scale
    j = lambda a: rng.uniform(-a, a)
    spots = [(-0.35, -0.45, 1.1, 0.95), (0.5, -0.3, 0.95, 0.8), (-0.75, 0.25, 0.7, 0.55), (0.25, 0.35, 0.75, 0.6), (0.85, 0.6, 0.45, 0.35)]
    for i, (x, z, w, h) in enumerate(spots):
        stone_pair(m, f"stone{i}", stone, (x + j(0.1)) * s, (z + j(0.06)) * s, w * s * rng.uniform(0.9, 1.1), h * s * rng.uniform(0.9, 1.15), j(0.3), i * 0.14, i * 2)
    return m, {"W": 2.2 * s, "D": 1.6 * s, "H": 1.0 * s}


# ------------------------------------------------------------------------------------------------------------------
# a wooden pier (walkable: the game reads its deck height from the root's extras): two side boards stand up off the page,
# the deck folds over from the left board in square sections (so the printed planks keep their size), crossed posts
# stand at the corners and along both sides, reaching down into the water. It runs along +z, the shore end at -L/2.

def pier(name, L=3.0, W=0.62, H=0.16):
    m = Model(name)
    art = "pier-plank"
    left = m.card("side_l", None, art, (V(-W / 2, 0, -L / 2), V(-W / 2, 0, L / 2), V(-W / 2, H, L / 2), V(-W / 2, H, -L / 2)), FULL,
                  (V(-W / 2, 0, -L / 2), V(0, 0, 1)), V(-1, 0, 0), 0.0)
    m.card("side_r", None, art, (V(W / 2, 0, L / 2), V(W / 2, 0, -L / 2), V(W / 2, H, -L / 2), V(W / 2, H, L / 2)), FULL,
           (V(W / 2, 0, -L / 2), V(0, 0, 1)), V(1, 0, 0), 0.05)
    n = max(1, round(L / (W + 0.06)))
    ov = 0.03
    for k in range(n):
        z0 = -L / 2 + L * k / n
        z1 = -L / 2 + L * (k + 1) / n
        # planks across the deck: the swatch's planks run along its width (a), so a runs across the pier
        m.card(f"deck{k}", left, art, (V(-W / 2 - ov, H, z1), V(W / 2 + ov, H, z1), V(W / 2 + ov, H, z0), V(-W / 2 - ov, H, z0)), FULL,
               (V(-W / 2, H, -L / 2), V(0, 0, 1)), V(0, -1, 0), 0.2 + 0.3 * k / max(1, n - 1))
    # posts: two crossed narrow cards each, from below the waterline to a hand above the deck
    pw, top, foot = 0.07, H + 0.13, -0.3
    zs = [-L / 2 + 0.08 + (L - 0.16) * t / 3 for t in range(4)]
    for k, z in enumerate(zs):
        for side, x in (("l", -W / 2 - 0.04), ("r", W / 2 + 0.04)):
            for j, (ux, uz) in enumerate(((0.7071, 0.7071), (0.7071, -0.7071))):
                u = V(ux, 0, uz) * (pw / 2)
                c = V(x, foot, z)
                m.card(f"post{k}{side}{j}", None, art, (c - u, c + u, c + u + V(0, top - foot, 0), c - u + V(0, top - foot, 0)), FULL,
                       (c, u), V(-uz, 0, ux), 0.6 + 0.1 * k, thin=True)
    return m, {"W": W, "D": L, "H": H, "deck": H + THICK}


# ------------------------------------------------------------------------------------------------------------------
# a footbridge (the papercraft skill's bridge, built-ground.js there, at our scale: hero 0.58 against its 3.6). It runs
# along +z, its banks at z = +-L/2.
#   DECK   a ramp hinged on each bank rising RAMP_DEG over RAMP_SHARE of its half span, a crown panel hinged on the
#          ramp's top edge bent back to CROWN_DEG; folded, the ramps and crowns lie flat over the water
#   SIDES  a card along each deck edge, its foot on the page, an arch cut under the deck, its top the deck line plus a
#          parapet, leaning LEAN_DEG outward (a trough: from along the bridge both printed faces show); a second, lower,
#          darker card just outside it for the side's thickness; newel posts at both ends of the inner card, facing
#          along the span; folded, the sides lie flat outward
# The game reads its walkable deck from the root's extras: deck (height at the banks), rise (at the middle) and the
# profile's ramp share and angles.

BRIDGE = {"ramp_deg": 26.0, "crown_deg": 8.0, "ramp_share": 0.55, "lean_deg": 18.0}


def bridge(name, L=1.7, W=0.75, rail=0.18, base=0.002):
    m = Model(name)
    half = L / 2
    A1 = math.radians(BRIDGE["ramp_deg"])
    A2 = math.radians(BRIDGE["crown_deg"])
    lean = math.radians(BRIDGE["lean_deg"])
    z1 = half - BRIDGE["ramp_share"] * half  # where the ramp meets the crown
    h1 = (half - z1) * math.tan(A1)

    def deck_h(u):
        u = abs(u)
        return 0.0 if u >= half else (half - u) * math.tan(A1) if u >= z1 else h1 + (z1 - u) * math.tan(A2)

    top = deck_h(0.0)
    # the deck: a ramp on each bank, a crown panel riding on its top edge
    for s in (1, -1):
        foot, edge, apex = base, base + h1, base + top
        ramp = m.card(f"ramp{'n' if s > 0 else 's'}", None, "pier-plank",
                      (V(-s * W / 2, foot, s * half), V(s * W / 2, foot, s * half), V(s * W / 2, edge, s * z1), V(-s * W / 2, edge, s * z1)),
                      FULL, (V(-s * W / 2, foot, s * half), V(1, 0, 0)), V(0, 0, -s), 0.0)
        up_ramp = V(0, h1, -s * (half - z1)).normalized()
        m.card(f"crown{'n' if s > 0 else 's'}", ramp, "pier-plank",
               (V(-s * W / 2, edge, s * z1), V(s * W / 2, edge, s * z1), V(s * W / 2, apex, 0), V(-s * W / 2, apex, 0)),
               FULL, (V(-s * W / 2, edge, s * z1), V(1, 0, 0)), up_ramp, 0.15)
    # the sides: the outline along the span (a: 0..1 over -ext..ext, b: up the card), the arch under the deck
    ext = half * 1.06
    aw, ah = half * 0.6, max(0.016, top * 0.72)

    def side_poly(parapet, height):
        A = lambda t: (t + ext) / (2 * ext)
        pts = [(0.0, 0.0), (A(-aw), 0.0)]
        for i in range(1, 16):
            a = math.pi - math.pi * i / 16
            pts.append((A(math.cos(a) * aw), math.sin(a) * ah / height))
        pts += [(A(aw), 0.0), (1.0, 0.0)]
        for i in range(25):
            t = ext - 2 * ext * i / 24
            pts.append((A(t), (deck_h(t) + parapet * (0.85 if abs(t) > half else 1.0)) / height))
        return pts

    for sg in (1, -1):
        for outer in (False, True):
            parapet = rail * (0.62 if outer else 1.0)
            height = top + parapet
            x0 = sg * (W / 2 + 0.016 + (0.045 if outer else 0.0))
            up = V(sg * math.sin(lean), math.cos(lean), 0) * height
            # (the printed face looks outward; a runs from -ext to +ext seen from outside)
            za, zb = (ext, -ext) if sg > 0 else (-ext, ext)
            c00, c10 = V(x0, 0, za), V(x0, 0, zb)
            side = m.card(f"side{'l' if sg < 0 else 'r'}{'o' if outer else ''}", None, "pier-plank-dark" if outer else "pier-plank",
                          (c00, c10, c10 + up, c00 + up), side_poly(parapet, height), (V(x0, 0, -ext), V(0, 0, 1)), V(sg, 0, 0),
                          0.4 if outer else 0.35)
            if outer:
                continue
            # newel posts at both ends of the inner side, riding on it, facing along the span (a little inside it)
            pw, ph = 0.08, rail * 1.25
            inward = V(-sg * math.cos(lean), math.sin(lean), 0) * 0.04
            for ze in (ext, -ext):
                o = V(x0, 0, ze) + inward
                lean_up = V(sg * math.sin(lean), math.cos(lean), 0) * ph
                zs = 1 if ze > 0 else -1
                # (its face looks out along the span, away from the bridge)
                a0, a1 = (o + V(-zs * pw / 2, 0, 0), o + V(zs * pw / 2, 0, 0))
                m.card(f"post{'l' if sg < 0 else 'r'}{'n' if ze > 0 else 's'}", side, "pier-plank",
                       (a0, a1, a1 + lean_up, a0 + lean_up), FULL, (a0, V(1, 0, 0)), V(0, 0, zs), 0.6)
    dims = {"W": W, "D": L, "H": base + top + rail, "deck": base + THICK, "rise": top,
            "rampShare": BRIDGE["ramp_share"], "rampDeg": BRIDGE["ramp_deg"], "crownDeg": BRIDGE["crown_deg"]}
    return m, dims


# ------------------------------------------------------------------------------------------------------------------
# Blender scene + export

def build_blender(models):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = bpy.context.scene.collection
    mat = bpy.data.materials.new("paper")
    for model, dims in models:
        root = bpy.data.objects.new(model.name, None)
        root["model"] = model.name
        root["width"] = dims["W"]
        root["depth"] = dims["D"]
        root["height"] = dims["H"]
        for key in ("deck", "rise", "rampShare", "rampDeg", "crownDeg"):
            if key in dims:
                root[key] = dims[key]  # a pier's / bridge's walkable deck: its height at the ends, its rise and profile
        col.objects.link(root)
        objs = {}
        for p in model.pieces:
            parent_frame = p.parent.frame if p.parent else Matrix.Identity(4)
            local = parent_frame.inverted() @ p.frame
            inv = p.frame.inverted()
            verts = [(C @ (inv @ v.to_4d())).to_3d() for v in p.verts]
            mesh = bpy.data.meshes.new(f"{model.name}__{p.name}")
            mesh.from_pydata([tuple(v) for v in verts], [], p.faces)
            mesh.update()
            uv = mesh.uv_layers.new(name="UVMap")
            for poly, corner_uvs in zip(mesh.polygons, p.uvs):
                for k, loop_index in enumerate(poly.loop_indices):
                    uv.data[loop_index].uv = corner_uvs[k]
            mesh.materials.append(mat)
            obj = bpy.data.objects.new(f"{model.name}__{p.name}", mesh)
            col.objects.link(obj)
            obj.parent = objs[p.parent.name] if p.parent else root
            obj.matrix_parent_inverse = Matrix.Identity(4)
            obj.matrix_basis = C @ local @ C_INV
            obj["hinge"] = True
            obj["foldAngle"] = round(p.fold, 5)
            obj["delay"] = round(min(1.0, max(0.0, p.delay)), 3)
            if p.layer:
                obj["layer"] = p.layer
            objs[p.name] = obj
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_yup=True,
        export_extras=True,
        export_apply=False,
        export_materials="PLACEHOLDER",
        export_animations=False,
    )


def main():
    models = [
        gable_house("cottage", 1.0, "cottage-front", "cottage-side", "cottage-roof", chimney="cottage-chimney"),
        gable_house("tavern", 1.15, "tavern-front", "tavern-side", "tavern-roof", chimney="cottage-chimney", sign="tavern-sign"),
        gable_house("warehouse", 1.25, "warehouse-front", "warehouse-side", "warehouse-roof"),
        chapel("chapel"),
        fort_tower("fort"),
        lighthouse("lighthouse"),
        stilt_hut("hut"),
        ridge("ridge-rock", "rock", "rock", 11),
        ridge("ridge-rock-b", "rock", "moss", 12),
        ridge("ridge-forest", "forest", "moss", 23),
        ridge("ridge-forest-b", "forest", "rock", 24),
        ridge("ridge-snow", "snow", "rock", 37, 1.12),
        ridge("ridge-snow-b", "snow", "rock", 41, 1.05),
        ridge("ridge-volcano", "volcano", "basalt", 53, 1.05),
        ridge("ridge-sand", "sand", "sandstone", 61),
        ridge("ridge-hill", "hill", "moss", 67, 0.8),
        outcrop("outcrop-rock", "rock", 71),
        outcrop("outcrop-moss", "moss", 73),
        outcrop("outcrop-sandstone", "sandstone", 79),
        pier("pier"),
        bridge("bridge"),
    ]
    build_blender(models)
    for m, d in models:
        print(f"model {m.name}: {len(m.pieces)} pieces, " + ", ".join(f"{k} {v:.3f}" for k, v in d.items()))


main()
