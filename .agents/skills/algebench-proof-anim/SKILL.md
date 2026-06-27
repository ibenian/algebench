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

### 1. Research the derivation

Work out (or look up) the derivation the user wants: the starting expression, the
ordered steps, and a short justification for each. Each step is a *complete*
expression reached by one operation.

Then **confirm with `AskUserQuestion`**, e.g.:
- *Is this the right derivation / endpoint?* (show the chain start → … → target)
- *Which domain parser?* (algebra, calculus, physics, … — affects how LaTeX is parsed)
- *Add, remove, or reorder any step?*
- *Tighten any justification?*

Iterate until the user confirms the chain.

### 2. Name it

`AskUserQuestion` to confirm the `<domain>/<name>` slug. Recommend a kebab-case
default derived from the title (e.g. "Isolate a" → `algebra/isolate-a`). The slug
must match `^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$`. Show the file path it will write:
`proofs/domains/<domain>/<name>.json`.

### 3. Generate the JSON

Write a **single-entry `ProofAnimation` list** to a scratch file (this is the
animation-input format; the trajectory is the proof expert's output type verbatim):

```json
[
  {
    "title": "Isolate a",
    "domain": "algebra",
    "start_operation": "Given the equation",
    "start_justification": "solve for $a$",
    "trajectory": {
      "kind": "proof_trajectory",
      "start_latex": "a + b - c = 0",
      "target_latex": "a = c - b",
      "steps": [
        { "operation": "add $c$ to both sides", "expr_latex": "a + b = c",
          "justification": "$c$ crosses the $=$ and flips sign", "change_type": "rewrite" },
        { "operation": "subtract $b$ from both sides", "expr_latex": "a = c - b",
          "justification": "$b$ crosses over, leaving $a$ isolated", "change_type": "rewrite" }
      ]
    }
  }
]
```

Notes:
- `expr_latex` is the **full** expression after that step, not a diff.
- `justification`/`operation` may carry inline `$…$` math.
- `change_type` is usually `"rewrite"`.

Then build + save it (reuses the existing pipeline — parse, rebase, annotate,
CAS-grade, and an LM term-description pass when a key is configured):

```bash
./run.sh scripts/proof_animation/report.py --from-file <scratch>.json --save-builtin <domain>/<name>
```

This writes `proofs/domains/<domain>/<name>.json`. If the build errors on a
malformed step (it runs `assert_well_formed`), fix the spec and re-run — do not
hand-edit the generated JSON.

### 4. Show it live

Launch the app straight onto the new proof:

```bash
./algebench --proof <domain>/<name>
```

(Opens `…/renderproof?builtin=<domain>/<name>` in the browser. For headless
verification, add `--server-only --port <p>` and drive it with the preview tools.)

Report the share URL and the embed snippet form (an `<iframe>` of that URL).

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
