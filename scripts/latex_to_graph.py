#!/usr/bin/env python3
"""Convert LaTeX expressions into semantic graphs (JSON).

Parses LaTeX into a SymPy expression tree, then walks the tree to produce
a JSON graph with ``nodes`` and ``edges``.

Usage:
    # Parse a single expression
    ./run.sh scripts/latex_to_graph.py "F = m \\cdot a"

    # Pretty-print output
    ./run.sh scripts/latex_to_graph.py --pretty "E = mc^2"

    # Override variable properties (any property: label, emoji, type, unit, tooltip, ai_prompt, latex)
    ./run.sh scripts/latex_to_graph.py --pretty \\
        --var 'm:unit=kg,tooltip=Inertial mass of the object' \\
        --var 'a:unit=m/s²,ai_prompt=Explain acceleration in Newtonian mechanics' \\
        "F = m \\cdot a"

    # Write output to file
    ./run.sh scripts/latex_to_graph.py -o graph.json "\\frac{d}{dt}(mv) = F"

Exit codes:
    0  Success
    1  Parse error or invalid input
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

try:
    import sympy
    from sympy import (
        Symbol, Function, Number, Rational, Integer, Float,
        Add, Mul, Pow, Eq, Abs,
        StrictGreaterThan, StrictLessThan, GreaterThan, LessThan,
        sin, cos, tan, log, exp, sqrt,
        Derivative, Integral, Sum, Product,
        pi, E, I, oo,
    )
except ImportError:
    print("❌ Missing dependency: sympy. Re-run via "
          "'./run.sh scripts/latex_to_graph.py ...' to auto-manage dependencies.",
          file=sys.stderr)
    sys.exit(1)

try:
    from sympy.parsing.latex import parse_latex
except ImportError:
    print("❌ Missing dependency: antlr4-python3-runtime==4.11.1. Re-run via "
          "'./run.sh scripts/latex_to_graph.py ...' to auto-manage dependencies.",
          file=sys.stderr)
    sys.exit(1)

from sympy.physics.quantum.state import KetBase, BraBase
from sympy.physics.quantum import InnerProduct


# ---------------------------------------------------------------------------
# SI base dimensions
# ---------------------------------------------------------------------------

DIMENSIONS: dict[str, dict[str, str]] = {
    "M": {"name": "mass", "si_unit": "kg", "si_unit_name": "kilogram"},
    "L": {"name": "length", "si_unit": "m", "si_unit_name": "metre"},
    "T": {"name": "time", "si_unit": "s", "si_unit_name": "second"},
    "I": {"name": "electric current", "si_unit": "A", "si_unit_name": "ampere"},
    "Θ": {"name": "temperature", "si_unit": "K", "si_unit_name": "kelvin"},
    "N": {"name": "amount of substance", "si_unit": "mol", "si_unit_name": "mole"},
    "J": {"name": "luminous intensity", "si_unit": "cd", "si_unit_name": "candela"},
}

DIMENSION_PATTERN = r"^1$|^[MLTIΘNJ](⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?(·[MLTIΘNJ](⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)*$"

# ---------------------------------------------------------------------------
# Semantic metadata
# ---------------------------------------------------------------------------
# Structural-only hints for common symbols. Used to:
#   - tag a symbol as a vector (affects renderer node shape) where the
#     bare letter is conventionally a vector quantity (F, a, v, p, B);
#   - emit the right LaTeX command for Greek letters (`\alpha`, `\rho`).
#
# Semantic fields — `label`, `emoji`, `quantity`, `dimension`, `unit`,
# `value`, `role` — are NOT pre-filled here. Showing the user a confident
# guess (e.g. `V → voltage / 🔌`) before the enricher runs is misleading
# in domains where the same symbol means something else (V is velocity in
# atmospheric entry, volume in thermo, voltage only in circuits). The
# enricher reads the lesson context and fills these properly.
KNOWN_VARIABLES: dict[str, dict[str, str]] = {
    # Common vectors — type hint only, no semantic claims.
    "F": {"type": "vector", "latex": "F"},
    "a": {"type": "vector", "latex": "a"},
    "v": {"type": "vector", "latex": "v"},
    "p": {"type": "vector", "latex": "p"},
    "B": {"type": "vector", "latex": "B"},
    # Greek-letter LaTeX commands so KaTeX renders ρ instead of `rho`.
    "alpha":   {"type": "scalar", "latex": "\\alpha"},
    "beta":    {"type": "scalar", "latex": "\\beta"},
    "gamma":   {"type": "scalar", "latex": "\\gamma"},
    "delta":   {"type": "scalar", "latex": "\\delta"},
    "epsilon": {"type": "scalar", "latex": "\\epsilon"},
    "theta":   {"type": "scalar", "latex": "\\theta"},
    "phi":     {"type": "scalar", "latex": "\\phi"},
    "psi":     {"type": "scalar", "latex": "\\psi"},
    "omega":   {"type": "scalar", "latex": "\\omega"},
    "lambda":  {"type": "scalar", "latex": "\\lambda"},
    "mu":      {"type": "scalar", "latex": "\\mu"},
    "sigma":   {"type": "scalar", "latex": "\\sigma"},
    "tau":     {"type": "scalar", "latex": "\\tau"},
    "rho":     {"type": "scalar", "latex": "\\rho"},
    "pi":      {"type": "constant", "latex": "\\pi"},
}

OPERATOR_MAP: dict[type, str] = {
    Add: "add",
    Mul: "multiply",
    Pow: "power",
    Eq: "equals",
    StrictGreaterThan: "greater_than",
    StrictLessThan: "less_than",
    GreaterThan: "greater_equal",
    LessThan: "less_equal",
}

_ASYMMETRIC_OPS: set[str] = {
    "greater_than", "less_than", "greater_equal", "less_equal",
    "element_of", "not_element_of",
}

# Relations that scope over commas: commas on either side are operand
# conjunctions, not statement separators.  Other (object-level) relations
# like ``\in`` or ``\leq`` do NOT scope over commas — the comma split
# runs first and the relation is found per-clause.
_META_RELATION_OPS: set[str] = {"implies", "iff"}

# Synthetic placeholder names emitted by ``_collapse_compound_symbols``,
# ``_collapse_text_commands``, and ``_collapse_braket_notation``. Used to
# gate placeholder restoration so user overrides keyed on real symbol names
# can never hit the substring-replace path that would otherwise corrupt
# unrelated macros (\text, \tan, \left).
_PLACEHOLDER_NAME_RE = re.compile(r"^(?:Theta|Xi|Phi)_\{\d+\}$")

# FUNCTION_MAP removed — the SymPy class name (``sin``, ``cos``, ``Abs``,
# ``asin``, …) is used directly as the ``op`` field. Renames only mattered
# for display, and the renderer / enricher handle the raw names fine.

# Mathematical constants. Labels here are unambiguous across every domain
# (∞ is infinity everywhere, π is pi everywhere) — unlike the per-symbol
# semantic claims we stripped from KNOWN_VARIABLES, these don't risk the
# "voltage in atmospheric entry" cross-domain confusion. Most are routed
# through the Symbol path by ``parse_latex``; ``sympy.oo`` is the one
# that genuinely arrives here as a NumberSymbol and needs the friendly
# label (otherwise it shows as the sympy identifier ``"oo"``).
CONSTANT_MAP: dict[Any, dict[str, str]] = {
    pi: {"label": "pi"},
    E: {"label": "e (Euler's number)"},
    I: {"label": "imaginary unit"},
    oo: {"label": "infinity"},
}

# Relations that parse_latex cannot handle — checked before SymPy parsing.
# Order matters: longer commands must come before shorter prefixes.
RELATION_MAP: list[tuple[str, dict[str, str]]] = [
    (r"\Longleftrightarrow", {"op": "iff", "label": "if and only if", "emoji": "⟺"}),
    (r"\Longrightarrow", {"op": "implies", "label": "implies", "emoji": "⟹"}),
    (r"\Leftrightarrow", {"op": "iff", "label": "if and only if", "emoji": "⇔"}),
    (r"\Rightarrow", {"op": "implies", "label": "implies", "emoji": "⇒"}),
    (r"\implies", {"op": "implies", "label": "implies", "emoji": "⇒"}),
    (r"\propto", {"op": "proportional", "label": "proportional to", "emoji": "∝"}),
    (r"\approx", {"op": "approximately", "label": "approximately equal", "emoji": "≈"}),
    (r"\iff", {"op": "iff", "label": "if and only if", "emoji": "⇔"}),
    (r"\to", {"op": "maps_to", "label": "maps to", "emoji": "→"}),
    (r"\rightarrow", {"op": "maps_to", "label": "maps to", "emoji": "→"}),
    (r"\neq", {"op": "not_equal", "label": "not equal to", "emoji": "≠"}),
    (r"\notin", {"op": "not_element_of", "label": "not element of", "emoji": "∉"}),
    (r"\in", {"op": "element_of", "label": "element of", "emoji": "∈"}),
    (r"\gt", {"op": "greater_than", "label": "greater than", "emoji": ">"}),
    (r"\lt", {"op": "less_than", "label": "less than", "emoji": "<"}),
]

_STYLE_SYMBOL_COMMAND_RE = re.compile(
    r"\\(?P<style>mathbb|mathbf|mathcal|mathfrak|mathscr|mathrm)\s*"
    r"\{(?P<body>[^{}]+)\}"
)
_SIMPLE_STYLED_SYMBOL_RE = re.compile(
    # Intentionally single-token only (letter or command with optional
    # one-level sub/superscript). Nested brace bodies are left untouched.
    r"(?:\\[a-zA-Z]+|[a-zA-Z])"
    r"(?:_(?:\{[^{}]+\}|[a-zA-Z0-9]+))?"
    r"(?:\^(?:\{[^{}]+\}|[a-zA-Z0-9]+))?"
)


# ---------------------------------------------------------------------------
# Graph builder
# ---------------------------------------------------------------------------

def _extract_latex_commands(latex: str) -> dict[str, str]:
    r"""Scan raw LaTeX for ``\command`` tokens and return {name: \name}.

    This preserves the user's original notation through the pipeline —
    SymPy strips backslashes (``\hbar`` → Symbol ``"hbar"``), so we
    capture them here and map them back after parsing.
    """
    commands = {m.group(1): m.group(0) for m in re.finditer(r"\\([a-zA-Z]+)", latex)}
    # Font/style wrappers like ``\mathbb{C}`` are parsed by SymPy as an
    # implicit product (``mathbb * C``). Track the wrapped symbol's LaTeX
    # so we can restore it after unwrapping before parse.
    for m in _STYLE_SYMBOL_COMMAND_RE.finditer(latex):
        body = m.group("body").strip()
        if not _SIMPLE_STYLED_SYMBOL_RE.fullmatch(body):
            continue
        # Keep the exact token spelling that parse_latex uses for Symbol names
        # in these single-token cases (e.g., ``\alpha`` -> ``alpha``).
        sym_name = body[1:] if body.startswith("\\") else body
        commands[sym_name] = m.group(0)
    return commands


def _strip_symbol_font_commands(latex: str) -> str:
    r"""Unwrap symbol-only style commands before SymPy parsing.

    ``parse_latex`` treats forms like ``\mathbb{C}`` as ``mathbb * C``.
    For symbol-like bodies, replace the wrapper with its inner symbol
    (``C``), while preserving the original style via ``_extract_latex_commands``.
    """
    def _repl(m: re.Match) -> str:
        body = m.group("body").strip()
        if not _SIMPLE_STYLED_SYMBOL_RE.fullmatch(body):
            return m.group(0)
        # Keep braces so neighboring commands (e.g. ``\in\mathbb{C}``) do
        # not fuse into a single token like ``\inC`` after unwrapping.
        return "{" + body + "}"

    return _STYLE_SYMBOL_COMMAND_RE.sub(_repl, latex)


def parse_var_overrides(var_specs: list[str] | None) -> dict[str, dict[str, str]]:
    """Parse ``--var`` CLI arguments into a dict of {symbol_name: {prop: value}}.

    Format: ``name:key=value,key=value,...``
    Example: ``m:unit=kg,tooltip=Inertial mass``
    """
    overrides: dict[str, dict[str, str]] = {}
    if not var_specs:
        return overrides
    for spec in var_specs:
        if ":" not in spec:
            raise ValueError(f"Invalid --var format (expected name:key=val,...): {spec!r}")
        name, rest = spec.split(":", 1)
        props: dict[str, str] = {}
        for pair in rest.split(","):
            if "=" not in pair:
                raise ValueError(f"Invalid property (expected key=value): {pair!r} in --var {spec!r}")
            k, v = pair.split("=", 1)
            props[k.strip()] = v.strip()
        overrides[name.strip()] = props
    return overrides


def _is_inverse_pow(expr: sympy.Basic) -> bool:
    """True for ``Pow(base, neg)`` where ``neg`` is a negative literal
    or a ``Mul`` starting with ``-1``. Used by the multiply parser to
    skip its over-eager ``direct`` tagging on denominator children — the
    renderer's power-source inference paints those edges ``inverse``."""
    if not isinstance(expr, Pow):
        return False
    exp = expr.args[1]
    if isinstance(exp, Number) and exp < 0:
        return True
    if isinstance(exp, Mul) and exp.args and exp.args[0] == sympy.S.NegativeOne:
        return True
    return False


