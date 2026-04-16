# LaTeX Semantic Graph Parser — Design Notes

## Overview

The LaTeX-to-semantic-graph parser converts LaTeX math expressions into a JSON
graph of nodes and edges, annotated with metadata (variable names, types, units,
emojis). It powers interactive math visualizations in AlgeBench.

The parser is built on **SymPy** with its ANTLR-based `parse_latex`, plus a
small regex preprocessing layer for notation that SymPy doesn't handle natively.

## Parser Comparison

We evaluated four approaches for parsing LaTeX into a form suitable for semantic
graph construction.

### Libraries Tested

| Library | What it does | Math semantics? |
|---|---|---|
| **SymPy ANTLR** (`sympy.parsing.latex.parse_latex`) | LaTeX → SymPy expression tree | Yes — full CAS |
| **SymPy Lark** (`sympy.parsing.latex.lark.parse_latex_lark`) | LaTeX → SymPy expression tree (newer parser) | Yes — full CAS |
| **pylatexenc** | LaTeX → LaTeX AST (macros, groups, arguments) | No — structural only |
| **latex2sympy2** | LaTeX → SymPy expression tree (third-party) | Yes, but broken on Python 3.14 |

### Feature Matrix

| Feature | ANTLR + regex | Lark | pylatexenc |
|---|---|---|---|
| Basic algebra (`x + y`, `x^2`, `\frac{1}{2}`) | OK | OK | AST only |
| Equations (`F = ma`) | OK | OK | AST only |
| Functions (`\sin`, `\cos`, `\sqrt`) | OK | OK | AST only |
| **1st-order derivatives** (`\frac{dv}{dt}`) | OK | Partial (returns tuple) | AST only |
| **2nd-order derivatives** (`\frac{d^2y}{dx^2}`) | OK (regex) | Fails | AST only |
| **Partial derivatives** (`\frac{\partial u}{\partial x}`) | OK | Fails | AST only |
| **Dot/ddot notation** (`\dot{x}`, `\ddot{x}`) | OK (regex) | Fails | AST only |
| Integrals (`\int`, `\int_0^1`) | OK | OK | AST only |
| Sums and products | OK | OK | AST only |
| Constants (`\pi`) | OK | Fails | AST only |
| **Matrices** (`\begin{pmatrix}...`) | Fails | OK | AST only |
| Vector notation (`\vec{v}`, `\hat{x}`) | Wrong (parsed as multiply) | Fails | AST only |
| Absolute value (`|x|`, `\left|x\right|`) | Partial | OK | AST only |
| Binomials, subscripts, Greek letters | OK | OK | AST only |
| Limits | OK | OK | AST only |
| **Score** | **22/29** | **20/29** | **29/29 (AST only)** |

### Why SymPy ANTLR + Regex

**pylatexenc** parses everything structurally but has no math understanding. It
knows that `\frac{dv}{dt}` is a `\frac` macro with two groups — but not that it
represents a derivative. Building the semantic layer on top of a pure LaTeX AST
would mean reimplementing most of what SymPy already does.

**SymPy Lark** is a newer parser but has significant gaps in derivative handling,
which is a core use case for AlgeBench (ODE/PDE visualization, physics
equations). It does handle matrices, which ANTLR cannot.

**latex2sympy2** is a third-party alternative that requires antlr4 4.7.2,
conflicting with SymPy's own antlr4 4.11.1 dependency. It is also broken on
Python 3.14 due to removed `typing.io` module.

**SymPy ANTLR** has the best derivative support and, critically, gives us access
to SymPy's full computer algebra system (CAS).

### The Symbolic Layer Matters

The key insight is that AlgeBench doesn't just need to *parse* LaTeX — it needs
to *reason about* the math. A structural parser like pylatexenc can tell you that
`\frac{dv}{dt} = a` contains a `\frac` macro, but it cannot tell you that this
is a first-order linear ODE, that `v` depends on `t`, or that the solution is
`v(t) = at + C`.

By parsing into SymPy expressions rather than a plain AST, the entire SymPy
CAS — which can simplify, solve, differentiate, integrate, and
evaluate expressions symbolically — becomes available downstream. AlgeBench will use this
symbolic layer beyond just graph construction — for interactive exercises,
step-by-step solutions, and expression validation. Having SymPy as the internal
representation means the parser, the graph builder, and future symbolic
operations all share the same foundation rather than requiring separate
translation layers.

Concrete capabilities this enables:

- **Equation classification** — `classify_ode` detects equation type, order,
  linearity, and homogeneity, which drives how the graph is annotated and how
  lessons present the material
- **Symbolic solutions** — `solve` / `dsolve` can find closed-form solutions to
  display alongside the graph or to verify student work
- **Expression manipulation** — `simplify`, `expand`, `factor`, `collect` let
  the backend transform expressions into equivalent forms for pedagogical
  purposes (e.g., showing that `(a+b)^2` and `a^2 + 2ab + b^2` are the same)
- **Substitution and evaluation** — `subs` / `evalf` enable numeric evaluation
  for slider-driven interactive visualizations
- **Differentiation and integration** — `diff` / `integrate` can derive related
  expressions (e.g., given `F = ma`, derive `W = \int F \cdot dx`)
