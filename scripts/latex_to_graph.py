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
KNOWN_VARIABLES: dict[str, dict[str, str]] = {
    # Mechanics
    "F": {"label": "force", "emoji": "🏹", "type": "vector", "latex": "F",
           "quantity": "force", "dimension": "M·L·T⁻²", "unit": "N", "role": "dependent"},
    "m": {"label": "mass", "emoji": "⚖️", "type": "scalar", "latex": "m",
           "quantity": "mass", "dimension": "M", "unit": "kg", "role": "parameter"},
    "a": {"label": "acceleration", "emoji": "🧭", "type": "vector", "latex": "a",
           "quantity": "acceleration", "dimension": "L·T⁻²", "unit": "m/s²", "role": "dependent"},
    "v": {"label": "velocity", "emoji": "💨", "type": "vector", "latex": "v",
           "quantity": "velocity", "dimension": "L·T⁻¹", "unit": "m/s", "role": "state_variable"},
    "t": {"label": "time", "emoji": "⏱️", "type": "scalar", "latex": "t",
           "quantity": "time", "dimension": "T", "unit": "s", "role": "independent"},
    "p": {"label": "momentum", "emoji": "🎯", "type": "vector", "latex": "p",
           "quantity": "momentum", "dimension": "M·L·T⁻¹", "unit": "kg·m/s", "role": "state_variable"},
    "g": {"label": "gravitational acceleration", "emoji": "🌍", "type": "scalar", "latex": "g",
           "quantity": "acceleration", "dimension": "L·T⁻²", "unit": "m/s²", "role": "constant",
           "value": 9.80665},
    "r": {"label": "radius", "emoji": "📏", "type": "scalar", "latex": "r",
           "quantity": "length", "dimension": "L", "unit": "m", "role": "parameter"},
    "x": {"label": "position", "emoji": "📍", "type": "scalar", "latex": "x",
           "quantity": "length", "dimension": "L", "unit": "m", "role": "independent"},
    "y": {"label": "position", "emoji": "📍", "type": "scalar", "latex": "y",
           "quantity": "length", "dimension": "L", "unit": "m", "role": "independent"},
    "z": {"label": "position", "emoji": "📍", "type": "scalar", "latex": "z",
           "quantity": "length", "dimension": "L", "unit": "m", "role": "independent"},
    "d": {"label": "distance", "emoji": "📏", "type": "scalar", "latex": "d",
           "quantity": "length", "dimension": "L", "unit": "m", "role": "parameter"},
    "s": {"label": "displacement", "emoji": "📏", "type": "scalar", "latex": "s",
           "quantity": "length", "dimension": "L", "unit": "m", "role": "state_variable"},
    "W": {"label": "work", "emoji": "⚡", "type": "scalar", "latex": "W",
           "quantity": "energy", "dimension": "M·L²·T⁻²", "unit": "J", "role": "dependent"},
    "P": {"label": "power", "emoji": "⚡", "type": "scalar", "latex": "P",
           "quantity": "power", "dimension": "M·L²·T⁻³", "unit": "W", "role": "dependent"},
    # Energy
    "E": {"label": "energy", "emoji": "⚡", "type": "scalar", "latex": "E",
           "quantity": "energy", "dimension": "M·L²·T⁻²", "unit": "J", "role": "state_variable"},
    "T": {"label": "temperature", "emoji": "🌡️", "type": "scalar", "latex": "T",
           "quantity": "temperature", "dimension": "Θ", "unit": "K", "role": "state_variable"},
    "K": {"label": "kinetic energy", "emoji": "⚡", "type": "scalar", "latex": "K",
           "quantity": "energy", "dimension": "M·L²·T⁻²", "unit": "J", "role": "dependent"},
    "U": {"label": "potential energy", "emoji": "⚡", "type": "scalar", "latex": "U",
           "quantity": "energy", "dimension": "M·L²·T⁻²", "unit": "J", "role": "dependent"},
    # Electromagnetism
    "q": {"label": "charge", "emoji": "🔋", "type": "scalar", "latex": "q",
           "quantity": "charge", "dimension": "I·T", "unit": "C", "role": "parameter"},
    "V": {"label": "voltage", "emoji": "🔌", "type": "scalar", "latex": "V",
           "quantity": "voltage", "dimension": "M·L²·T⁻³·I⁻¹", "unit": "V", "role": "dependent"},
    "I": {"label": "current", "emoji": "⚡", "type": "scalar", "latex": "I",
           "quantity": "current", "dimension": "I", "unit": "A", "role": "state_variable"},
    "R": {"label": "resistance", "emoji": "🔧", "type": "scalar", "latex": "R",
           "quantity": "resistance", "dimension": "M·L²·T⁻³·I⁻²", "unit": "Ω", "role": "parameter"},
    "B": {"label": "magnetic field", "emoji": "🧲", "type": "vector", "latex": "B",
           "quantity": "magnetic_flux_density", "dimension": "M·T⁻²·I⁻¹", "unit": "T", "role": "field"},
    # Waves / Quantum
    "f": {"label": "frequency", "emoji": "🔊", "type": "scalar", "latex": "f",
           "quantity": "frequency", "dimension": "T⁻¹", "unit": "Hz", "role": "parameter"},
    "h": {"label": "Planck constant", "emoji": "📐", "type": "scalar", "latex": "h",
           "quantity": "action", "dimension": "M·L²·T⁻¹", "unit": "J·s", "role": "constant",
           "value": "6.626e-34"},
    "c": {"label": "speed of light", "emoji": "💡", "type": "scalar", "latex": "c",
           "quantity": "velocity", "dimension": "L·T⁻¹", "unit": "m/s", "role": "constant",
           "value": 299792458},
    "n": {"label": "index", "emoji": "🔢", "type": "scalar", "latex": "n",
           "role": "index"},
    "k": {"label": "wave number", "emoji": "🌊", "type": "scalar", "latex": "k",
           "quantity": "wave_number", "dimension": "L⁻¹", "unit": "m⁻¹", "role": "parameter"},
    # Greek letters
    "alpha": {"label": "alpha", "emoji": "🔤", "type": "scalar", "latex": "\\alpha",
              "role": "parameter"},
    "beta": {"label": "beta", "emoji": "🔤", "type": "scalar", "latex": "\\beta",
             "role": "parameter"},
    "gamma": {"label": "gamma", "emoji": "🔤", "type": "scalar", "latex": "\\gamma",
              "role": "parameter"},
    "delta": {"label": "delta", "emoji": "🔤", "type": "scalar", "latex": "\\delta",
              "role": "parameter"},
    "epsilon": {"label": "epsilon", "emoji": "🔤", "type": "scalar", "latex": "\\epsilon",
                "role": "parameter"},
    "theta": {"label": "angle", "emoji": "📐", "type": "scalar", "latex": "\\theta",
              "quantity": "angle", "dimension": "1", "unit": "rad", "role": "state_variable"},
    "phi": {"label": "angle", "emoji": "📐", "type": "scalar", "latex": "\\phi",
            "quantity": "angle", "dimension": "1", "unit": "rad", "role": "state_variable"},
    "psi": {"label": "wave function", "emoji": "🌊", "type": "scalar", "latex": "\\psi",
            "quantity": "wave_function", "role": "state_variable"},
    "omega": {"label": "angular velocity", "emoji": "🔄", "type": "scalar", "latex": "\\omega",
              "quantity": "angular_velocity", "dimension": "T⁻¹", "unit": "rad/s", "role": "state_variable"},
    "lambda": {"label": "wavelength", "emoji": "🌊", "type": "scalar", "latex": "\\lambda",
               "quantity": "length", "dimension": "L", "unit": "m", "role": "parameter"},
    "mu": {"label": "mu", "emoji": "🔤", "type": "scalar", "latex": "\\mu",
           "role": "parameter"},
    "sigma": {"label": "sigma", "emoji": "🔤", "type": "scalar", "latex": "\\sigma",
              "role": "parameter"},
    "tau": {"label": "torque", "emoji": "🔄", "type": "scalar", "latex": "\\tau",
            "quantity": "torque", "dimension": "M·L²·T⁻²", "unit": "N·m", "role": "dependent"},
    "rho": {"label": "density", "emoji": "🧱", "type": "scalar", "latex": "\\rho",
            "quantity": "density", "dimension": "M·L⁻³", "unit": "kg/m³", "role": "parameter"},
    "pi": {"label": "pi", "emoji": "🥧", "type": "constant", "latex": "\\pi",
           "role": "constant", "value": 3.141592653589793},
}

