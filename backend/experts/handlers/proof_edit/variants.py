"""Proof-edit VARIANT construction — deterministic, no LM.

Given a stored proof and a proposed edit (one new step, optional glue steps),
this builds the candidate proofs and reduces them to a compact wire payload.

The load-bearing idea: a stored proof round-trips through
``animation.build`` — each step's ``input_latex`` *is* the ``expr_latex`` that
produced it — so a variant is "splice the step list, then rebuild". ``build`` is
LM-free and regenerates ids, ``\\htmlData`` annotations, terms and confidence for
the whole chain, so there is no partial-chain surgery here and no id splicing.

The three non-discard variants are NESTED (insert ⊂ glue ⊂ supersede's step set),
so the new steps are emitted ONCE and each variant is a small descriptor over
them — see :func:`to_payload`. That sharing is sound because a new step's
rendered fields and confidence depend only on its predecessors, and all three
variants share the same prefix.
"""
from __future__ import annotations

import logging
from copy import deepcopy
from typing import Optional

from backend.experts.handlers.proof_animation.animation import build
from backend.experts.modules.proof_completion.outputs import (
    DerivationStep, ProofTrajectory,
)
from backend.experts.modules.proof_completion.step_grounding import (
    TIER_ICON, TIER_LABEL, TIER_MEANING, Tier,
)

from .models import (
    LOG_TAG, VARIANT_GLUE, VARIANT_INSERT, VARIANT_PROPAGATE, VARIANT_SUPERSEDE,
    EditPayload, NewStep, Variant,
)

log = logging.getLogger(__name__)


# A stored proof's steps do not carry ``change_type`` (it is the model's declared
# claim, consumed at build time and not persisted — see PR-2). Rebuilding needs
# one per step, and a wrong guess is not free: ``_EXPECTED_RELATIONS`` marks a
# mismatch type-inconsistent and downgrades the pair a notch. So instead of
# blanket-defaulting to "rewrite", infer the claim from what the CAS actually
# FOUND last time, recorded in ``confidence.relation``. This picks a label whose
# expected set contains that relation, which cannot introduce a spurious
# inconsistency.
_RELATION_TO_CHANGE_TYPE = {
    "equivalent": "rewrite",
    "narrows": "solve",
    "unknown": "substitute",   # expects {equivalent, unknown} — widest safe set
    "refuted": "rewrite",      # already refuted; the label cannot make it worse
}


def _infer_change_type(step: dict) -> str:
    """Best-effort ``change_type`` for a stored step (see module note)."""
    relation = (step.get("confidence") or {}).get("relation")
    return _RELATION_TO_CHANGE_TYPE.get(relation, "rewrite")


def proof_to_trajectory(proof: dict) -> ProofTrajectory:
    """Reconstruct the trajectory a stored proof was built from.

    ``start_latex`` stays None so step 0 *is* the start state — which is how the
    proof was built, and what makes ``_attach_confidence`` read change_types off
    ``steps[1:]`` (the transitions) rather than off every step.
    """
    steps = []
    for i, s in enumerate(proof.get("steps") or []):
        steps.append(DerivationStep(
            operation=s.get("operation") or "Step",
            expr_latex=s["input_latex"],
            justification=s.get("justification") or "—",
            # Step 0 is the start state, not a transition; its change_type is
            # never read. "given" is the honest label for it.
            change_type="given" if i == 0 else _infer_change_type(s),
        ))
    # Only the chain travels through the trajectory. The framing fields (goal,
    # followups, prerequisites, deeplink) are copied across verbatim in
    # ``build_variant`` instead: a stored ``prerequisites`` entry may be a
    # ``{text, deeplink}`` chip, which ``ProofTrajectory``'s ``List[str]`` would
    # reject outright, and none of them affect the rebuild anyway.
    return ProofTrajectory(steps=steps, title=proof.get("title"))


