# Working on Paper Seas

The rules every agent (and person) follows when changing this repo. They exist so that a change leaves the code as
clean as it found it: no hacks, nothing dead, nothing duplicated, no bug a careful read would have caught. Read this
before the first edit, and go through **Done means** before saying a change is finished.

The game: Vite + strict TypeScript + Three.js, no framework, a pop-up paper world. The code's layout and the rules
the world follows are in [docs/how-it-works.md](docs/how-it-works.md); how the art and the Blender models are made, in
[docs/art-pipeline.md](docs/art-pipeline.md).

## Commands

```bash
npm run dev                                 # dev build on http://localhost:5180 (the QA tools need it running)
npm run check                               # type check + dead-code check + rules check (tools/qa/dead-code.mjs,
                                            # tools/qa/rules.mjs); CI runs it on every pull request and push to main
npm run build                               # type check + production build
node tools/qa/world-qa.mjs [seeds]          # plays the dev build headless and checks the world (comma-separated
                                            # seeds, default 1234,7,42; on a crash, run them one at a time)
node tools/qa/model-clips.mjs [model...]    # pieces of a Blender model that cut into each other while unfolding
node tools/qa/crew-clips.mjs                # cards of the captains that cut into each other
```

## The code

- **TypeScript, strict.** No `any`, no `@ts-ignore`. A `!` only where an invariant makes it true, and the code
  around it shows why. Game code is `.ts`. Tools are `.mjs` (Node runs them as they are), except the checks that run
  inside the dev build's page: `tools/qa/*.ts`, each loaded by its `.mjs` of the same name. Blender scripts are `.py`.
- **One change, one purpose.** A change does what it was asked and what that needs, no more: no restyling or
  refactoring of code it does not touch. Something wrong spotted on the way is reported (or fixed in its own change),
  not folded in silently.
- **Nothing dead.** Every file, export, parameter, option, field and branch is used. When a change leaves something
  unused (an option no caller passes any more, a parameter always given the same value, a field written and never
  read, a comment about behaviour that is gone), it is deleted in the same change. `npm run check` finds modules the
  game never loads, exported values no other module imports, public files the game never names and tools nothing
  runs; the rest is on you. An exported type may serve only its own module's signatures.
- **No hacks.** Fix the cause, not the symptom: no magic offset to hide a gap, no timeout to dodge an ordering, no
  special case for one seed. If the clean fix is large, say so instead of patching around it. No TODO or FIXME is
  left behind: finish it, or report it.
- **Failures are handled, never swallowed.** A `catch` handles one known failure and says which (in code or a
  comment); an empty `catch` or one that hides a bug is not allowed. A promise is awaited or its rejection handled.
- **One source of truth.** Every tunable lives in `src/config/` (or as a named constant at the top of its module)
  and is written once. Never retype a value that exists elsewhere: import it, or derive it. A number a shader must
  share with TypeScript is interpolated into the shader string, never typed twice.
- **Organized by responsibility.** Each file has one concern, and sits in the folder of that concern (the tree in
  docs/how-it-works.md). Shared helpers go to `src/core/` (or the folder they belong to), never copied. No loose files
  at the root, no `utils2`, no `misc`. A new folder needs a reason, and docs/how-it-works.md is updated with it.
- **Readable.** Names say what a thing is. Functions do one thing. Comments are full sentences in the project's voice
  and say what the code does and why; a doc comment that no longer matches the code is a bug. No commented-out code.
- **The house style.** Files in kebab-case (`card-field.ts`), classes and types in PascalCase, constants in
  UPPER_SNAKE_CASE, everything else in camelCase; 2-space indents, single quotes, semicolons; `import type` for
  types; comments wrapped at 120 columns. Match the file you are in.
- **Few dependencies.** Three.js is the one runtime dependency. A new package needs a reason the platform or a few
  lines of our own can't meet, and the owner's yes.
- **Our own voice.** The game was inspired by other projects, but its code, comments, docs, art prompts and commit
  messages never name or link them: every rule and number is written as the game's own design. Only LICENSE keeps the
  notices their licences require.

## Bug prevention

Each of these was a real bug here. Check the ones your change touches.

- **Frame rate.** Anything eased toward a target or decayed per frame uses `Math.exp(-rate * dt)` (or the
  fixed-step springs of `popup/spring.ts`), never `x *= 0.9` per frame or `x += (to - x) * Math.min(1, k * dt)`. A
  linear ramp clamped at its end (`t = Math.min(1, t + dt / duration)`) is fine. The game must move the same at 30,
  60 and 144 Hz.
- **Determinism.** The world is a pure function of the seed: no `Math.random` anywhere but where a new voyage draws
  its own seed (`config/seed.ts`). Generation draws from `core/rng.ts` (`hash01`/`hash2` with a salt, or a seeded
  `stream`). Never change an existing salt or the order or number of draws unless you mean to change the world (it
  reshuffles everything after it); a new roll gets a salt of its own. Say plainly when a change moves the generated
  world.
- **State across transitions.** Going ashore and back aboard, a new voyage (the page reloads, and `pagehide` still
  fires), a teleport (`moveShip`, `landCaptain`): whatever carries momentum, a spring or a timer is reset, and nothing
  saved on the way out undoes a reset.
