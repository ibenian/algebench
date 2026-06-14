#!/usr/bin/env python3
"""Optimize the ProofCompletionExpert with MIPROv2 (or GEPA) and save it.

The metric is ``proof_completion_metric`` (endpoint match + partial credit).
The compiled program (optimized instructions + bootstrapped demos) is saved to
an artifact that ``proof_completion/evaluate.py --program`` can load.

Usage:
    ./run.sh scripts/proof_completion/optimize.py \\
        --train data/proof_completion/train.jsonl \\
        --out backend/experts/modules/proof_completion/artifacts/proof_completion.json --auto light
"""

from __future__ import annotations

import argparse
import os

from _pc_env import load_env_local

load_env_local()

import dspy  # noqa: E402
from backend.experts import init_experts  # noqa: E402
from backend.experts.modules.proof_completion import ProofCompletionExpert  # noqa: E402
from backend.experts.modules.proof_completion import dataset as D  # noqa: E402
from backend.experts.modules.proof_completion.metric import proof_completion_metric  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--train", required=True, help="train .jsonl")
    ap.add_argument("--out", default="backend/experts/modules/proof_completion/artifacts/proof_completion.json")
    ap.add_argument("--optimizer", choices=["mipro", "gepa", "bootstrap", "labeled"],
                    default="mipro")
    ap.add_argument("--auto", choices=["light", "medium", "heavy"], default="light")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--demos", type=int, default=2, help="few-shot demos (bootstrap)")
    args = ap.parse_args()

    init_experts()
    train = D.load_jsonl(args.train)
    if args.limit:
        train = train[: args.limit]
    print(f"optimizing on {len(train)} examples with {args.optimizer} (auto={args.auto})")

    # compile from baseline; refine_attempts=1 disables the serving-time
    # refinement loop so the optimizer compiles the bare predictor (the metric is
    # the optimization signal, not the reward) without extra per-call LM traffic.
    student = ProofCompletionExpert(load_default=False, refine_attempts=1)

    if args.optimizer == "labeled":
        from dspy.teleprompt import LabeledFewShot
        # seed few-shot demos directly from gold examples — no LM calls, instant
        compiled = LabeledFewShot(k=args.demos).compile(student, trainset=train)
    elif args.optimizer == "gepa":
        if not hasattr(dspy, "GEPA"):
            raise SystemExit(
                "GEPA is not available in this dspy version "
                f"({dspy.__version__}); use --optimizer mipro or bootstrap."
            )
        compiled = dspy.GEPA(
            metric=proof_completion_metric, auto=args.auto, num_threads=args.threads,
        ).compile(student, trainset=train)
    elif args.optimizer == "bootstrap":
        from dspy.teleprompt import BootstrapFewShot
        # Demos are whole-graph examples; keep the count small so the prompt
        # stays manageable.
        compiled = BootstrapFewShot(
            metric=proof_completion_metric,
            max_bootstrapped_demos=args.demos,
            max_labeled_demos=args.demos,
        ).compile(student, trainset=train)
    else:
        from dspy.teleprompt import MIPROv2
        tp = MIPROv2(metric=proof_completion_metric, auto=args.auto,
                     num_threads=args.threads)
        compiled = tp.compile(student, trainset=train, requires_permission_to_run=False)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    compiled.save(args.out)
    print(f"saved compiled program -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
