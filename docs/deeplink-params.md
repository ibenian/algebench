# Deeplink & URL parameters

AlgeBench has **two** URL surfaces that take query parameters:

1. **The full app** (`/?…`) — a *view state* deeplink that restores a lesson view:
   scene/step, proof, selected graph nodes, camera, panels, etc. Used by share
   links, nav history (back/forward), and the proof "Ask AI" / scene-linking flow.
   Source of truth: [`static/view-state.js`](../static/view-state.js)
   (`parseViewState` / `serializeViewState`), applied by
   [`static/view-state-bridge.js`](../static/view-state-bridge.js) (`applyViewState`).

2. **The shareable proof page** (`/renderproof?…`) — renders one or more pre-baked
   proof animations standalone (and is what the blog embeds load in an iframe).
   Source of truth: [`static/renderproof.js`](../static/renderproof.js).

---

## 1. Full-app view-state params (`/?…`)

| Param | Example | Default | Meaning | Serialized? |
|---|---|---|---|---|
| `builtin` | `builtin=eigenvalues` | — | Built-in lesson name (a `scenes/<name>.json`). | ✅ |
| `scene` | `scene=scenes/foo.json` | — | Custom scene file path (alternative to `builtin`). | ✅ |
| `view` | `view=math` | `scene` | `math` → the semantic-graph (Math) tab; otherwise the 3D scene. | ✅ |
| `panel` | `panel=chat` | `doc` | Right panel tab: `chat` → AI chat; otherwise the doc. | ✅ |
| `pp` | `pp=1` | off | Proof panel open. | ✅ |
| `dock` | `dock=1` | (user pref) | Graph **docked** (split) view — the semantic graph shown alongside the 3D viewport. `dock=1` forces split (and implies the Math view); `dock=0` forces full. **Absent leaves the user's own persisted dock preference untouched.** | ✅ (only when on) |
| `sc` | `sc=intro` | — | Scene id (resolved hybrid: id → slug(title) → index). | ✅ |
| `st` | `st=expand` | base step | Step id; absent ⇒ the scene's base step. | ✅ |
| `pf` | `pf=allen_eggers_velocity` | — | Proof id (within the lesson). | ✅ |
| `ps` | `ps=velocity-as-a-function-of-altitude` | goal | Proof step id; absent ⇒ the goal. | ✅ |
| `nodes` | `nodes=a,b,c` | — | Ordered semantic-graph selection (CSV). **Last = active/focus.** | ✅ |
| `sl` | `sl=t~1.5,k~2` | — | Slider overrides, `id~value,…`. | ✅ |
| `cv` | `cv=iso` | — | Selected camera-view preset. | ✅ |
| `proj` | `proj=orthographic` | `perspective` | Camera projection. | ✅ |
| `oz` | `oz=3.2` | — | Orthographic visible half-height (world units). | ✅ |
| `cam` | `cam=px,py,pz,tx,ty,tz[,ux,uy,uz]` | — | Exact camera (data-space): position + target, optional up. | ✅ |
| `aa` | `aa=<question>` | — | **Auto-ask** — a chat message fired ONCE on boot. | ❌ (boot-only) |
| `pa` | `pa=physics/allen-eggers-entry` | — | **Pre-baked proof animation** to load ONCE on boot. | ❌ (boot-only) |
| `pas` | `pas=3` | step 0 | **Pre-baked animation step** (with `pa`) — the derivation step the learner was viewing. | ❌ (boot-only) |

**Serialized** params round-trip into share links and nav history (they describe the
restorable view). The two **boot-only** directives below do not.

### Boot-only directives (`aa`, `pa`)

`aa` and `pa` are **fire-once** instructions, not part of the shareable view. They
are parsed on boot, acted on, and then **stripped from the URL** by the post-apply
`replaceView()` (because `serializeViewState` deliberately omits them). This is what
prevents them from re-firing on reload or back/forward, and keeps a long encoded
question out of the address bar.

