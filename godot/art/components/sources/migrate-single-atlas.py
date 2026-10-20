"""Explicit 72-part five-page -> 4096 shared-atlas layout migration.

This only translates existing images. It never scales, rotates, paints, or bakes
an assembled building. The regular builder reproduces the resulting layout from
the original generated source sheets, without requiring old runtime page files.
"""
from pathlib import Path
from PIL import Image
import hashlib
import json
import os
import subprocess
import sys
import numpy as np

HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parent
ROOT = HERE.parents[3]
RECORD = HERE / "migrations/2026-10-20-single-atlas"
TRANSLATIONS = {"0": [0, 0], "1": [2048, 0], "2": [0, 2048],
                "3": [2048, 2048], "4": [2048, 2304]}
MIGRATION_PATH = "godot/art/components/sources/migrations/2026-10-20-single-atlas/migration.json"

def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, path)

def digest(pixels):
    return hashlib.sha256(np.ascontiguousarray(pixels).tobytes()).hexdigest()

manifest_path = OUTPUT / "manifest.json"
layout_path = HERE / "atlas-layout.json"
before = json.loads(manifest_path.read_text())
if before.get("layout_mode") == "single_shared_texture":
    record = json.loads((RECORD / "migration.json").read_text())
    assert record["status"] == "validated"
    assert len(before["atlases"]) == 1
    print("Shared atlas migration already applied; use validate-atlases.py.")
    sys.exit(0)
assert len(before["parts"]) == 72 and set(before["atlases"]) == set(TRANSLATIONS)
before_layout = json.loads(layout_path.read_text())
atomic_json(RECORD / "before-manifest.json", before)
atomic_json(RECORD / "before-layout.json", before_layout)
old_pixels = {}
page_evidence = {}
for index, page in before["atlases"].items():
    path = ROOT / "godot" / page["path"].removeprefix("res://")
    assert hashlib.sha256(path.read_bytes()).hexdigest() == page["sha256"]
    pixels = np.array(Image.open(path).convert("RGBA"))
    old_pixels[index] = pixels
    tx, ty = TRANSLATIONS[index]
    assert tx + pixels.shape[1] <= 4096 and ty + pixels.shape[0] <= 4096
    page_evidence[index] = {"before_path": page["path"], "before_file_sha256": page["sha256"],
                            "size": page["size"], "translation": [tx, ty],
                            "rgba_sha256": digest(pixels)}

placements = {}
parts_evidence = {}
for key, item in before["parts"].items():
    page_index = str(before_layout["placements"][key]["page"])
    tx, ty = TRANSLATIONS[page_index]
    x, y, w, h = item["rect"]
    target = [x + tx, y + ty, w, h]
    placements[key] = {"page": 0, "rect": target}
    parts_evidence[key] = {"before_atlas": item["atlas"], "before_rect": item["rect"],
                           "after_rect": target, "rgba_sha256": digest(old_pixels[page_index][y:y+h, x:x+w])}
record = {"schema": 1, "status": "prepared", "date": "2026-10-20",
          "reason": "One shared leaf-component texture prevents texture switches from breaking engine primitive batching.",
          "authorization": "Root requested this explicit performance layout migration after the 72-component freeze.",
          "operation": "Integer translation only; no resampling, rotation, recoloring, alpha changes, or building bake.",
          "target": {"path": "res://art/components/components-0.webp", "size": [4096, 4096]},
          "parts": parts_evidence, "pages": page_evidence}
atomic_json(RECORD / "migration.json", record)
atomic_json(layout_path, {"schema": 1, "padding": before["padding"],
                         "layout_mode": "single_shared_texture", "migration": MIGRATION_PATH,
                         "page_sizes": {"0": [4096, 4096]}, "placements": placements,
                         "note": "Explicitly migrated to one shared texture. Retain these coordinates until another documented layout migration."})
subprocess.run([sys.executable, str(HERE / "build-atlases.py")], cwd=ROOT, check=True)
after = json.loads(manifest_path.read_text())
assert set(after["atlases"]) == {"0"} and len(after["parts"]) == 72
new_path = ROOT / "godot" / after["atlases"]["0"]["path"].removeprefix("res://")
pixels = np.array(Image.open(new_path).convert("RGBA"))
assert pixels.shape == (4096, 4096, 4)
for index, old in old_pixels.items():
    tx, ty = TRANSLATIONS[index]
    region = pixels[ty:ty+old.shape[0], tx:tx+old.shape[1]]
    assert np.array_equal(region, old), (index, "old page pixels changed")
    page_evidence[index]["rgba_preserved"] = True
for key, item in after["parts"].items():
    old_item = before["parts"][key]
    assert {k: v for k, v in item.items() if k not in ("rect", "atlas")} == {
        k: v for k, v in old_item.items() if k not in ("rect", "atlas")}, (key, "component metadata changed")
    assert item["rect"] == parts_evidence[key]["after_rect"]
assert sorted(p.name for p in OUTPUT.glob("components-*.webp")) == ["components-0.webp"]
assert sorted(p.name for p in OUTPUT.glob("components-*.webp.import")) == ["components-0.webp.import"]
record["status"] = "validated"
record["target"]["file_sha256"] = after["atlases"]["0"]["sha256"]
record["target"]["rgba_sha256"] = digest(pixels)
record["preserved_parts"] = 72
record["preserved_source_page_pixels"] = sum(p.shape[0] * p.shape[1] for p in old_pixels.values())
record["transparent_padding_preserved"] = True
record["old_runtime_pages_removed"] = True
atomic_json(RECORD / "migration.json", record)
print(json.dumps({"parts": 72, "target": [4096, 4096],
                  "old_page_rgba_equal": True, "old_runtime_pages_removed": True}))
