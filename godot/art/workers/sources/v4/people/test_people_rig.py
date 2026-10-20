#!/usr/bin/env python3
"""Validate delivered poses, registration and source provenance without Godot."""
import hashlib
import json
import math
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
EXPECTED = {
    "worker": ["walk", "timber", "brick", "load", "hammer", "climb"],
    "water": ["water_walk", "water_work"],
    "merchant": ["merchant_walk", "merchant_work"],
    "artisan": ["artisan_walk", "artisan_work"],
}


def distance(a, b):
    return math.dist(a, b)


def validate(directory, role):
    data = json.loads((directory / "manifest.json").read_text())
    assert data["version"] == 4
    assert data["directions"] == 4
    assert data["method"] == "articulated_new_painted_parts"
    for source in data["source_art"]:
        path = Path(source["file"])
        assert "original" in path.name
        assert path.exists()
        assert hashlib.sha256(path.read_bytes()).hexdigest() == source["sha256"]
    checked = 0
    for action in EXPECTED[role]:
        for direction in range(4):
            sequence = data["animations"][f"{action}/{direction}"]
            assert sequence["cycles_per_tile"] == 8.5
            assert len(sequence["frames"]) == 8
            frames = [data["sprites"][key] for key in sequence["frames"]]
            assert len({tuple(frame["pivot"]) for frame in frames}) == 1
            pose_hashes = set()
            for frame in frames:
                image = Image.open(directory / frame["file"]).convert("RGBA")
                assert list(image.size) == data["frame_size"]
                box = image.getbbox()
                assert box and box[2] - box[0] > 40 and box[3] - box[1] > 200
                assert 0 < box[0] < box[2] < image.width, (frame["file"], box)
                assert 0 < box[1] < box[3] < image.height, (frame["file"], box)
                pose_hashes.add(hashlib.sha256(image.tobytes()).hexdigest())
                joints = frame["joints"]
                for side in ["near", "far"]:
                    assert distance(joints["shoulders"][side], joints["hands"][side]) <= 102.001
                checked += 1
            minimum_poses = 8 if action == "hammer" or action.endswith("_walk") or action in ["walk", "timber", "brick"] else 5
            assert len(pose_hashes) >= minimum_poses, (role, action, direction, len(pose_hashes))
            if action.endswith("_walk") or action in ["walk", "timber", "brick"]:
                # Opposed feet visibly exchange fore/aft contact locations;
                # the test is on actual articulated joint motion, not hashes.
                near = [f["joints"]["ankles"]["near"] for f in frames]
                far = [f["joints"]["ankles"]["far"] for f in frames]
                assert abs(near[0][0] - near[4][0]) > 35
                assert abs(far[0][0] - far[4][0]) > 35
                assert (near[0][0] - near[4][0]) * (far[0][0] - far[4][0]) < 0
            if action == "hammer":
                hand_y = [f["joints"]["hands"]["near"][1] for f in frames]
                assert max(hand_y) - min(hand_y) > 100
            if action.endswith("_work") or action == "load":
                hip_y = [f["joints"]["hip"][1] for f in frames]
                assert max(hip_y) - min(hip_y) >= 37
    return checked


if __name__ == "__main__":
    total = sum(validate(HERE / f"{role}-frames", role) for role in EXPECTED)
    print(f"PASS: {total} articulated frames across 48 complete action/direction sequences.")
