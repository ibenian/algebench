# Distributed Databases Laboratory — lesson builder

Builds `scenes/draft/distributed-databases-lab.json` (lesson 2 of the database series). The
simulation itself is the runtime domain library `static/domains/distdb/` (engine, history
checker, placement and capacity models, with semantic tests in `test.mjs`); this folder only
generates the lesson JSON that wires sliders, boards and captions to it.

```bash
node scripts/lesson_builders/distributed-databases-lab/build_lesson.mjs          # write the lesson
node scripts/lesson_builders/distributed-databases-lab/build_lesson.mjs --check  # fail if it is stale
node --test static/domains/distdb/test.mjs                                       # engine semantics
```

| File | Purpose |
|---|---|
| `build_lesson.mjs` | Assembles the lesson; fails if any expression would trip the app's JavaScript detector. |
| `scenes.mjs` | Scenes, steps, markdown and tutor prompts. |
| `board.mjs` | The cluster board (clients → network → nodes) and the matrix, Merkle, capacity, shard and ring views. |
| `glossary.mjs` | Hoverable terms. |
| `util.mjs` | Loads the domain the way the browser does, so scenario lists come from one place. |
| `code/` | Client snippets shown in the Code tab (copied into the lesson JSON at build time). |

Design: `docs/proposals/distributed-databases-lab.md`.
