---
name: algebench-proof-anim
description: Research a mathematical derivation with the user, generate a shareable AlgeBench proof animation JSON, and launch the app to show it rendering. Interactive and AskUserQuestion-driven at every decision point.
triggers:
  - proof anim
  - proof animation
  - make a proof animation
  - shareable proof
  - render proof
  - algebench-proof-anim
---

# AlgeBench Proof Animation Builder

Turn a mathematical derivation into a **shareable, embeddable proof animation**
that lives in this repo under `proofs/domains/<domain>/<name>.json` and renders at
`…/renderproof?builtin=<domain>/<name>`.

See **[docs/shareable-proof-animations.md](../../docs/shareable-proof-animations.md)**
for the full system design. This skill produces the built-in proof JSON and shows
it rendering.

## Operating principle: guide, don't guess

This skill is **interactive**. At each decision point present concrete options via
`AskUserQuestion` (recommended default first), then act on the answer. Never
silently invent the whole derivation and dump a file — confirm the math first.

## Workflow

### 1. Decide the endpoints (don't write the steps yourself)

Figure out the **start** and **target** LaTeX (and, optionally, the intent) — NOT
the intermediate steps. The intermediate steps come from `derive.py`, which runs
the ProofCompletionExpert + CAS so they're model-derived and machine-checked, not
hand-guessed.

**Confirm with `AskUserQuestion`**, e.g.:
- *Is this the right start → target?* (e.g. `ax^2+bx+c=0` → the quadratic formula)
- *Which domain parser?* (algebra, calculus, physics, … — affects LaTeX parsing)

### 2. Name it

`AskUserQuestion` to confirm the `<domain>/<name>` slug. Recommend a kebab-case
default derived from the title (e.g. "Isolate a" → `algebra/isolate-a`). The slug
must match `^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$`. Show the file path it will write:
`proofs/domains/<domain>/<name>.json`.

### 3. Generate the trajectory with `derive.py`, then save it

**Always use the derive script** to produce the trajectory — it runs the expert and
CAS-verifies each step. Do NOT hand-author the chain of `expr_latex` steps.
(Needs `GEMINI_API_KEY` in `.env.local`.)

```bash
# explicit endpoints (precise):
./run.sh scripts/proof_animation/derive.py "<START>" "<TARGET>" \
    --title "<Title>" --domain <domain> --out <scratch>/anim.json
# …or let the model pick endpoints from a prompt:
./run.sh scripts/proof_animation/derive.py --prompt "<natural language>" --out <scratch>/anim.json
```

Review the generated steps (print them). If they're wrong, adjust the
endpoints/prompt and **re-run derive.py** — don't fix the math by hand.

`derive.py --out` writes a single `ProofAnimation`; `report.py --save-builtin`
wants a one-entry list. Wrap it, then build + save (parse, rebase, annotate,
CAS-grade, optional LM term descriptions):

```bash
jq '[.]' <scratch>/anim.json > <scratch>/list.json
./run.sh scripts/proof_animation/report.py --from-file <scratch>/list.json --save-builtin <domain>/<name>
```

This writes `proofs/domains/<domain>/<name>.json`. If the build errors on a
malformed step (it runs `assert_well_formed`), re-derive — do not hand-edit the JSON.

> Fallback (no LM key, or a tiny fixed chain): you may hand-author a single-entry
> `ProofAnimation` list and pass it straight to `report.py --from-file … --save-builtin`.
> The shape is `{title, domain, start_operation, start_justification, trajectory:{kind:"proof_trajectory",
> start_latex, target_latex, steps:[{operation, expr_latex, justification, change_type:"rewrite"}]}}`
> where each `expr_latex` is the FULL expression after that step. Prefer `derive.py`.

### 4. Show it live (use the right URL)

```bash
./algebench --proof <domain>/<name>     # opens /renderproof?builtin=<domain>/<name>
```

For headless verification, run `./algebench --server-only --port <p>` and load the
**shareable page** in the preview tools:
`http://localhost:<p>/renderproof?builtin=<domain>/<name>` — that exact path, NOT
the app root `/` (the main 3D viewer), and confirm the page stayed on that URL
before screenshotting.

Report the share URL and the embed snippet (an `<iframe>` + the optional
`embed-resizer.js` script). Use the deployed host in the snippet only once the
`/renderproof` feature is live there.

### 5. Confirm or iterate

Final `AskUserQuestion`: *Looks good / revise a step / rename / add another proof?*
Loop back to the relevant step as needed. To put several proofs on one page, the
URL takes repeated params: `?builtin=algebra/isolate-a&builtin=algebra/expand-binomial`.

## Safety note

The renderer treats every proof JSON as untrusted: math is rendered through KaTeX
with trust limited to `\htmlData`, all human text via `textContent`, and the page
runs under a strict CSP. So a generated (or hand-edited) proof can never execute
scripts — but still **generate via the script**, don't hand-craft annotated LaTeX,
so the `\htmlData` term ids stay correct and the animation morphs properly.
