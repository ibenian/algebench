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

## 8. Test strategy

### 8.1 Three-layer test architecture

Tests are organized in three layers, each catching a different class of
regression:

| Layer | Scope | What it catches | Files |
|-------|-------|-----------------|-------|
| **Unit tests** | Individual module internals — single functions, single classes | Logic bugs in preprocessing, postprocessing, caching, constant definitions | `test_preprocessor.py`, `test_postprocessor.py`, `test_cache.py`, `test_constants.py`, `test_preprocess_result.py` |
| **Integration tests** | Service-level wiring — multiple modules composed together | Broken contracts between modules, incorrect orchestration, cache/service interaction | `test_service.py`, `test_equation_chain.py`, `test_sympy_translator.py`, `test_dot_notation_restore.py`, `test_latex_to_graph.py` |
| **Domain suites** | End-to-end — real LaTeX formulas from specific mathematical/physics domains fed through `SemanticGraphService.derive()` | Parser fails on real-world notation it should handle; regressions across the full pipeline for specific fields of math/science | `tests/backend/semantic_graph/domains/test_domain_*.py` |

Unit tests pin **internal correctness** — if `strip_accent_commands` breaks,
a unit test catches it immediately and points at the function. Integration
tests verify **wiring** — that the preprocessor's output feeds correctly
into the translator and postprocessor. Domain suites verify **capability**
— can the parser actually handle the Schrödinger equation, Maxwell's
equations, or a system of ODEs end-to-end?

All three layers run on every CI push. Unit + integration tests exist today;
domain suites are proposed below.

### 8.2 Problem (motivation for domain suites)

Current tests are hand-written examples that grew organically alongside
features. Coverage is deep for the happy path (`F = ma`, `E = mc^2`) but
shallow across the combinatorial space of LaTeX constructs the parser claims
to handle. We have 14 relation operators, 15 accent commands, 22 Greek
placeholders, 5 preprocessing passes, compound symbols, chained equals,
statement separators, and multiple domains — yet most tests exercise only
one or two of these axes at a time. Silent regressions hide in untested
combinations.

### 8.2 Test suites by mathematical domain

Each suite is a self-contained test file with curated LaTeX expressions
representative of that domain. Every expression is something a student or
textbook would actually write — not synthetic fuzz. Each suite tests both
that the parser **succeeds** (non-null graph, valid structure) and that
domain-specific constructs are **correctly represented** in the graph.

#### Suite catalog

| # | Suite | File | Domain hint | Description |
|---|-------|------|-------------|-------------|
| 1 | **Basic arithmetic** | `test_domain_arithmetic.py` | `None` | Foundational: integer ops, order of operations, negation, absolute value |
| 2 | **Polynomials & algebra** | `test_domain_algebra.py` | `None` | Polynomial manipulation, factoring, roots, binomial theorem |
| 3 | **Trigonometry** | `test_domain_trigonometry.py` | `None` | Trig identities, inverse trig, hyperbolic functions |
| 4 | **Calculus (single-var)** | `test_domain_calculus.py` | `None` | Limits, derivatives, integrals, series, Taylor expansion |
| 5 | **ODEs** | `test_domain_ode.py` | `None` | Ordinary differential equations: 1st/2nd/nth order, systems, initial conditions |
| 6 | **PDEs** | `test_domain_pde.py` | `None` | Partial differential equations: heat, wave, Laplace, Schrödinger |
| 7 | **Linear algebra** | `test_domain_linalg.py` | `None` | Matrices, determinants, eigenvalues, vector spaces, inner products |
| 8 | **Complex analysis** | `test_domain_complex.py` | `None` | Complex numbers, Euler's formula, residues, contour integrals |
| 9 | **Logic & set theory** | `test_domain_logic.py` | `None` | Implications, iff, quantifiers, set membership, union/intersection |
| 10 | **Number theory** | `test_domain_number_theory.py` | `None` | Modular arithmetic, divisibility, primes, floor/ceiling |
| 11 | **Probability & statistics** | `test_domain_probability.py` | `None` | Expected value, variance, distributions, combinatorics, summations |
| 12 | **Classical mechanics** | `test_domain_mechanics.py` | `mechanics` | Newton's laws, energy, momentum, Lagrangian, Hamiltonian |
| 13 | **Electromagnetism** | `test_domain_em.py` | `electromagnetism` | Maxwell's equations, Coulomb, Lorentz, circuit laws |
| 14 | **Thermodynamics** | `test_domain_thermo.py` | `thermodynamics` | Gas laws, entropy, Boltzmann, partition functions |
| 15 | **Quantum mechanics** | `test_domain_quantum.py` | `quantum_mechanics` | Dirac notation, commutators, operators, wavefunctions |
| 16 | **Relativity** | `test_domain_relativity.py` | `mechanics` | Lorentz transformations, metric tensors, Einstein field equations |
| 17 | **Fluid dynamics** | `test_domain_fluids.py` | `mechanics` | Navier–Stokes, continuity, Bernoulli, Reynolds number |
| 18 | **Optics & waves** | `test_domain_waves.py` | `mechanics` | Wave equation, Snell's law, diffraction, interference |
| 19 | **Chemistry** | `test_domain_chemistry.py` | `None` | Rate laws, equilibrium, Nernst equation, Arrhenius |
| 20 | **Multi-statement & structural** | `test_domain_structural.py` | `None` | Chained equals, statement separators, piecewise, systems of equations |
| 21 | **Abstract algebra** | `test_domain_abstract_algebra.py` | `None` | Groups, rings, fields, homomorphisms, quotient groups, isomorphisms |
| 22 | **Differential geometry** | `test_domain_diffgeo.py` | `None` | Christoffel symbols, covariant derivatives, wedge products, tensor index notation |
| 23 | **Fourier & transforms** | `test_domain_transforms.py` | `None` | Fourier, Laplace, Z-transforms, convolution, calligraphic operators |
| 24 | **Optimization** | `test_domain_optimization.py` | `None` | argmin/argmax, constraints, Lagrange multipliers, KKT conditions |
| 25 | **Discrete math & combinatorics** | `test_domain_combinatorics.py` | `None` | Binomial coefficients, recurrences, graph theory, summation bounds |
| 26 | **Functional analysis** | `test_domain_functional.py` | `None` | Norms, inner products, operator notation, Hilbert/Banach space membership |
| 27 | **Information theory** | `test_domain_information.py` | `None` | Entropy, KL divergence, mutual information, channel capacity |
| 28 | **Control theory** | `test_domain_control.py` | `None` | Transfer functions, Laplace domain, feedback loops, stability criteria |

