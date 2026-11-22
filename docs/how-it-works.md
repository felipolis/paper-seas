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
  render/            renderer, lights, paper material, soft paper shadows (shadows.ts), post (tilt-shift, night grade)
  ui/                HUD and pause menu (Esc)
  life/              sea creatures and gulls, ambient bits (leaves, butterflies, motes, fireflies), chimney smoke,
                     the camera-to-captain line they keep clear of (clear-line.ts)
  game/              voyage progress (discoveries, treasure)
  audio/             synthesised sound: felt-piano barcarolle (notes made in a worker), paper flaps, footsteps, sea
tools/qa/            world QA: plays the dev build headless and checks the world
tools/media/         the README's screenshots (docs/media), taken headless from the dev build
docs/                these pages and the screenshots
assets-src/          generated art sources (Flow prompts and sheets) and audit pages
tools/art/           sprite sheet cutter (cut-sprites: keeps and trims papertrails' cream die-cut edge for the game's
                     sprites; peels the margin of the models' printed faces) and audit (audit-sprites: contact sheet)
public/art/          cut sprites + manifest (loaded at startup)
public/models/       Blender-built models (models.glb, crew.glb, ship-*.glb), their printed atlas and textures
tools/blender/       Blender build scripts (buildings, mountains, the pier and the skill's bridge: ramps and a crown
                     between sides leaning out; the ships; the crew)
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
  A piece of a building that rides on another (a roof on its wall) follows it as it opens
  (popup/spring.ts NESTED), so the planes of one construction never scissor.
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
  grass 0.3, houses 1.1, animals at most half the captain (the skill's creatures), every kind varied +-15 % (and under everything that stands, papertrails' soft darker contact
  patch on the ground); the ground is planted by 2 x 2 tiles, each one composition
  mixing a few tall species near its corners with clumps of ground cover and flowers, a small prop or two (a stump, a
  log, mushrooms, coconuts, shells, a woodpile) and about one animal, the woods massing where a low-frequency field is
  high and clearings left where another is low (open ground between the groups, a low clump or two on it); no more than
  three of one prop or animal stand in any 9 x 9 square, about one on-foot view. Like papertrails' tiles (measured on its tiles.glb: 9 or 10 cards, 7 to 10 drawings) a tile hands out its
  species before repeating one (four pines, three broadleaf trees, two blossoms to draw from), and a clump is one to
  four cards of different species, the tallest at the back; the low cover is drawn as wide low drifts (about 2.4 x as
  wide as tall), the ferns as compact clumps. Villages have a well, stalls, laundry, bunting, carts, benches, lamps, hives and fences and their hens, chicks,
  cats, dogs, pigs and goats; every few units of road a signpost, guidepost, bench, cart, lamp or barrel stands by it;
  now and then a lookout tower or a camp of tents round a fire stands in the wild.
- **Roads and streams** (`world/places.ts`): rivers wind a long way across the land and never reach the sea, each in its own stretch of country so no two meet; villages, ports, inland hamlets and ruins are joined by roads routed over the land (noise, turn cost, hills
  dear), crossing the rivers on bridges, and every river has footbridges of its own along it; lanes lead to every door and pier.
  Both ends of a river are papertrails' river_source: a stone mound card with the water's mouth, three crags in a
  horseshoe behind it, reeds and a frog on the pool's bank; reeds stand along its banks, ducks float on it, frogs and herons wait at the
  edge.
- **A flat page**: the land is one sheet of paper cut to the shore; relief comes only from what stands on it. The world
  is mostly sea (the land is under a third of it).
- **Paths as printed** (`world/ground-shader.ts`): roads 0.75 wide (the skill's leading line, 1.3 captains), lanes and squares are drawn into the ground by papertrails'
  road terms (soft edge, halo, fringe, worn middle, pebbles), with grass tufts and flowers; lanes branch from the square
  and from one another like trodden paths. No standing card's blocking foot comes within 0.12 of a path's edge.
- **The sea** (`sea/sea-surface.ts`, `config/palette.ts`): the world's floor printed pale, as the papercraft skill has it
  (paler and less saturated than the pieces on it, authored a step bluer than it lands under the warm grade), in
  mottled depth tones with printed shallows, foam and drifting dashes. Its reflection is papertrails' own real mirror
  (`render/reflection.ts`), swaying on its broad wave and tinted toward the water as there; the wave keeps the size on
  screen it has in papertrails at its 10.8 framing, and its finer wave (which split a dark hull over the pale sea into
  striped rows) is left out. Dolphins and fish leap on arms turning about an axle under the page, a paper mover.
- **Streams are sea water** (`world/stream-mesh.ts`, `sea/water.ts`): the same colours and fibre as the sea,
  in depth steps, with current dashes flowing down, papertrails' floating leaves (with their shadow and midrib) and
  faint current lines riding the same flow, and a sandy cut bank; each begins and ends in a round pool.
- **Wind** (`world/wind.ts`): every standing card rocks by its height, thinness and kind, in travelling gusts, as
  strongly as papertrails' wind blows in its biome (the meadow 0.85 of the jungle's, the pine woods all but still at
  0.32).
- **Collisions as drawn** (`world/blockers.ts`, `player/walker.ts`): only what stands between 0.07 and 0.3 above the
  page stops the feet; crossed cards and mountains block their whole footprint and, as papertrails closes its field
  (closeRadius 0.2), a gap narrower than 0.4 between two pieces is filled (no pockets to wedge in). The captain
  moves on a clearance field: a step is taken if it leaves room or is no tighter than where he stands, a blocked step
  slides along the obstacle or goes round it, so he is never pinned.
- **Light** (`render/shadows.ts`, `config/time.ts`, `config/view.ts`): the papercraft skill's light. By day a warm key from
  screen-left 45 degrees up, a warm frontal fill at ~0.27 of it, soft paper shadows (PCSS) with a warm amber leak; by
  night an even pale-blue moon that keeps every card coloured and readable, the warmth in the windows and lanterns, navy
  only in the far haze and the deep shadows (never a filter over the frame), a lantern on the captain. The clock eases
  from the day look into the night look over an hour and a half round dusk (and back round dawn): only the two looks,
  mixed.
- **Life** (`life/`, `world/critters.ts`): papertrails' densities per biome (its rows mapped to ours: the meadow its
  blossom, the pine woods its pinewood, the jungle and rocks its heartland, sand its desert): falling leaves in five
  autumn colours and blossom petals that settle and fade, drifting dust, butterflies with hinged wings, fireflies over
  the banks at night, rain with splash rings and soft mist in the pine woods, flocks of birds crossing in a V with their
  shadows on the ground, chimney smoke by day, gulls circling spots of their own (nothing follows the ship: left behind, a gull shrinks
  away and comes back over a spot ahead), sea encounters now and then (9-18 s apart, two at most); every bit fades where it would cross the camera's
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
- **The mix** (`config/audio.ts`, `audio/paper-voices.ts`): the skill's approved levels: one flap per gesture (a land
  cell, a patch of waves, within 0.5 s), 0.35-0.75 s between flaps, the nearest and largest winning, sounds falling away
  fast with distance (silent beyond ~2.4 x 9 units); no wind; the sea is only a room tone at ~-63 dBFS so the silence is
  never digital black.
