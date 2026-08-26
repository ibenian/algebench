"""The four outcomes, and the wiring that makes the endpoint exist.

The LM is stubbed throughout: what is under test is the ROUTING and the
composition, both of which must behave identically whatever the model says.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from backend.experts.handlers.build_scene import handler as h
from backend.experts.modules.build_scene.intent import SceneProposal
from backend.experts.modules.build_scene.proposed import ProposedElement, ProposedStep

FIXTURE = pathlib.Path("tests/fixtures/build_scene_request.json")


@pytest.fixture
def request_body() -> dict:
    return json.loads(FIXTURE.read_text())


def _stub(monkeypatch, proposal: SceneProposal) -> None:
    monkeypatch.setattr(h, "propose_scene", lambda **_: proposal)


def _good() -> SceneProposal:
    return SceneProposal(
        is_build=True, title="Cross Product", description="Perpendicular to both.",
        steps=[ProposedStep(index=0, title="Add $\\vec{a}$")],
        elements=[ProposedElement(type="vector", label="$\\vec{a}$", step=0,
                                  from_pos="0,0,0", to_pos="2,0,0")])


# ---- the wiring ----------------------------------------------------------

def test_the_endpoint_exists_via_discovery():
    """`discover_handlers()` imports the PACKAGE, so an empty __init__.py leaves
    the decorator unrun and the endpoint 404s.

    In a SUBPROCESS, and that is the whole test. Run in-process it proves nothing:
    this module's own `from ... import handler` has already executed the decorator,
    so the registry is populated no matter what __init__.py does. The first
    version of this test passed with __init__.py emptied.
    """
    import subprocess
    import sys

    out = subprocess.run(
        [sys.executable, "-c",
         "from backend.experts.handlers import discover_handlers;"
         "discover_handlers();"
         "from backend.experts.registry import HANDLER_REGISTRY;"
         "print('build_scene' in HANDLER_REGISTRY)"],
        capture_output=True, text=True, cwd=".")
    assert out.stdout.strip().endswith("True"), (
        f"discovery did not register build_scene\n{out.stdout}\n{out.stderr[-500:]}")


# ---- the four outcomes ---------------------------------------------------

def test_not_a_scene_request_falls_back_to_chat(monkeypatch, request_body):
    _stub(monkeypatch, SceneProposal(is_build=False))
    assert h.build_scene(h.BuildSceneRequest.model_validate(request_body)) == {
        "fallback_to_chat": True}


def test_an_underdetermined_request_asks_once(monkeypatch, request_body):
    _stub(monkeypatch, SceneProposal(is_build=True, question="2D or 3D?"))
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert out["question"] == "2D or 3D?"


def test_the_question_budget_is_bounded(monkeypatch, request_body):
    """Otherwise an ambiguous request becomes an interrogation. Once the budget
    is spent the model must commit or be refused."""
    _stub(monkeypatch, SceneProposal(is_build=True, question="again?"))
    request_body["clarifications"] = [{"question": "q", "answer": "a"}] * h.MAX_CLARIFICATIONS
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert "question" not in out, "it must stop asking and commit or refuse"


def test_a_buildable_proposal_returns_an_applicable_op(monkeypatch, request_body):
    _stub(monkeypatch, _good())
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    op = out["result"]["ops"][0]
    assert op["op"] == "replace" and op["kind"] == "scene"
    assert op["at"] == {"index": 2}, "the op must land where the request said"
    assert op["node"]["title"] == "Cross Product"
    assert op["node"]["steps"][0]["add"][0]["from"] == [0, 0, 0], "schema names, not ours"


def test_a_proposal_compose_refuses_becomes_a_reason(monkeypatch, request_body):
    """The message names the element and what was wrong, which is what the reader
    needs instead of a scene that renders empty."""
    bad = _good()
    bad.elements[0].to_pos = r"\cos(\theta), 0, 0"
    _stub(monkeypatch, bad)
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert "math.js" in out["reason"] and "result" not in out


def test_an_inconsistent_request_is_refused_before_the_model_is_called(monkeypatch, request_body):
    """A replace with nothing to replace. Calling the LM anyway would spend a
    request to build the wrong thing."""
    called = []
    monkeypatch.setattr(h, "propose_scene", lambda **_: called.append(1) or SceneProposal())
    request_body["current"] = None
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert "reason" in out and not called


# ---- the op is the contract ---------------------------------------------

def test_the_op_matches_the_shared_build_contract(monkeypatch, request_body):
    """`ops` is applied by src/lesson-placement.ts via the shape declared in
    contracts.py and mirrored in src/placement.ts. If the handler drifts from it
    the client receives something it cannot apply — and finds out at apply time,
    not here."""
    from pydantic import TypeAdapter

    from backend.experts.contracts import BuildOp

    _stub(monkeypatch, _good())
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    ops = TypeAdapter(list[BuildOp]).validate_python(out["result"]["ops"])
    assert ops[0].kind == "scene" and ops[0].at.index == 2
    # The contract alone is NOT enough and this is the record of why: `scene` and
    # `index` are both Optional on Placement, so this check passed while the op
    # was unapplicable. src/lesson-placement.test.ts applies it for real.
    assert ops[0].at.scene is None


def test_prompts_follow_the_lessons_convention(monkeypatch, request_body):
    """`conventions.elementsCarryPrompts` decides, not the composer."""
    _stub(monkeypatch, _good())
    request_body["conventions"]["elementsCarryPrompts"] = False
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert "prompt" not in out["result"]["ops"][0]["node"]["steps"][0]["add"][0]


# ---- the clarification loop ---------------------------------------------

THREAD = [
    {"role": "user", "text": "add a scene about the dot product"},
    {"role": "bot", "text": "Should the vectors be in 2D or 3D?"},
    {"role": "user", "text": "3D please"},
]


def test_a_question_answered_in_the_thread_is_not_asked_again(monkeypatch, request_body):
    """The expert is stateless, so a question it asked and the answer it got live
    ONLY in the conversation. Without recovering them it re-parses the same
    intent and asks the identical question forever — observed in proof_edit, in
    production, which is why `clarifications_from_thread` exists.
    """
    _stub(monkeypatch, SceneProposal(is_build=True, question="Should the vectors be in 2D or 3D?"))
    request_body["messages"] = THREAD
    request_body["clarifications"] = []
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert "question" not in out, "it re-asked a question the thread already answered"


def test_the_recovered_answer_reaches_the_prompt(monkeypatch, request_body):
    """Not re-asking is only half of it: the ANSWER has to be used, or the model
    makes the same choice arbitrarily every time."""
    seen = {}
    monkeypatch.setattr(h, "propose_scene", lambda **kw: seen.update(kw) or SceneProposal())
    request_body["messages"] = THREAD
    h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert "3D please" in seen["clarifications"]
    assert "2D or 3D" in seen["clarifications"]


def test_explicit_and_thread_rounds_are_unioned_not_replaced(monkeypatch, request_body):
    """Undercounting is the dangerous direction: the count engages
    MAX_CLARIFICATIONS, so a missed round re-opens the loop it exists to close."""
    _stub(monkeypatch, SceneProposal(is_build=True, question="something else?"))
    request_body["messages"] = THREAD
    request_body["clarifications"] = [{"question": "which colour?", "answer": "gold"}]
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert "question" not in out, "two distinct rounds must exhaust the budget"


def test_a_round_present_in_both_is_counted_once(monkeypatch, request_body):
    """Double-counting would cut the budget in half for a client that sends
    both — the model would be refused a question it was entitled to ask."""
    _stub(monkeypatch, SceneProposal(is_build=True, question="still unclear?"))
    request_body["messages"] = THREAD
    request_body["clarifications"] = [{"question": "Should the vectors be in 2D or 3D?",
                                       "answer": "3D please"}]
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert out.get("question") == "still unclear?", "one round used, one still available"


def test_an_ordinary_thread_yields_no_clarifications(monkeypatch, request_body):
    """Only an assistant turn ENDING IN '?' paired with a user reply counts.
    Otherwise ordinary conversation would silently spend the budget."""
    seen = {}
    monkeypatch.setattr(h, "propose_scene", lambda **kw: seen.update(kw) or SceneProposal())
    request_body["messages"] = [
        {"role": "user", "text": "nice scene"},
        {"role": "bot", "text": "Glad you like it."},
        {"role": "user", "text": "add another"},
    ]
    request_body["clarifications"] = []
    h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert seen["clarifications"] == ""
