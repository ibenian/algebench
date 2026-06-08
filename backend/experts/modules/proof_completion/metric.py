"""The ProofCompletionExpert metric — the performance definition.

Used by both the optimizer (scalar reward) and the evaluator (component
breakdown). The primary signal is the **hard** endpoint match (all ops apply
legally *and* the result canonically equals the target). Partial credit
(structural coverage + op-level F1) gives the optimizer a smooth gradient.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Iterable

from backend.model.semantic_graph import SemanticGraph
from backend.semantic_graph.service import SemanticGraphService

from .outputs import (
    AddEdge,
    AddNode,
    DerivationStep,
    GraphOpBase,
    GraphOpError,
    ProofTrajectory,
    RemoveEdge,
    RemoveNode,
)
from .graph_ops import apply, canonical_equal, diff, wl_colors, _content
from .grounding import graph_to_sympy, is_grounded
from backend.experts.registry import register_metric

# Deterministic expression → graph bridge. The model emits full expressions
# (LaTeX); we derive the graph for each state and recover atomic edits in code.
_SVC = SemanticGraphService()


# --------------------------------------------------------------------------- #
# extracting the predicted derivation steps from whatever the program returned
# --------------------------------------------------------------------------- #

def extract_steps(pred: Any) -> list:
    """Pull the ordered derivation steps out of a prediction."""
    if pred is None:
        return []
    if isinstance(pred, ProofTrajectory):
        return list(pred.steps)
    if isinstance(pred, DerivationStep):
        return [pred]
    if isinstance(pred, (list, tuple)):
        for item in pred:
            steps = extract_steps(item)
            if steps:
                return steps
        return []
    for attr in ("outputs", "trajectory", "steps"):
        if hasattr(pred, attr):
            return extract_steps(getattr(pred, attr))
    return []


# --------------------------------------------------------------------------- #
# states → graphs → atomic edits (the model gives states; code does the rest)
# --------------------------------------------------------------------------- #

# Placeholder/ellipsis tokens that are NOT valid math — a state containing one
# (e.g. "1 + 2 + \dots + n") is not a real sympy expression even if the latex
# parser tolerates the token, so it must not count as convertible.
_PLACEHOLDER = ("\\dots", "\\ldots", "\\cdots", "\\dotsb", "\\ddots",
                "\\vdots", "\\dotsc", "...")


def _state_graph(expr_latex: str, domain) -> SemanticGraph | None:
    """Derive a graph for one state; None unless it is single-root convertible."""
    if any(tok in expr_latex for tok in _PLACEHOLDER):
        return None  # ellipsis / placeholder — not a valid sympy expression
    try:
        g = _SVC.latex_to_graph(expr_latex, domain=domain)
    except Exception:
        return None
    if g is None:
        return None
    try:
        graph_to_sympy(g)  # require a single connected, sympy-convertible root
    except Exception:
        return None
    return g


def states_to_graphs(start: SemanticGraph, steps: list, domain):
    """Derive a graph per step. Returns (graphs_incl_start, n_unconvertible).

    ``graphs[0]`` is the start; ``graphs[i]`` is the derived state after step i
    (``None`` if that step's expression is not sympy-convertible).
    """
    graphs = [start]
    bad = 0
    for s in steps:
        g = _state_graph(s.expr_latex, domain)
        if g is None:
            bad += 1
        graphs.append(g)
    return graphs, bad


def derived_ops(graphs: list):
    """Thread atomic diffs over consecutive convertible graphs.

    Returns ``(ops, final_graph)`` where ``final_graph`` is the last convertible
    state (the start if none converted). Skips non-convertible states.
    """
    ops: list = []
    prev = graphs[0]
    for i, g in enumerate(graphs[1:], start=1):
        if g is None:
            continue
        try:
            d = diff(prev, g)
        except Exception:
            continue
        for op in d:
            op.step = i
        ops.extend(d)
        prev = g
    return ops, prev


# --------------------------------------------------------------------------- #
# applying (best-effort, for partial credit)
# --------------------------------------------------------------------------- #

def safe_apply(start: SemanticGraph, ops: Iterable):
    """Apply ops one at a time, skipping illegal ones. Returns (graph, n_failed)."""
    g = start
    failed = 0
    for op in ops:
        try:
            g = apply(g, [op])
        except GraphOpError:
            failed += 1
    return g, failed


# --------------------------------------------------------------------------- #
# components
# --------------------------------------------------------------------------- #

def coverage(result: SemanticGraph, target: SemanticGraph) -> float:
    """Dice overlap of canonical node + edge signatures; 1.0 iff isomorphic."""
    rc, tc = wl_colors(result), wl_colors(target)
    rn, tn = Counter(rc.values()), Counter(tc.values())

    def esig(g, col):
        return Counter(
            (e.role, e.semantic, col.get(e.from_, "?"), col.get(e.to, "?"))
            for e in g.edges
        )

    re_, te_ = esig(result, rc), esig(target, tc)
    inter = sum((rn & tn).values()) + sum((re_ & te_).values())
    total = (sum(rn.values()) + sum(re_.values())
             + sum(tn.values()) + sum(te_.values()))
    return (2 * inter / total) if total else 1.0


def _op_sig(op) -> tuple:
    if isinstance(op, AddNode):
        return ("add_node", _content(op.node))
    if isinstance(op, RemoveNode):
        return ("remove_node", op.node_id)
    if isinstance(op, AddEdge):
        return ("add_edge", op.edge.role, op.edge.semantic)
    if isinstance(op, RemoveEdge):
        return ("remove_edge", op.edge_from, op.edge_to, op.edge_role)
    return (op.op,)


def op_f1(pred_ops: list, gold_ops: list) -> float:
    if not pred_ops and not gold_ops:
        return 1.0
    if not pred_ops or not gold_ops:
        return 0.0
    p = Counter(_op_sig(o) for o in pred_ops)
    g = Counter(_op_sig(o) for o in gold_ops)
    tp = sum((p & g).values())
    prec = tp / sum(p.values())
    rec = tp / sum(g.values())
    return (2 * prec * rec / (prec + rec)) if (prec + rec) else 0.0


def score_components(example, pred) -> dict:
    """All metric components for one example (used by the evaluator).

    The model emits derivation *states*; we derive a graph per state, recover the
    atomic edits between them, and score against the target. ``step_grounded`` is
    the fraction of states that are sympy-convertible (single-root) — now a
    property the model controls by writing clean full expressions, not graph
    bookkeeping.
    """
    transition = example.context
    start, target = transition.start, transition.target
    domain = getattr(transition, "domain", None)
    steps = extract_steps(pred)
    gold_ops = list(getattr(example, "gold_ops", []) or [])

    graphs, bad_states = states_to_graphs(start, steps, domain)
    n_steps = len(steps)
    step_grounded = ((n_steps - bad_states) / n_steps) if n_steps else 0.0

    pred_ops, final = derived_ops(graphs)
    # exact: every state convertible AND the final state equals the target graph
    exact = bool(n_steps > 0 and bad_states == 0
                 and canonical_equal(final, target))

    # Grounding: does the final state mean the right math?
    target_expr = example.get("target_expr") if hasattr(example, "get") else None
    grounded = is_grounded(final, target_expr) if target_expr is not None else None

    return {
        "exact": 1.0 if exact else 0.0,
        "coverage": coverage(final, target),
        "op_f1": op_f1(pred_ops, gold_ops),
        "groundable": 0.0 if grounded is None else 1.0,
        "grounded": 1.0 if grounded else 0.0,
        "step_grounded": step_grounded,
        "n_pred_steps": n_steps,
        "n_pred_ops": len(pred_ops),
        "n_gold_ops": len(gold_ops),
        "n_failed_ops": bad_states,  # # of states that were not sympy-convertible
    }


# --------------------------------------------------------------------------- #
# the DSPy metric
# --------------------------------------------------------------------------- #

@register_metric("proof_completion")
def proof_completion_metric(example, pred, trace=None) -> float:
    """Scalar reward **gated on per-step sympy-convertibility**.

    The rule this encodes: *every* step must reconstruct to a single,
    sympy-convertible expression. The endpoint quality (does the final state
    reach the target — ``exact`` plus partial ``coverage``) only counts **in
    proportion to** the fraction of convertible states — so a derivation with an
    un-parseable intermediate is capped low no matter how good its endpoint
    looks.

    This is what forces decomposition: if a jump is too large to write as a
    clean intermediate expression, the model is rewarded for splitting it into
    as many smaller, individually-convertible steps as it needs. Convertibility
    is a necessary condition, not a bonus. (``op_f1`` vs the gold atomic ops is
    reported for diagnostics but kept *out* of the reward — in the state-based
    representation it is a noisy, id-dependent proxy that ``exact``/``coverage``
    already subsume.)

    Bootstrapping (trace set) → hard pass/fail: a demo must reach the target
    *and* have every state convertible (a fully-valid, fully-renderable chain).
    """
    c = score_components(example, pred)
    if trace is not None:
        return bool(c["exact"] == 1.0 and c["step_grounded"] == 1.0)

    endpoint = 0.7 * c["exact"] + 0.3 * c["coverage"]
    # step_grounded is the gate: all-convertible → full endpoint credit; any
    # un-parseable state scales the whole reward down. A small coverage crumb
    # keeps a usable gradient alive when nothing converts yet.
    return 0.05 * c["coverage"] + 0.95 * c["step_grounded"] * (0.4 + 0.6 * endpoint)
