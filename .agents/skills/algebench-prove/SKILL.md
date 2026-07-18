---
name: algebench-prove
description: Interactively build a research-grounded mathematical proof or derivation — research the topic on the web (opt-in per source), confirm the derivation path, generate CAS-verified proof JSON via the algebench-proof-anim pipeline, save it under proofs/domains, and open it on the /prove page. Pass --research to stop at a copy-paste research summary + recommended prompt and (optionally) open a pre-filled Derive tab.
triggers:
  - algebench-prove
  - build a proof
  - prove this
  - research and prove
  - derive a proof
  - research a derivation
args: "[topic] [--research]"
---

# AlgeBench Prove

Take a user from *"I want to prove/derive X"* to a **rendered, research-grounded proof
on the `/prove` page**. This skill researches the topic on the web, confirms the
derivation path with the user, generates the CAS-verified trajectory using the
**algebench-proof-anim** pipeline (`derive.py` → `report.py --save-builtin`), saves it
under `proofs/domains/<domain>/<name>.json`, and opens `/prove?id=<domain>/<name>`.

See **[docs/shareable-proof-animations.md](../../docs/shareable-proof-animations.md)**
for the proof data model and **[.agents/skills/algebench-proof-anim/SKILL.md](../algebench-proof-anim/SKILL.md)**
for the generation pipeline this skill reuses. Follow **[AGENTS.md](../../AGENTS.md)**
for repo-wide rules (branch before changes, the user merges PRs, committer trailer).

## Operating principle: guide, don't guess

This skill is **interactive**. At **every** decision point, present concrete options via
`AskUserQuestion` (recommended default first), then act on the answer. Do the *research*
before proposing a path, and confirm the *math* (endpoints + route) before generating —
never silently invent a whole derivation and dump a file. The intermediate steps come
from `derive.py` (ProofCompletionExpert + CAS), not from hand-guessing.

## Modes

- **Full mode** (default): research → confirm → save-location → generate → open on `/prove`.
- **`--research` mode**: research → summarize → **stop before generation**. Output a
  copy-paste *recommended prompt* + *documentation*, then offer to open `/prove` with the
  Derive tab pre-filled (prompt + doc) but **not started**. See Step 6.

---

## Workflow

### 1. Pick the target

