#!/usr/bin/env python3
"""Rebuild both V4 actor atlases exclusively from the retained new paintings."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
V4 = HERE / "v4"
ART = HERE.parents[1]
actions = {
    "worker": ["walk", "timber", "brick", "load", "hammer", "climb"],
    "water": ["water_walk", "water_work"],
    "merchant": ["merchant_walk", "merchant_work"],
    "artisan": ["artisan_walk", "artisan_work"],
}

for role, sequences in actions.items():
    subprocess.run([
        sys.executable, str(V4 / "people/build_people_rig.py"),
        "--role", role, "--actions", *sequences,
    ], check=True)
subprocess.run([sys.executable, str(V4 / "people/test_people_rig.py")], check=True)
subprocess.run([sys.executable, str(V4 / "vehicles/extract_vehicles.py")], check=True)
with tempfile.TemporaryDirectory(prefix="original-actor-v4-") as temporary:
    subprocess.run([
        sys.executable, str(V4 / "build_actor_atlases.py"),
        "--output-root", temporary,
    ], check=True)
    for folder, stem in [("workers", "workers-atlas"), ("citizens", "logistics-atlas")]:
        for extension in ["json", "webp"]:
            destination = ART / folder / f"{stem}.{extension}"
            staged = destination.with_suffix(destination.suffix + ".next")
            shutil.copyfile(Path(temporary) / f"{stem}.{extension}", staged)
            staged.replace(destination)
print("Installed the two shared V4 actor atlases. Godot import/export remains a separate step.")
