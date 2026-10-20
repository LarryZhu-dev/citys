#!/usr/bin/env python3
"""Mechanically assemble the newly painted body parts into articulated poses.

No replacement artwork is drawn here. Source images are alpha-cropped, resampled,
rotated and composited around registered joints. The same cutout sources create
all poses; metadata records actual joint positions, including opposed foot
contacts and moving tools, so pose variety is not inferred from image hashes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

HERE = Path(__file__).resolve().parent
CANVAS = (384, 448)
PIVOT = (192, 412)
PART_NAMES = [
    "head", "torso", "skirt", "upper_near", "fore_near",
    "upper_far", "fore_far", "thigh_near", "shin_near", "shoe_near",
    "thigh_far", "shin_far", "shoe_far", "hammer",
]
# Source rectangles are deliberately not a guessed evenly spaced grid.
WORKER_REGIONS = [
    [20, 100, 265, 445], [265, 5, 590, 480], [585, 110, 885, 449],
    [885, 70, 1095, 410], [1095, 85, 1317, 450],
    [1317, 65, 1535, 425], [1545, 75, 1774, 453],
    [20, 442, 290, 849], [305, 463, 525, 852], [545, 640, 780, 850],
    [780, 443, 1040, 852], [1040, 463, 1245, 856],
    [1260, 640, 1480, 853], [1485, 463, 1774, 856],
]


def vec(x, y=None):
    return np.asarray(x if y is None else [x, y], dtype=float)


def rotate(point, angle):
    c, s = math.cos(angle), math.sin(angle)
    return vec(c * point[0] - s * point[1], s * point[0] + c * point[1])


def crop_part(source, rect):
    """Keep the largest connected alpha silhouette inside its authored region."""
    crop = source.crop(rect).convert("RGBA")
    pixels = np.asarray(crop).copy()
    mask = pixels[..., 3] > 24
    labels, _ = ndimage.label(mask)
    counts = np.bincount(labels.ravel())
    counts[0] = 0
    label = int(counts.argmax())
    body = labels == label
    # Keep original soft alpha in a one-pixel border, never paint a new edge.
    body = ndimage.binary_dilation(body, iterations=1)
    pixels[..., 3] = np.where(body, pixels[..., 3], 0)
    clean = Image.fromarray(pixels)
    bbox = clean.getbbox()
    if not bbox:
        raise ValueError(f"No painted component in {rect}")
    return clean.crop(bbox), [rect[0] + bbox[0], rect[1] + bbox[1], rect[0] + bbox[2], rect[1] + bbox[3]]


def export_parts(source_path, out_dir, regions=None):
    source = Image.open(source_path).convert("RGBA")
    out_dir.mkdir(parents=True, exist_ok=True)
    result = {}
    for name, region in zip(PART_NAMES, regions or WORKER_REGIONS):
        image, bbox = crop_part(source, region)
        temporary = out_dir / f".{name}.{os.getpid()}.png"
        image.save(temporary)
        temporary.replace(out_dir / f"{name}.png")
        result[name] = {"file": f"{name}.png", "source_rect": bbox, "size": list(image.size)}
    temporary = out_dir / f".parts.{os.getpid()}.json"
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(out_dir / "parts.json")
    return result


def place_matrix(canvas, image, matrix, translation):
    inverse = np.linalg.inv(matrix)
    offset = -inverse @ translation
    affine = (inverse[0, 0], inverse[0, 1], offset[0], inverse[1, 0], inverse[1, 1], offset[1])
    layer = image.transform(CANVAS, Image.Transform.AFFINE, affine, Image.Resampling.BICUBIC)
    canvas.alpha_composite(layer)


def place_bone(canvas, image, start, end, source_a, source_b, width=None):
    """Map the hand-painted part's authored joint line onto a target bone."""
    a, b = vec(source_a) * vec(image.size), vec(source_b) * vec(image.size)
    source_axis, target_axis = b - a, vec(end) - vec(start)
    scale = np.linalg.norm(target_axis) / np.linalg.norm(source_axis)
    angle = math.atan2(target_axis[1], target_axis[0]) - math.atan2(source_axis[1], source_axis[0])
    c, s = math.cos(angle), math.sin(angle)
    matrix = np.array([[c, -s], [s, c]]) * scale
    if width:
        # Controlled anatomical thickness in source local coordinates.
        along = source_axis / np.linalg.norm(source_axis)
        across = vec(-along[1], along[0])
        ratio = width / (image.width * scale)
        source_shape = np.outer(along, along) + np.outer(across, across) * ratio
        matrix = matrix @ source_shape
    place_matrix(canvas, image, matrix, vec(start) - matrix @ a)


