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
