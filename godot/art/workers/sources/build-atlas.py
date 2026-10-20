"""Crop/pack original image_gen pixels. No painting or pose synthesis."""
from pathlib import Path
import hashlib, json, math
import numpy as np
from PIL import Image
from scipy.ndimage import label, find_objects, binary_dilation

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / 'sources'
frames, source_records = [], []

def extract(image, box, key, source, scale, keep=None):
    cell = image.crop(box)
    rgba = np.array(cell)
    if keep is not None:
        rgba[~keep] = 0
    yy, xx = np.where(rgba[:, :, 3] > 32)
    bounds = (max(0, int(xx.min()) - 2), max(0, int(yy.min()) - 2), min(cell.width, int(xx.max()) + 3), min(cell.height, int(yy.max()) + 3))
    rgba = rgba[bounds[1]:bounds[3], bounds[0]:bounds[2]].copy()
    # Preserve all painted pixels; discard only near-transparent mask speckles.
    rgba[rgba[:, :, 3] <= 8] = 0
    crop = Image.fromarray(rgba)
    foot_y, foot_x = np.where(rgba[:, :, 3] > 96)
    bottom = int(foot_y.max())
    foot = int(np.median(foot_x[foot_y >= bottom - 18]))
    frames.append({'key': key, 'crop': crop, 'foot': foot, 'bottom': bottom, 'source': source, 'scale': scale, 'source_rect': [box[0] + bounds[0], box[1] + bounds[1], crop.width, crop.height]})

original = SOURCES / 'workers-original.png'
image = Image.open(original).convert('RGBA')
columns, rows = [0, 329, 583, 844, 1122], [0, 288, 560, 842, 1132, 1402]
for row, action in [(3, 'hammer_up'), (4, 'hammer_down')]:
    for direction in range(4):
        extract(image, (columns[direction], rows[row], columns[direction + 1], rows[row + 1]), f'{action}/{direction}', original.name, .085)
source_records.append({'source': original.name, 'prompt': 'prompt.txt', 'sha256': hashlib.sha256(original.read_bytes()).hexdigest(), 'frames_used': 8})

for action in ['walk', 'timber', 'brick']:
    source = SOURCES / f'{action}-original.png'
    image = Image.open(source).convert('RGBA')
    alpha = np.array(image.getchannel('A'))
    labels, count = label(alpha > 32)
    objects = []
    for component, slices in enumerate(find_objects(labels), 1):
        if slices is not None and np.count_nonzero(labels[slices] == component) > 3000:
            objects.append((component, slices))
    assert len(objects) == 16, (action, len(objects))
    # Independent cutouts may overlap in bounding-box Y while their pixels are
    # separate. Connected components preserve whole boots and hats at row edges.
    objects.sort(key=lambda item: item[1][1].start)
    for direction in range(4):
        column = sorted(objects[direction * 4:(direction + 1) * 4], key=lambda item: item[1][0].start)
        for gait, (component, slices) in enumerate(column):
            box = (max(0, slices[1].start - 2), max(0, slices[0].start - 2), min(image.width, slices[1].stop + 2), min(image.height, slices[0].stop + 2))
            own = labels[box[1]:box[3], box[0]:box[2]] == component
            keep = binary_dilation(own, iterations=2)
            other = labels[box[1]:box[3], box[0]:box[2]]
            keep &= (other == component) | (other == 0)
            extract(image, box, f'{action}/{direction}/{gait}', source.name, .073, keep)
    source_records.append({'source': source.name, 'prompt': f'{action}-prompt.txt', 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'frames_used': 16})

slot_w, slot_h, pivot_x, pivot_y = 384, 384, 192, 352
atlas = Image.new('RGBA', (slot_w * 8, slot_h * math.ceil(len(frames) / 8)))
sprites = {}
for index, frame in enumerate(frames):
    x, y = (index % 8) * slot_w, (index // 8) * slot_h
    offset = (x + pivot_x - frame['foot'], y + pivot_y - frame['bottom'])
    crop = frame['crop']
    assert x <= offset[0] and offset[0] + crop.width <= x + slot_w, frame['key']
    assert y <= offset[1] and offset[1] + crop.height <= y + slot_h, frame['key']
    atlas.alpha_composite(crop, offset)
    sprites[frame['key']] = {'rect': [x, y, slot_w, slot_h], 'pivot': [pivot_x, pivot_y], 'world_scale': frame['scale'], 'source': 'sources/' + frame['source'], 'source_rect': frame['source_rect']}
assert len(sprites) == 56 and max(atlas.size) <= 4096
temporary = ROOT / 'workers-atlas.tmp.webp'
atlas.save(temporary, lossless=True, exact=True)
temporary.replace(ROOT / 'workers-atlas.webp')
metadata = {'schema': 2, 'atlas': 'res://art/workers/workers-atlas.webp', 'directions': ['upper_left', 'upper_right', 'lower_left', 'lower_right'], 'gait_frames': 4, 'gait_distance_per_frame': .085, 'sprites': sprites, 'provenance': 'Original image_gen pixels: eight hammer poses and forty-eight newly painted walk/carry poses.'}
(ROOT / 'workers-atlas.json').write_text(json.dumps(metadata, indent=2) + '\n')
record = {'tool': 'image_gen.imagegen', 'transparent_background': True, 'generated': '2026-10-20', 'source_records': source_records, 'mechanical_tool': 'build-atlas.py', 'atlas_size': list(atlas.size), 'frames': len(sprites), 'art_editing': 'No painting, flipping, warping, leg rotation or synthetic poses. Connected-component cutout, transparent gutter crop, alpha<=8 fringe cleanup, footpoint registration, lossless packing only.'}
(SOURCES / 'generation-record.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({'frames': len(sprites), 'atlas': list(atlas.size), 'sources': len(source_records)}))
