"""Read-only atlas checks and a checkerboard contact sheet; no asset repainting."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import argparse
import hashlib
import json
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
parser = argparse.ArgumentParser()
parser.add_argument("--contact", type=Path, default=ROOT / "work/components-contact.png")
parser.add_argument("--require-complete", action="store_true")
parser.add_argument("--baseline", type=Path, help="Prior manifest whose component coordinates and atlas hashes must remain unchanged")
args = parser.parse_args()
manifest = json.loads((HERE.parent / "manifest.json").read_text())
stable_layout = json.loads((HERE / "atlas-layout.json").read_text())
baseline_count = 0
if args.baseline:
    baseline = json.loads(args.baseline.read_text())
    for key, item in baseline["parts"].items():
        assert manifest["parts"][key]["rect"] == item["rect"], (key, "published rect moved")
        assert manifest["parts"][key]["atlas"] == item["atlas"], (key, "published atlas changed")
    for key, page in baseline["atlases"].items():
        assert manifest["atlases"][key] == page, (key, "published page changed")
    baseline_count = len(baseline["parts"])
generation = json.loads((HERE / "generation-record.json").read_text())
for sheet in generation["sheets"]:
    source = HERE / sheet["source"]
    assert hashlib.sha256(source.read_bytes()).hexdigest() == sheet["sha256"], source
    assert sheet["prompt"].strip(), (sheet["sheet"], "missing generation prompt")
    tool_path = Path(sheet.get("tool_output") or "/nonexistent-original-output")
    if tool_path.is_file():
        assert hashlib.sha256(tool_path.read_bytes()).hexdigest() == sheet["sha256"], (sheet["sheet"], "original output differs")
if args.require_complete:
    assert manifest["complete"], manifest["missing_parts"]
    assert len(manifest["parts"]) == manifest["expected_parts"]

pages = {}
for record in manifest["atlases"].values():
    path = ROOT / "godot" / record["path"].removeprefix("res://")
    image = Image.open(path).convert("RGBA")
    pixels = np.array(image)
    assert list(image.size) == record["size"]
    assert max(image.size) <= 4096
    assert hashlib.sha256(path.read_bytes()).hexdigest() == record["sha256"]
    assert not pixels[:, :, :3][pixels[:, :, 3] == 0].any(), path
    assert not ((pixels[:, :, 3] > 0) & (pixels[:, :, 3] <= generation.get("alpha_clear_threshold", 0))).any(), (path, "low-alpha fringe remains")
    pages[record["path"]] = (image, pixels)

migration_pixels_preserved = 0
if manifest.get("layout_migration"):
    migration_path = ROOT / manifest["layout_migration"]
    migration = json.loads(migration_path.read_text())
    assert migration["status"] == "validated", "Layout migration has not finished its pixel comparison"
    target = migration["target"]
    _, merged = pages[target["path"]]
    assert list(merged.shape[:2][::-1]) == target["size"]
    assert hashlib.sha256(merged.tobytes()).hexdigest() == target["rgba_sha256"]
    for old_page in migration["pages"].values():
        tx, ty = old_page["translation"]
        w, h = old_page["size"]
        region = np.ascontiguousarray(merged[ty:ty+h, tx:tx+w])
        assert hashlib.sha256(region.tobytes()).hexdigest() == old_page["rgba_sha256"], "Migrated page pixels differ"
        migration_pixels_preserved += w * h
    for key, old_part in migration["parts"].items():
        assert manifest["parts"][key]["rect"] == old_part["after_rect"], (key, "migration translation differs")
        x, y, w, h = old_part["after_rect"]
        region = np.ascontiguousarray(merged[y:y+h, x:x+w])
        assert hashlib.sha256(region.tobytes()).hexdigest() == old_part["rgba_sha256"], (key, "migrated component pixels differ")

cell_w, cell_h, columns = 240, 230, 6
rows = (len(manifest["parts"]) + columns - 1) // columns
contact = Image.new("RGB", (cell_w * columns, cell_h * rows), "#eee9df")
draw = ImageDraw.Draw(contact)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
except OSError:
    font = ImageFont.load_default(size=14)
source_images = {}
results = []
for index, (key, item) in enumerate(manifest["parts"].items()):
    atlas, pixels = pages[item["atlas"]]
    x, y, w, h = item["rect"]
    assert stable_layout["placements"][key]["rect"] == item["rect"], (key, "stable layout disagrees")
    assert [w, h] == item["native_size"] == item["source_rect"][2:], key
    gutter = manifest["padding"]
    assert x >= gutter and y >= gutter
    assert x + w + gutter <= atlas.width and y + h + gutter <= atlas.height
    surrounding = pixels[y-gutter:y+h+gutter, x-gutter:x+w+gutter, 3].copy()
    surrounding[gutter:gutter+h, gutter:gutter+w] = 0
    assert not surrounding.any(), (key, "gutter collision")
    original = source_images.get(item["source"])
    if original is None:
        original = np.array(Image.open(ROOT / item["source"]).convert("RGBA"))
        source_images[item["source"]] = original
    sx, sy, sw, sh = item["source_rect"]
    source_crop = original[sy:sy+sh, sx:sx+sw]
    actual = pixels[y:y+h, x:x+w]
    visible = actual[:, :, 3] > 0
    assert visible.any(), (key, "empty crop")
    assert np.array_equal(source_crop[visible], actual[visible]), (key, "source pixels changed")
    left, top = (index % columns) * cell_w, (index // columns) * cell_h
    draw.rectangle((left, top, left+cell_w-1, top+cell_h-1), outline="#b8b2a7")
    draw.text((left+10, top+8), key, fill="#24221e", font=font)
    for yy in range(top+30, top+cell_h-5, 12):
        for xx in range(left+6, left+cell_w-6, 12):
            color = "#c9c7c0" if ((xx-left)//12 + (yy-top)//12) % 2 else "#eeece7"
            draw.rectangle((xx, yy, min(xx+11,left+cell_w-7), min(yy+11,top+cell_h-6)), fill=color)
    thumb = atlas.crop((x, y, x+w, y+h))
    thumb.thumbnail((cell_w-24, cell_h-50), Image.Resampling.LANCZOS)
    contact.paste(thumb, (left+(cell_w-thumb.width)//2, top+32+(cell_h-40-thumb.height)//2), thumb)
    results.append({"key": key, "native_pixels_preserved": True, "transparent_gutter": gutter, "native_size": [w, h]})
args.contact.parent.mkdir(parents=True, exist_ok=True)
contact.save(args.contact)
report = {
    "part_count": len(results),
    "original_sheets": len(generation["sheets"]),
    "prior_parts_and_atlases_preserved": baseline_count,
    "layout_migration_pixels_preserved": migration_pixels_preserved,
    "complete": manifest["complete"],
    "page_sizes": [record["size"] for record in manifest["atlases"].values()],
    "source_visible_rgba_unchanged": True,
    "transparent_rgb_zero": True,
    "parts": results
}
(HERE / "validation.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"parts": len(results), "complete": manifest["complete"], "contact": str(args.contact), "checks": "source RGBA, native dimensions, transparent RGB, atlas bounds, 16px gutters, checksums passed"}))
