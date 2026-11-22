# The art pipeline

How the printed cards, the Blender-built buildings, mountains, ships and captains are made. Back to the [README](../README.md).

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
node tools/ship/export-crew.mjs && "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup -P tools/blender/build_crew.py
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

The captains are paper puppets cut like papertrails' traveller (`tools/blender/build_crew.py`): flat cards with a
thickness, each one flat colour by vertex colour with the paper's cream cut edge, a profile card crossed with a front
card for the torso and the head (two dot eyes), thin profile cards for the legs and arms, stepped discs and cut cards
for the hats, a lantern in the right hand; `src/player/puppet.ts` walks with papertrails' gait (legs and arms on the
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
