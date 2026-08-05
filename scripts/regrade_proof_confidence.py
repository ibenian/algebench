#!/usr/bin/env python3
"""Re-bake the stored ``confidence`` blocks that a grading-rule change made stale.

Stored proofs carry the verdicts they were baked with, and ``_sanitize_stored_proof``
serves those straight to the client — so changing a grading rule does NOT reach the
reader until the files are re-baked. This script is that re-bake for the ``narrows``
tier change (#516): a step that discards solutions can no longer be badged 🥇.

**This is a surgical patch, not a full re-grade.** Re-running ``ground_steps`` over a
stored proof cannot reproduce it faithfully, because steps persist no ``change_type``
— so ``type_consistent`` comes back True for every pair and every mislabel downgrade
silently disappears. Nor can it reproduce ``domain``-tier steps, which came from an LM
judge (``rescue_uncheckable``). So we touch only what the rule change actually moved:

* steps whose stored ``relation`` is ``narrows`` and stored tier is ``grounded``
  (the old rule's GOLD; the new rule caps these at SILVER), and
* the ``counts`` those steps feed, plus ``overall`` if the weakest link moved.

Everything else is left exactly as baked.

Usage:
    ./run.sh scripts/regrade_proof_confidence.py <file.json> [...] [--check]

``--check`` reports what would change and exits non-zero without writing.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _dump(data) -> str:
    """Serialize in the format these files are already stored in.

    NOT ``dumps_compact_leaves`` — that is the scene/lesson format, and using it
    here reflows every proof file into a 1000-line diff. Verified byte-identical
    round-trip on the stored proofs before any edit.
    """
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def _proofs(data):
    """A file holds either one proof or a list of them (the animation fixtures)."""
    return data if isinstance(data, list) else [data]


def _fresh_reason(proof, index, domain):
    """Re-derive the narrowing reason for step ``index``, or None if undecidable.

    Only the wording is taken from this — the tier is already known from the rule
    change — so a CAS degrade costs the detail, not the grade.
    """
    from backend.semantic_graph.service import SemanticGraphService
    from backend.experts.modules.proof_completion.grounding import graph_to_sympy
    from backend.experts.modules.proof_completion.step_grounding import (
        classify_pair, _guard,
    )
    svc = SemanticGraphService()

    def expr(step):
        latex = step.get("input_latex") or step.get("plain") or ""
        try:
            graph = svc.latex_to_graph(latex, domain=domain)
        except Exception:
            return None
        return _guard(graph_to_sympy, graph, default=None) if graph is not None else None

    if index == 0:
        return None
    prev, curr = expr(proof["steps"][index - 1]), expr(proof["steps"][index])
    if prev is None or curr is None:
        return None
    verdict = classify_pair(prev, curr, change_type="solve", index=index)
    # Only adopt the wording if the pair still reads as the same narrowing.
    return verdict.reason if verdict.relation == "narrows" else None


def _patch(proof, domain, log) -> bool:
    """Flip stale ``narrows``+GOLD steps to SILVER; re-roll counts and overall."""
    from backend.experts.modules.proof_completion.step_grounding import (
        TIER_RANK, TIER_LABEL, TIER_ICON, TIER_MEANING, Tier,
    )
    changed = False
    for step in proof.get("steps", []):
        conf = step.get("confidence") or {}
        if conf.get("relation") != "narrows" or conf.get("tier") != Tier.GOLD.value:
            continue
        conf.update(tier=Tier.SILVER.value, label=TIER_LABEL[Tier.SILVER],
                    icon=TIER_ICON[Tier.SILVER], meaning=TIER_MEANING[Tier.SILVER])
        log.append(f"  step {step.get('index')}: grounded -> verified (narrows)")
        fresh = _fresh_reason(proof, step.get("index", 0), domain)
        if fresh and fresh != conf.get("reason"):
            conf["reason"] = fresh
            log.append(f"    reason: {fresh}")
        changed = True

    if not changed:
        return False

    overall = proof.get("overall_confidence")
    if not isinstance(overall, dict):
        return True
    step_tiers = [Tier(s["confidence"]["tier"]) for s in proof["steps"]
                  if (s.get("confidence") or {}).get("tier")]
    # ``counts`` and the weakest link are tallied over PAIRS, not steps — step 0
    # is the given, with no incoming transition to grade. (Verified against the
    # stored tallies: counting all steps overshoots by exactly one.)
    pair_tiers = step_tiers[1:]
    counts = {t.value: sum(1 for x in pair_tiers if x is t) for t in Tier}
    if counts != overall.get("counts"):
        overall["counts"] = counts
        log.append("    overall counts re-rolled")
    # Weakest link, then the endpoint gate — mirrors ``finalize_overall``.
    weakest = min(pair_tiers, key=TIER_RANK.get, default=Tier.BLUE)
    if overall.get("endpoint_reached") is False:
        weakest = min(weakest, Tier.BLUE, key=TIER_RANK.get)
    elif overall.get("endpoint_reached") is None and weakest is Tier.GOLD:
        weakest = Tier.SILVER
    if any(t is Tier.RED for t in step_tiers):
        weakest = Tier.RED                  # a step can be refuted on its own terms
    if weakest.value != overall.get("tier"):
        log.append(f"    ⚠ overall {overall.get('tier')} -> {weakest.value}"
                   f" — reason text needs a human: {overall.get('reason')!r}")
        overall.update(tier=weakest.value, label=TIER_LABEL[weakest],
                       icon=TIER_ICON[weakest], meaning=TIER_MEANING[weakest])
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--check", action="store_true",
                    help="report changes and exit non-zero; do not write")
    args = ap.parse_args()

    dirty = False
    for path in args.files:
        data = json.loads(path.read_text())
        log: list[str] = []
        touched = False
        for proof in _proofs(data):
            if _patch(proof, proof.get("domain") or None, log):
                touched = True
        if not touched:
            print(f"✓ {path} — up to date")
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
