# Original transport assets V4

These are newly generated original horses, freight carts, handcarts and wheels. The user's supplied Sim Empire screenshot was visibly inspected for restrained natural colours and detailed hand-painted miniature rendering. Horses and carts are too small in that screenshot for extraction or faithful anatomy reconstruction; **none of these assets is claimed to be extracted original-game artwork**.

## Delivered files

- `vehicle-manifest.json`: 33 atlas-ready independent RGBA crop records: 16 horse poses, eight horse-cart bodies, eight handcart bodies, one front-facing wheel. Four horse animation definitions use the existing V3 renderer names. The `file` path resolves relative to this directory; replace it with `rect` when packing the final atlas. All pivots and wheel centres are in the cropped image's pixel coordinates.
- `frames/`: mechanically isolated transparent sprites. No generated geometry, colour replacement, body reconstruction or frame painting is performed by scripts.
- `sources/horse-walk-v4.png`: accepted source after a targeted walk-cycle edit; four rows NW/NE/SW/SE, four pose columns. Four distinct drawn limb poses per direction. `horse-walk-v4-draft.png` is the rejected initial source with overly similar contact poses and is not used by the manifest.
- `sources/cart-bodies-v4.png`: four direction rows; columns are horse cart empty/full, handcart empty/full. The body sheets deliberately contain no fixed painted wheel.
- `sources/wheel-v4.png`: one front-on circular twelve-spoke wooden wheel with independent transparent spoke gaps. The frame is mechanically reduced to 256 pixels for the game atlas.
- `extract_vehicles.py`: mechanical alpha-isolation and manifest regeneration. Irregular generated gutters make equal-cell cropping unsafe: two cart bodies have overlapping *bounding boxes*, so nearest connected-component ownership isolates the actual disconnected sprites without painting them.
- `preview_vehicles.py`: review-only composition reproducing the Godot source transforms, including real projected wheel art, at 4× game scale. No preview backgrounds or labels are part of game assets.
- `review-transport-assembly.png`: assembled independent horse/body/wheel diagnostic.
- `review-transport-motion.gif`: four-pose playback with independently rotating wheel.

## Visual review performed

Every generated source was actually opened through `view_image`, including the rejected initial horse sheet, corrected horse sheet, cart bodies and wheel. The assembled preview was also opened. Axle caps were measured from the actual rendered source, not inferred from grid coordinates. Wheel radius and horse separation were tuned from the assembled preview: horse world scale 0.09, cart 0.108, horse wheel radius 64 source pixels, handcart wheel radius 39 pixels, horse distance 23 world pixels. These are compatible starting values; final camera-scale review in the engine remains required.

The original horse contact poses were too similar, so a second generation explicitly redrew grounded/lifted opposing legs. The resulting poses visibly differ in knees, hocks and hoof contacts and are not whole-sprite translation tricks. Exact equine biomechanics and smooth continuous foot contact still require the parent agent's live game playback review; source hashes alone are not acceptance. The four-frame cycle is intentionally a compact walk, not a claimed high-frame-rate animation.

Only the visible near wheel is attached. The far wheel is hidden by the vehicle body in these three-quarter views. The actual wheel texture is rotated in its own circular plane before applying the source side-plane projection; no painted lines stand in for spokes.

## Integration cautions

- Preserve all four direction mappings: 0 NW, 1 NE, 2 SW, 3 SE.
- Preserve the measured `pivot` and `wheels[].center` when packing. Do not substitute tight-crop bottom-centre for the ground pivot; that would introduce step-dependent vertical jumps.
- `horse_distance` is measured from the cart ground centre; horse and cart remain separate sprites. The route controls displacement and the animation sample uses actual travelled distance.
- The handcart handles point forward. A pulling carrier belongs along the direction vector. The old renderer's negative `driver_offset` places the carrier at the opposite end and must be changed or replaced by the new actor assembly before shipping.
- No production Godot source, atlas entry point, worker assets, export or deployment was modified in this subtask.
