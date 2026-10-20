#!/usr/bin/env python3
"""Compatibility entry point for the shared original V4 actor pipeline."""
from pathlib import Path
import subprocess
import sys

entry = Path(__file__).resolve().parents[2] / "workers/sources/build-atlas.py"
subprocess.run([sys.executable, str(entry)], check=True)
