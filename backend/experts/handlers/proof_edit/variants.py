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
from backend.experts.handlers.proof_animation.term_descriptions import describe_terms
from backend.experts.llm_config import is_configured
from backend.experts.modules.proof_completion.outputs import (
    DerivationStep, ProofTrajectory,
)
from backend.experts.modules.proof_completion.step_grounding import (
    TIER_ICON, TIER_LABEL, TIER_MEANING, Tier,
)

from .models import (
    LOG_TAG, VARIANT_GLUE, VARIANT_INSERT, VARIANT_PROPAGATE, VARIANT_RECOVERY,
    VARIANT_SUPERSEDE, EditPayload, NewStep, Variant,
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


def _with_step_source(proof: dict) -> dict:
    """Ensure every step carries ``input_latex`` — the source expr edits rebuild from.

    The whole edit path treats ``input_latex`` as load-bearing: it *is* the
    ``expr_latex`` that produced a step, so a rebuild re-splices the source chain
    (see the module docstring). Proofs built by the derive/animation pipeline
    always set it. But a minimal HAND-AUTHORED seed — e.g. the ``api-demo``
    fixture, whose steps are just ``{index, latex, operation}`` — carries only the
    display ``latex``. Without this, ``proof_to_trajectory`` and
    ``_restore_untouched_steps`` would ``KeyError`` on ``s["input_latex"]``, and
    the handler swallows any non-``EditRefused`` error into a generic "I couldn't
    apply that edit right now" — so a data gap read as a broken feature.

    Falls back to ``plain`` then ``latex``. On such seeds ``latex`` is the clean
    source (they predate the ``\\htmlData`` annotation pass); a fully built proof
    never reaches the fallback because its ``input_latex`` is already present.
    Returns the proof untouched when nothing is missing; otherwise a shallow copy
    with patched step dicts, so the caller's proof is never mutated.
    """
    steps = proof.get("steps") or []
    if all(isinstance(s, dict) and s.get("input_latex") for s in steps):
        return proof
    patched = []
    for s in steps:
        if isinstance(s, dict) and not s.get("input_latex"):
            s = {**s, "input_latex": s.get("plain") or s.get("latex") or ""}
        patched.append(s)
    out = dict(proof)
    out["steps"] = patched
    return out


def _spliced(proof: dict, at: int, new_steps: list[dict],
             delete_count: int) -> dict:
    """A copy of ``proof`` with ``new_steps`` inserted after index ``at``.

    Following steps are carried across verbatim. An earlier version rewrote the
    next step's CAPTION to describe its move under the new predecessor, which
    went wrong in the worst way: asked to substitute `a` with `sin(w)`, the model
    re-captioned the following step "…replacing $a$ with $\\sin(w)$" while its
    math still said `a`. A caption that contradicts the expression beneath it is
    worse than a stale one. The recovery bridge repairs the chain for real
    instead — see ``validate.recovery_bridge``.
    """
    out = deepcopy(proof)
    steps = out.get("steps") or []
    head = steps[:at + 1]
    tail = steps[at + 1 + delete_count:]
    out["steps"] = head + list(new_steps) + tail
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
    """Re-attach per-term prose for terms that already existed in the proof.

    ``build`` emits ``terms`` as ``{id: {latex, name}}`` only — descriptions come
    from ``finalize.build_described``, an LM pass we deliberately do NOT run over
    the whole proof per edit. This restores prose for pre-existing terms for
    free (no LM). Genuinely new symbols are described separately and scoped to
    just the new set — see :func:`_describe_new_terms`.
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
                  computed: Optional[dict] = None) -> dict:
    """Splice + rebuild + merge back. Returns a complete, badged proof.

    ``computed`` is the confidence payload for the FIRST new step when the CAS
    computed it (see :func:`computed_confidence`); the grader's verdict for that
    step is replaced, since it answers a question that does not apply.
    """
    # Normalize once: minimal seed proofs (api-demo) carry only display ``latex``,
    # and everything below reconstructs from ``input_latex``. Both the splice and
    # the untouched-step restore read the ORIGINAL proof, so patch it here.
    proof = _with_step_source(proof)
    spliced = _spliced(proof, at, new_steps, delete_count)
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


def _readability_note(proof: dict, at: int, delete_count: int) -> str:
    """Warn when a following step's caption no longer describes its move.

    Badges alone will not surface this: when two states are genuinely equivalent
    the CAS says so regardless of how the chain READS, so an insert-only variant
    typically stays all-green even though the next caption ("complete the
    square") now describes a move that no longer happens there.

    """
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


def _describe_new_terms(variants: list[Variant], domain: str,
                        context: str) -> None:
    """Fill descriptions for genuinely NEW terms an edit introduces (issue #493).

    ``_restore_term_descriptions`` only re-attaches prose for terms that already
    existed in the original proof; a symbol the edit brings in for the first time
    comes back description-less, because the per-edit path deliberately skips the
    full ``build_described`` LM pass over the whole proof. Here we run a SCOPED
    description pass over ONLY the union of new terms across the variants — never
    the whole proof — so the interactive edit stays cheap (one predict, and only
    when new symbols actually appear).

    Best-effort by construction: with no LM (``is_configured()`` false, e.g. CI)
    or on any failure, ``describe_terms`` returns ``{}`` and the terms keep their
    empty description — the edit still succeeds. The nested variants share the
    same new steps, so a term id describes the same symbol in every variant it
    appears in; one lookup fills them all.
    """
    # Union the new terms across variants — nested variants surface different
    # new-term subsets, and describe_terms costs one predict regardless of size.
    union: dict[str, dict] = {}
    for v in variants:
        for tid, term in v.terms_added.items():
            if not term.get("description"):
                union.setdefault(tid, term)
    if not union or not is_configured():
        return
    described = describe_terms(union, domain, context)
    for v in variants:
        for tid, term in v.terms_added.items():
            desc = described.get(tid)
            if desc and not term.get("description"):
                term["description"] = desc


def to_payload(proof: dict, domain: str, at: int, new_steps: list[dict],
               computed: Optional[dict] = None,
               propagated: Optional[list[dict]] = None,
               is_recovery: bool = False,
               context: str = "") -> Optional[EditPayload]:
    """Build every applicable variant and reduce them to the compact wire form.

    ``new_steps`` is the full ordered list: the user's step first, then any glue.
    The variants are nested selections over it, so the rendered steps are emitted
    once and each variant is a descriptor.

    ``context`` is free-form prose (the derivation / request) used to ground the
    scoped description pass for genuinely new terms — see
    :func:`_describe_new_terms`.

    Returns None when nothing could be built.
    """
    # Normalize once so the diff helpers below compare against the same source
    # ``build_variant`` rebuilds from — otherwise a seed step's missing
    # ``input_latex`` would show up as a spurious change on a step nobody touched.
    proof = _with_step_source(proof)
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
        # `recovery` when the bridge is the deterministic undo, `glue` when it is
        # model-authored — same shape, different (stronger) promise to the reader.
        kinds.append((VARIANT_RECOVERY if is_recovery else VARIANT_GLUE,
                      len(new_steps), 0))

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

    for kind, take, delete_count in kinds:
        rebuilt = build_variant(proof, domain, at, new_steps[:take],
                                delete_count, computed=computed)
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
            readability_note=(_readability_note(proof, at, delete_count)
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
    # Scoped, best-effort description pass for genuinely new terms (issue #493).
    # Pre-existing terms already carry restored prose; this only touches the new
    # set, and degrades to empty descriptions with no LM.
    _describe_new_terms(variants, domain, context)
    log.info("%s %d variant(s) at step %d: %s", LOG_TAG, len(variants), at,
             ", ".join(v.kind for v in variants))
    return EditPayload(new_steps=rendered, variants=variants)
