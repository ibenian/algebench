# Semantic Graph Module — Design Document

**Issue:** [#303](https://github.com/ibenian/algebench/issues/303)
**Branch:** `feat/303-semantic-graph-module`
**Status:** Draft

---

## 1. Motivation

Semantic graph parsing is currently split across two oversized files:

- **`server.py`** (~3 048 lines) — ~800 lines of preprocessing, postprocessing,
  caching, equation-chain splitting, and orchestration tangled with HTTP handlers.
- **`scripts/latex_to_graph.py`** (~2 262 lines) — SymPy translation, graph
  building, domain labelling, statement splitting, **plus** CLI arg parsing and
  file I/O.

The two are wired together at runtime via `_load_script_module()`, a dynamic
importer that bypasses normal Python imports. This makes the code hard to test
in isolation, hard to navigate, and fragile to refactor.

### Goals

1. Clean module boundary — one `import` replaces six `_load_script_module` calls.
2. Single-responsibility classes — each file owns one concern.
3. Per-class unit tests mirroring the module structure.
4. Zero regressions — all 266 existing tests pass unchanged.

### Non-goals

- Changing parsing behaviour or adding features.
- Touching `graph_to_mermaid.py` (separate extraction later).
- Rewriting the SymPy translation internals.

---

## 2. Architecture

### 2.1 Pipeline overview

```
┌─────────────┐
│  Caller      │  server.py route handler or CLI
└──────┬───────┘
       │ latex, domain
       ▼
┌─────────────────────────────────────────────────┐
│  SemanticGraphBuilder  (orchestrator)            │
│                                                  │
│  1. Check cache             ─── GraphCache       │
│  2. Preprocess              ─── LaTeXPreprocessor │
│  3. Translate               ─── SympyTranslator  │
│  4. Postprocess + validate  ─── GraphPostprocessor│
│  5. Store in cache                               │
└─────────────────────────────────────────────────┘
```

The preprocessor produces a frozen **PreprocessResult**; the translator
returns a **SemanticGraph** model object; the postprocessor mutates it
in-place and returns it to the orchestrator.

### 2.2 Typed pipeline objects

The pipeline uses two typed objects — one for preprocessing output, one for
the graph itself.

#### SemanticGraph (existing Pydantic model)

The Pydantic models currently in `models/semantic_graph.py` (`SemanticGraph`,
`SemanticGraphNode`, `SemanticGraphEdge`, `Classification`, `Enrichment`)
move into `backend/model/semantic_graph.py` — the entire `models/` directory
moves into `backend/model/` (singular). Currently only the LLM enricher uses
the models; the rest of the pipeline passes raw dicts. This extraction adopts
the models throughout:

- `SympyTranslator.translate()` returns `SemanticGraph`
- `GraphPostprocessor.postprocess()` takes and returns `SemanticGraph | None`
- `GraphCache` stores `SemanticGraph | None`
- `SemanticGraphBuilder.derive()` returns `SemanticGraph | None`

This gives us type safety, IDE autocomplete, and a single source of truth
for the graph shape. The JSON schema (`schemas/semantic-graph.schema.json`)
remains canonical for on-disk validation; the Pydantic models mirror it.

**Migration path for existing imports:**
- `models/` moves into `backend/model/` (singular) and `agents/` moves
  into `backend/agents/`. During transition, the old top-level packages
  become re-export shims pointing at `backend.model` and `backend.agents`
  respectively. Step 14 removes the shims once all callers are updated.
- `server.py` has a lazy import `from agents import ...` (line 2500)
  that will be updated to `from backend.agents import ...`.

#### PreprocessResult (new frozen dataclass)

Only the preprocessor output warrants a new typed object; other stages
use `SemanticGraph` directly.

The SymPy translator is deliberately unaware of the restoration maps — it
reads only `cleaned_latex`. The postprocessor reads the restoration maps but
never the original LaTeX.

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class PreprocessResult:
    """Immutable output of the preprocessing stage.

    Produced by LaTeXPreprocessor.preprocess().
    Consumed by the orchestrator, translator, and postprocessor.
    """

    cleaned_latex: str
    """LaTeX after all preprocessing passes.
    Producer: LaTeXPreprocessor (final output of the chain)
    Consumer: SympyTranslator (input to translate())
    """

    dotted_vars: dict[str, int]
    """Variable name -> derivative order, e.g. {"m": 1, "x": 2}.
    Producer: LaTeXPreprocessor.rewrite_dot_derivatives
              — records each \\dot/\\ddot rewrite for later display restore
    Consumer: GraphPostprocessor.restore_dot_notation
              — rewrites SymPy's \\frac{d}{dt} back to \\dot{} in subexprs
    """

    accent_map: dict[str, str]
    """Clean body -> accent command, e.g. {"v": "\\vec", "n": "\\hat"}.
    Producer: LaTeXPreprocessor.strip_accent_commands
              — peels \\vec, \\hat, \\mathbf etc. that SymPy can't parse
    Consumer: GraphPostprocessor.restore_accents
              — re-wraps node labels/latex with the original accent command
    """

    subscript_map: dict[str, str]
    """Greek placeholder -> original body, e.g. {"xi": "\\text{prop}"}.
    Producer: LaTeXPreprocessor.substitute_multichar_subscripts
              — swaps multi-char subscripts with Greek atoms for SymPy
    Consumer: GraphPostprocessor.restore_subscripts
              — replaces Greek placeholders back to original text
    """

    annotations: list[dict]
    """Extracted parenthetical annotations, e.g. "(v_e constant)".
    Producer: LaTeXPreprocessor.extract_parenthetical_annotations
              — strips trailing parenthetical notes before parsing
    Consumer: GraphPostprocessor.inject_annotations
              — attaches annotation metadata to the finished graph
    """
```

**Why frozen?** The preprocessor is the sole producer. Downstream stages
consume restoration maps but must not mutate them — freezing enforces that
contract at the type level. If a stage needs to alter preprocessing output,
the preprocessor itself must change.

**Data flow:**

```
Orchestrator
     │  latex, domain
     ▼
Preprocessor ──returns──▶ PreprocessResult (frozen)
     │                      .cleaned_latex, .dotted_vars, .accent_map,
     │                      .subscript_map, .annotations
     ▼
SympyTranslator ──reads──▶ result.cleaned_latex, domain
     │          ──returns──▶ SemanticGraph
     ▼
Postprocessor ──reads──▶ result (dotted_vars, accent_map, subscript_map, annotations)
              ──mutates──▶ SemanticGraph (restores original notation)
```

---

## 3. Module layout

```
backend/
├── __init__.py
├── model/
│   ├── __init__.py              # re-exports all public types from semantic_graph.py
│   └── semantic_graph.py        # Pydantic models (moved from models/semantic_graph.py)
├── agents/
│   ├── __init__.py              # re-exports BaseAgent, AgentError
│   ├── base.py                  # BaseAgent, AgentError (moved from agents/base.py)
│   └── semantic_graph_enricher.py  # SemanticGraphEnrichmentAgent (moved from agents/)
└── semantic_graph/
    ├── __init__.py              # re-exports SemanticGraphBuilder + SemanticGraph
    ├── preprocess_result.py     # PreprocessResult frozen dataclass
    ├── constants.py             # shared constants, regexes, maps
    ├── preprocessor.py          # LaTeXPreprocessor
    ├── sympy_translator.py      # SympyTranslator
    ├── postprocessor.py         # GraphPostprocessor
    ├── equation_chain.py        # EquationChainHandler
    └── cache.py                 # GraphCache

tests/
└── backend/
    ├── agents/
    │   ├── __init__.py
    │   ├── test_base_agent.py
    │   └── test_semantic_graph_enricher.py
    └── semantic_graph/
        ├── __init__.py
        ├── test_constants.py
        ├── test_preprocessor.py
        ├── test_sympy_translator.py
        ├── test_postprocessor.py
        ├── test_equation_chain.py
        ├── test_cache.py
        └── test_builder.py      # integration / end-to-end
```

---

## 4. Class responsibilities

### 4.1 `constants.py` — shared definitions

Everything below moves here. No logic, just data.

| Constant | Current location | Type | Description |
|----------|-----------------|------|-------------|
| `_GREEK_POOL` | server.py:130 | `list[str]` | 22 Greek letters for subscript placeholders |
| `_ACCENT_COMMANDS` | server.py:147 | `tuple[str, ...]` | 15 accent decorators to strip |
| `_DOT_ACCENT_ORDERS` | server.py:165 | `dict[str, int]` | dot→1, ddot→2, dddot→3, ddddot→4 |
| `_ORDER_TO_ACCENT` | server.py:376 | `dict[int, str]` | inverse of above |
| `_CHAIN_RELATION_COMMANDS` | server.py:697 | `tuple[str, ...]` | `\approx`, `\simeq`, `\equiv` |
| `_LOGICAL_CONNECTIVE_COMMANDS` | server.py:705 | `tuple[str, ...]` | `\implies`, `\iff`, etc. |
| `DIMENSIONS` | l2g:68 | `dict` | SI base-unit table |
| `DIMENSION_PATTERN` | l2g:78 | `str` | regex for dimension strings |
| `KNOWN_VARIABLES` | l2g:94 | `dict` | metadata for 17 common symbols |
| `CONSTANT_MAP` | l2g:159 | `dict` | pi, E, I, oo display labels |
| `OPERATOR_MAP` | l2g:119 | `dict[type, str]` | SymPy type → op name |
| `_ASYMMETRIC_OPS` | l2g:130 | `set[str]` | directional relations |
| `_META_RELATION_OPS` | l2g:139 | `set[str]` | statement-level relations |
| `RELATION_MAP` | l2g:168 | `list[tuple]` | 14 LaTeX relation commands |
| `_OPERATOR_GLYPHS` | l2g:306 | `dict[str, str]` | 30+ compact op glyphs |
| `_SUPERSCRIPT_MAP` | l2g:322 | `dict[str, str]` | Unicode superscripts |
| `_OP_KINDS` | l2g:330 | `frozenset[str]` | operator/relation/function |
| `_OPERATOR_KINDS` | l2g:351 | `dict[str, str]` | op → kind classifier |
| `_PLACEHOLDER_NAME_RE` | l2g:146 | `re.Pattern` | synthetic placeholder gate |
| `_STYLE_SYMBOL_COMMAND_RE` | l2g:186 | `re.Pattern` | `\mathbb{…}` unwrapper |
| `_SIMPLE_STYLED_SYMBOL_RE` | l2g:190 | `re.Pattern` | single-token styled symbol |

### 4.2 `preprocessor.py` — LaTeXPreprocessor

Stateless class. Each method takes raw strings and returns results; the
top-level `preprocess()` assembles them into a frozen `PreprocessResult`.

| Method | Moves from | server.py line |
|--------|-----------|---------------|
| `rewrite_dot_derivatives` | `_rewrite_dot_derivatives` | 170 |
| `normalize_frac_derivatives` | `_normalize_frac_derivatives` | 293 |
| `strip_accent_commands` | `_strip_accent_commands` | 455 |
| `substitute_multichar_subscripts` | `_substitute_multichar_subscripts` | 568 |
| `extract_parenthetical_annotations` | `l2g._extract_parenthetical_annotations` | l2g |
| `preprocess(latex) -> PreprocessResult` | orchestration in `_derive_semantic_graph` | 1007-1016 |

The `preprocess()` method runs all steps in order and returns a frozen result:

```python
def preprocess(self, latex: str) -> PreprocessResult:
    src = latex
    src, annotations = self.extract_parenthetical_annotations(src)
    dotted_vars: dict[str, int] = {}
    src = self.rewrite_dot_derivatives(src, dotted_vars)
    src = self.normalize_frac_derivatives(src)
    accent_map: dict[str, str] = {}
    src = self.strip_accent_commands(src, accent_map)
    src, subscript_map = self.substitute_multichar_subscripts(src)
    return PreprocessResult(
        cleaned_latex=src,
        dotted_vars=dotted_vars,
        accent_map=accent_map,
        subscript_map=subscript_map,
        annotations=annotations,
    )
```

### 4.3 `sympy_translator.py` — SympyTranslator

Absorbs the core of `scripts/latex_to_graph.py`: SymPy parsing, expression
walking, graph node/edge building, domain labelling, statement splitting.

| Method | Moves from |
|--------|-----------|
| `translate(latex, domain) -> SemanticGraph` | `latex_to_semantic_graph` |
| `_split_on_statement_separators` | same name in l2g |
| `_build_graph_from_expr` | internal graph builder in l2g |
| `_classify_node` | domain labelling logic in l2g |
| `node_short_label` / `node_long_label` | utility functions in l2g |
| `operator_kind` | kind classifier in l2g |

**Imports:** This class owns the `sympy` dependency.

### 4.4 `postprocessor.py` — GraphPostprocessor

Stateless. Each method takes a `SemanticGraph` and the relevant map from
`PreprocessResult`, mutates the graph in-place.

| Method | Moves from | server.py line |
|--------|-----------|---------------|
| `restore_subscripts` | `_restore_subscripts_in_graph` | 619 |
| `restore_accents` | `_restore_accents_in_graph` | 526 |
| `restore_dot_notation` | `_restore_dot_notation_in_graph` | 438 |
| `inject_annotations` | `l2g._inject_annotations` | l2g |
| `reject_degenerate` | inline check in `_derive_semantic_graph` | 1031-1036 |
| `postprocess(graph, result) -> SemanticGraph \| None` | orchestration logic | 1038-1042 |

```python
def postprocess(self, graph: SemanticGraph | None, result: PreprocessResult) -> SemanticGraph | None:
    if graph is None:
        return None
    if self.reject_degenerate(graph):
        return None
    self.restore_subscripts(graph, result.subscript_map)
    self.restore_accents(graph, result.accent_map)
    self.restore_dot_notation(graph, result.dotted_vars)
    if result.annotations:
        self.inject_annotations(graph, result.annotations)
    return graph
```

### 4.5 `equation_chain.py` — EquationChainHandler

Handles multi-relation expressions like `a = b \approx c`.

| Method | Moves from | server.py line |
|--------|-----------|---------------|
| `has_top_level_logical_connective` | `_has_top_level_logical_connective` | 711 |
| `has_top_level_statement_comma` | `_has_top_level_statement_comma` | 737 |
| `split_equation_chain_sides` | `_split_equation_chain_sides` | 768 |
| `derive_equation_chain_graph` | `_derive_equation_chain_graph` | 810 |

This class uses `LaTeXPreprocessor` and `SympyTranslator` internally to parse
individual chain sides.

### 4.6 `cache.py` — GraphCache

Thin wrapper around a dict with `(latex, domain)` composite keys.

```python
class GraphCache:
    def __init__(self):
        self._store: dict[str | tuple[str, str], SemanticGraph | None] = {}

    def get(self, latex: str, domain: str | None) -> SemanticGraph | None | sentinel:
        key = (latex, domain) if domain else latex
        return self._store.get(key, _MISS)

    def put(self, latex: str, domain: str | None, graph: SemanticGraph | None):
        key = (latex, domain) if domain else latex
        self._store[key] = graph

    def clear(self):
        self._store.clear()
```

### 4.7 `SemanticGraphBuilder` — orchestrator (`__init__.py`)

Wires everything together. This is what `server.py` imports.

```python
from backend.semantic_graph.cache import GraphCache
from backend.model.semantic_graph import SemanticGraph
from backend.semantic_graph.preprocessor import LaTeXPreprocessor
from backend.semantic_graph.sympy_translator import SympyTranslator
from backend.semantic_graph.postprocessor import GraphPostprocessor
from backend.semantic_graph.equation_chain import EquationChainHandler

class SemanticGraphBuilder:
    def __init__(self):
        self._cache = GraphCache()
        self._preprocessor = LaTeXPreprocessor()
        self._translator = SympyTranslator()
        self._postprocessor = GraphPostprocessor()
        self._chain_handler = EquationChainHandler(
            self._preprocessor, self._translator, self._postprocessor,
        )

    def derive(self, latex: str, domain: str | None = None) -> SemanticGraph | None:
        cached = self._cache.get(latex, domain)
        if cached is not _MISS:
            return cached

        result = self._preprocessor.preprocess(latex)
        graph = self._translator.translate(result.cleaned_latex, domain=domain)
        graph = self._postprocessor.postprocess(graph, result)

        self._cache.put(latex, domain, graph)
        return graph
```

---

## 5. What changes for callers

### server.py

**Before:**
```python
l2g = _load_script_module("scripts/latex_to_graph.py", "latex_to_graph")
graph = l2g.latex_to_semantic_graph(rewritten, domain=domain)
```

**After:**
```python
from backend.semantic_graph import SemanticGraphBuilder

_graph_builder = SemanticGraphBuilder()

# in handler:
graph = _graph_builder.derive(math_src, domain=domain)
```

All `_derive_*`, `_rewrite_*`, `_restore_*`, `_strip_*`, `_substitute_*`,
`_has_top_level_*`, `_split_equation_*` functions and `_latex_graph_cache`
are deleted from server.py.

### scripts/latex_to_graph.py

Scripts are CLI tools callable locally, from coding agents, or from GitHub
Actions. They own argument parsing, file I/O, exit codes, and human-readable
output — but delegate all domain logic to `backend/`.

After extraction, `scripts/latex_to_graph.py` becomes a thin CLI wrapper:

```python
#!/usr/bin/env python3
"""CLI: LaTeX string → semantic graph JSON.

Called locally, by coding agents, and from GitHub Actions.
All domain logic lives in backend.semantic_graph.
"""
import argparse, json, sys
from backend.semantic_graph import SemanticGraphBuilder

def main():
    parser = argparse.ArgumentParser(
        description="Parse a LaTeX expression into a semantic graph.",
    )
    parser.add_argument("latex", help="LaTeX math expression")
    parser.add_argument("--domain", default=None,
                        help="Domain hint (physics, chemistry, ...)")
    parser.add_argument("--pretty", action="store_true",
                        help="Pretty-print JSON output")
    args = parser.parse_args()

    builder = SemanticGraphBuilder()
    graph = builder.derive(args.latex, domain=args.domain)

    if graph is None:
        print("null", file=sys.stdout)
        sys.exit(1)

    json.dump(graph.model_dump(by_alias=True, exclude_none=True),
              sys.stdout, indent=2 if args.pretty else None)
    print()  # trailing newline

if __name__ == "__main__":
    main()
```

---

## 6. Migration of existing tests

| Existing file | Tests | Migrates to |
|--------------|-------|-------------|
| `test_dot_notation_restore.py` (16) | preprocessor + postprocessor assertions | `tests/backend/semantic_graph/test_preprocessor.py`, `test_postprocessor.py` |
| `test_latex_to_graph.py` (182) | end-to-end graph assertions | `tests/backend/semantic_graph/test_sympy_translator.py` + `test_builder.py` |
| `test_graph_to_mermaid.py` (57) | **stays** — not part of this extraction | unchanged |
| `test_graph_highlight_overlay.py` (8) | highlight logic stays in server.py | unchanged |
| `test_semantic_graph_themes.py` (3) | theme logic stays in server.py | unchanged |

**Rules:**
- Every existing assertion is preserved (same inputs, same expected outputs).
- Old test files may remain as integration smoke tests until coverage parity is confirmed.
- New per-method unit tests are added for intermediate steps (e.g. testing `strip_accent_commands` alone with edge cases).

---

## 7. Implementation order

| Step | Description | Risk |
|------|-------------|------|
| 1 | Create `backend/` package skeleton (`__init__.py`, `model/`, `semantic_graph/`, `agents/`) + test mirrors | None |
| 2 | Move `models/` → `backend/model/` (singular); make top-level `models/` re-export shim | Low |
| 3 | Move `agents/` → `backend/agents/`; make top-level `agents/` re-export shim | Low |
| 4 | Extract `constants.py` from both source files | Low — pure data |
| 5 | Create `preprocess_result.py` | None |
| 6 | Extract `preprocessor.py` + tests | Medium — touches server.py |
| 7 | Extract `postprocessor.py` + tests | Medium |
| 8 | Extract `sympy_translator.py` + tests | High — largest move |
| 9 | Extract `equation_chain.py` + tests | Medium — depends on 6-8 |
| 10 | Extract `cache.py` + tests | Low |
| 11 | Wire `SemanticGraphBuilder` + integration tests | Medium |
| 12 | Update `server.py` — delete extracted code, add imports | Medium |
| 13 | Slim down `scripts/latex_to_graph.py` to CLI wrapper | Low |
| 14 | Remove re-export shims (top-level `models/`, `agents/`); update all imports to `backend.*` | Low |
| 15 | Migrate test files, verify full suite passes | Low |

Each step should be a single commit that keeps all tests green.

---

## 8. Open questions

1. **`_load_script_module` for `graph_to_mermaid.py`** — server.py also
   dynamically loads this file (3 call sites). Should we extract it in the same
   PR or defer to a follow-up?
   **Recommendation:** Defer. Keep this PR focused on semantic graph parsing.

2. **Gemini enrichment cache** (`_graph_enrich_cache`, `_graph_enricher`) —
   these live near the semantic graph code but are a separate concern
   (LLM-powered graph annotation). Leave in server.py for now.

3. **`_extract_htmlclass_pairs` / `_apply_highlights_to_graph`** (server.py:1047,
   1092) — these operate on graphs but are UI/scene-specific. Leave in
   server.py; they consume graphs but don't produce them.
