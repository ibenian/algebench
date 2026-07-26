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
| [`expert-ui-mockup.html`](expert-ui-mockup.html) | The design record for the shipped page: a hypothetical UI over one real expert output (projectile height, embedded — open the file directly, no server needed). Story badge, proposed viewport with live chart and numeric feature re-detection, sliders at the proposer's pins with glossary hover tooltips, predict-before-reveal probes, `{ }` raw-JSON toggle. |
| [`predict-nothink-report.md`](predict-nothink-report.md) | Performance/quality report for the adopted LM configuration (bare `Predict`, Gemini thinking disabled): the 30-call benchmark, mechanical quality checks, all 10 scenario outputs, hard-case findings, verdict and caveats. |


Raw experiment records, per-expression analysis files, and interim sample
responses are **not committed** — they are machine output, reproducible
with the curls below. The report summarizes the experiments; the mockup
embeds the single analysis it renders.

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
