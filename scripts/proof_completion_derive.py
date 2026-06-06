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
import json

from _pc_env import load_env_local

load_env_local()

from backend.experts import init_experts  # noqa: E402
from backend.semantic_graph.service import SemanticGraphService  # noqa: E402
from backend.experts.context_id import build as build_context_id  # noqa: E402
from backend.experts.modules.proof_completion.model import GraphTransition  # noqa: E402
from backend.experts.modules.proof_completion.module import ProofCompletionExpert  # noqa: E402
from backend.experts.modules.proof_completion.graph_ops import canonical_equal, diff  # noqa: E402
from backend.experts.modules.proof_completion.grounding import (  # noqa: E402
    graph_to_latex, graph_to_sympy, sympy_equiv,
)
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


# Placeholder/ellipsis tokens that are NOT valid math — a state containing one
# (e.g. "1 + 2 + \dots + n") cannot be a real sympy expression even if the
# parser tolerates the token.
_PLACEHOLDER = ("\\dots", "\\ldots", "\\cdots", "\\dotsb", "\\ddots",
                "\\vdots", "\\dotsc", "...")


def state_graph(svc, expr_latex: str, domain):
    """Derive a graph for one state, or None if it is not a valid sympy expr.

    Convertibility = parses to a graph AND that graph reconstructs to a single
    sympy expression. Any failure (unparseable, placeholder token, malformed /
    disconnected) returns None — never raises.
    """
    if any(tok in expr_latex for tok in _PLACEHOLDER):
        return None
    try:
        g = svc.latex_to_graph(expr_latex, domain=domain)
    except Exception:
        return None
    if g is None:
        return None
    try:
        graph_to_sympy(g)  # require a single connected, sympy-convertible root
    except Exception:
        return None
    return g


def derive_trajectory(start, target, *, domain=None, intent=None,
                      program=None, baseline=False):
    """Run the ProofCompletionExpert on (start, target) → a ProofTrajectory.

    Reusable core of this script (also used by proof_animation/derive.py). The
    caller must have called ``init_experts()`` first (it configures the DSPy LM).
    Raises ValueError if either endpoint fails to parse.
    """
    svc = SemanticGraphService()
    start_g = svc.latex_to_graph(start, domain=domain)
    target_g = svc.latex_to_graph(target, domain=domain)
    if start_g is None or target_g is None:
        which = "start" if start_g is None else "target"
        raise ValueError(f"could not parse {which} expression")
    intent = intent or "Transform the start expression into the target."
    ctx = GraphTransition(start=start_g, target=target_g, domain=domain, intent=intent)
    prog = ProofCompletionExpert(artifact=program, load_default=not baseline)
    outputs = prog(
        context=ctx,
        context_id=build_context_id(scene="adhoc", semantic_graph=True),
        lesson_context="",
        instruction=intent,
    )
    return outputs[0]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("start", help="starting LaTeX expression")
    ap.add_argument("target", help="target LaTeX expression")
    ap.add_argument("--domain", default=None, help="domain hint (e.g. algebra, calculus)")
    ap.add_argument("--intent", default=None, help="what the derivation should accomplish")
    ap.add_argument("--program", default=None, help="optimized artifact to load")
    ap.add_argument("--baseline", action="store_true",
                    help="force the uncompiled model (ignore the default artifact)")
    ap.add_argument("--trajectory", action="store_true",
                    help="print the trajectory op(s) at each step")
    ap.add_argument("--explanation", action="store_true",
                    help="print each op's explanation")
    ap.add_argument("--justification", action="store_true",
                    help="print each op's justification")
    ap.add_argument("--json", action="store_true",
                    help="dump the raw model output (the trajectory) as JSON and exit")
    args = ap.parse_args()

    init_experts()  # configure the DSPy LM
    svc = SemanticGraphService()

    start_g = svc.latex_to_graph(args.start, domain=args.domain)
    target_g = svc.latex_to_graph(args.target, domain=args.domain)
    if start_g is None or target_g is None:
        print(f"could not parse {'start' if start_g is None else 'target'} expression")
        return 1

    intent = args.intent or "Transform the start expression into the target."
    if not args.json:
        print(f"start : {args.start}")
        print(f"target: {args.target}")

    ctx = GraphTransition(start=start_g, target=target_g,
                          domain=args.domain, intent=intent)
    prog = ProofCompletionExpert(artifact=args.program,
                                 load_default=not args.baseline)
    if not args.json:
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

    # --json: dump the raw model output (the trajectory) and exit. This is
    # exactly what the model produced — ordered steps, each a math operation +
    # complete expression + justification — with no code-side reconstruction.
    if args.json:
        print(json.dumps(traj.model_dump(), indent=2, ensure_ascii=False))
        return 0

    steps = list(traj.steps)
    if not steps:
        print("the expert returned no steps.")
        return 1

    # Each step holds the FULL expression (LaTeX) the model reached. We derive a
    # graph per state and re-render its LaTeX from the graph, so what we show is
    # the *reconstructed* state — proof the expression is well-formed (single
    # connected, sympy-convertible) and not just free text.
    derived = []  # (step, graph_or_None, recon_latex_or_annotated)
    for s in steps:
        g = state_graph(svc, s.expr_latex, args.domain)
        if g is None:
            # not convertible — still show the model's expression, annotated
            derived.append((s, None, f"{s.expr_latex}   (not a valid SymPy expression)"))
            continue
        recon = graph_to_latex(g) or f"{s.expr_latex}   (not a valid SymPy expression)"
        derived.append((s, g, recon))

    # always: the LaTeX chain (start -> each state), reconstructed from the graph
    start_latex = graph_to_latex(start_g) or args.start
    print(f"\n=== derivation (LaTeX): {len(steps)} step(s) ===")
    print(f"   start :   {start_latex}")
    for i, (s, _g, recon) in enumerate(derived, start=1):
        print(f"   step {i}:  {recon}")

    # opt-in detail: one step = one math operation + one full state + one
    # justification. With --trajectory we also recover the atomic graph edits
    # between consecutive states (computed by diff, not by the model).
    if args.trajectory or args.explanation or args.justification:
        print(f"\n=== trajectory ({len(steps)} step(s)) ===")
        prev_g = start_g
        for i, (s, g, recon) in enumerate(derived, start=1):
            print(f"\n{i:2}. {s.operation}")
            print(f"      latex:         {recon}")
            if args.explanation:
                print(f"      operation:     {s.operation}")
            if args.justification:
                print(f"      justification: {s.justification}")
            if args.trajectory and g is not None:
                try:
                    edits = diff(prev_g, g)
                    for op in edits:
                        print(f"        · {_describe(op)}")
                except Exception:
                    print("        · (atomic edits unavailable — state not diffable)")
            if g is not None:
                prev_g = g

    # verification — derive the final state and compare to the target
    final = next((g for s, g, _ in reversed(derived) if g is not None), None)
    convertible = sum(1 for _s, g, _ in derived if g is not None)
    if final is None:
        math = struct = "✗"
    else:
        try:
            math_ok = sympy_equiv(graph_to_sympy(final), graph_to_sympy(target_g))
            math = "✓" if math_ok else "✗"
        except Exception:
            math = "? (result not reconstructable)"
        struct = "✓" if canonical_equal(final, target_g) else "✗"

    print("\nresult:")
    print(f"  steps convertible : {convertible}/{len(steps)}    "
          f"(each state is a single sympy-convertible expression)")
    print(f"  math correct      : {math}    (final state reaches the target expression)")
    print(f"  exact graph       : {struct}    (identical structure to the parsed target)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