# ---------------------------------------------------------------------------
# Two-form display convention
# ---------------------------------------------------------------------------
# Every node carries two display forms:
#
#   * **short label** — compact symbol shown on the graph node itself
#     (``\cos``, ``⟨0|·⟩``, ``|·|``, ``(·)²``, ``+``, ``=``).  Computed
#     by ``node_short_label(node)``.
#
#   * **long label** — full applied form shown in the details panel,
#     hover tooltip, TTS narration, and AI-enrichment context
#     (``\cos(θ/2)``, ``⟨0|ψ⟩``, ``|⟨0|ψ⟩|²``).  Computed by
#     ``node_long_label(node)``.
#
# Source-of-truth precedence:
#
#   short (op/rel/fn):  node.latex →  glyph(op, …)  →  op  →  id
#   short (data):       node.latex →  node.label    →  id
#   long  (any):        node.subexpr → node.latex   →  short label
#
# Both helpers are pure functions of the node dict — no UI logic
# lives in the renderer; it just calls these.

# Mirrors ``operatorGlyph`` in static/graph-panel/d3-semantic-graph.js.
# Keep in sync.
_OPERATOR_GLYPHS: dict[str, str] = {
    "equals": "=", "greater_than": ">", "less_than": "<",
    "greater_equal": "≥", "less_equal": "≤", "not_equal": "≠",
    "multiply": "×", "add": "+", "subtract": "−",
    "divide": "÷", "integral": "∫",
    "implies": "⇒", "iff": "⇔",
    "negation": "−", "not": "¬", "logical_not": "¬",
    "conjunction": "∧", "disjunction": "∨",
    "sum": "∑", "product": "∏", "limit": "lim",
    "factorial": "!", "sqrt": "√(·)",
    "log": "log", "logarithm": "log", "exp": "exp",
    "sin": "sin", "cos": "cos", "tan": "tan",
    "Abs": "|·|", "abs": "|·|",
    "function": "f",
}

_SUPERSCRIPT_MAP: dict[str, str] = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "−": "⁻", "n": "ⁿ", "i": "ⁱ",
}

# Node types that belong to the operator family — they share the
# operator render path (hex glyph, blue palette) but differ by kind.
_OP_KINDS: frozenset[str] = frozenset({"operator", "relation", "function"})

# ---------------------------------------------------------------------------
# Operator kinds — visual sub-classification for the operator family
# ---------------------------------------------------------------------------
# All operator/relation/function nodes share the same general shape and
# behavior, but render with a distinct *tint* per kind so different
# semantic categories read at a glance.  Mirrored as ``OPERATOR_KINDS``
# in ``static/graph-panel/d3-semantic-graph.js``.  Keep in sync.
#
#   arithmetic  — basic combiners (+, −, ×, ÷, ^, negate)
#   function    — named functions (sin, cos, log, exp, |·|, √, !)
#   comparison  — value comparators (=, ≠, <, ≤, >, ≥)
#   logical     — proposition connectives (⇒, ⇔, ¬, ∧, ∨)
#   aggregate   — variable-binding reducers (Σ, ∏, ∫, lim, d/dx, ∂/∂x)
#   quantum     — Dirac/linalg operators (⟨·|·⟩, future outer/expect.)
#
# Op-name takes precedence over node type when assigning kinds.  For
# ops not in the map, ``operator_kind`` falls back to ``function`` for
# ``type=function`` nodes and ``arithmetic`` for everything else.
# Keep in sync with OPERATOR_KINDS in static/graph-panel/d3-semantic-graph.js
_OPERATOR_KINDS: dict[str, str] = {
    # arithmetic — symbolic combiners
    "add": "arithmetic", "subtract": "arithmetic", "multiply": "arithmetic",
    "divide": "arithmetic", "power": "arithmetic", "negation": "arithmetic",
    # function — named mathematical functions (parser emits these with
    # ``type=function``, but we tag by op so the kind is correct even
    # when the same op surfaces under a different type)
    "Abs": "function", "abs": "function", "sqrt": "function",
    "factorial": "function",
    "sin": "function", "cos": "function", "tan": "function",
    "log": "function", "logarithm": "function", "exp": "function",
    # comparison
    "equals": "comparison", "not_equal": "comparison",
    "greater_than": "comparison", "less_than": "comparison",
    "greater_equal": "comparison", "less_equal": "comparison",
    "element_of": "comparison", "not_element_of": "comparison",
    # logical
    "implies": "logical", "iff": "logical",
    "not": "logical", "logical_not": "logical",
    "conjunction": "logical", "disjunction": "logical",
    # aggregate (binders + calculus)
    "sum": "aggregate", "product": "aggregate",
    "integral": "aggregate", "limit": "aggregate",
    "derivative": "aggregate", "partial_derivative": "aggregate",
    # quantum
    "inner_product": "quantum",
}


def operator_kind(node: dict) -> str | None:
    """Return the operator-kind tag for a node, or ``None`` for non-ops.

    Used by the renderer to pick a per-kind tint; also useful for TTS
    grouping ("comparison operators", "binders", …) and AI-enrichment
    context.
    """
    if node.get("type") not in _OP_KINDS:
        return None
    op = node.get("op")
    if op and op in _OPERATOR_KINDS:
        return _OPERATOR_KINDS[op]
    # Default by node type: named-function nodes → ``function`` kind,
    # everything else (operators / relations) → ``arithmetic``.
    return "function" if node.get("type") == "function" else "arithmetic"


def _to_superscript(s: str) -> str:
    return "".join(_SUPERSCRIPT_MAP.get(c, c) for c in str(s))


def _operator_glyph(node: dict) -> str | None:
    """Synthesize the compact glyph for an operator node from its ``op``.

    Returns ``None`` when there is no derivable glyph (caller should
    fall back to ``op`` or ``id``).
    """
    op = node.get("op")
    if not op:
        return None
    if op == "power":
        return f"(·){_to_superscript(node.get('exponent', 'n'))}"
    if op in ("derivative", "partial_derivative"):
        d = "∂" if op == "partial_derivative" else "d"
        wrt = node.get("with_respect_to")
        return f"{d}·/{d}{wrt}" if wrt else f"{d}·/{d}·"
    return _OPERATOR_GLYPHS.get(op)


def node_short_label(node: dict) -> str:
    """Return the SHORT label — compact symbol for the graph node.

    Operator / relation / function nodes resolve through the op-glyph
    map (``=``, ``×``, ``(·)²``, ``|·|``, ``\\cos``…), with an
    explicit parser-set ``latex`` taking precedence (e.g. ``⟨0|·⟩``
    inner-product skeleton, ``|ψ⟩`` ket).  Data nodes (scalars,
    vectors, numbers, constants…) use ``latex`` then ``label``.
    Mirrors the structure of ``getNodeLabel`` in the JS renderer.

    Precedence:
        op/rel/fn:  latex → glyph(op, …) → op → id
        data:       latex → label → id
    """
    if node.get("type") in _OP_KINDS:
        if node.get("latex"):
            return node["latex"]
        glyph = _operator_glyph(node)
        if glyph:
            return glyph
        return node.get("op") or node.get("id", "")
    # Data nodes
    if node.get("latex"):
        return node["latex"]
    if node.get("label"):
        return node["label"]
    return node.get("id", "")


def node_long_label(node: dict) -> str:
    """Return the LONG label — full applied form for the details panel.

    Precedence: ``subexpr`` (full applied form set by parser via
    ``_set_subexpr``) → ``latex`` (short label as fallback for
    atomic symbols where the two coincide) → short label.
    """
    return node.get("subexpr") or node.get("latex") or node_short_label(node)


