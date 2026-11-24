#!/usr/bin/env bash
# Rebuilds every ship: samples the hull shapes from the game's code and traces the outlines of its printed details,
# then builds each hull in Blender.
#   bash tools/ship/build-ships.sh
set -e
cd "$(dirname "$0")/../.."
BLENDER="${BLENDER:-C:/Program Files/Blender Foundation/Blender 5.3/blender.exe}"
node tools/ship/export-shape.mjs
node tools/ship/trace-details.mjs
for f in assets-src/models/ship-shape-*.json; do
  id="${f##*ship-shape-}"; id="${id%.json}"
  SHIP_ID="$id" "$BLENDER" -b --factory-startup -P tools/blender/build_ship.py | grep '^ship:'
done