- **Equivalence checking** — determine whether a student's answer is
  mathematically equivalent to the expected answer, regardless of form
- **Dimensional analysis** — combined with unit metadata, SymPy can verify
  dimensional consistency across equations

A pure AST parser would require building all of this from scratch. With SymPy,
it's already there.

The regex preprocessing layer is small (3 rules) and handles specific notation
gaps:

1. Higher-order Leibniz derivatives (`\frac{d^2 y}{dx^2}`) → expanded to
   repeated first-order derivatives
2. `\dot{x}` → `\frac{dx}{dt}`
3. `\ddot{x}` → `\frac{d}{dt}\frac{dx}{dt}`

## Architecture

```
LaTeX string
    │
    ▼
_preprocess_latex()          ← regex: \dot, \ddot, higher-order d/dx
    │
    ▼
sympy.parse_latex()          ← ANTLR parser → SymPy expression tree
    │
    ├──► _classify_expression()   ← ODE/PDE detection via classify_ode
    │
    ▼
SemanticGraphBuilder._walk() ← recursive tree walk
    │
    ▼
{ nodes, edges, classification }   ← JSON output
```

### Node Types

| Type | Generated by | ID format |
|---|---|---|
| Symbol (variable) | Known or unknown variables | Raw name (`F`, `m`, `x`) |
| Number | Integer, float, rational | `__num_N` |
| Constant | `pi`, `E`, `I`, `oo` | `__const_N` |
| Function | `sin`, `cos`, `sqrt`, etc. | `__funcname_N` |
| Operator | `add`, `multiply`, `power`, `equals` | `__opname_N` |
| Derivative | `\frac{d}{dt}` | `__deriv_N` |
| Integral | `\int` | `__integral_N` |
| Sum / Product | `\sum`, `\prod` | `__sum_N` / `__product_N` |

Generated IDs use a `__` prefix to avoid collision with symbol names.

## Current Shortcomings

### Matrices and Linear Algebra

SymPy's ANTLR parser cannot parse matrix environments (`\begin{pmatrix}`,
`\begin{bmatrix}`, `\begin{vmatrix}`). Any LaTeX containing matrices will fail
with a parse error. This blocks a significant class of expressions:

- Column/row vectors: `\begin{pmatrix} x \\ y \\ z \end{pmatrix}`
- Transformation matrices: `\begin{bmatrix} \cos\theta & -\sin\theta \\ \sin\theta & \cos\theta \end{bmatrix}`
- Eigenvalue problems: `A\vec{v} = \lambda\vec{v}`
- Systems of equations in matrix form: `A\mathbf{x} = \mathbf{b}`
- Determinants: `\begin{vmatrix} a & b \\ c & d \end{vmatrix}`

SymPy's Lark parser handles all of these, but cannot parse derivatives — so
neither parser alone covers the full range.

### Vector and Tensor Notation

`\vec{v}`, `\mathbf{F}`, and `\hat{x}` are misinterpreted by both parsers.
ANTLR treats them as multiplication of two symbols (`v * vec`), and Lark fails
entirely. This affects:

- Vector quantities in physics: `\vec{F} = m\vec{a}`
- Unit vectors: `\hat{r}`, `\hat{\theta}`, `\hat{\phi}`
- Bold notation for vectors/matrices: `\mathbf{A}`, `\mathbf{x}`
- Tensor notation: `T^{\mu\nu}`, `g_{\mu\nu}`

### Multi-character Variable Names

The parser assumes single-letter variable names with optional subscripts. Common
multi-character names require `\text{}` or `\mathrm{}` wrapping:

- `\text{KE}` for kinetic energy (rather than `K * E`)
- `\text{Re}` for Reynolds number (rather than `R * e`)
- `\mathrm{pH}` (rather than `p * H`)

### Notation Ambiguity

Single-letter variables are context-dependent, and the parser uses a static
lookup table that can't distinguish:

- `E` — energy vs. Euler's number vs. electric field
- `I` — current vs. imaginary unit vs. moment of inertia
- `T` — temperature vs. period vs. kinetic energy vs. tension
- `c` — speed of light vs. a generic constant
- `k` — wave number vs. Boltzmann constant vs. spring constant

The `--var` override mechanism mitigates this but requires manual intervention.

### Absolute Value Delimiters

ANTLR handles `|x|` but fails on `\left| x \right|`, which is common in
typeset LaTeX. Lark handles both forms correctly.

### Piecewise and Conditional Expressions

Neither parser supports `\begin{cases}` environments:

```latex
f(x) = \begin{cases} x^2 & x \geq 0 \\ -x^2 & x < 0 \end{cases}
```

### Multi-line Equations

Aligned environments (`\begin{align}`, `\begin{aligned}`) and equation arrays
are not supported. These are common in step-by-step derivations.

### Set Notation and Logic

Set-builder notation (`\{ x \in \mathbb{R} \mid x > 0 \}`), logical operators
(`\land`, `\lor`, `\implies`), and quantifiers (`\forall`, `\exists`) are not
parsed into meaningful semantic structures.

## Future Improvements