def _spliced(proof: dict, at: int, new_steps: list[dict], delete_count: int,
             next_caption: Optional[tuple[str, str]] = None) -> dict:
    """A copy of ``proof`` with ``new_steps`` inserted after index ``at``.

    ``next_caption`` re-labels the step that now follows the insertion. Inserting
    a step changes what the next step's move IS — after "multiply both sides by
    2", a step captioned "expand $(b/2a)^2$" is really "divide by 2 and expand" —
    so leaving the stored caption in place displays a description that no longer
    matches the transition it labels. Prose only; the math is untouched, and the
    caption plays no part in CAS grading.
    """
    out = deepcopy(proof)
    steps = out.get("steps") or []
    head = steps[:at + 1]
    tail = steps[at + 1 + delete_count:]
    out["steps"] = head + list(new_steps) + tail
    if next_caption and tail:
        operation, justification = next_caption
        follower = out["steps"][at + 1 + len(new_steps)]
        if operation:
            follower["operation"] = operation
        if justification:
            follower["justification"] = justification
    return out


# Fields restored wholesale on a step whose transition did not change. Note this
# includes the RENDERED fields, not just the verdict — see the docstring.
_PRESERVED_FIELDS = ("latex", "plain", "confidence")


def _restore_untouched_steps(rebuilt: dict, original: dict) -> None:
    """Put back the original render + verdict for steps whose transition is unchanged.

    A step is "untouched" when BOTH its own ``input_latex`` and its predecessor's
    are byte-identical to before — i.e. nothing about the transition that produced
    it moved. For those, the rebuild has nothing to add and two ways to do harm:

    * **Verdict.** Edits run ``build`` with ``judge=None`` (the domain-rescue LM
      pass is far too slow for an interactive edit), so a previously rescued step
      would come back GRAY and read as "your edit broke this".
    * **Render.** Any defect in the parse→render round trip becomes a silent
      corruption of a step the user never touched. That is not hypothetical: this
      guard is what surfaced ``latex_to_graph`` dropping a repeated operand, so
      ``a \\cdot a`` re-rendered as ``a`` (since fixed in ``_dedupe_edges``, with
      a regression test in ``tests/backend/semantic_graph/test_repeated_operands.py``).
      Keeping the restore means the next such bug degrades to "the edit didn't
      help" rather than "the edit quietly broke an unrelated step".

    Restoring is narrow and cannot mask a real change: any step whose own or whose
    predecessor's expression actually moved keeps the freshly computed values. It
    also makes the wire patch minimal *by construction* rather than by relying on
    node ids happening to stay stable across a rebase.
    """
    orig_steps = original.get("steps") or []
    by_transition = {}
    for i, s in enumerate(orig_steps):
        prev = orig_steps[i - 1]["input_latex"] if i else None
        by_transition[(prev, s["input_latex"])] = s

    new_steps = rebuilt.get("steps") or []
    for i, s in enumerate(new_steps):
        prev = new_steps[i - 1]["input_latex"] if i else None
        keep = by_transition.get((prev, s["input_latex"]))
        if keep is None:
            continue
        for f in _PRESERVED_FIELDS:
            if keep.get(f) is not None:
                s[f] = deepcopy(keep[f])


def _restore_term_descriptions(rebuilt: dict, original: dict) -> None:
    """Re-attach per-term prose.

    ``build`` emits ``terms`` as ``{id: {latex, name}}`` only — descriptions come
    from ``finalize.build_described``, an LM pass we deliberately do NOT run per
    edit. Descriptions for genuinely new symbols are left empty (PR-2).
    """
    orig_terms = original.get("terms") or {}
    for tid, term in (rebuilt.get("terms") or {}).items():
        desc = (orig_terms.get(tid) or {}).get("description")
        if desc and not term.get("description"):
            term["description"] = desc


def computed_confidence(reason: str) -> dict:
    """The verdict for a step sympy COMPUTED rather than merely checked.

    ``ground_steps`` asks whether the solution set is preserved. For a computed
    step that is the wrong question — differentiating both sides is supposed to
    change the solution set, and grading it returns ``refuted`` for perfectly
    correct math. What we can state instead is stronger than any grading: the CAS
    performed this operation on the previous step, so the result is right by
    construction. GOLD is the honest tier for that — symbolically established,
    label consistent.
    """
    return {
        "tier": Tier.GOLD.value,
        "label": TIER_LABEL[Tier.GOLD],
        "icon": TIER_ICON[Tier.GOLD],
        "meaning": TIER_MEANING[Tier.GOLD],
        "relation": "computed",
        "reason": reason,
        "type_consistent": True,
    }


