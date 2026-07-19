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

from backend.experts.handlers.proof_edit.variants import (
    VARIANT_GLUE, VARIANT_INSERT, VARIANT_SUPERSEDE, _infer_change_type,
    build_variant, proof_to_trajectory, to_payload,
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


def test_insert_recaptions_the_following_step(proof):
    """Inserting a step changes what the NEXT step's move is — say so.

    The caption is prose, not math: it plays no part in CAS grading, but leaving
    the stored one in place displays a description that no longer matches the
    transition it labels ("expand $(b/2a)^2$" after an inserted "multiply by 2").
    """
    at = 2
    payload = to_payload(
        proof, proof["domain"], at,
        [_insert_step(proof["steps"][at]["input_latex"])],
        next_caption=("divide by 2 and expand", "because it was doubled"))
    assert payload is not None
    insert = next(v for v in payload.variants if v.kind == VARIANT_INSERT)

    follower = insert.step_updates.get(str(at + 1)) or {}
    assert follower.get("operation") == "divide by 2 and expand"
    assert follower.get("justification") == "because it was doubled"
    # The warning is redundant once the caption is actually correct.
    assert not insert.readability_note


def test_recaption_leaves_the_math_alone(proof):
    """A caption rewrite must not disturb the expression or its verdict."""
    at = 2
    plain = build_variant(proof, proof["domain"], at,
                          [_insert_step(proof["steps"][at]["input_latex"])])
    captioned = build_variant(proof, proof["domain"], at,
                              [_insert_step(proof["steps"][at]["input_latex"])],
                              next_caption=("something else entirely", ""))
    a, b = plain["steps"][at + 2], captioned["steps"][at + 2]
    assert a["input_latex"] == b["input_latex"]
    assert a["latex"] == b["latex"]
    assert a["confidence"] == b["confidence"]
    assert b["operation"] == "something else entirely"


def test_recaption_is_skipped_at_the_end_of_a_proof(proof):
    """No following step means nothing to re-caption — and no crash."""
    at = len(proof["steps"]) - 1
    payload = to_payload(proof, proof["domain"], at,
                         [_insert_step(proof["steps"][at]["input_latex"])],
                         next_caption=("nonsense", "nonsense"))
    assert payload is not None
    insert = next(v for v in payload.variants if v.kind == VARIANT_INSERT)
    assert not insert.step_updates


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