#### Representative expressions per suite

Each suite contains 10–30 expressions spanning easy → hard. Below are
examples (not exhaustive) for selected suites:

**Basic arithmetic**
```python
EXPRESSIONS = [
    ("addition",        r"2 + 3 = 5"),
    ("subtraction",     r"7 - 4 = 3"),
    ("multiplication",  r"3 \times 4 = 12"),
    ("division",        r"\frac{10}{2} = 5"),
    ("order_of_ops",    r"2 + 3 \times 4 = 14"),
    ("negation",        r"-(-x) = x"),
    ("absolute_value",  r"|x - 3| = 5"),
    ("mixed_fracs",     r"\frac{1}{2} + \frac{3}{4} = \frac{5}{4}"),
    ("exponents",       r"2^3 = 8"),
    ("nested_parens",   r"((a + b) \cdot c) = ac + bc"),
]
```

**ODEs**
```python
EXPRESSIONS = [
    ("first_order",        r"\frac{dy}{dx} = ky"),
    ("separable",          r"\frac{dy}{dx} = \frac{x}{y}"),
    ("second_order",       r"\frac{d^2 y}{dx^2} + \omega^2 y = 0"),
    ("damped_oscillator",  r"m \ddot{x} + c \dot{x} + k x = 0"),
    ("bernoulli",          r"\frac{dy}{dx} + P(x) y = Q(x) y^n"),
    ("exact",              r"M(x,y) dx + N(x,y) dy = 0"),
    ("system",             r"\dot{x} = ax + by, \quad \dot{y} = cx + dy"),
    ("laplace_transform",  r"s Y(s) - y(0) = \mathcal{L}\{f(t)\}"),
    ("initial_condition",  r"y'' + y = 0, \quad y(0) = 1, \quad y'(0) = 0"),
    ("variation_params",   r"y_p = u_1 y_1 + u_2 y_2"),
]
```

**Linear algebra**
```python
EXPRESSIONS = [
    ("matrix_product",   r"C = A B"),
    ("determinant",      r"\det(A) = ad - bc"),
    ("eigenvalue",       r"A \vec{v} = \lambda \vec{v}"),
    ("trace",            r"\text{tr}(A) = \sum_{i=1}^{n} a_{ii}"),
    ("inverse",          r"A^{-1} = \frac{1}{\det(A)} \text{adj}(A)"),
    ("transpose",        r"(AB)^T = B^T A^T"),
    ("inner_product",    r"\langle u, v \rangle = \sum_{i} u_i v_i"),
    ("cross_product",    r"\vec{a} \times \vec{b} = \hat{n} |a||b| \sin\theta"),
    ("norm",             r"\| \vec{x} \| = \sqrt{x_1^2 + x_2^2 + x_3^2}"),
    ("characteristic",   r"\det(A - \lambda I) = 0"),
    ("svd",              r"A = U \Sigma V^T"),
    ("rank_nullity",     r"\text{rank}(A) + \text{nullity}(A) = n"),
]
```

