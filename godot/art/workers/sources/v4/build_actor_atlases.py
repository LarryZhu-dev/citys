#!/usr/bin/env python3
"""Pack original articulated poses and painted transport into two shared atlases.

Only cropping, padding, resampling and placement are performed here. All visible
pixels originate in the newly generated source paintings and their rig poses.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_set(path):
    manifest = json.loads(path.read_text())
    return [(name, data, path.parent / data["file"]) for name, data in manifest["sprites"].items()], manifest["animations"]


def prepare(name, metadata, path, factor):
    source = Image.open(path).convert("RGBA")
    bbox = source.getbbox()
    if bbox is None:
        raise ValueError(f"Empty actor image: {path}")
    left, top, right, bottom = bbox
    source = source.crop(bbox)
    width, height = max(1, round(source.width * factor)), max(1, round(source.height * factor))
    factor_x, factor_y = width / source.width, height / source.height
    image = source.resize((width, height), Image.Resampling.LANCZOS)
    info = {
        key: value for key, value in metadata.items()
        if key not in ["file", "rect", "pivot", "joints", "world_scale", "source", "source_rect"]
    }
    info["pivot"] = [
        round((metadata["pivot"][0] - left) * factor_x, 4),
        round((metadata["pivot"][1] - top) * factor_y, 4),
    ]
    # At most one pixel rounding variance; mean scale preserves actor world size.
    info["world_scale"] = metadata.get("world_scale", .088) / ((factor_x + factor_y) / 2)
    if "wheels" in metadata:
        info["wheels"] = []
        for wheel in metadata["wheels"]:
            info["wheels"].append({
                **wheel,
                "center": [(wheel["center"][0] - left) * factor_x, (wheel["center"][1] - top) * factor_y],
                "radius": wheel["radius"] * (factor_x + factor_y) / 2,
            })
    if name.startswith("water_") and "joints" in metadata:
        info["water_surfaces"] = [
            {
                "center": [(hand[0] - left) * factor_x, (hand[1] + 18 - top) * factor_y],
                "radius": 9 * (factor_x + factor_y) / 2,
            }
            for hand in metadata["joints"]["hands"].values()
        ]
    info["source_frame_sha256"] = digest(path)
    return name, info, image


def pack(records, animations, output, resource_path):
    width, gap = 2048, 10
    prepared = [prepare(*record, .75) for record in records]
    prepared.sort(key=lambda row: (-row[2].height, row[0]))
    x, y, row_height = gap, gap, 0
    layout, sprites = [], {}
    for name, info, image in prepared:
        if x + image.width + gap > width:
            x, y, row_height = gap, y + row_height + gap, 0
        info["rect"] = [x, y, image.width, image.height]
        sprites[name] = info
        layout.append((image, (x, y)))
        x += image.width + gap
        row_height = max(row_height, image.height)
    height = math.ceil((y + row_height + gap) / 64) * 64
    if height > 4096:
        raise ValueError(f"Actor atlas exceeds mobile texture budget: {width}x{height}")
    atlas = Image.new("RGBA", (width, height))
    for image, point in layout:
        atlas.alpha_composite(image, point)
    output.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(output.with_suffix(".webp"), lossless=True, method=6)
    manifest = {
        "version": 4,
        "atlas": resource_path,
        "directions": 4,
        "art_status": "original_v4_generated_and_visually_reviewed",
        "method": "new_painted_body_parts_articulated_into_real_poses_and_new_vehicle_frames",
        "reference": "User-provided Sim Empire China city screenshot; actor detail insufficient for extraction.",
        "provenance": "New original people, horses and carts; no pixels from rejected legacy actor assets.",
        "texture_size": [width, height],
        "sprites": dict(sorted(sprites.items())),
        "animations": dict(sorted(animations.items())),
    }
    output.with_suffix(".json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"atlas": str(output), "size": [width, height], "sprites": len(sprites), "animations": len(animations), "bytes": output.with_suffix(".webp").stat().st_size}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    people = args.source_root / "people"
    worker_records, worker_animations = read_set(people / "worker-frames" / "manifest.json")
    pack(worker_records, worker_animations, args.output_root / "workers-atlas", "res://art/workers/workers-atlas.webp")
    records, animations = [], {}
    for role in ["water", "merchant", "artisan"]:
        items, sequences = read_set(people / f"{role}-frames" / "manifest.json")
        records += items
        animations.update(sequences)
    items, sequences = read_set(args.source_root / "vehicles" / "vehicle-manifest.json")
    records += items
    animations.update(sequences)
    pack(records, animations, args.output_root / "logistics-atlas", "res://art/citizens/logistics-atlas.webp")


if __name__ == "__main__":
    main()