def build_variant(proof: dict, domain: str, at: int, new_steps: list[dict],
                  delete_count: int = 0,
                  next_caption: Optional[tuple[str, str]] = None,
                  computed: Optional[dict] = None) -> dict:
    """Splice + rebuild + merge back. Returns a complete, badged proof.

    ``computed`` is the confidence payload for the FIRST new step when the CAS
    computed it (see :func:`computed_confidence`); the grader's verdict for that
    step is replaced, since it answers a question that does not apply.
    """
    spliced = _spliced(proof, at, new_steps, delete_count, next_caption)
    rebuilt = build(
        proof_to_trajectory(spliced),
        domain,
        proof.get("title") or "",
        judge=None,            # no domain-rescue LM pass on the edit path
    )
    # Framing travels across untouched — an edit changes the math, not the
    # proof's title, goal, prerequisites or follow-up chips.
    for field in ("deeplink", "goal", "followups", "prerequisites"):
        if proof.get(field):
            rebuilt[field] = deepcopy(proof[field])
    _restore_term_descriptions(rebuilt, proof)
    _restore_untouched_steps(rebuilt, proof)
    if computed and new_steps:
        steps = rebuilt.get("steps") or []
        if at + 1 < len(steps):
            steps[at + 1]["confidence"] = deepcopy(computed)
    return rebuilt


# --------------------------------------------------------------------------- #
# compact wire payload
# --------------------------------------------------------------------------- #

# Step fields the client needs to render an inserted step. ``index`` is excluded
# on purpose — the client renumbers after splicing.
_STEP_FIELDS = ("operation", "justification", "input_latex", "latex", "plain",
                "confidence")


def _step_updates(rebuilt: dict, original: dict, at: int,
                  take: int, delete_count: int) -> dict:
    """Fields that changed on steps the client already has.

    Diffed rather than hand-authored: ``build`` re-runs the id rebase across the
    whole chain, so a downstream step's ``latex`` annotations *may* shift even
    when its math did not. A diff is small when they stay stable and correct when
    they do not, so nothing here depends on that being true.
    """
    orig_steps = original.get("steps") or []
    new_steps = rebuilt.get("steps") or []
    updates: dict[str, dict] = {}

    for orig_i, orig in enumerate(orig_steps):
        if at < orig_i <= at + delete_count:
            continue                                  # dropped by supersede
        new_i = orig_i if orig_i <= at else orig_i + take - delete_count
        if new_i >= len(new_steps):
            continue
        changed = {f: new_steps[new_i][f] for f in _STEP_FIELDS
                   if new_steps[new_i].get(f) != orig.get(f)}
        if changed:
            updates[str(orig_i)] = changed
    return updates


def _readability_note(proof: dict, at: int, delete_count: int,
                      recaptioned: bool) -> str:
    """Warn when a following step's caption no longer describes its move.

    Badges alone will not surface this: when two states are genuinely equivalent
    the CAS says so regardless of how the chain READS, so an insert-only variant
    typically stays all-green even though the next caption ("complete the
    square") now describes a move that no longer happens there.

    Silent once the caption has actually been rewritten — at that point there is
    nothing left to warn about, and a warning next to corrected text would just
    undermine it.
    """
    if recaptioned:
        return ""
    steps = proof.get("steps") or []
    nxt = at + 1 + delete_count
    if nxt >= len(steps):
        return ""
    caption = (steps[nxt].get("operation") or "").strip()
    return (f"step {nxt}'s caption (“{caption}”) may no longer "
            f"describe its move") if caption else ""


def _badge_delta(rebuilt: dict, original: dict, at: int, take: int,
                 delete_count: int) -> str:
    """Human-readable summary of tier changes on pre-existing steps."""
    orig_steps = original.get("steps") or []
    new_steps = rebuilt.get("steps") or []
    parts = []
    for orig_i, orig in enumerate(orig_steps):
        if at < orig_i <= at + delete_count:
            continue
        new_i = orig_i if orig_i <= at else orig_i + take - delete_count
        if new_i >= len(new_steps):
            continue
        was = (orig.get("confidence") or {}).get("label")
        now = (new_steps[new_i].get("confidence") or {}).get("label")
        if was and now and was != now:
            parts.append(f"step {orig_i}: {was} → {now}")
    return " · ".join(parts)


