# Knowledge Graph Explorer

A reusable, reactive graph explorer, with one implemented graph type: the
**Knowledge Graph** of concepts that lessons teach. It opens from the status bar
(**Knowledge Graph**) as a cross-lesson graph, and from a lesson's Doc tab (**Knowledge
Graph** section) when that lesson has a `knowledgeGraph` block.

Demo lesson: `scenes/draft/sliding-window-maximum.json`
(`?builtin=draft/sliding-window-maximum`, launch config `knowledge-graph-demo`).

## Architecture

AlgeBench owns the knowledge data, the engine manages that data and its
changes, the view model manages exploration state, and Cytoscape only draws
the result.

```
lesson JSON ──► /api/knowledge-graph ─┐
lesson load ──► algebench:lessonload ─┤   parse + validate (knowledge-model.ts)
runtime update ► applyUpdate() ───────┘            │ one batch
                                                   ▼
                        GraphEngine  (graph-engine.ts)  ← source of truth
                          │ GraphPatch (ids added/updated/removed)
              ┌───────────┴───────────┐
              ▼                       ▼
     GraphViewModel "global"   GraphViewModel "lesson:<id>"   (view-model.ts)
              │ ViewPatch (visible-subgraph diff, anchor)
              ▼
     CytoscapeGraphView (cy-view.ts)  ←→  GraphExplorer UI (explorer.ts)
              ▲                                │ mount(host, mode)
     GraphTypeAdapter (knowledge-adapter.ts)   ▼
                                   embedded slot │ popup │ fullscreen
```

| Layer | File | Owns | Knows about Cytoscape? |
|---|---|---|---|
| Graph engine | `src/graph-explorer/graph-engine.ts` | nodes, typed directed edges, adjacency indexes, batching, subscriptions | no |
| Knowledge model | `src/graph-explorer/knowledge-model.ts` | concept/relation payloads, lesson-block validation, cross-lesson merge | no |
| View model | `src/graph-explorer/view-model.ts` | focus, selection, expansions, visible subgraph, history, filters, presentation mode, viewport, positions | no |
| Graph-type adapter | `src/graph-explorer/graph-type.ts`, `knowledge-adapter.ts` | labels, classes, search text, details HTML, legend | no |
| Element conversion | `src/graph-explorer/cy-elements.ts` | records → Cytoscape element definitions; stable ring placement | shape only (no import) |
| View | `src/graph-explorer/cy-view.ts` | the Cytoscape instance, incremental sync, gestures | **yes — the only module** |
| Component | `src/graph-explorer/explorer.ts` | toolbar, search, details panel, keyboard, mode buttons | via the view |
| App wiring | `src/graph-explorer/knowledge-app.ts` | the shared store, status-bar entry, lesson section, layer, navigation | no |

### Graph engine

- `Map` for nodes and edges, plus `out`/`in` adjacency indexes (node id → edge
  ids). Lookup and one-hop neighbours are O(1) per hop; a mutation touches only
  the records involved — nothing copies the graph.
- `addNode`/`addEdge` reject invalid or duplicate ids; `upsertNode`/`upsertEdge`
  merge through a caller-supplied function; an edge id reused for a different
  `(source, type, target)` is an error.
- `removeNode` removes incident edges. Removed records travel whole in the patch
  so a renderer can still clean up.
- `batch(fn)` coalesces any number of mutations into **one** `GraphPatch`
  (add+remove inside a batch cancels). Lesson merges and runtime updates are
  single batches.
- `neighborhood(seeds, depth, {dir, limit, edgeFilter})`: BFS that visits each
  node once (cycles, shared neighbours) and stops at `limit`.

### View model

One instance per explorer context (`global`, `lesson:<id>`), all over the same
engine. Visibility is the **union** of the expanded neighbourhoods (`roots`:
node id → hop radius; the focus is one of them), recomputed on change and
published as a diff. Collapsing therefore never removes a node another
expansion still reaches. Visible nodes are capped (`maxVisible`, default 250);
when the cap bites, the focus's own neighbourhood survives and the status line
says the view is limited.

Data mutations (engine patches) and presentation changes are separate paths:
`setPresentation`, `saveViewport`, `savePosition`, selection, and back/forward history never
touch the engine, and engine changes never reset exploration state (they only
repair it if, say, the focused node is removed).

### Presentation modes

One `GraphExplorer` per context, moved between hosts by `mount(host, mode)`:

- **embedded** — the lesson's Doc tab (`#lesson-kg-slot`), compact toolbar. The section folds to its header like the chat panel's Proof and Chat (header or chevron; remembered, folded by default so Cytoscape loads only on first open).
- **popup** — floating panel above the status bar (`#kg-layer`).
- **fullscreen** — the same layer, viewport-sized.

