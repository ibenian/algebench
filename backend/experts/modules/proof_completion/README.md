# ProofCompletionExpert

Given a **start** and **target** expression, emit a step-by-step **derivation**:
an ordered trajectory of *states*, each a complete expression (`expr_latex`) plus
the math `operation` and a `justification`. The model works in math (LaTeX), not
graphs — the per-state semantic graphs and the atomic edits between consecutive
states are reconstructed deterministically in code (`latex_to_graph` + `diff`),
and each state is SymPy-verified.

A self-contained expert package (see the framework README in
`backend/experts/README.md` for the generic plumbing).

## Layout

```
__init__.py    imports submodules so decorators fire; re-exports the expert class
module.py      @register_expert  (the dspy.Module)
signature.py   the DSPy signature
outputs.py     this expert's Output subclass(es) + the GraphOp union
metric.py      the metric + @register_metric
model.py       context model (GraphTransition)
graph_ops.py   apply / diff / canonical_equal
grounding.py   graph -> sympy + equivalence + per-step grounding
wellformed.py  caption well-formedness checker (balanced $…$ / braces)
grounding_score.py  tier-graded grounding score (TIER_RANK/4) for the reward
judge.py       LLM-as-judge signature (pedagogy score + issues; never gates)
reward.py      the single graded reward + threshold (well-formed · grounding · judge)
refine.py      the refinement loop engine (ask → score → re-ask with feedback)
dataset.py     sympy example generator
domains/       one file per domain (algebra, calculus, rational, equation_solving,
               inequalities, logic), each @register_domain
artifacts/     compiled DSPy programs for this expert (gitignored)
```

## Design

The ops are a **Pydantic discriminated union** (`outputs.py`): `AddNode` /
`RemoveNode` / `AddEdge` / `RemoveEdge`, each carrying only its own fields, with
shared fields on `GraphOpBase` and behavior provided polymorphically via
`apply_to` (no optional-field soup, no branching in `apply`).

- Context model: `GraphTransition(start, target, domain, intent)` (a per-expert
  `context_model` override — the input is two graphs, not one document node).
- Match criterion: **canonical isomorphism** (`graph_ops.canonical_equal`),
  invariant to synthetic node-id naming (Weisfeiler-Lehman color refinement).
- Ground truth: **sympy**. `dataset.py` builds real rewrite chains, derives each
  step to a graph with the existing `SemanticGraphService`, and threads
  per-step structural diffs into a self-consistent gold trajectory.

## Validation checks (`grounding.py`)

1. **Trajectory consistency** — `trajectory_consistent(start, ops, target)` =
   `canonical_equal(apply(start, ops), target)`. The generator asserts it for
   every gold trajectory; in the evaluator the predicted-trajectory version *is*
   the `exact` metric.
2. **Accuracy / grounding** — `graph_to_sympy(graph)` reconstructs a sympy
   expression *structurally* from the graph (inverting the parser's encoding —
   not relying on the `subexpr` string, which expert nodes lack), and
   `is_grounded(graph, expr)` checks sympy-equivalence (`sympy_equiv`, equations
   up to sign; inequalities by canonical form; logical connectives by
   equivalence). Independent of structural shape, so it catches graphs that are
   mathematically wrong even when they look right, and credits graphs that are
   mathematically right even when shaped differently. `is_grounded` returns
   `None` when a graph uses a construct the walk doesn't model (e.g. a latex
   round-trip that reads implicit `x(...)` as function application) — `None`
   means "unverifiable," never wrong.
3. **Per-step grounding (multi-step derivations)** — every `GraphOp` carries a
   1-based `step`. With `--max-steps > 1`, `dataset.py` builds chains
   `e0 → e1 → … → eN` where **every waypoint is required to be groundable**
   (chains with an ungroundable step are rejected — which also forces target
   grounding to 100%). `thread_gold` tags each op with its step; `step_groundings`
   verifies that applying ops up to step k grounds to `eₖ`. For predictions,
   `per_step_groundable` / `score_components`' `step_grounded` measures the
   fraction of the model's step boundaries that are valid math waypoints — the
   "is every intermediate sane?" signal (e.g. `x²+1=0 → x²=−1 → x=√−1`).

## Refinement loop (issue #372)

