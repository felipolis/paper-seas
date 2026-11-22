# Paper Seas

Sail a paper pirate ship across an endless pop-up ocean. Waves, islands and everything on them fold up out of the
page as you approach and fold flat again behind you.

Vite + TypeScript + Three.js, no framework.

## Run

```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # typecheck + production build in dist/
npm run art:cut  # re-cut the sprite sheets (assets-src/flow) into public/art
node tools/art/audit-pages.mjs  # large audit pages of every sprite on a dark ground
node tools/qa/world-qa.mjs 1234,7,42   # world QA against the running dev server (see below)
```

### Buildings (Blender)

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

### The ship's hull (Blender)

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

The captains are paper puppets cut like papertrails' traveller (`tools/blender/build_crew.py`): flat cards with a
thickness, each one flat colour by vertex colour with the paper's cream cut edge, a profile card crossed with a front
card for the torso and the head (two dot eyes), thin profile cards for the legs and arms, stepped discs and cut cards
for the hats, a lantern in the right hand; `src/player/puppet.ts` walks with papertrails' gait (legs and arms on the
step's phase, the torso and the head lagging it, the lean and roll springs, the lantern a lagging pendulum) and steers.
Mountains are built like papertrails' dunes, hills and rocks: no solids, cards. `tools/art/paint-domes.mjs` paints
rounded dome faces and stone slabs (bands of colour from a darker foot to a pale cap, printed over the grain of a terrain
swatch, the pale paper rim of the cut along the outline) and writes each outline to `assets-src/models/domes.json`;
`build_models.py` cuts curved cards to those outlines: a tall pair in a V at the back, a smaller pair in front, a long
low dome at the foot, outcrops of overlapping stone pairs (`ridge-*`, `outcrop-*`). Folded, they lie face up behind
their feet, stacked front over back (glTF extra `layer`).

