#!/usr/bin/env python3
"""Drive the build_scene expert end to end, from a request body.

    ./run.sh scripts/build_scene.py                 # dry run: the prompt only
    ./run.sh scripts/build_scene.py --call          # actually calls the LM
    ./run.sh scripts/build_scene.py --call --intent "add a scene about the dot product"

DRY BY DEFAULT, because `--call` spends a real API request. The dry run is not a
courtesy: this pipeline has produced a readable prompt and an unbuildable scene
more than once, and reading the prompt is how each of those was caught.

The request body defaults to `tests/fixtures/build_scene_request.json`, which is
written by the client assembler's own test — so it is a real request rather than
one hand-made here.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

DEFAULT = ROOT / "tests" / "fixtures" / "build_scene_request.json"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--request", type=pathlib.Path, default=DEFAULT)
    ap.add_argument("--intent", help="override the request's intent")
    ap.add_argument("--op", choices=("insert", "replace"), help="override the op")
    ap.add_argument("--call", action="store_true", help="call the LM (costs a request)")
    args = ap.parse_args()

    body = json.loads(args.request.read_text())
    if args.intent:
        body["intent"] = args.intent
    if args.op:
        body["op"] = args.op
        if args.op == "insert":
            body["current"] = None      # require_consistent: insert carries none

    from backend.experts.handlers.build_scene.format import render_inputs
    from backend.experts.handlers.build_scene.models import BuildSceneRequest

    req = BuildSceneRequest.model_validate(body)

    if not args.call:
        from backend.experts.adapters.line_adapter import LineAdapter
        from backend.experts.modules.build_scene.signature import BuildSceneSig

        msgs = LineAdapter().format(BuildSceneSig, [], render_inputs(req))
        print(f"DRY RUN — no LM called. {sum(len(m['content']) for m in msgs):,} chars of prompt.")
        print(f"{req.op} at scene {req.sceneIndex}: {req.intent!r}")
        print("\nPass --call to send it.")
        return

    from backend.experts import init_experts
    from backend.experts.handlers.build_scene.handler import build_scene

    init_experts()
    out = build_scene(req)

    for key in ("fallback_to_chat", "question", "reason"):
        if key in out:
            print(f"{key}: {out[key]}")
            return

    scene = out["result"]["ops"][0]["node"]
    print(json.dumps(scene, indent=1, ensure_ascii=False))
    print(f"\n{len(scene.get('elements') or [])} scene-level element(s), "
          f"{len(scene.get('steps') or [])} step(s), "
          f"range={scene.get('range')}")


if __name__ == "__main__":
    main()
