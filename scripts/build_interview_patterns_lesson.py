"""Regenerate scenes/draft/interview-patterns.json from its TypeScript generator.

The traces live in src/algorithms/interview-patterns.ts; the generator prints the
lesson JSON and this wrapper writes it in the repo's compact-leaves format.

Usage: ./run.sh scripts/build_interview_patterns_lesson.py
"""

import json
import subprocess
from pathlib import Path

from _json_format import dumps_compact_leaves

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scenes" / "draft" / "interview-patterns.json"


def main():
    raw = subprocess.run(
        ["node", "--experimental-strip-types", "--no-warnings", "--import", "./scripts/register-test-resolver.mjs",
         "scripts/build-interview-patterns-lesson.ts"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout
    lesson = json.loads(raw)
    text = dumps_compact_leaves(lesson) + "\n"
    assert json.loads(text) == lesson
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(lesson['scenes'])} scenes")


if __name__ == "__main__":
    main()
