#!/usr/bin/env python3
"""Recheck explicit sources, exact native atlas pixels, metadata and gutters."""
import argparse
import json
from pathlib import Path
from pipeline import ROOT, validate

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--spec", type=Path, default=ROOT / "godot/art/components/sources/v4/component-spec.json")
parser.add_argument("--output", type=Path, default=ROOT / "work/art-v4/packed")
parser.add_argument("--allow-incomplete", action="store_true")
args = parser.parse_args()
print(json.dumps(validate(args.spec.resolve(), args.output.resolve(), args.allow_incomplete), ensure_ascii=False))