Villages have Blender-built wooden piers running straight out from the beach (`pier` in models.glb, its deck height
in the root's extras): you can walk out along the planks, and step ashore from the ship straight onto one.

## Controls

| Key | Action |
| --- | --- |
| W / S | Raise / lower sails (furled → courses → all sails) |
| A / D | Helm (port / starboard) |
| S with sails furled | Back-paddle |
| Mouse wheel | Zoom |
| T (hold) | Fast-forward the clock |
| M | Mute / unmute |
| Esc | Pause menu |
| E / Tab | Voyage chart (drag to pan, wheel to zoom) |
| F | Go ashore by a coast or onto a pier (walk with WASD, Shift to run), F again by the ship to go back aboard |

Pick your ship and captain in the shipyard (Esc). Sail close to an island to discover it; nose the bow onto a beach that has a chest to find its treasure. Whales,
dolphins, turtles, sharks and the odd kraken show up along the way. Progress is kept in localStorage.

## Structure

```
src/
  main.ts            entry point
  app/               game wiring and frame loop
  config/            all tunables (palette, pop-up springs, ship, world, camera/lights/post)
  core/              rng, math, input
  popup/             pop-up physics (springs), hinge groups, card meshes
  art/               canvas card painter, sprites (cut cards), the stern lantern painter
  sea/               sea page shader, standing wave cards
  world/             the land field and islands, terrain chunks (one flat sheet cut to the shore; the ground's shader
                     draws the roads, grass and flowers: ground-shader.ts; streams are ribbons of the sea's water:
                     stream-mesh.ts), the card field and its animals (critters.ts), the
                     Blender-built models (models.ts); what stands up when (reveal.ts) and how it sways (wind.ts);
                     ground cover by tiles (cover.ts); streams, sites, roads and bridges (places.ts); what stops the
                     feet (blockers.ts)
  ship/              hull shape, model, cloth (sails, flag), physics with inertia, controller
  camera/            diorama follow camera
  render/            renderer, lights, paper material, soft paper shadows (shadows.ts), post (tilt-shift, night grade)
  ui/                HUD and pause menu (Esc)
  life/              sea creatures and gulls, ambient bits (leaves, butterflies, motes, fireflies), chimney smoke,
                     the camera-to-captain line they keep clear of (clear-line.ts)
  game/              voyage progress (discoveries, treasure)
  audio/             synthesised sound: felt-piano barcarolle (notes made in a worker), paper flaps, footsteps, sea
tools/qa/            world QA: plays the dev build headless and checks the world
assets-src/          generated art sources (Flow prompts and sheets) and audit pages
tools/art/           sprite sheet cutter (cut-sprites: keeps and trims papertrails' cream die-cut edge for the game's
                     sprites; peels the margin of the models' printed faces) and audit (audit-sprites: contact sheet)
public/art/          cut sprites + manifest (loaded at startup)
public/models/       Blender-built models (models.glb, crew.glb, ship-*.glb), their printed atlas and textures
tools/blender/       Blender build scripts (buildings, mountains, pier and bridge; the ships; the crew)
tools/ship/          exports the hull shape for the Blender build
assets-src/models/   cut and painted faces of the models, the atlas layout (atlas.json), the dome outlines (domes.json)
```

The world is a pure function of the seed (`config/world.ts`): sail back to a place and it is the same. Every new
voyage draws a new seed (or takes the one typed in the pause menu).

### papertrails' rules

What papertrails does, Paper Seas does the same way (its traveller is as tall as our captain, so its sizes carry over):

- **What stands up** (`world/reveal.ts`): the land rises by 2 x 2 cells within 6 units of a point 2.7 ahead of the
  captain or the ship, rippling outward 0.055 s per cell; as the camera pulls back the ring grows by papertrails' view
  reach (0 at its 10.8 framing, 0.9 tiles at its 14.5 wide view, at most 1.5 tiles), the rest unchanged; the land, the
  waves and what is adrift all keep to it, and whatever it has not raised lies folded flat, face up, in view;
  the rows behind fold from the track outward; a cell flips at most once per 2 s; the anchor trails on a 1-unit rope.
  A cell's cards start over 0.34 s, ground cover first and the tallest last, and fold in the reverse order.
  Folded flat, every piece (cards, buildings, mountains, piers and bridges alike) fades with its distance from the
  captain or the ship into papertrails' pencil plan of the unpainted book: full colour within 6.8, beyond 9.6 a pale
  cream wash keeping a quarter of its colour, pencil outlines and a little hatching (render/paper-material.ts).
- **Never a blank back**: cards and model pieces are printed on both faces, so whatever way they fold, a print lies up.
- **The art** (`assets-src/prompts`, `tools/art/cut-sprites.mjs`): every sprite is papertrails' kind of piece, a
  die-cut sticker of layered felt and cut paper with stitched details and no ink outline, in a warm palette, with its
  own printed cream die-cut edge: the cutter keeps the border the generator prints (`keepEdge`), measures it on each
  piece and shaves or widens it to papertrails' measure for its kind (measured on its atlas, a share of the height:
  rocks 3.4 %, bushes 3.2 %, stumps 2.1 %, most pieces 1.8 %, trees and ferns 1.5 %), in papertrails' cream (#fce6b6,
  #fce4ad on greenery and rocks) with a crisp cut; pieces of one item cut apart by a narrow gap are joined (`merge`).
- **Cardstock** (`popup/card.ts`, `tools/blender/build_models.py`): every card is 0.016 thick (papertrails'
  cardThickness); its face is shaded from 0.787 at the hinge to full colour 0.21 above it (papertrails' contact
  shading, baked per vertex), the cards of a clump darker toward its back (0.69 to 1, its instance colour), its cut edge is the piece's
  own tone darkened per channel (0.62, 0.65, 0.78); crossed trees turn 0.6 of the others' jitter, ferns stand single.