def place_box(canvas, image, anchor, anchor_uv, size, angle=0):
    c, s = math.cos(angle), math.sin(angle)
    matrix = np.array([[c, -s], [s, c]]) @ np.diag(vec(size) / vec(image.size))
    place_matrix(canvas, image, matrix, vec(anchor) - matrix @ (vec(anchor_uv) * vec(image.size)))


def joint_between(start, end, length_a, length_b, bend=1):
    delta = end - start
    dist = max(1.0, np.linalg.norm(delta))
    dist = min(dist, length_a + length_b - .01)
    axis = delta / np.linalg.norm(delta)
    offset = (length_a**2 - length_b**2 + dist**2) / (2 * dist)
    lift = math.sqrt(max(0, length_a**2 - offset**2))
    return start + axis * offset + vec(-axis[1], axis[0]) * lift * bend


class CharacterRig:
    def __init__(self, source, profile=None):
        self.source = Path(source)
        profile = profile or {}
        self.profile = profile
        cache = self.source.parent / (self.source.stem.replace("-original", "") + "-parts")
        regions = profile.get("regions")
        if regions is None and "merchant" in self.source.stem:
            regions = [r.copy() for r in WORKER_REGIONS]
            regions[1] = [260, 5, 610, 478]
            regions[7:14] = [
                [15, 442, 295, 860], [295, 470, 495, 860], [500, 640, 760, 860],
                [750, 443, 1035, 860], [1035, 470, 1225, 860],
                [1225, 640, 1450, 860], [1450, 463, 1774, 860],
            ]
        export_parts(self.source, cache, regions)
        self.parts = {name: Image.open(cache / f"{name}.png").convert("RGBA") for name in PART_NAMES}
        self.part_metadata = json.loads((cache / "parts.json").read_text())
        self.back = "nw" in self.source.stem or profile.get("back", False)
        if self.back and "worker" in self.source.stem:
            # Generated reverse-view shoes retained a front-facing toe. Reflection
            # corrects their travel orientation; no older pixels are substituted.
            for name in ["shoe_near", "shoe_far"]:
                self.parts[name] = ImageOps.mirror(self.parts[name])
        for name in ["upper_near", "upper_far"]:
            limb = self.parts[name]
            # The source shows a detached socket opening. Its hidden insertion
            # cap is cropped off at the overlap so it cannot appear on a clothed
            # shoulder after assembly; all visible sleeve pixels remain painted.
            self.parts[name] = limb.crop((0, round(limb.height * .19), limb.width, limb.height))
        for name in ["fore_near", "fore_far"]:
            limb = self.parts[name]
            self.parts[name] = limb.crop((0, round(limb.height * .14), limb.width, limb.height))

    def render(self, action, frame, frame_count=8, props=None):
        props = props or {}
        phase = frame / frame_count * math.tau
        walking = action in ["walk", "timber", "brick", "water_walk", "merchant_walk", "artisan_walk"]
        carrying = action in ["timber", "brick"]
        work = action in ["load", "water_work", "merchant_work", "artisan_work"]
        climbing = action == "climb"
        hammering = action == "hammer"
        # Back-facing characters advance along the reverse diagonal.
        forward = vec(-.8944, -.4472) if self.back else vec(.8944, .4472)
        dir_sign = -1 if self.back else 1
        bob = 2.0 * math.cos(2 * phase) if walking else 0
        bend = (1 - math.cos(phase)) * .5 if work else 0
        hip = vec(PIVOT[0], 273 + bob + bend * 38)
        torso_angle = dir_sign * bend * .65
        shoulder_center = hip + rotate(vec(0, -70), torso_angle)
        neck = hip + rotate(vec(3, -88), torso_angle)
        if climbing:
            hip += vec(0, -12)
            shoulder_center += vec(0, -12)
            neck += vec(0, -12)
        hips = {"near": hip + vec(-9, 3), "far": hip + vec(9, -3)}
        shoulders = {"near": shoulder_center + rotate(vec(-31, 4), torso_angle), "far": shoulder_center + rotate(vec(27, -12), torso_angle)}
        ankles, knees, elbows, hands = {}, {}, {}, {}
        stride = 23 if walking else 0
        for side, flip in [("near", 0), ("far", math.pi)]:
            t = phase + flip
            travel = math.cos(t)
            lift = max(0, math.sin(t))
            base = vec(PIVOT[0] + (-12 if side == "near" else 12), PIVOT[1] - (8 if side == "near" else 14))
            ankles[side] = base + forward * stride * travel - vec(0, 18 * lift if walking else 0)
            if climbing:
                ankles[side] = base + vec(dir_sign * (4 + 9 * travel), -42 - 24 * travel)
            knees[side] = joint_between(hips[side], ankles[side], 68, 65, -dir_sign)
            if walking:
                hands[side] = shoulders[side] + vec(0, 100) - forward * (20 * travel)
            else:
                hands[side] = shoulders[side] + vec(dir_sign * 8, 100)
            if carrying:
                hands[side] = hip + vec(dir_sign * 27 + (-18 if side == "far" else 10), -23 + (-5 if side == "far" else 4))
            if work:
                hands[side] = hip + vec(dir_sign * (36 + bend * 24) + (-10 if side == "far" else 10), -14 + bend * 35)
            if action == "water_walk":
                hands[side] = shoulders[side] + vec(dir_sign * 6, 94) + forward * (3 * travel)
            if action == "merchant_walk":
                # The shaft grips are behind the walking merchant: the handcart
                # is pulled, with stable hands trailing the hips, not pushed.
                hands[side] = shoulders[side] + vec(-dir_sign * 20, 91)
            if climbing:
                hands[side] = shoulders[side] + vec(dir_sign * (18 + 12 * travel), -26 - 28 * travel)
            if hammering and side == "near":
                # Clearly separated preparation, raised, strike, and recovery.
                poses = [(35, 15), (20, -38), (25, -70), (45, -25), (75, 45), (74, 48), (55, 35), (40, 22)]
                dx, dy = poses[frame % 8]
                hands[side] = shoulders[side] + vec(dx * dir_sign, dy)
            reach = hands[side] - shoulders[side]
            if np.linalg.norm(reach) > 102:
                hands[side] = shoulders[side] + reach / np.linalg.norm(reach) * 102
            elbows[side] = joint_between(shoulders[side], hands[side], 51, 53, dir_sign if side == "near" else -dir_sign)
        image = Image.new("RGBA", CANVAS)
        joints = {"hip": hip.tolist(), "neck": neck.tolist(), "shoulders": {}, "elbows": {}, "hands": {}, "hips": {}, "knees": {}, "ankles": {}}

        def leg(side):
            shoe = self.parts[f"shoe_{side}"]
            place_box(image, shoe, ankles[side], (.65 if self.back else .28, .25), (38, 26))
            # Lower-leg / shoe insertion collars sit behind the preceding body
            # segment, so no hollow socket from the detached kit is exposed.
            place_bone(image, self.parts[f"shin_{side}"], knees[side], ankles[side], (.50, .08), (.50, .92), 30)
            place_bone(image, self.parts[f"thigh_{side}"], hips[side], knees[side], (.50, .10), (.50, .90), 39)

        def upper_arm(side):
            place_bone(image, self.parts[f"upper_{side}"], shoulders[side], elbows[side], (.28, .15), (.68, .88))

        def forearm(side):
            place_bone(image, self.parts[f"fore_{side}"], elbows[side], hands[side], (.25, .06), (.72, .84))

        leg("far")
        upper_arm("far")
        forearm("far")
        leg("near")
        place_box(image, self.parts["torso"], hip, (.50, .79), (89, 125), torso_angle)
        place_box(image, self.parts["head"], neck, (.52, .89), (42, 50), torso_angle * .55)
        if carrying and action in props:
            place_box(image, props[action], (hands["near"] + hands["far"]) * .5, (.5, .55), (111, 54) if action == "timber" else (51, 45))
        if action in ["load", "artisan_work"] and "brick" in props:
            place_box(image, props["brick"], (hands["near"] + hands["far"]) * .5 + vec(0, 7), (.5, .50), (48, 43))
        upper_arm("near")
        forearm("near")
        if hammering:
            handle = self.parts["hammer"]
            tool_vectors = [(18, -40), (0, -50), (5, -55), (40, -30), (46, 25), (47, 28), (30, -5), (24, -30)]
            tip_x, tip_y = tool_vectors[frame % 8]
            angle = math.atan2(tip_y, tip_x * dir_sign) - math.atan2(-.63 * 63, -.44 * 25)
            # Hand grips the lower handle, not the hammer head.
            place_box(image, handle, hands["near"], (.72, .78), (25, 63), angle)
        if action.startswith("water_"):
            bucket = props.get("bucket", self.parts["hammer"])
            for side in ["far", "near"]:
                place_box(image, bucket, hands[side] + vec(0, 6), (.5, .10), (30, 40))
        if action == "merchant_work":
            basket = props.get("basket", self.parts["hammer"])
            place_box(image, basket, (hands["near"] + hands["far"]) * .5 + vec(0, 7), (.5, .16), (46, 42))
        for label, collection in [("shoulders", shoulders), ("elbows", elbows), ("hands", hands), ("hips", hips), ("knees", knees), ("ankles", ankles)]:
            joints[label] = {key: value.tolist() for key, value in collection.items()}
        return image, joints


