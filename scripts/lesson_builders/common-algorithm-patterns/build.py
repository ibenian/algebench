"""Regenerate scenes/draft/common-algorithm-patterns.json from its TypeScript generator.

The traces live in algorithms.ts beside this file; the generator prints the
lesson JSON and this wrapper writes it in the repo's compact-leaves format.

Usage: ./run.sh scripts/lesson_builders/common-algorithm-patterns/build.py
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
from _json_format import dumps_compact_leaves  # noqa: E402  (the shared formatter lives in scripts/)

OUT = ROOT / "scenes" / "draft" / "common-algorithm-patterns.json"


def main():
    raw = subprocess.run(
        ["node", "--experimental-strip-types", "--no-warnings", "--import", "./scripts/register-test-resolver.mjs",
         "scripts/lesson_builders/common-algorithm-patterns/build.ts"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout
    lesson = json.loads(raw)
    text = dumps_compact_leaves(lesson) + "\n"
    assert json.loads(text) == lesson
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(lesson['scenes'])} scenes")


if __name__ == "__main__":
    main()
