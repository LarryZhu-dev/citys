# Component art v4

This is an explicit source selection pipeline for newly generated original art.
It does not read legacy sources, find the largest silhouettes to guess their
order, paint pixels, resize art, or overwrite production atlases.

`legacy-key-contract.json` records the 70 required compatibility keys and their
previous surface/prop defaults. New keys are independent variants with their own
source pixels. `retired-art-hashes.json` contains only the rejected sources' and
parts' hashes; those pixels are not copied into v4.

## Review and build

The authored source specification is `godot/art/components/sources/v4/component-spec.json`.
Each source records its original path, exact hash, tool origin, prompt capture
type, and visual review state. A specification summary must never be described
as a verbatim generation prompt.

```sh
python godot/art/components/sources/v4/build.py --allow-incomplete
python godot/art/components/sources/v4/validate.py --allow-incomplete
```

Omit `--allow-incomplete` for the final complete build. Every output atlas and
preview manifest remains under `work/art-v4/packed`. A build never activates art.
`complete` means every required key exists. `ready_for_activation` also requires
explicit assembly acceptance on every source sheet; source review alone is not
final visual acceptance.

## Source specification

```json
{
  "art_version": 4,
  "tool": "image_gen",
  "required_keys": ["wall_plaster", "post_wood"],
  "reference_evidence": ["User-supplied Sim Empire screenshot; visual reference only"],
  "sheets": [{
    "id": "A",
    "source": "godot/art/components/sources/v4/A-original.png",
    "sha256": "<actual source file sha256>",
    "prompt": "<actual generation prompt or honestly labelled summary>",
    "prompt_capture": "verbatim",
    "source_reviewed": true,
    "assembly_accepted": false,
    "grid": {"columns": 6, "rows": 4}
  }],
  "parts": [{
    "key": "wall_plaster",
    "sheet": "A",
    "source_rect": [285, 295, 230, 198],
    "kind": "surface",
    "pivot_source": [399, 483],
    "plane_bounds_source": [292, 305, 504, 482],
    "family": "wall",
    "variant": "plaster",
    "crop_mode": "alpha_bbox"
  }, {
    "key": "post_wood",
    "sheet": "A",
    "source_rect": [610, 15, 75, 255],
    "kind": "prop",
    "pivot_source": [646, 253],
    "reference_size": [62, 240],
    "reference_axis": "height",
    "reference_projection": "isometric"
  }]
}
```

`source_rect` is an **explicit, visually selected** rectangle in the original
image. Alternatively `cell:[column,row]` selects a cell in the explicitly
declared grid; this is suitable only if the generated art actually respects it.
The generator may spill across nominal cells, so every selection rejects visible
pixels on its boundary. Sources must have real alpha transparency.

When bounding rectangles include adjacent components, an explicitly reviewed
`source_polygon:[[x,y],...]` can select the intended component's native pixels.
This is a mechanical extraction mask only: it never modifies retained RGBA
values, paints a missing edge or assigns pieces by their size. The authored
polygon remains in the runtime provenance and is re-applied during validation.

Only alpha ≤ 5 noise is removed. Alpha bounding box trimming retains a minimum
one-pixel transparent margin and does not segment or invent missing pixels.
Packed source bytes retain their original resolution and RGBA values after that
documented cleanup. Sixteen transparent pixels separate atlas rectangles. The
MaxRects packer uses one texture at most 4096×4096, without rotation.

## Runtime metadata

- `source_rect`: final original-image crop after trimming.
- `selection_rect`: reviewed original-image selection before trimming.
- `rect`: packed atlas rectangle, excluding padding.
- `native_size`: the crop's actual unscaled pixel dimensions.
- `pivot`: normalized to the **trimmed crop**, not the nominal grid cell.
- `pivot_source`: authored source pixel pivot; converted to `pivot`.
- `anchor_role:"shared_assembly_center"`: permits an external normalized pivot
  for separate circular masonry pieces using the same shared center.
- `kind:"surface"`: frontal flat art, with explicitly calibrated
  `plane_bounds_source:[left,top,right,bottom]`; its normalized `plane_bounds`
  supports renderer face projection and `uv_crop`.
- `kind:"prop"`: preserved perspective silhouette, uniformly scaled using
  `reference_size`. `reference_axis:"height"` makes tall columns scale by their
  actual vertical extent; the default is `"width"`.
- `planes_source`: optional manually observed source corners for `top`, `side_x`,
  `side_y`; never inherited from another generation. These are texture
  calibration coordinates, not a geometric building model.
- `emission_rect_source`: source pixels `[x,y,width,height]` converted to
  normalized `emission_rect`; emission is individually calibrated per texture.
- `family` / `variant`: semantic identifiers for recipe selection. They do not
  alias old textures or synthesize additional variants from the same pixels.

`validate.py` independently reloads the explicit source selections and compares
every packed pixel, authored metadata field, hash, alpha gutter and key. It also
rejects duplicate images, rejected legacy file/crop hashes and the old
pixel-preserving `layout_migration` claim.

## Derived window lighting mask

`emission_masks.window_lattice` computes a separate 256×256 R8 PNG from the
native window crop. It applies inverse `smoothstep(0.08,0.20,luminance)` before
any minification, multiplies by original alpha and the calibrated aperture
border, and explicitly protects the central wooden frame. Component color
pixels and the main atlas are unchanged.

The mask covers the complete normalized component crop, so the shader samples
`texture(lattice_emission_mask, part_uv).r` directly. Import with
`mipmaps/generate=true` and linear mipmap filtering; do not declare the sampler
as `source_color`. Averaging the already separated apertures preserves their
light transmission when the window becomes smaller than its wooden lattice.
The mask is lighting data, separate from the component count and shared atlas.

Its manifest record preserves the source hash, source crop, thresholds, border,
wood guards, native transmission statistics and output hash. Validation
recomputes and byte-compares the complete mask using the documented algorithm.