OPERATOR_MAP: dict[type, str] = {
    Add: "add",
    Mul: "multiply",
    Pow: "power",
    Eq: "equals",
}

FUNCTION_MAP: dict[str, str] = {
    "sin": "sin",
    "cos": "cos",
    "tan": "tan",
    "log": "log",
    "exp": "exp",
    "sqrt": "sqrt",
    "Abs": "abs",
    "asin": "arcsin",
    "acos": "arccos",
    "atan": "arctan",
}

CONSTANT_MAP: dict[Any, dict[str, str]] = {
    pi: {"label": "pi", "emoji": "🥧"},
    E: {"label": "e (Euler's number)", "emoji": "📐"},
    I: {"label": "imaginary unit", "emoji": "🔮"},
    oo: {"label": "infinity", "emoji": "♾️"},
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
]


# ---------------------------------------------------------------------------
# Graph builder
# ---------------------------------------------------------------------------

def _extract_latex_commands(latex: str) -> dict[str, str]:
    r"""Scan raw LaTeX for ``\command`` tokens and return {name: \name}.

    This preserves the user's original notation through the pipeline —
    SymPy strips backslashes (``\hbar`` → Symbol ``"hbar"``), so we
    capture them here and map them back after parsing.
    """
    return {m.group(1): m.group(0) for m in re.finditer(r"\\([a-zA-Z]+)", latex)}


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
    ) -> None:
        """Append an edge. ``semantic`` — when provided — must be one of
        ``direct`` / ``inverse`` / ``neutral`` (enum from the graph schema).

        Edges without a semantic are rendered as the theme default
        (generally ``neutral``). Themes like ``power-direction-*`` style
        the three values differently (thick red / dotted blue / plain
        gray), which lets the diagram communicate proportionality at a
        glance when the emitter has enough information to tag the edge.

        ``weight`` — when provided — encodes the *strength* of the
        relationship (e.g. the absolute exponent for a base→power edge).
        Renderers multiply this by a base stroke width and clamp to a
        safe range ``[1, 8]`` so ``x^100`` stays visually legible.
        """
        edge: dict[str, Any] = {"from": src, "to": dst}
        if semantic:
            edge["semantic"] = semantic
        if weight is not None:
            edge["weight"] = weight
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
        """Build a symbol-name → position mapping from the original LaTeX."""
        if not self._original_latex:
            return {}
        order: dict[str, int] = {}
        all_names = set(KNOWN_VARIABLES.keys()) | set(self._latex_commands.keys())
        if self._overrides:
            all_names |= set(self._overrides.keys())
        for name in all_names:
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

    def _subexpr_ordered(self, expr: sympy.Basic) -> str:
        """Like ``sympy.latex(expr)`` but with terms in authorial order."""
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

        return sympy.latex(expr)

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
            latex_fallback = self._latex_commands.get(name)
            if latex_fallback is None:
                base = name.split("_")[0] if "_" in name else None
                if base and base in self._latex_commands:
                    suffix = name[len(base):]
                    latex_fallback = self._latex_commands[base] + suffix
                elif (
                    len(name) > 1
                    and name[0] == "d"
                    and name[1:] in self._latex_commands
                ):
                    # Leibniz differential: SymPy's parse_latex merges `d\rho`
                    # into a single symbol `drho` (losing the macro). Emit
                    # `\mathrm{d}\rho` — upright d per ISO 80000-2 — so KaTeX
                    # renders `dρ` instead of the literal identifier `drho`.
                    latex_fallback = r"\mathrm{d}" + self._latex_commands[name[1:]]
                else:
                    latex_fallback = name
            attrs: dict[str, str] = {
                "label": meta.get("label", name),
                "type": meta.get("type", "scalar"),
                "latex": meta.get("latex", latex_fallback),
            }
            # Only attach an emoji when we actually know one. The old
            # "🔣" fallback renders as a broken-glyph box in most fonts
            # and adds visual noise — leave it off unless the KNOWN_VARIABLES
            # table (or a user override) provides a real emoji.
            if meta.get("emoji"):
                attrs["emoji"] = meta["emoji"]
            for sem_key in ("quantity", "dimension", "unit", "value", "role"):
                if meta.get(sem_key):
                    attrs[sem_key] = meta[sem_key]
            # Apply user overrides (can set any property: unit, tooltip, ai_prompt, etc.)
            if name in self._overrides:
                attrs.update(self._overrides[name])
            self._add_node(node_id, **attrs)
            self._seen_symbols[name] = node_id
            return node_id

        # --- Constants (pi, e, i, ∞) — check before Number since some are NumberSymbol ---
        for const, meta in CONSTANT_MAP.items():
            if expr is const:
                node_id = self._next_id("const")
                self._add_node(
                    node_id,
                    label=meta["label"],
                    emoji=meta["emoji"],
                    type="constant",
                )
                return node_id

        # --- Numbers ---
        if isinstance(expr, Number):
            node_id = self._next_id("num")
            # ``str(Float("7.2"))`` returns ``"7.20000000000000"`` (SymPy's
            # default 15-digit printer); ``sympy.latex`` trims trailing zeros
            # and also emits ``\frac{}`` for rationals, which KaTeX renders.
            self._add_node(node_id, label=sympy.latex(expr), emoji="🔢", type="number")
            return node_id

        # --- Known functions (sin, cos, …) ---
        if isinstance(expr, sympy.Function):
            cls_name = type(expr).__name__
            func_name = FUNCTION_MAP.get(cls_name, cls_name)
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
        if isinstance(expr, Derivative):
            node_id = self._next_id("deriv")
            dep_vars = [str(v) for v, _ in expr.variable_count]
            self._add_node(node_id, type="operator", op="derivative",
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
            exp_val = str(exponent)
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
                node_id, type="operator", op="power", exponent=str(expr.args[1])
            )
            base_id = self._walk(expr.args[0])
            self._add_edge(base_id, node_id)
            return node_id

        # --- Unary negation (Mul(-1, X)) — emit a single-input ``negate``
        # operator instead of the noisy ``× (-1)`` pair. The renderer
        # gives ``negate`` an inverted-triangle default shape via
        # ``graph_to_mermaid.OP_DEFAULT_SHAPES`` so the flip reads at a
        # glance; no shape lives on the node itself (graph schema is
        # semantic-only).
        if (
            isinstance(expr, Mul)
            and len(expr.args) >= 2
            and expr.args[0] == sympy.S.NegativeOne
        ):
            rest = expr.args[1:]
            node_id = self._next_id("negate")
            self._add_node(
                node_id,
                type="operator",
                op="negate",
            )
            if len(rest) == 1:
                child_id = self._walk(rest[0])
            else:
                child_id = self._walk(Mul(*rest))
            self._add_edge(child_id, node_id)
            return node_id

        # --- Binary/n-ary operators (Add, Mul, Pow, Eq) ---
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
            for arg in expr.args:
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
                self._add_edge(
                    child_id,
                    node_id,
                    semantic=child_semantic,
                    weight=child_weight,
                )
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
                "type": "text",
            }
        return rf"\Xi_{seen[content]}"

    rewritten = re.sub(r"\\text\{([^}]+)\}", repl, latex)
    return rewritten, overrides


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


