#!/usr/bin/env python3
"""Build an animation.json for the proof-animation engine — deterministic, no LM.

Takes a chain of LaTeX states (a derivation), threads them so a sub-expression
that persists keeps the SAME node id across states (via graph_ops.diff/apply),
and renders each state to **annotated LaTeX** (``\\htmlData{n=<id>}{...}``) with
those stable ids. The JS engine then FLIP-morphs between any two states keyed on
``data-n``.

Usage:
    ./run.sh scripts/proof_animation_build.py --sample --out /tmp/animation.json
    ./run.sh scripts/proof_animation_build.py --out a.json "x^2 - 4 = 0" "x^2 = 4" "x = 2"
    ./run.sh scripts/proof_animation_build.py --from-json traj.json --out a.json
"""
from __future__ import annotations

import argparse
import json

from backend.semantic_graph.service import SemanticGraphService
from backend.semantic_graph.latex_renderer import to_latex
from backend.experts.modules.proof_completion.graph_ops import diff, apply

# A deterministic sample derivation (no fractions → renders cleanly in v1).
SAMPLE = {
    "title": "Isolate a",
    "domain": "algebra",
    "states": [
        {"latex": r"a + b - c = 0", "operation": "start"},
        {"latex": r"a + b = c", "operation": "add c to both sides",
         "justification": "c moves across the equals sign"},
        {"latex": r"a = c - b", "operation": "subtract b from both sides",
         "justification": "b moves across the equals sign"},
    ],
}


def build(states: list[dict], domain: str, title: str = "") -> dict:
    """Thread states to stable ids and render annotated LaTeX per state."""
    svc = SemanticGraphService()
    working = None
    out = []
    for i, st in enumerate(states):
        ltx = st["latex"]
        g = svc.latex_to_graph(ltx, domain=domain)
        if g is None:
            raise SystemExit(f"could not parse state {i}: {ltx!r}")
        # thread: keep stable ids for sub-expressions that persist
        working = g if working is None else apply(working, diff(working, g))
        out.append({
            "index": i,
            "operation": st.get("operation", ""),
            "justification": st.get("justification", ""),
            "input_latex": ltx,                       # what was authored
            "latex": to_latex(working, with_ids=True),  # annotated, stable ids
            "plain": to_latex(working),                 # for labels/fallback
        })
    return {"title": title, "domain": domain, "steps": out}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("states", nargs="*", help="LaTeX states (the derivation chain)")
    ap.add_argument("--domain", default="algebra")
    ap.add_argument("--title", default="")
    ap.add_argument("--sample", action="store_true", help="use the baked sample chain")
    ap.add_argument("--from-json", default=None,
                    help="a derive --json trajectory (uses start_latex + steps[].expr_latex)")
    ap.add_argument("--out", default="/tmp/animation.json")
    args = ap.parse_args()

    if args.sample:
        data = build(SAMPLE["states"], SAMPLE["domain"], SAMPLE["title"])
    elif args.from_json:
        traj = json.load(open(args.from_json))
        states = ([{"latex": traj["start_latex"], "operation": "start"}]
                  + [{"latex": s["expr_latex"], "operation": s.get("operation", ""),
                      "justification": s.get("justification", "")}
                     for s in traj["steps"]])
        data = build(states, args.domain, args.title or traj.get("kind", ""))
    elif args.states:
        data = build([{"latex": s} for s in args.states], args.domain, args.title)
    else:
        ap.error("provide states, --sample, or --from-json")

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    print(f"wrote {args.out}  ({len(data['steps'])} states)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
