# Expression-Analysis Expert — Artifacts

Companion material for the `expression_analysis` expert
(`POST /api/expert/expression_analysis`; code under
`backend/experts/modules/expression_analysis/`) and the
[equation-behavior pedagogy proposal](../equation-behavior-pedagogy-proposal.md).
User-facing feature name: **Function Analysis** (deliberately *not*
"functional analysis", which names the Banach/Hilbert-space branch of
mathematics).

## Contents

| File | What it is |
|---|---|
| [`analyses/`](analyses/) | **The finalized function-analysis files** — one per expression, each the complete endpoint response: `characteristics` (CAS features, `variables_latex`, `chartScript`), `proposal` (story, ranked features, views, probes, `variable_glossary`), and `_request` provenance. These are the canonical artifacts; everything below derives from or consumes them. |
| [`expert-ui-mockup.html`](expert-ui-mockup.html) | Hypothetical UI consuming the analysis files (fetched from `analyses/` when served; embedded fallback for `file://` opens) — story badge, ranked-feature chips, proposed viewports with live charts and numeric feature re-detection, sliders at the proposer's pins with glossary hover tooltips, predict-before-reveal probes, `{ }` raw-JSON toggle. |
| [`predict-nothink-report.md`](predict-nothink-report.md) | Performance/quality report for the adopted LM configuration (bare `Predict`, Gemini thinking disabled): the 30-call benchmark, mechanical quality checks, all 10 scenario outputs, hard-case findings, verdict and caveats. |
| [`batch_ab_results.json`](batch_ab_results.json) | Full data for the 10-scenario × 3-thinking-config benchmark (30 LM calls): latency, token usage, mechanical checks, complete outputs per call. |
| [`proposer_ab_results.json`](proposer_ab_results.json) | The earlier 5-config × 2-scenario experiment (Predict/CoT × default/low/disabled thinking) that motivated the batch — includes the CoT `reasoning_field` texts. |
| `sample-*.json` | Historical raw endpoint responses from earlier verification stages (pre-`chartScript`/glossary); superseded by `analyses/` but kept for the report's traceability. |

## Reproducing

CAS-only report (fast, no LM):

```bash
curl -s -X POST http://localhost:8785/api/expert/expression_analysis \
  -H 'Content-Type: application/json' \
  -d '{"latex": "v_0 t - \\frac{1}{2} g t^2", "variable": "t", "propose": false}'
```

Full analysis with the pedagogical proposal (~4–8 s):

```bash
curl -s -X POST http://localhost:8785/api/expert/expression_analysis \
  -H 'Content-Type: application/json' \
  -d '{"latex": "v_0 t - \\frac{1}{2} g t^2", "variable": "t", "context": "Projectile motion lesson."}'
```

LM configuration is overridable per-expert via `ALGEBENCH_PROPOSER_REASONING`
(`disable` — the measured default — `low`, `high`, or `default` for the
globally configured LM).