Moving between modes re-parents the root element; the Cytoscape instance is
**kept** and only `resize()`d around the current view centre, so selection,
expansions, history, node positions and zoom all survive. Closing destroys the
Cytoscape instance (listeners and canvas released) but keeps the view model,
whose saved positions and viewport restore the same picture on reopen. Esc
closes a popup or fullscreen graph from anywhere (a lesson's graph returns to
its panel); a non-empty search box or another open dialog takes the Esc first.

### Interaction

Zoom and pan match the semantic-graph view (`src/graph-panel/d3-semantic-graph.ts`):
trackpad two-finger scroll pans; pinch, Ctrl+scroll or a mouse wheel zooms
around the cursor (d3-zoom's rate); drag the background to pan; double-click
the background or the live zoom % to fit; range 15–500 %, buttons step 1.2×.
Fit pads 40 px and never zooms past 150 %. Click a concept to inspect it;
double-click (or **E**/**C**) shows/hides its neighbours — concepts with hidden
neighbours carry a "＋N" badge, and the hover tooltip says what a double-click
will do. **Focus here**, search, or **Enter** re-centres; **‹ ›** (Alt+←/→) walk
the focus history like a browser. Every concept and relationship has an
**Ask AI** button; its question includes the concept's relationships plus
the focus, visible concepts and visible relationships at the moment of the click
(bounded to 30 concepts / 40 relationships, with the remainder counted).

### Tutor context (CTX)

The AI tutor sees the Knowledge Graph view the learner last explored, via the
chat context (`runtime.knowledgeGraph`, viewable in the CTX popup):

- `agent-context.ts` `snapshotKnowledgeView` (pure, tested) — open/closed,
  which explorer and mode, scope, the focus and the selection (with short
  definitions; a selected relationship as "A uses B" plus its description),
  visible concepts (focus first, expanded flagged) and visible relationships as
  sentences, earlier foci, and the store size. Bounded: 40 concepts, 60
  relations, 300-char definitions, remainder counted.
- `knowledge-app.ts` tracks the last explorer the learner *used* (user-visible
  focus / selection / expansion / scope / mode changes — not background data
  patches) and keeps it after the explorer closes, flagged `open: false`, so
  the tutor still knows what was studied. `chat.ts` adds it to every turn's
  context and lists "knowledge graph (popup)" in USER VIEWING while open.
- `backend/agent_tools.py` `knowledge_graph_section` renders it into the system
  prompt ("## Knowledge Graph — OPEN now …" / "— closed — this is the LAST view
  …"), re-capping every list server-side. Nothing is sent until a graph has
  been opened; nothing persists across a page reload.

### Scopes: Local and Global

Both explorers have a **Local | Global** switch. **Local** shows only the open
lesson's concepts — those its `knowledgeGraph` names, plus runtime additions
linked to one of them; **Global** shows concepts from every lesson. A lesson's
own graph opens Local, the status-bar graph opens Global.

Scope is presentation-only (`GraphViewModel.setScope(id, predicate)`): the
engine is untouched, and focus neighbourhoods, overview, search, edges and the
"＋N" hidden-neighbour badges all respect it. Switching scope is an incremental
diff; if the focus falls outside the new scope (or nothing is left on screen)
the view re-centres on the lesson's main concept, otherwise it stays put. In
the global graph, Local means the *current* lesson: it follows lesson changes,
and is disabled (falling back to Global) when the open lesson has no graph.

### Setting the focus (standard entry point)

`focusKnowledgeConcept(id, { source })` (`knowledge-app.ts`, also
`window.algebenchKnowledgeGraph.focusConcept`) is the one way to set the
Knowledge Graph's current focus from outside the explorer — lesson navigation
uses it, and a tutor tool or another feature should too. It focuses every
explorer that can show the concept (the lesson graph when the concept is in its
scope, the global graph), each pushing its own history so Back returns to what
the learner had.

**Scene/step navigation** calls it on every `algebench:navchange`. The concept
comes from the lesson's existing `refs` — no extra schema
(`conceptAtPlace`, `knowledge-model.ts`): a concept referenced at exactly that
step; else the nearest earlier step in the scene; else the scene's own
reference; ties go to the lesson's main `focus`, then authored order. When the
new place maps to the same concept as the previous one, nothing moves, so the
learner's own exploration survives steps that stay on one topic. A lesson
loads focused on the concept of its starting place.

The open view follows every focus change (navigation, search, Focus here,
Back/Forward, `focusKnowledgeConcept`): the visible nodes are re-arranged in
rings around the new focus and the view re-centres, animated unless reduced
motion is on. Expand/collapse keep the focus and never re-lay out, so
exploration stays stable. A view that was closed while the focus moved is
arranged around the new focus when it reopens (`GraphViewModel.layoutFocus`).

### Following the open lesson

The lesson section always shows the loaded lesson's graph (it is rebuilt on
every `algebench:lessonload`). The global graph re-focuses on a newly opened
lesson's main concept once per lesson — the previous view stays on Back, and
the learner's exploration afterwards is left alone. A lesson opened *from* the
graph keeps the concept the learner came from. When the open lesson has no
`knowledgeGraph`, the status line says so.

### State management decision

AlgeBench has no store library: app state is plain module singletons
(`src/state.ts`) and cross-module signals are `window` CustomEvents. Neither
fits per-instance, typed, unsubscribable graph notifications, and adding
Zustand/Redux/MobX/Immer for one feature would be an app-wide precedent. The
explorer uses a ~40-line typed `Emitter` (`emitter.ts`) plus the engine's own
subscription list. App integration stays on the existing convention: one new
`algebench:lessonload` CustomEvent from `loadLesson`.

### State isolation

Opening, closing, resizing or switching modes writes nothing outside the
explorer. The only path into lesson state is an explicit **go to** button in
the details panel (`openLesson` → `loadBuiltinScene` / `navigateTo`). Verified
in the browser: lesson URL, scene and step are unchanged through every mode
switch, a runtime update, and the global explorer.

## Data model

A lesson may add an optional, validated `knowledgeGraph` block
(`schemas/lesson.schema.json` → `knowledgeGraph`, `knowledgeConcept`,
`knowledgeRelation`, `knowledgePlaceRef`). Lessons without it are untouched.

```json
"knowledgeGraph": {
  "focus": "dsa.monotonic-deque",
  "concepts": [
    { "id": "dsa.monotonic-deque", "label": "Monotonic Deque", "category": "data-structure",
      "glossary": "monotonic deque", "refs": [{ "scene": 1, "step": 4, "label": "Pops at i = 4" }] }
  ],
  "relations": [
    { "source": "dsa.monotonic-deque", "target": "dsa.deque", "type": "specializes" }
  ]
}
```

- **Identity is the explicit `id` only.** The same id in two lessons is one
  concept (lesson references are unioned; first label/definition wins, a label
  disagreement is reported). Similar labels, glossary aliases and shared
  glossary keys never merge anything.
- **No fabricated relations.** Relations come only from authored data; one
  whose endpoint is unknown is dropped with an issue, never auto-created.
- **Relation types** read "source *type* target": `prerequisite-of`,
  `specializes`, `part-of`, `uses`, `maintains`, `solves`, `analyzed-by`,
  `measured-by`, `related-to`. Each has an inverse reading for incoming edges.
  The vocabulary is open (lowercase-kebab); unknown types draw neutrally.
- **Stable edge ids** are derived: `source|type|target`.
- **Definitions**: the concept's own `definition`, else the lesson glossary entry
  it names explicitly with `"glossary": "<key>"`. Rendered as untrusted
  markdown (raw HTML shown as text) because runtime updates may supply them.
- **Validation never throws**: a malformed entry costs that entry; issues are
  logged to the console with the lesson id.

`GET /api/knowledge-graph` returns every lesson's block (from the same
mtime-cached index as the lesson picker; blocks over 256 KB are skipped) plus
`lessonCount`, so the explorer can state its coverage honestly ("knowledge graphs
from 2 of 36 lessons").

### Runtime updates

Runtime updates never touch lesson JSON or the lesson schema:

```
applyKnowledgeUpdate → GraphEngine → GraphPatch → GraphViewModel → ViewPatch → CytoscapeGraphView
```

`applyRuntimeUpdate(store, {concepts, relations})` (`knowledge-model.ts`, pure)
validates the payload with the same rules as lesson content and merges it in
one batch; `applyKnowledgeUpdate` (`knowledge-app.ts`, also
`window.algebenchKnowledgeGraph.applyUpdate`) applies it to the app's shared
store. Every open view gets one incremental patch, placed beside the node it
connects to; nothing is rebuilt. Runtime records carry no lesson reference and
are tagged `origin: "runtime"` (dashed outline / accent edges, "live update"
chip). An existing id is merged — a runtime update can fill a missing
definition, category or relation description, never overwrite lesson-authored
content — and re-sending the same payload is a no-op.

This is the boundary a future tutor / Expert integration uses: e.g. a learner
on Sliding Window Maximum asks about Sliding Window Minimum, and the Expert
proposes the concept and its relations. The payload is treated as untrusted:
malformed entries are dropped with an issue, relations must join concepts that
exist (in the store or the same payload), definitions render as untrusted
markdown. Neither the Expert integration nor persistence is implemented.

**Dev demo.** That example lives in
`src/graph-explorer/fixtures/sliding-window-minimum.ts` — used by
`runtime-update.test.ts` and never imported by app code, so it is not in the
bundle (the test checks `static/dist`). To see it live, open the demo lesson's
graph and run in the DevTools console:

```js
algebenchKnowledgeGraph.applyUpdate({
  concepts: [{ id: "dsa.sliding-window-minimum", label: "Sliding Window Minimum", category: "problem",
               definition: "The minimum of every length-$k$ window." }],
  relations: [
    { source: "dsa.monotonic-deque", target: "dsa.sliding-window-minimum", type: "solves" },
    { source: "dsa.sliding-window-minimum", target: "dsa.sliding-window", type: "uses" },
    { source: "dsa.sliding-window-minimum", target: "dsa.sliding-window-maximum", type: "related-to" }
  ]
})
```

## Extending to other graph types

`GraphEngine<N, E>`, `GraphViewModel<N, E>`, `CytoscapeGraphView` and
`GraphExplorer` are generic. A new graph type (expression graph, code graph,
lesson/scene graph, system design graph) supplies:

1. its own payload types `N`, `E` and loader into a `GraphEngine` — no shared
   universal schema;
2. a `GraphTypeAdapter` (labels, classes, search text, details HTML, legend);
3. stylesheet rules for its classes (the stylesheet builder is per view today;
   move it onto the adapter when the second type lands).

Cross-graph references are modelled as `CrossGraphRef` on concept data and
`crossLinks()` on the adapter, with `DetailsActions.openCrossLink` for the
future drill-down. Each context keeps its own view model, so a tabbed
multi-graph UI preserves each graph's exploration state. The existing math
Semantic Graph panel is unchanged.

## Dependency security (Cytoscape.js)

| Check | Result (2026-11-09) |
|---|---|
| Version | `cytoscape@3.34.4` — `latest` dist-tag, published 2026-10-15 (25 days old), pinned exactly |
| Advisories | OSV (`npm/cytoscape`): none. GitHub Advisory DB: none. `npm audit`: 0 vulnerabilities after install |
| Dependencies | none (zero runtime dependencies; nothing transitive added) |
| Provenance | registry signatures verified (`npm audit signatures`); SLSA v1 provenance attestation published |
| License / maintenance | MIT; maintained by the Cytoscape consortium, releases every few weeks in 2026 |
| Loading | bundled by Vite into its own lazy chunk (`static/dist/cytoscape.esm.js`), imported on first graph display — never from a CDN; no extensions or plugins |

## Performance

Model + view model (Node, `src/graph-explorer/perf.test.ts`; random graph,
~3 relations per concept): building the store is ~3.5 ms at 1,000 concepts;
focus / 2-hop / expand / runtime update / overview all stay under ~1 ms.

Renderer (Chromium, real explorer, synchronous work only — measured in a
background tab, so paint is excluded):

| Concepts (relations) | ingest | overview sync (all shown) | full re-layout | focus 1-hop | expand | live add | reopen from saved state |
|---|---|---|---|---|---|---|---|
| 20 (35) | 0.4 ms | 10 ms | 5 ms | 0.5 ms | 1 ms | 0.7 ms | 22 ms |
| 100 (193) | 0.6 ms | 29 ms | 26 ms | 3 ms | 1.5 ms | 0.6 ms | 42 ms |
| 500 (998) | 3.8 ms | 120 ms | 41 ms | 22 ms | 3.9 ms | 2 ms | 145 ms |
| 1,000 (1,998) | 3.2 ms | 217 ms | 82 ms | 54 ms | 3.5 ms | 1.4 ms | 282 ms |

A live update costs about the same at every size because only the changed
elements are touched. Showing *everything* grows roughly linearly with what is
drawn (plus a quadratic collision check in the placement of many new nodes at
once), which is why the default view is bounded (`maxVisible` 250, overview of
the 40 best-connected concepts) and exploration is progressive.

## Known limitations

- Only two lessons carry a `knowledgeGraph` block today (the demo and
  `draft/parenthesis-validation`); the explorer says so in its status line.
- Lessons opened from a local file contribute to the store for the session but
  cannot be navigated back to by id.
- Placement of new nodes is a deterministic ring around the anchor, not a force
  layout; very dense expansions can need the explicit re-layout button.
- Node positions/viewport persist for the session only (not across reloads).
- The popup is fixed-position (no drag/resize), matching the app's other
  status-bar popups; the embedded slot is vertically resizable.
- No automated browser tests: the repo has no browser test runner. The UI flow
  was verified by hand in the in-app browser (see the PR's test plan).
