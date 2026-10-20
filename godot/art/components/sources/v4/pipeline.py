"""Explicit, pixel-preserving component import. This module never paints art."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[5]
SOURCE_ROOT = Path(__file__).resolve().parent
ALPHA_FLOOR = 5
PADDING = 16
MAX_SIDE = 4096
RUNTIME_ATLAS = "res://art/components/components-0.webp"
AUTHORED_FIELDS = (
    "family", "variant", "anchor_role", "reference_size", "reference_projection", "reference_axis",
    "emission_mode", "emission_profile", "plane_uv_mode", "calibration",
    "native_plan_ratio", "source_plane_order", "orientation", "leaf_role", "image_axis",
    "masonry_height_ratio", "emission_mask",
)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def relative(path: Path) -> str:
    return str(path.resolve().relative_to(ROOT))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def source_path(value: str) -> Path:
    path = (ROOT / value).resolve()
    require(path.is_relative_to(SOURCE_ROOT), f"Only explicit v4 sources are permitted: {value}")
    require(path.is_file(), f"Missing source: {value}")
    return path


def cleaned(image: Image.Image) -> np.ndarray:
    """Discard almost invisible alpha noise; retain every other native pixel."""
    pixels = np.array(image.convert("RGBA"))
    pixels[pixels[:, :, 3] <= ALPHA_FLOOR] = 0
    return pixels


def selected_rect(part: dict, sheet: dict, size: tuple[int, int]) -> list[int]:
    require(("source_rect" in part) != ("cell" in part),
            f"{part['key']}: choose exactly one explicit source_rect or cell")
    if "source_rect" in part:
        rect = part["source_rect"]
    else:
        grid = sheet.get("grid", {})
        columns, rows = int(grid.get("columns", 0)), int(grid.get("rows", 0))
        require(columns > 0 and rows > 0, f"{part['key']}: cell requires a sheet grid")
        column, row = part["cell"]
        require(0 <= column < columns and 0 <= row < rows,
                f"{part['key']}: cell is outside declared grid")
        bounds = grid.get("rect", [0, 0, *size])
        gx, gy, gw, gh = bounds
        x0, x1 = gx + column * gw // columns, gx + (column + 1) * gw // columns
        y0, y1 = gy + row * gh // rows, gy + (row + 1) * gh // rows
        rect = [x0, y0, x1 - x0, y1 - y0]
    require(len(rect) == 4 and all(isinstance(v, int) for v in rect),
            f"{part['key']}: source selection must use integer pixels")
    x, y, w, h = rect
    require(x >= 0 and y >= 0 and w > 8 and h > 8 and x + w <= size[0] and y + h <= size[1],
            f"{part['key']}: selection is outside the source image: {rect}")
    return rect


def normalized_point(point: list, rect: list) -> list[float]:
    x, y, w, h = rect
    return [(float(point[0]) - x) / w, (float(point[1]) - y) / h]


def normalize_metadata(part: dict, rect: list) -> dict:
    key = part["key"]
    require(part.get("kind") in ("surface", "prop"), f"{key}: kind must be explicit")
    require(("pivot_source" in part) != ("pivot" in part),
            f"{key}: author exactly one pivot_source or normalized pivot")
    pivot = normalized_point(part["pivot_source"], rect) if "pivot_source" in part else part["pivot"]
    require(len(pivot) == 2 and all(math.isfinite(float(v)) for v in pivot), f"{key}: invalid pivot")
    if any(v < 0 or v > 1 for v in pivot):
        require(part.get("anchor_role") == "shared_assembly_center",
                f"{key}: an out-of-frame pivot requires shared_assembly_center")
    metadata = {"kind": part["kind"], "pivot": pivot}
    if "pivot_source" in part:
        metadata["pivot_source"] = part["pivot_source"]
    for field in AUTHORED_FIELDS:
        if field in part:
            metadata[field] = part[field]
    if "image_axis_source" in part:
        metadata["image_axis"] = [normalized_point(point, rect) for point in part["image_axis_source"]]
    if "image_axis" in metadata:
        axis = metadata["image_axis"]
        require(len(axis) == 2 and all(len(point) == 2 for point in axis)
                and all(math.isfinite(v) and 0 <= v <= 1 for point in axis for v in point)
                and axis[0] != axis[1], f"{key}: image_axis must contain two distinct in-frame endpoints")
    if part["kind"] == "prop":
        require("reference_size" in part, f"{key}: prop requires reference_size to retain native aspect")
        require(len(part["reference_size"]) == 2 and all(v > 0 for v in part["reference_size"]),
                f"{key}: reference_size must contain positive native pixel dimensions")
        metadata.setdefault("reference_projection", "isometric")
        require(metadata["reference_projection"] in ("isometric", "circle"), f"{key}: unknown reference projection")
        require(metadata.get("reference_axis", "width") in ("width", "height"), f"{key}: unknown reference axis")
    if part["kind"] == "surface":
        require(("plane_bounds_source" in part) != ("plane_bounds" in part),
                f"{key}: author exactly one surface plane bound")
    if "plane_bounds_source" in part:
        left, top, right, bottom = part["plane_bounds_source"]
        metadata["plane_bounds"] = (
            normalized_point([left, top], rect) + normalized_point([right, bottom], rect)
        )
    elif "plane_bounds" in part:
        metadata["plane_bounds"] = part["plane_bounds"]
    if "plane_bounds" in metadata:
        left, top, right, bottom = metadata["plane_bounds"]
        require(0 <= left < right <= 1 and 0 <= top < bottom <= 1,
                f"{key}: plane_bounds must describe a nonempty surface within its crop")
    if "emission_rect_source" in part:
        x, y, w, h = part["emission_rect_source"]
        u, v = normalized_point([x, y], rect)
        metadata["emission_rect"] = [u, v, w / rect[2], h / rect[3]]
    elif "emission_rect" in part:
        metadata["emission_rect"] = part["emission_rect"]
    if "emission_rect" in metadata:
        x, y, w, h = metadata["emission_rect"]
        require(0 <= x < x + w <= 1 and 0 <= y < y + h <= 1,
                f"{key}: emission rectangle extends outside its image")
    if "planes_source" in part:
        metadata["source_planes"] = {
            name: [normalized_point(point, rect) for point in points]
            for name, points in part["planes_source"].items()
        }
        require(set(metadata["source_planes"]) == {"top", "side_x", "side_y"},
                f"{key}: source planes require top, side_x and side_y")
        for points in metadata["source_planes"].values():
            require(len(points) == 4 and all(0 <= v <= 1 for p in points for v in p),
                    f"{key}: invalid source plane corners")
    return metadata


def load_components(spec_path: Path, allow_incomplete: bool = False) -> tuple[dict, list, dict]:
    spec = read_json(spec_path)
    require(spec.get("art_version") == 4, "This pipeline only accepts explicit art_version 4")
    require(spec.get("tool") == "image_gen", "New art must identify its image generation tool")
    require(spec.get("parts"), "No authored component selections exist yet")
    require(spec.get("required_keys"), "Spec must name its complete required runtime key set")
    require(len(spec["required_keys"]) == len(set(spec["required_keys"])), "Required key list contains duplicates")
    retired = read_json(SOURCE_ROOT / "retired-art-hashes.json")
    retired_source_hashes = set(retired["source_sha256"])
    retired_crop_hashes = set(retired["part_rgba_sha256"].values())
    sheet_specs = spec.get("sheets", [])
    sheets: dict[str, dict] = {}
    sheet_records = []
    for sheet in sheet_specs:
        sheet_id = sheet["id"]
        require(sheet_id not in sheets, f"Duplicate sheet id: {sheet_id}")
        require(sheet.get("source_reviewed") is True, f"{sheet_id}: source has not been visually reviewed")
        require(bool(sheet.get("prompt", "").strip()), f"{sheet_id}: generation prompt or honestly labelled specification summary is required")
        require(sheet.get("prompt_capture") in ("verbatim", "specification_summary"),
                f"{sheet_id}: prompt_capture must distinguish verbatim prompts from summaries")
        path = source_path(sheet["source"])
        source_hash = digest(path.read_bytes())
        require(source_hash == sheet.get("sha256"), f"{sheet_id}: source hash differs from authored spec")
        require(source_hash not in retired_source_hashes, f"{sheet_id}: rejected legacy source reused")
        with Image.open(path) as opened:
            require("A" in opened.getbands(), f"{sheet_id}: true transparent alpha is required")
            image = opened.convert("RGBA")
        pixels = cleaned(image)
        require(np.any(pixels[:, :, 3] == 0), f"{sheet_id}: source has no transparent background")
        require(np.any(pixels[:, :, 3] >= 240), f"{sheet_id}: source has no opaque art")
        sheets[sheet_id] = {"spec": sheet, "image": image, "pixels": pixels}
        sheet_records.append({
            "id": sheet_id, "source": relative(path), "source_sha256": source_hash,
            "size": list(image.size), "source_reviewed": True,
            "assembly_accepted": sheet.get("assembly_accepted") is True,
            "prompt": sheet["prompt"], "prompt_capture": sheet["prompt_capture"],
            "reference_role": sheet.get("reference_role", "original generation informed by visual reference"),
            **({"tool_output": sheet["tool_output"]} if "tool_output" in sheet else {}),
            **({"assembly_preview": sheet["assembly_preview"]} if "assembly_preview" in sheet else {}),
            **({"assembly_review": sheet["assembly_review"]} if "assembly_review" in sheet else {}),
        })
    components = []
    seen_keys, seen_hashes = set(), {}
    for part in spec["parts"]:
        key = part["key"]
        require(key not in seen_keys, f"Duplicate key: {key}")
        require(bool(key) and all(c.islower() or c.isdigit() or c == "_" for c in key), f"Invalid key: {key}")
        require(not set(key.split("_")) & {"house", "villa", "whole", "building", "complete", "architecture", "room", "roof"},
                f"{key}: only independent leaf components are permitted")
        seen_keys.add(key)
        require(part["sheet"] in sheets, f"{key}: undefined sheet")
        sheet = sheets[part["sheet"]]
        selection = selected_rect(part, sheet["spec"], sheet["image"].size)
        x, y, w, h = selection
        source_crop = sheet["pixels"][y:y + h, x:x + w].copy()
        if "source_polygon" in part:
            polygon = part["source_polygon"]
            require(len(polygon) >= 3 and all(len(point) == 2 for point in polygon),
                    f"{key}: source_polygon requires at least three explicit source pixel vertices")
            require(all(isinstance(v, int) for point in polygon for v in point),
                    f"{key}: source polygon vertices must use integer pixels")
            require(all(x <= px < x + w and y <= py < y + h for px, py in polygon),
                    f"{key}: source polygon must lie inside its explicit selection")
            # A reviewed polygon only selects existing source pixels. It cannot
            # paint, move or synthesize any asset pixel.
            mask = Image.new("L", (w, h), 0)
            ImageDraw.Draw(mask).polygon([(px - x, py - y) for px, py in polygon], fill=255)
            source_crop[np.array(mask) == 0] = 0
        alpha = source_crop[:, :, 3]
        require(np.count_nonzero(alpha > 24) > 100, f"{key}: empty or negligible component")
        require(not np.any(alpha[0]) and not np.any(alpha[-1]) and not np.any(alpha[:, 0]) and not np.any(alpha[:, -1]),
                f"{key}: visible art touches selection boundary; author a larger nonoverlapping selection")
        mode = part.get("crop_mode", "alpha_bbox")
        require(mode in ("alpha_bbox", "selection"), f"{key}: unsupported crop mode")
        if mode == "alpha_bbox":
            ys, xs = np.where(alpha > 0)
            margin = int(part.get("trim_margin", 2))
            require(margin >= 1, f"{key}: transparent trim margin is required")
            x0, y0 = max(0, int(xs.min()) - margin), max(0, int(ys.min()) - margin)
            x1, y1 = min(w, int(xs.max()) + margin + 1), min(h, int(ys.max()) + margin + 1)
            rect = [x + x0, y + y0, x1 - x0, y1 - y0]
            pixels = source_crop[y0:y1, x0:x1].copy()
        else:
            rect, pixels = selection, source_crop.copy()
        require(min(rect[2:]) > 8 and max(rect[2:]) + 2 * PADDING <= MAX_SIDE,
                f"{key}: invalid native crop size {rect[2:]}")
        pixel_hash = digest(pixels.tobytes())
        require(pixel_hash not in retired_crop_hashes, f"{key}: rejected legacy component pixels reused")
        require(pixel_hash not in seen_hashes, f"{key}: exact duplicate image of {seen_hashes.get(pixel_hash)}")
        seen_hashes[pixel_hash] = key
        metadata = normalize_metadata(part, rect)
        metadata.update({
            "source": sheet["spec"]["source"], "source_rect": rect,
            "selection_rect": selection, "native_size": rect[2:], "sheet": part["sheet"],
            "source_sha256": sheet["spec"]["sha256"], "rgba_sha256": pixel_hash,
            "crop_mode": mode,
        })
        if "source_polygon" in part:
            metadata["source_polygon"] = part["source_polygon"]
        components.append({"key": key, "pixels": pixels, "meta": metadata})
    missing = sorted(set(spec["required_keys"]) - seen_keys)
    require(allow_incomplete or not missing, f"Missing required runtime components: {', '.join(missing)}")
    records = {
        "schema": 1, "art_version": 4, "tool": spec["tool"],
        "spec": relative(spec_path), "spec_sha256": digest(spec_path.read_bytes()),
        "reference_evidence": spec.get("reference_evidence", []),
        "operations": ["explicit authored source selection",
                       "explicit reviewed source polygon isolation where declared; original selected pixels unchanged",
                       "transparent alpha bbox trim", "alpha <= 5 cleanup",
                       "native pixel atlas packing; no scaling, painting, perspective warping or rotation"],
        "legacy_pixels_reused": False, "sheets": sheet_records,
    }
    return spec, components, records


def pack(components: list) -> tuple[int, dict]:
    """MaxRects, deterministic, no rotation or image resampling."""
    ordered = sorted(components, key=lambda p: (-max(p["meta"]["native_size"]),
                                              -math.prod(p["meta"]["native_size"]), p["key"]))
    total = sum((p["meta"]["native_size"][0] + 2 * PADDING) *
                (p["meta"]["native_size"][1] + 2 * PADDING) for p in ordered)
    require(total <= MAX_SIDE * MAX_SIDE, f"Native pixels plus gutters exceed the single {MAX_SIDE}px atlas")
    for side in (1024, 2048, 4096):
        if side * side < total:
            continue
        free = [(0, 0, side, side)]
        placements = {}
        for part in ordered:
            w, h = (v + 2 * PADDING for v in part["meta"]["native_size"])
            candidates = [(min(fw - w, fh - h), max(fw - w, fh - h), y, x, index)
                          for index, (x, y, fw, fh) in enumerate(free) if fw >= w and fh >= h]
            if not candidates:
                break
            _, _, y, x, _ = min(candidates)
            placed = (x, y, w, h)
            next_free = []
            for fx, fy, fw, fh in free:
                if x >= fx + fw or x + w <= fx or y >= fy + fh or y + h <= fy:
                    next_free.append((fx, fy, fw, fh))
                    continue
                if x > fx:
                    next_free.append((fx, fy, x - fx, fh))
                if x + w < fx + fw:
                    next_free.append((x + w, fy, fx + fw - x - w, fh))
                if y > fy:
                    next_free.append((fx, fy, fw, y - fy))
                if y + h < fy + fh:
                    next_free.append((fx, y + h, fw, fy + fh - y - h))
            free = []
            for item in sorted(set(next_free)):
                fx, fy, fw, fh = item
                if not any(item != other and ox <= fx and oy <= fy and
                           ox + ow >= fx + fw and oy + oh >= fy + fh
                           for other in next_free for ox, oy, ow, oh in [other]):
                    free.append(item)
            placements[part["key"]] = [placed[0] + PADDING, placed[1] + PADDING,
                                       placed[2] - 2 * PADDING, placed[3] - 2 * PADDING]
        if len(placements) == len(components):
            return side, placements
    raise ValueError(f"Native components do not fit one {MAX_SIDE}px atlas; split generation sheets into smaller leaf art")


def emission_mask(part: dict, settings: dict) -> tuple[Image.Image, dict]:
    """Compute lighting data from native pixels, not from a minified color atlas."""
    require(settings.get("algorithm") == "dark_recess_v1", "Unknown emission mask algorithm")
    pixels = part["pixels"].astype(np.float64) / 255.0
    height, width = pixels.shape[:2]
    lower, upper = settings["luminance_thresholds"]
    require(0 <= lower < upper <= 1, "Invalid emission luminance thresholds")
    weights = np.array(settings["luminance_weights"], dtype=np.float64)
    require(weights.shape == (3,) and abs(float(weights.sum()) - 1) < 1e-6, "Invalid luminance weights")
    luminance = pixels[:, :, :3] @ weights
    t = np.clip((luminance - lower) / (upper - lower), 0, 1)
    inverse_smoothstep = 1 - t * t * (3 - 2 * t)
    rx, ry, rw, rh = part["meta"]["emission_rect"]
    yy, xx = np.mgrid[0:height, 0:width]
    xx, yy = xx + .5, yy + .5
    edge_distance = np.minimum.reduce([
        xx - rx * width, (rx + rw) * width - xx,
        yy - ry * height, (ry + rh) * height - yy,
    ])
    border = np.clip(edge_distance / settings["border_feather_native_pixels"], 0, 1)
    border = border * border * (3 - 2 * border)
    native_mask = inverse_smoothstep * pixels[:, :, 3] * border
    crop_x, crop_y, _, _ = part["meta"]["source_rect"]
    for x, y, w, h in settings.get("wood_guard_rects_source", []):
        guarded = (xx >= x - crop_x) & (xx < x + w - crop_x) & (yy >= y - crop_y) & (yy < y + h - crop_y)
        native_mask[guarded] = 0
    image = Image.fromarray(np.rint(native_mask * 255).astype(np.uint8), "L")
    output_size = settings.get("size", [256, 256])
    image = image.resize(tuple(output_size), Image.Resampling.LANCZOS)
    # Resize is only of derived lighting data. Source component pixels stay native.
    result = np.array(image)
    rect_pixels = (xx >= rx * width) & (xx < (rx + rw) * width) & (yy >= ry * height) & (yy < (ry + rh) * height)
    samples = {}
    for name, rectangles in settings.get("diagnostic_regions_source", {}).items():
        region = np.zeros((height, width), dtype=bool)
        for x, y, w, h in rectangles:
            region |= (xx >= x - crop_x) & (xx < x + w - crop_x) & (yy >= y - crop_y) & (yy < y + h - crop_y)
        samples[name] = {"pixels": int(region.sum()), "mean_transmission": float(native_mask[region].mean())}
    record = {
        "path": settings["path"], "format": "R8 grayscale PNG; linear data, not source_color",
        "size": output_size, "uv": "normalized full component crop; use part_uv directly",
        "source": part["meta"]["source"], "source_sha256": part["meta"]["source_sha256"],
        "source_rect": part["meta"]["source_rect"], "source_rgba_sha256": part["meta"]["rgba_sha256"],
        "algorithm": settings["algorithm"], "luminance_weights": settings["luminance_weights"],
        "luminance_thresholds": settings["luminance_thresholds"],
        "formula": "(1-smoothstep(low,high,native_luminance))*native_alpha*aperture_border; authored wood guards are zero",
        "emission_rect": part["meta"]["emission_rect"],
        "border_feather_native_pixels": settings["border_feather_native_pixels"],
        "wood_guard_rects_source": settings.get("wood_guard_rects_source", []),
        "mipmaps": True, "filter": "linear_mipmap", "source_pixels_modified": False,
        "native_mean_transmission": float(native_mask.mean()),
        "native_aperture_mean_transmission": float(native_mask[rect_pixels].mean()),
        "native_aperture_fraction_above_half": float((native_mask[rect_pixels] >= .5).mean()),
        "packed_mean_transmission": float(result.mean() / 255.0),
        "diagnostic_regions": samples,
    }
    return image, record


def build(spec_path: Path, output: Path, allow_incomplete: bool = False) -> dict:
    output = output.resolve()
    require(output.is_relative_to(ROOT / "work" / "art-v4"),
            "Preview outputs must stay within work/art-v4; production activation is a separate reviewed operation")
    spec, components, records = load_components(spec_path, allow_incomplete)
    side, placements = pack(components)
    pixels = np.zeros((side, side, 4), dtype=np.uint8)
    metadata = {}
    for part in components:
        rect = placements[part["key"]]
        x, y, w, h = rect
        pixels[y:y + h, x:x + w] = part["pixels"]
        metadata[part["key"]] = {**part["meta"], "atlas": RUNTIME_ATLAS, "rect": rect}
    output.mkdir(parents=True, exist_ok=True)
    atlas_path = output / "components-0.webp"
    Image.fromarray(pixels).save(atlas_path, "WEBP", lossless=True, exact=True, method=6)
    source_record = SOURCE_ROOT / "generation-record.json"
    source_layout = SOURCE_ROOT / "atlas-layout.json"
    missing = sorted(set(spec["required_keys"]) - set(metadata))
    manifest = {
        "schema": 1, "art_version": 4, "projection": "2:1 dimetric image assembly",
        "provenance": "Fresh original image_gen components informed by the supplied visual reference; mechanical native-pixel extraction and packing only.",
        "generation_record": relative(source_record), "source_layout": relative(source_layout),
        "layout_mode": "single_shared_texture", "complete": not missing,
        "ready_for_activation": not missing and all(sheet.get("assembly_accepted") is True for sheet in spec["sheets"]),
        "expected_parts": len(set(spec["required_keys"]) | set(metadata)), "missing_parts": missing,
        "padding": PADDING, "coordinate_contract": {
            "rect": "atlas pixels x,y,width,height excluding padding",
            "pivot": "normalized point relative to rect; an external shared center is explicitly marked",
            "plane_bounds": "normalized left,top,right,bottom relative to rect",
            "emission_rect": "normalized x,y,width,height relative to rect",
        },
        "atlases": {"0": {
            "path": RUNTIME_ATLAS, "size": [side, side], "sha256": digest(atlas_path.read_bytes()),
            "rgba_sha256": digest(pixels.tobytes()), "mipmaps": True, "fix_alpha_border": True,
        }},
        "parts": metadata,
    }
    if spec.get("emission_masks"):
        manifest["emission_masks"] = {}
        lookup = {part["key"]: part for part in components}
        for key, settings in spec["emission_masks"].items():
            require(key in lookup, f"Emission mask refers to missing component: {key}")
            image, record = emission_mask(lookup[key], settings)
            path = output / Path(settings["path"]).name
            image.save(path, "PNG")
            record["sha256"] = digest(path.read_bytes())
            manifest["emission_masks"][key] = record
    layout = {
        "schema": 1, "art_version": 4, "mode": "single_shared_texture", "padding": PADDING,
        "size": [side, side], "parts": placements,
        "source_spec": relative(spec_path), "source_spec_sha256": digest(spec_path.read_bytes()),
    }
    # v4 records are separate from production's legacy records and migration hashes.
    write_json(source_record, records)
    write_json(source_layout, layout)
    write_json(output / "generation-record.json", records)
    write_json(output / "atlas-layout.json", layout)
    write_json(output / "manifest.json", manifest)
    write_json(output / "build-summary.json", {
        "art_version": 4, "components": len(metadata), "complete": not missing,
        "missing_keys": missing, "atlas_size": [side, side], "atlas_bytes": atlas_path.stat().st_size,
        "source_pixel_area": sum(math.prod(part["meta"]["native_size"]) for part in components),
        "production_written": False,
    })
    return manifest


def validate(spec_path: Path, output: Path, allow_incomplete: bool = False) -> dict:
    spec, components, records = load_components(spec_path, allow_incomplete)
    manifest = read_json(output / "manifest.json")
    require(manifest.get("art_version") == 4, "Manifest is not v4")
    require("layout_migration" not in manifest, "A new art replacement must not claim the old pixel-preserving migration")
    require(len(manifest["atlases"]) == 1, "Exactly one shared atlas is required")
    atlas_meta = manifest["atlases"]["0"]
    atlas_path = output / Path(atlas_meta["path"]).name
    require(digest(atlas_path.read_bytes()) == atlas_meta["sha256"], "Packed atlas file hash differs")
    with Image.open(atlas_path) as image:
        pixels = np.array(image.convert("RGBA"))
    height, width = pixels.shape[:2]
    require([width, height] == atlas_meta["size"] and max(width, height) <= MAX_SIDE, "Atlas dimensions invalid")
    require(digest(pixels.tobytes()) == atlas_meta["rgba_sha256"], "Atlas native RGBA hash differs")
    require(not np.any(pixels[pixels[:, :, 3] == 0, :3]), "Transparent atlas RGB must be zero")
    require(atlas_meta["mipmaps"] is True and atlas_meta["fix_alpha_border"] is True, "Runtime texture import contract missing")
    require(set(manifest["parts"]) == {part["key"] for part in components}, "Manifest key set differs from spec")
    occupied = np.zeros((height, width), dtype=bool)
    for part in components:
        key = part["key"]
        metadata = manifest["parts"][key]
        x, y, w, h = metadata["rect"]
        require(w == part["pixels"].shape[1] and h == part["pixels"].shape[0], f"{key}: native dimensions changed")
        require(x >= PADDING and y >= PADDING and x + w + PADDING <= width and y + h + PADDING <= height,
                f"{key}: atlas bounds or gutters invalid")
        require(not np.any(occupied[y - PADDING:y + h + PADDING, x - PADDING:x + w + PADDING]),
                f"{key}: padded atlas rectangles overlap")
        occupied[y - PADDING:y + h + PADDING, x - PADDING:x + w + PADDING] = True
        require(np.array_equal(pixels[y:y + h, x:x + w], part["pixels"]),
                f"{key}: atlas differs from explicitly selected native source pixels")
        padded = pixels[y - PADDING:y + h + PADDING, x - PADDING:x + w + PADDING, 3].copy()
        padded[PADDING:PADDING + h, PADDING:PADDING + w] = 0
        require(not np.any(padded), f"{key}: nontransparent gutters")
        for field, value in part["meta"].items():
            require(metadata.get(field) == value, f"{key}: authored metadata changed: {field}")
    for key, settings in spec.get("emission_masks", {}).items():
        source = next(part for part in components if part["key"] == key)
        expected, record = emission_mask(source, settings)
        path = output / Path(settings["path"]).name
        actual = Image.open(path)
        require(actual.mode == "L" and actual.size == expected.size, f"{key}: emission mask must be native R8 data")
        require(actual.tobytes() == expected.tobytes(), f"{key}: emission mask differs from the documented native-pixel formula")
        record["sha256"] = digest(path.read_bytes())
        require(manifest.get("emission_masks", {}).get(key) == record, f"{key}: emission mask provenance differs")
    local_record = read_json(output / "generation-record.json")
    require(local_record == records, "Generation provenance differs from explicit source spec")
    missing = sorted(set(spec["required_keys"]) - set(manifest["parts"]))
    require(manifest["missing_parts"] == missing, "Manifest missing-key set differs from the authored spec")
    require(manifest["complete"] == (not missing), "Completeness fields disagree")
    require(manifest["expected_parts"] == len(set(spec["required_keys"]) | set(manifest["parts"])),
            "Manifest expected-part count differs from the authored spec")
    require(manifest["ready_for_activation"] == (not missing and all(sheet.get("assembly_accepted") is True
                                                                   for sheet in spec["sheets"])),
            "Assembly acceptance differs from the authored source reviews")
    result = {
        "passed": True, "art_version": 4, "components": len(components),
        "atlas_size": [width, height], "native_pixel_comparisons": len(components),
        "transparent_gutter_checks": len(components), "legacy_pixels_reused": False,
        "emission_mask_checks": len(spec.get("emission_masks", {})),
        "complete": manifest["complete"], "missing_keys": manifest["missing_parts"],
        "production_written": False,
    }
    write_json(output / "validation.json", result)
    return result