**Quantum mechanics**
```python
EXPRESSIONS = [
    ("schrodinger_time",  r"i \hbar \frac{\partial \psi}{\partial t} = \hat{H} \psi"),
    ("schrodinger_indep", r"\hat{H} \psi = E \psi"),
    ("commutator",        r"[\hat{x}, \hat{p}] = i \hbar"),
    ("uncertainty",       r"\Delta x \Delta p \geq \frac{\hbar}{2}"),
    ("dirac_bra_ket",     r"\langle \phi | \hat{A} | \psi \rangle"),
    ("expectation",       r"\langle A \rangle = \langle \psi | \hat{A} | \psi \rangle"),
    ("completeness",      r"\sum_n | n \rangle \langle n | = I"),
    ("pauli_x",           r"\sigma_x = \begin{pmatrix} 0 & 1 \\ 1 & 0 \end{pmatrix}"),
    ("bloch_sphere",      r"| \psi \rangle = \cos\frac{\theta}{2} |0\rangle + e^{i\phi} \sin\frac{\theta}{2} |1\rangle"),
    ("density_matrix",    r"\rho = \sum_i p_i | \psi_i \rangle \langle \psi_i |"),
    ("born_rule",         r"P(a_n) = | \langle a_n | \psi \rangle |^2"),
]
```

**Logic & set theory**
```python
EXPRESSIONS = [
    ("implication",     r"P \implies Q"),
    ("iff",             r"P \iff Q"),
    ("element_of",      r"x \in \mathbb{R}"),
    ("not_element",     r"x \notin \mathbb{Z}"),
    ("subset",          r"A \subseteq B"),
    ("union",           r"A \cup B = B \cup A"),
    ("intersection",    r"A \cap B \subseteq A"),
    ("complement",      r"(A \cup B)^c = A^c \cap B^c"),
    ("forall",          r"\forall x \in \mathbb{R}, \quad x^2 \geq 0"),
    ("exists",          r"\exists x \in \mathbb{N}, \quad x > 100"),
    ("demorgan",        r"\neg (P \land Q) \iff (\neg P) \lor (\neg Q)"),
    ("cardinality",     r"|A \cup B| = |A| + |B| - |A \cap B|"),
]
```

**PDEs**
```python
EXPRESSIONS = [
    ("heat_1d",          r"\frac{\partial u}{\partial t} = \alpha \frac{\partial^2 u}{\partial x^2}"),
    ("wave_1d",          r"\frac{\partial^2 u}{\partial t^2} = c^2 \frac{\partial^2 u}{\partial x^2}"),
    ("laplace_2d",       r"\frac{\partial^2 \phi}{\partial x^2} + \frac{\partial^2 \phi}{\partial y^2} = 0"),
    ("poisson",          r"\nabla^2 \phi = -\frac{\rho}{\epsilon_0}"),
    ("schrodinger_3d",   r"-\frac{\hbar^2}{2m} \nabla^2 \psi + V \psi = E \psi"),
    ("navier_stokes",    r"\rho \left( \frac{\partial \vec{v}}{\partial t} + \vec{v} \cdot \nabla \vec{v} \right) = -\nabla p + \mu \nabla^2 \vec{v}"),
    ("diffusion",        r"\frac{\partial c}{\partial t} = D \nabla^2 c"),
    ("helmholtz",        r"\nabla^2 u + k^2 u = 0"),
    ("boundary",         r"u(0, t) = 0, \quad u(L, t) = 0"),
    ("separation",       r"u(x, t) = X(x) T(t)"),
]
```

**Complex analysis**
```python
EXPRESSIONS = [
    ("euler",            r"e^{i\theta} = \cos\theta + i \sin\theta"),
    ("euler_identity",   r"e^{i\pi} + 1 = 0"),
    ("modulus",          r"|z| = \sqrt{a^2 + b^2}"),
    ("polar_form",       r"z = r e^{i\theta}"),
    ("conjugate",        r"z \bar{z} = |z|^2"),
    ("cauchy_integral",  r"f(a) = \frac{1}{2\pi i} \oint \frac{f(z)}{z - a} dz"),
    ("residue",          r"\oint f(z) dz = 2\pi i \sum \text{Res}(f, z_k)"),
    ("demoivre",         r"(\cos\theta + i\sin\theta)^n = \cos(n\theta) + i\sin(n\theta)"),
    ("analytic",         r"\frac{\partial u}{\partial x} = \frac{\partial v}{\partial y}"),
    ("laurent",          r"f(z) = \sum_{n=-\infty}^{\infty} a_n (z - z_0)^n"),
]
```