def to_payload(proof: dict, domain: str, at: int, new_steps: list[dict],
               next_caption: Optional[tuple[str, str]] = None,
               computed: Optional[dict] = None,
               propagated: Optional[list[dict]] = None) -> Optional[EditPayload]:
    """Build every applicable variant and reduce them to the compact wire form.

    ``new_steps`` is the full ordered list: the user's step first, then any glue.
    The variants are nested selections over it, so the rendered steps are emitted
    once and each variant is a descriptor.

    Returns None when nothing could be built.
    """
    n_steps = len(proof.get("steps") or [])
    tail_len = max(0, n_steps - (at + 1))

    # `(kind, take, delete_count)` — `take` is a PREFIX of new_steps, which is
    # what lets every variant share one rendered list.
    kinds: list[tuple[str, int, int]] = [(VARIANT_INSERT, 1, 0)]

    if propagated is not None and tail_len:
        # Propagation and glue are alternatives, never both: when the operation
        # is global, bridging back to a step that itself needs rewriting is not
        # a repair. Appending the rewritten tail keeps `take` a prefix, so no
        # new wire shape is needed — the variant simply takes all of new_steps
        # and drops the originals it replaces.
        new_steps = list(new_steps[:1]) + list(propagated)
        kinds.append((VARIANT_PROPAGATE, len(new_steps), tail_len))
    elif len(new_steps) > 1:
        kinds.append((VARIANT_GLUE, len(new_steps), 0))

    if tail_len:
        # "End the proof here." Unconditional whenever anything follows, and
        # deterministic: it used to depend on the model guessing how many steps
        # its edit made redundant, which nothing could verify — a wrong count
        # silently shortened someone's proof by an arbitrary amount. Dropping
        # ALL of them is at least exactly what it says.
        #
        # ``take=1`` on purpose: only the user's own step survives. Glue bridges
        # to steps that are being deleted, and the propagated tail IS the tail
        # being deleted — including either here would contradict the variant.
        kinds.append((VARIANT_SUPERSEDE, 1, tail_len))

    rendered: list[NewStep] = []
    variants: list[Variant] = []

    # Only the insert-only variant needs a re-caption. The glue variant exists
    # precisely to reconnect the original next step, so its caption is valid
    # again; supersede drops the steps the edit displaced.
    has_follower = at + 1 < n_steps
    recaption = next_caption if (next_caption and any(next_caption)
                                 and has_follower) else None

    for kind, take, delete_count in kinds:
        caption = recaption if kind == VARIANT_INSERT else None
        rebuilt = build_variant(proof, domain, at, new_steps[:take], delete_count,
                                next_caption=caption, computed=computed)
        built = (rebuilt.get("steps") or [])[at + 1: at + 1 + take]
        if len(built) != take:
            log.warning("%s variant %s dropped: rebuild produced %d of %d steps",
                        LOG_TAG, kind, len(built), take)
            continue

        # The nested-variant sharing assumption: every variant renders the new
        # steps identically, because they depend only on the shared prefix. The
        # widest variant therefore defines them for all.
        if take > len(rendered):
            rendered = [NewStep(**{f: s.get(f) for f in _STEP_FIELDS if s.get(f) is not None})
                        for s in built]

        updates = _step_updates(rebuilt, proof, at, take, delete_count)
        variants.append(Variant(
            kind=kind,
            at=at,
            take=take,
            delete_count=delete_count,
            step_updates=updates,
            terms_added={k: v for k, v in (rebuilt.get("terms") or {}).items()
                         if k not in (proof.get("terms") or {})},
            overall_confidence=rebuilt.get("overall_confidence"),
            badge_delta=_badge_delta(rebuilt, proof, at, take, delete_count),
            readability_note=(_readability_note(proof, at, delete_count,
                                                recaptioned=bool(caption))
                              if kind == VARIANT_INSERT else ""),
        ))
        # `step_updates` should stay tiny — it is the one part that scales with
        # the proof rather than the edit, so a wide one means the chain-wide id
        # rebase shifted steps whose math never moved. Worth seeing in the log.
        log.debug("%s built %s: +%d step(s) -%d, %d step update(s)%s",
                  LOG_TAG, kind, take, delete_count, len(updates),
                  f" [{sorted(updates)}]" if len(updates) > 1 else "")

    if not variants:
        log.warning("%s no variant survived construction at step %d", LOG_TAG, at)
        return None
    log.info("%s %d variant(s) at step %d: %s", LOG_TAG, len(variants), at,
             ", ".join(v.kind for v in variants))
    return EditPayload(new_steps=rendered, variants=variants)
