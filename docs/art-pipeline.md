# The art pipeline

How the printed cards, the Blender-built buildings, mountains, ships and captains are made. Back to the
[README](../README.md).

## The cards

Every sprite starts as a sheet of die-cut paper cards generated in Google Flow (Nano Banana Pro), saved in
`assets-src/flow`, and is cut out into `public/art`. The sheets share one look: printed layered paper collage with
lit-side lips and bold ornaments on plants, cloth, wood and buildings (stone, water and animals stay plain), a thin dark
cut line with a pale highlight on its lit side, never felt, stitching or an even cream sticker rim. A prompt is its
sheet's subject (`assets-src/prompts/NN-*.txt`) followed by the shared style (`assets-src/prompts/style.txt`, with KEY
set to the sheet's key colour: magenta `#FF00FF`, green `#00FF00` where a piece is pink or purple, blue `#0000FF` where
it is both pink and green: the lily pads, 49, drawn seen from above as they lie on the water), generated with two
reference images attached: `assets-src/flow/00-style-sheets.jpg` (finished sheets of this set) and `00-style-oasis.jpg`
(a reference frame of the style).

The waves came out with olive and green-teal layers (the style's palette names olive and sage), so three were redone
one per sheet, blue only: the low swell (`06-waves-swell`) with the blue waves as its first reference, the big curl and
the tall wave (`06-waves-curl`, `06-waves-tall`) repainted from their own old cards (first reference) in the swell's
blues (second), the style's reference sentence read as "the first is the card to repaint, the second shows the colours
to repaint it in". Only the small wave still comes from `06-waves`.

```bash
npm run art:cut                                   # cut every sheet of tools/art/sprite-sheets.json into public/art
node tools/art/crop-card.mjs <sheet> <out> <x0> <y0> <x1> <y1>   # crop by hand a card the cutter cannot separate
node tools/art/audit-pages.mjs                    # large pages of every sprite on a dark ground (assets-src/audit)
node tools/art/audit-sprites.mjs                  # one contact sheet of them all (assets-src/audit-contact.png)
```

Each sheet entry names its cards in reading order (`null` for a piece the game does not use); the cutter's header
comment describes its options (the key colour, `tears` for torn cloth, `merge` for pieces of one item cut apart by a
narrow gap, the white sheets' `clean: open` and `keepPale`, a sheet's own `out` folder). A tall piece spanning both
rows makes its sheet read as one row, left to right. The audit pages are generated and not kept in git.

A sprite that stands on the land is used by its sheet in `src/config/flora.ts`: its height range, its stock, how it
rocks in the wind, whether the feet go through it and its tags (an animal, a crossed tree, a flower the butterflies
visit, a lamp, a perch, a doubled clump, one that may stand in the shallows, one the blossom leaves untinted). A name
without a sheet throws; an animal also needs its behaviour in `src/world/critters.ts`. A Blender model has its sheet in
`src/config/models.ts` (its role: a home, a store, a landmark, a landform or a deck, and its scale).

## The paper maps

`public/textures/paper` holds the paper every piece is printed on: the card stock's fibre (`card-albedo.png`) and
relief (`card-normal.jpg`), the rougher page stock of the ground (`page-albedo.png`, `page-normal.jpg`) and the strip
of stacked sheets on the land's cut edge (`edge-strip.png`). They are not generated here: they came with the ported
code, and LICENSE carries their notice. They are the one paper of the game: every card, model, the ground and the
water read them (`src/art/paper-maps.ts`), never a second set.

## Buildings (Blender)

Villages, lighthouses and forts are real paper constructions built by a Blender script. On a
fresh cut, run the ship's sheets first ([below](#the-ships-hull-blender)): `paint-domes.mjs` prints the mountains
over the terrain swatches (`assets-src/models/swatches`) and `pack-atlas.mjs` prints the pier's planks from
`public/models/tex/plank-oak.png`, both cut from them.

```bash
node tools/art/cut-sprites.mjs tools/art/model-sheets.json   # cut the printed faces (assets-src/flow/19-21)
node tools/art/paint-domes.mjs                               # paint the mountains' dome and stone faces (+ domes.json)
node tools/art/pack-atlas.mjs                                # pack them into public/models/atlas.png, measure, trace
"C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/build_models.py
```

The script (`tools/blender/build_models.py`) assembles each model from hinged card pieces (front wall, side walls
swinging out of it, roof planes folding over from the walls, chimney, sign, belfry and spire, battlements, lantern
room...) and writes `public/models/models.glb`: every piece is a node on its fold line with glTF extras `{ hinge,
foldAngle, delay }` (a start of its own only for a piece standing on the page: one hinged on another starts with it,
one construction, one start). Every piece is card 0.016 thick, the half cards of a slotted cross 40 % of that; a
piece printed with a cut-out shape (the chimney, the tavern sign) is cut to its print's outline,
traced from its alpha by `pack-atlas.mjs` (`tools/art/outline.mjs`), so its cut edge follows the drawing. In the game
(`src/world/models.ts`) each building becomes one skinned mesh (one draw call) whose bones unfold through the same paper
springs as every card; the atlas is drawn with the paper material, and its printed windows light up at night.

## The ship's hull (Blender)

```bash
node tools/art/cut-sprites.mjs tools/art/ship-sheets.json   # printed wood, ship details, terrain swatches
bash tools/ship/build-ships.sh                              # export shapes, trace the details, build in Blender
```

The wood and the details go to `public/models/tex`, loaded by the game; the terrain swatches (sheet 33) only feed
`paint-domes.mjs`, so they go to `assets-src/models/swatches` and stay out of the build. The snow swatch is cropped
by hand (`crop-card.mjs`, its slot in the sheet is `null`).

Every ship has her own structure (`HullSpec` in `src/config/ships.ts`): which decks and castles she has (poop,
quarterdeck, forecastle) and how high, her plan, sweep and tumblehome, her gun decks, wood and carvings. The shape
functions (`src/ship/hull-shape.ts`) are shared by the game and, through `tools/ship/export-shape.mjs`, by Blender,
which builds her from printed planking (`tools/blender/build_ship.py`): banded hull with mouldings, bulwarks and rail,
decks, cabin fronts with doors and windows at every break, balustrades along the castles, a lit stern gallery, quarter
galleries, crest, beakhead and figurehead, guns run out of every port, chainwales, anchors, rudder, fittings, wheel. Her
printed details (gun ports, galleries, windows, doors, crest, scroll, grating, eyes, figurehead) are glued-on layers
0.004 thick, cut to their prints' outlines (`tools/ship/trace-details.mjs`). The
gun port's print had a cannon painted in it, over the 3D barrel run out of the port: it was painted out by hand once
(its slot in the sheet is `null` in `ship-sheets.json`, so cutting the sheets again keeps the empty port). The ghost
ship (`broken` in her spec) is a whole wreck, not a broken model: her rails run smooth but for three breaches torn
through with splintered ends, weed hangs over the rails in clumps and loops along her side, holes are torn in her upper
works; her fittings are drowned grey and her windows light green (`fittings`, `windowLight`, `detailTint`).

No two ships share a silhouette. Each mast says how it is rigged (`rig`): `square` (sails across the ship on their
yards), `lateen` (one triangular sail laced to a long slanted yard) or `battened` (a junk's fore-and-aft sail stiffened
by battens), and how it stands (`rake`, `lean`, a `sprung` topmast hanging in its rigging). The galleon is a tall
three-tier stern with a lion figurehead and a lateen mizzen; the shadow a long low raider with a ram, raked masts and a
serpent figurehead; the ghost ship four crooked masts, one topmast snapped, a maiden figurehead; the frigate a long
flush deck with two rows of guns; the junk three battened sails and painted eyes. Figureheads and lateen sails are
printed cards (`assets-src/flow` sheets 34 and 35). The sails come on key-colour sheets like every sprite, so a tear
through the cloth shows the key and is keyed out with it; the shadow's torn sails (sheet 26) also set `"tears": 0.025`,
so a slit too narrow to show the key cleanly (a dark mix of cloth and key) is cut through as soon as its key tint
reaches that share of the key's span. The balustrades are Blender-built balusters, not prints.

## The captains

The captains are small paper models built in the game from their outfits (`src/player/crew-model.ts`, each after its
picture in the shipyard): every piece a die-cut slab in one flat colour with a pale cream cut edge, layered and slotted
through each other. The face is a frontal card with the head's profile card slotted through its middle (the profile's
front edge is the nose and the chin), a thicker hair card round the profile and a hair card behind the face, small eye
cards on the face and on both sides of the profile; the body is a frontal and a profile card in a cross with what is
worn layered on it (a waistcoat, braid, buttons, a belt in a cross of its own, a jabot, a scarf); the arms and the legs
are profile cards only (a sleeve bent forward, a thicker cuff, a hand; trousers, a thicker cuff, a boot with its toe); a
hat is level discs stacked from the brim up, tilted a little back. Pieces on one joint are slotted together on purpose
(and merged into one mesh, a draw per joint); pieces on joints that move against each other never cut into each other:
the arms hang beside the body, what hangs below the waist (a coat's tails, an apron) is cut in two and hung on the legs,
and `node tools/qa/crew-clips.mjs` poses every captain standing, walking, turning and at the helm and lists any pair
that does. `src/player/puppet.ts` walks them (legs and arms on the step's phase, the torso and the head lagging it, the
lean and roll springs, the lantern a lagging pendulum) and steers.

## Mountains

Mountains are built of cards, not solids. `tools/art/paint-domes.mjs` paints rounded dome faces and stone slabs (bands
of colour from a darker foot to a pale cap, printed over the grain of a terrain swatch, the pale paper rim of the cut
along the outline) and writes each outline to `assets-src/models/domes.json`; `build_models.py` cuts curved cards to
those outlines: a tall pair in a V at the back, a smaller pair in front, a long low dome at the foot, outcrops of
overlapping stone pairs (`ridge-*`, `outcrop-*`). Folded, they lie face up behind their feet, stacked front over back
(glTF extra `layer`).

## Piers

Villages have Blender-built wooden piers running straight out from the beach (`pier` in models.glb, its deck height
in the root's extras): you can walk out along the planks, and step ashore from the ship straight onto one.
