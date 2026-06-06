# ProofCompletionExpert — optimization results

Held-out eval: `data/proof_completion/eval.jsonl`, **n=40** (multi-step: 20×1-step,
8×2-step, 12×3-step). Model `gemini/gemini-2.5-flash`, `reasoning_effort=low`,
**`temperature=0` (deterministic)**. Reward optimized:
`0.45·exact + 0.20·coverage + 0.25·step_grounded + 0.10·op_f1`
(bootstrap pass/fail = reach target AND every step grounded).

> Caveat: n=40 on a single seed. Treat deltas as **indicative**, not precise.

## Overall

| stage | exact | coverage | op_f1 | grounded | step_grounded |
|---|---|---|---|---|---|
| **baseline** (no opt) | 0.250 | 0.250 | 0.580 | 1.000 | 0.225 |
| **bootstrap** (2 few-shot demos) | **0.625** | **0.625** | 0.665 | 1.000 | **0.650** |
| **MIPROv2** (auto=light, 7 trials) | 0.625 | 0.625 | 0.605 | 0.875 | 0.475 |

### Gain over baseline
| | Δ exact | Δ step_grounded |
|---|---|---|
| bootstrap | **+0.375** | **+0.425** |
| MIPROv2 | +0.375 | +0.250 |

## By chain length (most informative)

| | baseline | bootstrap | MIPROv2 |
|---|---|---|---|
| **1-step** exact / step_grnd | 0.30 / 0.42 | **0.80 / 0.80** | 0.50 / 0.68 |
| **2-step** exact / step_grnd | 0.50 / 0.00 | 0.50 / **0.62** | **1.00** / 0.12 |
| **3-step** exact / step_grnd | 0.00 / 0.04 | **0.42 / 0.42** | 0.58 / 0.38 |

## Takeaways (honest)

1. **Optimization helps a lot.** The un-optimized model can't do hard chains at
   all (3-step exact = **0/12**). A handful of demos take overall exact 0.25 →
   0.625 and 3-step from 0% to ~42–58%.
2. **Bootstrap ≥ MIPROv2 here.** Same exact-match (0.625), but bootstrap has
   *better* intermediate validity (`step_grounded` 0.65 vs 0.475) and endpoint
   grounding (1.00 vs 0.875). The cheap optimizer won at this scale.
3. **They trade off differently on 2-step.** MIPROv2 nails the *endpoint*
   (exact 1.00) but through *invalid intermediates* (`step_grounded` 0.12);
   bootstrap reaches fewer endpoints (0.50) but with valid waypoints (0.62).
   This is exactly the "right answer, garbage middle" failure mode the
   step-grounding signal exists to expose.
4. **MIPROv2 did not justify its cost** on this small run — likely too few
   train examples (30) + a light search (7 trials) for instruction search to
   pay off; bigger data + a heavier search is where MIPRO/GEPA should pull ahead.

## Reproduce

```bash
ALGEBENCH_LM_REASONING=low ALGEBENCH_LM_TEMPERATURE=0 \
  ./run.sh scripts/proof_completion_evaluate.py --data data/proof_completion/eval.jsonl \
  --tag baseline --results-log data/proof_completion/results.jsonl
# + optimize (bootstrap | mipro) then evaluate --program <artifact> --tag <name>
```
