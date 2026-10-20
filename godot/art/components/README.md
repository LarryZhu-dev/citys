# Original architectural components

These are newly generated original component paintings for this project. No Sim Empire image or earlier rejected architectural atlas is an input. Small leaf components are assembled by the Godot building renderer: wall bays, individual posts, beams, tile courses, eaves, ridge pieces, fabric panels, vessels and objects. This collection does not contain a finished building, room, complete roof, or tent.

`sources/` preserves the original generated PNGs, the actual prompts, source hashes, the mechanical build script and validation results. `.gdignore` excludes these production inputs from Godot imports. The generation record is `sources/generation-record.json`. A rejected R2 attempt is retained for provenance but is not used by the build script.

From the repository root, using Python 3 and `sources/requirements.txt`:

```sh
python godot/art/components/sources/build-atlases.py
python godot/art/components/sources/validate-atlases.py --require-complete
```

The builder extracts alpha-connected silhouettes rather than assuming nominal sheet cell borders. This preserves wide beams that extend across a cell boundary. It assigns small detached details to the nearest principal silhouette and crops without resizing or rotating. By the approved mechanical edge-cleaning rule, pixels with alpha at most 5/255 become RGBA zero; all retained visible source RGBA is unchanged. This removes the faint red/yellow fringe in the second directional sheets. Original PNGs remain untouched. Each component receives 16 pixels of fully transparent padding. Lossless WebP is saved with `exact=True` to preserve cleared transparent RGB. The 72 components now share one 4096 × 4096 atlas, at the 4096 texture-size limit.

The validator checks source pixel equality, original dimensions, page bounds, transparent RGB, padding collisions and file hashes. It writes a mechanically composited checkerboard contact sheet to `work/components-contact.png`; this preview is not a runtime asset.

`sources/atlas-layout.json` locks published coordinates. The builder rejects a changed native size or an unplaced new component until an explicit layout update is made. Optional validation with `--baseline previous-manifest.json` checks that rectangles, resource paths and complete atlas hashes are unchanged within the same layout revision.

On 2026-10-20 an explicit performance migration replaced five runtime texture pages with one shared leaf texture. The earlier M1 addition had preserved all 68 existing rectangles and page hashes; this later migration intentionally translates all 72 rectangles to reduce texture switches in primitive batching. It never bakes an assembled building, changes source scale, or changes any component pixel. Existing leaf identities, pivots, source-plane calibration and alpha remain intact.

| Former page | Dimensions | Translation into the shared page |
|---|---|---|
| 0 | 2048 × 2048 | (0, 0) |
| 1 | 2048 × 2048 | (2048, 0) |
| 2 | 2048 × 2048 | (0, 2048) |
| 3 | 2048 × 256 | (2048, 2048) |
| 4 | 2048 × 1024 | (2048, 2304) |

The prior manifest and layout, full original page RGBA hashes, per-component hashes and translated rectangles are preserved under `sources/migrations/2026-10-20-single-atlas/`. `migrate-single-atlas.py` records the one-time operation and compares all 15,204,352 prior page pixels, including transparent gutters, against their new locations. `validate-atlases.py` repeats these comparisons using the saved hashes. Ordinary `build-atlases.py` reproduces the same shared atlas directly from original source sheets and the committed layout, so the removed five runtime pages are unnecessary. Only `components-0.webp` and its import sidecar remain runtime textures. A full Godot import is required after this explicit coordinate migration.

`manifest.json` is the only coordinate source for runtime assembly:

- `atlas` is a Godot resource path; `rect` is `[x,y,width,height]` in atlas pixels, excluding the outer padding.
- `pivot` is a normalized point relative to `rect`. Props usually use a near-bottom contact anchor; surfaces map to an explicit face. Directional arc pieces may use the common ring center outside their visible rectangle, so these values must not be clamped to `[0,1]`.
- Optional `reference_size` gives the full shared assembly's projected pixel width and height. It prevents each differently shaped quarter from being stretched to fill the whole ring's extent; preserve a common source-pixel scale.
- `plane_bounds` is normalized `[left,top,right,bottom]`, distinct from `emission_rect`, which is normalized `[x,y,width,height]`.
- Optional `source_planes` stores manually observed UV corners for the original top and two visible sides of a small masonry component. The renderer can map each painted face to that component's isometric face without stretching the whole block's bounding box. No new surface pixels are synthesized. `native_plan_ratio` describes the painted source proportion rather than requiring every placed block to use that size.
- `source_rect` and `native_size` permit reproduction and verify that the original detail has not been resized.
- `kind` distinguishes projected planar surface paintings from dimensional props. A recipe controls actual placement and extent.
- `emission_rect` is a conservative authored light region. `window_lattice` marks `aperture_inside_frame` because its open lattice holes are transparent.

Directional well and kiln segments are separate newly generated camera views. They must not be synthesized by rotating or mirroring the single earlier quarter segment. The original `well_stone` and `kiln_masonry` remain source-compatible component keys; ring recipes use the explicit `_nw`, `_ne`, `_sw`, `_se` keys.

W1 and K1 are gated by `accepted: true` in their source layout records. A generated four-view sheet is not accepted merely because it exists: its four pieces must first pass a shared-center, translation-only assembly review. Failed attempts remain in `sources/` and are excluded from packing.

Roof `plane_bounds` use the opaque interior of a tile or straw course. Rounded lips and loose fibers extend beyond the placement face and overlap the next course, preserving the source silhouette without painting over seams.

Godot texture imports have `mipmaps/generate=true` and alpha-border fixing enabled. The builder preserves these settings in existing `.import` sidecars and creates a minimal importer preset before publishing a new page. This preset was checked through an isolated Godot 4.6.3 import. Godot fills in resource UIDs and imported-file paths on the next import. Production images retain transparent RGB zero; Godot's alpha-border correction is confined to its imported sampling representation.

Source generation creates new visual material; it does not by itself establish architectural accuracy or parity with a commercial game's art direction. Camera matching, recipe scale, repeated-course spacing, and night illumination still require in-game review.
