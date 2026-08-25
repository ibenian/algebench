#!/usr/bin/env python3
"""Print what the scene builder will actually be shown.

The context is assembled in the CLIENT (src/builder-context.ts) and rendered
here, so the only way to see a prompt without running one is to take a request
body and format it. `tests/fixtures/build_scene_request.json` is written by the
assembler's own test, which makes it a real sample rather than a hand-made one.

    ./run.sh scripts/show_build_context.py
    ./run.sh scripts/show_build_context.py --request some_request.json

No LM is called, and nothing here is an imitation: the content comes from the
same `format_*` functions the handler calls, and the framing comes from
`LineAdapter().format()` — the adapter that will render the real request. So a
change to DSPy's framing shows up here instead of silently diverging from a
hand-printed copy.

`--raw` prints the messages as the provider receives them, system prompt
included. That is where the output-format instructions live, and worth looking
at: the adapter currently appends ChatAdapter's "must be formatted as a valid
Python list[...]" reminder, which contradicts the line-block template in its own
system message.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.experts.adapters.line_adapter import LineAdapter  # noqa: E402
from backend.experts.handlers.build_scene import format as fmt  # noqa: E402
from backend.experts.handlers.build_scene.models import BuildSceneRequest  # noqa: E402
from backend.experts.handlers.build_scene.signature import (  # noqa: E402
    INPUT_FIELDS, BuildSceneInputs,
)

DEFAULT = ROOT / "tests" / "fixtures" / "build_scene_request.json"


def render_inputs(req: BuildSceneRequest) -> dict[str, str]:
    """Request -> one STRING per `dspy.InputField`, keyed by field name.

    The dict here is the field MAP — `format(signature, demos, inputs)` takes
    exactly this — and not a field VALUE. The difference is the whole point:
    DSPy serialises a dict-shaped VALUE with `json.dumps`, doubling every
    backslash in the prompt, while the map itself is iterated and each value
    formatted on its own. Every value below is already `str`, so each one takes
    the `str(...)` branch and no escaping happens.

    This is the whole of what the builder is told, and it moves into the handler
    as-is: the handler's extra job is calling the LM, not choosing different
    context.
    """
    req.require_consistent()
    current, neighbours, notes = req.scenes()
    return {
        "intent": fmt.format_intent(req.intent),
        "lesson": fmt.format_lesson(req.lesson),
        "conventions": fmt.format_conventions(req.conventions),
        "existing_names": fmt.format_existing_names(req.sliderVocabulary, req.memory),
        "neighbours": fmt.format_neighbours(neighbours),
        "current": fmt.format_current(current),
        "clarifications": fmt.format_clarifications(req.clarifications),
        "omitted": fmt.format_omitted(list(req.omitted) + notes),
    }


def messages(req: BuildSceneRequest) -> list[dict]:
    """The prompt, framed by the ADAPTER that will frame the real one.

    Hand-printing `[[ ## name ## ]]` here would keep looking correct after DSPy's
    format changed — the failure mode of every hand-maintained mirror. Going
    through the adapter means a change there shows up here.
    """
    return LineAdapter().format(BuildSceneInputs, [], render_inputs(req))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--request", type=pathlib.Path, default=DEFAULT,
                    help=f"a build_scene request body (default: {DEFAULT.relative_to(ROOT)})")
    ap.add_argument("--field", help="show only this field")
    ap.add_argument("--raw", action="store_true",
                    help="print the messages as the provider receives them")
    args = ap.parse_args()

    req = BuildSceneRequest.model_validate(json.loads(args.request.read_text()))
    fields = render_inputs(req)

    msgs = messages(req)
    if args.raw:
        for m in msgs:
            print(f"===== {m['role'].upper()} " + "=" * 46)
            print(m["content"])
            print()
    else:
        user = [m for m in msgs if m["role"] == "user"][-1]["content"]
        if args.field:
            print(_only(user, args.field))
        else:
            print(user)

    total = sum(len(m["content"]) for m in msgs)
    print("—" * 60)
    print(f"{req.op} at scene {req.sceneIndex}   |   "
          f"context {sum(len(v) for v in fields.values()):,} chars   |   "
          f"prompt {total:,} chars")


def _only(user: str, field: str) -> str:
    """One field out of the rendered user message, markers and all."""
    if field not in INPUT_FIELDS:
        raise SystemExit(f"unknown field {field!r}; choose from {', '.join(INPUT_FIELDS)}")
    blocks = re.split(r"(?=\[\[ ## )", user)
    return "".join(b for b in blocks if b.startswith(f"[[ ## {field} ## ]]")).rstrip()


if __name__ == "__main__":
    main()