- **Biome tints** (`render/biome-tint.ts`): papertrails' colour transforms per biome on the printed ground (blended
  over a tile), on every card and model standing there and on the roads: the meadow takes its blossom row, the pine
  woods its pinewood (a teal wood, a pine-needle track, darker streams), the jungle and the rocks its heartland
  (unchanged); the streams take papertrails' water of the biome (shallow, deep, rim, floater), petals in the blossom.
- **Sizes and density** (`config/flora.ts`, `world/cover.ts`): trees about 1.1, pines 1.3, bushes 0.4, flowers and
  grass 0.3, houses 1.1, a hen a third of the captain (and under everything that stands, papertrails' soft darker contact
  patch on the ground); the ground is planted by 2 x 2 tiles, each one composition
  mixing a few tall species near its corners with clumps of ground cover and flowers, a small prop or two (a stump, a
  log, mushrooms, coconuts, shells, a woodpile) and about one animal, the woods massing where a low-frequency field is
  high. Like papertrails' tiles (measured on its tiles.glb: 9 or 10 cards, 7 to 10 drawings) a tile hands out its
  species before repeating one (four pines, three broadleaf trees, two blossoms to draw from), and a clump is one to
  four cards of different species, the tallest at the back; the low cover is drawn as wide low drifts (about 2.4 x as
  wide as tall), the ferns as compact clumps. Villages have a well, stalls, laundry, bunting, carts, benches, lamps, hives and fences and their hens, chicks,
  cats, dogs, pigs and goats; every few units of road a signpost, guidepost, bench, cart, lamp or barrel stands by it;
  now and then a lookout tower or a camp of tents round a fire stands in the wild.
- **Roads and streams** (`world/places.ts`): streams run from a spring inland down to the sea; villages, ports, inland hamlets and ruins are joined by roads routed over the land (noise, turn cost, hills
  dear), crossing streams on bridges; lanes lead to every door and pier.
  A stream rises at papertrails' spring: a stone mound card with the water's mouth, three crags in a horseshoe behind
  it, reeds and a frog on the pool's bank; reeds stand along its banks, ducks float on it, frogs and herons wait at the
  edge.
- **A flat page**: the land is one sheet of paper cut to the shore; relief comes only from what stands on it. The world
  is mostly sea (the land is under a third of it).
- **Paths as printed** (`world/ground-shader.ts`): roads, lanes and squares are drawn into the ground by papertrails'
  road terms (soft edge, halo, fringe, worn middle, pebbles), with grass tufts and flowers; lanes branch from the square
  and from one another like trodden paths. No standing card's blocking foot comes within 0.12 of a path's edge.
- **Streams are sea water** (`world/stream-mesh.ts`, `sea/water.ts`): the same colours and fibre as the sea,
  in depth steps, with current dashes flowing down, papertrails' floating leaves (with their shadow and midrib) and
  faint current lines riding the same flow, and a sandy cut bank; each rises in a round pool at its spring and ends in
  an inlet the sea cuts up its bed.
- **Wind** (`world/wind.ts`): every standing card rocks by its height, thinness and kind, in travelling gusts.
- **Collisions as drawn** (`world/blockers.ts`, `player/walker.ts`): only what stands between 0.07 and 0.3 above the
  page stops the feet; crossed cards and mountains block their whole footprint and, as papertrails closes its field
  (closeRadius 0.2), a gap narrower than 0.4 between two pieces is filled (no pockets to wedge in). The captain
  moves on a clearance field: a step is taken if it leaves room or is no tighter than where he stands, a blocked step
  slides along the obstacle or goes round it, so he is never pinned.
- **Light** (`render/shadows.ts`, `config/time.ts`): soft paper shadows (PCSS) with a warm leak, papertrails' key and
  fill by day, its moon and night grade (blue tint, low saturation) by night, a lantern on the captain. The clock eases
  from papertrails' day look into its night look over an hour and a half round dusk (and back round dawn): only its two
  looks, mixed.
