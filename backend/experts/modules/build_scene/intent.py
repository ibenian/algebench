"""Context -> a structured scene proposal. The one place an LM is called.

The model PROPOSES; it does not get the last word. Everything it returns passes
through `compose`, which mints the ids, refuses a coordinate written in the wrong
notation, and derives the staging — so a proposal that is confidently wrong about
any of those is corrected or rejected rather than rendered.

Requires DSPy to be configured first (`init_experts()` / `configure_dspy()`).
"""
from __future__ import annotations

import logging
import re
from functools import cache

import dspy
from pydantic import BaseModel, ConfigDict, Field

from backend.experts.llm_config import make_adapter

from .proposed import ProposedElement, ProposedStep
from .signature import BuildSceneSig

log = logging.getLogger(__name__)

#: DSPy's ChatAdapter frames fields with `[[ ## name ## ]]`; some models echo a
#: trailing `[[ ## completed ## ]]` into a free-text output. Strip them.
_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")

#: A scene longer than this is a lesson, not a scene — and a reader clicking
#: through 30 steps has lost the thread well before the end.
MAX_STEPS = 12
#: Bounded so one proposal cannot become an unrenderable scene.
MAX_ELEMENTS = 60


class SceneProposal(BaseModel):
    """The model's structured answer, before compose has had its say."""

    model_config = ConfigDict(extra="ignore")

    is_build: bool = False
    question: str = ""
    title: str = ""
    description: str = ""
    steps: list[ProposedStep] = Field(default_factory=list)
    elements: list[ProposedElement] = Field(default_factory=list)


class SceneBuilder(dspy.Module):
    """One `Predict`, wrapped as a Module so it has a compile target later.

    Bare `Predict` rather than `ChainOfThought`, but NOT for proof_edit's
    measured reason — that measurement was about routing and naming a CAS op, and
    it does not transfer to authoring geometry. This is the plain starting point,
    to be measured on its own evidence before anything is claimed for it.
    """

    def __init__(self):
        super().__init__()
        self.predict = dspy.Predict(BuildSceneSig)

    def forward(self, **inputs):
        # LineAdapter via `dspy.context`: `Predict.forward` reads
        # `settings.adapter`, so an `adapter=` kwarg would sit inertly in
        # `self.config` and be forwarded to the LM instead (#543). `elements` is
        # the reason — a `list[BaseModel]` output is JSON-decoded under
        # ChatAdapter, and every KaTeX label in it would come back escaped.
        with dspy.context(adapter=make_adapter(line_oriented=True)):
            return self.predict(**inputs)


@cache
def _builder() -> SceneBuilder:
    return SceneBuilder()


def _clean(text) -> str:
    return _DSPY_MARKER.sub("", str(text or "")).strip()


def propose_scene(**inputs) -> SceneProposal:
    """Ask the model for a scene. Returns an empty proposal if the call fails.

    An exception here is not the caller's problem to distinguish: an empty
    proposal has `is_build` false, which routes to the tutor chat — the same
    place a non-request goes. The handler says so; the reader is not shown a
    stack trace.
    """
    try:
        out = _builder()(**inputs)
    except Exception:
        log.exception("build_scene: the model call failed")
        return SceneProposal()

    return SceneProposal(
        is_build=bool(out.is_build),
        question=_clean(out.question),
        title=_clean(out.title),
        description=_clean(out.description),
        steps=[s for s in (out.steps or []) if isinstance(s, ProposedStep)][:MAX_STEPS],
        elements=[e for e in (out.elements or [])
                  if isinstance(e, ProposedElement)][:MAX_ELEMENTS],
    )