class SemanticGraphBuilder:
    """Walks a SymPy expression tree and emits nodes + edges."""

    def __init__(
        self,
        overrides: dict[str, dict[str, str]] | None = None,
        latex_commands: dict[str, str] | None = None,
        original_latex: str | None = None,
    ) -> None:
        self.nodes: list[dict[str, str]] = []
        self.edges: list[dict[str, str]] = []
        self._id_counter = 0
        self._seen_symbols: dict[str, str] = {}  # symbol name → node id
        self._overrides = overrides or {}
        self._latex_commands = latex_commands or {}  # sympy name → \command
        self._original_latex = original_latex or ""
        self._symbol_order = self._build_symbol_order()

    @staticmethod
    def _fmt_number(expr: sympy.Basic) -> str:
        """Plain-text label for a numeric expression, without SymPy precision noise."""
        if isinstance(expr, sympy.Float):
            return sympy.latex(expr)
        return str(expr)

    def _next_id(self, prefix: str = "n") -> str:
        self._id_counter += 1
        return f"__{prefix}_{self._id_counter}"

    def _add_node(self, node_id: str, **attrs: str) -> None:
        node: dict[str, str] = {"id": node_id}
        node.update(attrs)
        self.nodes.append(node)

    def _add_edge(
        self,
        src: str,
        dst: str,
        *,
        semantic: str | None = None,
        weight: float | None = None,
        role: str | None = None,
    ) -> None:
        """Append an edge. ``semantic`` — when provided — must be one of
        ``direct`` / ``inverse`` / ``neutral`` (enum from the graph schema).

        Edges without a semantic are rendered as the theme default
        (generally ``neutral``). Themes like ``blueprint-*`` style
        the three values differently (thick red / dotted blue / plain
        gray), which lets the diagram communicate proportionality at a
        glance when the emitter has enough information to tag the edge.

        ``weight`` — when provided — encodes the *strength* of the
        relationship (e.g. the absolute exponent for a base→power edge).
        Renderers multiply this by a base stroke width and clamp to a
        safe range ``[1, 8]`` so ``x^100`` stays visually legible.

        ``role`` — ``lhs`` or ``rhs`` — tags the operand position for
        asymmetric operators (comparisons).  Renderers use this to draw
        directed arrows distinguishing left from right.
        """
        edge: dict[str, Any] = {"from": src, "to": dst}
        if semantic:
            edge["semantic"] = semantic
        if weight is not None:
            edge["weight"] = weight
        if role:
            edge["role"] = role
        self.edges.append(edge)

    def build(self, expr: sympy.Basic, original_latex: str | None = None) -> dict:
        """Build the graph from *expr* and return ``{nodes, edges}``."""
        root_id = self._walk(expr)
        if original_latex:
            for node in self.nodes:
                if node["id"] == root_id:
                    node["subexpr"] = original_latex.strip()
                    break
        return {"nodes": self.nodes, "edges": self.edges}

    def _build_symbol_order(self) -> dict[str, int]:
        """Build a symbol-name → position mapping from the original LaTeX.

        Used by ``_subexpr_ordered`` to keep ``Mul``/``Add`` factors in the
        author's writing order (e.g. ``\\frac{1}{2} m v^2`` stays in that
        order rather than getting reshuffled to SymPy's canonical
        ``\\frac{m v^2}{2}``). The candidate name set is intentionally
        broad — any single letter, common variable name, or LaTeX-command
        identifier — so removing entries from ``KNOWN_VARIABLES`` doesn't
        break the order.
        """
        if not self._original_latex:
            return {}
        order: dict[str, int] = {}
        candidates: set[str] = set()
        # Single ASCII letters (covers most physics/math symbols).
        for ch in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ":
            candidates.add(ch)
        # Anything KNOWN_VARIABLES still mentions (Greek letters, vectors).
        candidates |= set(KNOWN_VARIABLES.keys())
        # LaTeX-command identifiers from preprocessing (Greek, etc.).
        candidates |= set(self._latex_commands.keys())
        if self._overrides:
            candidates |= set(self._overrides.keys())
        for name in candidates:
            latex_cmd = self._latex_commands.get(name, "")
            for token in (latex_cmd, name):
                if token:
                    pos = self._original_latex.find(token)
                    if pos >= 0:
                        order[name] = pos
                        break
        return order

    def _original_position(self, sym_name: str) -> int:
        """Return the position of *sym_name* in the original LaTeX."""
        return self._symbol_order.get(sym_name, len(self._original_latex))

    def _symbol_latex(self, name: str) -> str | None:
        """LaTeX form for a Symbol *name*, applying the same Greek-letter
        and Leibniz-differential reconstruction as ``_walk_inner``.

        Returns ``None`` when the bare name carries no LaTeX command (so
        the caller can fall back to ``sympy.latex``). SymPy's own
        ``latex()`` doesn't know that the Symbol named ``rho_{0}`` came
        from ``\\rho_0`` — so without this, ``subexpr`` ends up as
        ``rho_{0}`` while ``latex`` is ``\\rho_{0}``, and KaTeX renders
        the tooltip as plain text instead of ρ₀.
        """
        if name in self._latex_commands:
            return self._latex_commands[name]
        if "_" in name:
            base = name.split("_")[0]
            if base in self._latex_commands:
                return self._latex_commands[base] + name[len(base):]
        if (
            len(name) > 1
            and name[0] == "d"
            and name[1:] in self._latex_commands
        ):
            return r"\mathrm{d}" + self._latex_commands[name[1:]]
        return None

    def _is_partial_derivative(self, expr) -> bool:
        """Check whether *expr* (a ``Derivative``) uses partial notation.

        Instead of a global ``\\partial in _original_latex`` check that
        would mis-classify mixed ordinary+partial expressions, we look
        for ``\\partial <var>`` where ``<var>`` is one of this specific
        derivative's variables.
        """
        if not self._original_latex:
            return False
        for v, _ in expr.variable_count:
            v_name = str(v)
            # Match  \partial t  or  \partial{t}  in the original LaTeX
            if re.search(rf"\\partial\s*\\?\{{?{re.escape(v_name)}\b", self._original_latex):
                return True
        return False

    def _subexpr_ordered(self, expr: sympy.Basic) -> str:
        """Like ``sympy.latex(expr)`` but with terms in authorial order."""
        # Atomic placeholder symbols (compound symbols and \text{...})
        # carry their real LaTeX in the override map. Render that instead
        # of the synthetic ``\Theta_{N}`` / ``\Xi_{N}`` placeholder name.
        if isinstance(expr, Symbol):
            name = expr.name
            if name in self._overrides and self._overrides[name].get("latex"):
                if name.startswith("Theta_{") or name.startswith("Xi_{"):
                    return self._overrides[name]["latex"]
            sym_latex = self._symbol_latex(name)
            if sym_latex is not None:
                return sym_latex
        if not self._original_latex:
            return sympy.latex(expr)

        if isinstance(expr, Mul):
            # Negation: ``Mul(-1, X)`` renders as ``-X`` (or ``-(…)`` when the
            # remainder is a sum). Without this, SymPy's factor enumeration
            # gives the clunky ``-1 F_{reaction}``.
            if expr.args and expr.args[0] == sympy.S.NegativeOne:
                rest = expr.args[1:]
                if len(rest) == 1:
                    sub = rest[0]
                    s = self._subexpr_ordered(sub)
                    if isinstance(sub, Add):
                        s = rf"\left({s}\right)"
                    return "-" + s
                inner = Mul(*rest)
                return "-" + self._subexpr_ordered(inner)
            # Use ``expr.args`` instead of ``as_ordered_factors()`` so
            # negative coefficients stay unified (e.g. ``Integer(-122)``
            # remains one token instead of being split into ``-1 * 122``
            # which renders as ``-1122`` after LaTeX juxtaposition).
            factors = list(expr.args)
            factors.sort(key=lambda f: self._original_position(
                str(f.args[0]) if isinstance(f, Pow) else str(f)
            ))
            parts = []
            for f in factors:
                s = self._subexpr_ordered(f)
                if isinstance(f, Add):
                    s = rf"\left({s}\right)"
                parts.append(s)
            # SymPy absorbs ``\times`` and ``\cdot`` into plain Mul, so
            # ``\nabla\times E`` becomes ``nabla * E`` and renders as
            # ``\nabla E``.  Restore the explicit operator when the
            # original LaTeX used one of these between nabla and the
            # next factor.
            #
            # The detection is *per-Mul*: we find the companion symbol
            # adjacent to nabla in *this* product and look for that
            # specific ``\nabla\times <sym>`` or ``\nabla\cdot <sym>``
            # pattern in the original LaTeX.  This avoids mis-labelling
            # when the full expression mixes both operators.
            if self._original_latex:
                for i, f in enumerate(factors):
                    if not (isinstance(f, Symbol) and f.name == "nabla"):
                        continue
                    if i + 1 >= len(factors):
                        break
                    companion = str(factors[i + 1])
                    cross_pat = rf"\\nabla\s*\\times\s*\\?{re.escape(companion)}\b"
                    dot_pat = rf"\\nabla\s*\\cdot\s*\\?{re.escape(companion)}\b"
                    if re.search(cross_pat, self._original_latex):
                        parts[i] = parts[i] + r" \times"
                    elif re.search(dot_pat, self._original_latex):
                        parts[i] = parts[i] + r" \cdot"
                    break
            return " ".join(parts)

        if isinstance(expr, Add):
            terms = list(expr.as_ordered_terms())
            terms.sort(key=lambda t: self._original_position(
                str(t.args[0]) if isinstance(t, (Mul, Pow)) else str(t)
            ))
            parts = []
            for i, t in enumerate(terms):
                s = self._subexpr_ordered(t)
                if i > 0 and not s.startswith("-"):
                    s = "+ " + s
                elif i > 0:
                    s = "- " + s[1:].lstrip()
                parts.append(s)
            return " ".join(parts)

        # SymPy always renders Derivative with "d" — restore "\partial" when
        # the original LaTeX used it.  Check per-derivative by looking for
        # ``\partial <var>`` for one of this derivative's variables, so
        # mixed ordinary+partial expressions are handled correctly.
        if isinstance(expr, Derivative) and self._is_partial_derivative(expr):
            func_latex = self._subexpr_ordered(expr.expr)
            var_parts = []
            for v, count in expr.variable_count:
                v_latex = self._subexpr_ordered(v)
                if int(count) > 1:
                    var_parts.append(rf"\partial {v_latex}^{{{int(count)}}}")
                else:
                    var_parts.append(rf"\partial {v_latex}")
            total_order = sum(int(c) for _, c in expr.variable_count)
            num = rf"\partial^{{{total_order}}} {func_latex}" if total_order > 1 else rf"\partial {func_latex}"
            den = " ".join(var_parts)
            return rf"\frac{{{num}}}{{{den}}}"

        return self._restore_placeholders(sympy.latex(expr))

    def _restore_placeholders(self, latex: str) -> str:
        """Substitute ``\\Theta_{N}`` / ``\\Xi_{N}`` back to the LaTeX they
        stand in for.

        ``sympy.latex`` is used as the fallback renderer for sub-expressions
        we don't restructure ourselves (powers, function calls, etc.). Those
        outputs still carry the synthetic placeholder names that
        ``_collapse_compound_symbols`` and ``_collapse_text_commands``
        introduced upstream, which would otherwise leak into ``subexpr``.
        """
        if not self._overrides:
            return latex
        # Gate on the synthetic-placeholder *name shape* — ``Theta_{N}`` or
        # ``Xi_{N}`` for digits N. User-supplied overrides (e.g.
        # ``--var t:latex=\mathrm{t}``) keyed on real symbol names must not
        # reach the substring replace below, or they'd corrupt every
        # incidental letter inside unrelated macros (``\text``, ``\tan``,
        # ``\left``, …).
        for name, attrs in self._overrides.items():
            if not _PLACEHOLDER_NAME_RE.fullmatch(name):
                continue
            # Prefer ``original_latex`` when present — only braket
            # overrides set it.  Their ``latex`` is the compact
            # skeleton (``⟨0|·⟩``) used as the node's display label,
            # but upstream subexprs (``|⟨0|ψ⟩|^2``, ``=`` chains)
            # need the full applied form so parents read as real
            # mathematics.
            real = attrs.get("original_latex") or attrs.get("latex")
            if not real:
                continue
            # Preserve atomicity when the placeholder sits inside a
            # SymPy-rendered construct (powers, fractions, sub/superscripts).
            # ``\Theta_{0}^{2}`` substituted naively to ``\Delta t^{2}``
            # binds ``^`` only to ``t`` per LaTeX precedence — i.e. it
            # renders as ``Δ(t²)`` instead of ``(Δt)²``. Wrap multi-token
            # replacements in braces so the exponent applies to the whole
            # compound. Already-grouped replacements (``{...}``, ``(...)``)
            # are left alone to avoid double-wrapping.
            stripped = real.strip()
            if (
                re.search(r"\s", real)
                and not (
                    (stripped.startswith("{") and stripped.endswith("}"))
                    or (stripped.startswith("(") and stripped.endswith(")"))
                )
            ):
                replacement = "{" + real + "}"
            else:
                replacement = real
            # ``sympy.latex`` renders ``Symbol("Theta_{1}")`` as
            # ``\Theta_{1}`` (Greek-letter name) or as the bare name for
            # symbols whose head isn't a recognized macro. Try both forms
            # so the placeholder is replaced regardless of how SymPy
            # rendered it.
            latex = latex.replace("\\" + name, replacement)
            latex = latex.replace(name, replacement)
        return latex

    def _set_subexpr(self, node_id: str, expr: sympy.Basic) -> None:
        """Annotate a node with the LaTeX sub-expression it represents."""
        for node in self.nodes:
            if node["id"] == node_id and "subexpr" not in node:
                node["subexpr"] = self._subexpr_ordered(expr)
                break

    def _walk(self, expr: sympy.Basic) -> str:
        """Walk *expr*, annotate the resulting node with its LaTeX sub-expression."""
        node_id = self._walk_inner(expr)
        self._set_subexpr(node_id, expr)
        return node_id

    def _walk_inner(self, expr: sympy.Basic) -> str:
        """Recursively walk *expr*, returning the node id for this sub-expression."""

        # --- Symbols ---
        if isinstance(expr, Symbol):
            name = expr.name
            if name in self._seen_symbols:
                return self._seen_symbols[name]
            meta = KNOWN_VARIABLES.get(name, {})
            node_id = name
            # Leibniz differential note: SymPy's parse_latex merges `d\rho`
            # into a single symbol `drho` (losing the macro). The helper
            # emits `\mathrm{d}\rho` — upright d per ISO 80000-2 — so KaTeX
            # renders `dρ` instead of the literal identifier `drho`.
            latex_fallback = self._symbol_latex(name) or name
            # Parser emits structural fields only — ``type`` (scalar /
            # vector / constant) and ``latex`` (Greek-letter command etc.).
            # All semantic metadata (label, emoji, quantity, dimension,
            # unit, value, role, description) is left to the enricher,
            # which reads the lesson context and avoids the cross-domain
            # confusion the old hardcoded table caused.
            attrs: dict[str, Any] = {
                "type": meta.get("type", "scalar"),
                "latex": meta.get("latex", latex_fallback),
            }
            # User overrides still win — authors can pin any property
            # (label, unit, ai_prompt, etc.) explicitly via ``\overrides{…}``.
            if name in self._overrides:
                # ``bra_content`` / ``ket_content`` / ``original_latex``
                # are internal metadata for braket operator construction
                # — not valid graph-node attributes, so filter them out
                # before merging.
                _INTERNAL_OVERRIDE_KEYS = {
                    "bra_content", "ket_content", "original_latex",
                }
                attrs.update({
                    k: v for k, v in self._overrides[name].items()
                    if k not in _INTERNAL_OVERRIDE_KEYS
                })
            # For placeholder symbols whose override carries the real LaTeX
            # (e.g. compound symbols like ``\Delta t`` collapsed to
            # ``\Theta_{N}``), prefer the override's latex as the subexpr so
            # the node doesn't display its synthetic placeholder name.
            if (
                "subexpr" not in attrs
                and name in self._overrides
                and self._overrides[name].get("latex")
                and (name.startswith("Theta_{") or name.startswith("Xi_{"))
            ):
                attrs["subexpr"] = self._overrides[name]["latex"]
            self._add_node(node_id, **attrs)
            self._seen_symbols[name] = node_id

            # --- Wire symbolic operands into braket operator nodes ---
            # The braket ``⟨bra|ket⟩`` is modeled as an *operator* node
            # whose label (``\langle 0|\cdot\rangle``) shows constant
            # basis labels verbatim and uses ``\cdot`` as a placeholder
            # for symbolic slots.  Symbolic operands (``\psi``, ``x``)
            # become child nodes wired in by edges; pure numeric
            # operands (``0``, ``1``) stay baked into the label and have
            # no edge.  Real variable names are NOT renamed by
            # ``_build_comma_separated_graph._rename``, so a shared
            # ``ψ`` that appears in both ``⟨0|ψ⟩`` and ``⟨1|ψ⟩`` across
            # newline-separated clauses collapses into a single node —
            # the cross-clause link the user expects.
            if (
                name.startswith("Phi_{")
                and name in self._overrides
                and self._overrides[name].get("op") == "inner_product"
            ):
                ovr = self._overrides[name]
                # ``latex`` on the node is the compact skeleton
                # (``⟨0|·⟩``); set ``subexpr`` to the full
                # ``⟨0|ψ⟩`` so the details panel / TTS / hover
                # show the actual mathematics.
                for n in self.nodes:
                    if n["id"] == node_id:
                        n["subexpr"] = ovr.get("original_latex", ovr["latex"])
                        break
                for part_key, edge_role in (
                    ("bra_content", "lhs"),
                    ("ket_content", "rhs"),
                ):
                    content = ovr.get(part_key, "").strip()
                    if not content or _is_braket_constant_side(content):
                        continue
                    # Parse the content through SymPy so existing dedup
                    # (``_seen_symbols``) handles cross-braket sharing.
                    try:
                        inner_expr = parse_latex(content)
                        child_id = self._walk(inner_expr)
                        self._add_edge(child_id, node_id, role=edge_role)
                    except Exception:
                        pass  # graceful degradation — braket still works

            return node_id

        # --- Constants (pi, e, i, ∞) — check before Number since some are NumberSymbol ---
        for const, meta in CONSTANT_MAP.items():
            if expr is const:
                node_id = self._next_id("const")
                attrs: dict[str, Any] = {"type": "constant"}
                if meta.get("label"):
                    attrs["label"] = meta["label"]
                # Emoji intentionally omitted — let the enricher decide.
                self._add_node(node_id, **attrs)
                return node_id

        # --- Numbers ---
        if isinstance(expr, Number):
            # Label is the numeral itself (the rendered glyph), no emoji —
            # generic 🔢 is just visual noise on a literal number.
            node_id = self._next_id("num")
            self._add_node(node_id, label=self._fmt_number(expr), type="number")
            return node_id

        # --- Functions (sin, cos, log, exp, sqrt, Abs, asin, …) ---
        # Use the SymPy class name directly as the ``op``. We used to
        # remap a handful (``Abs``→``abs``, ``asin``→``arcsin``) but the
        # rename only mattered for display, and the renderer / enricher
        # cope fine with the raw sympy names.
        if isinstance(expr, sympy.Function):
            func_name = type(expr).__name__
            node_id = self._next_id(func_name)
            func_latex = self._latex_commands.get(func_name)
            func_attrs: dict[str, str] = {"type": "function", "op": func_name}
            if func_latex:
                func_attrs["latex"] = func_latex
            self._add_node(node_id, **func_attrs)
            for arg in expr.args:
                child_id = self._walk(arg)
                self._add_edge(child_id, node_id)
            return node_id

        # --- Derivative ---
        # SymPy uses the same ``Derivative`` type for both ordinary and
        # partial derivatives.  Distinguish them by checking whether the
        # original LaTeX contained ``\partial``; the renderer uses ``∂``
        # for ``partial_derivative`` and ``d`` for ``derivative``.
        if isinstance(expr, Derivative):
            node_id = self._next_id("deriv")
            dep_vars = [str(v) for v, _ in expr.variable_count]
            op_name = "partial_derivative" if self._is_partial_derivative(expr) else "derivative"
            self._add_node(node_id, type="operator", op=op_name,
                           with_respect_to=", ".join(dep_vars))
            child_id = self._walk(expr.expr)
            self._add_edge(child_id, node_id)
            for v, _ in expr.variable_count:
                var_id = self._walk(v)
                self._add_edge(var_id, node_id)
            return node_id

        # --- Integral ---
        if isinstance(expr, Integral):
            node_id = self._next_id("integral")
            self._add_node(node_id, type="operator", op="integral")
            for arg in expr.args:
                child_id = self._walk(arg)
                self._add_edge(child_id, node_id)
            return node_id

        # --- Sum / Product ---
        if isinstance(expr, (Sum, Product)):
            op = "sum" if isinstance(expr, Sum) else "product"
            node_id = self._next_id(op)
            self._add_node(node_id, type="operator", op=op)
            for arg in expr.args:
                child_id = self._walk(arg)
                self._add_edge(child_id, node_id)
            return node_id

        # --- Power with literal exponent — absorb the number into the node ---
        if isinstance(expr, Pow) and isinstance(expr.args[1], Number):
            exponent = expr.args[1]
            exp_val = self._fmt_number(exponent)
            node_id = self._next_id("power")
            self._add_node(node_id, type="operator", op="power", exponent=exp_val)
            base_id = self._walk(expr.args[0])
            # The base→power edge stays plain. The proportionality
            # semantics for a power live on the *outgoing* edge from
            # the power node (where the squared/cubed/inverse
            # relationship is actually carried into the rest of the
            # expression). The renderer reads ``exponent`` off this
            # node at render time and tags that downstream edge —
            # see ``scripts/graph_to_mermaid.semantic_graph_to_mermaid``.
            self._add_edge(base_id, node_id)
            return node_id

        # --- Power with symbolic-negative exponent — absorb it too ---
        # ``x^{-n}`` arrives as ``Pow(x, Mul(-1, n))``. Without this
        # branch it would fall through to OPERATOR_MAP, which produces
        # a power node with no ``exponent`` attribute and a separate
        # ``__negate`` child for the exponent. The renderer then has
        # nothing to infer from. Mirroring the literal-Number path
        # absorbs ``-n`` onto the node as ``exponent="-n"`` so the
        # outgoing edge gets painted ``inverse`` at render time.
        if (
            isinstance(expr, Pow)
            and isinstance(expr.args[1], Mul)
            and expr.args[1].args
            and expr.args[1].args[0] == sympy.S.NegativeOne
        ):
            node_id = self._next_id("power")
            self._add_node(
                node_id, type="operator", op="power", exponent=self._fmt_number(expr.args[1])
            )
            base_id = self._walk(expr.args[0])
            self._add_edge(base_id, node_id)
            return node_id

        # --- Unary negation (Mul(-1, X)) — emit a single-input ``negation``
        # operator instead of the noisy ``× (-1)`` pair. The renderer
        # gives ``negation`` an inverted-triangle default shape via
        # ``graph_to_mermaid.OP_DEFAULT_SHAPES`` so the flip reads at a
        # glance; no shape lives on the node itself (graph schema is
        # semantic-only).
        if (
            isinstance(expr, Mul)
            and len(expr.args) >= 2
            and expr.args[0] == sympy.S.NegativeOne
        ):
            rest = expr.args[1:]
            node_id = self._next_id("negation")
            self._add_node(
                node_id,
                type="operator",
                op="negation",
            )
            if len(rest) == 1:
                child_id = self._walk(rest[0])
            else:
                child_id = self._walk(Mul(*rest))
            self._add_edge(child_id, node_id)
            return node_id

        # --- Binary/n-ary operators (Add, Mul, Pow, Eq, comparisons) ---
        op_name = OPERATOR_MAP.get(type(expr))
        if op_name is not None:
            node_id = self._next_id(op_name)
            self._add_node(node_id, type="operator", op=op_name)
            # Multiplication is a proportional combiner: each factor is
            # linearly proportional to the product (more ``a`` → more
            # ``a·t``, more ``t`` → more ``a·t``). We tag every factor
            # edge as ``direct`` with unit weight so themes can paint it
            # accordingly. Addition/subtraction/equality don't share
            # this property — a summand contributes additively rather
            # than multiplicatively — so those stay untagged.
            edge_semantic = "direct" if op_name == "multiply" else None
            edge_weight = 1.0 if op_name == "multiply" else None
            asymmetric = op_name in _ASYMMETRIC_OPS
            for i, arg in enumerate(expr.args):
                # Denominators arrive here as ``Pow(_, -k)`` (literal) or
                # ``Pow(_, -n)`` (symbolic) — leave those edges plain so
                # the renderer's power-source inference paints them
                # ``inverse`` instead of overriding it with ``direct``.
                child_semantic = edge_semantic
                child_weight = edge_weight
                if op_name == "multiply" and _is_inverse_pow(arg):
                    child_semantic = None
                    child_weight = None
                child_id = self._walk(arg)
                edge_role = ("lhs" if i == 0 else "rhs") if asymmetric else None
                self._add_edge(
                    child_id,
                    node_id,
                    semantic=child_semantic,
                    weight=child_weight,
                    role=edge_role,
                )
            return node_id

        # --- Dirac notation: ket |ψ⟩, bra ⟨ψ|, inner product ⟨φ|ψ⟩ ---
        if isinstance(expr, KetBase):
            label_arg = expr.args[0] if expr.args else ""
            label_latex = sympy.latex(label_arg)
            node_id = self._next_id("ket")
            ket_latex = rf"\left|{label_latex}\right\rangle"
            self._add_node(
                node_id,
                type="ket",
                latex=ket_latex,
                subexpr=ket_latex,
            )
            return node_id

        if isinstance(expr, BraBase):
            label_arg = expr.args[0] if expr.args else ""
            label_latex = sympy.latex(label_arg)
            node_id = self._next_id("bra")
            bra_latex = rf"\left\langle {label_latex}\right|"
            self._add_node(
                node_id,
                type="bra",
                latex=bra_latex,
                subexpr=bra_latex,
            )
            return node_id

        if isinstance(expr, InnerProduct):
            node_id = self._next_id("braket")
            bra_arg = expr.args[0]
            ket_arg = expr.args[1]
            bra_label = sympy.latex(bra_arg.args[0]) if bra_arg.args else ""
            ket_label = sympy.latex(ket_arg.args[0]) if ket_arg.args else ""
            # The inner product is an *operator* like ``+`` or ``=`` —
            # ``op="inner_product"`` distinguishes it from other
            # operators.  ``latex`` is the compact skeleton (display
            # label); ``subexpr`` is the full applied form (details).
            skeleton = _braket_skeleton_latex(bra_label, ket_label)
            full_latex = rf"\left\langle {bra_label}\middle|{ket_label}\right\rangle"
            self._add_node(
                node_id,
                type="operator",
                op="inner_product",
                latex=skeleton,
                subexpr=full_latex,
            )
            for inner_arg, edge_role in (
                (bra_arg, "lhs"),
                (ket_arg, "rhs"),
            ):
                if not inner_arg.args:
                    continue
                inner_label = inner_arg.args[0]
                if isinstance(inner_label, Number):
                    continue
                child_id = self._walk(inner_label)
                self._add_edge(child_id, node_id, role=edge_role)
            return node_id

        # --- Fallback: treat as a generic node with children ---
        node_id = self._next_id("expr")
        self._add_node(node_id, type="expression", op=type(expr).__name__)
        for arg in expr.args:
            child_id = self._walk(arg)
            self._add_edge(child_id, node_id)
        return node_id


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _collapse_text_commands(latex: str) -> tuple[str, dict[str, dict[str, str]]]:
    r"""Replace ``\text{NAME}`` with unique placeholder symbols SymPy can parse.

    SymPy's ``parse_latex`` decomposes multi-character identifiers into
    implicit multiplications (``const`` → ``c*o*n*s*t``). To keep each
    ``\text{...}`` as a single symbol, substitute each occurrence with a
    ``\Xi_{N}`` placeholder — Greek letter + numeric subscript is one of
    the few forms ``parse_latex`` returns atomically.

    Returns ``(rewritten_latex, overrides)`` where ``overrides`` maps the
    SymPy symbol name (e.g. ``"Xi_{0}"``) to the attributes that restore
    the original label in the graph.
    """
    overrides: dict[str, dict[str, str]] = {}
    seen: dict[str, int] = {}  # content → index, for dedup

    def repl(m: re.Match) -> str:
        content = m.group(1).strip()
        if content not in seen:
            idx = len(seen)
            seen[content] = idx
            overrides[f"Xi_{{{idx}}}"] = {
                "label": content,
                "latex": r"\text{" + content + "}",
                "type": "annotation",
            }
        return rf"\Xi_{seen[content]}"

    rewritten = re.sub(r"\\text\{([^}]+)\}", repl, latex)
    return rewritten, overrides


