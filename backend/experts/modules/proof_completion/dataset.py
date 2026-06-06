"""Sympy-as-ground-truth dataset generator for the ProofCompletionExpert.

For each example we build a chain of valid sympy rewrites
``e0 → e1 → … → eN``, derive each expression to a semantic graph with the
project's existing pipeline, and thread per-step structural diffs into a single
gold trajectory such that ``apply(start, gold_ops) ≅ target``.

``sympy`` is the reliable source of truth: every (start, target) pair is a real
algebraic transformation, and the gold trajectory is self-consistent by
construction (verified in tests).
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from typing import Callable, Optional

import sympy as sp

from backend.model.semantic_graph import SemanticGraph
from backend.semantic_graph.service import SemanticGraphService

from backend.experts.context_id import build as build_context_id
from .outputs import GRAPH_OP_ADAPTER, DerivationStep, GraphTrajectory
from .graph_ops import apply, canonical_equal, diff
from .grounding import graph_to_latex, is_grounded
from .model import GraphTransition

_SVC = SemanticGraphService()

# Domains live one-file-per-domain under ``domains/`` and self-register.
# Adding a domain = drop a file there. Import the registry + shared symbol(s).
from .domains import discover_domains  # noqa: E402
from .domains.base import DOMAIN_REGISTRY, Seed, x  # noqa: E402

discover_domains()  # populate DOMAIN_REGISTRY from domains/*.py


# --------------------------------------------------------------------------- #
# rewrite transforms
# --------------------------------------------------------------------------- #

def _safe(fn):
    def wrapped(e):
        try:
            return fn(e)
        except Exception:
            return None
    return wrapped


TRANSFORMS: list[Callable[[sp.Expr], Optional[sp.Expr]]] = [
    _safe(lambda e: sp.expand(e)),
    _safe(lambda e: sp.factor(e)),
    _safe(lambda e: sp.together(e)),
    _safe(lambda e: sp.cancel(e)),
    _safe(lambda e: sp.simplify(e)),
    _safe(lambda e: e.doit() if hasattr(e, "doit") else None),  # evaluate Derivative
    _safe(lambda e: sp.apart(e, x)),
    _safe(lambda e: sp.trigsimp(e)),
]


def make_expr_chain(expr0: sp.Expr, rng: random.Random, max_steps: int) -> list[sp.Expr]:
    """Apply a random ordered subset of transforms, keeping structure-changing steps."""
    chain = [expr0]
    order = TRANSFORMS[:]
    rng.shuffle(order)
    for tf in order:
        if len(chain) - 1 >= max_steps:
            break
        nxt = tf(chain[-1])
        if nxt is None:
            continue
        if sp.srepr(nxt) == sp.srepr(chain[-1]):
            continue
        chain.append(nxt)
    return chain


# --------------------------------------------------------------------------- #
# graph chain + gold trajectory
# --------------------------------------------------------------------------- #

def _expr_to_graph(expr: sp.Expr, domain: str) -> Optional[SemanticGraph]:
    # mul_symbol="dot": emit explicit \cdot so a symbol before "(" (e.g. n(n+1))
    # isn't produced — that parses as a function call, not a product, and would
    # make the example ungroundable (and silently dropped).
    return _SVC.latex_to_graph(sp.latex(expr, mul_symbol="dot"), domain=domain)


def thread_gold(graphs: list[SemanticGraph]) -> tuple[list, SemanticGraph]:
    """Thread per-step diffs through the working graph, tagging ops by step.

    Transition ``i`` (graph[i-1] -> graph[i]) is derivation step ``i`` (1-based);
    every op produced by that diff is tagged ``step=i`` so the trajectory carries
    explicit step boundaries.
    """
    gold: list = []
    working = graphs[0]
    for i, nxt in enumerate(graphs[1:], start=1):
        ops = diff(working, nxt)
        for op in ops:
            op.step = i
        working = apply(working, ops)
        gold.extend(ops)
    return gold, working


def build_example(seed: Seed, rng: random.Random, max_steps: int, max_ops: int = 40):
    """Return a ``dspy.Example`` or None if the chain is unusable/too large."""
    import dspy

    # scripted derivation chains are used verbatim; otherwise random rewrites
    chain = list(seed.chain) if seed.chain else make_expr_chain(seed.expr, rng, max_steps)
    if len(chain) < 2:
        return None

    kept: list[tuple] = []  # (sympy expr, graph), deduped on structure
    for e in chain:
        g = _expr_to_graph(e, seed.domain)
        if g is None:
            return None
        if kept and canonical_equal(kept[-1][1], g):
            continue
        # require every waypoint to be a groundable expression, so each
        # derivation step lands on valid, verifiable math
        if is_grounded(g, e) is not True:
            return None
        kept.append((e, g))
    if len(kept) < 2:
        return None

    graphs = [g for _, g in kept]
    gold_ops, working = thread_gold(graphs)
    start_expr, start = kept[0]
    target_expr, target = kept[-1]
    if not canonical_equal(working, target):  # gold must be self-consistent
        return None
    if len(gold_ops) > max_ops:  # keep trajectories small/learnable/informative
        return None

    context = GraphTransition(
        start=start, target=target, domain=seed.domain, intent=seed.intent
    )
    context_id = build_context_id(scene="g", semantic_graph=True)
    # gold derivation as complete reachable states (the model-facing output): one
    # step per kept transition, carrying the FULL LaTeX of that state. Deriving
    # each expr_latex reproduces the gold graph, so this is self-consistent.
    gold_steps = [
        DerivationStep(
            step=i,
            operation=seed.intent or "rewrite to the next equivalent form",
            # mul_symbol="dot": explicit \cdot so gold demos obey the signature's
            # rule (a symbol before "(" is a function call, not multiplication).
            expr_latex=sp.latex(e, mul_symbol="dot"),
            justification="equivalent transformation (sympy-verified)",
        )
        for i, (e, _g) in enumerate(kept[1:], start=1)
    ]
    return dspy.Example(
        context=context,
        context_id=context_id,
        lesson_context="",
        instruction=f"{seed.intent}: transform the start graph into the target graph.",
        # gold output the optimizer can demonstrate from (matches the sig's
        # `trajectory` OutputField), plus the atomic gold ops for internal checks
        trajectory=GraphTrajectory(steps=gold_steps,
                                   start_latex=graph_to_latex(start),
                                   target_latex=graph_to_latex(target)),
        gold_steps=gold_steps,
        gold_ops=gold_ops,
        domain=seed.domain,
        n_steps=len(graphs) - 1,
        # source-of-truth expressions as sympify-able STRINGS (JSON/pickle-safe
        # so they survive being embedded as optimizer demos)
        start_expr=str(start_expr),
        target_expr=str(target_expr),
        # per-step target expressions e1..eN (one per derivation step)
        step_exprs=[str(e) for e, _ in kept[1:]],
    ).with_inputs("context", "context_id", "lesson_context", "instruction")


def generate(n: int, seed: int, domains: Optional[list[str]] = None,
             max_steps: int = 1, max_ops: int = 40) -> list:
    """Generate up to ``n`` examples deterministically from ``seed``."""
    rng = random.Random(seed)
    domains = domains or list(DOMAIN_REGISTRY)
    examples = []
    attempts = 0
    while len(examples) < n and attempts < n * 40:
        attempts += 1
        domain = rng.choice(domains)
        seeds = DOMAIN_REGISTRY[domain](rng)
        seed_obj = rng.choice(seeds)
        ex = build_example(seed_obj, rng, max_steps, max_ops=max_ops)
        if ex is not None:
            examples.append(ex)
    return examples


# --------------------------------------------------------------------------- #
# (de)serialization
# --------------------------------------------------------------------------- #

def example_to_dict(ex) -> dict:
    ctx: GraphTransition = ex.context
    return {
        # drop null optional fields — round-trips since they default to None
        "context": ctx.model_dump(by_alias=True, exclude_none=True),
        "context_id": ex.context_id,
        "lesson_context": ex.lesson_context,
        "instruction": ex.instruction,
        "gold_steps": [s.model_dump() for s in (ex.get("gold_steps") or [])],
        "gold_ops": [op.model_dump(by_alias=True, exclude_none=True) for op in ex.gold_ops],
        "domain": ex.domain,
        "n_steps": ex.n_steps,
        # sympy expressions serialized as sympify-able strings
        "start_expr": str(ex.get("start_expr")) if ex.get("start_expr") is not None else None,
        "target_expr": str(ex.get("target_expr")) if ex.get("target_expr") is not None else None,
        "step_exprs": [str(e) for e in (ex.get("step_exprs") or [])],
    }


def _sympify_or_none(s):
    if not s:
        return None
    try:
        return sp.sympify(s)
    except Exception:
        return None


def example_from_dict(d: dict):
    import dspy

    gold_steps = [DerivationStep.model_validate(s) for s in d.get("gold_steps", [])]
    context = GraphTransition.model_validate(d["context"])
    return dspy.Example(
        context=context,
        context_id=d["context_id"],
        lesson_context=d.get("lesson_context", ""),
        instruction=d.get("instruction", ""),
        trajectory=GraphTrajectory(steps=gold_steps,
                                   start_latex=graph_to_latex(context.start),
                                   target_latex=graph_to_latex(context.target)),
        gold_steps=gold_steps,
        gold_ops=[GRAPH_OP_ADAPTER.validate_python(o) for o in d.get("gold_ops", [])],
        domain=d.get("domain"),
        n_steps=d.get("n_steps"),
        # kept as strings (JSON/pickle-safe); sympified at the metric boundary
        start_expr=d.get("start_expr"),
        target_expr=d.get("target_expr"),
        step_exprs=list(d.get("step_exprs") or []),
    ).with_inputs("context", "context_id", "lesson_context", "instruction")


def save_jsonl(examples: list, path: str) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        for ex in examples:
            # compact separators — no spaces after ',' / ':'
            fh.write(json.dumps(example_to_dict(ex), separators=(",", ":")) + "\n")


def load_jsonl(path: str) -> list:
    out = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                out.append(example_from_dict(json.loads(line)))
    return out