- **Life** (`life/`, `world/critters.ts`): papertrails' densities per biome (its rows mapped to ours: the meadow its
  blossom, the pine woods its pinewood, the jungle and rocks its heartland, sand its desert): falling leaves in five
  autumn colours and blossom petals that settle and fade, drifting dust, butterflies with hinged wings, fireflies over
  the banks at night, rain with splash rings and soft mist in the pine woods, flocks of birds crossing in a V with their
  shadows on the ground, chimney smoke by day, gulls round the ship; every bit fades where it would cross the camera's
  line to the captain. Animals live as papertrails' do: they idle and walk about their home (a paper hop and roll per
  step), hens peck, goats graze, cats nap, ducks float in slow arcs on the streams; near the captain they freeze, then
  bound, dart, flutter or shuffle off and make a new home there; at night grazers stand still and pets doze. They
  walk on the captain's clearance field (papertrails' minClear 0.07), so they go round trees, rocks, fences and houses.
  papertrails' vignettes tie some to a piece: a cat sitting on a fence, a barrel, the well or a bench, a cat by a door,
  a dog by the cart or the well, hens by a fence, an owl at the top of a watchtower, a gecko at a tree's trunk, a boar
  half hidden behind one; they mostly keep their place, and leave a seat with a paper leap down.
- **Footsteps** (`audio/paper-synth.ts`): a synthesised paper step on every footfall, its timbre set by the ground
  (grass, path, a deck).
- **The camera on foot** (`camera/follow-camera.ts`): papertrails' follow camera as it is: a 27 degree lens at 10.8, 42
  degrees down; a still zone round the captain where it does not move, a soft zone that picks up his step, hard edges;
  after a moment of steady walking the window travels with him and leads; an exact critically damped spring; a slow
  tripod drift; the lens eases up or round when a building hides him.
- **A quiet HUD**: one line of hints that fades as soon as you get under way; the ship's panel goes when ashore.
- **Haze and depth of field** (`render/post.ts`): the far page fades into warm haze from 6.5 to 13.5 units (at a 17-unit
  framing, scaled with the focus distance). The blur is papertrails' tilt-shift: each pixel blurred by a mix of its
  height on screen and its depth (0.8 depth: the pieces blur in layers), a sharp band round the focus that grows with a
  close camera, a near-field tile pass so the foreground blurs over the sharp band, a near / far aware bokeh gather and a
  fill pass.

### World QA

`node tools/qa/world-qa.mjs <seeds>` (with `npm run dev` running) visits settlements and the wild interior of each
seed, puts the captain ashore and checks for holes in the paper, floating or wet cards and models, cards on roads,
lanes and streams, overlapping buildings, roads crossing streams without a bridge, the captain stuck or held up
walking a road, and a world with too little open sea. It prints each issue with its position and exits 1 if any.

## Deploy

The game is a static site served by Cloudflare Workers (`wrangler.jsonc`: `dist/` as its static assets). The `Deploy`
workflow (`.github/workflows/deploy.yml`) type-checks and builds every pull request, and on every push to `main` also
deploys with `wrangler deploy`. It needs two repository secrets: `CLOUDFLARE_API_TOKEN` (a token made from the "Edit
Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`.

## Credits

Inspired by [papertrails](https://github.com/xikhar/papertrails) by xikhar (MIT licence), whose look and rules it
follows. The felt-piano voice and its hall (`src/audio/piano-synth.ts`, `src/audio/music.ts`) and the paper-flap
synthesis and voice allocation (`src/audio/paper-synth.ts`, `src/audio/paper-voices.ts`) are ported from its
`src/audio`, and many of its shaders and tunables are ported throughout (credited where they are used); the music
played on that piano is Paper Seas' own. The printed art was generated with Google Flow and cut into cards by
`tools/art`.

## License

[MIT](LICENSE). The parts ported from papertrails keep its MIT notice, included in the same file.
