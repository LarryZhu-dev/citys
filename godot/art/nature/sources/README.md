# Geology material source and processing

Generated with `image_gen.imagegen` on 2026-10-20, with `transparent_background: false`.

The runtime file [`../geology-materials.png`](../geology-materials.png) **is the complete, unmodified generated original**. It is not a crop or a processed derivative. To avoid duplicating 4 MB in the repository, the original is kept at that runtime location instead of being copied again into this directory.

- Original generation output: `/workspace/generated_images/call_dec218a0c2224fef84a40a9c568f944e.png`
- Preserved file: `godot/art/nature/geology-materials.png`
- Actual generated dimensions: 2172 × 724 pixels, three equal 724 × 724 material panels.
- SHA-256 (both files independently checked): `e84c770df0cd728a1afd46ff3ffa14d6c433f627f57fef69b48f53d34d2baddd`
- Processing: byte-for-byte file copy only. No resizing, cropping, recoloring, sharpening, alpha extraction or compositing.
- Prompt requested 1536 × 512; the generator returned 2172 × 724. The returned full-resolution image was preserved.

Panel order is granite / copper-bearing host rock / clay. `world/resource_deposit.gd` samples the corresponding third of this image, with a small internal UV margin and mirrored world-coordinate repetition. Geometry supplies relief and directional shading; the night shader supplies the moonlight tint. Those runtime operations do not modify the source file. Godot's texture import creates engine resources and mipmaps separately.

This directory has `.gdignore` so the provenance documents are excluded from runtime import/export. The original runtime image remains included in the game.

## Exact generation prompt

Create a professional game art material texture reference sheet with exactly THREE square seamless material panels placed side by side horizontally, each panel 512x512 pixels, full output 1536x512 pixels, NO padding, NO labels, NO text, NO objects, NO perspective, NO shadows, NO vignette. This is flat orthographic albedo texture intended to be wrapped over low rising rocky terrain in a handcrafted ancient Chinese isometric city builder. Panel 1 left: weathered warm gray granite rock, fine detailed rough crystalline grain, subtle pale veins and dark fissures of varied size, organically broken geological layers, restrained contrast, no strong lighting. Panel 2 middle: gray-brown host rock with visible irregular metallic copper ore seams, muted warm tarnished copper and restrained sage verdigris in thin discontinuous mineral veins, host rock remains dominant 75%, geological natural surface, no bright turquoise pools. Panel 3 right: natural compacted ochre brown clay bank, small sedimentary horizontal striations, erosion lines and occasional tiny stones, earthy muted brown, avoid orange. Painterly realism with crisp intricate hand-painted material detail, elegant cohesive game aesthetic. Each panel fills exactly one third of image. Flat materials only, no individual boulder silhouette, no transparent background. High-detail textures without tile-grid or repeating outlined stones.
