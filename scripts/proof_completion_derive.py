#!/usr/bin/env python3
"""Generate the derivation steps between two LaTeX expressions.

Pass a START and a TARGET expression; the ProofCompletionExpert produces an
ordered trajectory of atomic graph edits, and this script prints it as a
human-readable, step-by-step derivation (with the reconstructed expression at
each waypoint).

Usage:
    ./run.sh scripts/proof_completion_derive.py "\\frac{d}{dx} x^2" "2 x"
    ./run.sh scripts/proof_completion_derive.py "x^2 - 4 = 0" "x = 2" --domain algebra
    ./run.sh scripts/proof_completion_derive.py START TARGET \\
        --program backend/experts/modules/proof_completion/artifacts/proof_completion.json

Needs GEMINI_API_KEY (loaded from .env.local). ALGEBENCH_LM_MODEL /
ALGEBENCH_LM_REASONING / ALGEBENCH_LM_TEMPERATURE tune the model.
"""

from __future__ import annotations

import argparse

from _pc_env import load_env_local

load_env_local()

from backend.experts import init_experts  # noqa: E402
from backend.semantic_graph.service import SemanticGraphService  # noqa: E402
from backend.experts.context_id import build as build_context_id  # noqa: E402
from backend.experts.modules.proof_completion.model import GraphTransition  # noqa: E402
from backend.experts.modules.proof_completion.module import ProofCompletionExpert  # noqa: E402
from backend.experts.modules.proof_completion.graph_ops import apply, canonical_equal  # noqa: E402
from backend.experts.modules.proof_completion.grounding import (  # noqa: E402
    graph_to_latex, graph_to_sympy, sympy_equiv,
)
from backend.experts.modules.proof_completion.metric import safe_apply  # noqa: E402
from backend.experts.modules.proof_completion.outputs import (  # noqa: E402
    AddEdge, AddNode, RemoveEdge, RemoveNode,
)


def _describe(op) -> str:
    if isinstance(op, AddNode):
        n = op.node
        tag = n.op or n.latex or n.label or n.type
        return f"+ node {n.id} ({n.type}:{tag})"
    if isinstance(op, RemoveNode):
        return f"- node {op.node_id}"
    if isinstance(op, AddEdge):
        return f"+ edge {op.edge.from_} -> {op.edge.to}"
    if isinstance(op, RemoveEdge):
        return f"- edge {op.edge_from} -> {op.edge_to}"
    return op.op


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("start", help="starting LaTeX expression")
    ap.add_argument("target", help="target LaTeX expression")
    ap.add_argument("--domain", default=None, help="domain hint (e.g. algebra, calculus)")
    ap.add_argument("--intent", default=None, help="what the derivation should accomplish")
    ap.add_argument("--program", default=None, help="optimized artifact to load")
    ap.add_argument("--baseline", action="store_true",
                    help="force the uncompiled model (ignore the default artifact)")
    args = ap.parse_args()

    init_experts()  # configure the DSPy LM
    svc = SemanticGraphService()

    start_g = svc.derive(args.start, domain=args.domain)
    target_g = svc.derive(args.target, domain=args.domain)
    if start_g is None or target_g is None:
        print(f"could not parse {'start' if start_g is None else 'target'} expression")
        return 1

    intent = args.intent or "Transform the start expression into the target."
    print(f"start : {args.start}")
    print(f"target: {args.target}")

    ctx = GraphTransition(start=start_g, target=target_g,
                          domain=args.domain, intent=intent)
    prog = ProofCompletionExpert(artifact=args.program,
                                 load_default=not args.baseline)
    print(f"(model: {prog.loaded_artifact or 'baseline (uncompiled)'})")
    try:
        outputs = prog(
            context=ctx,
            context_id=build_context_id(scene="adhoc", semantic_graph=True),
            lesson_context="",
            instruction=intent,
        )
    except Exception as exc:
        print(f"the expert's structured output could not be parsed:\n  {exc}")
        return 1
    traj = outputs[0]
    ops = list(traj.ops)
    if not ops:
        print("the expert returned no operations.")
        return 1

    steps = sorted({op.step for op in ops})
    # the LaTeX expression at each waypoint (best-effort apply so it renders even
    # if op ordering is imperfect)
    waypoints = []  # (step, latex)
    for k in steps:
        gk, _ = safe_apply(start_g, [o for o in ops if o.step <= k])
        waypoints.append((k, graph_to_latex(gk) or "(unverifiable)"))

    start_latex = graph_to_latex(start_g) or args.start
    print(f"\n=== derivation (LaTeX): {len(steps)} step(s) ===")
    print(f"   start :  {start_latex}")
    for k, ltx in waypoints:
        print(f"   step {k}:  {ltx}")

    print(f"\n=== operations ({len(ops)} total) ===")
    for k, ltx in waypoints:
        print(f"\nStep {k}:   {ltx}")
        for op in (o for o in ops if o.step == k):
            print(f"   {_describe(op):28}  {op.explanation}")
            print(f"   {'':28}  ↳ {op.justification}")

    # verification — three independent checks
    try:
        final = apply(start_g, ops)
        clean = "yes"
    except Exception:
        final, failed = safe_apply(start_g, ops)
        clean = f"no ({failed} op(s) skipped — usually bad ordering)"
    try:
        math_ok = sympy_equiv(graph_to_sympy(final), graph_to_sympy(target_g))
        math = "✓" if math_ok else "✗"
    except Exception:
        math = "? (result not reconstructable)"
    struct = "✓" if canonical_equal(final, target_g) else "✗"

    print("\nresult:")
    print(f"  applies cleanly : {clean}")
    print(f"  math correct    : {math}    (reaches the target expression)")
    print(f"  exact graph     : {struct}    (identical structure to the parsed target)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
