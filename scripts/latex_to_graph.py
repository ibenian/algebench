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
# Semantic metadata
# ---------------------------------------------------------------------------

# Known variable annotations: label, emoji, type, latex
# Additional properties (unit, tooltip, ai_prompt) have no defaults
# but can be supplied via user overrides.
KNOWN_VARIABLES: dict[str, dict[str, str]] = {
    # Mechanics
    "F": {"label": "force", "emoji": "🏹", "type": "vector", "latex": "F"},
    "m": {"label": "mass", "emoji": "⚖️", "type": "scalar", "latex": "m"},
    "a": {"label": "acceleration", "emoji": "🧭", "type": "vector", "latex": "a"},
    "v": {"label": "velocity", "emoji": "💨", "type": "vector", "latex": "v"},
    "t": {"label": "time", "emoji": "⏱️", "type": "scalar", "latex": "t"},
    "p": {"label": "momentum", "emoji": "🎯", "type": "vector", "latex": "p"},
    "g": {"label": "gravitational acceleration", "emoji": "🌍", "type": "scalar", "latex": "g"},
    "r": {"label": "radius", "emoji": "📏", "type": "scalar", "latex": "r"},
    "x": {"label": "position", "emoji": "📍", "type": "scalar", "latex": "x"},
    "y": {"label": "position", "emoji": "📍", "type": "scalar", "latex": "y"},
    "z": {"label": "position", "emoji": "📍", "type": "scalar", "latex": "z"},
    "d": {"label": "distance", "emoji": "📏", "type": "scalar", "latex": "d"},
    "s": {"label": "displacement", "emoji": "📏", "type": "scalar", "latex": "s"},
    "W": {"label": "work", "emoji": "⚡", "type": "scalar", "latex": "W"},
    "P": {"label": "power", "emoji": "⚡", "type": "scalar", "latex": "P"},
    # Energy
    "E": {"label": "energy", "emoji": "⚡", "type": "scalar", "latex": "E"},
    "T": {"label": "temperature", "emoji": "🌡️", "type": "scalar", "latex": "T"},
    "K": {"label": "kinetic energy", "emoji": "⚡", "type": "scalar", "latex": "K"},
    "U": {"label": "potential energy", "emoji": "⚡", "type": "scalar", "latex": "U"},
    # Electromagnetism
    "q": {"label": "charge", "emoji": "🔋", "type": "scalar", "latex": "q"},
    "V": {"label": "voltage", "emoji": "🔌", "type": "scalar", "latex": "V"},
    "I": {"label": "current", "emoji": "⚡", "type": "scalar", "latex": "I"},
    "R": {"label": "resistance", "emoji": "🔧", "type": "scalar", "latex": "R"},
    "B": {"label": "magnetic field", "emoji": "🧲", "type": "vector", "latex": "B"},
    # Waves / Quantum
    "f": {"label": "frequency", "emoji": "🔊", "type": "scalar", "latex": "f"},
    "h": {"label": "Planck constant", "emoji": "📐", "type": "scalar", "latex": "h"},
    "c": {"label": "speed of light", "emoji": "💡", "type": "scalar", "latex": "c"},
    "n": {"label": "index", "emoji": "🔢", "type": "scalar", "latex": "n"},
    "k": {"label": "wave number", "emoji": "🌊", "type": "scalar", "latex": "k"},
    # Greek letters
    "alpha": {"label": "alpha", "emoji": "🔤", "type": "scalar", "latex": "\\alpha"},
    "beta": {"label": "beta", "emoji": "🔤", "type": "scalar", "latex": "\\beta"},
    "gamma": {"label": "gamma", "emoji": "🔤", "type": "scalar", "latex": "\\gamma"},
    "delta": {"label": "delta", "emoji": "🔤", "type": "scalar", "latex": "\\delta"},
    "epsilon": {"label": "epsilon", "emoji": "🔤", "type": "scalar", "latex": "\\epsilon"},
    "theta": {"label": "angle", "emoji": "📐", "type": "scalar", "latex": "\\theta"},
    "phi": {"label": "angle", "emoji": "📐", "type": "scalar", "latex": "\\phi"},
    "psi": {"label": "wave function", "emoji": "🌊", "type": "scalar", "latex": "\\psi"},
    "omega": {"label": "angular velocity", "emoji": "🔄", "type": "scalar", "latex": "\\omega"},
    "lambda": {"label": "wavelength", "emoji": "🌊", "type": "scalar", "latex": "\\lambda"},
    "mu": {"label": "mu", "emoji": "🔤", "type": "scalar", "latex": "\\mu"},
    "sigma": {"label": "sigma", "emoji": "🔤", "type": "scalar", "latex": "\\sigma"},
    "tau": {"label": "torque", "emoji": "🔄", "type": "scalar", "latex": "\\tau"},
    "rho": {"label": "density", "emoji": "🧱", "type": "scalar", "latex": "\\rho"},
    "pi": {"label": "pi", "emoji": "🥧", "type": "constant", "latex": "\\pi"},
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


class SemanticGraphBuilder:
    """Walks a SymPy expression tree and emits nodes + edges."""

    def __init__(self, overrides: dict[str, dict[str, str]] | None = None) -> None:
        self.nodes: list[dict[str, str]] = []
        self.edges: list[dict[str, str]] = []
        self._id_counter = 0
        self._seen_symbols: dict[str, str] = {}  # symbol name → node id
        self._overrides = overrides or {}

    def _next_id(self, prefix: str = "n") -> str:
        self._id_counter += 1
        return f"__{prefix}_{self._id_counter}"

    def _add_node(self, node_id: str, **attrs: str) -> None:
        node: dict[str, str] = {"id": node_id}
        node.update(attrs)
        self.nodes.append(node)

    def _add_edge(self, src: str, dst: str) -> None:
        self.edges.append({"from": src, "to": dst})

    def build(self, expr: sympy.Basic) -> dict:
        """Build the graph from *expr* and return ``{nodes, edges}``."""
        self._walk(expr)
        return {"nodes": self.nodes, "edges": self.edges}

    def _walk(self, expr: sympy.Basic) -> str:
        """Recursively walk *expr*, returning the node id for this sub-expression."""

        # --- Symbols ---
        if isinstance(expr, Symbol):
            name = expr.name
            if name in self._seen_symbols:
                return self._seen_symbols[name]
            meta = KNOWN_VARIABLES.get(name, {})
            node_id = name
            attrs: dict[str, str] = {
                "label": meta.get("label", name),
                "emoji": meta.get("emoji", "🔣"),
                "type": meta.get("type", "scalar"),
                "latex": meta.get("latex", name),
            }
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
            self._add_node(node_id, label=str(expr), emoji="🔢", type="number")
            return node_id

        # --- Known functions (sin, cos, …) ---
        if isinstance(expr, sympy.Function):
            cls_name = type(expr).__name__
            func_name = FUNCTION_MAP.get(cls_name, cls_name)
            node_id = self._next_id(func_name)
            self._add_node(node_id, type="function", op=func_name)
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

        # --- Binary/n-ary operators (Add, Mul, Pow, Eq) ---
        op_name = OPERATOR_MAP.get(type(expr))
        if op_name is not None:
            node_id = self._next_id(op_name)
            self._add_node(node_id, type="operator", op=op_name)
            for arg in expr.args:
                child_id = self._walk(arg)
                self._add_edge(child_id, node_id)
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
        for var, count in d.variable_count:
            indep_syms.add(var)
            max_order = max(max_order, int(count))

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
    for cmd, meta in RELATION_MAP:
        idx = latex.find(cmd)
        if idx != -1:
            lhs = latex[:idx].strip()
            rhs = latex[idx + len(cmd):].strip()
            if lhs and rhs:
                return lhs, meta, rhs
    return None


def latex_to_semantic_graph(latex: str, overrides: dict[str, dict[str, str]] | None = None) -> dict:
    """Parse a LaTeX string and return a semantic graph dict.

    Handles relation operators (\\propto, \\implies, \\iff, \\to, \\approx,
    \\Rightarrow, \\Leftrightarrow) by splitting on the relation, parsing
    each side independently, and emitting a ``type='relation'`` node.
    """
    preprocessed = _preprocess_latex(latex)

    # Check for relation operators that parse_latex cannot handle.
    rel = _split_on_relation(preprocessed)
    if rel is not None:
        lhs_latex, rel_meta, rhs_latex = rel
        try:
            lhs_expr = parse_latex(lhs_latex)
            rhs_expr = parse_latex(rhs_latex)
        except Exception as exc:
            raise ValueError(f"Failed to parse LaTeX: {exc}") from exc

        builder = SemanticGraphBuilder(overrides=overrides)
        lhs_id = builder._walk(lhs_expr)
        rhs_id = builder._walk(rhs_expr)
        rel_id = builder._next_id(rel_meta["op"])
        builder._add_node(rel_id, type="relation", **rel_meta)
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
        return graph

    try:
        expr = parse_latex(preprocessed)
    except Exception as exc:
        raise ValueError(f"Failed to parse LaTeX: {exc}") from exc

    classification = _classify_expression(expr)
    builder = SemanticGraphBuilder(overrides=overrides)
    graph = builder.build(expr)
    graph["classification"] = classification
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
    parser.add_argument("--var", action="append", dest="vars", metavar="NAME:KEY=VAL,...",
                        help="Override variable properties. "
                             "Example: --var 'm:unit=kg,tooltip=Inertial mass' "
                             "--var 'a:unit=m/s²,ai_prompt=Explain acceleration'")
    args = parser.parse_args()

    try:
        overrides = parse_var_overrides(args.vars)
        graph = latex_to_semantic_graph(args.latex, overrides=overrides)
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
