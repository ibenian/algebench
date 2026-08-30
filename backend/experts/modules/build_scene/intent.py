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
from dspy.utils.exceptions import AdapterParseError
from pydantic import BaseModel, ConfigDict, Field

from backend.experts.llm_config import make_adapter

from .proposed import ProposedElement, ProposedFunction, ProposedSlider, ProposedStep
from .signature import BuildSceneSig

log = logging.getLogger(__name__)

#: DSPy's ChatAdapter frames fields with `[[ ## name ## ]]`; some models echo a
#: trailing `[[ ## completed ## ]]` into a free-text output. Strip them.
_DSPY_MARKER = re.compile(r"\[\[\s*##.*?##\s*\]\]")

#: A scene longer than this is a lesson, not a scene — and a reader clicking
#: through 30 steps has lost the thread well before the end.
MAX_STEPS = 12
#: Across the whole scene, not per step. Measured, not guessed: the corpus puts
#: up to 17 sliders in a SINGLE step (two six-component vectors and their
#: parameters is ordinary), so a tight cap would truncate a legitimate scene into
#: one whose coordinates reference ids that no longer exist.
MAX_SLIDERS = 24
#: Bounded so one proposal cannot become an unrenderable scene.
MAX_ELEMENTS = 60
#: Scene functions. Low on purpose: they exist to remove REPETITION, and a scene
#: needing more than a handful of distinct named formulas is describing a program
#: rather than a picture. The busiest corpus scene declares 2.
MAX_FUNCTIONS = 8


class SceneProposal(BaseModel):
    """The model's structured answer, before compose has had its say."""

    model_config = ConfigDict(extra="ignore")

    is_build: bool = False
    question: str = ""
    #: Set when the CALL failed — a parse error, a timeout, a dead LM. Empty on a
    #: successful call, including one that decided this was not a build.
    #:
    #: Load-bearing: without it a crash returns an empty proposal, `is_build` is
    #: false, and the handler answers `fallback_to_chat` — telling the reader
    #: "that was not a scene request" about a request that WAS one. Observed:
    #: the model emitted `type: slider` elements, the adapter rightly refused
    #: the unknown `value` key, and the user was told they had asked a question.
    error: str = ""
    title: str = ""
    description: str = ""
    steps: list[ProposedStep] = Field(default_factory=list)
    sliders: list[ProposedSlider] = Field(default_factory=list)
    functions: list[ProposedFunction] = Field(default_factory=list)
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


#: What the reader is told when the call itself failed. Deliberately not the
#: exception text: a `LineFormatError` naming `from_expr` is written for whoever
#: maintains the signature, not for someone who asked for a scene about torque.
CALL_FAILED = ("The scene builder could not finish this one. Try again, or "
               "describe the scene a little differently.")


def _attempt(inputs: dict):
    """Ask once, and once more if the ANSWER was malformed.

    A format slip loses everything. One observed response had nine correct
    sliders, four correct vectors, axes, a grid and an origin — and a single
    `text` element whose label ran to five lines, which is not `key: value`. The
    adapter refused the whole answer, correctly, and fourteen good elements went
    with it.

    Retrying is worth a request here because the failure is in the SHAPE, not the
    reasoning: sampling runs at temperature 0.7 and DSPy's cache is off by
    default, so the second attempt is a genuinely different draw rather than the
    same answer again. Exactly one retry — a model that malforms twice is not
    going to be talked round, and the reader is already waiting.
    """
    try:
        return _builder()(**inputs)
    except AdapterParseError as e:
        log.warning("build_scene: malformed answer, retrying once: %s",
                    str(e).splitlines()[0][:160])
        return _builder()(**inputs)


def propose_scene(**inputs) -> SceneProposal:
    """Ask the model for a scene. Returns a proposal carrying `error` if it fails.

    A FAILURE and a NON-REQUEST are different answers and must not collapse into
    one. Both leave `is_build` false, so the distinction lives in `error`: the
    handler refuses on it (and says so) rather than routing to the tutor chat as
    though the reader had merely asked a question.
    """
    try:
        out = _attempt(inputs)
    except Exception as e:
        log.exception("build_scene: the model call failed")
        return SceneProposal(error=f"{CALL_FAILED} ({type(e).__name__})")

    return SceneProposal(
        is_build=bool(out.is_build),
        question=_clean(out.question),
        title=_clean(out.title),
        description=_clean(out.description),
        steps=[s for s in (out.steps or []) if isinstance(s, ProposedStep)][:MAX_STEPS],
        sliders=[s for s in (getattr(out, "sliders", None) or [])
                 if isinstance(s, ProposedSlider)][:MAX_SLIDERS],
        functions=[f for f in (getattr(out, "functions", None) or [])
                   if isinstance(f, ProposedFunction)][:MAX_FUNCTIONS],
        elements=[e for e in (out.elements or [])
                  if isinstance(e, ProposedElement)][:MAX_ELEMENTS],
    )