_RIG_CACHE = {}


@lru_cache(maxsize=8)
def load_props(path=None, back=False):
    path = Path(path or HERE / "props-original.png")
    if not path.exists():
        return {}
    source = Image.open(path).convert("RGBA")
    regions = {
        "timber": [550, 20, 1095, 480] if back else [10, 20, 545, 480],
        "brick": [15, 495, 510, 1000] if back else [1100, 20, 1536, 480],
        "sack": [1060, 490, 1536, 1000] if back else [540, 490, 1030, 1000],
    }
    return {name: crop_part(source, rect)[0] for name, rect in regions.items()}


def build_character(source, direction, action, frame, props=None, profile=None):
    """Return RGBA frame + actual joints; directions are 0 NW,1 NE,2 SW,3 SE."""
    path = str(Path(source).resolve())
    if path not in _RIG_CACHE:
        _RIG_CACHE[path] = CharacterRig(path, profile)
    image, joints = _RIG_CACHE[path].render(action, frame, 8, props)
    if direction in [1, 2]:
        image = ImageOps.mirror(image)
        for key in ["hip", "neck"]:
            joints[key][0] = CANVAS[0] - joints[key][0]
        for key in ["shoulders", "elbows", "hands", "hips", "knees", "ankles"]:
            for point in joints[key].values():
                point[0] = CANVAS[0] - point[0]
    return image, joints


