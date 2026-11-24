# The art pipeline

How the printed cards, the Blender-built buildings, mountains, ships and captains are made. Back to the [README](../README.md).

## The cards

Every sprite starts as a sheet of die-cut paper cards generated in Google Flow (Nano Banana Pro), saved in
`assets-src/flow`, and is cut out into `public/art`. The sheets follow the papercraft skill's look
([xikhar/papercraft](https://github.com/xikhar/papercraft), `references/image-gen.md`): printed layered paper collage
with lit-side lips and bold ornaments on plants, cloth, wood and buildings (stone, water and animals stay plain), a thin
dark cut line with a pale highlight on its lit side, never felt, stitching or an even cream sticker rim. A prompt is its
sheet's subject (`assets-src/prompts/NN-*.txt`) followed by the shared style (`assets-src/prompts/style.txt`, with
KEY set to the sheet's key colour: magenta `#FF00FF`, green `#00FF00` where a piece is pink or purple), generated
with two reference images attached: `assets-src/flow/00-style-sheets.jpg` (finished sheets of this set) and
`00-style-oasis.jpg` (a frame of the skill's gallery, MIT licence).

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
comment describes its options (the key colour, `merge` for pieces of one item cut apart by a narrow gap, the white
sheets' `clean` modes). A tall piece spanning both rows makes its sheet read as one row, left to right. The audit
pages are generated and not kept in git.

## Buildings (Blender)

Villages, lighthouses and forts are real paper constructions built by a Blender script, like papertrails' tiles:

```bash
node tools/art/cut-sprites.mjs tools/art/model-sheets.json   # cut the printed faces (assets-src/flow/19-21)
node tools/art/paint-domes.mjs                               # paint the mountains' dome and stone faces (+ domes.json)
node tools/art/pack-atlas.mjs                                # pack them into public/models/atlas.png, measure gables
"C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/build_models.py
```

The script (`tools/blender/build_models.py`) assembles each model from hinged card pieces (front wall, side walls
swinging out of it, roof planes folding over from the walls, chimney, sign, belfry and spire, battlements, lantern
room...) and writes `public/models/models.glb`: every piece is a node on its fold line with glTF extras
`{ hinge, foldAngle, delay }`. In the game (`src/world/models.ts`) each building becomes one skinned mesh (one draw
call) whose bones unfold through the same paper springs as every card; the atlas is drawn with the paper material, and
its printed windows light up at night.

## The ship's hull (Blender)

```bash
node tools/art/cut-sprites.mjs tools/art/ship-sheets.json   # printed wood, ship details, terrain swatches
bash tools/ship/build-ships.sh                              # export each ship's shape, build it in Blender
```

Every ship has her own structure (`HullSpec` in `src/config/ships.ts`): which decks and castles she has (poop,
quarterdeck, forecastle) and how high, her plan, sweep and tumblehome, her gun decks, wood and carvings. The shape
functions (`src/ship/hull-shape.ts`) are shared by the game and, through `tools/ship/export-shape.mjs`, by Blender,
which builds her from printed planking (`tools/blender/build_ship.py`): banded hull with mouldings, bulwarks and rail,
decks, cabin fronts with doors and windows at every break, balustrades along the castles, a lit stern gallery, quarter
galleries, crest, beakhead and figurehead, guns run out of every port, chainwales, anchors, rudder, fittings, wheel.
The ghost ship (`broken` in her spec) is a whole wreck, not a broken model: her rails run smooth but for three
breaches torn through with splintered ends, weed hangs over the rails in clumps and loops along her side, holes are torn
in her upper works; her fittings are drowned grey and her windows light green (`fittings`, `windowLight`,
`detailTint`).

No two ships share a silhouette. Each mast says how it is rigged (`rig`): `square` (sails across the ship on their
yards), `lateen` (one triangular sail laced to a long slanted yard) or `battened` (a junk's fore-and-aft sail stiffened
by battens), and how it stands (`rake`, `lean`, a `sprung` topmast hanging in its rigging). The galleon is a tall
three-tier stern with a lion figurehead and a lateen mizzen; the shadow a long low raider with a ram, raked masts and a
serpent figurehead; the ghost ship four crooked masts, one topmast snapped, a maiden figurehead; the frigate a long
flush deck with two rows of guns; the junk three battened sails and painted eyes. Figureheads and lateen sails are
printed cards (`assets-src/flow` sheets 34 and 35). The cutter clears the paper left inside sails and balustrades
with its `clean` modes: `holes` for torn cloth, `sheet` for the sheet's plain white showing through a tear, `rails`
for the openings of a balustrade (rows of like openings, so a painted eye or stripe stays).

## The captains

The captains are small paper models built in the game from their outfits (`src/player/crew-model.ts`, each after its
picture in the shipyard), the way papertrails builds its traveller (`public/models/traveller.glb` there, read piece by
piece): every piece a die-cut slab in one flat colour with a pale cream cut edge, layered and slotted through each
other. The face is a frontal card with the head's profile card slotted through its middle (the profile's front edge is
the nose and the chin), a thicker hair card round the profile and a hair card behind the face, small eye cards on the
face and on both sides of the profile; the body is a frontal and a profile card in a cross with what is worn layered on
it (a waistcoat, braid, buttons, a belt in a cross of its own, a jabot, a scarf); the arms and the legs are profile cards
only (a sleeve bent forward, a thicker cuff, a hand; trousers, a thicker cuff, a boot with its toe); a hat is level discs
stacked from the brim up, tilted a little back. Pieces on one joint are slotted together on purpose; pieces on joints
that move against each other never cut into each other: the arms hang beside the body, what hangs below the waist (a
coat's tails, an apron) is cut in two and hung on the legs, and `node tools/qa/crew-clips.mjs` poses every captain
standing, walking, turning and at the helm and lists any pair that does. `src/player/puppet.ts` walks with papertrails' gait (legs and arms on the
step's phase, the torso and the head lagging it, the lean and roll springs, the lantern a lagging pendulum) and steers.

## Mountains

Mountains are built like papertrails' dunes, hills and rocks: no solids, cards. `tools/art/paint-domes.mjs` paints
rounded dome faces and stone slabs (bands of colour from a darker foot to a pale cap, printed over the grain of a terrain
swatch, the pale paper rim of the cut along the outline) and writes each outline to `assets-src/models/domes.json`;
`build_models.py` cuts curved cards to those outlines: a tall pair in a V at the back, a smaller pair in front, a long
low dome at the foot, outcrops of overlapping stone pairs (`ridge-*`, `outcrop-*`). Folded, they lie face up behind
their feet, stacked front over back (glTF extra `layer`).

## Piers

Villages have Blender-built wooden piers running straight out from the beach (`pier` in models.glb, its deck height
in the root's extras): you can walk out along the planks, and step ashore from the ship straight onto one.
