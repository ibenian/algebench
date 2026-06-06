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

from collections import defaultdict

from backend.semantic_graph.service import SemanticGraphService
from backend.semantic_graph.latex_renderer import to_latex
from backend.experts.modules.proof_completion.graph_ops import wl_colors


def _rebase(prev, gnew):
    """Relabel gnew so a sub-expression that persists keeps prev's id, while
    preserving gnew's OWN structure (authored side order).

    This is the #353 rebase done simply: match nodes by content-only WL color
    (same as ``diff``) and reuse the previous state's id for matched nodes; mint
    a fresh, collision-free id for genuinely new ones. Unlike ``apply(prev,
    diff(prev, gnew))`` (which rebuilds from prev and can reorder ``=`` sides),
    this leaves gnew's layout intact — so the morph shows just the terms that
    move, not a spurious left↔right flip of the whole equation.
    """
    cp, cn = wl_colors(prev, rounds=0), wl_colors(gnew, rounds=0)
    prev_by = defaultdict(list)
    for nid in sorted(cp):
        prev_by[cp[nid]].append(nid)
    new_by = defaultdict(list)
    for nid in sorted(cn):
        new_by[cn[nid]].append(nid)

    final, taken, unmatched = {}, set(), []
    for col, news in new_by.items():
        prevs, pi = prev_by.get(col, []), 0
        for nid in news:
            if pi < len(prevs):           # matched → reuse prev id
                final[nid] = prevs[pi]; taken.add(prevs[pi]); pi += 1
            else:
                unmatched.append(nid)
    k = 0
    for nid in unmatched:                  # new node → keep own id, dedup if needed
        tgt = nid
        while tgt in taken:
            k += 1; tgt = f"_r{k}_{nid}"
        final[nid] = tgt; taken.add(tgt)

    g = gnew.model_copy(deep=True)
    for n in g.nodes:
        n.id = final[n.id]
    for e in g.edges:
        e.from_, e.to = final[e.from_], final[e.to]
    return g

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

# A few demos for the local launcher (each renders cleanly + threads stably).
SAMPLES = [
    SAMPLE,
    {
        "title": "Expand the binomial",
        "domain": "algebra",
        "states": [
            {"latex": r"(x + 1)^2", "operation": "start"},
            {"latex": r"x^2 + 2 x + 1", "operation": "expand",
             "justification": "multiply out and collect like terms"},
        ],
    },
    {
        "title": "Factor the difference of squares",
        "domain": "algebra",
        "states": [
            {"latex": r"a^2 - b^2", "operation": "start"},
            {"latex": r"(a - b)(a + b)", "operation": "factor",
             "justification": "difference of squares"},
        ],
    },
    {
        "title": "Relativistic energy–momentum",
        "domain": "algebra",
        "states": [
            {"latex": r"E^2 = (m c^2)^2 + (p c)^2", "operation": "start",
             "justification": "the energy–momentum relation"},
            {"latex": r"E = \sqrt{(m c^2)^2 + (p c)^2}", "operation": "take the square root"},
            {"latex": r"E = \sqrt{m^2 c^4 + p^2 c^2}", "operation": "expand the squares"},
            {"latex": r"E = \sqrt{c^2 \cdot (m^2 c^2 + p^2)}", "operation": "factor out c²"},
            {"latex": r"E = c \sqrt{m^2 c^2 + p^2}", "operation": "pull c out of the root"},
            {"latex": r"E = m c^2 \sqrt{1 + \frac{p^2}{m^2 c^2}}", "operation": "factor out m²c²",
             "justification": "the standard Lorentz-factor form"},
        ],
    },
    {
        "title": "Lorentz time dilation",
        "domain": "algebra",
        "states": [
            {"latex": r"(c t)^2 = (c t_0)^2 + (v t)^2", "operation": "start",
             "justification": "light-clock Pythagorean relation"},
            {"latex": r"c^2 t^2 = c^2 t_0^2 + v^2 t^2", "operation": "expand the squares"},
            {"latex": r"c^2 t^2 - v^2 t^2 = c^2 t_0^2", "operation": "collect the t terms"},
            {"latex": r"t^2 \cdot (c^2 - v^2) = c^2 t_0^2", "operation": "factor out t²"},
            {"latex": r"t^2 = \frac{c^2 t_0^2}{c^2 - v^2}", "operation": "divide by (c² − v²)"},
            {"latex": r"t^2 = \frac{t_0^2}{1 - \frac{v^2}{c^2}}", "operation": "divide top and bottom by c²"},
            {"latex": r"t = \frac{t_0}{\sqrt{1 - \frac{v^2}{c^2}}}", "operation": "take the square root",
             "justification": "moving clocks run slow by the Lorentz factor"},
        ],
    },
]


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
        # rebase: keep g's authored structure, reuse stable ids for persisting parts
        working = g if working is None else _rebase(working, g)
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