**Electromagnetism**
```python
EXPRESSIONS = [
    ("coulomb",          r"F = k_e \frac{q_1 q_2}{r^2}"),
    ("gauss_law",        r"\oint \vec{E} \cdot d\vec{A} = \frac{Q}{\epsilon_0}"),
    ("faraday",          r"\nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}"),
    ("ampere_maxwell",   r"\nabla \times \vec{B} = \mu_0 \vec{J} + \mu_0 \epsilon_0 \frac{\partial \vec{E}}{\partial t}"),
    ("lorentz",          r"\vec{F} = q(\vec{E} + \vec{v} \times \vec{B})"),
    ("ohm",              r"V = I R"),
    ("capacitance",      r"C = \frac{Q}{V} = \epsilon_0 \frac{A}{d}"),
    ("inductance",       r"V = -L \frac{dI}{dt}"),
    ("wave_speed",       r"c = \frac{1}{\sqrt{\mu_0 \epsilon_0}}"),
    ("poynting",         r"\vec{S} = \frac{1}{\mu_0} \vec{E} \times \vec{B}"),
]
```

**Relativity**
```python
EXPRESSIONS = [
    ("time_dilation",    r"\Delta t' = \gamma \Delta t"),
    ("lorentz_factor",   r"\gamma = \frac{1}{\sqrt{1 - \frac{v^2}{c^2}}}"),
    ("mass_energy",      r"E = mc^2"),
    ("energy_momentum",  r"E^2 = (pc)^2 + (mc^2)^2"),
    ("metric_tensor",    r"ds^2 = g_{\mu\nu} dx^\mu dx^\nu"),
    ("schwarzschild",    r"ds^2 = -\left(1 - \frac{r_s}{r}\right) c^2 dt^2 + \frac{dr^2}{1 - \frac{r_s}{r}} + r^2 d\Omega^2"),
    ("einstein_field",   r"R_{\mu\nu} - \frac{1}{2} R g_{\mu\nu} + \Lambda g_{\mu\nu} = \frac{8\pi G}{c^4} T_{\mu\nu}"),
    ("geodesic",         r"\frac{d^2 x^\mu}{d\tau^2} + \Gamma^\mu_{\alpha\beta} \frac{dx^\alpha}{d\tau} \frac{dx^\beta}{d\tau} = 0"),
    ("four_momentum",    r"p^\mu = m \frac{dx^\mu}{d\tau}"),
    ("length_contract",  r"L = \frac{L_0}{\gamma}"),
]
```

**Multi-statement & structural**
```python
EXPRESSIONS = [
    ("two_stmt_backslash",  r"x = 1 \\ y = 2"),
    ("two_stmt_comma_quad", r"a = 1, \quad b = 2"),
    ("three_stmt",          r"x = 1 \\ y = 2 \\ z = 3"),
    ("chained_two",         r"a = b = c"),
    ("chained_three",       r"a = b = c = d"),
    ("mixed_relations",     r"a \leq b \leq c"),
    ("implication_chain",   r"P \implies Q \implies R"),
    ("system_2x2",          r"2x + 3y = 7, \quad x - y = 1"),
    ("piecewise",           r"f(x) = \begin{cases} x & x \geq 0 \\ -x & x < 0 \end{cases}"),
    ("definition_where",    r"E = \frac{1}{2}mv^2 \quad (\text{where } v = \text{velocity})"),
    ("substitution",        r"F = ma = m \frac{dv}{dt}"),
    ("subject_group",       r"\alpha, \beta \in \mathbb{R}"),
]
```

**Abstract algebra**
```python
EXPRESSIONS = [
    ("quotient_group",     r"G / N"),
    ("homomorphism",       r"\phi : G \to H"),
    ("isomorphism",        r"G \cong H"),
    ("direct_product",     r"G \times H"),
    ("kernel",             r"\ker(\phi) = \{ e \}"),
    ("image",              r"\text{Im}(\phi) = H"),
    ("normal_subgroup",    r"N \trianglelefteq G"),
    ("order",              r"|G| = n"),
    ("coset",              r"gN = \{ gn : n \in N \}"),
    ("first_iso_thm",      r"G / \ker(\phi) \cong \text{Im}(\phi)"),
]
```

**Differential geometry**
```python
EXPRESSIONS = [
    ("christoffel",        r"\Gamma^{i}_{jk}"),
    ("covariant_deriv",    r"\nabla_{\mu} V^{\nu}"),
    ("wedge_product",      r"\omega \wedge \eta"),
    ("metric_tensor",      r"ds^2 = g_{\mu\nu} dx^{\mu} dx^{\nu}"),
    ("riemann_tensor",     r"R^{\rho}_{\ \sigma\mu\nu}"),
    ("ricci_scalar",       r"R = g^{\mu\nu} R_{\mu\nu}"),
    ("exterior_deriv",     r"d\omega = 0"),
    ("lie_bracket",        r"[X, Y] = XY - YX"),
    ("parallel_transport", r"\nabla_{\dot{\gamma}} V = 0"),
    ("geodesic_eq",        r"\ddot{x}^{\mu} + \Gamma^{\mu}_{\alpha\beta} \dot{x}^{\alpha} \dot{x}^{\beta} = 0"),
]
```

