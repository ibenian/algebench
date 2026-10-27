# Lesson builders

Scripts that build **specific lessons**. Each folder generates one lesson's JSON under `scenes/`; none of this
code is loaded by the app, and nothing outside its own folder should import it. General platform features
(new object types, schema properties, renderers) belong in `src/`, not here.

A builder owns everything that only exists to produce its lesson: the generator, any recorded algorithm runs or
example data it reads, and tests that keep the committed JSON in sync with them. `npm test` and the test
type-check include `scripts/lesson_builders/**`, so a builder's tests run with the rest of the suite.

| Folder | Builds | Command |
|---|---|---|
| [`common-algorithm-patterns/`](common-algorithm-patterns/) | `scenes/draft/common-algorithm-patterns.json` | `./run.sh scripts/lesson_builders/common-algorithm-patterns/build.py` |
| [`test-graph/`](test-graph/) | `scenes/draft/test-graph.json` (graph object test scenes) | `./run.sh scripts/lesson_builders/test-graph/build.py` |
| [`graph-algorithms/`](graph-algorithms/) | `scenes/draft/graph-algorithms.json` (graph algorithms: index and scenes) | `./run.sh scripts/lesson_builders/graph-algorithms/build.py` |
| [`test-array/`](test-array/) | `scenes/draft/test-array.json` (array and dict test scenes) | `./run.sh scripts/lesson_builders/test-array/build.py` |

## Recorded runs: what calls returned

When a recorded run makes a call to one of the code's own functions (`h(start)`, `find(x)`, `dfs(nxt)`), record
what it returned on the frame for that line: `emit(line, message, returns={'h(start)': 6})` in Python builders,
`emit(line, message, status, {'h(start)': 6})` in `algorithms.ts`. The key is the call's source with spaces removed,
exactly as written in the code. The scene's codeRef then gets a `returnsExpr` on its own (`code_ref` /
`returnsRef`), and the Code panel shows `h(start) → 6` beside the call and when the call's name is pointed at. A run
that records none shows nothing, so add them in every new lesson whose code calls its own functions.

## Code annotations: hover explanations

A code file's `annotations` explain its names and parts on hover, under any value the Code panel shows. Document each
function and important variable once by name (`doc('h', ...)` in `graph-algorithms/build.py`), override a name on the
lines where it means something else (a parameter hiding an outer variable: `doc('cell', ..., 'def h(cell)', ..., source)`),
and explain blocks (`doc_block`) and key expressions (`doc_expr`) that deserve it. Write it for every new code file.

## common-algorithm-patterns

- `algorithms.ts`: the Python shown in the Code panel for each pattern, and a recorded run of it: every step's
  variables, the line that last assigned each one (`ln_<var>`), LaTeX explaining how it was computed (`tip_<var>`),
  and each `while`/`if` evaluation.
- `inputs.ts`: the example inputs.
- `build.ts`: lays out the scenes (arrays, labels, wires, charts, docs) from the runs and prints the lesson JSON.
- `build.py`: runs `build.ts` and writes the JSON in the repo's compact-leaves format.
- `algorithms.test.ts`: checks every run against a simple reference, that the committed JSON matches the
  generator, and that every bound expression evaluates.

Set `ARRAY_TEXT=screen` when building to draw array text as screen labels instead of on the arrays' faces.