- **The camera** (`camera/follow-camera.ts`): at sea the ship has the same window (scaled with the zoom), so the camera
  stands still while the ship idles or turns and only travels once it sails on; boarding and going ashore glide over
  0.9 s on a smoothstep. On foot it is papertrails' follow camera as it is: a 27 degree lens at 10.8, 42
  degrees down; a still zone round the captain where it does not move, a soft zone that picks up his step, hard edges;
  after a moment of steady walking the window travels with him and leads; an exact critically damped spring; a slow
  tripod drift; the lens eases up or round when a building hides him.
- **A quiet HUD**: one line of hints that fades as soon as you get under way; the ship's panel goes when ashore.
- **Haze and depth of field** (`render/post.ts`): a subtle haze of one mid-tone colour, only far away (from 6.7 to 18.7
  units from the focus at a 17-unit framing, scaled with the focus distance; on foot ~9 to ~26 hero heights). The blur is a
  tilt-shift whose sharp band measures ~0.65 of the frame (the skill's measure.py focusHeight, its range 0.55-0.75): each pixel blurred by a mix of its
  height on screen and its depth (0.8 depth: the pieces blur in layers), a sharp band round the focus that grows with a
  close camera, a near-field tile pass so the foreground blurs over the sharp band, a near / far aware bokeh gather and a
  fill pass.

## World QA

`node tools/qa/world-qa.mjs <seeds>` (with `npm run dev` running) visits settlements and the wild interior of each
seed, puts the captain ashore and checks for holes in the paper, floating or wet cards and models, cards on roads,
lanes and streams, overlapping buildings, roads crossing streams without a bridge, the captain stuck or held up
walking a road, and a world with too little open sea. It prints each issue with its position and exits 1 if any.