**Fourier & transforms**
```python
EXPRESSIONS = [
    ("fourier_hat",        r"\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x) e^{-2\pi i x \xi} dx"),
    ("laplace",            r"\mathcal{L}\{f(t)\} = F(s)"),
    ("inverse_laplace",    r"f(t) = \mathcal{L}^{-1}\{F(s)\}"),
    ("convolution",        r"(f * g)(t) = \int_0^t f(\tau) g(t - \tau) d\tau"),
    ("z_transform",        r"X(z) = \sum_{n=0}^{\infty} x[n] z^{-n}"),
    ("parseval",           r"\int |f(x)|^2 dx = \int |\hat{f}(\xi)|^2 d\xi"),
    ("dft",                r"X_k = \sum_{n=0}^{N-1} x_n e^{-i 2\pi k n / N}"),
    ("transfer_fn",        r"H(s) = \frac{Y(s)}{X(s)}"),
]
```

**Optimization**
```python
EXPRESSIONS = [
    ("argmin",             r"\arg\min_{x} f(x)"),
    ("argmax",             r"\arg\max_{\theta} \mathcal{L}(\theta)"),
    ("constrained",        r"\min_{x} f(x) \quad \text{s.t.} \quad g(x) \leq 0"),
    ("lagrangian",         r"L(x, \lambda) = f(x) + \lambda g(x)"),
    ("kkt_stationarity",   r"\nabla f(x^*) + \lambda \nabla g(x^*) = 0"),
    ("gradient_descent",   r"x_{k+1} = x_k - \alpha \nabla f(x_k)"),
    ("dual_problem",       r"\max_{\lambda \geq 0} \min_{x} L(x, \lambda)"),
    ("sup_inf",            r"\sup_{x \in S} \inf_{y \in T} f(x, y)"),
]
```

**Discrete math & combinatorics**
```python
EXPRESSIONS = [
    ("binomial_coeff",     r"\binom{n}{k} = \frac{n!}{k!(n-k)!}"),
    ("recurrence",         r"a_n = a_{n-1} + a_{n-2}"),
    ("sum_binomial",       r"\sum_{k=0}^{n} \binom{n}{k} = 2^n"),
    ("stirling",           r"n! \approx \sqrt{2\pi n} \left(\frac{n}{e}\right)^n"),
    ("pigeonhole",         r"\lceil n/k \rceil"),
    ("generating_fn",      r"G(x) = \sum_{n=0}^{\infty} a_n x^n"),
    ("catalan",            r"C_n = \frac{1}{n+1} \binom{2n}{n}"),
    ("inclusion_exclusion", r"|A \cup B| = |A| + |B| - |A \cap B|"),
    ("graph_handshake",    r"\sum_{v \in V} \deg(v) = 2|E|"),
]
```

**Functional analysis**
```python
EXPRESSIONS = [
    ("norm",               r"\| x \| = \sqrt{\langle x, x \rangle}"),
    ("inner_product",      r"\langle f, g \rangle = \int_a^b f(x) \overline{g(x)} dx"),
    ("triangle_ineq",      r"\| x + y \| \leq \| x \| + \| y \|"),
    ("operator_norm",      r"\| T \| = \sup_{\| x \| = 1} \| Tx \|"),
    ("hilbert_membership", r"f \in L^2(\mathbb{R})"),
    ("cauchy_schwarz",     r"|\langle x, y \rangle| \leq \| x \| \cdot \| y \|"),
    ("dual_space",         r"X^* = \mathcal{B}(X, \mathbb{R})"),
    ("weak_convergence",   r"x_n \rightharpoonup x"),
    ("compact_operator",   r"T : X \to Y"),
]
```

**Information theory**
```python
EXPRESSIONS = [
    ("entropy",            r"H(X) = -\sum_{x} p(x) \log p(x)"),
    ("kl_divergence",      r"D_{\text{KL}}(P \| Q) = \sum_x P(x) \log \frac{P(x)}{Q(x)}"),
    ("mutual_info",        r"I(X; Y) = H(X) - H(X | Y)"),
    ("channel_capacity",   r"C = \max_{p(x)} I(X; Y)"),
    ("joint_entropy",      r"H(X, Y) = -\sum_{x,y} p(x,y) \log p(x,y)"),
    ("conditional_entropy", r"H(X | Y) = H(X, Y) - H(Y)"),
    ("data_processing",    r"I(X; Y) \geq I(X; Z)"),
    ("rate_distortion",    r"R(D) = \min_{p(\hat{x}|x)} I(X; \hat{X})"),
]
```