def _is_braket_constant_side(content: str) -> bool:
    """Decide whether the bra/ket content is a *constant* basis label
    (``0``, ``1``, ``-1``) versus a *symbolic* operand (``\\psi``, ``x``).

    Constants are baked into the braket operator's identity (its label
    distinguishes ``\\langle 0|\\cdot\\rangle`` from ``\\langle 1|\\cdot\\rangle``);
    symbolic operands become input nodes with edges flowing into the
    operator. See the inner-product handling in ``_walk_inner``.
    """
    s = content.strip()
    if not s:
        return False
    try:
        float(s)
        return True
    except ValueError:
        return False


def _braket_skeleton_latex(bra_content: str, ket_content: str) -> str:
    r"""Build a *compact* braket label where symbolic slots show ``\cdot``.

    Mirrors the convention used for ``|·|`` (Abs) and ``(·)²`` (power):
    a compact operator-only form for the node label.  The full applied
    form (``⟨0|ψ⟩``) lives in ``subexpr`` for hover / details / TTS.

    Examples:
        ``⟨0|ψ⟩``  → ``\langle 0\,|\,\cdot\rangle``   (constant bra, slot ket)
        ``⟨ψ|0⟩``  → ``\langle \cdot\,|\,0\rangle``
        ``⟨x|y⟩``  → ``\langle \cdot\,|\,\cdot\rangle``
        ``⟨0|1⟩``  → ``\langle 0\,|\,1\rangle``       (both constant)
    """
    bra_disp = bra_content if _is_braket_constant_side(bra_content) else r"\cdot"
    ket_disp = ket_content if _is_braket_constant_side(ket_content) else r"\cdot"
    return rf"\langle {bra_disp}\,|\,{ket_disp}\rangle"


