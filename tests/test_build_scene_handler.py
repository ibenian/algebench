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

#: Resolved from __file__, not the cwd. pytest can be invoked from anywhere, and
#: a path that only works from the repo root is a test that fails for a reason
#: unrelated to what it checks — 13 of the 14 here errored when run from /tmp.
ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "build_scene_request.json"


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
        capture_output=True, text=True, cwd=str(ROOT))
    assert out.stdout.strip().endswith("True"), (
        f"discovery did not register build_scene\n{out.stdout}\n{out.stderr[-500:]}")


# ---- the four outcomes ---------------------------------------------------

def test_a_failed_call_is_refused_not_routed_to_chat(monkeypatch, request_body):
    """A CRASH and a NON-REQUEST are different answers.

    Both leave `is_build` false. Collapsing them told the reader "that was not a
    scene request" about a request that WAS one — observed live: the model
    emitted a `type: slider` element, the adapter rightly refused the unknown
    `value` key, and the user was handed a conversational reply instead of being
    told the build had failed.
    """
    _stub(monkeypatch, SceneProposal(is_build=False, error="the builder broke"))
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert out == {"reason": "the builder broke"}
    assert "fallback_to_chat" not in out


def test_a_failed_call_beats_a_question_it_also_carried(monkeypatch, request_body):
    """`error` is checked FIRST. A partial parse can leave both set, and asking
    the reader to clarify a request that never reached the model wastes a round
    of the budget on a question the answer cannot help."""
    _stub(monkeypatch, SceneProposal(is_build=True, question="2D or 3D?", error="broke"))
    request_body["clarifications"] = []
    request_body["messages"] = []
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert out == {"reason": "broke"}


def test_not_a_scene_request_falls_back_to_chat(monkeypatch, request_body):
    _stub(monkeypatch, SceneProposal(is_build=False))
    assert h.build_scene(h.BuildSceneRequest.model_validate(request_body)) == {
        "fallback_to_chat": True}


def test_an_underdetermined_request_asks_once(monkeypatch, request_body):
    # Cleared explicitly. The shipped fixture carries a clarification round in
    # BOTH `clarifications` and its thread, which is deliberate — but it means
    # relying on the fixture for "budget untouched" makes this test read as a
    # budget test that happens to pass.
    _stub(monkeypatch, SceneProposal(is_build=True, question="2D or 3D?"))
    request_body["clarifications"] = []
    request_body["messages"] = []
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert out["question"] == "2D or 3D?"
    assert out["focus"] == request_body["sceneIndex"], (
        "the client scrolls to `focus`; a question about scene 2 must point at scene 2")


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


# ---- the module boundary -------------------------------------------------

def test_a_crashed_model_call_carries_an_error_the_handler_can_refuse_on(monkeypatch):
    """`propose_scene` swallows the exception — but must not swallow the FACT.

    Everything above stubs `propose_scene`, so nothing else watches the one line
    that decides whether a crash is distinguishable from a considered "no". The
    LineFormatError below is the real one: the model answered with a `slider`
    element and the adapter refused its unknown `value` key.
    """
    from backend.experts.modules.build_scene import intent as it

    def boom(**_):
        raise ValueError("elements: line 6 has unknown key 'value'")

    monkeypatch.setattr(it, "_builder", lambda: boom)
    proposal = it.propose_scene(intent="x")

    assert proposal.error, "a crash must be reported, not returned as an empty proposal"
    assert not proposal.is_build
    # The reader gets a sentence, not a traceback: the adapter's message names
    # `from_expr` and is written for whoever maintains the signature.
    assert "unknown key" not in proposal.error


def _parse_error():
    """The real exception the adapter raises — it needs a live signature."""
    from dspy.utils.exceptions import AdapterParseError

    from backend.experts.modules.build_scene.signature import BuildSceneSig

    return AdapterParseError(adapter_name="LineAdapter", signature=BuildSceneSig,
                             lm_response="", message="a value must not span lines")


def test_a_malformed_answer_is_retried_exactly_once(monkeypatch):
    """A format slip loses everything, and it is a slip, not a misunderstanding.

    One observed response had nine correct sliders, four correct vectors, axes, a
    grid and an origin — and one `text` label that ran to five lines, which is
    not `key: value`. The adapter refused the whole answer and fourteen good
    elements went with it. Sampling is at temperature 0.7 with DSPy's cache off,
    so the retry is a genuinely different draw.
    """
    from backend.experts.modules.build_scene import intent as it

    calls = []

    def flaky(**_):
        calls.append(1)
        if len(calls) == 1:
            raise _parse_error()
        return SceneProposal(is_build=True, title="T", description="d")

    monkeypatch.setattr(it, "_builder", lambda: flaky)
    out = it.propose_scene(intent="x")
    assert len(calls) == 2, "the first attempt must be retried"
    assert not out.error and out.title == "T"