- **The first frame.** Whatever is added to the scene is posed and its visibility set before it is first drawn (the
  sea's encounters get an update with dt 0 before they are added: `life/sea-life.ts`), or it flashes for a frame. A
  timeline event at t = 0 fires at creation, not on "crossing" 0.
- **Hinges belong to their FoldGroup.** Never write the rotation of a node a `FoldGroup` drives (nor the position of
  a lifted or stacked one): it holds while the fold rests and jumps back the moment the fold moves. Sway or rock an
  inner node instead.
- **Paper materials** are copied with `paperCopy` (render/paper-material.ts), never `material.clone()` (it drops the
  paper shader).
- **Paper never cuts paper.** No card or model piece passes through another, rising, standing or folding: give
  neighbouring cards the same turn, room enough for their wobble, and fold directions that swing away from each
  other. Film it up close. For Blender models run `model-clips.mjs`, for the captains `crew-clips.mjs`.
- **Directional prints.** A sea creature or a ship that heads somewhere is mirrored by `mirrorFor` (art/facing.ts),
  whose entry must match the drawing (the land's animals keep theirs in world/critters.ts). Check new or regenerated
  prints by eye.
- **Placement.** Generation checks a spot against everything that claims ground there (roads, streets, water with the
  margin asked, the other pieces, the neighbouring chunks), and what stands across a chunk's square is placed by one
  chunk only.
- **Resources.** Geometries, materials, textures and render targets made at runtime are disposed when their owner
  goes; listeners and timers are removed; a cache keyed by world position is bounded (`core/bounded-cache.ts`).
- **The browser.** `localStorage` goes through `core/storage.ts` (it throws in private mode); an `AudioContext` may
  start suspended and must be resumed on a later gesture (`audio/sound.ts`).
- **A clean console.** In normal play the game logs nothing: no errors, no warnings, no leftover `console.log`. A
  `console.warn` is only for a broken assumption the game survives (storage the browser refuses, a three.js shader
  chunk that changed). Every script that drives the game listens for them (`openGame`'s `onPageError` and
  `onConsoleIssue`, which the world QA and the clip checks count as failures), and a change is checked in the
  browser's console too.
- **Every input.** A new control works with the keyboard and, where it applies, with a mouse and a touch screen too
  (as clicking or tapping to walk does).

## Performance

The game must hold 60 frames a second. In what runs every frame:

- **Nothing allocated.** No `new THREE.Vector3()`, matrix or array per frame or per card: reuse scratch objects
  at module level (`const _m = new THREE.Matrix4()`), as the code does.
- **Nothing walked that need not be.** No pass over every card or chunk when only those near the focus matter, no
  pairwise loop over a growing list; work that does not change between frames is computed once and kept.
- **Few draws.** Many like things are one `InstancedMesh` or one merged geometry, not a mesh each.
- **Heavy work spread out.** Work that can wait (painting the chart's tiles, building chunks) runs a little per frame
  under a time budget.

## Visual changes

- **Validate up close.** Every visual change is filmed or screenshotted cropped close, in every state it has (rising,
  standing, folding; day and night; at sea and ashore), with headless scripts that drive `window.game` through
  `tools/browser.mjs`'s `openGame`. Look at the frames before calling it done.
- **Measure, don't assume.** A claim that something matches a reference (a drawing, a model, a value) is measured on
  the reference itself, with the same method on both sides, before and after. Read the code before saying something
  works one way.
- **The owner decides how it looks.** A change that alters the look or the feel beyond what was asked is shown to the
  owner (frames side by side, before and after) before it stays.
- **The README's screenshots** (docs/media, `tools/media/screenshots.mjs`) are retaken only when a change clearly
  alters one of them.

## Assets

- **Every generated asset can be made again from its sources.** The art comes from its prompt and sheet in
  `assets-src/` through `tools/art/`; the models and ships from the Blender scripts (docs/art-pipeline.md). A step
  done by hand (a card cropped with `crop-card.mjs`) is written down there. A generated file is never edited by hand
  without that.

## Decisions already made

These were settled with the project's owner; don't reopen them unless asked.

- The captains are flat die-cut slabs in one colour each, layered and slotted through each other
  (`player/crew-model.ts`).
- Which props are crossed cards or boxes is decided case by case by the owner: don't turn cards into crosses or boxes.
- The land's cards all fold straight back, away from the camera, and rise without turning. A cell's cards rise from
  the low to the tall; a landform (mountain, outcrop) rises back to front, the back on top when folded.
- The sea's reflection is a real mirror of the world.

## Done means

1. `npm run check` passes (types, nothing unused, the rules check), and `npm run build` passes.
2. The world QA passes on at least two seeds when generation, collisions or the terrain changed; the clip checks pass
   when models or captains changed.
3. Visual changes were looked at up close in every state, and the console stayed clean (no page errors, no console
   errors or warnings) while they ran.
4. Docs that describe what changed (docs/*.md, README.md, the doc comments) say what the code now does.
5. Nothing your change made unused is left behind.
6. The report says what was not verified, and whether the generated world moved.

Commit or push only when asked. Commit messages: a short summary line, then what changed and why.
