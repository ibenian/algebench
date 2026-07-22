"""Variant construction for proof edits — deterministic, no LM.

The load-bearing property here is the NO-OP IDENTITY: rebuilding a proof without
changing anything must reproduce it byte-for-byte. Without it, an edit to one
step could silently alter unrelated steps, and the "proof is never in a bad
state" guarantee is worthless.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from backend.experts.handlers.proof_edit import variants as V
from backend.experts.handlers.proof_edit.models import Variant
from backend.experts.handlers.proof_edit.variants import (
    VARIANT_GLUE, VARIANT_INSERT, VARIANT_SUPERSEDE, _describe_new_terms,
    _infer_change_type, _with_step_source, build_variant, proof_to_trajectory,
    to_payload,
)

PROOFS = Path(__file__).resolve().parents[3] / "proofs" / "domains"
FIXTURE = PROOFS / "algebra" / "quadratic-formula.json"

STEP_FIELDS = ("input_latex", "latex", "plain", "confidence")

# Each no-op rebuild re-grounds a whole chain through the CAS — seconds per proof
# on the long physics derivations. Sweeping all ~20 committed proofs by default
# turns `pytest tests/` into a multi-minute stall, so the default run takes a
# structurally varied sample and CI's ``--exhaustive`` takes the lot. Same
# convention as tests/backend/semantic_graph/test_coverage_exhaustive.py.
_SAMPLE = (
    "algebra/binomial-square.json",       # repeated operands (a·a) — parser edge
    "algebra/quadratic-formula.json",     # long algebraic chain
    "calculus/chain-rule.json",           # derivative notation
    "series/geometric-finite.json",       # summation notation
)


@pytest.fixture(scope="module", autouse=True)
def _process_isolated_cas():
    """Run this module's CAS work under PROCESS isolation, not the suite default.

    ``tests/conftest.py`` defaults the suite to ``thread`` isolation, which bounds
    how long a caller *waits* but never reclaims the thread — the sympy call keeps
    running. Every test here re-grounds an entire proof chain, so pathological
    steps accumulate wedged threads until the shared executor is exhausted and
    every later CAS call blocks forever. That is what turned `pytest
    tests/backend/experts` from 38s into an indefinite hang.

    Process isolation is what production uses and what the guard is designed for:
    a wedged worker is SIGTERM'd then SIGKILL'd and the core reclaimed. Scoped to
    this module and reset on the way out so the ambient default is restored for
    everything else.
    """
    from backend.experts.modules.proof_completion import cas_guard

    previous = os.environ.get("ALGEBENCH_CAS_ISOLATION")
    os.environ["ALGEBENCH_CAS_ISOLATION"] = "process"
    cas_guard._reset_for_tests()
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("ALGEBENCH_CAS_ISOLATION", None)
        else:
            os.environ["ALGEBENCH_CAS_ISOLATION"] = previous
        cas_guard._reset_for_tests()


@pytest.fixture
def proof() -> dict:
    return json.loads(FIXTURE.read_text())


def _all_proofs():
    return sorted(PROOFS.glob("*/*.json"))


def pytest_generate_tests(metafunc):
    """Parametrize the corpus sweep: a sample by default, everything on demand."""
    if "corpus_proof" not in metafunc.fixturenames:
        return
    if metafunc.config.getoption("--exhaustive"):
        paths = _all_proofs()
    else:
        paths = [PROOFS / rel for rel in _SAMPLE]
    metafunc.parametrize("corpus_proof", paths, ids=lambda p: p.stem)


# --------------------------------------------------------------------------- #
# no-op identity
# --------------------------------------------------------------------------- #

def test_noop_identity_across_corpus(corpus_proof):
    """Rebuilding with no new steps reproduces a stored proof exactly.

    This is the guard against spreading unrelated defects. It caught a live
    parser bug: ``latex_to_graph`` dropped a repeated operand, so ``a \\cdot a``
    re-rendered as ``a`` (see ``binomial-square``, kept in the default sample for
    that reason). Rebuilding the whole chain would have silently corrupted that
    untouched step; restoring untouched steps wholesale is what keeps it out.

    Sampled by default, full corpus under ``--exhaustive`` — see the module head.
    """
    path = corpus_proof
    stored = json.loads(path.read_text())
    out = build_variant(stored, stored["domain"], at=0, new_steps=[], delete_count=0)

    assert len(out["steps"]) == len(stored["steps"])
    for i, (a, b) in enumerate(zip(stored["steps"], out["steps"])):
        for f in STEP_FIELDS:
            assert a.get(f) == b.get(f), f"step {i} field {f!r} changed on a no-op rebuild"


def test_noop_preserves_framing(proof):
    """Title, goal, prerequisites and follow-ups survive a rebuild.

    ``prerequisites`` entries may be ``{text, deeplink}`` chips, which the
    trajectory model's ``List[str]`` would reject — they are carried across
    verbatim rather than round-tripped.
    """
    out = build_variant(proof, proof["domain"], at=0, new_steps=[], delete_count=0)
    for field in ("goal", "followups", "prerequisites", "deeplink"):
        if proof.get(field):
            assert out.get(field) == proof[field]


# --------------------------------------------------------------------------- #
# change_type inference
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("relation,expected", [
    ("equivalent", "rewrite"),
    ("narrows", "solve"),
    ("unknown", "substitute"),
    (None, "rewrite"),
])
def test_infer_change_type_from_stored_relation(relation, expected):
    """The declared claim is inferred from what the CAS previously FOUND.

    Stored steps carry no ``change_type``. Blanket-defaulting to ``rewrite``
    would mark a genuine ``solve`` step type-inconsistent and downgrade it, so
    the label is chosen to be consistent with the recorded relation instead.
    """
    assert _infer_change_type({"confidence": {"relation": relation}}) == expected


def test_step_zero_is_given(proof):
    """Step 0 is the start state, not a transition."""
    traj = proof_to_trajectory(proof)
    assert traj.start_latex is None
    assert traj.steps[0].change_type == "given"


# --------------------------------------------------------------------------- #
# inserting
# --------------------------------------------------------------------------- #

def _insert_step(latex: str) -> dict:
    return {"operation": "test op", "justification": "because", "input_latex": latex}


def test_insert_leaves_untouched_steps_byte_identical(proof):
    """An insert mid-proof changes only the neighbourhood it touches."""
    at = 2
    new = [_insert_step(proof["steps"][at]["input_latex"])]   # a trivially equivalent restatement
    out = build_variant(proof, proof["domain"], at, new)

    assert len(out["steps"]) == len(proof["steps"]) + 1
    # Everything before the insertion point is untouched.
    for i in range(at + 1):
        for f in STEP_FIELDS:
            assert out["steps"][i].get(f) == proof["steps"][i].get(f)
    # So is everything after the step that follows the insert (whose predecessor
    # changed, so its verdict is legitimately re-earned).
    for orig_i in range(at + 2, len(proof["steps"])):
        assert out["steps"][orig_i + 1]["input_latex"] == proof["steps"][orig_i]["input_latex"]


def test_payload_shares_new_steps_across_variants(proof):
    """The nested-variant compaction: ops are emitted once, not per variant.

    Sharing is only sound because a new step's rendering depends solely on its
    predecessors, and every variant has the same prefix. Assert that rather than
    trusting it — if it ever stops holding, the compaction corrupts variants.
    """
    at = 2
    base = proof["steps"][at]["input_latex"]
    payload = to_payload(proof, proof["domain"], at,
                         [_insert_step(base), _insert_step(base)])
    assert payload is not None

    kinds = {v.kind for v in payload.variants}
    assert VARIANT_INSERT in kinds and VARIANT_GLUE in kinds

    # One shared list, and each variant selects a prefix of it.
    assert len(payload.new_steps) == 2
    for v in payload.variants:
        assert 1 <= v.take <= len(payload.new_steps)

    for v in payload.variants:
        rebuilt = build_variant(proof, proof["domain"], at,
                                [_insert_step(base)] * v.take, v.delete_count)
        built = rebuilt["steps"][at + 1: at + 1 + v.take]
        for shared, actual in zip(payload.new_steps, built):
            assert shared.latex == actual["latex"]
            assert shared.plain == actual["plain"]


def test_supersede_ends_the_proof_and_is_always_offered(proof):
    """"End the proof here" drops EVERYTHING after the inserted step.

    It used to depend on the model guessing how many steps its edit made
    redundant — a judgment nothing could verify, where a wrong count silently
    shortened the proof by an arbitrary amount. Now it is unconditional whenever
    anything follows, and takes only the user's own step: glue would bridge to
    steps being deleted.
    """
    at = 2
    n = len(proof["steps"])
    payload = to_payload(proof, proof["domain"], at,
                         [_insert_step(proof["steps"][at]["input_latex"])] * 2)
    assert payload is not None
    sup = [v for v in payload.variants if v.kind == VARIANT_SUPERSEDE]
    assert sup, "truncation must be offered whenever steps follow"
    assert sup[0].delete_count == n - (at + 1)
    assert sup[0].take == 1, "only the user's step survives a truncation"


def test_supersede_not_offered_at_the_final_step(proof):
    """Nothing follows, so there is nothing to end."""
    at = len(proof["steps"]) - 1
    payload = to_payload(proof, proof["domain"], at,
                         [_insert_step(proof["steps"][at]["input_latex"])])
    assert payload is not None
    assert all(v.kind != VARIANT_SUPERSEDE for v in payload.variants)


def test_readability_note_only_on_insert_only(proof):
    """The note flags a caption the CAS cannot flag — and only where it applies.

    When two states are genuinely equivalent the CAS reports success regardless
    of how the chain READS, so badges alone would make the glue variant look
    pointless.
    """
    at = 2
    payload = to_payload(proof, proof["domain"], at,
                         [_insert_step(proof["steps"][at]["input_latex"])] * 2)
    assert payload is not None
    by_kind = {v.kind: v for v in payload.variants}
    assert by_kind[VARIANT_INSERT].readability_note
    assert not by_kind[VARIANT_GLUE].readability_note


# --------------------------------------------------------------------------- #
# seed proofs without input_latex (api-demo fixture)
# --------------------------------------------------------------------------- #

# A minimal HAND-AUTHORED proof: steps carry only display `latex`, exactly like
# the served `algebra/api-demo` fixture. The edit path rebuilds from
# `input_latex`, which these steps lack.
_SEED_NO_INPUT_LATEX = {
    "domain": "algebra",
    "title": "Difference of squares (API demo)",
    "goal": "factor $a^2 - b^2$ into $(a-b)(a+b)$",
    "steps": [
        {"index": 0, "latex": "a^2-b^2", "operation": "start"},
        {"index": 1, "latex": "(a-b)(a+b)", "operation": "factor"},
    ],
}


def test_with_step_source_backfills_input_latex_without_mutating():
    """Missing ``input_latex`` is filled from ``latex`` — on a copy, not in place."""
    proof = json.loads(json.dumps(_SEED_NO_INPUT_LATEX))
    out = _with_step_source(proof)

    assert out is not proof                                   # copied, not mutated
    assert "input_latex" not in proof["steps"][0]             # original untouched
    assert out["steps"][0]["input_latex"] == "a^2-b^2"
    assert out["steps"][1]["input_latex"] == "(a-b)(a+b)"


def test_with_step_source_is_noop_when_present(proof):
    """A fully built proof already has ``input_latex`` — returned unchanged."""
    assert _with_step_source(proof) is proof


def test_edit_seed_proof_without_input_latex_does_not_crash():
    """A no-op rebuild of the api-demo seed must not KeyError (regression).

    The served ``api-demo`` proof carries only ``latex``; ``proof_to_trajectory``
    and ``_restore_untouched_steps`` reconstruct from ``input_latex``. Before the
    fix this raised ``KeyError: 'input_latex'``, which the handler swallowed into
    the generic "I couldn't apply that edit right now" message.
    """
    proof = json.loads(json.dumps(_SEED_NO_INPUT_LATEX))
    out = build_variant(proof, proof["domain"], at=0, new_steps=[], delete_count=0)
    assert len(out["steps"]) == len(proof["steps"])
    assert out["steps"][0]["input_latex"] == "a^2-b^2"


def test_to_payload_on_seed_proof_without_input_latex():
    """End-to-end: an insert on the seed proof builds variants, no crash."""
    proof = json.loads(json.dumps(_SEED_NO_INPUT_LATEX))
    payload = to_payload(proof, proof["domain"], 0, [_insert_step("a^2-b^2")])
    assert payload is not None
    assert payload.variants


# --------------------------------------------------------------------------- #
# new-term descriptions (issue #493 — the PR-2 gap)
# --------------------------------------------------------------------------- #

def _new_symbol_step(proof: dict, at: int) -> dict:
    """An equivalent restatement that drags in a genuinely NEW symbol ``k``."""
    base = proof["steps"][at]["input_latex"]
    return {"operation": "introduce k", "justification": "let k stand in",
            "input_latex": base + " + k - k"}


def test_describe_new_terms_fills_only_the_new_set(monkeypatch):
    """A scoped LM pass fills descriptions for new terms, keyed by id."""
    seen = {}

    def fake_describe(terms, domain, context):
        seen["ids"] = set(terms)
        seen["context"] = context
        return {tid: f"desc of {tid}" for tid in terms}

    monkeypatch.setattr(V, "is_configured", lambda: True)
    monkeypatch.setattr(V, "describe_terms", fake_describe)

    variants = [
        Variant(kind=VARIANT_INSERT, at=1, take=1,
                terms_added={"k": {"latex": "k", "name": "k"}}),
        Variant(kind=VARIANT_SUPERSEDE, at=1, take=1, delete_count=2,
                terms_added={"k": {"latex": "k", "name": "k"}}),
    ]
    _describe_new_terms(variants, "algebra", "the derivation prose")

    # Only the new term was sent, and the context was forwarded for grounding.
    assert seen["ids"] == {"k"}
    assert seen["context"] == "the derivation prose"
    # Every variant that surfaces the id gets the same description.
    for v in variants:
        assert v.terms_added["k"]["description"] == "desc of k"


def test_describe_new_terms_no_op_without_lm(monkeypatch):
    """Graceful degradation: no LM configured → no predict, empty description."""
    called = {"n": 0}

    def fake_describe(terms, domain, context):
        called["n"] += 1
        return {}

    monkeypatch.setattr(V, "is_configured", lambda: False)
    monkeypatch.setattr(V, "describe_terms", fake_describe)

    v = Variant(kind=VARIANT_INSERT, at=1, take=1,
                terms_added={"k": {"latex": "k", "name": "k"}})
    _describe_new_terms([v], "algebra", "ctx")

    assert called["n"] == 0                       # skipped cleanly, no wasted call
    assert "description" not in v.terms_added["k"]


def test_describe_new_terms_preserves_restored_descriptions(monkeypatch):
    """A term that already has prose (restored from the original) is left alone."""
    monkeypatch.setattr(V, "is_configured", lambda: True)
    monkeypatch.setattr(V, "describe_terms",
                        lambda terms, domain, context: {"a": "SHOULD NOT WIN"})

    v = Variant(kind=VARIANT_INSERT, at=1, take=1,
                terms_added={"a": {"latex": "a", "description": "the leading coefficient"}})
    _describe_new_terms([v], "algebra", "ctx")

    # Already-described terms are never sent to the LM, and never overwritten.
    assert v.terms_added["a"]["description"] == "the leading coefficient"


def test_to_payload_populates_new_term_descriptions(proof, monkeypatch):
    """End-to-end: an edit that introduces a new symbol comes back described."""
    monkeypatch.setattr(V, "is_configured", lambda: True)
    monkeypatch.setattr(
        V, "describe_terms",
        lambda terms, domain, context: {tid: f"{tid} is a stand-in" for tid in terms})

    at = 1
    payload = to_payload(proof, proof["domain"], at,
                         [_new_symbol_step(proof, at)], context="quadratic derivation")
    assert payload is not None

    described = [v for v in payload.variants if "k" in v.terms_added]
    assert described, "the new symbol k should surface as an added term"
    for v in described:
        assert v.terms_added["k"].get("description") == "k is a stand-in"


def test_to_payload_new_term_blank_without_lm(proof, monkeypatch):
    """Same edit, no LM: the term still comes back, description simply empty."""
    monkeypatch.setattr(V, "is_configured", lambda: False)

    at = 1
    payload = to_payload(proof, proof["domain"], at,
                         [_new_symbol_step(proof, at)], context="quadratic derivation")
    assert payload is not None

    described = [v for v in payload.variants if "k" in v.terms_added]
    assert described
    for v in described:
        assert not v.terms_added["k"].get("description")