- **`aa=<question>`** — opens the chat panel and sends `<question>` once
  (`view-state-bridge.js` → `sendChatMessage`). Capped at 2000 chars. Treated like a
  user-typed message (not eval'd, not inserted as HTML). Applied even when no lesson
  is in the URL (the default scene still gets it).
- **`pa=<domain>/<name>`** — fetches `/proofs/domains/<domain>/<name>.json`, validates
  it, and **docks the pre-baked proof animation** on the graph anchored to the last
  `nodes=` node — *without* an LM re-derivation. Requires the Math view (it's forced
  on when `pa` is present). Best-effort: a missing/malformed proof is a silent no-op.
- **`pas=<n>`** — with `pa`, opens that docked animation on step `<n>` (the derivation
  step the learner was on when they clicked), rather than step 0. The engine appends
  it to the deeplink at click time from the proof animation's current step.

---

## 2. Shareable proof page params (`/renderproof?…`)

| Param | Example | Default | Meaning |
|---|---|---|---|
| `builtin` | `builtin=algebra/quadratic-formula` | — | Proof slug `<domain>/<name>` under `proofs/domains/`. **Repeatable** (or comma-separated) to show several proofs on one page. |
| `theme` | `theme=light` | `dark` | `dark` \| `light` \| `auto` (follows OS). |
| `explore` | `explore=0` | **on** | Prerequisite / "Explore further" chips. Opt **out** with `0`/`false`/`no`. |
| `ai` | `ai=1` | **off** | Term-level AI: hovering a term shows an "Ask AI" button. Opt **in** with `1`/`true`/`yes`. |
| `autoplay` | `autoplay=true` or `autoplay=1` | off | `true`/`all`/`yes` plays every proof; a bare integer plays only that 1-indexed proof. |
| `full` | `full=prove` | renderproof | Where the **full-screen button** opens (embedded only). `prove` → the editable `/prove?id=<first builtin>` page; anything else → this standalone renderproof view. |

When embedded in an iframe the page detects it (`window.self !== window.top`) and
adapts (full-screen button, height auto-resize via `embed-resizer.js`). The
full-screen button's destination is chosen by the **host** page via `full=`
(the button lives in the renderproof chrome, not the embedded proof widget).

---

## 3. The proof `deeplink` field (scene-linking)

A pre-baked proof JSON (`proofs/domains/<domain>/<name>.json`) may carry an optional
**`deeplink`** — a full-app view-state URL the proof's AI exploration opens. It can
sit at the proof level and/or be overridden per step:

```jsonc
{
  "title": "Allen–Eggers entry velocity",
  "deeplink": "/?builtin=atmospheric-entry-physics&view=math&panel=chat&pp=1&sc=trajectory-and-the-entry-corridor&st=computed-corridor&pf=allen_eggers_velocity&ps=velocity-as-a-function-of-altitude&nodes=__equals_1&pa=physics/allen-eggers-entry",
  "steps": [
    { "index": 1, "operation": "…", "deeplink": "/?…&st=other-step" }
  ]
}
```

**Sanitization** (`validateProofData` in
[`static/proof-animation/validate-proof.js`](../static/proof-animation/validate-proof.js)):
the value must be a **same-origin relative URL** — start with `/` or `?`, ≤ 1024 chars,
no scheme (`javascript:`, `http:`, …) and no protocol-relative `//host`. The hash is
dropped. Anything else is discarded (the click then falls back to the app's main page).

> Note the host is **never** stored — it's filled in at click time from
> `window.location.origin`, so the same proof works in dev (`localhost:5751`) and prod
> (`algebench.org`) automatically.

### How a click composes the URL

When a learner clicks a term's "Ask AI" button (or a prerequisite/follow-up chip), the
ProofAnimator (`_askTargetUrl` in
[`proof-animation.js`](../static/proof-animation/proof-animation.js)) builds:

- **with a `deeplink`** → `<deeplink>` + `panel=chat` + `aa=<question>`
  (lands on the linked scene/step, loads the pre-baked animation via `pa`, asks);
- **without** → `/?panel=chat&aa=<question>` (the app's main page + chat + question).

Routing by context: **in-app** → ask in the existing chat; **embedded** → open the
app in a **new tab**; **standalone** → navigate the current tab.

---

## 4. Worked example

The Allen–Eggers proof embedded on the blog. A click on a term opens:

```
http://localhost:5751/?builtin=atmospheric-entry-physics
    &view=math&panel=chat&pp=1
    &sc=trajectory-and-the-entry-corridor&st=computed-corridor
    &pf=allen_eggers_velocity&ps=velocity-as-a-function-of-altitude
    &nodes=__equals_1
    &pa=physics/allen-eggers-entry
    &aa=<the term question>
```

On boot the app: loads the atmospheric-entry lesson, opens the Math view, navigates to
the scene/step, opens the Allen–Eggers proof at its velocity step, selects node
`__equals_1`, **docks the pre-baked proof animation** (no LM call), opens chat, and
fires the question — then strips `aa`/`pa` from the URL.
