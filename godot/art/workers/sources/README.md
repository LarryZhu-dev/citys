# Construction worker artwork

All four original transparent sheets were generated with `image_gen.imagegen` on 2026-10-20. `prompt.txt` is the initial character/hammer sheet; `walk-prompt.txt`, `timber-prompt.txt`, and `brick-prompt.txt` are reference-based four-direction, four-frame gait sheets. Exact source hashes are in `generation-record.json`.

Run `python3 godot/art/workers/sources/build-atlas.py` from the repository root. Requires Pillow, NumPy and SciPy. The script separates connected cutouts, crops transparent gutters, clears alpha <= 8 mask speckles, registers foot pivots, and packs original pixels losslessly. No programmatically drawn bodies, synthesized poses, mirrors or geometric limb animation are used. Original pictures remain unchanged.

The atlas contains 56 poses: 4 directions × 4 frames × 3 actions (walking, carrying timber, carrying masonry), plus 4 directions × 2 hammer frames. Walking frames advance by actual path distance; paused and disconnected crews keep their last pose. Scaffold rails/rungs/landing use the separate newly generated architectural wood components.

The runtime only uses the packed atlas and metadata. `.gdignore` excludes sources and tooling from game imports and exports.
