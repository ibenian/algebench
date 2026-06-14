#!/usr/bin/env python3
"""A/B the refinement loop: same examples, refinement OFF vs ON (issue #372).

Runs each eval example twice — ``refine_attempts=1`` (single pass, loop disabled)
and ``refine_attempts=N`` (ask → score → re-ask-with-feedback) — and reports, for
each config, the metrics the loop is meant to move: caption **well-formedness**
rate, **grounding** score, the blended **reward**, and the **pass@τ** rate, next
to the existing metric components (exact / coverage / step_grounded).

Run with ``ALGEBENCH_LM_TEMPERATURE=0`` (the default here) so the OFF run is byte
-for-byte the ON run's first attempt: every difference is then attributable to the
loop, not to sampling noise. Extra LM calls happen only on a sub-τ first attempt.

Usage:
    ./run.sh scripts/proof_completion/compare_refine.py --data data/proof_completion/eval.jsonl --limit 20
    ./run.sh scripts/proof_completion/compare_refine.py --data ... --attempts 3 --judge
"""

from __future__ import annotations

import argparse
import os

from _pc_env import load_env_local, predict_all

# Deterministic by default so OFF == ON's first attempt (override if you like).
os.environ.setdefault("ALGEBENCH_LM_TEMPERATURE", "0")

load_env_local()

from backend.experts import init_experts  # noqa: E402
from backend.experts.modules.proof_completion import ProofCompletionExpert  # noqa: E402
from backend.experts.modules.proof_completion import dataset as D  # noqa: E402
from backend.experts.modules.proof_completion.metric import score_components  # noqa: E402
from backend.experts.modules.proof_completion.reward import TAU, reward  # noqa: E402
from backend.experts.modules.proof_completion.wellformed import well_formed  # noqa: E402


def _traj(pred):
    """The ProofTrajectory out of a program return (``[traj]``); None on error."""
    if pred is None:
        return None
    if isinstance(pred, (list, tuple)):
        return pred[0] if pred else None
    return pred


def _row(ex, pred, judge):
    """Score one prediction: reward components + the existing metric components."""
    traj = _traj(pred)
    if traj is None:
        return {"wellformed": 0.0, "grounding": 0.0, "reward": 0.0, "passed": 0.0,
                "exact": 0.0, "coverage": 0.0, "step_grounded": 0.0}
    r = reward(traj, start_graph=ex.context.start, target_graph=ex.context.target,
               domain=ex.context.domain, judge=judge)
    c = score_components(ex, pred)
    return {
        "wellformed": 1.0 if well_formed(traj).ok else 0.0,
        "grounding": r.breakdown["grounding"] if r.breakdown["grounding"] is not None else 0.0,
        "reward": r.score,
        "passed": 1.0 if r.passed else 0.0,
        "exact": c["exact"],
        "coverage": c["coverage"],
        "step_grounded": c["step_grounded"],
    }


def _agg(rows):
    keys = ("wellformed", "grounding", "reward", "passed", "exact", "coverage",
            "step_grounded")
    return {k: sum(r[k] for r in rows) / len(rows) for k in keys}


_LABELS = [
    ("wellformed", "well-formed rate"),
    ("grounding", "mean grounding"),
    ("reward", "mean reward"),
    ("passed", f"pass@τ ({TAU})"),
    ("exact", "exact"),
    ("coverage", "coverage"),
    ("step_grounded", "step_grounded"),
]


def _print_table(off, on):
    print(f"\n{'metric':<22}{'OFF (N=1)':>12}{'ON':>12}{'Δ':>10}")
    print("-" * 56)
    for key, label in _LABELS:
        d = on[key] - off[key]
        arrow = "↑" if d > 1e-9 else ("↓" if d < -1e-9 else " ")
        print(f"{label:<22}{off[key]:>12.3f}{on[key]:>12.3f}{d:>+9.3f}{arrow}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", required=True, help="eval .jsonl")
    ap.add_argument("--limit", type=int, default=20, help="cap examples (cost guard)")
    ap.add_argument("--attempts", type=int, default=2, help="N for the ON run")
    ap.add_argument("--judge", action="store_true",
                    help="enable the LLM judge in BOTH the loop and the scoring")
    args = ap.parse_args()

    init_experts()  # configures the DSPy LM + discovers registrations
    data = D.load_jsonl(args.data)[: args.limit]
    print(f"comparing on {len(data)} examples  "
          f"(temp={os.environ.get('ALGEBENCH_LM_TEMPERATURE')}, "
          f"judge={'on' if args.judge else 'off'}, N={args.attempts})")

    off_prog = ProofCompletionExpert(load_default=False, refine_attempts=1,
                                     use_judge=args.judge)
    on_prog = ProofCompletionExpert(load_default=False, refine_attempts=args.attempts,
                                    use_judge=args.judge)
    # A shared scoring judge so the reward numbers are comparable across configs.
    score_judge = on_prog.judge if args.judge else None

    print("\n[1/2] refinement OFF (single pass)…")
    off_preds = predict_all(off_prog, data, label="off")
    print("\n[2/2] refinement ON…")
    on_preds = predict_all(on_prog, data, label="on")

    off_rows = [_row(ex, p, score_judge) for ex, p in zip(data, off_preds)]
    on_rows = [_row(ex, p, score_judge) for ex, p in zip(data, on_preds)]

    _print_table(_agg(off_rows), _agg(on_rows))

    # per-example movement on the blended reward
    improved = regressed = same = 0
    fixed_wf = 0  # malformed under OFF, well-formed under ON
    for o, n in zip(off_rows, on_rows):
        d = n["reward"] - o["reward"]
        if d > 1e-6:
            improved += 1
        elif d < -1e-6:
            regressed += 1
        else:
            same += 1
        if o["wellformed"] < 1.0 and n["wellformed"] == 1.0:
            fixed_wf += 1
    print(f"\nreward movement: {improved} improved · {regressed} regressed · "
          f"{same} unchanged   (of {len(data)})")
    print(f"malformed captions repaired by the loop: {fixed_wf}")

    # retries: the OFF rows ARE the first attempts, so an example enters the retry
    # loop iff its first attempt scored below τ. With N=2 that is exactly one
    # retry each; the resulting extra LM derivation calls are the loop's whole
    # marginal cost (passing first attempts are temp=0 cache hits).
    retried = sum(1 for r in off_rows if r["passed"] < 1.0)
    crossed = sum(1 for o, n in zip(off_rows, on_rows)
                  if o["passed"] < 1.0 and n["passed"] == 1.0)
    max_retries = retried * (args.attempts - 1)
    print(f"\nretries: {retried}/{len(data)} examples fell below τ on the first "
          f"attempt and entered the loop")
    if args.attempts == 2:
        print(f"  → {retried} retry passes (one each); {crossed} of them then crossed τ")
    else:
        print(f"  → between {retried} and {max_retries} retry passes "
              f"(1…{args.attempts - 1} each); {crossed} examples crossed τ")
    print(f"  extra LM derivation calls ≈ retry passes "
          f"(first attempts are cache hits at temp=0)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