`module.forward` wraps the prediction in a **refinement loop**: each attempt is
scored by a single graded `reward(pred, …) ∈ [0,1]` and, if it falls below the
threshold `τ`, re-asked with the failure issues threaded back as targeted
feedback (not a blind re-roll). It early-exits the moment an attempt passes, and
after `N` attempts keeps the **best** one — which still renders, honestly tiered
by the confidence badges (#370). One pure checker per constraint, each in its own
file:

```
reward = wellformed_factor · (W_G · grounding_score + W_J · judge_score)
```

- **wellformed.py** — near-binary prerequisite: a malformed caption (unbalanced
  `$`, stray braces) can't render, so it zeroes the reward and the loop retries
  with the caption issues as feedback (the judge isn't even called). Delegates the
  `$…$` scanning to the reusable `backend/util/latex.py`, so the chat panel and
  the caption renderer share one definition of "balanced." Two surfaces: soft
  `well_formed()` for the loop, hard `assert_well_formed()` for non-generation
  edges (stored/hand-authored JSON, tests) where no retry exists.
- **grounding_score.py** — maps the `step_grounding` tiers to `TIER_RANK/4`
  (Grounded 1.0 · Verified 0.75 · Plausible 0.5 · Unchecked 0.25 · Refuted 0.0),
  averaged over transitions. Graded, not a hard floor — a `Refuted` step drags the
  blend down on its own weight (weighted to dominate the judge).
- **judge.py** — an LLM-as-judge that returns a pedagogy `score` + `issues`. It
  only nudges the number and supplies feedback; it never decides pass/fail.

### Cost / latency

`τ`, the weights, and `N` are env-tunable:

| Env var | Default | Meaning |
|---|---|---|
| `ALGEBENCH_PC_REFINE_ATTEMPTS` | `2` | max attempts `N` (`1` = single pass, loop disabled) |
| `ALGEBENCH_PC_JUDGE` | `0` (off) | enable the LLM judge (adds one LM call per generation) |
| `ALGEBENCH_PC_TIME_BUDGET` | `240` (s) | wall-clock budget; don't start a retry past it (`0` = no budget). Guards the client's request timeout (UI aborts at 360s) on long derivations |
| `ALGEBENCH_PC_TAU` | `0.7` | retry threshold |
| `ALGEBENCH_PC_W_GROUNDING` / `ALGEBENCH_PC_W_JUDGE` | `0.8` / `0.2` | reward weights |
| `ALGEBENCH_PC_LOAD_ARTIFACT` | `""` (off) | repo-relative path to a compiled artifact to load (confined via `sanitize_path`; absolute/`..` rejected); empty = baseline; explicit `--program` always loads |

The hard gates (well-formedness, grounding) are deterministic and need **no LM**,
so with the judge off the only LM call on a passing first attempt is the single
prediction — extra calls happen *only* when an attempt scores below `τ` (early
exit on pass). Keep `N` small (2–3). The judge, when enabled, is the one extra LM
call and runs only after the hard prerequisite passes.

## Pipeline

```bash
# 1. generate held-out datasets (no LLM; sympy is the source of truth)
./run.sh scripts/proof_completion/dataset.py --n 200 --seed 1 --out data/proof_completion/train.jsonl
./run.sh scripts/proof_completion/dataset.py --n 60  --seed 2 --out data/proof_completion/eval.jsonl

# 2. baseline performance
./run.sh scripts/proof_completion/evaluate.py --data data/proof_completion/eval.jsonl

# 3. optimize (bootstrap demos is fast; --optimizer mipro for instruction search;
#    gepa requires dspy>=3.0 — this project pins dspy>=2.6,<3.0)
./run.sh scripts/proof_completion/optimize.py --train data/proof_completion/train.jsonl \
    --optimizer bootstrap --out backend/experts/modules/proof_completion/artifacts/proof_completion.json

# 4. re-evaluate with the compiled program and compare the lift
./run.sh scripts/proof_completion/evaluate.py --data data/proof_completion/eval.jsonl \
    --program backend/experts/modules/proof_completion/artifacts/proof_completion.json
```

Env: needs `GEMINI_API_KEY`. `ALGEBENCH_LM_MODEL` overrides the model
(default `gemini/gemini-2.5-flash`); `ALGEBENCH_LM_REASONING=low` trims the
thinking budget to cut latency; `ALGEBENCH_LM_TEMPERATURE=0` for deterministic eval.

See `RESULTS.md` for the latest baseline-vs-optimized numbers.
