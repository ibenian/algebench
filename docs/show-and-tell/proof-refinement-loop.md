# The Refinement Loop — a Show & Tell

When AlgeBench asks an LLM to write a step‑by‑step derivation, the first draft is
sometimes **broken**: an unbalanced `$` that leaks raw LaTeX into the caption, or
a step that doesn't actually follow from the one before it. This post is about
the machinery that **catches a bad draft and re‑asks for a better one** —
deterministic correctness gates plus an optional taste critic, with the *exact
reason it failed* handed back to the model so the retry is targeted, not a blind
re‑roll.

It also covers a side quest: we A/B'd our hand‑written loop against DSPy 3's
built‑in `Refine`, and the hand‑rolled one won. The "why" turns out to be a neat
lesson about matching the tool to the task.

> _[screenshot placeholder: a derivation that first came back malformed, then the clean re‑derived version side by side]_

---

## The big picture

One LM draft, scored by a single number, retried only if it falls short — and
the failure reasons travel back into the next attempt.

<svg viewBox="0 0 940 380" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">
  <defs>
    <marker id="arr" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#7c83ff"/>
    </marker>
    <marker id="arrG" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#4cc38a"/>
    </marker>
    <marker id="arrR" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#e0707a"/>
    </marker>
    <style>
      .lbl{fill:#e8eaf6; font-size:14px; font-weight:600;}
      .sub{fill:#aab0d6; font-size:11px;}
      .edge{stroke:#7c83ff; stroke-width:2; fill:none; marker-end:url(#arr);}
      .pass{stroke:#4cc38a; stroke-width:2; fill:none; marker-end:url(#arrG);}
      .fail{stroke:#e0707a; stroke-width:2; fill:none; marker-end:url(#arrR); stroke-dasharray:5 4;}
      .llm{fill:#2a2150; stroke:#8b7cff;}
      .cas{fill:#14352a; stroke:#4cc38a;}
      .gate{fill:#3a2a14; stroke:#d4a017;}
      .io{fill:#1a2740; stroke:#5b9bd5;}
      .flbl{fill:#e0707a; font-size:11px; font-weight:600;}
      .plbl{fill:#4cc38a; font-size:11px; font-weight:600;}
    </style>
  </defs>

  <!-- generate -->
  <rect class="llm" rx="10" x="30" y="150" width="170" height="90"/>
  <text class="lbl" x="115" y="182" text-anchor="middle">Generate</text>
  <text class="sub" x="115" y="202" text-anchor="middle">ChainOfThought</text>
  <text class="sub" x="115" y="218" text-anchor="middle">→ a trajectory</text>

  <!-- reward -->
  <rect class="gate" rx="10" x="270" y="140" width="190" height="110"/>
  <text class="lbl" x="365" y="170" text-anchor="middle">Reward</text>
  <text class="sub" x="365" y="190" text-anchor="middle">well‑formed · grounding</text>
  <text class="sub" x="365" y="206" text-anchor="middle">· (judge) → score ∈ [0,1]</text>
  <text class="sub" x="365" y="228" text-anchor="middle">+ an issues string</text>

  <!-- threshold -->
  <polygon class="cas" points="560,195 620,150 680,195 620,240" fill="#14352a" stroke="#4cc38a" stroke-width="1.5"/>
  <text class="lbl" x="620" y="192" text-anchor="middle">score</text>
  <text class="lbl" x="620" y="208" text-anchor="middle">≥ τ ?</text>

  <!-- done -->
  <rect class="io" rx="10" x="760" y="150" width="150" height="90"/>
  <text class="lbl" x="835" y="182" text-anchor="middle">Done</text>
  <text class="sub" x="835" y="202" text-anchor="middle">return best</text>
  <text class="sub" x="835" y="218" text-anchor="middle">trajectory</text>

  <!-- edges -->
  <path class="edge" d="M200,195 L266,195"/>
  <path class="edge" d="M460,195 L556,195"/>
  <path class="pass" d="M680,195 L756,195"/>
  <text class="plbl" x="718" y="186" text-anchor="middle">pass</text>

  <!-- fail loop back to generate (feedback) -->
  <path class="fail" d="M620,240 C620,320 250,330 115,330 L115,244"/>
  <text class="flbl" x="380" y="348" text-anchor="middle">fail &amp; attempts left → re‑ask with the issues as feedback</text>
</svg>

**One sentence:** generate, score with a single number, and if it's below the
bar, re‑ask the model *with the exact reasons it failed* — keeping the best
attempt after a small number of tries.

---

## 1. Why a draft needs refining  ·  _(its own post)_

The model writes math as LaTeX captions. Two failure modes recur:

- **Malformed caption** — an unbalanced `$` (e.g. `…and $V = 7.8 \text{ km/s}`
  with no closing `$`) leaks raw LaTeX into the rendered text. It can't display.
- **Ungrounded step** — a step that *parses* fine but doesn't follow from the
  previous one (`x^2 = 4 → x = 7`). It looks plausible and means the wrong thing.

The pinned DSPy (2.6.5) has **no retry primitive** and its default path is
*reject → one blind re‑roll → raise*: a validation failure re‑calls the model
with the **same** inputs and **throws away** the error text. The model is never
told what was wrong. So we built the engine that DSPy didn't give us.

> _[screenshot placeholder: a caption rendering with a trailing raw `$…` artifact]_

---

## 2. The reward — one number, three signals  ·  _(its own post)_

Every constraint is a pure function returning a score in `[0,1]`. They blend
into one reward, and a single threshold `τ` decides whether to retry. **Nothing
rejects** — a bad signal just scores low.

<svg viewBox="0 0 900 340" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">
  <defs>
    <marker id="a2" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#7c83ff"/>
    </marker>
    <style>
      .lbl{fill:#e8eaf6; font-size:13px; font-weight:600;}
      .sub{fill:#aab0d6; font-size:10.5px;}
      .edge{stroke:#7c83ff; stroke-width:2; fill:none; marker-end:url(#a2);}
      .det{fill:#14352a; stroke:#4cc38a;}
      .opt{fill:#2a2150; stroke:#8b7cff;}
      .comb{fill:#3a2a14; stroke:#d4a017;}
      .io{fill:#1a2740; stroke:#5b9bd5;}
      .note{fill:#7c8; font-size:10px;}
    </style>
  </defs>

  <!-- well-formedness -->
  <rect class="det" rx="9" x="20" y="30" width="210" height="64"/>
  <text class="lbl" x="125" y="56" text-anchor="middle">Well‑formedness</text>
  <text class="sub" x="125" y="74" text-anchor="middle">balanced $…$ / braces — string check</text>

  <!-- grounding -->
  <rect class="det" rx="9" x="20" y="118" width="210" height="64"/>
  <text class="lbl" x="125" y="144" text-anchor="middle">Grounding</text>
  <text class="sub" x="125" y="162" text-anchor="middle">CAS tiers → TIER_RANK / 4</text>

  <!-- judge -->
  <rect class="opt" rx="9" x="20" y="206" width="210" height="64"/>
  <text class="lbl" x="125" y="232" text-anchor="middle">LLM judge  (optional)</text>
  <text class="sub" x="125" y="250" text-anchor="middle">pedagogy score — never gates</text>

  <!-- combiner -->
  <rect class="comb" rx="10" x="330" y="110" width="240" height="96"/>
  <text class="lbl" x="450" y="140" text-anchor="middle">reward =</text>
  <text class="sub" x="450" y="162" text-anchor="middle">wellformed_factor ×</text>
  <text class="sub" x="450" y="178" text-anchor="middle">(W_G·grounding + W_J·judge)</text>
  <text class="note" x="450" y="198" text-anchor="middle">malformed ⇒ factor 0 ⇒ reward 0</text>

  <!-- threshold -->
  <polygon class="det" points="650,158 705,118 760,158 705,198"/>
  <text class="lbl" x="705" y="156" text-anchor="middle">≥ τ ?</text>

  <!-- outcome -->
  <rect class="io" rx="9" x="800" y="126" width="80" height="64"/>
  <text class="lbl" x="840" y="154" text-anchor="middle">pass /</text>
  <text class="lbl" x="840" y="172" text-anchor="middle">retry</text>

  <!-- edges -->
  <path class="edge" d="M230,62 C285,62 285,140 326,150"/>
  <path class="edge" d="M230,150 L326,158"/>
  <path class="edge" d="M230,238 C285,238 285,176 326,166"/>
  <path class="edge" d="M570,158 L646,158"/>
  <path class="edge" d="M760,158 L796,158"/>
</svg>

The weighting matters: **grounding dominates the judge** (`W_G=0.8`, `W_J=0.2`),
and well‑formedness is a near‑binary *prerequisite* — a malformed caption zeroes
the whole reward before the judge is even called. So a `Refuted` step or a broken
caption **can't clear `τ` even with a perfect judge**, while a merely `Plausible`
derivation just scores mid and gets another try.

| tier | score (`TIER_RANK/4`) |
|---|---|
| Grounded | 1.00 |
| Verified | 0.75 |
| Plausible | 0.50 |
| Unchecked | 0.25 |
| Refuted | 0.00 |

---

## 3. One checker per file — soft in the loop, hard at the edges  ·  _(its own post)_

Each constraint is a single pure function, in its own module. The same checker
has **two surfaces**: a *soft* score for the loop, and a *hard* raise for places
where there is no retry (hand‑authored JSON, tests).

```
backend/util/latex.py          reusable $…$ / $$…$$ scanner (no deps)
  └─ wellformed.py             well_formed() · assert_well_formed()
  └─ grounding_score.py        tier‑graded grounding via step_grounding
  └─ judge.py                  LLM‑as‑judge signature (score + issues)
  └─ reward.py                 blend + threshold τ
  └─ refine.py                 the loop: ask → score → re‑ask
```

The `$…$` scanner lives in `backend/util/` on purpose — it's a generic string
property (the chat panel and caption renderer share the same notion of
"balanced"), not something that belongs buried in the proof expert.

> _[screenshot placeholder: the unit‑test run — unbalanced `$` rejected, prose‑`$` accepted]_

---

## Watching it work — `--debug`

The derive CLI has a `--debug` flag that dumps every refinement attempt: the
score, the three reward signals, each step, and the feedback that would be
threaded into a retry. Here's the **power rule**, `d/dx x² → 2x`:

```text
./run.sh scripts/proof_completion_derive.py "\frac{d}{dx} x^2" "2x" --debug --attempts 3 --judge

── refine attempt 1/3 ──  score=1.000  PASS
   breakdown: wellformed=1.0 grounding=1.0 judge=1.0
   step 1 [rewrite]: 2 \cdot x^{2 - 1}
   step 2 [rewrite]: 2 \cdot x^{1}
   step 3 [rewrite]: 2 \cdot x
   notes: 3/3 steps verified · endpoint reached
refine done: 1 attempt(s), PASSED (best score 1.000)

=== derivation (LaTeX): 3 step(s) ===
   start :   \frac{d}{d x} x^{2}
   step 1:  🥇 2 \cdot x
   step 2:  🥇 2 \cdot x
   step 3:  🥇 2 \cdot x

result:
  steps convertible : 3/3
  math correct      : ✓    (final state reaches the target expression)
  exact graph       : ✓    (identical structure to the parsed target)
  step grounding    : 🥇🥇🥇
  confidence        : 🥇 Grounded    (3/3 steps verified · endpoint reached)
```

This is the **happy path** — and it shows three things:

- **All three signals are 1.0**, so the reward is
  `1.0 × (0.8·1.0 + 0.2·1.0) = 1.0`, which clears `τ=0.7`. The loop **PASSes on
  attempt 1 and stops** — `refine done: 1 attempt(s)`. No retry, so refinement
  cost *nothing* beyond the single prediction. (`--judge` is on here, so you can
  see `judge=1.0`; with it off, that term simply drops out.)
- **The dump shows the model's *raw* steps** — `2·x^{2-1}`, `2·x^1`, `2·x` — the
  power rule unfolding pedagogically. The `=== derivation ===` block below shows
  the **reconstructed, CAS‑verified** view, where all three collapse to `2·x`
  because SymPy evaluates the exponent arithmetic (`2-1 → 1`, `x¹ → x`). Same
  value, three teaching steps — which is exactly why every transition is
  🥇 and the overall confidence is **Grounded**.
- **Had a signal scored low, you'd see attempt 2, 3…** each re‑asked with the
  `notes`/issues line as feedback. (Earlier in this post: a `\lor` disjunction
  target floors `grounding` at 0.5, so the blend lands at 0.6 < τ and the loop
  retries — the judge being 1.0 can't rescue it.)

`--attempts N` raises the retry cap (handy for watching the loop iterate);
`--judge` adds the pedagogy signal to the reward.

> _[screenshot placeholder: the `--debug` dump in a terminal, PASS on attempt 1]_

---

## 4. Hand‑rolled vs DSPy Refine — a regime mismatch  ·  _(its own post)_

DSPy 3 ships a built‑in `Refine`. We tested it against our hand‑written loop.
They share the same skeleton — ask, score, keep the best — but differ in two
ways that turn out to matter a lot for *this* task.

<svg viewBox="0 0 920 360" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">
  <defs>
    <marker id="a3" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#7c83ff"/>
    </marker>
    <style>
      .lbl{fill:#e8eaf6; font-size:13px; font-weight:600;}
      .sub{fill:#aab0d6; font-size:10.5px;}
      .edge{stroke:#7c83ff; stroke-width:2; fill:none; marker-end:url(#a3);}
      .llm{fill:#2a2150; stroke:#8b7cff;}
      .det{fill:#14352a; stroke:#4cc38a;}
      .extra{fill:#3a1414; stroke:#e0707a;}
      .title{fill:#e8eaf6; font-size:14px; font-weight:700;}
      .good{fill:#4cc38a; font-size:11px; font-weight:600;}
      .bad{fill:#e0707a; font-size:11px; font-weight:600;}
    </style>
  </defs>

  <!-- divider -->
  <line x1="460" y1="20" x2="460" y2="340" stroke="#39406b" stroke-width="1" stroke-dasharray="4 4"/>

  <!-- LEFT: hand-rolled -->
  <text class="title" x="220" y="36" text-anchor="middle">Hand‑Rolled Refinement</text>
  <rect class="llm" rx="9" x="40" y="60" width="150" height="64"/>
  <text class="lbl" x="115" y="86" text-anchor="middle">Generate</text>
  <text class="sub" x="115" y="104" text-anchor="middle">temp 0.7</text>

  <rect class="det" rx="9" x="250" y="60" width="160" height="64"/>
  <text class="lbl" x="330" y="82" text-anchor="middle">Score (deterministic)</text>
  <text class="sub" x="330" y="100" text-anchor="middle">issues = exact reasons</text>

  <rect class="det" rx="9" x="150" y="200" width="200" height="58"/>
  <text class="lbl" x="250" y="224" text-anchor="middle">Feedback (free)</text>
  <text class="sub" x="250" y="242" text-anchor="middle">"step 3 → x=7 is refuted"</text>

  <path class="edge" d="M190,92 L246,92"/>
  <path class="edge" d="M330,124 L300,196"/>
  <path class="edge" d="M150,229 C90,229 90,130 110,124"/>
  <text class="good" x="220" y="290" text-anchor="middle">+1 LM call per retry · exact feedback</text>

  <!-- RIGHT: dspy refine -->
  <text class="title" x="700" y="36" text-anchor="middle">DSPy Refine</text>
  <rect class="llm" rx="9" x="520" y="60" width="150" height="64"/>
  <text class="lbl" x="595" y="86" text-anchor="middle">Generate</text>
  <text class="sub" x="595" y="104" text-anchor="middle">temp 1.0 (fixed)</text>

  <rect class="det" rx="9" x="730" y="60" width="150" height="64"/>
  <text class="lbl" x="805" y="86" text-anchor="middle">Score</text>
  <text class="sub" x="805" y="104" text-anchor="middle">a bare float</text>

  <rect class="extra" rx="9" x="620" y="200" width="220" height="58"/>
  <text class="lbl" x="730" y="222" text-anchor="middle">OfferFeedback  (extra LM call)</text>
  <text class="sub" x="730" y="240" text-anchor="middle">guesses blame from reward code</text>

  <path class="edge" d="M670,92 L726,92"/>
  <path class="edge" d="M805,124 L760,196"/>
  <path class="edge" d="M620,229 C560,229 560,130 590,124"/>
  <text class="bad" x="700" y="290" text-anchor="middle">+2 LM calls per retry · reverse‑engineered feedback</text>
</svg>

Two differences drive the result:

1. **Temperature.** DSPy Refine hard‑codes `temperature=1.0` on every attempt.
   Ours uses the configured `0.7`. For a task whose "good" output is *narrow*
   (valid LaTeX that's CAS‑convertible **and** grounded), hotter sampling
   produces more junk to filter.
2. **Feedback.** Ours hands the model the **exact** failing step and the CAS's
   reason. DSPy Refine can only see a **bare float** through its `reward_fn`, so
   it spends an extra LM call (`OfferFeedback`) trying to *reverse‑engineer* the
   blame from the reward function's source code. Strictly less signal, more cost.

> Neither approach remembers more than the **last** attempt's hint — each retry
> is fed a single distilled critique, not a transcript of every prior try. (With
> our `N=2`, that's moot; it would only bite at `N≥3`.)

---

## 5. The numbers  ·  _(its own post)_

Same 50 eval examples, DSPy 3.2.1, `N=2`, judge off. **No Refinement** is a single
pass; the other two each get one retry.

| metric | No Refinement | **Hand‑Rolled** | DSPy Refine |
|---|---|---|---|
| grounding | 0.941 | **0.975** | 0.939 |
| pass rate @ τ=0.7 | 0.880 | **0.940** | 0.900 |
| reaches target | 0.860 | **0.880** | 0.840 |
| step‑grounded | 0.979 | **0.995** | 0.963 |
| **LM calls** | 52 | **59** | 71 |

Both loops beat the single pass. Between them, **Hand‑Rolled wins on accuracy and
costs ~20% fewer LM calls.** DSPy Refine's *only* advantage is fewer lines of our
code — and claiming it would mean a breaking DSPy 3 upgrade to ship a measurably
worse pipeline.

| | winner |
|---|---|
| accuracy | **Hand‑Rolled** |
| cost (LM calls) | **Hand‑Rolled** |
| feedback precision | **Hand‑Rolled** |
| least code | DSPy Refine |
| no dependency upgrade | **Hand‑Rolled** |

**The lesson:** `Refine` is built for free‑form tasks where sampling *diversity*
helps and the reward is a simple property to re‑sample toward. Ours is the
opposite — narrow structured output, plus we already compute precise feedback its
interface can't accept. Same idea, different regime; the hand‑rolled loop fits
ours better.

> _[screenshot placeholder: the A/B comparison table from `compare_refine.py`]_

---

## Where it runs

The loop lives **inside** the expert (`module.forward`), so every path that
derives a proof gets it for free — the live proof‑animation endpoint, the derive
CLI, the optimizer's serving calls. The fallback is honest: after `N` tries it
keeps the best attempt, which **still renders**, tiered truthfully by the
confidence badges (#370). Refinement raises the *ceiling*; the badges keep the
*floor* honest.

> _[screenshot placeholder: a derivation in the app with per‑step confidence badges after refinement]_
