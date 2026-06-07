"""``proof_animation`` handler — derive a docked proof animation on the fly.

Wraps the ``proof_completion`` expert with the pre/post-processing the live app
needs (see ``../README.md``):

* **pre** — the client sends the clicked node's expression as ``target_latex``
  plus the proof's givens/goal; the START is either supplied (a proof's
  ``given`` step) or inferred from a prompt via :func:`endpoints_from_prompt`.
* **call** — run ``proof_completion`` through ``service.invoke`` (never by
  instantiating the expert directly).
* **post** — render the returned ``ProofTrajectory`` into FLIP animation data
  via :func:`build`.

Exposed at ``POST /api/expert/proof_animation``. Requires DSPy configured
(handled by the endpoint's ``_ensure_experts``).
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from backend.experts.context_id import build as build_context_id
from backend.experts.registry import register_handler
from backend.experts.service import invoke
from backend.semantic_graph.service import SemanticGraphService

from .animation import build
from .prompt_endpoints import endpoints_from_prompt


class Given(BaseModel):
    """One proof given — its LaTeX plus an optional human label."""

    model_config = ConfigDict(extra="ignore")
    math: str
    label: Optional[str] = None


class DeriveProofRequest(BaseModel):
    """Request for ``POST /api/expert/proof_animation``."""

    model_config = ConfigDict(extra="forbid")

    target_latex: str = Field(min_length=1)
    domain: Optional[str] = None
    givens: list[Given] = Field(default_factory=list)
    goal: Optional[str] = None
    # A human-readable name for the derivation (e.g. the proof title). Used as
    # the animation title; falls back to the LM/goal/"Derivation".
    title: Optional[str] = None
    # The proof's `given` step when available — skips start inference.
    start_latex: Optional[str] = None
    intent: Optional[str] = None


def _givens_clause(req: DeriveProofRequest) -> str:
    """A short 'given …' clause from the goal + given expressions (may be empty)."""
    parts: list[str] = []
    if req.goal:
        parts.append(req.goal.strip())
    parts.extend(g.math.strip() for g in req.givens if g.math.strip())
    return "; ".join(p for p in parts if p)


@register_handler("proof_animation", request_model=DeriveProofRequest)
def derive_proof_animation(req: DeriveProofRequest) -> dict:
    """Infer the start (if needed), run ``proof_completion``, render animation data."""
    givens = _givens_clause(req)

    # --- pre: resolve the START (and display captions) --------------------------
    given_label = ""
    start_note = ""
    lm_domain = lm_title = ""
    start = (req.start_latex or "").strip()
    if not start:
        prompt = f"Derive this expression: {req.target_latex}"
        if givens:
            prompt += f" given {givens}"
        start, _lm_target, lm_domain, lm_title, given_label, start_note = \
            endpoints_from_prompt(prompt)
        if not start:
            raise ValueError("could not infer a starting expression for this derivation")

    domain = (req.domain or lm_domain or "algebra").strip()
    intent = req.intent or (
        f"Derive {req.target_latex}" + (f" given {givens}" if givens else "")
    )

    # --- call: run the expert through the canonical invoke boundary -------------
    svc = SemanticGraphService()
    start_g = svc.latex_to_graph(start, domain=domain)
    target_g = svc.latex_to_graph(req.target_latex, domain=domain)
    if start_g is None or target_g is None:
        which = "start" if start_g is None else "target"
        raise ValueError(f"could not parse {which} expression")

    payload = {"start": start_g, "target": target_g, "domain": domain, "intent": intent}
    result = invoke(
        "proof_completion",
        build_context_id(scene="adhoc", semantic_graph=True),
        payload,
        instruction=intent,
    )
    traj = result.single()
    if not traj.steps:
        raise ValueError("the expert returned no derivation steps")

    # --- post: render the trajectory into FLIP animation data -------------------
    # Prefer a human-readable title (proof title) over the raw goal expression.
    title = (req.title or lm_title or req.goal or "Derivation").strip()
    start_operation = given_label or f"Given ${start}$"
    start_justification = start_note or req.goal or "the starting expression"
    return build(traj, domain, title,
                 start_operation=start_operation,
                 start_justification=start_justification)