def _collapse_braket_notation(latex: str) -> tuple[str, dict[str, dict[str, str]]]:
    r"""Replace Dirac bra-ket notation with placeholder symbols before SymPy
    parsing.

    SymPy's ``parse_latex`` handles simple kets (``|\psi\rangle``) natively by
    producing ``Ket`` objects, so those are left alone and handled in
    ``_walk_inner``.  However inner products (``\langle\phi|\psi\rangle``) are
    mis-parsed as ``Bra * Symbol`` — the closing ket is lost.

    This function collapses braket inner-product patterns into ``\Phi_{N}``
    placeholders so they survive parsing as atomic symbols.  The original LaTeX
    is recorded as the placeholder's override for downstream rendering.

    Returns ``(rewritten_latex, overrides)`` parallel to
    ``_collapse_text_commands``.
    """
    overrides: dict[str, dict[str, str]] = {}
    seen: dict[str, int] = {}

    def _repl_braket(m: re.Match) -> str:
        full = m.group(0)
        if full not in seen:
            idx = len(seen)
            seen[full] = idx
            bra_content = m.group(1).strip()
            ket_content = m.group(2).strip()
            # Two-form storage, mirroring how ``cos`` works: ``latex``
            # is the compact operator-only skeleton (``⟨0|·⟩``) used
            # as the node's display label; ``original_latex`` is the
            # full ``⟨0|ψ⟩`` used both as the node's ``subexpr`` and
            # as the substitution payload when upstream wrappers
            # (``|⟨0|ψ⟩|²``, ``=``, …) reference this placeholder.
            # ``bra_content`` / ``ket_content`` drive the constant-vs-
            # symbolic edge-wiring decision in ``_walk_inner``.
            overrides[f"Phi_{{{idx}}}"] = {
                "latex": _braket_skeleton_latex(bra_content, ket_content),
                "type": "operator",
                "op": "inner_product",
                "bra_content": bra_content,
                "ket_content": ket_content,
                "original_latex": full,
            }
        return rf"\Phi_{{{seen[full]}}}"

    # Inner product: \langle ... | ... \rangle  (with optional \left/\right)
    # Content between delimiters: anything except unescaped pipe at depth 0.
    braket_pat = (
        r"(?:\\left\s*)?\\langle\s*"   # opening ⟨
        r"([^|]*?)"                     # bra content (non-greedy)
        r"\s*\|\s*"                     # middle |
        r"([^|]*?)"                     # ket content (non-greedy)
        r"\s*\\rangle(?:\s*\\right\s*\.)?"  # closing ⟩
    )
    rewritten = re.sub(braket_pat, _repl_braket, latex)
    return rewritten, overrides


def _collapse_compound_symbols(latex: str) -> tuple[str, dict[str, dict[str, str]]]:
    r"""Replace compound math identifiers like ``\Delta t`` with placeholder
    symbols so SymPy's ``parse_latex`` doesn't split them into
    ``Delta * t`` via implicit multiplication.

    Targets the conventional physics/calculus prefixes that combine with
    the *next* identifier to form a single named quantity:

    - ``\Delta`` (finite change), ``\delta`` (variation) — e.g. ``\Delta t``,
      ``\delta x``

    ``\partial`` and ``\nabla`` are intentionally *not* collapsed: they
    are operator-like, applied to a following function. SymPy's grammar
    treats ``\frac{\partial u}{\partial x}`` as a partial derivative,
    and gradient scenes (``scenes/gradient-descent-terrain.json``) use
    ``\nabla f(x,y)`` where ``f`` is the gradient's argument — collapsing
    would destroy the operator/argument structure.

    Pattern: a recognized prefix command immediately followed (after
    optional whitespace) by either a single ASCII letter or another
    backslash-command identifier (``\Delta\theta``). Each match is
    replaced with a unique ``\Theta_{N}`` placeholder; the original LaTeX
    is recorded as the placeholder's ``latex`` override so the symbol
    renders correctly downstream.

    Returns ``(rewritten_latex, overrides)`` parallel to
    ``_collapse_text_commands``.
    """
    overrides: dict[str, dict[str, str]] = {}
    seen: dict[str, int] = {}

    def repl(m: re.Match) -> str:
        prefix_cmd = m.group(1)  # e.g. "\Delta"
        operand = m.group(2)     # e.g. "t" or "\theta"
        suffix = m.group(3) or ""  # e.g. "_0", "^{2n}", or ""
        compound = f"{prefix_cmd} {operand}{suffix}"
        if compound not in seen:
            idx = len(seen)
            seen[compound] = idx
            overrides[f"Theta_{{{idx}}}"] = {
                "latex": compound,
                "type": "scalar",
            }
        return rf"\Theta_{{{seen[compound]}}}"

    # Operand whitelist: Greek-letter / identifier commands only. Operators
    # like ``\cdot``, ``\times``, ``\div``, ``\pm``, ``\ast`` MUST NOT be
    # absorbed — they signal an explicit multiplication and the author who
    # writes ``\Delta \cdot t`` *means* Δ multiplied by t, not Δt.
    greek_operands = (
        r"alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|"
        r"iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|"
        r"upsilon|phi|varphi|chi|psi|omega|"
        r"Alpha|Beta|Gamma|Delta|Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|"
        r"Mu|Nu|Xi|Omicron|Pi|Rho|Sigma|Tau|Upsilon|Phi|Chi|Psi|Omega|"
        r"ell|hbar"
    )
    # Optional trailing sub/superscript chain to absorb into the placeholder,
    # so ``\Delta t_0`` collapses to a single ``\Theta_{N}`` instead of
    # leaving a dangling ``_0`` after the prefix collapse (which would emit
    # invalid double-subscripted LaTeX). Each ``_`` / ``^`` consumes either a
    # braced group (``_{ij}``, ``^{2n}``) or a single atom (``_0``, ``^t``,
    # ``^\theta``). Mirrors ``consume_sub_sup`` in
    # ``server.py::_rewrite_dot_derivatives``.
    sub_sup_atom = r"(?:\{[^{}]*\}|\\[A-Za-z]+|[A-Za-z0-9])"
    sub_sup_chain = rf"(?:[_^]{sub_sup_atom})*"
    # Whitespace between prefix and operand: regular whitespace plus the
    # LaTeX spacing macros physics authors typically use to typeset
    # ``\Delta\,t`` (\,, \;, \!, \:, \quad, \qquad). Without this,
    # ``\Delta\,t`` falls back to the implicit-multiplication split.
    spacing = r"(?:\s|\\,|\\;|\\!|\\:|\\quad|\\qquad)*"
    # ``\b`` after the Greek alternation fails when followed by ``_`` (a
    # regex word character), which would prevent ``\Delta\theta_0`` from
    # collapsing. Use ``(?![A-Za-z])`` instead — same intent, but tolerant
    # of subscript and superscript markers.
    pattern = (
        r"(\\(?:Delta|delta))"                   # prefix command
        + spacing                                  # optional whitespace
        + rf"(\\(?:{greek_operands})(?![A-Za-z])|[A-Za-z])"  # operand
        + r"(?![A-Za-z])"                          # operand isn't a word fragment
        + rf"({sub_sup_chain})"                    # optional sub/sup tail
    )
    rewritten = re.sub(pattern, repl, latex)
    return rewritten, overrides


