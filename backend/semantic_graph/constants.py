"""Shared constants, regexes, and lookup maps for the semantic graph pipeline.

No logic — pure data definitions used by the preprocessor, translator,
and postprocessor.
"""

from __future__ import annotations

import re
from typing import Any

from sympy import (
    Add, Mul, Pow, Eq,
    StrictGreaterThan, StrictLessThan, GreaterThan, LessThan,
    pi, E, I, oo,
)

# ---------------------------------------------------------------------------
# Preprocessor constants (from server.py)
# ---------------------------------------------------------------------------

_GREEK_POOL: list[str] = [
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
    "iota", "kappa", "lambda", "mu", "nu", "xi", "rho", "sigma", "tau",
    "upsilon", "phi", "chi", "psi", "omega",
]

_ACCENT_COMMANDS: tuple[str, ...] = (
    "vec", "hat", "bar", "tilde",
    "overline", "underline", "widehat", "widetilde", "check", "breve",
    "mathring", "acute", "grave",
    "mathbf", "mathrm", "mathit", "mathsf", "mathcal", "mathfrak",
    "boldsymbol", "bm", "operatorname",
)

_DOT_ACCENT_ORDERS: dict[str, int] = {
    "dot": 1, "ddot": 2, "dddot": 3, "ddddot": 4,
}

_ORDER_TO_ACCENT: dict[int, str] = {1: "dot", 2: "ddot", 3: "dddot", 4: "ddddot"}

# ---------------------------------------------------------------------------
# Equation-chain / statement-splitting constants (from server.py)
# ---------------------------------------------------------------------------

_CHAIN_RELATION_COMMANDS: tuple[str, ...] = ("\\approx", "\\simeq")

_LOGICAL_CONNECTIVE_COMMANDS: tuple[str, ...] = (
    "\\implies", "\\impliedby", "\\iff",
    "\\Rightarrow", "\\Leftarrow", "\\Leftrightarrow",
)

# ---------------------------------------------------------------------------
# Translator constants (from scripts/latex_to_graph.py)
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

DIMENSION_PATTERN: str = (
    r"^1$|^[MLTIΘNJ](⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?(·[MLTIΘNJ](⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)?)*$"
)

KNOWN_VARIABLES: dict[str, dict[str, str]] = {
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
    "implies",
}

_SYMMETRIC_OPS: set[str] = {
    "equals", "approximately", "not_equal", "proportional", "maps_to",
    "iff", "congruent",
}

_META_RELATION_OPS: set[str] = {"implies", "iff"}

_PLACEHOLDER_NAME_RE: re.Pattern[str] = re.compile(r"^(?:Theta|Xi|Phi)_\{\d+\}$")

CONSTANT_MAP: dict[Any, dict[str, str]] = {
    pi: {"label": "pi", "latex": "\\pi"},
    E: {"label": "e (Euler's number)", "latex": "e"},
    I: {"label": "imaginary unit", "latex": "i"},
    oo: {"label": "infinity", "latex": "\\infty"},
}