def test_a_second_malformed_answer_is_not_retried_again(monkeypatch):
    """A model that malforms twice will not be talked round, and the reader is
    already waiting."""
    from backend.experts.modules.build_scene import intent as it

    calls = []

    def always_bad(**_):
        calls.append(1)
        raise _parse_error()

    monkeypatch.setattr(it, "_builder", lambda: always_bad)
    out = it.propose_scene(intent="x")
    assert len(calls) == 2, "exactly one retry, not a loop"
    assert out.error


def test_a_non_format_failure_is_not_retried(monkeypatch):
    """A dead LM or a bad key fails the same way twice — spending a second
    request on it just doubles the wait before the reader is told."""
    from backend.experts.modules.build_scene import intent as it

    calls = []

    def boom(**_):
        calls.append(1)
        raise RuntimeError("connection refused")

    monkeypatch.setattr(it, "_builder", lambda: boom)
    out = it.propose_scene(intent="x")
    assert len(calls) == 1
    assert out.error


# ---- the informed retry --------------------------------------------------
#
# `intent.py` already retries a MALFORMED answer. This is the other failure: a
# well-formed proposal the composer will not accept. Nothing carried that reason
# back to the builder, so every re-ask — the chat agent's included — reached the
# model as the identical prompt and drew the identical scene.


def _refusable() -> SceneProposal:
    """A proposal `compose` rejects, for a reason it states precisely."""
    bad = _good()
    bad.elements[0].to_pos = r"\cos(\theta), 0, 0"
    return bad


def _answers(monkeypatch, *proposals: SceneProposal) -> list[dict]:
    """Stub `propose_scene` to return each proposal in turn, recording its inputs."""
    calls: list[dict] = []
    queue = list(proposals)

    def _next(**kw):
        calls.append(kw)
        return queue.pop(0) if queue else proposals[-1]

    monkeypatch.setattr(h, "propose_scene", _next)
    return calls


def test_a_refusal_buys_one_more_ask(monkeypatch, request_body):
    """The reason is precise enough to act on, so spend a request on it rather
    than handing the reader a scene that was never built."""
    calls = _answers(monkeypatch, _refusable(), _good())
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert len(calls) == 2, "a compose refusal must ask again"
    assert out["result"]["ops"][0]["node"]["title"] == "Cross Product"
    assert "reason" not in out


def test_the_refusal_reaches_the_second_prompt(monkeypatch, request_body):
    """Asking again is only half of it. Without the reason in the prompt the
    second draw is the same draw — which is the bug, not the fix."""
    calls = _answers(monkeypatch, _refusable(), _good())
    h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert calls[0]["refused"] == "", "nothing has been refused on a first ask"
    assert "math.js" in calls[1]["refused"], "the composer's own words, not a paraphrase"


def test_a_second_refusal_is_not_retried_again(monkeypatch, request_body):
    """A model that ignores a precise reason twice will not be talked round, and
    the reader is waiting."""
    calls = _answers(monkeypatch, _refusable(), _refusable())
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert len(calls) == 2, "exactly one extra ask"
    assert "math.js" in out["reason"] and "result" not in out


def test_a_retry_with_nothing_to_compose_reports_the_first_reason(monkeypatch, request_body):
    """The second ask can come back empty or broken. "The scene builder could not
    finish this one" describes no scene; the first refusal describes a real one,
    and it is what the chat agent can propose an alternative to."""
    calls = _answers(monkeypatch, _refusable(),
                     SceneProposal(is_build=False, error="the builder broke"))
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert len(calls) == 2
    assert "math.js" in out["reason"], "the refusal, not the crash"
    assert "the builder broke" not in out["reason"]


def test_a_proposal_that_composes_is_never_asked_twice(monkeypatch, request_body):
    """The retry is on the REFUSAL path only. Spending a second request on every
    successful build would double the wait for the case that already works."""
    calls = _answers(monkeypatch, _good())
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert len(calls) == 1 and "result" in out


def test_the_retry_does_not_reopen_the_question(monkeypatch, request_body):
    """The reader committed at the clarification step. "Here is why your scene was
    rejected" is not an invitation to ask them something else instead."""
    asking = _good()
    asking.question = "2D or 3D?"
    _answers(monkeypatch, _refusable(), asking)
    request_body["clarifications"] = []
    request_body["messages"] = []
    out = h.build_scene(h.BuildSceneRequest.model_validate(request_body))
    assert "question" not in out, "a retry commits; it does not re-ask"
    assert "result" in out