def _extract_parenthetical_annotations(latex: str) -> tuple[str, list[dict[str, str]]]:
    r"""Strip trailing parenthetical annotations from LaTeX.

    Patterns like ``\quad (v_e \text{ constant})`` are common in physics
    notation — they annotate an assumption about a variable rather than
    contribute to the equation's mathematical structure.  SymPy cannot
    parse these because the parenthesised content mixes free variables
    with ``\text{...}`` prose, producing a juxtaposition that has no
    operator between terms.

    Detection heuristic: a parenthesised group at the *end* of the
    string that contains at least one ``\text{...}`` and is preceded by
    optional LaTeX spacing (``\quad``, ``\qquad``, whitespace).

    Returns ``(cleaned_latex, annotations)`` where each annotation dict
    has ``latex`` (the inner content without surrounding parens), ``label``
    (a plain-text rendering suitable for the overlay card), and ``type``
    (always ``"annotation"``).  Annotations are returned in source order
    (left-to-right).
    """
    annotations: list[dict[str, str]] = []
    spacing = r"(?:\s|\\quad|\\qquad|\\,|\\;|\\!|\\:)*"
    pattern = re.compile(
        spacing + r"\(([^()]*\\text\{[^}]+\}[^()]*)\)\s*$"
    )
    while True:
        m = pattern.search(latex)
        if not m:
            break
        inner = m.group(1).strip()
        label = re.sub(r"\\text\{([^}]+)\}", r"\1", inner)
        label = re.sub(r"\\[A-Za-z]+\s*", "", label)
        label = re.sub(r"[{}]", "", label)
        label = re.sub(r"\s+", " ", label).strip()
        annotations.append({
            "latex": inner,
            "label": label,
            "type": "annotation",
        })
        latex = latex[:m.start()].rstrip()
    annotations.reverse()
    return latex, annotations


def _normalize_latex(latex: str) -> str:
    r"""Normalize LaTeX constructs that are valid LaTeX but alien to SymPy's
    ``parse_latex``.

    Runs **first** in the pipeline — before braket collapse, compound-symbol
    collapse, text-command collapse, and preprocessing.  Transformations here
    must be safe to apply unconditionally and must not depend on later stages.

    Covers:

    - ``\htmlClass{cls}{content}`` → ``content`` (KaTeX highlighting wrappers)
    - ``\lvert``, ``\rvert``, ``\vert`` → ``|`` (SymPy only understands bare
      pipe for absolute-value / bra-ket delimiters)
    """
    # Strip \htmlClass{...}{content} → content  (and \htmlId, \htmlData, \htmlStyle).
    # Uses brace-balanced matching so nested braces in content are preserved.
    _html_cmd = re.compile(r"\\html[A-Za-z]+")
    parts: list[str] = []
    i = 0
    while i < len(latex):
        m = _html_cmd.match(latex, i)
        if m:
            j = m.end()
            # Skip first brace group {cls}
            if j < len(latex) and latex[j] == "{":
                depth = 1
                j += 1
                while j < len(latex) and depth > 0:
                    if latex[j] == "{": depth += 1
                    elif latex[j] == "}": depth -= 1
                    j += 1
            # Extract second brace group {content}, preserving nested braces
            if j < len(latex) and latex[j] == "{":
                depth = 1
                j += 1
                start = j
                while j < len(latex) and depth > 0:
                    if latex[j] == "{": depth += 1
                    elif latex[j] == "}": depth -= 1
                    j += 1
                parts.append(latex[start:j - 1])
            i = j
        else:
            parts.append(latex[i])
            i += 1
    latex = "".join(parts)

    # Normalize vertical-bar commands to bare pipe so downstream stages
    # (braket collapse, SymPy Abs parsing) see a uniform delimiter.
    # Order matters: \lvert / \rvert first (longer), then \vert.
    latex = re.sub(r"\\[lr]vert\b", "|", latex)
    latex = re.sub(r"\\vert\b", "|", latex)

    return latex


def _preprocess_latex(latex: str) -> str:
    """Rewrite LaTeX patterns that SymPy's parse_latex doesn't handle natively.

    Covers:
    - Higher-order Leibniz derivatives: \\frac{d^n y}{dx^n} → repeated first-order
    - Dot notation: \\dot{x}, \\ddot{x} → Derivative(x, t), Derivative(x, t, t)
    """
    # \frac{d^2 y}{dx^2}  →  \frac{d}{dx}\frac{d y}{dx}
    # \frac{\partial^2 u}{\partial x^2}  →  \frac{\partial}{\partial x}\frac{\partial u}{\partial x}
    # Also handles d^3, d^{3}, \partial^3, \partial^{3}, etc.
    def _expand_higher_deriv(m: re.Match) -> str:
        op = m.group(1)       # "d" or "\\partial"
        order = int(m.group(2) or m.group(3))
        func = m.group(4)
        var = m.group(5)
        if order <= 1:
            return m.group(0)
        wrapper = r"\frac{%s}{%s %s}" % (op, op, var)
        core = r"\frac{%s %s}{%s %s}" % (op, func, op, var)
        return wrapper * (order - 1) + core

    # Match \frac{d^N <func>}{d<var>^N}  and  \frac{\partial^N <func>}{\partial <var>^N}
    # N can be bare (^2) or braced (^{2})
    latex = re.sub(
        r"\\frac\{(d|\\partial)\^(?:\{(\d+)\}|(\d+))\s*([^}]+)\}\{\1\s*([^}]+?)\s*\^(?:\{\d+\}|\d+)\}",
        _expand_higher_deriv,
        latex,
    )

    # \dot{x} → \frac{dx}{dt}  and  \ddot{x} → \frac{d}{dt}\frac{dx}{dt}
    latex = re.sub(r"\\ddot\{([^}]+)\}", r"\\frac{d}{dt}\\frac{d \1}{d t}", latex)
    latex = re.sub(r"\\dot\{([^}]+)\}", r"\\frac{d \1}{d t}", latex)

    # \text{...} handling happens in _collapse_text_commands before this step,
    # which substitutes each occurrence with a unique \Xi_{N} placeholder that
    # SymPy's parse_latex treats as a single symbol. Collapsing to the raw
    # content (e.g. "const") fails because SymPy decomposes it into c·o·n·s·t.

    # Brace bare single-char subscripts: C_d → C_{d}  (so SymPy doesn't merge C_d A → C_{dA})
    latex = re.sub(r"_([A-Za-z0-9])(?![A-Za-z0-9_{])", r"_{\1}", latex)

    # Strip spacing commands that SymPy doesn't understand
    latex = re.sub(r"\\(?:quad|qquad|,|;|!)\s*", " ", latex)

    return latex


def _classify_expression(expr: sympy.Basic) -> dict[str, Any]:
    """Classify the expression using SymPy's ODE/PDE tools.

    Detects differential equations, their order, dependent/independent
    variables, and SymPy's own classification hints.
    """
    from sympy import classify_ode, Function as SympyFunction

    derivs = list(expr.atoms(Derivative))
    if not derivs:
        return {"kind": "algebraic"}

    # Identify dependent variables (what's being differentiated)
    # and independent variables (what we differentiate with respect to)
    dep_syms: set[Symbol] = set()
    indep_syms: set[Symbol] = set()
    max_order = 0
    for d in derivs:
        if isinstance(d.expr, Symbol):
            dep_syms.add(d.expr)
        deriv_order = 0
        for var, count in d.variable_count:
            indep_syms.add(var)
            deriv_order += int(count)
        max_order = max(max_order, deriv_order)

    is_pde = len(indep_syms) > 1
    kind = "PDE" if is_pde else "ODE"

    meta: dict[str, Any] = {
        "kind": kind,
        "order": max_order,
        "dependent_variables": sorted(str(s) for s in dep_syms),
        "independent_variables": sorted(str(s) for s in indep_syms),
    }

    # For single-variable ODEs, use SymPy's classify_ode and dsolve
    if not is_pde and len(dep_syms) == 1 and len(indep_syms) == 1:
        dep_sym = next(iter(dep_syms))
        indep_sym = next(iter(indep_syms))
        func = SympyFunction(dep_sym.name)(indep_sym)

        # Convert Symbol-based derivatives to Function-based for classify_ode
        func_expr = expr.subs(dep_sym, func)

        # Extract the expression to classify (lhs - rhs = 0)
        if isinstance(func_expr, Eq):
            ode_expr = func_expr.lhs - func_expr.rhs
        else:
            ode_expr = func_expr

        try:
            hints = classify_ode(ode_expr, func)
            classifications = [h for h in hints
                               if isinstance(h, str) and not h.endswith("_Integral")]
            if classifications:
                meta["sympy_hints"] = classifications

            # Derive properties from hints
            meta["linear"] = any("linear" in h for h in classifications)
            meta["homogeneous"] = any("homogeneous" in h for h in classifications)
            meta["constant_coefficients"] = any("constant_coeff" in h for h in classifications)
        except Exception:
            pass

    return meta


_QUAD_COMMA_RE = re.compile(r",\s*\\(?:quad|qquad)\b")


def _split_on_statement_separators(latex: str) -> list[str]:
    r"""Split *latex* on **statement separators** at brace depth 0.

    Two separator conventions are recognized in a single pass:

    1. ``\\`` — LaTeX line-break.  The strongest separator.  An optional
       spacing argument (``\\[6pt]``) is consumed and discarded.
    2. ``, \quad`` / ``, \qquad`` — a comma immediately followed by a
       ``\quad`` or ``\qquad`` spacing command.  The typographic
       convention for separating independent assertions on one line.

    Both are only matched at brace/paren/bracket depth 0, so they are
    inert inside ``{...}``, ``(...)``, ``[...]`` groups (e.g. inside
    ``\begin{cases}`` environments or matrices).

    Returns a list of trimmed, non-empty sub-expressions.  A
    single-element list means no separator was found.
    """
    parts: list[str] = []
    depth = 0
    i = 0
    start = 0
    n = len(latex)
    while i < n:
        ch = latex[i]
        if ch in "{([":
            depth += 1
            i += 1
        elif ch in "})]":
            if depth > 0:
                depth -= 1
            i += 1
        elif ch == "\\" and depth == 0:
            # --- ``\\`` newline separator ---
            if i + 1 < n and latex[i + 1] == "\\":
                end_of_bs = i + 2
                after = end_of_bs
                while after < n and latex[after] in " \t":
                    after += 1
                if after < n and latex[after] == "[":
                    bracket_end = latex.find("]", after + 1)
                    if bracket_end != -1:
                        after = bracket_end + 1
                    else:
                        after = end_of_bs
                else:
                    after = end_of_bs
                parts.append(latex[start:i])
                start = after
                i = after
            else:
                i += 1
        elif ch == "," and depth == 0:
            # --- ``, \quad`` / ``, \qquad`` separator ---
            bs = 0
            j = i - 1
            while j >= 0 and latex[j] == "\\":
                bs += 1
                j -= 1
            if bs % 2 == 1:
                i += 1
                continue
            m = _QUAD_COMMA_RE.match(latex, i)
            if m:
                parts.append(latex[start:i])
                start = m.end()
                i = start
                continue
            i += 1
        else:
            i += 1
    parts.append(latex[start:])
    nonempty = [p.strip() for p in parts if p.strip()]
    return nonempty if nonempty else [latex]


