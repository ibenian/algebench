"""CAS adjudication of a proposed edit — the model proposes, sympy disposes.

The refine loop here is what makes "mathematically accurate by verification"
real: a proposal is built into a candidate chain, the CAS grades the transitions
the edit actually changed, and anything it *refutes* is sent back to the model
with the objection attached. After a bounded number of retries the edit either
produced something the CAS did not refute, or it is refused outright.

Two verdicts matter here, and conflating them would be a serious bug:

* ``refuted`` — the CAS *computed the step and it is wrong*. Disqualifying. Such
  a candidate is never offered; showing one would hand the user a known-wrong
  proof, the exact state this feature exists to prevent.
* ``unknown`` — the CAS could not establish equivalence OR a valid narrowing.

``unknown`` is NOT harmless, and it is much more common than ``refuted``.
Measured against a real proof, inserting ``x = x + 1``, ``1 = 2``, ``x^2 = -1``
or ``\\sin(x) = 5`` all return ``unknown``/``plausible`` — never ``refuted``,
because the CAS will not positively disprove two unrelated equations. So a gate
that only rejects ``refuted`` never fires, and nonsense reaches the user wearing
a reassuring "Plausible" badge.

Hence: ``unknown`` is treated as an objection *for retry purposes* — the model
gets told the CAS could not connect its step and is given another go at
something checkable. But it is not grounds for outright refusal, because
legitimate moves the CAS genuinely cannot decide (differentiating both sides,
introducing a substitution) also land here. If it survives to the end still
unconfirmed, the candidate is offered WITH AN EXPLICIT CAVEAT in words, not left
to a badge the user may not read.
"""
from __future__ import annotations

import logging
from typing import Optional

import sympy as sp

from . import ops
from .intent import ProofEditProposal, propose_edit
from .models import LOG_TAG, EditPayload
from .variants import build_variant, computed_confidence, to_payload

log = logging.getLogger(__name__)

# ``Tier.RED`` / ``Tier.BLUE`` wire values. See the module docstring for why
# these two are handled differently.
_REFUTED = "refuted"
_UNCONFIRMED_RELATIONS = {"unknown", None}

# Attempts at the user's own step, including the first. Bounded because a model
# that has been told twice why the CAS disagrees is not going to find it on the
# third try, and the user is waiting.
MAX_ATTEMPTS = 3


class EditRefused(Exception):
    """No candidate survived verification. Carries the CAS's own words."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _changed_slice(candidate: dict, at: int, take: int) -> list[dict]:
    """The steps whose incoming transition the edit changed.

    That is the inserted steps themselves, plus the one immediately after them —
    its predecessor moved, so its verdict is newly earned even though its own
    expression did not change.
    """
    steps = candidate.get("steps") or []
    return steps[at + 1: at + take + 2]


class Verdict:
    """What the CAS made of a candidate's changed transitions."""

    def __init__(self, refuted: list[str], unconfirmed: list[str]):
        self.refuted = refuted
        self.unconfirmed = unconfirmed

    @property
    def objections(self) -> list[str]:
        """Everything worth sending back to the model on a retry."""
        return self.refuted + self.unconfirmed

    @property
    def clean(self) -> bool:
        return not self.refuted and not self.unconfirmed


def _judge(candidate: dict, at: int, take: int) -> Verdict:
    """Split the CAS's verdicts on the changed transitions, in its own words."""
    refuted, unconfirmed = [], []
    for s in _changed_slice(candidate, at, take):
        conf = s.get("confidence") or {}
        expr = s.get("plain") or s.get("input_latex") or "?"
        reason = conf.get("reason") or "could not be connected to the previous step"
        line = f"${expr}$ — {reason}"
        if conf.get("tier") == _REFUTED:
            refuted.append(line)
        elif conf.get("relation") in _UNCONFIRMED_RELATIONS:
            unconfirmed.append(line)
    return Verdict(refuted, unconfirmed)


def verify_candidate(proof: dict, domain: str, at: int,
                     new_steps: list[dict]) -> Verdict:
    """Build the candidate and judge the transitions the edit changed."""
    candidate = build_variant(proof, domain, at, new_steps, delete_count=0)
    return _judge(candidate, at, len(new_steps))


def _as_step_dicts(proposal: ProofEditProposal) -> list[dict]:
    return [{"operation": s.operation or "Step",
             "justification": s.justification or "—",
             "input_latex": s.expr_latex}
            for s in proposal.steps]


def _to_sympy(latex: str, domain: str):
    """Parse reader-facing LaTeX into sympy, via the same path everything uses."""
    if not latex:
        return None
    from backend.experts.modules.proof_completion.grounding import graph_to_sympy
    from backend.semantic_graph.service import SemanticGraphService

    try:
        graph = SemanticGraphService().latex_to_graph(latex, domain=domain)
    except Exception:
        return None
    return graph_to_sympy(graph) if graph is not None else None