def _split_on_relation(latex: str) -> tuple[str, dict[str, str], str] | None:
    """If *latex* contains a relation operator from RELATION_MAP, return
    ``(lhs_latex, relation_meta, rhs_latex)``.  Returns ``None`` when no
    relation is found."""
    best: tuple[int, str, dict[str, str]] | None = None
    for cmd, meta in RELATION_MAP:
        idx = latex.find(cmd)
        if idx != -1 and (best is None or idx < best[0]):
            best = (idx, cmd, meta)
    if best is not None:
        idx, cmd, meta = best
        lhs = latex[:idx].strip()
        rhs = latex[idx + len(cmd):].strip()
        if lhs and rhs:
            return lhs, meta, rhs
    return None


def latex_to_semantic_graph(latex: str, overrides: dict[str, dict[str, str]] | None = None, domain: str | None = None) -> dict:
    """Parse a LaTeX string and return a semantic graph dict.

    Handles relation operators (\\propto, \\implies, \\iff, \\to, \\approx,
    \\Rightarrow, \\Leftrightarrow) by splitting on the relation, parsing
    each side independently, and emitting a ``type='relation'`` node.
    """
    collapsed, text_overrides = _collapse_text_commands(latex)
    preprocessed = _preprocess_latex(collapsed)
    latex_commands = _extract_latex_commands(latex)
    # User-supplied overrides take precedence over auto-derived ones for
    # the same symbol name.
    merged_overrides: dict[str, dict[str, str]] = {**text_overrides, **(overrides or {})}
    overrides = merged_overrides

    # Check for relation operators that parse_latex cannot handle.
    rel = _split_on_relation(preprocessed)
    if rel is not None:
        lhs_latex, rel_meta, rhs_latex = rel
        try:
            lhs_expr = parse_latex(lhs_latex)
            rhs_expr = parse_latex(rhs_latex)
        except Exception as exc:
            raise ValueError(f"Failed to parse LaTeX: {exc}") from exc

        builder = SemanticGraphBuilder(overrides=overrides, latex_commands=latex_commands, original_latex=latex)
        lhs_id = builder._walk(lhs_expr)
        rhs_id = builder._walk(rhs_expr)
        for node in builder.nodes:
            if node["id"] == lhs_id:
                node["subexpr"] = lhs_latex.strip()
            elif node["id"] == rhs_id:
                node["subexpr"] = rhs_latex.strip()
        rel_id = builder._next_id(rel_meta["op"])
        builder._add_node(rel_id, type="relation", subexpr=latex.strip(), **rel_meta)
        builder._add_edge(lhs_id, rel_id)
        builder._add_edge(rhs_id, rel_id)
        graph = {"nodes": builder.nodes, "edges": builder.edges}
        # Classify based on both sides combined.  Relational expressions
        # (inequalities, Eq) don't support arithmetic, so fall back gracefully.
        try:
            combined = lhs_expr - rhs_expr
        except TypeError:
            combined = lhs_expr
        graph["classification"] = _classify_expression(combined)
        if domain:
            graph["domain"] = domain
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
    return graph


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
