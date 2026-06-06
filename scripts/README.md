# scripts

Project utilities. **Run every Python script through `./run.sh`** (it manages the
`.venv` + `PYTHONPATH`); shell scripts are run directly.

```bash
./run.sh scripts/<name>.py [args]      # Python
./scripts/<name>.sh [args]             # shell
```

---

## Proof animation

The in-browser, Manim-style morph engine and its data pipeline. A *proof
animation* is a chain of complete expressions that the engine FLIP-morphs between.
The data pipeline is deterministic (sympy parse + render); only **derivation**
calls the model.

| Script | What it does |
| --- | --- |
| `proof_animation_build.py` | Library + CLI. Turns a typed `ProofTrajectory` (the expert's output) into animation data: parses each state, threads stable per-glyph ids across states, emits `\htmlData`-annotated LaTeX. Holds the baked `SAMPLES` and the `ProofAnimation` model. |
| `proof_animation_derive.py` | **Local / needs `GEMINI_API_KEY`.** Runs the `ProofCompletionExpert` and `--append`s the resulting `ProofAnimation` to a proofs JSON (the test suite). Endpoints come from explicit `START TARGET`, or from `--prompt "…"` (the model picks start/target/domain/title). Add `--render` to also (re)generate the HTML page via the report generator into `--outdir` (the whole suite when `--append`ing, else just this proof) so a running serve picks it up on refresh. |
| `proof_animation_report.py` | Generates a self-contained HTML page (engine + data) for a proof suite. `--from-file proofs.json` (default: the test suite) renders many; `--from-json` animates one `ProofTrajectory`; `--derive START TARGET` derives then renders. |
| `serve_proof_animation.sh` | Generate the page and serve it on `:5750` (defaults to the test suite). |

```bash
# add a derived proof to the suite (local), then commit the JSON
./run.sh scripts/proof_animation_derive.py "x^2 - 4 = 0" "x = 2" \
    --title "Solve x^2 = 4" --append tests/proof_animation/proofs.json

# …or from a single prompt (the model picks the endpoints)
./run.sh scripts/proof_animation_derive.py --prompt "derive Lorentz time dilation" \
    --append tests/proof_animation/proofs.json

# derive + render in one shot (refresh a running serve to see it)
./run.sh scripts/proof_animation_derive.py --prompt "expand (x+1)^2" --render

# preview the suite locally
./scripts/serve_proof_animation.sh                       # http://localhost:5750

# render the suite to a static site (the CI / Pages path — no model)
./run.sh scripts/proof_animation_report.py \
    --from-file tests/proof_animation/proofs.json --outdir _site
```

The suite lives in `tests/proof_animation/proofs.json` (see its README). CI
(`.github/workflows/proof-animation.yml`) renders the committed suite to Pages;
it never derives.

## Proof completion (the expert)

The DSPy `ProofCompletionExpert`: given a start/target it produces a derivation.
sympy is the ground truth for data + scoring; the model only emits math (LaTeX).

| Script | What it does |
| --- | --- |
| `proof_completion_dataset.py` | Generate a sympy-grounded train/eval dataset (`.jsonl`). No LLM — every example is a real algebraic transformation with a verified gold trajectory. Use different `--seed`s for train vs eval. |
| `proof_completion_optimize.py` | Optimize the expert with MIPROv2 (or GEPA) on a train set and save the compiled artifact. |
| `proof_completion_evaluate.py` | Evaluate the expert on a held-out dataset (baseline vs optimized) and report metrics. |
| `proof_completion_derive.py` | **Needs `GEMINI_API_KEY`.** Derive the steps between two LaTeX expressions and print them; `--json` dumps the raw `ProofTrajectory`. Exposes `derive_trajectory()`, reused by `proof_animation_derive.py`. |
| `_pc_env.py` | Shared helper: load `.env.local` for the proof-completion scripts. |

```bash
./run.sh scripts/proof_completion_dataset.py --n 200 --seed 1 --out data/proof_completion/train.jsonl
./run.sh scripts/proof_completion_optimize.py --train data/proof_completion/train.jsonl
./run.sh scripts/proof_completion_evaluate.py --data data/proof_completion/eval.jsonl
./run.sh scripts/proof_completion_derive.py "\frac{d}{dx} x^2" "2 x"
```

## Semantic graph

LaTeX → semantic graph pipeline, plus its visual report.

| Script | What it does |
| --- | --- |
| `latex_to_graph.py` | Convert LaTeX expression(s) into semantic graph JSON. |
| `graph_to_mermaid.py` | Convert a semantic graph JSON into a Mermaid flowchart. |
| `semantic_graph_report.py` | Generate the visual examination report (one HTML per domain + index). |
| `serve_sg_report.sh` | Generate + serve the semantic-graph report locally. |
| `render_math.py` | Render LaTeX as styled HTML (optional Mermaid). |
| `prebake_semantic_graphs.py` | Pre-bake semantic graphs into a scene/lesson JSON. |
| `prebake_semantic_graph_enrichment.py` | Pre-bake semantic-graph *enrichment* into a scene/lesson JSON. |
| `ci_validate_prebaked.py` | CI aggregator for prebaked-graph validation. |

## Scenes & content

Authoring, assembling, and validating AlgeBench lesson/scene JSON.

| Script | What it does |
| --- | --- |
| `assemble_scene.py` | Assemble scenes into lesson JSON files. |
| `lint_scene.py` | Lint a single scene JSON before assembly. |
| `extract_structure.py` | Extract the structural skeleton from scene JSON. |
| `audit_expressions.py` | Audit expression-sandbox coverage across scene JSON. |
| `validate_content.py` | Deep content validation for scene JSON. |
| `validate_schema.py` | Validate AlgeBench JSON against a schema. |

## Misc

| Script | What it does |
| --- | --- |
| `loc-report.sh` / `loc_report_to_html.py` | Lines-of-code report → styled HTML for Pages. |
