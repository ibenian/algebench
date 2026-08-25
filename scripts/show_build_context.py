#!/usr/bin/env python3
"""Print what the scene builder will actually be shown.

The context is assembled in the CLIENT (src/builder-context.ts) and rendered
here, so the only way to see a prompt without running one is to take a request
body and format it. `tests/fixtures/build_scene_request.json` is written by the
assembler's own test, which makes it a real sample rather than a hand-made one.

    ./run.sh scripts/show_build_context.py
    ./run.sh scripts/show_build_context.py --request some_request.json

Field markers are shown the way DSPy frames them, so what you read here is what
the model reads — no LM is called.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.experts.handlers.build_scene import format as fmt  # noqa: E402
from backend.experts.handlers.build_scene.models import BuildSceneRequest  # noqa: E402

DEFAULT = ROOT / "tests" / "fixtures" / "build_scene_request.json"


def render(req: BuildSceneRequest) -> list[tuple[str, str]]:
    """One entry per `dspy.InputField`. Add a field here and in the signature."""
    req.require_consistent()
    current, neighbours, notes = req.scenes()
    return [
        ("intent", fmt.format_intent(req.intent)),
        ("lesson", fmt.format_lesson(req.lesson)),
        ("conventions", fmt.format_conventions(req.conventions)),
        ("existing_names", fmt.format_existing_names(req.sliderVocabulary, req.memory)),
        ("neighbours", fmt.format_neighbours(neighbours)),
        ("current", fmt.format_current(current)),
        ("clarifications", fmt.format_clarifications(req.clarifications)),
        ("omitted", fmt.format_omitted(list(req.omitted) + notes)),
    ]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--request", type=pathlib.Path, default=DEFAULT,
                    help=f"a build_scene request body (default: {DEFAULT.relative_to(ROOT)})")
    ap.add_argument("--field", help="show only this field")
    args = ap.parse_args()

    req = BuildSceneRequest.model_validate(json.loads(args.request.read_text()))
    fields = render(req)

    for name, value in fields:
        if args.field and name != args.field:
            continue
        print(f"[[ ## {name} ## ]]")
        print(value or "(empty)")
        print()

    shown = sum(len(v) for n, v in fields if not args.field or n == args.field)
    print("—" * 60)
    print(f"{req.op} at scene {req.sceneIndex}   |   context {shown:,} chars")


if __name__ == "__main__":
    main()
