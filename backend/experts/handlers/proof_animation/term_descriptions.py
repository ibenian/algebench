"""LM-described terms for a derivation (one concise line per symbol).

The proof animation tags every glyph with a stable node id. A learner hovering a
term wants to know what that symbol MEANS — but the on-screen scene graph only
covers the symbols that survive into its state; a symbol introduced only in an
intermediate step (a transient substitution, a derivative's operand) has no node
there to borrow a description from. So we generate the descriptions HERE, at
proof-production time, keyed by the SAME ids the annotated LaTeX uses, and ship
them in the response (``data.terms``). The frontend reads them directly — no
fragile latex-appearance matching against the scene graph.

Best-effort and isolated: one extra predict per derivation; any failure just
leaves the terms description-less (the frontend falls back to the scene node).
"""

from __future__ import annotations

import logging
from functools import cache

import dspy
from pydantic import BaseModel, ConfigDict, Field

from backend.experts.llm_config import make_adapter

log = logging.getLogger(__name__)

# Retries for a transient empty/malformed description pass (see describe_terms).
_ATTEMPTS = 3


@cache
def _predictor(signature):
    # Built lazily on first use (after configure_dspy), like prompt_endpoints.
    return dspy.Predict(signature)


class TermDescription(BaseModel):
    """One term's description, keyed by the id it was given.

    A model rather than a ``dict`` so the field is expressible in the line
    format: a ``list[dict]`` output is handed to ``json_repair``, and these
    descriptions may contain inline ``$…$`` LaTeX (#543). The per-field
    ``description``s are prompt surface — ``LineAdapter`` renders each key with
    its description as the block template the model fills in.
    """

    model_config = ConfigDict(extra="ignore")

    id: str = Field(
        default="", max_length=120,
        description="the given id, verbatim — never invent one")
    description: str = Field(
        default="", max_length=400,
        description="ONE sentence saying what this term denotes in THIS "
                    "derivation; inline $…$ is allowed")


class TermDescriptionsSig(dspy.Signature):
    r"""Describe each symbol that appears in a derivation, IN CONTEXT.

    You are given a derivation's domain, some free-form context (lesson / scene /
    proof prose, possibly empty), and a list of terms — each with a stable ``id``
    and its LaTeX. A term is usually a single symbol (``v``, ``\rho``) but may be a
    small sub-expression (``V^{2}``, ``\frac{d}{dt}V``). Write a SHORT one-sentence
    description of what each term denotes in THIS derivation: the physical quantity
    or mathematical object it stands for (and its role), not how to read the glyph.
    Use the context to disambiguate (e.g. ``v`` is a velocity in a kinematics proof).

    Return one ``descriptions`` entry per given term. Describe EVERY id; keep each
    to one concise sentence; inline ``$…$`` LaTeX is allowed; do NOT invent ids
    that were not provided.
    """

    domain: str = dspy.InputField(desc="math/physics domain, e.g. classical_mechanics")
    context: str = dspy.InputField(desc="lesson/scene/proof context prose (may be empty)")
    terms: str = dspy.InputField(
        desc="the symbols to describe, one `id: latex` per line")
    descriptions: list[TermDescription] = dspy.OutputField(
        desc="one entry per given id, in the order the terms were listed")


def describe_terms(terms: dict, domain: str, context: str) -> dict:
    """One-sentence description per symbol id. ``terms`` is ``{id: {latex, name}}``
    (as collected by ``animation.build``). Returns ``{id: description}`` for the
    ids the LM described; ``{}`` on empty input or any failure (caller-isolated).
    DSPy's adapter handles (de)serializing the typed list/dict fields.
    """
    items = [(tid, str(t.get("latex") or t.get("name") or ""))
             for tid, t in (terms or {}).items()]
    if not items:
        return {}
    # One `id: latex` per line — the same dialect the output comes back in, so
    # the prompt does not ask for lines while showing JSON.
    listing = "\n".join(f"{tid}: {latex}" for tid, latex in items)
    # The LM (or DSPy's typed-dict parse) occasionally comes back empty/malformed,
    # which would blank EVERY tooltip for the derivation. Retry a couple of times;
    # the structured output usually parses on the next attempt.
    for attempt in range(_ATTEMPTS):
        try:
            # LineAdapter via ``dspy.context``: the descriptions carry inline
            # ``$…$`` LaTeX in a ``list[BaseModel]`` field, which ChatAdapter
            # would hand to ``json_repair`` — where ``\r \n \t \f \b`` are valid
            # escapes as well as LaTeX command prefixes (#543).
            with dspy.context(adapter=make_adapter(line_oriented=True)):
                out = _predictor(TermDescriptionsSig)(
                    domain=(domain or "").strip(),
                    context=(context or "").strip(),
                    terms=listing,
                )
            result = {}
            for item in (out.descriptions or []):
                if isinstance(item, TermDescription):
                    tid, d = item.id.strip(), item.description.strip()
                    if tid and d:
                        result[tid] = d
            if result:
                return result
            log.warning("describe_terms: empty/malformed output (attempt %d/%d)",
                        attempt + 1, _ATTEMPTS)
        except Exception:
            log.warning("describe_terms: failed for %d terms (attempt %d/%d)",
                        len(items), attempt + 1, _ATTEMPTS, exc_info=True)
    return {}