### Recursive Hybrid Parser

A naive hybrid (try ANTLR, fall back to Lark on failure) operates at the
top level and cannot handle mixed expressions — for example, a matrix whose
entries contain derivatives:

```latex
\begin{pmatrix} \frac{dx}{dt} \\ \frac{dy}{dt} \end{pmatrix} = A \begin{pmatrix} x \\ y \end{pmatrix}
```

ANTLR would fail on the matrix. Lark would parse the matrix but lose the
derivatives inside it. A top-level fallback gives you one or the other, never
both.

#### Term-level fallback via LaTeX AST routing

The better approach is to decompose the LaTeX into structural terms first using
pylatexenc, then route each term to the parser best suited for it. This replaces
the current regex preprocessing with a more general mechanism.

**How it works:**

```
LaTeX string
    │
    ▼
pylatexenc LatexWalker         ← parse into LaTeX AST (structural, not semantic)
    │
    ▼
Recursive term router          ← walk the AST, classify each node
    │
    ├─ \frac{d...}{d...}  ──►  ANTLR   (derivatives)
    ├─ \dot{x}, \ddot{x}  ──►  ANTLR   (with preprocessing)
    ├─ \begin{pmatrix}     ──►  Lark    (matrices)
    ├─ \begin{cases}       ──►  custom  (piecewise)
    ├─ \vec{v}, \hat{x}    ──►  custom  (vector decoration → metadata)
    ├─ x + y, \sin(x)      ──►  ANTLR   (default, best general coverage)
    │
    ▼
Compose SymPy expressions      ← assemble sub-expressions into full tree
    │
    ▼
SemanticGraphBuilder           ← existing graph walker (unchanged)
```

**Key idea:** pylatexenc always succeeds at parsing the structure — it
understands that `\begin{pmatrix}` is an environment with rows separated by
`\\` and cells by `&`, that `\frac` has two groups, that `\vec` wraps an
argument. It doesn't know the *math* meaning, but it gives us a reliable
structural decomposition.

The router walks this AST recursively. At each node, it decides which math
parser to invoke:

```python
def route_node(node):
    if is_matrix_env(node):       # \begin{pmatrix}, \begin{bmatrix}, ...
        # Parse each cell individually (recursive — cells may contain derivatives)
        rows = extract_cells(node)
        parsed_rows = [[route_node(cell) for cell in row] for row in rows]
        return sympy.Matrix(parsed_rows)

    if is_derivative_frac(node):  # \frac{d...}{d...}, \frac{\partial...}{\partial...}
        return parse_antlr(node.latex)

    if is_vector_decoration(node):  # \vec{x}, \hat{r}, \mathbf{F}
        inner = route_node(node.argument)
        inner._assumptions['vector'] = True  # annotate, don't multiply
        return inner

    if is_cases_env(node):        # \begin{cases}
        branches = extract_branches(node)
        return sympy.Piecewise(*[route_node(b) for b in branches])

    # Default: serialize back to LaTeX, parse with ANTLR
    return parse_antlr(node.latex)
```

**Why this is better than regex preprocessing:**

- **Recursive** — a matrix cell containing `\frac{dv}{dt}` gets routed to ANTLR
  for the derivative, while the enclosing matrix is handled by Lark or custom
  construction. Regex can't express this nesting.
- **Extensible** — adding support for a new construct (e.g., `\begin{cases}`) is
  a new `if` branch in the router, not a fragile regex pattern.
- **Structural correctness** — pylatexenc handles brace matching, nested groups,
  and escaping correctly. Regex patterns for these are error-prone.
- **Eliminates regex entirely** — the preprocessing layer becomes a proper AST
  walk. `\dot{x}`, `\ddot{x}`, and higher-order derivatives are handled by
  recognizing the AST shape rather than text substitution.

**Trade-offs:**

- Adds pylatexenc as a dependency (currently only used for comparison, not in
  production)
- More code than the current 3-line regex approach — worthwhile only once the
  parser needs to handle matrices or other compound structures
- Requires mapping pylatexenc's structural nodes to "which parser handles this"
  — the routing logic is the new complexity

This approach should be adopted when AlgeBench needs to support linear algebra
content (matrices, eigenvalue problems, systems of ODEs in matrix form). Until
then, the regex preprocessing is sufficient.

### Vector Notation

Add support for `\vec`, `\mathbf`, and `\hat` — either via the recursive router
(preferred) or as preprocessing rules. These should strip the decoration and
annotate the variable with type metadata:

- `\vec{v}` → symbol `v` with `type: vector`
- `\hat{x}` → symbol `x` with `type: unit_vector`
- `\mathbf{F}` → symbol `F` with `type: vector`

This metadata flows into the semantic graph as node attributes, enabling
renderers to distinguish scalar from vector quantities visually.

### Symbolic Processing in the Graph

Leverage SymPy's symbolic computation capabilities to enrich the graph with
computed metadata:

- Simplified form of sub-expressions
- Dimensional analysis (if units are provided via `--var`)
- Symbolic solutions for equations and ODEs
- Expression equivalence checking for interactive exercises
- Step-by-step derivation traces for pedagogical display
