"""Build all offline artifacts needed for the ReviewGap demo runtime."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def run(script: str) -> None:
    subprocess.run([sys.executable, script], cwd=ROOT, check=True)


if __name__ == "__main__":
    run("EDA/scripts/export_runtime_artifacts.py")
    run("EDA/scripts/train_review_classifier.py")
