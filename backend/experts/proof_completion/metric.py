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

from ..outputs import (
    AddEdge,
    AddNode,
    GraphOpBase,
    GraphOpError,
    GraphTrajectory,
    RemoveEdge,
    RemoveNode,
)
from .graph_ops import apply, canonical_equal, wl_colors, _content
from .grounding import is_grounded, per_step_groundable


# --------------------------------------------------------------------------- #
# extracting the predicted trajectory from whatever the program returned
# --------------------------------------------------------------------------- #

def extract_ops(pred: Any) -> list:
    """Pull the ordered ops out of a prediction (list / Prediction / Output)."""
    if pred is None:
        return []
    if isinstance(pred, GraphTrajectory):
        return list(pred.ops)
    if isinstance(pred, GraphOpBase):
        return [pred]
    if isinstance(pred, (list, tuple)):
        for item in pred:
            ops = extract_ops(item)
            if ops:
                return ops
        return []
    for attr in ("outputs", "trajectory", "ops"):
        if hasattr(pred, attr):
            return extract_ops(getattr(pred, attr))
    return []


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
    """All metric components for one example (used by the evaluator)."""
    transition = example.context
    start, target = transition.start, transition.target
    pred_ops = extract_ops(pred)
    gold_ops = list(getattr(example, "gold_ops", []) or [])

    # strict apply (no failures allowed)
    strict_failed = 0
    try:
        strict_result = apply(start, pred_ops)
    except GraphOpError:
        strict_failed = 1
        strict_result = None

    best_result, failed = safe_apply(start, pred_ops)
    exact = bool(strict_failed == 0 and strict_result is not None
                 and canonical_equal(strict_result, target))

    # Grounding: does the produced graph mean the right math (sympy-equivalent
    # to the expected expression), independent of structural shape?
    target_expr = example.get("target_expr") if hasattr(example, "get") else None
    grounded = is_grounded(best_result, target_expr) if target_expr is not None else None

    # per-step grounding: fraction of the prediction's step boundaries that are
    # valid math waypoints (intermediate validity)
    ps_ok, ps_total = per_step_groundable(start, pred_ops)
    step_grounded = (ps_ok / ps_total) if ps_total else 0.0

    return {
        "exact": 1.0 if exact else 0.0,
        "coverage": coverage(best_result, target),
        "op_f1": op_f1(pred_ops, gold_ops),
        "groundable": 0.0 if grounded is None else 1.0,
        "grounded": 1.0 if grounded else 0.0,
        "step_grounded": step_grounded,
        "n_pred_steps": ps_total,
        "n_pred_ops": len(pred_ops),
        "n_gold_ops": len(gold_ops),
        "n_failed_ops": failed,
    }


# --------------------------------------------------------------------------- #
# the DSPy metric
# --------------------------------------------------------------------------- #

def proof_completion_metric(example, pred, trace=None) -> float:
    """Scalar reward that also rewards valid intermediate waypoints.

    Bootstrapping (trace set) → hard pass/fail: a demo must reach the target
    *and* have every step grounded (a fully-valid derivation). Otherwise a
    blend where ``step_grounded`` carries real weight, so the optimizer steers
    toward trajectories whose every waypoint is valid math, not just the
    endpoint.
    """
    c = score_components(example, pred)
    if trace is not None:
        return bool(c["exact"] == 1.0 and c["step_grounded"] == 1.0)
    return (0.45 * c["exact"] + 0.20 * c["coverage"]
            + 0.25 * c["step_grounded"] + 0.10 * c["op_f1"])
