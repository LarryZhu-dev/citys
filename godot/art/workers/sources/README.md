# New articulated actors

All rejected worker/citizen source paintings and the individual old artisan
sprites were removed. The canonical new body parts, horses, carts, independent
wheels and mechanical assembly tools are retained in [v4](v4/README.md).

The original game screenshot informs the material and rendering direction.
People and carts are not visibly resolved in it, so these are newly generated
original actors, not crops from the original game.

Run `python godot/art/workers/sources/build-atlas.py` from the repository root
to rebuild both shared atlases. This rebuild uses only the new retained source
images and validates all 384 articulated human frames before packing.

This whole source directory is excluded from Godot imports by `.gdignore`.