RELATION_MAP: list[tuple[str, dict[str, str]]] = [
    (r"\Longleftrightarrow", {"op": "iff", "label": "if and only if", "emoji": "⟺"}),
    (r"\Longrightarrow", {"op": "implies", "label": "implies", "emoji": "⟹"}),
    (r"\Leftrightarrow", {"op": "iff", "label": "if and only if", "emoji": "⇔"}),
    (r"\Rightarrow", {"op": "implies", "label": "implies", "emoji": "⇒"}),
    (r"\implies", {"op": "implies", "label": "implies", "emoji": "⇒"}),
    (r"\propto", {"op": "proportional", "label": "proportional to", "emoji": "∝"}),
    (r"\approx", {"op": "approximately", "label": "approximately equal", "emoji": "≈"}),
    (r"\equiv", {"op": "congruent", "label": "congruent to", "emoji": "≡"}),
    (r"\iff", {"op": "iff", "label": "if and only if", "emoji": "⇔"}),
    (r"\to", {"op": "maps_to", "label": "maps to", "emoji": "→"}),
    (r"\rightarrow", {"op": "maps_to", "label": "maps to", "emoji": "→"}),
    (r"\neq", {"op": "not_equal", "label": "not equal to", "emoji": "≠"}),
    (r"\notin", {"op": "not_element_of", "label": "not element of", "emoji": "∉"}),
    (r"\in", {"op": "element_of", "label": "element of", "emoji": "∈"}),
    (r"\geq", {"op": "greater_equal", "label": "greater than or equal to", "emoji": "≥"}),
    (r"\leq", {"op": "less_equal", "label": "less than or equal to", "emoji": "≤"}),
    (r"\ge", {"op": "greater_equal", "label": "greater than or equal to", "emoji": "≥"}),
    (r"\le", {"op": "less_equal", "label": "less than or equal to", "emoji": "≤"}),
    (r"\gt", {"op": "greater_than", "label": "greater than", "emoji": ">"}),
    (r"\lt", {"op": "less_than", "label": "less than", "emoji": "<"}),
]

_STYLE_SYMBOL_COMMAND_RE: re.Pattern[str] = re.compile(
    r"\\(?P<style>mathbb|mathbf|mathcal|mathfrak|mathscr|mathrm)\s*"
    r"\{(?P<body>[^{}]+)\}"
)

_SIMPLE_STYLED_SYMBOL_RE: re.Pattern[str] = re.compile(
    r"(?:\\[a-zA-Z]+|[a-zA-Z])"
    r"(?:_(?:\{[^{}]+\}|[a-zA-Z0-9]+))?"
    r"(?:\^(?:\{[^{}]+\}|[a-zA-Z0-9]+))?"
)

# ---------------------------------------------------------------------------
# Postprocessor / display constants (from scripts/latex_to_graph.py)
# ---------------------------------------------------------------------------

_OPERATOR_GLYPHS: dict[str, str] = {
    "equals": "=", "congruent": "≡",
    "greater_than": ">", "less_than": "<",
    "greater_equal": "≥", "less_equal": "≤", "not_equal": "≠",
    "multiply": "×", "add": "+", "subtract": "−",
    "divide": "÷", "integral": "∫", "closed_integral": "∮",
    "implies": "⇒", "iff": "⇔", "piecewise": "pw", "branch": "⇒",
    "negation": "−", "not": "¬", "logical_not": "¬",
    "conjunction": "∧", "disjunction": "∨",
    "sum": "∑", "product": "∏", "limit": "lim",
    "factorial": "(·)!", "sqrt": "√(·)",
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

_OP_KINDS: frozenset[str] = frozenset({"operator", "relation", "function"})

_OPERATOR_KINDS: dict[str, str] = {
    "add": "arithmetic", "subtract": "arithmetic", "multiply": "arithmetic",
    "divide": "arithmetic", "power": "arithmetic", "negation": "arithmetic",
    "Abs": "function", "abs": "function", "sqrt": "function",
    "factorial": "arithmetic",
    "sin": "function", "cos": "function", "tan": "function",
    "log": "function", "logarithm": "function", "exp": "function",
    "equals": "comparison", "congruent": "comparison", "not_equal": "comparison",
    "greater_than": "comparison", "less_than": "comparison",
    "greater_equal": "comparison", "less_equal": "comparison",
    "element_of": "comparison", "not_element_of": "comparison",
    "implies": "logical", "iff": "logical",
    "not": "logical", "logical_not": "logical",
    "conjunction": "logical", "disjunction": "logical",
    "sum": "aggregate", "product": "aggregate",
    "integral": "aggregate", "closed_integral": "aggregate",
    "limit": "aggregate",
    "derivative": "aggregate", "partial_derivative": "aggregate",
    "inner_product": "quantum",
    "piecewise": "structural",
    "branch": "structural",
}