**Control theory**
```python
EXPRESSIONS = [
    ("transfer_function",  r"G(s) = \frac{Y(s)}{U(s)}"),
    ("closed_loop",        r"T(s) = \frac{G(s)}{1 + G(s)H(s)}"),
    ("pid_controller",     r"u(t) = K_p e(t) + K_i \int_0^t e(\tau) d\tau + K_d \frac{de}{dt}"),
    ("state_space",        r"\dot{x} = Ax + Bu"),
    ("output_eq",          r"y = Cx + Du"),
    ("characteristic_eq",  r"\det(sI - A) = 0"),
    ("routh_criterion",    r"s^3 + 2s^2 + 3s + 4 = 0"),
    ("nyquist",            r"|G(j\omega)| = 1"),
    ("laplace_step",       r"Y(s) = G(s) \cdot \frac{1}{s}"),
]
```

### 8.3 Suite-level invariants

Each suite asserts both **universal invariants** (must hold for every
expression in every suite) and **suite-specific invariants** (must hold
for the domain's characteristic constructs).

#### Universal invariants

| Invariant | Assertion |
|-----------|-----------|
| **Non-null** | `graph is not None` — the parser must not reject valid LaTeX |
| **Has nodes and edges** | `len(graph["nodes"]) >= 1` and `"edges" in graph` |
| **Classification present** | `"classification" in graph` with valid `kind` |
| **Pydantic validates** | `SemanticGraph.model_validate(graph)` succeeds |
| **No placeholder leak** | no `Theta_{}`, `Xi_{}`, `Phi_{}` in any node's `latex` or `label` |
| **Domain propagated** | when domain is set, `graph.get("domain") == domain` |

#### Suite-specific invariants

| Suite | Extra invariants |
|-------|-----------------|
| **Arithmetic** | All operator nodes have `op` in `{add, multiply, power, equals}` |
| **ODEs** | Classification `kind` is `ODE`; `order >= 1` |
| **PDEs** | At least one partial derivative node or `\partial` in subexpr |
| **Linear algebra** | Accented vectors (`\vec`) restored; no raw Greek placeholders |
| **Quantum mechanics** | Dirac notation preserved in `subexpr` where applicable |
| **Logic** | Relation nodes with `op` in `{implies, iff, element_of, not_element_of}` |
| **Multi-statement** | `classification["kind"] == "statements"` with correct `count` |
| **Complex analysis** | Imaginary unit `i` not misclassified as a variable |
| **Calculus** | Derivative/integral structures produce expected operator nodes |
| **Electromagnetism** | Vector fields have `type: vector` after accent restoration |
| **Abstract algebra** | Relation nodes with `op` in `{isomorphic, maps_to, normal_subgroup_of}` |
| **Differential geometry** | Multi-level index stacking preserved in `subexpr`; Christoffel notation intact |
| **Fourier & transforms** | Calligraphic `\mathcal{L}`, `\mathcal{F}` recognized as transform operators |
| **Optimization** | `\arg\min`, `\arg\max` produce function-type nodes; constraint text not lost |
| **Combinatorics** | `\binom{n}{k}` produces a function node; factorials handled |
| **Functional analysis** | Norms `\| \|` and inner products `\langle \rangle` not mismatched as delimiters |
| **Information theory** | `H(X)`, `I(X;Y)` produce function nodes; subscript `\text{KL}` restored |
| **Control theory** | Laplace-domain expressions `G(s)` produce function nodes; dot notation restored |

### 8.4 Parametric cross-product generators

In addition to the curated domain suites, a parametric generator sweeps
the parser's **feature matrix** — the combinatorial space of structure,
relation, and variable decoration that cuts across domains.

#### Generator axes

| Axis | Values | Source of truth |
|------|--------|-----------------|
| **Structure** | single equation, chained equals (2–4 sides), statement separator (`\\`, `,\quad`), logical connective (`\implies`, `\iff`) | `equation_chain.py` |
| **Relation** | `=`, `\approx`, `\in`, `\propto`, `\neq`, `\notin`, `\to`, `\gt`, `\lt`, `\Rightarrow`, `\iff` | `RELATION_MAP` in `constants.py` |
| **Variable decoration** | plain (`x`), Greek (`\alpha`), accented (`\vec{F}`, `\hat{n}`), dot-derivative (`\dot{x}`, `\ddot{x}`), subscripted (`C_d`, `v_{\text{exhaust}}`), compound (`\Delta t`) | `_ACCENT_COMMANDS`, `_DOT_ACCENT_ORDERS` |
| **Operator mix** | arithmetic, power, fraction, function (`\sin`, `\cos`, `\log`, `\sqrt`) | `OPERATOR_MAP` |
| **Nesting** | flat (`a + b`), one level (`\frac{a}{b}`), two levels (`\frac{\partial^2 u}{\partial x^2}`) | SymPy expression depth |

Two modes:

1. **Exhaustive** — structure × relation × decoration (~200 combinations).
   Fast, runs on every CI push.
2. **Sampled** — random draw from the full cross-product (~500 per run,
   fixed seed). Nightly cron bumps the seed to sweep new regions.

### 8.5 File layout

```
tests/backend/semantic_graph/
├── generators/
│   ├── __init__.py
│   ├── expressions.py        # ExprTemplate + render logic
│   ├── variables.py          # variable/decoration generators
│   └── invariants.py         # universal + suite-specific assertion helpers
│
├── domains/                  # one file per mathematical domain
│   ├── __init__.py
│   ├── test_domain_arithmetic.py
│   ├── test_domain_algebra.py
│   ├── test_domain_trigonometry.py
│   ├── test_domain_calculus.py
│   ├── test_domain_ode.py
│   ├── test_domain_pde.py
│   ├── test_domain_linalg.py
│   ├── test_domain_complex.py
│   ├── test_domain_logic.py
│   ├── test_domain_number_theory.py
│   ├── test_domain_probability.py
│   ├── test_domain_mechanics.py
│   ├── test_domain_em.py
│   ├── test_domain_thermo.py
│   ├── test_domain_quantum.py
│   ├── test_domain_relativity.py
│   ├── test_domain_fluids.py
│   ├── test_domain_waves.py
│   ├── test_domain_chemistry.py
│   ├── test_domain_structural.py
│   ├── test_domain_abstract_algebra.py
│   ├── test_domain_diffgeo.py
│   ├── test_domain_transforms.py
│   ├── test_domain_optimization.py
│   ├── test_domain_combinatorics.py
│   ├── test_domain_functional.py
│   ├── test_domain_information.py
│   └── test_domain_control.py
│
├── test_coverage_exhaustive.py   # structure × relation × decoration
├── test_coverage_sampled.py      # random-seed full cross-product
├── test_property_based.py        # Hypothesis property-based tests
├── test_boundary_values.py       # boundary value analysis (length, depth, count)
├── test_fuzzing.py               # grammar-aware LaTeX fuzzer
│
├── golden/                       # snapshot golden files (JSON)
│   ├── arithmetic/
│   ├── algebra/
│   └── ...
│
└── conftest.py                   # shared fixtures, golden-file loader, Hypothesis profiles
```

### 8.6 Expected outcome per suite

Not every expression will parse perfectly on day one. The suites serve
double duty: regression prevention **and** gap discovery. Each expression
is tagged with an expected outcome:

| Tag | Meaning | pytest behavior |
|-----|---------|-----------------|
| `PASS` | Parser should produce a valid graph | normal assertion |
| `XFAIL` | Known limitation — parser can't handle this yet | `@pytest.mark.xfail(strict=True)` |
| `SKIP` | Requires a feature not yet implemented (e.g., matrix support) | `@pytest.mark.skip(reason="...")` |

As the parser improves, `XFAIL` tests flip to `PASS` — strict xfail
ensures we notice. The ratio of `PASS` to `XFAIL + SKIP` per suite is
a coverage health metric:

```
Coverage dashboard (target: 80% PASS per suite)
  arithmetic:    10/10  (100%)
  algebra:       12/15  ( 80%)
  ode:            8/10  ( 80%)
  pde:            5/10  ( 50%)  ← gap: nabla, partial derivatives
  linalg:         4/12  ( 33%)  ← gap: matrix notation
  quantum:        3/11  ( 27%)  ← gap: bra-ket, commutators
  logic:          9/12  ( 75%)
  ...
```

### 8.7 Priority and phasing

| Phase | Scope | Suites | When |
|-------|-------|--------|------|
| **Phase 1** | Core math suites | arithmetic, algebra, calculus, ODE, multi-statement | After this PR merges |
| **Phase 2** | Physics suites | mechanics, EM, thermo, waves | Next sprint |
| **Phase 3** | Advanced math | PDE, linalg, complex, logic, number theory, probability, combinatorics | Follow-up PR |
| **Phase 4** | Frontier physics & specialized | quantum, relativity, fluids, chemistry, control theory | Ongoing |
| **Phase 4b** | Advanced structures | abstract algebra, differential geometry, transforms, optimization, functional analysis, information theory | Ongoing |
| **Phase 5** | Cross-product generators | exhaustive + sampled | Parallel with phase 2 |

Phase 1 targets suites where the parser is already strong — the goal is to
lock in coverage and prevent regressions. Later phases deliberately push
into areas where the parser will fail, using `XFAIL` to document gaps and
create a roadmap for parser improvements.

### 8.8 CI integration

- **Domain suites** (phases 1–4) run on every push — each suite is 10–30
  parametrized cases, total runtime ~5s.
- **Exhaustive generator** (phase 5) runs on every push (~200 cases, ~2s).
- **Sampled generator** runs on every push with a fixed seed (~500 cases).
  A nightly cron job runs with `seed=date` to sweep fresh combinations.
- Failures in sampled tests produce a minimal reproducer: the exact
  `ExprTemplate` that failed, printable as a pytest CLI invocation.
- The `XFAIL` → `PASS` flip rate is tracked per suite to measure parser
  improvement over time.

### 8.9 Test data generation techniques

Beyond hand-curated expressions and parametric cross-products, leverage
automated test data generation to uncover edge cases the curated suites
miss.

#### Hypothesis (property-based testing) — deferred

**Status: Evaluated and deferred.** After analysis, Hypothesis
property-based testing is not a good fit for LaTeX parsing at this stage:

1. **Random LaTeX is mostly invalid.** Composite strategies that
   generate syntactically valid LaTeX essentially re-implement the
   parametric cross-product generators (§8.4) with worse ergonomics.
2. **The only meaningful invariant for random input is "don't crash"** —
   the parser already handles this via `try/except`. Structural
   assertions (node types, relation ops, classification kind) require
   knowing what the input *means*, which random generation can't provide.
3. **Shrinking adds little value** when the reproducer is a single LaTeX
   string that can be pasted directly into a test case.
4. **Better ROI** comes from curating more domain suite expressions
   (§8.2) and expanding the parametric generators (§8.4), both of which
   test *meaningful* LaTeX that students and textbooks actually write.

Hypothesis may be revisited in the future for fuzz-style "parser never
crashes" smoke tests once the domain suites and generators are mature.
The file layout reserves `test_property_based.py` for this purpose.

#### Mutation testing

Use [mutmut](https://mutmut.readthedocs.io/) or
[cosmic-ray](https://cosmic-ray.readthedocs.io/) to verify test
effectiveness:

- Mutate constants (`RELATION_MAP` entries, regex patterns, operator
  mappings) and verify at least one test fails for each mutation.
- Target modules: `constants.py`, `preprocessor.py`, `sympy_translator.py`.
- Mutation score target: **≥ 85%** for core modules.

#### Fuzzing with grammar-aware generators

Build a LaTeX grammar that produces syntactically valid but
semantically diverse expressions:

| Generator | Output example | Tests |
|-----------|----------------|-------|
| **Nested fractions** | `\frac{\frac{a}{b}}{c + d}` | Deep nesting doesn't crash or corrupt subexpr |
| **Decorated variables** | `\dot{\vec{x}}_{\text{cm}}` | Stacked accents + subscripts compose correctly |
| **Multi-relation chains** | `a \leq b < c \neq d` | Each relation detected at top level |
| **Mixed delimiters** | `\left( \frac{a}{\lvert b \rvert} \right)` | Delimiter normalization handles mixing |
| **Annotation combos** | `F = ma \quad (\text{Newton}, v \text{ const})` | Multiple parenthetical annotations extracted |

#### Snapshot / golden-file testing

For complex expressions where exact graph structure matters:

- Serialize the output graph to JSON and store as a golden file.
- On each run, compare output against the golden file.
- Use `--update-snapshots` flag to regenerate after intentional changes.
- Complements invariant-based testing: invariants catch structural
  violations, snapshots catch silent semantic drift.

#### Boundary value analysis

Systematically test at parser boundaries:

| Boundary | Min | Max | Edge cases |
|----------|-----|-----|------------|
| **Expression length** | 1 char (`x`) | 500+ chars (nested sums) | Empty string, whitespace-only |
| **Nesting depth** | 0 (bare variable) | 5+ (nested fracs) | `\frac{\frac{\frac{...}{...}}{...}}{...}` |
| **Statement count** | 1 | 20+ (`\\`-separated) | Adjacent separators, trailing separator |
| **Subscript depth** | 0 | 3+ (`x_{a_{b_{c}}}`) | Empty subscript `x_{}` |
| **Unicode** | ASCII only | Mixed with LaTeX commands | Raw Unicode symbols vs `\alpha` equivalents |

#### pytest parametrize + fixtures

All generation techniques feed into pytest via `@pytest.mark.parametrize`
or custom fixtures, keeping the test runner standard:

```python
@pytest.fixture(params=load_golden_files("domains/arithmetic/*.json"))
def golden_case(request):
    return request.param

def test_golden(golden_case):
    graph = latex_to_semantic_graph(golden_case["latex"])
    assert graph == golden_case["expected"]
```

---

## 9. Open questions

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