def _split_on_top_level_comma(latex: str) -> list[str]:
    r"""Detect whether any commas in *latex* act as **statement separators**
    and, if so, split the input into its separate statements.

    A comma is treated as a statement separator only when it sits at
    brace/paren/bracket depth 0 — i.e. outside every ``{...}``, ``(...)``,
    ``[...]`` group. That distinction is load-bearing: mathematical LaTeX
    overloads the comma heavily, and only the top-level occurrence
    actually separates statements.

    Commas that are *not* statement separators (and therefore not split):
    - Function arguments: ``f(x, y)``
    - Set / tuple elements: ``\{1, 2, 3\}``, ``(a, b)``
    - Multi-index subscripts: ``x_{i, j}``
    - Text content: ``\text{const, extra}``
    - LaTeX spacing commands: ``\,`` (odd run of backslashes before the comma)

    Commas that *are* statement separators (and therefore split):
    - Simultaneous definitions: ``a = 1, b = 2``
    - Constraints alongside equations: ``f(x) = x^2, x > 0``
    - Multiple equations separated by ``\quad``: ``dh/dt = -V \sin γ, \quad γ = \text{const}``

    Returns a list of trimmed, non-empty clauses. A single-element list
    means no top-level comma was found (either no commas at all, or every
    comma was nested or escaped).
    """
    parts: list[str] = []
    depth = 0
    start = 0
    for i, ch in enumerate(latex):
        if ch in "{([":
            depth += 1
        elif ch in "})]":
            if depth > 0:
                depth -= 1
        elif ch == "," and depth == 0:
            # Skip LaTeX spacing commands like ``\,`` (thin space). An odd
            # run of backslashes immediately before the comma means it's
            # escaped and part of the command, not a clause separator.
            bs = 0
            j = i - 1
            while j >= 0 and latex[j] == "\\":
                bs += 1
                j -= 1
            if bs % 2 == 1:
                continue
            parts.append(latex[start:i])
            start = i + 1
    parts.append(latex[start:])
    nonempty = [p.strip() for p in parts if p.strip()]
    return nonempty if nonempty else [latex]


_LEADING_SPACE_CMD_RE = re.compile(r"^\s*(?:\\(?:quad|qquad|,|;|!|:)\s*)+")


def _is_bare_variable(clause: str) -> bool:
    r"""Return ``True`` when *clause* looks like a bare variable/symbol.

    A "bare variable" is a single symbol token — e.g. ``\alpha``,
    ``x``, ``\hat{y}``, ``\mathbb{C}`` — with no operators.  Used by
    :func:`_rejoin_subject_group_commas` to detect the subject-grouping
    comma pattern ``\alpha, \beta \in \mathbb{C}``.
    """
    stripped = _LEADING_SPACE_CMD_RE.sub("", clause).strip()
    if not stripped:
        return False
    if _split_on_relation(stripped) is not None:
        return False
    d = 0
    for ch in stripped:
        if ch in "{([":
            d += 1
        elif ch in "})]":
            if d > 0:
                d -= 1
        elif d == 0 and ch in "=+":
            return False
    return True


def _rejoin_subject_group_commas(clauses: list[str]) -> list[str]:
    r"""Re-join comma-separated subject lists that precede a relation.

    In mathematical notation ``\alpha, \beta \in \mathbb{C}`` means *both*
    α and β belong to ℂ.  After :func:`_split_on_top_level_comma` this
    becomes ``['\alpha', '\beta \in \mathbb{C}']`` — the bare ``\alpha``
    clause should be re-joined with ``\beta \in \mathbb{C}`` to form the
    composite expression ``\alpha, \beta \in \mathbb{C}``.

    A bare-variable clause is re-joined with its successor when:

    1. It contains no relation operator and no arithmetic operators
       (``=``, ``+``) at depth 0 — see :func:`_is_bare_variable`.
    2. The successor contains a relation operator from ``RELATION_MAP``.

    The loop runs until no more re-joins are possible, handling chains
    like ``x, y, z \in \mathbb{R}`` (three variables, one relation).
    """
    if len(clauses) <= 1:
        return clauses
    result = list(clauses)
    changed = True
    while changed:
        changed = False
        merged: list[str] = []
        i = 0
        while i < len(result):
            if (
                i + 1 < len(result)
                and _is_bare_variable(result[i])
                and _split_on_relation(result[i + 1]) is not None
            ):
                merged.append(result[i] + ", " + result[i + 1])
                i += 2
                changed = True
            else:
                merged.append(result[i])
                i += 1
        result = merged
    return result


def _split_on_relation(latex: str) -> tuple[str, dict[str, str], str] | None:
    """If *latex* contains a top-level relation operator from RELATION_MAP,
    return ``(lhs_latex, relation_meta, rhs_latex)``.  Returns ``None``
    when no relation is found.

    Only matches at brace/paren/bracket depth 0 so that operators
    inside subscripts or fractions are ignored.
    """
    best: tuple[int, str, dict[str, str]] | None = None
    # Build depth map: depth[i] = nesting depth at position i.
    n = len(latex)
    depth = [0] * n
    d = 0
    for i in range(n):
        if latex[i] in "{([":
            d += 1
        depth[i] = d
        if latex[i] in "})]" and d > 0:
            d -= 1
            depth[i] = d
    for cmd, meta in RELATION_MAP:
        clen = len(cmd)
        cmd_is_alpha = cmd[-1].isalpha()
        idx = 0
        while idx <= n - clen:
            pos = latex.find(cmd, idx)
            if pos == -1:
                break
            end = pos + clen
            if cmd_is_alpha and end < n and latex[end].isalpha():
                idx = end
                continue
            if depth[pos] == 0:
                if best is None or pos < best[0]:
                    best = (pos, cmd, meta)
                break
            idx = pos + 1
    if best is not None:
        idx, cmd, meta = best
        lhs = latex[:idx].strip()
        rhs = latex[idx + len(cmd):].strip()
        if lhs and rhs:
            return lhs, meta, rhs
    return None


def _split_chained_equals(latex: str) -> tuple[str, dict[str, str], str] | None:
    r"""Split on first ``=`` only when 2+ bare ``=`` exist at depth 0.

    A single ``a = b`` is fine for SymPy (``Eq(a, b)``), but chained
    ``a = b = c`` produces ``Eq(Eq(a, b), c)`` which evaluates to
    ``BooleanFalse``.  Splitting on the first ``=`` yields LHS ``a``
    and RHS ``b = c``; the RHS is parsed recursively as ``Eq(b, c)``.
    """
    n = len(latex)
    d = 0
    eq_positions: list[int] = []
    for i in range(n):
        ch = latex[i]
        if ch in "{([":
            d += 1
        elif ch in "})]" and d > 0:
            d -= 1
        elif ch == "=" and d == 0:
            eq_positions.append(i)
    if len(eq_positions) < 2:
        return None
    first = eq_positions[0]
    lhs = latex[:first].strip()
    rhs = latex[first + 1:].strip()
    if lhs and rhs:
        meta = {"op": "equals", "label": "equals", "emoji": "="}
        return lhs, meta, rhs
    return None


def _build_relation_graph(
    lhs_latex: str,
    rel_meta: dict[str, str],
    rhs_latex: str,
    original_latex: str,
    *,
    overrides: dict[str, dict[str, str]] | None,
    latex_commands: dict[str, str] | None = None,
    parenthetical_annotations: list | None = None,
    domain: str | None = None,
) -> dict:
    r"""Build a graph for a binary relation ``lhs <op> rhs``.

    Handles comma-joined operand conjunctions on either side (e.g. the
    LHS of ``\alpha, \beta \in \mathbb{C}`` becomes an ``and`` node
    grouping α and β).  Classification falls back to ``algebraic`` when
    either side is a conjunction.
    """
    builder = SemanticGraphBuilder(
        overrides=overrides,
        latex_commands=latex_commands or {},
        original_latex=original_latex,
    )

    def _walk_relation_side(side_latex: str) -> tuple[str, sympy.Basic | None]:
        side_clauses = _split_on_top_level_comma(side_latex)
        if len(side_clauses) <= 1:
            expr = parse_latex(side_latex)
            return builder._walk(expr), expr

        clause_roots: list[str] = []
        for clause in side_clauses:
            cleaned = _LEADING_SPACE_CMD_RE.sub("", clause).strip()
            sub_expr = parse_latex(cleaned)
            cid = builder._walk(sub_expr)
            for node in builder.nodes:
                if node["id"] == cid:
                    node["subexpr"] = builder._restore_placeholders(cleaned)
                    break
            clause_roots.append(cid)
        conj_id = builder._next_id("and")
        builder._add_node(
            conj_id,
            type="relation",
            op="and",
            label="and",
            emoji=",",
            subexpr=builder._restore_placeholders(side_latex.strip()),
        )
        for cid in clause_roots:
            builder._add_edge(cid, conj_id)
        return conj_id, None

    try:
        lhs_id, lhs_expr = _walk_relation_side(lhs_latex)
        rhs_id, rhs_expr = _walk_relation_side(rhs_latex)
    except Exception as exc:
        raise ValueError(f"Failed to parse LaTeX: {exc}") from exc

    for node in builder.nodes:
        if node["id"] == lhs_id and lhs_expr is not None:
            node["subexpr"] = builder._restore_placeholders(lhs_latex.strip())
        elif node["id"] == rhs_id and rhs_expr is not None:
            node["subexpr"] = builder._restore_placeholders(rhs_latex.strip())

    rel_id = builder._next_id(rel_meta["op"])
    builder._add_node(
        rel_id, type="relation", subexpr=original_latex.strip(), **rel_meta,
    )
    rel_asymmetric = rel_meta["op"] in _ASYMMETRIC_OPS
    builder._add_edge(lhs_id, rel_id, role="lhs" if rel_asymmetric else None)
    builder._add_edge(rhs_id, rel_id, role="rhs" if rel_asymmetric else None)

    graph: dict = {"nodes": builder.nodes, "edges": builder.edges}
    if lhs_expr is not None and rhs_expr is not None:
        try:
            combined = lhs_expr - rhs_expr
        except TypeError:
            combined = lhs_expr
        graph["classification"] = _classify_expression(combined)
    else:
        graph["classification"] = {"kind": "algebraic"}
    if domain:
        graph["domain"] = domain
    _inject_annotations(graph, parenthetical_annotations or [])
    return graph