If the user already named a proof/derivation, restate it and move on. Otherwise
`AskUserQuestion`: *What do you want to prove or derive?* Offer a few concrete examples
if useful (e.g. "the quadratic formula", "the normalization constant of the normal
distribution", "the Tsiolkovsky rocket equation").

### 2. Understand the domain, then offer research

Identify the math **domain** (algebra, calculus, physics, quantum, series, …) and the
rough context. Then propose **reliable sources** and let the user opt **in/out per source
(or pick all)** via `AskUserQuestion` with **`multiSelect: true`**. A good default set:

- **Wikipedia** — broad, well-referenced overviews
- **Wolfram MathWorld** — precise definitions and identities
- **ProofWiki** — formal, step-by-step proofs
- **nLab** — higher/abstract-math framing
- **arXiv / lecture notes** — for research-level or applied derivations
- **Encyclopedia of Mathematics (EoM)** — authoritative reference

Recommend the 2–3 that best fit the topic (put them first). Respect the user's
selection exactly — research **only** the chosen sources.

### 3. Do the research

Use `WebSearch` / `WebFetch` against the **chosen sources only**. Enforce reliable-source
discipline and **capture citations** as you go — for each, record:

- `key` — short stable id (e.g. `wiki-normal-dist`, `mathworld-gaussian`)
- `type` — `online | textbook | paper | video`
- `text` — full human-readable citation (title + source + URL)
- `relevance` — one line on what it contributed

Prioritize **correctness**: every definition, identity, and proof outline you carry
forward must be mathematically accurate and traceable to a source.

### 4. Summarize the research

Give a concise, structured summary — definitions, key results/identities, and the
**candidate derivation(s)** — *without* writing out the step-by-step algebra yet. Include
the citations. This summary doubles as the **documentation** used later (Steps 6 & 8).

### 5. Confirm the derivation path (verbally, no algebra)

`AskUserQuestion`: confirm **what is derived from what** and the **high-level route** — in
words, not equations. Name the **start** and **target** explicitly (this is what the
generator needs). If the research surfaced **multiple valid starting points or alternative
routes** (e.g. Gaussian integral via polar coordinates *vs.* via the Gamma function),
present them as options and let the user choose. Do not proceed until start → target and
the route are confirmed.

### 6. `--research` short-circuit

If `--research` was passed, **stop here — generate nothing.** Output, clearly labeled:

- **`Recommended derivation prompt:`** a single natural-language prompt that would drive
  `proof_from_prompt` / `derive.py` (names the start, target, and route).
- **`Documentation:`** the structured research write-up from Step 4 (definitions, key
  identities, route, citations) — sized for the Derive tab (≤ 5000 chars).

Then `AskUserQuestion`: *Open `/prove` with the Derive tab pre-filled (prompt + docs), ready
for you to click Derive?*

If **yes**, hand off via the draft-prefill mechanism (local/DEBUG only). The draft is a
**markdown** file `/tmp/algebench/proofdraft/<docid>.md` — the documentation as markdown,
with optional YAML-style frontmatter carrying `prompt` and `domain`:

```bash
# 1) The server-owned drafts dir is a fixed path. Create it if missing.
DRAFTS=/tmp/algebench/proofdraft
mkdir -p "$DRAFTS"

# 2) Write the draft under a random opaque docid. The file is <docid>.md:
#    frontmatter (prompt + domain, each ONE line) then the markdown documentation.
DOCID="$(python3 -c 'import uuid;print(uuid.uuid4().hex[:16])')"
cat > "$DRAFTS/$DOCID.md" <<EOF
---
prompt: <recommended derivation prompt — single line>
domain: <domain>
---
<the documentation as markdown — definitions, key identities, route, citations>
EOF

# 3) Launch the /prove server WITH --debug (the prefill is DEBUG-gated) and open it.
./algebench --prove --debug --server-only --port <p> --skip-tour   # or preview_start name="prove"
# open:  http://localhost:<p>/prove?draft=<DOCID>
```

The page opens on the **Derive** tab with the prompt, documentation, and domain filled in
but **not run** — the user reviews and clicks **Derive** themselves. Skip all remaining steps.

> Why a `.md` file + token (not URL params): the documentation can be long, and passing a
> caller-supplied path would be a local-file-read vector. The skill writes the draft under a
> random `docid` in a fixed, server-owned dir; only the opaque token rides in the URL. The
> server validates the token (`^[A-Za-z0-9_-]{6,64}$`), reads `<docid>.md` itself, and
> parses the frontmatter — gated to DEBUG so the public `/prove` never reads local files.

### 7. Choose the save location (collision-checked)

Recommend a **kebab-case slug** and its path: `proofs/domains/<domain>/<name>.json`.
Slug rules (satisfy the store, the builder, and the `/prove` deep-link at once):

- **lowercase** letters/digits/hyphens only, two segments `<domain>/<name>`
- `domain` 2–32 chars, `name` 3–64 chars; no reserved names (`index`, `new`, `admin`,
  `api`, `null`, `undefined`)

**Check the name is free before offering it** — never overwrite:

```bash
test -e proofs/domains/<domain>/<name>.json && echo "TAKEN (seed)"      # committed seed
test -e .proof-store/domains/<domain>/<name>.json && echo "TAKEN (store)"  # runtime store
# If a /prove server is up, the API checks both stores at once:
#   GET /api/proofs/name-available?name=<domain>/<name>  → {"available": true|false}
```

`AskUserQuestion` to confirm the default slug. **If the user offers a different name,
re-run the collision check on that name** before accepting it. Loop until the chosen name
is free.

### 8. Generate the proof (reuse the algebench-proof-anim pipeline)

**Always use `derive.py`** to produce the trajectory — it runs the expert and CAS-verifies
each step. Do **not** hand-author the chain. (Needs `GEMINI_API_KEY` in `.env.local`.)
Feed it the confirmed prompt (or explicit start → target) from Step 5:

```bash
# from the confirmed prompt (carries the researched route):
./run.sh scripts/proof_animation/derive.py --prompt "<confirmed prompt>" \
    --domain <domain> --out <scratch>/anim.json
# …or explicit endpoints (most precise):
./run.sh scripts/proof_animation/derive.py "<START>" "<TARGET>" \
    --title "<Title>" --domain <domain> --out <scratch>/anim.json

# derive.py writes one ProofAnimation; report.py wants a one-entry list → wrap, then save
# (parse, rebase, CAS-grade, annotate terms) to the committed seed:
jq '[.]' <scratch>/anim.json > <scratch>/list.json
./run.sh scripts/proof_animation/report.py --from-file <scratch>/list.json \
    --save-builtin <domain>/<name>
```

Review the printed steps. If the math is wrong, adjust the prompt/endpoints and
**re-run** — never hand-edit `expr_latex` or the saved JSON (a malformed step fails
`assert_well_formed`; re-derive instead). This writes `proofs/domains/<domain>/<name>.json`.

### 9. Open it on `/prove`

Launch the `/prove` server and open the saved proof by id (`/prove?id=` finds both the
committed seed and the runtime store):

```bash
./algebench --prove --server-only --port <p> --skip-tour      # or preview_start name="prove"
# open:  http://localhost:<p>/prove?id=<domain>/<name>
```

Verify with the preview tools that the page loaded that proof (Derive is not needed here —
the proof opens as its own tab). Screenshot as proof it rendered.

### 10. Confirm or iterate

Final `AskUserQuestion`: *Looks good / revise a step / rename / build another?* Loop back
to the relevant step. On "revise", re-derive (Step 8) with an adjusted prompt/endpoints —
don't hand-edit. On "rename", re-run the collision check (Step 7) and re-save.

---

## Submission & review lifecycle (what to tell users)

There are **two ways** a proof reaches the public `/prove` catalog. Know both, and
explain the second to any user who builds a derivation in the Derive tab and wants it
published:

1. **Authored + committed** (this skill): you write
   `proofs/domains/<domain>/<name>.json`, it's merged via PR (the user merges), and it
   ships as a **built-in** — canonical, always in Browse.
2. **Public submit-for-review** (no accounts, the `/prove` Derive tab): a user derives a
   proof and clicks **↑ Submit**. It lands in a **review queue**, *not* in Browse, until a
   maintainer promotes it. This is the path to describe below.

**The submission lifecycle:**

- **Submit.** In Derive, **↑ Submit** → a dialog asks for a **new unique name**
  (`<domain>/<name>`, checked live against built-ins + published + other pending
  submissions, so it can never collide). On success the proof + its package (the derive
  **prompt**, **documentation**, references) is written to the review queue
  (`proof-submissions/…`), never to `proofs/`.
- **Pending (under review).** The submission is **hidden from Browse by default**. It's
  reachable two ways: the **direct link** `/prove?id=<domain>/<name>`, or Browse → tick
  **"Show proofs under review"** (it shows with an *under review* badge). Nothing is public
  yet.
- **Promotion.** A maintainer reviews and promotes it into `proofs/` (an admin/offline
  step). Only then does it appear in Browse for everyone. Once promoted it's a normal
  published proof — **clone-only** (see the key rules below).

**The edit key — tell users to save it.** On submit (and after every update) the thank-you
dialog shows a **one-time edit key** (with a Copy button). It's the *only* handle to edit a
pending submission and is **never stored server-side / never shown again**. It's a hash of
the proof content, so it **rotates whenever the proof changes**.

To **use** the key: open the pending submission (direct link, or Browse with the toggle) →
click **✎ Edit** → paste the key → it loads into Derive in edit mode (prompt + docs
restored, Submit becomes **↑ Update**). Adjust / Rederive → **↑ Update** saves in place and
shows the new rotated key.

**Two rules to state plainly:**

- **Edit only while pending.** The ✎ Edit button exists *only* while the submission is in
  the review queue. Once **approved/promoted**, the key no longer edits anything — the proof
  is **clone-only** (⧉ Clone → tweak → submit under a new name). Lose the key while it's
  still pending and you're also down to cloning.
- **Versioning.** In the submit dialog, keeping the **same name** updates your pending
  submission; typing a **new name** files a **separate** version for review. One Derive
  session can spawn several named versions, each with its own key.

If a user "can't find" their submission, it's almost always the default-hidden queue — point
them at the direct link or the *Show proofs under review* toggle; the proof is safe.

---

## Notes

- **Correct path** is `proofs/domains/<domain>/<name>.json` — a single `domains/<domain>`
  segment (not `domains/domains/...`).
- **`/prove?id=`** serves the committed seed and the runtime `.proof-store`, deduped by id
  (seed wins on a clash).
- **Safety:** proof JSON is rendered as **untrusted** — KaTeX with trust limited to
  `\htmlData`, human text via `textContent`, strict CSP. Generate via the script so the
  `\htmlData` term ids stay valid and the animation morphs correctly.
- **DEBUG for prefill:** the Step-6 Derive-tab prefill only works when the server runs with
  `--debug` (it's DEBUG-gated so the public `/prove` never reads local files). The `id=`
  open in Step 9 does not need debug.
- **Never commit** the generated proof unless the user asks — offer it, and let them decide
  (the user merges PRs; see AGENTS.md).
