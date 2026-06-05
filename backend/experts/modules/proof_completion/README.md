# ProofCompletionExpert

Given a **start** semantic graph and a **target** semantic graph, emit an
ordered trajectory of atomic edits, each with an explanation + justification,
such that applying the trajectory to the start graph yields the target.

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

## Pipeline

```bash
# 1. generate held-out datasets (no LLM; sympy is the source of truth)
./run.sh scripts/proof_completion_generate.py --n 200 --seed 1 --out data/proof_completion/train.jsonl
./run.sh scripts/proof_completion_generate.py --n 60  --seed 2 --out data/proof_completion/eval.jsonl

# 2. baseline performance
./run.sh scripts/proof_completion_evaluate.py --data data/proof_completion/eval.jsonl

# 3. optimize (bootstrap demos is fast; --optimizer mipro for instruction search;
#    gepa requires dspy>=3.0 — this project pins dspy>=2.6,<3.0)
./run.sh scripts/proof_completion_optimize.py --train data/proof_completion/train.jsonl \
    --optimizer bootstrap --out backend/experts/modules/proof_completion/artifacts/proof_completion.json

# 4. re-evaluate with the compiled program and compare the lift
./run.sh scripts/proof_completion_evaluate.py --data data/proof_completion/eval.jsonl \
    --program backend/experts/modules/proof_completion/artifacts/proof_completion.json
```

Env: needs `GEMINI_API_KEY`. `ALGEBENCH_LM_MODEL` overrides the model
(default `gemini/gemini-2.5-flash`); `ALGEBENCH_LM_REASONING=low` trims the
thinking budget to cut latency; `ALGEBENCH_LM_TEMPERATURE=0` for deterministic eval.

See `RESULTS.md` for the latest baseline-vs-optimized numbers.