def build_set(role, source_se, source_nw, actions, output, props=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    sprites, animations = {}, {}
    preview = Image.new("RGBA", (CANVAS[0] * 8, CANVAS[1] * len(actions)), "#637367")
    for action_i, action in enumerate(actions):
        for direction in range(4):
            keys = []
            source = source_nw if direction in [0, 1] else source_se
            for frame in range(8):
                actual_props = props if props is not None else load_props(Path(source_se).parent / "props-original.png", back=direction in [0, 1])
                image, joints = build_character(source, direction, action, frame, actual_props)
                key = f"{action}/{direction}/{frame}"
                filename = f"{action}-{direction}-{frame}.png"
                image.save(output / filename)
                sprites[key] = {"file": filename, "pivot": list(PIVOT), "world_scale": .088, "joints": joints}
                keys.append(key)
                if direction == 3:
                    preview.alpha_composite(image, (frame * CANVAS[0], action_i * CANVAS[1]))
            animations[f"{action}/{direction}"] = {"frames": keys, "cycles_per_tile": 8.5, "fps": 8 if action in ["walk", "timber", "brick"] else 5, "loop": True}
    manifest = {
        "version": 4, "role": role, "method": "articulated_new_painted_parts",
        "source_art": [
            {"file": str(Path(source_se).resolve()), "sha256": hashlib.sha256(Path(source_se).read_bytes()).hexdigest()},
            {"file": str(Path(source_nw).resolve()), "sha256": hashlib.sha256(Path(source_nw).read_bytes()).hexdigest()},
        ],
        "frame_size": list(CANVAS), "directions": 4, "sprites": sprites, "animations": animations,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    preview.save(output / "contact-se.png")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--role", default="worker")
    parser.add_argument("--source-dir", type=Path, default=HERE)
    parser.add_argument("--source-se", type=Path)
    parser.add_argument("--source-nw", type=Path)
    parser.add_argument("--output", "--output-dir", dest="output", type=Path)
    parser.add_argument("--actions", nargs="+", default=["walk", "timber", "brick", "load", "hammer", "climb"])
    args = parser.parse_args()
    source_role = "worker" if args.role == "artisan" else args.role
    source_se = args.source_se or args.source_dir / f"{source_role}-se-original.png"
    source_nw = args.source_nw or args.source_dir / f"{source_role}-nw-original.png"
    output = args.output or args.source_dir / f"{args.role}-frames"
    build_set(args.role, source_se, source_nw, args.actions, output)
