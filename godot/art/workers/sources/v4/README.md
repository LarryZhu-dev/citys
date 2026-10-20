# Original actor art V4

The supplied Sim Empire China screenshot establishes the direction: detailed,
restrained hand-painted miniatures, natural cloth and wood, readable silhouettes
and realistic proportions. People and carts in that screenshot are too small to
extract or resolve their anatomy. These people, horses and vehicles are **new
original supplementary artwork**, not extracted original-game pixels.

Three people were newly painted as independent body parts: a construction
worker, a woman carrying water, and an older merchant. Each has a genuinely
painted front and back view. The other two diagonal views reflect those new
parts. The sources include separate head, tunic, upper/lower arms, thighs,
lower legs, shoes and tools. Timber, bricks, buckets and baskets are also new
paintings. No rejected artisan, worker, or logistics pixels are reused.

`people/build_people_rig.py` attaches the cutouts to registered joints, creates
eight poses per action, and records actual hands, knees and foot locations. It
rotates and composites the painted parts without drawing replacement geometric
artwork. Loading bends hips and knees, hammering moves the arm and tool,
climbing alternates hands and feet, and carrying preserves the hand attachment
while the legs alternate. The poses are baked into shared atlases for the same
low runtime draw overhead as ordinary sprites.

Horse animation is separately painted in four poses for each of four views.
Cart bodies, cargo states, horses, and wheels are independent. Runtime distance
selects walking poses and rotates the actual spoke texture in its projected
wheel plane. Work actions use elapsed time. Actual pause freezes motion;
reduced decorative motion does not stop economic actors.

Every generated source was opened for visual review. Pose contact sheets and
transport assemblies were also examined. This is evidence of source and
assembly review; it does not replace the final continuous game playback review
at normal camera size and large diagnostic scale.

## Rebuild

Dependencies are Pillow, NumPy and SciPy. From this folder:

```sh
python people/build_people_rig.py --role worker --actions walk timber brick load hammer climb
python people/build_people_rig.py --role water --source-se people/water-se-original.png --source-nw people/water-nw-original.png --output people/water-frames --actions water_walk water_work
python people/build_people_rig.py --role merchant --source-se people/merchant-se-original.png --source-nw people/merchant-nw-original.png --output people/merchant-frames --actions merchant_walk merchant_work
python people/build_people_rig.py --role artisan --output people/artisan-frames --actions artisan_walk artisan_work
python vehicles/extract_vehicles.py
python build_actor_atlases.py --output-root /tmp/new-actor-atlases
```

The packer trims transparent bounds, updates the ground pivot and wheel
coordinates consistently, resamples to 75% of the rig frame resolution, and
adds ten-pixel gutters for mipmap filtering. Output WebP is lossless. Each atlas
is at most 4096 pixels on either axis. High-resolution source paintings remain
here under `.gdignore`, so they are not downloaded by game clients.
