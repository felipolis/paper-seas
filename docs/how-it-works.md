# How it works

The code's layout, the rules it takes from papertrails and the world QA. Back to the [README](../README.md).

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
  player/            the captain ashore: the paper puppet, its walk (walker.ts), click / tap to walk with its route
                     finder and inked mark (click-walk.ts, route.ts, target-mark.ts)
  render/            renderer, lights, paper material, soft paper shadows (shadows.ts), post (tilt-shift, night grade)
  ui/                the interface as paper: hint, prompt and discovery cards, pause menu, shipyard, chart
  life/              sea creatures and gulls, ambient bits (leaves, butterflies, motes, fireflies), chimney smoke,
                     the camera-to-captain line they keep clear of (clear-line.ts)
  game/              voyage progress (discoveries, treasure)
  audio/             synthesised sound: felt-piano barcarolle (notes made in a worker), paper flaps, footsteps, sea
tools/qa/            world QA (plays the dev build headless and checks the world), the captains' and the models' clip checks
tools/media/         the README's screenshots (docs/media), taken headless from the dev build
docs/                these pages and the screenshots
assets-src/          generated art sources (Flow prompts and sheets) and audit pages
tools/art/           sprite sheet cutter (cut-sprites: keys the game's sprites out of their flat key colour; peels
                     the margin of the models' printed faces) and audit (audit-sprites: contact sheet)
public/art/          cut sprites + manifest (loaded at startup)
public/models/       Blender-built models (models.glb, ship-*.glb), their printed atlas and textures
tools/blender/       Blender build scripts (buildings, mountains, the pier and the skill's bridge: ramps and a crown
                     between sides leaning out; the ships)
tools/ship/          exports the hull shape for the Blender build
assets-src/models/   cut and painted faces of the models, the atlas layout (atlas.json), the dome outlines (domes.json)
```

The world is a pure function of the seed (`config/world.ts`): sail back to a place and it is the same. Every new
voyage draws a new seed (or takes the one typed in the pause menu).

## papertrails' rules

What papertrails does, Paper Seas does the same way (its traveller is as tall as our captain, so its sizes carry over):

- **What stands up** (`world/reveal.ts`): the land rises by 2 x 2 cells within 6 units of a point 2.7 ahead of the
  captain or the ship, rippling outward 0.055 s per cell; as the camera pulls back the ring grows by papertrails' view
  reach (0 at its 10.8 framing, 0.9 tiles at its 14.5 wide view, at most 1.5 tiles), the rest unchanged; the land, the
  waves and what is adrift all keep to it, and whatever it has not raised lies folded flat, face up, in view;
  the rows behind fold from the track outward; a cell flips at most once per 2 s; the anchor trails on a 1-unit rope.
  A cell's cards start over 0.34 s in flat-stack order (they fold back, so the nearest lies on top and rises first)
  and fold in the reverse order; each leans up to 2.5 degrees once it stands, and lies exactly flat when folded.
  A building opens as one, as papertrails' do (every piece of one construction shares its start): only a piece
  standing on the page starts on its own, and a piece that rides on another (a wall on the front, a roof on its wall)
  is pulled up by it as it opens, 0.02 s behind it (popup/spring.ts NESTED), so the planes of one construction never
  scissor. It takes its place in its cell's order, as papertrails' tiles have it (the small pieces in front, then the
  house, then the well and the tree behind): it starts after the cards nearer the camera than it and before those
  farther away, and folds in the reverse order (world/terrain.ts). Folded flat, no two pieces lie over each
  other closer than 0.001 (config/popup.ts flatStep), so no face flickers between two: the cards step up from those
  they cover (world/card-field.ts), and the pieces of a building that would meet (its two walls, its two roof slopes)
  are moved apart once per model, measured on its faces folded flat (world/models.ts separateFlat).
  Folded flat, every piece (cards, buildings, mountains, piers and bridges alike) fades with its distance from the
  captain or the ship into papertrails' pencil plan of the unpainted book: full colour within 6.8, beyond 9.6 a pale
  cream wash keeping a quarter of its colour, pencil outlines and a little hatching (render/paper-material.ts).
- **Never a blank back**: cards and model pieces are printed on both faces, so whatever way they fold, a print lies up.
- **The art** (`assets-src/prompts`, `tools/art/cut-sprites.mjs`): every sprite is the papercraft skill's kind of
  piece (look.md section 3, image-gen.md): a printed layered paper collage in a warm palette, its layers with pale lips
  on their lit side, bold ornaments (chevrons, zigzags, dots, scallops) on plants, cloth, wood and buildings, and the
  cut edge printed with it: a thin dark warm-brown line at the silhouette and a pale highlight just inside it on the lit
  side only, never an even cream sticker rim. The sheets are generated on a flat key colour and keyed out; pieces of
  one item cut apart by a narrow gap are joined (`merge`).
- **Cardstock** (`popup/card.ts`, `tools/blender/build_models.py`): every card is 0.016 thick (papertrails'
  cardThickness); its face is shaded from 0.787 at the hinge to full colour 0.21 above it (papertrails' contact
  shading, baked per vertex), the cards of a clump darker toward its back (0.69 to 1, its instance colour), its cut edge is the piece's
  own tone darkened per channel (0.62, 0.65, 0.78); crossed trees turn 0.6 of the others' jitter, ferns stand single.
  A crossed card (the trees in `config/flora.ts` `CROSSED`) is papertrails' slotted cross (its `tree` + `tree_xf` +
  `tree_xb`): the card, and two half cards 40 % as thick hinged on its two faces down its middle, folded flat against
  it while it lies and pulled open by it as it rises (the spring's nested linkage), so a lying cross reads as one card;
  the chimneys and the pier's posts (`tools/blender/build_models.py` `cross_halves`) are built the same way.
- **Biome tints** (`render/biome-tint.ts`): papertrails' colour transforms per biome on the printed ground (blended
  over a tile), on every card and model standing there and on the roads: the meadow takes its blossom row, the pine
  woods its pinewood (a teal wood, a pine-needle track, darker streams), the jungle and the rocks its heartland
  (unchanged); the streams take papertrails' water of the biome (shallow, deep, rim, floater), petals in the blossom.
- **Sizes and density** (`config/flora.ts`, `world/cover.ts`): trees about 1.1, pines 1.3, bushes 0.4, flowers and
  grass 0.3, houses 1.1, animals at most half the captain (the skill's creatures), every kind varied +-15 % (and under everything that stands, papertrails' soft darker contact
  patch on the ground: a disc under a card, the footprint under a building); the ground is planted by 2 x 2 tiles, each one composition
  mixing a few tall species near its corners with clumps of ground cover and flowers, a small prop or two (a stump, a
  log, mushrooms, coconuts, shells, a woodpile) and about one row of animals (papertrails' spawn rows: goats and pigs
  in herds, hens and songbirds in flocks by day, monkeys and lizards by day, a boar behind a tree by day and in the
  open at night, the tortoise by night, the owl by night up on a stump or a log; out of its hours an animal pops away
  and comes back when they return), now and then (one a square at most) a pen of goats in the meadow, the woods massing where a low-frequency field is
  high and clearings left where another is low (open ground between the groups, a low clump or two on it); no more than
  three of one prop or animal stand in any 9 x 9 square, about one on-foot view. Like papertrails' tiles (measured on its tiles.glb: 9 or 10 cards, 7 to 10 drawings) a tile hands out its
  species before repeating one (four pines, three broadleaf trees, two blossoms to draw from), and a clump is one to
  four cards of different species, the tallest at the back; the low cover is drawn as wide low drifts (about 2.4 x as
  wide as tall), the ferns as compact clumps; a lone tuft of grass, a reed bed, a bush, a boulder or a crag stands with
  papertrails' rear copy behind it (0.75 of its tone, 1.08 its size, about 0.13 further back), so it reads as a thick clump. Villages ring
  their square or, half of them, line a street through it (papertrails' village rows: the far side's houses face the
  camera and the street, the rest face it from the near side, the low props mostly on the near side so the street
  stays in sight); they have a well, stalls, laundry, bunting, carts, benches, lamps, hives and fences, flocks of hens
  and chicks by day, a few goats and a pig or two, and little scenes: a bed of flowers by a door, a pen of goats (or a
  pig), a handcart with its hay, a rowboat drawn up on the sand by the pier. A pen is papertrails' fence_pad: a diamond
  of low fence cards turned 45 degrees to the camera with a gate on the near side, too low to stop the feet. Every few units of road a
  guidepost, bench, cart (with its hay, often), lamp or barrel stands by it, and a signpost where roads meet (a fork
  past a village's square, a crossing);
  now and then a lookout tower or a camp of tents round a fire stands in the wild.
- **Roads and streams** (`world/places.ts`): rivers wind a long way across the land and never reach the sea, each in its own stretch of country so no two meet; villages, ports, inland hamlets and ruins are joined by roads routed over the land (noise, turn cost, hills
  dear), crossing the rivers on bridges, and every river has footbridges of its own along it; lanes lead to every door and pier.
  Both ends of a river are papertrails' river_source: a stone mound card with the water's mouth, three crags in a
  horseshoe behind it, reeds and a frog on the pool's bank; reeds stand along its banks, ducks float on it, frogs and herons wait at the
  edge. Here and there a pond (`world/ponds.ts`, papertrails' pond tile) lies on level meadow, pine wood or jungle
  ground clear of the roads and villages, the ground in front of it kept clear: the streams' water, still (its marks
  printed where they lie), with giant lily pads on it (sheet 49, a pink lily open on some), reeds on its far bank, a duck afloat, a frog or a heron at its edge.
- **A flat page**: the land is one sheet of paper cut to the shore; relief comes only from what stands on it. The world
  is mostly sea (the land is under a third of it).
- **Paths as printed** (`world/ground-shader.ts`): roads 0.75 wide (the skill's leading line, 1.3 captains), lanes and squares are drawn into the ground by papertrails'
  road terms (soft edge, halo, fringe, worn middle, pebbles), with grass tufts and flowers; lanes branch from the square
  and from one another like trodden paths. No standing card's blocking foot comes within 0.12 of a path's edge.
- **The sea** (`sea/sea-surface.ts`, `config/palette.ts`): the world's floor printed pale, as the papercraft skill has it
  (paler and less saturated than the pieces on it, authored a step bluer than it lands under the warm grade), in
  mottled depth tones with printed shallows, foam and drifting dashes. Its reflection is papertrails' own real mirror
  (`render/reflection.ts`, `sea/mirror.ts`), swaying on its broad wave and tinted toward the water as there; the wave keeps the size on
  screen it has in papertrails at its 10.8 framing, and its finer wave (which split a dark hull over the pale sea into
  striped rows) is left out. Dolphins and fish leap on arms turning about an axle under the page, a paper mover.
- **Streams are sea water** (`world/stream-mesh.ts`, `sea/water.ts`): the same colours and fibre as the sea,
  in depth steps, with current dashes flowing down, papertrails' floating leaves (with their shadow and midrib) and
  faint current lines riding the same flow, and a sandy cut bank; each begins and ends in a round pool. They mirror
  the world as the sea does (papertrails mirrors its rivers), reading the sea's mirror image at their own height on the
  land: no second pass, and off by less than the image's own ripple. At night (papertrails' night water, both) the water
  sinks into a deep blue, the mirrored paper into a paler blue while the mirrored lights stay bright and pull out into
  warm broken streaks toward the viewer, and every lamp pool lays a warm streak on the water before it.
- **Wind** (`world/wind.ts`): every standing card rocks by its height, thinness and kind, in travelling gusts, as
  strongly as papertrails' wind blows in its biome (the meadow 0.85 of the jungle's, the pine woods all but still at
  0.32).
- **Collisions as drawn** (`world/blockers.ts`, `world/clearance.ts`, `player/walker.ts`): only what stands between
  0.07 and 0.3 above the page stops the feet; crossed cards and mountains block their whole footprint. As in
  papertrails, what stops the feet is baked once into a walk field: a grid of distances every 0.05 over each chunk,
  made the first time something asks about its land, closed as papertrails closes it (grown and shrunk by 0.2, so no
  nook is left to wedge in), so asking how much room there is costs one read whatever stands round it. The captain
  moves on it: a step is taken if it leaves room or is no tighter than where he stands, a blocked step slides along
  the obstacle or goes round it, so he is never pinned.
- **Click to walk** (`player/click-walk.ts`, `player/route.ts`, `player/target-mark.ts`): papertrails' controls.js. A
  click, a tap or a drag ashore is cast onto the ground and the captain walks there: straight while the way is clear,
  else along a route papertrails' grid A* plans round what stands in the way (cells of 0.15 in a 12-unit square
  between him and the target, no corner cut, string-pulled into a few straight legs), else feeling his way round. He
  eases in and stops on a small inked ring printed where he is going, which fades once he gets there; a click on the
  water or inside a blocker takes him to the nearest spot he can stand on the way, and the walk is let go after 1.2 s
  held still or 1 s without getting nearer, or as soon as a key walks him.
- **Light** (`render/shadows.ts`, `config/time.ts`, `config/view.ts`, `render/biome-look.ts`, `render/lamp-pools.ts`):
  the papercraft skill's light. By day a warm key from screen-left 45 degrees up, a warm frontal fill at ~0.27 of it,
  soft paper shadows (PCSS) with a warm amber leak; by night an even pale-blue moon that keeps every card coloured and
  readable, the warmth in the windows and lanterns, navy only in the far haze and the deep shadows (never a filter over
  the frame), a lantern on the captain, papertrails' night blur (16 px, less toward the camera) and calmer paper mottle,
  and its lamp pools: warm light on the page and the paper round the six lit lamps (lantern posts, campfires) nearest
  the traveller, with no real light. The clock eases from the day look into the night look over an hour and a half round
  dusk (and back round dawn); T (papertrails' N) runs it through that fade in 1.6 s, to night or back to day. Each
  biome has its own pair of looks, papertrails' biome grade blended by the biomes round the traveller: the meadow its
  blossom (peach and lilac), the pine woods its pinewood (a weak warm sun through the canopy, teal, misty); as our plain
  look is the skill's, each is ported as the change papertrails' biome makes to its own plain look, the haze's amount
  staying the skill's.
- **Life** (`life/`, `world/critters.ts`): papertrails' densities per biome (its rows mapped to ours: the meadow its
  blossom, the pine woods its pinewood, the jungle and rocks its heartland, sand its desert): falling leaves in five
  autumn colours and blossom petals that settle and fade, drifting dust, butterflies with hinged wings (gathering over the flowers: one
  with a flower near its home takes its home over it and flies whatever its rank), fireflies over
  the banks at night, rain with splash rings and soft mist in the pine woods, flocks of birds crossing in a V with their
  shadows on the ground, chimney smoke by day, gulls circling spots of their own (nothing follows the ship: left behind, a gull shrinks
  away and comes back over a spot ahead), sea encounters now and then (9-18 s apart, two at most), each environment of the
  sea with its own few kinds (the skill's 3-5 per environment, config/life.ts zones: turtles, jellyfish, fish and
  octopuses in coastal water; dolphins, flying fish, mantas and passing ships on the open sea; whales, sharks, the
  kraken and the serpent in the deep, where no gull flies); every bit fades where it would cross the camera's
  line to the captain. Animals live as papertrails' do: they idle and walk about their home (a paper hop and roll per
  step), hens peck, goats graze, cats nap, ducks float in slow arcs on the streams; near the captain they freeze, then
  bound, dart, flutter or shuffle off and make a new home there; at night grazers stand still and pets doze. They
  walk on the captain's clearance field (papertrails' minClear 0.07), so they go round trees, rocks, fences and houses.
  papertrails' vignettes tie some to a piece: a cat sitting on a fence, a barrel, the well or a bench, a cat by a door,
  a dog by the cart or the well, hens by a fence, an owl at the top of a watchtower, a gecko at a tree's trunk, a boar
  half hidden behind one; they mostly keep their place, and leave a seat with a paper leap down. Turning round, an
  animal's card flips with its edge-on middle cut out, so it never shows as a sliver.
- **Footsteps** (`audio/paper-synth.ts`): a synthesised paper step on every footfall, its timbre set by the ground
  (grass, path, a deck). His legs walk by the skill's gait: each planted foot holds still under the moving hip (its
  stance angle covers the stride exactly), the other swings forward on a smoothstep.
- **The mix** (`config/audio.ts`, `audio/paper-voices.ts`): papertrails' paper flap, sample for sample, and its
  allocation: one flap per gesture (a land cell's cards and buildings, a patch of waves, within 0.5 s) voiced by its
  largest piece (a piece's size is its height in papertrails' 2-unit tiles), 0.35-0.75 s between flaps, the nearest and
  largest winning and a late one a little quieter, the smallest pieces giving way first when many sound at once, sounds
  falling away fast with distance (silent beyond ~2.4 x 9 units, the skill); no wind; the sea is only a room tone at
  ~-63 dBFS so the silence is never digital black.
- **The camera** (`camera/follow-camera.ts`): at sea the ship has the same window (scaled with the zoom), so the camera
  stands still while the ship idles or turns and only travels once it sails on; boarding and going ashore glide over
  0.9 s on a smoothstep. On foot it is papertrails' follow camera as it is: a 27 degree lens at 10.8, 42
  degrees down; a still zone round the captain where it does not move, a soft zone that picks up his step, hard edges;
  after a moment of steady walking the window travels with him and leads; an exact critically damped spring; a slow
  tripod drift; the lens eases up or round when a building hides him. V cycles papertrails' five views (journey,
  close, wide, low, postcard) over the same 0.9 s glide, at sea too, the far ones seeing a little past the ring; a
  paper slip names the view for a moment. Ashore the keys are the screen's, as in papertrails: W walks up the screen,
  turning with the camera in the turned views and under the sight assist.
- **No chrome** (the papercraft skill's paper-ui.md): no HUD panel; the sails, the flag and the wake show what the
  ship is doing, and one line of hints fades once you get under way. What must be a screen is paper: every panel is a
  card of the page's stock with its fibre (ui/paper-sheet.ts), the cut edge printed on it and a contact and a cast
  shadow (ui/paper.css), buttons press like card, the menu, the shipyard and the chart slide up like a sheet, a discovery card slides down from above, the chart's explored print ends in a
  torn edge, the cursor is hidden over the scene, and reduced motion makes every slide instant.
- **Haze and depth of field** (`render/post.ts`): a subtle haze of one mid-tone colour, only far away (from 6.7 to 18.7
  units from the focus at a 17-unit framing, scaled with the focus distance; on foot ~9 to ~26 hero heights). The blur is a
  tilt-shift whose sharp band measures ~0.65 of the frame (the skill's measure.py focusHeight, its range 0.55-0.75): each pixel blurred by a mix of its
  height on screen and its depth (0.8 depth: the pieces blur in layers), a sharp band round the focus that grows with a
  close camera, a near-field tile pass so the foreground blurs over the sharp band, a near / far aware bokeh gather and a
  fill pass. A scene pixel that is not a number (a speck lit into one) is read as the mean of its neighbours, so it
  never spreads through the blur into a white disc ringed with black (HDRP's "Stop NaNs").

## World QA

`node tools/qa/world-qa.mjs <seeds>` (with `npm run dev` running) visits settlements and the wild interior of each
seed, puts the captain ashore and checks for holes in the paper, floating or wet cards and models, cards on roads,
lanes and streams, overlapping buildings, roads crossing streams without a bridge, the captain stuck or held up
walking a road, and a world with too little open sea; and every loaded building or height with a corner of its base in
the sea. It prints each issue with its position and exits 1 if any.

`node tools/qa/crew-clips.mjs` poses every captain standing, walking, turning and at the helm and lists any two of
their cards that cut into each other; `node tools/qa/model-clips.mjs [model...]` does the same for every Blender-built
model while it unfolds and once it stands (pieces that pass through each other in the first moments of the pop-up,
and the slotted joints of posts, chimneys and crossed ridges at rest).

Nothing that moves draws on Math.random: sea life, smoke, the weather and the captain's idle breath each draw from a
seeded stream of the voyage (core/rng.ts `stream`), so the same seed and the same input give the same frames. The
plants that come in several printed variants (broad and blossom trees, ferns, grass, bushes: 4-5 each) are drawn
among them card by card (config/flora.ts `variantOf`).
