#!/usr/bin/env python3
"""Full offline re-grade of stored proofs — with the guard rails issue #542 asks for.

Stored proofs carry the verdicts they were baked with, and the API serves those
straight to the client, so a grading-rule change does NOT reach the reader until
the files are re-baked. The obvious way to re-bake — rebuild the chain from
``input_latex`` and re-run ``ground_steps`` — used to be a data-corruption trap:

* the model's ``change_type`` was not persisted, so every pair came back
  ``type_consistent=True`` and every mislabel downgrade silently vanished, and
* ``domain``-tier steps came from an LM judge that an offline run doesn't have,
  so they quietly fell back to the CAS tier.

Both inputs are persisted now (``step.change_type``, ``confidence.judged``), and
this tool refuses to guess where they are missing:

* **judged step** (``confidence.judged``, or a legacy ``domain`` tier) — preserved
  verbatim. No judge here, so its tier is not ours to recompute.
* **claim missing** on a step whose stored verdict is a MISLABEL (its reason
  carries the ``declared '…'`` clause) — preserved verbatim and reported. The
  downgrade that produced that tier cannot be reproduced without the claim.
* **claim missing** but the stored verdict is consistent — re-graded, and counted
  in the "claim unknown" tally: the CAS part is honest, the consistency check is
  inherited, not verified.
* **claim present** — re-graded outright; this is the faithful path.

``counts`` / ``overall`` are re-rolled from the resulting mix through the same
``finalize_overall`` the live build uses. ``endpoint_reached`` is preserved: the
target expression is not stored, so it cannot be re-checked.

Usage:
    ./run.sh scripts/regrade_proofs.py proofs/domains/*/*.json [--check]
    ./run.sh scripts/regrade_proofs.py proofs/domains/*/*.json --backfill-claims

``--check`` reports what would change and exits non-zero without writing.
``--backfill-claims`` recovers the declared ``change_type`` of MISLABELED steps
from their stored reason text (``… — but the step was declared 'rewrite'``) and
writes it to ``step.change_type``. That is the only claim a pre-#542 file still
carries; consistent steps lost theirs for good and stay claim-less.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# "… — but the step was declared 'rewrite'" — the suffix classify_pair appends
# to a mislabeled pair's reason, and the one place a pre-#542 file still records
# what the model claimed.
_DECLARED_RE = re.compile(r"but the step was declared '([^']+)'")


def _dump(data) -> str:
    """Serialize in the format these files are already stored in (see #540)."""
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def _proofs(data):
    """A file holds either one proof or a list of them (the animation fixtures)."""
    return data if isinstance(data, list) else [data]


def _declared_claim(conf: dict):
    """The claim a MISLABEL downgrade was measured against, if the reason kept it.

    This — not ``type_consistent`` — is the fingerprint of a downgrade: an
    unconvertible state also reports ``type_consistent: false`` while its GRAY
    tier owes nothing to any claim, and re-grading it is safe.
    """
    m = _DECLARED_RE.search(conf.get("reason") or "")
    return m.group(1) if m else None


def _is_judged(conf: dict) -> bool:
    """Did this tier come from the LM domain judge rather than the CAS?

    ``judged`` is the explicit marker (#542). A pre-#542 file has none, so fall
    back to the tier itself: ``domain`` is only ever reachable through
    ``rescue_uncheckable``.
    """
    from backend.experts.modules.proof_completion.step_grounding import Tier
    return bool(conf.get("judged")) or conf.get("tier") == Tier.DOMAIN.value


def backfill_claims(proof, log) -> bool:
    """Recover mislabeled steps' declared ``change_type`` from their reason text."""
    changed = False
    for step in proof.get("steps", []):
        if step.get("change_type"):
            continue
        claim = _declared_claim(step.get("confidence") or {})
        if not claim:
            continue                      # a consistent step's claim is unrecoverable
        step["change_type"] = claim
        log.append(f"  step {step.get('index')}: change_type <- {claim!r}")
        changed = True
    return changed


def _state_exprs(proof, domain):
    """Rebuild each state's sympy expression from its stored ``input_latex``.

    Mirrors ``animation.build`` exactly, INCLUDING its placeholder gate: a state
    holding ``\\dots`` or a ``\\pm`` pseudo-symbol renders and animates but is not
    real math, so the live build never converts it and grades it ``unchecked``.
    Converting it here instead would hand sympy a mangled expression and re-bake
    a confident-looking verdict on top of it — the exact silent corruption this
    tool exists to prevent.
    """
    from backend.semantic_graph.service import SemanticGraphService
    from backend.experts.modules.proof_completion.grounding import graph_to_sympy
    from backend.experts.modules.proof_completion.metric import PLACEHOLDER_TOKENS
    from backend.experts.modules.proof_completion.step_grounding import _guard
    svc = SemanticGraphService()
    out = []
    for step in proof.get("steps", []):
        latex = step.get("input_latex") or step.get("plain") or ""
        try:
            graph = svc.latex_to_graph(latex, domain=domain)
        except Exception:
            graph = None
        if graph is None or any(tok in latex for tok in PLACEHOLDER_TOKENS):
            out.append(None)
            continue
        out.append(_guard(graph_to_sympy, graph, default=None))
    return out


def regrade(proof, domain, log) -> bool:
    """Re-grade one proof in place. True if anything changed."""
    from backend.experts.modules.proof_completion.step_grounding import (
        PairVerdict, StepConfidence, Tier, TIER_ICON, TIER_LABEL, TIER_MEANING,
        _count_tiers, _overall_reason, finalize_overall, ground_steps,
    )
    steps = proof.get("steps") or []
    if not steps:
        return False

    # Per-TRANSITION claims: the claim on state i is the one for the transition
    # that reaches it, so transitions line up with steps[1:].
    claims = [s.get("change_type") for s in steps[1:]]
    report = ground_steps(_state_exprs(proof, domain), change_types=claims,
                          domain=domain,
                          # Every claim we have is passed above; the Nones that
                          # remain are handled per step below, not by assumption.
                          allow_missing_change_types=True)

    changed = False
    final_steps: list = []
    final_pairs: list = []
    unknown_claims = 0
    for i, step in enumerate(steps):
        stored = step.get("confidence") or {}
        fresh = report.steps[i] if i < len(report.steps) else None
        preserved = None
        if _is_judged(stored):
            preserved = "judged — no judge offline"
        elif i and not step.get("change_type") and _declared_claim(stored):
            preserved = "mislabel downgrade, claim not stored"
        if preserved is not None or fresh is None:
            if preserved:
                log.append(f"  step {i}: kept as baked ({preserved})")
            try:
                tier = Tier(stored.get("tier"))
            except ValueError:
                tier = Tier.GRAY            # unreadable stored tier: say "unchecked"
            final_steps.append(StepConfidence(
                i, tier, stored.get("relation"), stored.get("reason", ""),
                bool(stored.get("type_consistent", True)),
                judged=bool(stored.get("judged"))))
        else:
            if i and not step.get("change_type"):
                unknown_claims += 1      # re-graded, but its claim is inherited
            if fresh.tier.value != stored.get("tier"):
                log.append(f"  step {i}: {stored.get('tier')} -> {fresh.tier.value}")
                changed = True
            elif fresh.reason != stored.get("reason") or \
                    fresh.relation != stored.get("relation"):
                log.append(f"  step {i}: verdict detail re-rolled ({fresh.tier.value})")
                changed = True
            step["confidence"] = {
                "tier": fresh.tier.value,
                "label": TIER_LABEL[fresh.tier],
                "icon": TIER_ICON[fresh.tier],
                "meaning": TIER_MEANING[fresh.tier],
                "relation": fresh.relation,
                "reason": fresh.reason,
                "type_consistent": fresh.type_consistent,
            }
            final_steps.append(fresh)
        if i:
            sc = final_steps[i]
            final_pairs.append(PairVerdict(
                i, sc.tier, sc.relation or "unknown", "none",
                step.get("change_type"), sc.type_consistent, sc.reason,
                judged=sc.judged))

    if unknown_claims:
        log.append(f"  ⚠ {unknown_claims} step(s) re-graded with NO stored claim — "
                   f"their type_consistent is inherited, not verified")

    overall = proof.get("overall_confidence")
    if isinstance(overall, dict):
        # The target expression is not stored, so the endpoint gate is inherited.
        endpoint = overall.get("endpoint_reached")
        counts = _count_tiers(final_pairs)
        tier = finalize_overall(final_pairs, endpoint, final_steps)
        reason = _overall_reason(final_pairs, counts, endpoint, final_steps)
        if tier.value != overall.get("tier"):
            log.append(f"  overall: {overall.get('tier')} -> {tier.value}")
            changed = True
        elif counts != overall.get("counts") or reason != overall.get("reason"):
            log.append("  overall: counts/reason re-rolled")
            changed = True
        overall.update(tier=tier.value, label=TIER_LABEL[tier],
                       icon=TIER_ICON[tier], meaning=TIER_MEANING[tier],
                       reason=reason, counts=counts)
    return changed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--check", action="store_true",
                    help="report changes and exit non-zero; do not write")
    ap.add_argument("--backfill-claims", action="store_true",
                    help="recover mislabeled steps' change_type from their reason "
                         "text and write it; does not re-grade")
    args = ap.parse_args()

    dirty = False
    for path in args.files:
        data = json.loads(path.read_text())
        log: list[str] = []
        touched = False
        for proof in _proofs(data):
            domain = proof.get("domain") or None
            if args.backfill_claims:
                touched |= backfill_claims(proof, log)
            else:
                touched |= regrade(proof, domain, log)
        if not touched:
            print(f"✓ {path} — up to date")
            if log:
                print("\n".join(log))
            continue
        dirty = True
        print(f"{'!' if args.check else '↻'} {path}")
        print("\n".join(log))
        if not args.check:
            path.write_text(_dump(data))

    if args.check and dirty:
        print("\nStale confidence blocks — re-run without --check to re-bake.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