def compute_step(proof: dict, domain: str, at: int,
                 proposal: ProofEditProposal) -> Optional[dict]:
    """Have the CAS PERFORM the operation, when the request maps onto one.

    Returns a step dict whose ``input_latex`` the CAS produced — correct by
    construction rather than by a grading pass that, for anything changing the
    solution set, cannot say yes. Returns None when the request does not map, or
    when anything needed could not be parsed; the caller then falls back to the
    model-authored + graded path.

    Raises :class:`EditRefused` when the operation maps but is INVALID on this
    step (dividing by something that may be zero, "both sides" of a non-equation)
    — that is a real answer, not a reason to fall back and try it a worse way.
    """
    if proposal.op not in ops.SUPPORTED_OPS:
        return None

    steps = proof.get("steps") or []
    if not 0 <= at < len(steps):
        return None
    expr = _to_sympy(steps[at].get("input_latex") or "", domain)
    if expr is None:
        return None

    kwargs: dict = {}
    if proposal.op in ops.NEEDS_OPERAND:
        operand = _to_sympy(proposal.operand_latex, domain)
        if operand is None:
            return None
        kwargs["operand"] = operand
        if proposal.op == ops.OP_SUBSTITUTE:
            replacement = _to_sympy(proposal.replacement_latex, domain)
            if replacement is None:
                return None
            kwargs["replacement"] = replacement
    if proposal.op in ops.NEEDS_VARIABLE:
        name = (proposal.variable or "").strip()
        if not name:
            return None
        kwargs["variable"] = sp.Symbol(name)

    try:
        result = ops.apply_op(expr, proposal.op, **kwargs)
    except ops.OpRefused as e:
        raise EditRefused(str(e)) from e

    # ``mul_symbol="dot"`` matches graph_to_latex: a symbol directly before "("
    # would otherwise re-parse as a function call.
    latex = sp.latex(result, mul_symbol="dot")
    authored = proposal.steps[0] if proposal.steps else None
    log.info("%s computed %s via CAS: %s", LOG_TAG, proposal.op, latex)
    return {
        "operation": (authored.operation if authored else proposal.op.replace("_", " ")),
        "justification": (authored.justification if authored else
                          "applied by the computer algebra system"),
        "input_latex": latex,
    }


def resolve(proof: dict, domain: str, at: int, proposal: ProofEditProposal,
            *, derivation: str, current_step: str, request: str,
            recent_thread: str = "", clarifications: str = "") -> EditPayload:
    """Verify a proposal, retrying on refutation; return the compact payload.

    Only the USER'S OWN step is retried. It is the part they asked for and the
    part that must be right; glue is a convenience, and if the CAS refutes a glue
    step we simply drop the glue rather than spending more attempts on it.

    Raises :class:`EditRefused` if the user's step cannot be made to survive.
    """
    # Preferred path: the CAS performs the operation itself. Correct by
    # construction, so there is nothing to retry and nothing for the grader to
    # be inconclusive about — this is what makes "differentiate both sides"
    # possible at all (grading it returns `refuted` for correct math).
    computed = compute_step(proof, domain, at, proposal)
    if computed is not None:
        steps = [computed] + _as_step_dicts(proposal)[1:]
        payload = to_payload(
            proof, domain, at, steps,
            supersede_count=proposal.supersede_count,
            next_caption=(proposal.next_operation, proposal.next_justification),
            computed=computed_confidence(
                f"the CAS applied “{proposal.op.replace('_', ' ')}” to the "
                f"previous step directly"),
        )
        if payload is None:
            raise EditRefused("I couldn't build a consistent proof from that step.")
        payload.summary = proposal.summary
        return payload

    steps = _as_step_dicts(proposal)
    if not steps:
        raise EditRefused("I couldn't turn that into a concrete step.")

    verdict = verify_candidate(proof, domain, at, steps[:1])
    attempts = 1
    while not verdict.clean and attempts < MAX_ATTEMPTS:
        log.info("%s attempt %d/%d rejected at step %d (%d refuted, %d unconfirmed) — retrying",
                 LOG_TAG, attempts, MAX_ATTEMPTS, at,
                 len(verdict.refuted), len(verdict.unconfirmed))
        retry = propose_edit(
            derivation, current_step, request,
            recent_thread=recent_thread,
            clarifications=clarifications,
            feedback="\n".join(verdict.objections),
        )
        retry_steps = _as_step_dicts(retry)
        if not retry_steps:
            log.debug("%s retry produced no step; keeping the previous verdict", LOG_TAG)
            break
        candidate = verify_candidate(proof, domain, at, retry_steps[:1])
        # Only adopt the retry if it is genuinely no worse — otherwise a second
        # attempt could trade a merely-unconfirmed step for a refuted one.
        if candidate.refuted and not verdict.refuted:
            log.debug("%s discarding retry: it is refuted, the previous was not", LOG_TAG)
            break
        steps, proposal, verdict = retry_steps, retry, candidate
        attempts += 1

    if verdict.refuted:
        log.info("%s REFUSED at step %d after %d attempt(s): %s",
                 LOG_TAG, at, attempts, "; ".join(verdict.refuted))
        raise EditRefused(
            "The computer algebra system rejected that step: "
            + "; ".join(verdict.refuted))

    # The user's step stands. Glue is a convenience — if the bridge does not hold
    # up, keep the verified step and drop the bridge rather than refusing.
    if len(steps) > 1 and not verify_candidate(proof, domain, at, steps).clean:
        log.info("%s dropping %d glue step(s): the bridge did not verify",
                 LOG_TAG, len(steps) - 1)
        steps = steps[:1]

    payload = to_payload(proof, domain, at, steps,
                         supersede_count=proposal.supersede_count,
                         next_caption=(proposal.next_operation,
                                       proposal.next_justification))
    if payload is None:
        raise EditRefused("I couldn't build a consistent proof from that step.")
    payload.summary = proposal.summary
    # Survived without being disproved, but the CAS could not confirm it either.
    # Say so in words — a "Plausible" badge alone reads as mild approval, and the
    # CAS returns exactly that for an outright nonsense step.
    if verdict.unconfirmed:
        log.info("%s UNCONFIRMED at step %d after %d attempt(s) — offering with a caveat",
                 LOG_TAG, at, attempts)
        payload.caveat = (
            "The CAS could not confirm this step follows from the previous one — "
            "check it yourself before keeping it.")
    return payload


__all__ = ["EditRefused", "MAX_ATTEMPTS", "resolve", "verify_candidate"]
