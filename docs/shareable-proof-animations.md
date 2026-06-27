# AlgeBench Shareable Proof Animations

> Design document for a shareable, embeddable proof-animation page that renders pre-baked proof
> JSON entirely client-side, with no backend round-trip after the initial load.

**Related docs:**

- [architecture.md](architecture.md) — Overall project architecture
- [proofs-model.md](proofs-model.md) — The step-by-step proof & derivation model
- [semantic-graph-visualization.md](semantic-graph-visualization.md) — Graph rendering the proof animator links to
- [sandbox-model.md](sandbox-model.md) — Expression evaluation and trust model (the security philosophy this doc extends)
- The engine: [`static/proof-animation/proof-animation.js`](../static/proof-animation/proof-animation.js) — the `ProofAnimator` class

---

## 1. Overview & Goals

AlgeBench already has a self-contained proof-animation engine — `ProofAnimator` in
`static/proof-animation/proof-animation.js`. Given a plain JSON `data` object plus a KaTeX handle,
it renders an interactive, morphing derivation (FLIP animation between steps) with `liveTerms`
hover highlights and per-term tooltips. **Once it has the data, it needs no backend.**

Today that engine is reachable only two ways: docked on semantic-graph nodes inside the main app,
and via a local-only test harness (`scripts/proof_animation/report.py`) that writes a throwaway
page to `/tmp`. There is no stable, shareable URL.

This document specifies a **shareable, embeddable** surface:

- A stable URL — `https://algebench.org/renderproof?builtin=<domain>/<name>` — that loads one or
  more pre-baked proof JSONs and renders them.
- **Zero backend contact after the initial load** (same guarantee as the existing proof-anim page).
- **Embeddable** into any third-party page as an `<iframe>`, with an in-page control to copy the
  embed snippet.
- A skill (`algebench-proof-anim`) that lets the agent research a proof, confirm it with the user,
  and generate the proof JSON into the repo.

### Phasing

- **Phase 1 (this design):** built-in proofs that live in the repo under `proofs/domains/…`,
  loaded by a `builtin=` query parameter.
