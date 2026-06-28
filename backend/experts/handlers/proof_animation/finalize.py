"""Finalize a ProofTrajectory into COMPLETE animation data.

This is the single shared trajectory→animation pipeline used by BOTH the live
proof-animation handler and the offline built-in tooling
(``scripts/proof_animation``), so their output never drifts.

``build()`` (animation.py) is the deterministic, LM-free conversion core. This
layer adds the optional LM-backed steps on top:

  * the domain-step **judge** (passed in by the caller — the handler's shared
    singleton, the tooling's default-on gate) is routed through ``build()`` so
    CAS-uncheckable steps can be rescued into the DOMAIN tier; and
  * the per-term **description** pass that fills tooltip prose.

Both are strictly additive and best-effort: with no LM (e.g. CI) the result is
pure-CAS confidence and description-less terms — the animation still renders.
"""
from __future__ import annotations

import logging

from backend.experts.llm_config import is_configured
from .animation import build
from .term_descriptions import describe_terms

log = logging.getLogger(__name__)


def apply_term_descriptions(data: dict, domain: str, context: str = "") -> dict:
    """Fill ``data['terms'][*]['description']`` via the LM, in place.

    Best-effort: a no-op without an LM, and a failure leaves descriptions blank
    (the hover highlight still works) rather than breaking the build."""
    terms = data.get("terms")
    if terms and is_configured():
        try:
            applied = 0
            for tid, desc in describe_terms(terms, domain, context).items():
                if tid in terms and desc:
                    terms[tid]["description"] = desc
                    applied += 1
            log.debug("proof finalize: described %d/%d terms", applied, len(terms))
        except Exception:
            log.warning("proof finalize: term-description pass failed", exc_info=True)
    return data


def build_described(trajectory, domain: str, title: str = "", *,
                    judge=None, lesson_context: str = "",
                    describe: bool = True, **build_kw) -> dict:
    """``build()`` + optional DOMAIN-tier rescue (via ``judge``) + term descriptions.

    The one place the trajectory→animation finalize lives. ``judge`` and
    ``lesson_context`` enable the rescue; ``describe`` toggles the tooltip pass.
    Extra kwargs (``start_operation``, ``include_prerequisites``, …) pass through
    to ``build()``."""
    data = build(trajectory, domain, title, judge=judge,
                 lesson_context=lesson_context, **build_kw)
    if describe:
        apply_term_descriptions(data, domain, lesson_context)
    return data
