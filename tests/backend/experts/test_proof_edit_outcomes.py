"""The handler's four outcomes are reachable, mutually exclusive, and bounded.

The client branches on which key came back, so an ambiguous response (say, a
question AND variants) would be a real bug. The LM is stubbed throughout — these
tests are about routing and control flow, not about mathematics.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.experts.handlers.proof_edit import handler as H
from backend.experts.modules.proof_edit.intent import (
    MAX_CLARIFICATIONS, ProofEditProposal, ProposedStep, format_clarifications,
)
from backend.experts.handlers.proof_edit.validate import EditRefused

FIXTURE = (Path(__file__).resolve().parents[3]
           / "proofs" / "domains" / "algebra" / "quadratic-formula.json")

OUTCOME_KEYS = ("fallback_to_chat", "question", "variants", "reason")


@pytest.fixture
def proof() -> dict:
    return json.loads(FIXTURE.read_text())


def _req(proof, message="multiply both sides by 2", step=2, clarifications=()):
    return H.ProofEditRequest(
        message=message, proof=proof, current_step=step,
        clarifications=list(clarifications))


def _stub_proposal(monkeypatch, proposal):
    monkeypatch.setattr(H, "propose_edit", lambda *a, **k: proposal)


def _assert_single_outcome(res):
    present = [k for k in OUTCOME_KEYS if res.get(k)]
    assert len(present) == 1, f"expected exactly one outcome, got {present}"
    return present[0]


# --------------------------------------------------------------------------- #
# 1. not an edit
# --------------------------------------------------------------------------- #

def test_question_falls_through_to_chat(monkeypatch, proof):
    """A non-operation is handed back to the tutor, not guessed at."""
    _stub_proposal(monkeypatch, ProofEditProposal(is_edit=False))
    res = H.proof_edit(_req(proof, "why does the plus-minus appear here?"))
    assert _assert_single_outcome(res) == "fallback_to_chat"


def test_empty_proof_falls_through(monkeypatch, proof):
    """Nothing to edit means nothing to propose."""
    res = H.proof_edit(H.ProofEditRequest(message="add 1", proof={"steps": []}))
    assert res == {"fallback_to_chat": True}


# --------------------------------------------------------------------------- #
# 2. clarification
# --------------------------------------------------------------------------- #

def test_returns_question_when_under_determined(monkeypatch, proof):
    _stub_proposal(monkeypatch, ProofEditProposal(
        is_edit=True, question="Definite or indefinite integral?"))
    res = H.proof_edit(_req(proof, "integrate both sides"))
    assert _assert_single_outcome(res) == "question"
    assert res["focus_step"] == 2


def test_clarification_budget_is_bounded(monkeypatch, proof):
    """Once the budget is spent the model must commit — no interrogation loop."""
    _stub_proposal(monkeypatch, ProofEditProposal(
        is_edit=True, question="still unsure?"))
    spent = [H.Clarification(question="q", answer="a")] * MAX_CLARIFICATIONS

    monkeypatch.setattr(H, "resolve",
                        lambda *a, **k: (_ for _ in ()).throw(EditRefused("gave up")))
    res = H.proof_edit(_req(proof, "integrate both sides", clarifications=spent))
    assert _assert_single_outcome(res) == "reason"


def test_clarifications_reach_the_prompt():
    """Answered questions ride in the request, so a resumed call is stateless."""
    rendered = format_clarifications(
        [H.Clarification(question="Assume $x \\neq 3$?", answer="yes")])
    assert "Assume $x \\neq 3$?" in rendered and "yes" in rendered


def test_unanswered_clarifications_are_dropped():
    """A question with no answer yet is not context — it is noise."""
    assert format_clarifications([H.Clarification(question="q", answer="")]) == ""


def test_clarifications_recovered_from_the_chat_thread():
    """The proof-chat expert is stateless per ``edit_step`` call, so a question it
    asked and the user's answer survive only in the thread. Recovering them stops
    the "same question, forever" loop (observed with 'derive a wrt b')."""
    from backend.experts.modules.proof_edit.intent import clarifications_from_thread
    thread = [
        {"role": "user", "text": "derive a wrt b"},
        {"role": "bot", "text": "Should 'a' be a constant or a function of 'b'?"},
        {"role": "user", "text": "a function of b"},
    ]
    pairs = clarifications_from_thread(thread)
    assert pairs == [{"question": "Should 'a' be a constant or a function of 'b'?",
                      "answer": "a function of b"}]


def test_thread_recovery_ignores_non_question_bot_turns():
    """Only an assistant turn that ENDS in a question is a clarification; ordinary
    replies (and a trailing unanswered question) are not paired."""
    from backend.experts.modules.proof_edit.intent import clarifications_from_thread
    thread = [
        {"role": "user", "text": "multiply by 2"},
        {"role": "bot", "text": "Done — multiplied both sides by 2."},   # not a question
        {"role": "user", "text": "now divide by a"},
        {"role": "bot", "text": "Could a be zero?"},                     # unanswered (last)
    ]
    assert clarifications_from_thread(thread) == []


# --------------------------------------------------------------------------- #
# 3. variants
# --------------------------------------------------------------------------- #

def test_returns_variants_on_success(monkeypatch, proof):
    _stub_proposal(monkeypatch, ProofEditProposal(
        is_edit=True,
        steps=[ProposedStep(operation="restate", expr_latex=proof["steps"][2]["input_latex"],
                            justification="trivially equal")],
        summary="Restated the step."))
    res = H.proof_edit(_req(proof))
    assert _assert_single_outcome(res) == "variants"
    assert res["new_steps"] and res["focus_step"] == 3
    assert res["summary"] == "Restated the step."


# --------------------------------------------------------------------------- #
# 4. refused
# --------------------------------------------------------------------------- #

def test_refusal_offers_nothing(monkeypatch, proof):
    """A REFUTED edit yields an explanation and NO pickable option.

    Offering a refuted candidate would hand the user a known-wrong proof, which
    is precisely the state this feature exists to prevent. Stubbed at the verdict
    level because the CAS almost never returns ``refuted`` in practice — see
    ``test_unconfirmed_step_is_offered_with_a_caveat``.
    """
    _stub_proposal(monkeypatch, ProofEditProposal(
        is_edit=True, steps=[ProposedStep(operation="bogus", expr_latex="x = 1",
                                          justification="nope")]))
    monkeypatch.setattr(
        H, "resolve",
        lambda *a, **k: (_ for _ in ()).throw(EditRefused("not equivalent")))
    res = H.proof_edit(_req(proof, "divide both sides by zero"))
    assert _assert_single_outcome(res) == "reason"
    assert "variants" not in res


def test_unconfirmed_step_is_offered_with_a_caveat(monkeypatch, proof):
    """An unconfirmed step is offered — but the user is TOLD, not just badged.

    The CAS reserves ``refuted`` for steps it computed and found wrong; two
    unrelated equations come back ``unknown``/``plausible`` instead. Measured:
    inserting ``1 = 2`` into a real proof yields ``plausible``. So a gate that
    only rejected ``refuted`` would let nonsense through wearing a reassuring
    badge — the caveat is what makes that honest.
    """
    _stub_proposal(monkeypatch, ProofEditProposal(
        is_edit=True, steps=[ProposedStep(operation="bogus", expr_latex="1 = 2",
                                          justification="nope")],
        summary="Nonsense."))
    res = H.proof_edit(_req(proof))
    assert _assert_single_outcome(res) == "variants"
    assert res.get("caveat"), "an unconfirmed step must carry an explicit caveat"


def test_proposal_without_steps_is_refused(monkeypatch, proof):
    """`is_edit` with nothing concrete attached is a refusal, not a crash."""
    _stub_proposal(monkeypatch, ProofEditProposal(is_edit=True, steps=[]))
    res = H.proof_edit(_req(proof))
    assert _assert_single_outcome(res) == "reason"


# --------------------------------------------------------------------------- #
# bounds
# --------------------------------------------------------------------------- #

def test_current_step_is_clamped(monkeypatch, proof):
    """An out-of-range cursor lands on a real step rather than erroring."""
    _stub_proposal(monkeypatch, ProofEditProposal(
        is_edit=True, question="which one?"))
    res = H.proof_edit(_req(proof, step=9999))
    assert res["focus_step"] == len(proof["steps"]) - 1


def test_request_model_rejects_unknown_fields(proof):
    with pytest.raises(Exception):
        H.ProofEditRequest(message="x", proof=proof, surprise=True)


def test_formatted_proof_hides_htmldata(proof):
    """The model must never see — or learn to imitate — the id annotations."""
    assert "htmlData" not in H._format_proof(proof)


def test_intent_parser_is_a_compilable_module():
    """The parser is a ``dspy.Module`` with a discoverable sub-predictor.

    Structuring it this way (rather than a bare ``Predict``) gives it a compile
    target: a DSPy optimizer walks ``named_predictors`` to tune it against a
    labelled dataset later. If it silently reverted to a plain function this
    would fail, and the optimization path would quietly vanish.
    """
    import dspy
    from backend.experts.modules.proof_edit.intent import EditIntentParser

    parser = EditIntentParser()
    assert isinstance(parser, dspy.Module)
    assert [n for n, _ in parser.named_predictors()], "no predictor to compile"


def test_clean_repairs_json_mangled_latex():
    """A JSON parser eats the first letter of a single-backslash LaTeX command.

    ``\\frac`` starts with ``\\f`` — a form feed — so a caption written as
    ``rewrite $\\frac{c}{\\sin(w)}$`` arrived as ``rewrite $rac{c}{sin(w)}$`` and
    rendered as garbage. ``DerivationStep`` repairs this via a field validator;
    these fields bypass that model, so ``_clean`` has to do it.
    """
    from backend.experts.modules.proof_edit.intent import _clean

    mangled = "rewrite \x0crac{c}{\\sin(w)} over a common denominator"
    assert "\\frac{c}" in _clean(mangled)
    assert "\x0c" not in _clean(mangled)
    # Idempotent, and a no-op on text that was never mangled.
    assert _clean(_clean(mangled)) == _clean(mangled)
    assert _clean("plain prose, no math") == "plain prose, no math"