- **Phase 2 (designed here, not built yet):** loading from arbitrary `url=` / `repo=` sources via
  a security-controlled server-side proxy. See [§8](#8-phase-2--external-sources-design-only).

### The overriding constraint: safety

Hand-editing a proof JSON, or hosting a deliberately hostile one, **must not** enable script
execution, HTML injection, prompt injection, or any other escape. Because there is no backend
round-trip after load, **all safety lives in the load → parse → render path**. [§7](#7-security-model)
is the heart of this document.

---

## 2. URL Contract

| Form | Meaning |
| --- | --- |
| `/renderproof?builtin=<domain>/<name>` | Render one built-in proof from `proofs/domains/<domain>/<name>.json` |
| `/renderproof?builtin=a/x&builtin=b/y` | Render multiple proofs, each in its own card, stacked vertically |
| `/renderproof?builtin=a/x,b/y` | Comma-separated convenience form (equivalent to repeated params) |
| `&theme=<dark\|light\|auto>` | Optional. Page + card theme. Defaults to `dark`; `auto` follows the viewer's OS preference. |

The `builtin` value must match `^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$` — exactly one `domain/name`
segment pair, no `..`, no extra slashes. Anything else is rejected before any fetch (see
[§7](#7-security-model)). The number of proofs per page is capped (default ≤ 12). `theme` is
validated against the `{dark, light, auto}` allowlist; anything else falls back to `dark`.

**Embedding.** When viewed top-level, an **Embed** button reveals a panel with a **theme picker**
(updates the live page and the snippet), a **Preview** button (opens a throwaway mock article with
the embed in context), the copyable snippet, and a **Copy** button. The snippet's `src` is built
from `location.origin`, so it is **environment-specific** — a dev box emits a `localhost` URL,
staging emits the staging host, production emits the production host — with the chosen `theme`
baked in.

The snippet is an `<iframe data-algebench-embed>` plus a companion
`<script src="<origin>/embed-resizer.js" async>` (served by the `/{name}.js` allowlist). The
embedded page posts its content height to the host; the resizer sizes the iframe to fit, so there
is no top/bottom dead space and it adapts as the reader steps through the proof. When viewed inside
an iframe the page also trims its chrome to the proof (no header; the full-screen control becomes a
small corner icon) and shows **Full screen** (a new tab) instead of the embed panel.

**Phase 2** will add `url=<https-url>` and `repo=<owner/repo>&path=<file>` forms, routed through a
proxy ([§8](#8-phase-2--external-sources-design-only)).

---

## 3. Data Model (reused as-is)

A built-in proof file is **exactly one animation dict** as produced by `build()` / `build_animation()`
in `backend/experts/handlers/proof_animation/animation.py` — the same shape `ProofAnimator` already
consumes. No new schema is invented; we store the engine's existing output verbatim.

```jsonc
{
  "title": "Isolate a",
  "domain": "algebra",
  "steps": [
    {
      "index": 0,
      "operation": "Given the equation",       // human text, may carry inline $…$
      "justification": "solve for $a$",         // human text, may carry inline $…$
      "input_latex": "a + b - c = 0",           // raw, for fallback
      "latex": "\\htmlData{n=a_1}{a} …",        // SERVER-annotated: \htmlData{n=<id>}{…} per glyph
      "plain": "a + b - c = 0",                 // un-annotated, for labels
      "confidence": { "tier": "verified", "label": "SymPy verified", "icon": "✓", … }
    }
  ],
  "terms": {
    "a_1": { "latex": "a", "name": "a", "description": "the variable being isolated" }
  },
  "overall_confidence": { "tier": "…", "label": "…", "counts": { … } }
}
```

Key property: the `latex` field is **server-generated** by `to_latex(cand, with_ids=True)`; the
`\htmlData{n=<id>}` wrappers and their ids come from the deterministic graph/rebase pipeline, never
from free user input. This is what makes the animation's term correspondence stable across steps —
and it is also what the security model relies on ([§7](#7-security-model)).

---

## 4. Built-in Proof Storage

- New repo-root directory: **`proofs/domains/<domain>/<name>.json`**, one animation dict per file.
- Resolved server-side alongside the existing `scenes_dir` pattern (`backend/server.py:36-37`):
  ```python
  proofs_dir = script_dir / "proofs"
  ```
- At least one sample is committed for testing (e.g. `proofs/domains/algebra/isolate-a.json`).

This directory is **public, served data** — treat every file in it as if a stranger wrote it. The
render path makes no trust assumptions about its contents.

---

## 5. Server Routes (`backend/server.py`)

| Route | Behaviour |
| --- | --- |
| `GET /renderproof` | Serve `static/renderproof.html` with the same placeholder injection as `get_index` (`server.py:1409-1427`). Attach the **strict CSP** below. |
| `GET /proofs/{path:path}` | `sanitize_path(proofs_dir, path)`, **`.json` only**, 404 otherwise; `application/json`; `no-store`. Mirrors `/domains/{path}` (`server.py:1999-2005`) and the `load_builtin_scene` confinement (`server.py:583-606`). |
| `GET /api/proofs` *(optional, deferrable)* | Walk `proofs/` and list available `domain/name` ids, for a future picker. Not required for Phase 1. |

`renderproof` must also be added to **`_TOP_LEVEL_MODULES`** (`server.py:1474`) so `/renderproof.js`
serves — omitting it 404s the module (a known gotcha).

The engine (`proof-animation.js` / `.css`) is already served via `/proof-animation/{name}`
(`server.py:1882`); it is reused, not copied.

### Content-Security-Policy on `/renderproof`

```
default-src 'self';
script-src 'self' https://cdn.jsdelivr.net;
style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline';
font-src 'self' https://cdn.jsdelivr.net data:;
img-src 'self' data:;
connect-src 'self';
frame-ancestors *;
object-src 'none';
base-uri 'none'
```

`frame-ancestors *` lets the page be embedded anywhere. `cdn.jsdelivr.net` is allowed only for
KaTeX (the same source the rest of the app uses); there is still **no `unsafe-eval` and no inline
script** — the page logic loads as an external module. Safety rests on the renderer's guards
([§7](#7-security-model)), not on asset origin.

---

## 6. Assets

KaTeX loads from `cdn.jsdelivr.net` (pinned to 0.16.9, the version the rest of AlgeBench already
uses) — there's no reason to vendor it just for this page. The proof engine
(`proof-animation.js` / `.css`) is served same-origin via the existing `/proof-animation/{name}`
route. The page logic (`renderproof.js`) is a same-origin ES module; CSP forbids inline script, so
all page code is auditable files, never inline.

---

## 7. Security Model

The threat: a **hostile or hand-edited proof JSON**. Defenses are layered so no single failure is
catastrophic.

### 7.1 KaTeX trust filter — the primary gate

All math is rendered through KaTeX, which is the only HTML-generating engine in the path.
`ProofAnimator` already renders with:

```js
this.katex.render(latex, host, {
  throwOnError: false, displayMode: true, strict: false,
  trust: (ctx) => ctx.command === "\\htmlData",   // ← only \htmlData is trusted
});
```

This blocks `\href`, `\includegraphics`, `\htmlClass`, `\htmlId`, etc. from any user-supplied
`latex`. `\htmlData` itself only emits inert `data-*` attributes.

**Audit result:** `proof-animation.js` has two render sites. The main step render
(`proof-animation.js:651`) sets `trust: ctx => ctx.command === "\\htmlData"`. The inline caption /
tooltip render (`proof-animation.js:1354`, used for `$…$` in `operation`/`justification`/
descriptions) passes **no** `trust` option, so KaTeX defaults to `trust:false` — *stricter* still
(nothing is trusted). Both sites are safe; the most permissive thing any proof JSON can produce is
inert `\htmlData` data-attributes. No code change was required.

### 7.2 textContent only — no HTML injection

No JSON-derived string is ever assigned to `innerHTML`. Titles, operation/justification captions,
and labels use `textContent` (the engine and the report harness already do this). `renderproof.js`
follows the same rule.

### 7.3 CSP backstop

Even if a string slipped past the filter, the CSP forbids `unsafe-eval` and inline script, and
limits remote script to `cdn.jsdelivr.net` (KaTeX) — so an injected `<script>` (inline or pointing
at an arbitrary origin) cannot execute. This is the defense-in-depth backstop; the renderer's KaTeX
trust filter + textContent ([§7.1](#71-katex-trust-filter--the-primary-gate)–7.2) are the primary
gates that stop injection in the first place.

### 7.4 Path-traversal — double-gated

`builtin` is validated client-side against the strict regex, and the server independently confines
reads with `sanitize_path(proofs_dir, …)` plus a `.json` suffix allowlist. Either gate alone
rejects `../`, absolute paths, and symlink escapes.

### 7.5 Resource exhaustion

A size cap on `/proofs` responses (server) and caps on proof/step/term counts (client, in
`validateProofData`) bound the work a single page can trigger.

### 7.6 Schema sanitization (defense-in-depth)

Before any payload reaches `ProofAnimator`, a local `validateProofData()` in `renderproof.js`
whitelists known fields, requires `steps`/`terms` to be the expected array/object of strings, drops
unknown keys, and enforces the count caps. Malformed JSON never reaches the engine.

### 7.7 Prompt injection (relevant to Phase 2)

In Phase 1 proof content is **only rendered, never sent to a model**, so prompt injection is not a
render-time concern. It is recorded here so Phase 2 honors it: shared proof text must never be
auto-fed into an LLM context without isolation.

---

## 8. Local Launch Flow — `./algebench --proof <domain>/<name>`

`./algebench` execs `backend/server.py "$@"`, so jumping straight to a proof on launch is a pure
`server.py` change:

- Add `--proof` in `main()` (next to the `scene` arg, `server.py:2366`), validated against
  `^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$` (reject + non-zero exit otherwise).
- Thread it into `serve_and_open` as `initial_proof=…`. When set, build
  `url = f"http://localhost:{port}/renderproof?builtin={quote(proof)}"` instead of the default `/`
  (the existing url block at `server.py:2272-2302`), then `webbrowser.open(url)`.
- Mutually exclusive with `scene` (proof wins, or error if both given).

---

## 9. Frontend Page

- **`static/renderproof.html`** — a minimal shell adapted from `report.py`'s `_INDEX`
  (`scripts/proof_animation/report.py:73-127`), pointing at CDN KaTeX
  (`cdn.jsdelivr.net/npm/katex@0.16.9`) and the same-origin engine
  (`/proof-animation/proof-animation.{js,css}`). A `#root`
  container, light/dark via `prefers-color-scheme`, and an embed/fullscreen control bar.
- **`static/renderproof.js`** (new top-level module) holds the only new logic:
  1. Parse + validate every `builtin` param (regex above); reject with a non-executing
     `textContent` error; cap proof count.
  2. Fetch `/proofs/domains/${builtin}.json` (`cache: 'no-store'`); enforce response-size cap.
  3. `validateProofData()` schema-sanitize each payload ([§7.6](#76-schema-sanitization-defense-in-depth)).
  4. Render one card per proof: `new ProofAnimator(card, data, { katex: window.katex, liveTerms: true })`.
  5. Embed/fullscreen bar: if `window.self === window.top` → **"Embed"** button revealing a copyable
     `<iframe src="<this-url>" …>` snippet; else → **"Full screen"** button doing
     `window.open(location.href, '_blank')`.

---

## 10. Skill — `algebench-proof-anim`

- Lives at `.agents/skills/algebench-proof-anim/SKILL.md`, symlinked from
  `.claude/skills/algebench-proof-anim` with a **relative** symlink
  (`../../.agents/skills/algebench-proof-anim`). The name is prefixed to avoid user-level skill
  shadowing (project convention).
- The skill is **interactive and `AskUserQuestion`-driven** — it does not silently guess. At each
  decision point it presents concrete options (with a recommended default first) via
  `AskUserQuestion`, then acts on the answer. The arc:
  1. **Research** the derivation. The agent proposes the proof topic, the step chain, and per-step
     justifications, then uses `AskUserQuestion` to confirm/adjust: *Is this the right derivation?
     Which domain? Add/remove/reorder steps? Tighten any justification?*
  2. **Name it.** `AskUserQuestion` to confirm the `<domain>/<name>` slug (recommend a kebab-case
     default derived from the title; show where the file will land).
  3. **Generate** the JSON by reusing the existing pipeline — `ProofTrajectory` →
     `assert_well_formed()` → `build()` → `_describe_terms()` (in `scripts/proof_animation/report.py`
     + `animation.py`) — and write it to `proofs/domains/<domain>/<name>.json`.
  4. **Show it live.** Launch the app with the new flag — `./algebench --proof <domain>/<name>` —
     so the browser opens straight onto the rendered animation. The agent reports the share URL
     `…/renderproof?builtin=<domain>/<name>` and offers a final `AskUserQuestion`: *Looks good /
     revise a step / rename / add another proof?* — looping back as needed.
- **Reuse, don't duplicate:** add a `--save-builtin <domain>/<name>` flag to
  `scripts/proof_animation/report.py` (or a thin `make_builtin.py`) that writes the single
  built+described animation dict to the proofs dir. Run via `./run.sh` per project convention. The
  launch step in (4) is exactly the `--proof` flow from [§8](#8-local-launch-flow--algebench---proof-domainname).

---

## 11. Phase 2 — External Sources (design only)

`url=` / `repo=` loading. The strict `connect-src 'self'` CSP intentionally blocks arbitrary
client-side fetches, so Phase 2 adds a **server-side proxy** (e.g. `GET /api/fetch_proof?url=…`)
that:

- allowlists hosts (and/or restricts to raw GitHub),
- blocks private / link-local / loopback IPs (SSRF protection),
- enforces a response-size cap,
- JSON-parses and runs the **same `validateProofData` schema gate** server-side,
- re-serves the sanitized result **same-origin**.

This keeps the strict CSP and the single trusted render path intact regardless of where the proof
came from — the renderer never knows or cares about the original source.

---

## 12. Verification

0. `./algebench --proof algebra/<sample>` opens the browser straight to
   `/renderproof?builtin=algebra/<sample>`; `--proof "../../etc"` is rejected before launch.
1. Open `/renderproof?builtin=algebra/<sample>` — proof renders, steps morph on click, term hover
   shows backlight + tooltip.
2. Multi-proof: `?builtin=algebra/<a>&builtin=algebra/<b>` → two stacked cards.
3. Embed UX: top-level shows the **Embed** button with a working iframe snippet; embedding that
   snippet shows **Full screen** instead and makes no post-load network calls.
4. Security:
   - `GET /proofs/../backend/server.py` and `?builtin=../../etc/passwd` → 404 / rejected.
   - A proof JSON with `latex` containing `\href{javascript:alert(1)}{x}` and an `operation`
     containing `<img src=x onerror=alert(1)>` renders inertly (no alert, no injected node).
   - The CSP header on `/renderproof` has no `unsafe-eval` and no inline script (script-src is
     `'self' https://cdn.jsdelivr.net`).
5. Skill: run the generator on a known trajectory; confirm it writes a valid
   `proofs/domains/<domain>/<name>.json` that loads via the URL above.