def _build_comma_separated_graph(
    clauses: list[str],
    overrides: dict[str, dict[str, str]] | None,
    domain: str | None,
) -> dict:
    r"""Parse each statement-separator-detected clause independently and
    emit them as **parallel statements in the same graph** — no parent
    or relation node joining them.

    Precondition: the caller has already run ``_split_on_top_level_comma``
    and confirmed these commas are statement separators (not function
    arguments, tuple elements, etc.).

    Comma-separated clauses in mathematical notation cover constraints
    (``f(x) = x^2, x > 0``), simultaneous definitions (``a = 1, b = 2``),
    and constraints alongside equations (``\frac{dh}{dt} = -V \sin\gamma,
    \gamma = \text{const}``). They're semantically independent statements
    that happen to share a line — the comma is a pure notational
    separator, not a logical operator. So: no ``\land``, no ``comma``
    relation node. Each clause stands on its own; the graph contains
    each clause's subtree as an independent rooted structure.

    Shared variables across clauses (e.g. ``γ`` appearing in both
    ``dh/dt = -V \sin γ`` and ``γ = const``) still dedup to a single
    node — that's an organic property of the expression, not an
    imposed relation. The resulting graph may therefore be multi-rooted
    (truly disconnected when clauses share no symbols, or connected
    only through shared variable nodes when they do).

    Operator/relation node ids are scoped per-clause with a ``c<i>_``
    prefix to avoid collisions. If any clause fails to parse,
    ``ValueError`` is raised (consistent with #137 — no silent drops).
    """
    merged_nodes: dict[str, dict] = {}
    merged_edges: list[dict] = []
    clause_classifications: list[dict] = []
    cleaned_clauses: list[str] = []

    # Trim leading LaTeX spacing commands from each clause — they're visual
    # (``\quad`` after a comma is a common authoring pattern) and otherwise
    # leak into the clause's root subexpr, e.g. ``\quad \gamma = \text{const}``.
    _leading_space_re = re.compile(r"^\s*(?:\\(?:quad|qquad|,|;|!|:)\s*)+")
    for clause in clauses:
        cleaned_clauses.append(_leading_space_re.sub("", clause).strip())

    for ci, clause in enumerate(cleaned_clauses):
        try:
            sub = latex_to_semantic_graph(clause, overrides=overrides, domain=domain)
        except Exception as exc:
            raise ValueError(
                f"Failed to parse clause {ci + 1} ({clause!r}) of "
                f"comma-separated expression: {exc}"
            ) from exc
        if not isinstance(sub, dict) or not sub.get("nodes"):
            raise ValueError(
                f"Clause {ci + 1} ({clause!r}) produced no graph nodes"
            )

        prefix = f"c{ci}_"

        def _rename(nid: str, p: str = prefix) -> str:
            """Scope per-clause ids with *p* so they don't collide when
            clauses are merged. Namespacing covers:

            - ``__``-prefixed operator / relation / function ids, which
              ``SemanticGraphBuilder`` auto-numbers per-parse (``__add_1``,
              ``__equals_1``, …) and would otherwise alias across clauses.
            - ``Xi_{N}`` text-command placeholders that
              ``_collapse_text_commands`` assigns per-parse (so
              ``\\text{foo}`` in clause 0 and ``\\text{bar}`` in clause 1
              would both be ``Xi_{0}`` and get incorrectly merged into one
              text node).

            Real free variables (``x``, ``\\gamma``, …) are NOT renamed —
            their dedup across clauses is the intended cross-statement
            link (e.g. ``γ`` appearing in both clauses of the
            ``dh/dt = -V \\sin γ, γ = const`` example stays a single node).
            """
            if not isinstance(nid, str):
                return nid
            if nid.startswith("__"):
                return p + nid
            if nid.startswith("Xi_{") or nid.startswith("Theta_{") or nid.startswith("Phi_{"):
                return p + nid
            return nid

        for n in sub.get("nodes") or []:
            if not isinstance(n, dict) or "id" not in n:
                continue
            new_id = _rename(n["id"])
            cloned = dict(n)
            cloned["id"] = new_id
            if new_id not in merged_nodes:
                merged_nodes[new_id] = cloned
            else:
                # Shared variable — fill gaps without overwriting richer existing data.
                for k, v in cloned.items():
                    merged_nodes[new_id].setdefault(k, v)

        for e in sub.get("edges") or []:
            new_edge = dict(e)
            new_edge["from"] = _rename(e.get("from", ""))
            new_edge["to"] = _rename(e.get("to", ""))
            merged_edges.append(new_edge)

        # Stash this clause's own classification for the top-level
        # ``clauses`` list (preserves PDE/ODE/algebraic info per clause
        # so downstream consumers don't have to re-walk the subtrees).
        sub_cls = sub.get("classification")
        if isinstance(sub_cls, dict):
            clause_classifications.append(sub_cls)
        else:
            clause_classifications.append({"kind": "algebraic"})

    # No parent/relation node. The graph is multi-rooted: each clause has
    # its own root (the node with no outgoing edge within its clause). If
    # clauses share symbols like γ, they connect through that variable;
    # otherwise they're truly disconnected sub-graphs in the same nodes/
    # edges dict. ``classification.kind = "statements"`` signals that the
    # graph carries multiple independent statements.
    result: dict = {
        "nodes": list(merged_nodes.values()),
        "edges": merged_edges,
        "classification": {
            "kind": "statements",
            "count": len(cleaned_clauses),
            # Per-clause classifications so downstream can see that,
            # e.g., statement 0 is a PDE while statement 1 is algebraic
            # — without re-walking the clause subtrees.
            "clauses": clause_classifications,
        },
    }
    if domain:
        result["domain"] = domain
    return result


def latex_to_semantic_graph(latex: str, overrides: dict[str, dict[str, str]] | None = None, domain: str | None = None) -> dict:
    """Parse a LaTeX string and return a semantic graph dict.

    Handles relation operators (\\propto, \\implies, \\iff, \\to, \\approx,
    \\Rightarrow, \\Leftrightarrow) by splitting on the relation, parsing
    each side independently, and emitting a ``type='relation'`` node.

    Also handles top-level comma-separated clauses (``a = 1, b = 2``) by
    first detecting whether the comma is acting as a **statement
    separator** (as opposed to a function-argument or tuple separator),
    then parsing each clause independently and emitting each as an
    independent statement in the same graph — no forced parent or
    relation node. Shared variables across clauses dedup to one node.
    """
    user_overrides = overrides
    latex = _normalize_latex(latex)
    latex, parenthetical_annotations = _extract_parenthetical_annotations(latex)

    # --- Strong statement separators (``\\`` and ``, \quad``) ---
    # Both are checked in a single pass before any preprocessing.
    # Each resulting clause is parsed independently via recursive calls.
    strong_clauses = _split_on_statement_separators(latex)
    if len(strong_clauses) > 1:
        graph = _build_comma_separated_graph(
            strong_clauses, overrides=user_overrides, domain=domain,
        )
        _inject_annotations(graph, parenthetical_annotations)
        return graph

    braket_collapsed, braket_overrides = _collapse_braket_notation(latex)
    compound_collapsed, compound_overrides = _collapse_compound_symbols(braket_collapsed)
    collapsed, text_overrides = _collapse_text_commands(compound_collapsed)
    font_unwrapped = _strip_symbol_font_commands(collapsed)
    preprocessed = _preprocess_latex(font_unwrapped)
    latex_commands = _extract_latex_commands(latex)
    # User-supplied overrides take precedence over auto-derived ones for
    # the same symbol name.
    merged_overrides: dict[str, dict[str, str]] = {
        **braket_overrides,
        **compound_overrides,
        **text_overrides,
        **(user_overrides or {}),
    }
    overrides = merged_overrides

    # Detect the top-level relation once; reused by both the meta-first
    # path and the deferred object-relation path below.
    rel = _split_on_relation(preprocessed)

    # --- Meta relations (implies, iff) take priority over commas (#208) ---
    # Commas on either side of a meta connective are operand-level
    # conjunctions, not statement separators.
    if rel is not None and rel[1]["op"] in _META_RELATION_OPS:
        lhs_latex, rel_meta, rhs_latex = rel
        graph = _build_relation_graph(
            lhs_latex, rel_meta, rhs_latex, latex,
            overrides=overrides, latex_commands=latex_commands,
            parenthetical_annotations=parenthetical_annotations, domain=domain,
        )
        return graph

    # --- Bare-comma split (fallback) ---
    # Strong separators (``\\``, ``, \quad``) were already handled above.
    # Bare commas without ``\quad`` may still separate statements
    # (e.g. ``a = 1, b = 2``).  Re-join subject-group commas so that
    # ``\alpha, \beta \in \mathbb{C}`` stays as one clause.
    clauses = _split_on_top_level_comma(latex)
    if len(clauses) > 1:
        clauses = _rejoin_subject_group_commas(clauses)
    if len(clauses) > 1:
        graph = _build_comma_separated_graph(
            clauses, overrides=user_overrides, domain=domain,
        )
        _inject_annotations(graph, parenthetical_annotations)
        return graph

    # --- Object-level relations (\in, \leq, etc.) ---
    # Reached when the expression is a single clause (possibly after
    # re-joining collapsed all commas back, e.g. ``α, β ∈ ℂ``).
    if rel is not None:
        lhs_latex, rel_meta, rhs_latex = rel
        graph = _build_relation_graph(
            lhs_latex, rel_meta, rhs_latex, latex,
            overrides=overrides, latex_commands=latex_commands,
            parenthetical_annotations=parenthetical_annotations, domain=domain,
        )
        return graph

    # Chained equals (``a = b = c``): SymPy produces
    # ``Eq(Eq(a, b), c)`` → ``BooleanFalse``.  Split on the first ``=``
    # only when 2+ bare ``=`` exist at depth 0.  Runs after comma split
    # so ``a = 1, b = 2`` is correctly handled as independent clauses.
    chained = _split_chained_equals(preprocessed)
    if chained is not None:
        lhs_latex, rel_meta, rhs_latex = chained
        builder = SemanticGraphBuilder(overrides=overrides, latex_commands=latex_commands, original_latex=latex)
        # Mirror the controlled-error pattern used by the relation
        # branch above (line ~1858).  An unparsable side here would
        # otherwise bubble up an opaque SymPy/ANTLR exception instead
        # of the ``ValueError`` callers expect from this entry point.
        try:
            lhs_expr = parse_latex(lhs_latex)
            lhs_id = builder._walk(lhs_expr)
            rhs_expr = parse_latex(rhs_latex)
            rhs_id = builder._walk(rhs_expr)
        except Exception as exc:
            raise ValueError(f"Failed to parse LaTeX: {exc}") from exc
        for node in builder.nodes:
            if node["id"] == lhs_id:
                node["subexpr"] = builder._restore_placeholders(lhs_latex.strip())
            elif node["id"] == rhs_id:
                node["subexpr"] = builder._restore_placeholders(rhs_latex.strip())
        rel_id = builder._next_id(rel_meta["op"])
        builder._add_node(rel_id, type="relation", subexpr=latex.strip(), **rel_meta)
        builder._add_edge(lhs_id, rel_id)
        builder._add_edge(rhs_id, rel_id)
        graph = {"nodes": builder.nodes, "edges": builder.edges}
        if lhs_expr is not None and rhs_expr is not None:
            try:
                combined = lhs_expr - rhs_expr
            except TypeError:
                combined = lhs_expr
            graph["classification"] = _classify_expression(combined)
        else:
            graph["classification"] = {"kind": "algebraic"}
        if domain:
            graph["domain"] = domain
        _inject_annotations(graph, parenthetical_annotations)
        return graph

    try:
        expr = parse_latex(preprocessed)
    except Exception as exc:
        raise ValueError(f"Failed to parse LaTeX: {exc}") from exc

    classification = _classify_expression(expr)
    builder = SemanticGraphBuilder(overrides=overrides, latex_commands=latex_commands, original_latex=latex)
    graph = builder.build(expr, original_latex=latex)
    graph["classification"] = classification
    if domain:
        graph["domain"] = domain
    _inject_annotations(graph, parenthetical_annotations)
    return graph


def _inject_annotations(graph: dict, annotations: list[dict[str, str]]) -> None:
    """Append parenthetical annotation nodes to the graph."""
    for i, ann in enumerate(annotations):
        node_id = f"__annotation_{i}"
        node: dict[str, Any] = {"id": node_id}
        node.update(ann)
        graph.setdefault("nodes", []).append(node)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert LaTeX expressions to semantic graphs (JSON).",
    )
    parser.add_argument("latex", help="LaTeX expression to parse")
    parser.add_argument("--pretty", action="store_true",
                        help="Pretty-print the JSON output")
    parser.add_argument("-o", "--output", type=str, default=None,
                        help="Write JSON to a file instead of stdout")
    parser.add_argument("--domain", type=str, default=None,
                        help="Domain of the expression (e.g. 'thermodynamics', 'linear_algebra')")
    parser.add_argument("--var", action="append", dest="vars", metavar="NAME:KEY=VAL,...",
                        help="Override variable properties. "
                             "Example: --var 'm:unit=kg,tooltip=Inertial mass' "
                             "--var 'a:unit=m/s²,ai_prompt=Explain acceleration'")
    args = parser.parse_args()

    try:
        overrides = parse_var_overrides(args.vars)
        graph = latex_to_semantic_graph(args.latex, overrides=overrides, domain=args.domain)
    except ValueError as exc:
        print(f"❌ {exc}", file=sys.stderr)
        sys.exit(1)

    indent = 2 if args.pretty else None
    result = json.dumps(graph, indent=indent, ensure_ascii=False)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result + "\n")
        print(f"✅ Graph written to {args.output}")
    else:
        print(result)


if __name__ == "__main__":
    main()
