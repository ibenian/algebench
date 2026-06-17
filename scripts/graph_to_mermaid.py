#!/usr/bin/env python3
"""Convert a semantic graph (JSON) into a Mermaid flowchart diagram.

Reads a semantic graph produced by ``latex_to_graph.py`` and renders it as
Mermaid syntax with a configurable visual theme (loaded from
``themes/semantic-graph/``).

Usage:
    # From a JSON file
    ./run.sh scripts/graph_to_mermaid.py graph.json

    # With a named theme
    ./run.sh scripts/graph_to_mermaid.py --theme textbook-light graph.json

    # Pipe from latex_to_graph
    ./run.sh scripts/latex_to_graph.py "F = m \\cdot a" | ./run.sh scripts/graph_to_mermaid.py -

    # LaTeX labels instead of emoji
    ./run.sh scripts/graph_to_mermaid.py --label-mode latex graph.json

    # Write output to file
    ./run.sh scripts/graph_to_mermaid.py -o diagram.md graph.json

Exit codes:
    0  Success
    1  Invalid input or missing theme
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


THEME_DIR = Path(__file__).parent.parent / "themes" / "semantic-graph"
SCHEMA_PATH = Path(__file__).parent.parent / "schemas" / "semantic-graph.schema.json"

SHAPE_WRAPPERS: dict[str, tuple[str, str]] = {
    "rect":    ("[",   "]"),
    "circle":  ("((", "))"),
    "stadium": ("([", "])"),
    "hexagon": ("{{", "}}"),
    "octagon": ("{{", "}}"),
    "diamond": ("{",   "}"),
}

TYPE_DEFAULT_SHAPES: dict[str, str] = {
    "operator": "hexagon",
    "function": "hexagon",
    "relation": "diamond",
    "result":   "stadium",
}

# Mermaid 11+ extended shape library (typed-shape syntax:
# ``nid@{ shape: "tri", label: "X" }``). Classic ``[...]``/``((...))``
# wrappers don't cover these, so we emit the attribute form for any shape
# listed here. Keeps compatibility: any shape not in either table falls
# back to ``rect``.
TYPED_SHAPES: dict[str, str] = {
    "triangle":       "tri",
    "inv_triangle":   "flip-tri",
    "trap_top":       "trap-t",
    "trap_bot":       "trap-b",
    "framed_circle":  "fr-circ",
    "framed_rect":    "fr-rect",
    "double_circle":  "dbl-circ",
    "lean_right":     "lean-r",
    "lean_left":      "lean-l",
    "hourglass":      "hourglass",
    "notched_rect":   "notch-rect",
    "bow_tie":        "bow-rect",
    "cloud":          "cloud",
}

OPERATOR_SYMBOLS: dict[str, str] = {
    "add": "+",
    "subtract": "−",
    "multiply": "×",
    "divide": "÷",
    "negation": "−",
    "neg": "¬(·)",
    "power": "(·)˙",
    "equals": "=",
    "greater_than": ">",
    "less_than": "<",
    "greater_equal": "≥",
    "less_equal": "≤",
    "derivative": "d/d·",
    "partial_derivative": "∂/∂·",
    "integral": "∫", "closed_integral": "∮",
    "sum": "Σ",
    "product": "∏",
    "limit": "lim",
    "tends_to": "→",
    "sin": "sin",
    "cos": "cos",
    "tan": "tan",
    "log": "log",
    "exp": "exp",
    "sqrt": "√",
    # SymPy class names: the parser used to normalize these via
    # FUNCTION_MAP (``Abs`` → ``abs``), but since FUNCTION_MAP was
    "abs": "|·|",
    "factorial": "(·)!",
    "choose": "(⋮)",
    "implies": "⟹",
    "iff": "⟺",
    "and": ",",
    "branch": "⇒",
    "congruent": "≡",
    "divides": "∣",
    "asymptotic": "∼",
    "intersection": "∩",
    "union": "∪",
    "set_difference": "∖",
    "conjunction": "∧",
    "disjunction": "∨",
    "forall": "∀(·)",
    "exists": "∃(·)",
}

OPERATOR_LATEX: dict[str, str] = {
    "add": "+",
    "subtract": "-",
    "multiply": r"\times",
    "divide": r"\div",
    "negation": "-",
    "neg": r"\lnot(\cdot)",
    "power": r"(\cdot)^{\cdot}",
    "equals": "=",
    "greater_than": ">",
    "less_than": "<",
    "greater_equal": r"\geq",
    "less_equal": r"\leq",
    "derivative": r"\frac{d}{d\cdot}",
    "partial_derivative": r"\frac{\partial}{\partial\cdot}",
    "integral": r"\int", "closed_integral": r"\oint",
    "sum": r"\sum",
    "product": r"\prod",
    "limit": r"\lim",
    "tends_to": r"\to",
    "sin": r"\sin",
    "cos": r"\cos",
    "tan": r"\tan",
    "log": r"\log",
    "exp": r"\exp",
    "sqrt": r"\sqrt{\cdot}",
    "abs": r"|\cdot|",
    "factorial": r"(\cdot)!",
    "choose": r"\binom{\cdot}{\cdot}",
    "implies": r"\Rightarrow",
    "iff": r"\Leftrightarrow",
    "and": ",",
    "intersection": r"\cap",
    "union": r"\cup",
    "set_difference": r"\setminus",
    "conjunction": r"\land",
    "disjunction": r"\lor",
    "forall": r"\forall(\cdot)",
    "exists": r"\exists(\cdot)",
    "branch": r"\Rightarrow",
    "congruent": r"\equiv",
    "divides": r"\mid",
    "asymptotic": r"\sim",
}

# Op-specific shape defaults. The graph schema is semantic-only
# (``additionalProperties: false`` at the node level), so authors can't
# pin a shape on a node directly. Instead, the renderer gives certain
# operators a characteristic shape so the visual reads at a glance —
# e.g. unary ``negation`` as a flipped triangle. Themes can still override
# the type-level default via ``nodeStyles.operator.shape``; entries here
# only apply when the theme hasn't set one.
OP_DEFAULT_SHAPES: dict[str, str] = {
    "negation": "inv_triangle",
}


# Stroke-width guardrails for ``edge.weight``-driven scaling. Weight
# multiplies the theme's semantic-level base stroke width; without
# clamps, an ``x^100`` edge would render as a 400-pixel slab. The floor
# keeps edges visible even for ``weight=0`` (shouldn't happen in
# practice, but defensive); the ceiling lets ``x²``/``x³`` feel
# noticeably stronger than ``x`` without letting outliers dominate the
# canvas.
MIN_EDGE_WIDTH_PX = 1.0
MAX_EDGE_WIDTH_PX = 8.0
DEFAULT_WEIGHT_BASE_PX = 2.0  # when the theme doesn't define a
                              # semantic-level strokeWidth

# Relation ops whose incoming edges aren't a computation but a logical
# connection between two sub-equations. We want these rendered with a
# dotted arrow so the viewer can instantly see "(LHS) ⟹ (RHS)" rather
# than confusing it for yet another operand flowing into an operator.
_LOGICAL_CONNECTIVE_OPS = frozenset({"implies", "iff"})

# Canonical glyph for each relation ``op`` the parser emits (see
# ``scripts/latex_to_graph.RELATION_MAP``). Used by ``_format_label`` so
# the renderer always shows a clean math glyph for known connectives even
# when the enricher has overwritten ``emoji`` with something inappropriate
# (e.g. Gemini occasionally returns ``➡️`` U+27A1 + U+FE0F for ``implies``,
# which KaTeX parses as ``➡`` text + a phantom ``\R`` accent and renders
# as a garbled ``→ⓡ`` artifact — see issue #170).
RELATION_SYMBOLS: dict[str, str] = {
    "equals": "=",
    "not_equal": "≠",
    "greater_than": ">",
    "less_than": "<",
    "greater_equal": "≥",
    "less_equal": "≤",
    "implies": "⟹",
    "iff": "⟺",
    "proportional": "∝",
    "approximately": "≈",
    "maps_to": "→",
    "element_of": "∈",
    "not_element_of": "∉",
    "congruent": "≡",
    "divides": "∣",
    "asymptotic": "∼",
}


def _resolve_edge_width(
    semantic: str | None,
    weight: float | None,
    edge_styles: dict[str, Any],
) -> float | None:
    """Compute the final stroke width for an edge.

    Returns ``None`` when neither a theme style nor a weight applies
    (the renderer then omits the width from the emitted ``linkStyle``
    directive, keeping Mermaid's default). When ``weight`` is set, it
    multiplies the semantic's base width (falling back to
    ``DEFAULT_WEIGHT_BASE_PX``) and the result is clamped to
    ``[MIN_EDGE_WIDTH_PX, MAX_EDGE_WIDTH_PX]``.
    """
    es = edge_styles.get(semantic, {}) if semantic else {}
    base = es.get("strokeWidth")
    if weight is None:
        return float(base) if base is not None else None
    base_px = float(base) if base is not None else DEFAULT_WEIGHT_BASE_PX
    raw = base_px * float(weight)
    return max(MIN_EDGE_WIDTH_PX, min(MAX_EDGE_WIDTH_PX, raw))

ROLE_COLORS: dict[str, dict[str, str]] = {
    "state_variable": {"fill": "#e3f2fd", "stroke": "#1e88e5", "color": "#0d47a1"},
    "parameter":      {"fill": "#e8f5e9", "stroke": "#43a047", "color": "#1b5e20"},
    "constant":       {"fill": "#fce4ec", "stroke": "#e53935", "color": "#b71c1c"},
    "coefficient":    {"fill": "#fff3e0", "stroke": "#fb8c00", "color": "#e65100"},
    "index":          {"fill": "#f3e5f5", "stroke": "#8e24aa", "color": "#4a148c"},
    "dependent":      {"fill": "#e1f5fe", "stroke": "#039be5", "color": "#01579b"},
    "independent":    {"fill": "#f1f8e9", "stroke": "#7cb342", "color": "#33691e"},
    "observable":     {"fill": "#fff8e1", "stroke": "#fdd835", "color": "#f57f17"},
    "field":          {"fill": "#ede7f6", "stroke": "#5e35b1", "color": "#311b92"},
}


# ---------------------------------------------------------------------------
# Style loading
# ---------------------------------------------------------------------------

def validate_graph(graph: dict[str, Any]) -> list[str]:
    """Validate a semantic graph against the schema. Returns a list of error messages."""
    try:
        import jsonschema
    except ImportError:
        return ["jsonschema not installed — pip install jsonschema"]
    if not SCHEMA_PATH.exists():
        return [f"Schema not found: {SCHEMA_PATH}"]
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        schema = json.load(f)
    errors = []
    for error in jsonschema.Draft202012Validator(schema).iter_errors(graph):
        location = " > ".join(str(p) for p in error.absolute_path) or "(root)"
        errors.append(f"[{location}] {error.message}")
    return errors


def load_theme(name: str, theme_dir: Path | None = None) -> dict[str, Any]:
    """Load a theme JSON file by name from the semantic-graph theme directory."""
    d = theme_dir or THEME_DIR
    path = (d / f"{name}.json").resolve()
    if not path.is_relative_to(d.resolve()):
        raise FileNotFoundError(f"Theme {name!r} not found in {d}.")
    if not path.exists():
        available = sorted(p.stem for p in d.glob("*.json"))
        raise FileNotFoundError(
            f"Theme {name!r} not found in {d}. "
            f"Available: {', '.join(available)}"
        )
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def list_themes(theme_dir: Path | None = None) -> list[str]:
    """Return names of all available themes."""
    d = theme_dir or THEME_DIR
    return sorted(p.stem for p in d.glob("*.json"))


# ---------------------------------------------------------------------------
# Label formatting
# ---------------------------------------------------------------------------

SHOW_FIELDS = {"emoji", "unit", "role", "quantity", "dimension", "label", "description"}


def _bound_value(ref: str, nodes_by_id: dict | None) -> str:
    """Resolve a bound reference to its display value.

    Integral/sum bounds are stored as the bound NODE's id (e.g. ``__num_2``).
    With a node map, resolve it to that node's value so labels read ∫_0^1 not
    ∫_{__num_2}. Without a map (or an unknown ref — e.g. a literal like ``a``),
    return it unchanged.
    """
    if ref and nodes_by_id and ref in nodes_by_id:
        b = nodes_by_id[ref]
        return b.get("latex") or b.get("label") or b.get("subexpr") or ref
    return ref


def _format_label(
    node: dict[str, str],
    label_mode: str,
    show: set[str] | None = None,
    arity: int = 0,
    has_condition: bool = False,
    has_assertion: bool = False,
    nodes_by_id: dict | None = None,
) -> str:
    """Format a node label based on the label mode and visible fields.

    When *show* is ``None``, falls back to the legacy ``label_mode`` behaviour.
    When *show* is a set, only the listed fields appear on the node.
    """
    node_type = node.get("type", "")
    op = node.get("op", "")

    # Operator / function / expression labels: emit single-``$`` so the
    # client-side post-Mermaid walker renders them with KaTeX's HTML output
    # (TeX-quality typography). Double-``$$`` is intercepted by Mermaid's own
    # KaTeX integration, which only produces MathML — browser-native math
    # layout has tight accent placement (e.g. the hat in ``\hat{H}`` sits
    # right on top of the base) and no stretchy primes, so we avoid it.
    if node_type in ("operator", "function", "expression"):
        exponent = node.get("exponent", "")
        if op == "power" and exponent:
            if str(exponent) == "-1":
                return r"$\dfrac{1}{(\cdot)}$"
            return f"${{(\\cdot)}}^{{{exponent}}}$"
        # Derivative / integral: show the actual variable from with_respect_to
        wrt = node.get("with_respect_to", "")
        if op in ("derivative", "partial_derivative") and wrt:
            d = r"\partial" if op == "partial_derivative" else "d"
            order = ""
            subexpr = node.get("subexpr", "")
            if subexpr:
                m = re.search(r"\\partial\^{?(\d+)}?" if d == r"\partial"
                              else r"(?<!\\)d\^{?(\d+)}?", subexpr)
                if m and int(m.group(1)) > 1:
                    order = f"^{{{m.group(1)}}}"
            return f"$\\dfrac{{{d}{order}}}{{{d} {wrt}{order}}}$"
        if op in ("integral", "closed_integral") and wrt:
            int_cmd = OPERATOR_LATEX.get(op, r"\int")
            # bounds are stored as node ids (e.g. __num_2) — resolve to values
            lb = _bound_value(node.get("lower_bound", ""), nodes_by_id)
            ub = _bound_value(node.get("upper_bound", ""), nodes_by_id)
            if lb and ub:
                return f"${int_cmd}_{{{lb}}}^{{{ub}}} d{wrt}$"
            return f"${int_cmd} d{wrt}$"
        if op in ("sum", "product") and wrt:
            agg_cmd = OPERATOR_LATEX.get(op, r"\sum")
            return f"${agg_cmd}_{{{wrt}}}$"
        if node_type == "function" and op:
            fn_name = OPERATOR_LATEX.get(op, node.get("latex") or op)
            effective_arity = arity
            # Natural-log special case: when subexpr uses \ln, display
            # as ln(·) and drop the implicit base-e argument.
            subexpr = node.get("subexpr", "")
            if op == "log" and r"\ln" in subexpr:
                fn_name = r"\ln"
                effective_arity = max(arity - 1, 1)  # drop the e child
            if r"\cdot" in fn_name:
                return f"${fn_name}$"
            # Conditional probability: P(·|·) instead of P(·, ·)
            # Assertion: P(…) — the assertion is an arbitrary predicate
            # (X=k, X≥a, |X−μ|≥kσ, …) so we show ellipsis rather than
            # trying to decompose it.
            if has_condition and effective_arity >= 2:
                regular_dots = r", ".join([r"\cdot"] * (effective_arity - 1))
                dots = regular_dots + r"\mid " + r"\cdot"
            elif has_assertion:
                dots = r"\ldots"
            else:
                dots = r", ".join([r"\cdot"] * max(effective_arity, 1))
            return f"${fn_name}({dots})$"
        node_latex = node.get("latex")
        if node_latex:
            symbol = node_latex
        else:
            symbol = OPERATOR_LATEX.get(op, OPERATOR_SYMBOLS.get(op, op))
        return f"${symbol}$"

    if node_type == "relation":
        # Render the relation glyph as plain Unicode text — NOT wrapped in
        # ``$...$``. These are arrow/relation glyphs (``⟹``, ``⟺``, ``∝``…)
        # that Mermaid's HTML labels render directly with the page font.
        # Routing them through KaTeX is fragile: KaTeX produces poor output
        # for emoji-style codepoints (e.g. ``➡️`` U+27A1 + U+FE0F renders as
        # ``➡`` with a phantom ``\R`` accent), and the enricher occasionally
        # rewrites ``emoji`` to such a codepoint. Prefer the canonical glyph
        # for the known ``op`` so the visual stays stable regardless.
        #
        # Exception: bare ``>`` / ``<`` are interpreted by Mermaid as markdown
        # blockquote and HTML tag openers.  For those ops, use the LaTeX path
        # (wrapped in ``$...$``) which is safe from Mermaid's parser.
        sym = RELATION_SYMBOLS.get(op)
        if sym:
            if sym in ("<", ">"):
                latex_sym = OPERATOR_LATEX.get(op, sym)
                return f"${latex_sym}$"
            return sym
        rel_emoji = node.get("emoji", "")
        if rel_emoji:
            return rel_emoji
        return node.get("label", op)

    # --- Symbol / number nodes ---
    # ``node.id`` is a machine identifier, never a display symbol — it may
    # be an internal placeholder (``__num_5``), a chain-merge variant
    # (``s1___num_5``), or a sanitized multi-char name. Every displayable
    # node is expected to carry ``latex`` or ``subexpr``; ``label`` is a
    # last-resort fallback for hand-authored nodes.
    emoji = node.get("emoji", "")
    symbol_latex = node.get("latex") or node.get("subexpr") or node.get("label", "?")

    # Render the symbol as inline LaTeX. We use single-``$`` delimiters here
    # because Mermaid's own KaTeX integration (``$$...$$``) swallows the
    # surrounding ``<br/>`` separators and collapses multi-line labels. The
    # client instead runs a post-Mermaid pass via ``window.katex`` to rewrite
    # every ``$...$`` span in the rendered SVG — see ``graph-view.js``.
    display_name = f"${symbol_latex}$"

    # Used below to suppress a description/label line that merely repeats
    # the head glyph (common for number nodes where label == latex == "-1").
    head_texts = {symbol_latex}

    if show is not None:
        # Multi-line label layout. We build the visible lines here (head +
        # optional description + optional metadata) and join them with
        # ``<br/>`` below — see the comment at the ``return`` for why that
        # form works given our Mermaid init settings.
        lines: list[str] = []

        head_parts: list[str] = []
        if "emoji" in show and emoji:
            head_parts.append(emoji)
        head_parts.append(display_name)
        lines.append(" ".join(head_parts))

        desc_text = None
        if "description" in show and node.get("description"):
            desc_text = node["description"]
        elif "label" in show and node.get("label") and node["label"] != symbol_latex:
            desc_text = node["label"]
        # Suppress duplicates when the description/label merely repeats the
        # head symbol (common for number nodes like ``-1`` where label and
        # latex are identical).
        if desc_text and desc_text in head_texts:
            desc_text = None
        if desc_text:
            lines.append(desc_text)

        meta: list[str] = []
        if "unit" in show and node.get("unit"):
            meta.append(node["unit"])
        if "role" in show and node.get("role"):
            meta.append(node["role"])
        if "quantity" in show and node.get("quantity"):
            meta.append(node["quantity"])
        if "dimension" in show and node.get("dimension"):
            meta.append(node["dimension"])
        if meta:
            lines.append(", ".join(meta))

        if len(lines) <= 1:
            return lines[0] if lines else display_name
        # Mermaid flowcharts with ``htmlLabels: true`` render ``<br/>`` as a
        # real line break inside node labels. The graph-view.js init already
        # sets that flag; we just emit the separator.
        return "<br/>".join(lines)

    # Legacy label_mode fallback
    if label_mode == "emoji":
        if emoji:
            return f"{emoji} {display_name}"
        return display_name
    return display_name


# ---------------------------------------------------------------------------
# Mermaid generation
# ---------------------------------------------------------------------------

def _sanitize_id(node_id: str) -> str:
    """Make a node ID safe for Mermaid (no special chars or numeric start)."""
    out = str(node_id)
    for ch in "-. {}()*":
        out = out.replace(ch, "_")
    if not out or not re.match(r"^[A-Za-z_]", out):
        out = f"n_{out}"
    return out


# Inline (``$...$``) and display (``$$...$$``) math spans. The client-side
# post-Mermaid pass routes these through KaTeX, which needs the raw ``+``/
# ``-`` characters untouched — escaping them to ``#43;``/``#45;`` breaks the
# LaTeX. Outside these spans, Mermaid 11 parses bare ``+``/``-`` as markdown
# list/heading starters and mangles the label, so we do escape them there.
#
# Node labels nowadays emit single-``$`` inline math (see ``_format_label``);
# double-``$$`` is kept supported for any hand-authored labels that still use
# it. Both forms assume no interior ``$`` (``[^$]*``), which matches normal
# LaTeX usage.
_MATH_SPAN_RE = re.compile(r"\$\$[^$]*\$\$|\$[^$]*\$")


def _escape_mermaid_label(label: str) -> str:
    """Escape ``+``/``-`` for Mermaid, preserving them inside LaTeX spans."""
    out: list[str] = []
    last = 0
    for m in _MATH_SPAN_RE.finditer(label):
        # Plain text between spans — escape so Mermaid doesn't treat the
        # characters as markdown.
        segment = label[last:m.start()]
        out.append(segment.replace("+", "#43;").replace("-", "#45;"))
        # Math span — keep verbatim so KaTeX sees the original source.
        out.append(m.group(0))
        last = m.end()
    tail = label[last:]
    out.append(tail.replace("+", "#43;").replace("-", "#45;"))
    return "".join(out)


def _wrap_shape(sanitized_id: str, label: str, shape: str) -> str:
    r"""Wrap a label in Mermaid shape delimiters.

    Markdown strings (``\`...\```) are passed through with real newlines
    preserved. Plain strings get the normal +/- escape pipeline. Shapes
    from the Mermaid 11 extended library (triangles, trapezoids, …) use
    the typed-shape attribute form ``nid@{ shape: <kind>, label: "…" }``.
    """
    # Mermaid 11 typed-shape path (triangles, trapezoids, framed shapes).
    if shape in TYPED_SHAPES:
        mshape = TYPED_SHAPES[shape]
        escaped = label.replace('"', "'")
        if not (escaped.startswith("`") and escaped.endswith("`")):
            escaped = _escape_mermaid_label(escaped)
        return f'{sanitized_id}@{{ shape: "{mshape}", label: "{escaped}" }}'

    left, right = SHAPE_WRAPPERS.get(shape, ("[", "]"))
    if label.startswith("`") and label.endswith("`"):
        # Mermaid markdown-string form: F["`line 1\nline 2`"]. Just swap any
        # inner double-quotes so they don't terminate our wrapping `"..."`.
        escaped = label.replace('"', "'")
        return f'{sanitized_id}{left}"{escaped}"{right}'
    escaped = label.replace('"', "'")
    escaped = _escape_mermaid_label(escaped)
    return f'{sanitized_id}{left}"{escaped}"{right}'


def semantic_graph_to_mermaid(
    graph: dict[str, Any],
    theme: dict[str, Any] | None = None,
    label_mode: str | None = None,
    show: set[str] | None = None,
    color_by: str | None = None,
) -> str:
    """Convert a semantic graph dict to a Mermaid flowchart string.

    Parameters
    ----------
    graph : dict
        Semantic graph with ``nodes`` and ``edges``.
    theme : dict, optional
        Semantic-graph theme (from ``themes/semantic-graph/``). Falls back
        to the ``default`` theme when unset.
    label_mode : str, optional
        Override the theme's ``labelMode`` (``emoji``, ``latex``, ``plain``).
    show : set of str, optional
        Fields to display on nodes (``emoji``, ``unit``, ``role``,
        ``quantity``, ``dimension``, ``label``). When set, overrides
        ``label_mode`` for symbol nodes.
    color_by : str, optional
        Node property to use for classDef grouping. Default ``"type"``.
        Set to ``"role"`` to color nodes by their semantic role.
    """
    if theme is None:
        theme = load_theme("default-light")

    direction = theme.get("direction", "LR")
    lm = label_mode or theme.get("labelMode", "emoji")
    node_styles = theme.get("nodeStyles", {})
    # Optional per-variant overrides for operator/function/expression nodes
    # (e.g. ``direct`` vs ``inverse`` vs ``neutral``). Themes that define
    # ``operatorVariants`` let authors tag individual operator nodes with
    # ``"variant": "<name>"`` and get variant-specific fill/stroke/font
    # styling layered on top of the type-level shape. See
    # ``themes/semantic-graph/power-direction-*.json`` for the canonical
    # example.
    operator_variants = theme.get("operatorVariants", {})
    edge_style = theme.get("edgeStyle", {})
    edge_styles = theme.get("edgeStyles", {})
    paint_by_semantic = theme.get("paintBySemantic", False)
    global_font_size = theme.get("fontSize")

    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    lines: list[str] = [f"flowchart {direction}"]
    link_style_lines: list[str] = []

    color_prop = color_by or "type"

    # classDef — one per grouping key instead of per-node style directives
    emitted_classes: set[str] = set()

    if color_prop == "role":
        role_colors = theme.get("roleStyles", ROLE_COLORS)
        for role_name, rc in role_colors.items():
            parts = []
            if rc.get("fill"):
                parts.append(f"fill:{rc['fill']}")
            if rc.get("stroke"):
                parts.append(f"stroke:{rc['stroke']}")
            if rc.get("color"):
                parts.append(f"color:{rc['color']}")
            if parts:
                lines.append(f"  classDef {role_name} {','.join(parts)}")
                emitted_classes.add(role_name)

    for ntype, ns in node_styles.items():
        effective = dict(ns)
        if global_font_size and "fontSize" not in effective:
            effective["fontSize"] = global_font_size
        parts = []
        if effective.get("fill"):
            parts.append(f"fill:{effective['fill']}")
        if effective.get("stroke"):
            parts.append(f"stroke:{effective['stroke']}")
        if effective.get("color"):
            parts.append(f"color:{effective['color']}")
        sw = effective.get("strokeWidth")
        if sw:
            parts.append(f"stroke-width:{sw}px")
        fs = effective.get("fontSize")
        if fs:
            parts.append(f"font-size:{fs}px")
        if parts:
            lines.append(f"  classDef {ntype} {','.join(parts)}")
            emitted_classes.add(ntype)

    # Variant classDefs. Prefixed with ``opv_`` so they can't collide with a
    # user-defined node type or role that happens to share the variant name.
    for variant_name, vs in operator_variants.items():
        effective = dict(vs)
        if global_font_size and "fontSize" not in effective:
            effective["fontSize"] = global_font_size
        parts = []
        if effective.get("fill"):
            parts.append(f"fill:{effective['fill']}")
        if effective.get("stroke"):
            parts.append(f"stroke:{effective['stroke']}")
        if effective.get("color"):
            parts.append(f"color:{effective['color']}")
        sw = effective.get("strokeWidth")
        if sw:
            parts.append(f"stroke-width:{sw}px")
        fs = effective.get("fontSize")
        if fs:
            parts.append(f"font-size:{fs}px")
        if parts:
            cls_key = f"opv_{variant_name}"
            lines.append(f"  classDef {cls_key} {','.join(parts)}")
            emitted_classes.add(cls_key)

    # Pre-compute incoming edge counts so function nodes can show arity.
    # Also track which nodes have a "condition" or "assertion" edge.
    in_degree: dict[str, int] = {}
    has_condition_edge: set[str] = set()
    has_assertion_edge: set[str] = set()
    for e in edges:
        dst = e.get("to", "")
        in_degree[dst] = in_degree.get(dst, 0) + 1
        if e.get("role") == "condition":
            has_condition_edge.add(dst)
        elif e.get("role") == "assertion":
            has_assertion_edge.add(dst)

    # Node definitions. Mermaid 11's typed-shape form (``@{ ... }``) doesn't
    # accept the inline ``:::className`` shortcut, so we emit those classes
    # via separate ``class nid className`` statements instead.
    typed_class_assignments: list[tuple[str, str]] = []
    _nodes_by_id = {n["id"]: n for n in nodes if "id" in n}
    for node in nodes:
        nid = _sanitize_id(node["id"])
        ntype = node.get("type", "scalar")
        ns = node_styles.get(ntype, {})
        # Shape resolution order:
        #   1. op-specific default (``OP_DEFAULT_SHAPES[op]``) —
        #      e.g. unary ``negation`` always renders as an inverted
        #      triangle, since "unary vs. binary" is a semantic
        #      distinction any theme should preserve
        #   2. theme's type-level shape (``nodeStyles.<type>.shape``)
        #   3. ``rect`` fallback
        # The node itself doesn't carry a ``shape`` field — the graph
        # schema is semantic-only.
        op_default = OP_DEFAULT_SHAPES.get(node.get("op"))
        shape = op_default or ns.get("shape") or TYPE_DEFAULT_SHAPES.get(ntype, "rect")
        label = _format_label(node, lm, show=show,
                              arity=in_degree.get(node["id"], 0),
                              has_condition=node["id"] in has_condition_edge,
                              has_assertion=node["id"] in has_assertion_edge,
                              nodes_by_id=_nodes_by_id)
        node_def = _wrap_shape(nid, label, shape)
        # ``operatorVariants`` styling only applies to operator-like nodes.
        # When a matching variant class is available, it takes precedence
        # over the type/role-based class so authors can highlight "inverse"
        # or "direct" operations without also overriding the shape.
        variant = node.get("variant")
        variant_cls = (
            f"opv_{variant}"
            if variant and ntype in ("operator", "function", "expression")
            else None
        )
        cls_name: str | None = None
        if variant_cls and variant_cls in emitted_classes:
            cls_name = variant_cls
        else:
            class_key = node.get(color_prop, ntype) if color_prop != "type" else ntype
            if class_key in emitted_classes:
                cls_name = class_key
            elif ntype in emitted_classes:
                cls_name = ntype
        is_typed = shape in TYPED_SHAPES
        if cls_name and not is_typed:
            node_def += f":::{cls_name}"
        elif cls_name and is_typed:
            typed_class_assignments.append((nid, cls_name))
        lines.append(f"  {node_def}")
    for nid, cls_name in typed_class_assignments:
        lines.append(f"  class {nid} {cls_name}")

    # Build a lookup so we can peek at the destination node's op — lets
    # us infer a sensible default semantic for hand-authored graphs that
    # didn't bother to tag every edge (e.g. demo scenes). Only applies
    # when the edge doesn't already carry a semantic — explicit tags
    # always win.
    nodes_by_id: dict[str, dict[str, Any]] = {n["id"]: n for n in nodes if "id" in n}

    # Edge definitions
    default_arrow = edge_style.get("arrow", "-->") if edge_style else "-->"
    for i, edge in enumerate(edges):
        src = _sanitize_id(edge["from"])
        dst = _sanitize_id(edge["to"])
        edge_label = edge.get("label", "")
        edge_semantic = edge.get("semantic", "")
        edge_weight = edge.get("weight")

        # Auto-infer for untagged edges. The graph already carries
        # enough shape to recover sensible semantics, so hand-authored
        # scenes don't need to re-enter every detail. Explicit edge
        # tags always win over this inference.
        #
        # Rules (chosen to put the visual emphasis where the relationship
        # is "carried", not where it originates):
        #   * Edge *out of* a ``power`` node with literal ``exponent`` —
        #     the value flowing through this edge has been raised to
        #     that exponent, so it's where the squared/cubed/inverse
        #     relationship reads. Sign picks between ``direct`` (n > 1)
        #     and ``inverse`` (n < 0); ``weight = |n|``. The incoming
        #     edge to the power node stays neutral — it's just "the
        #     base arriving" and bears no strength on its own.
        #   * Edge *into* a ``multiply`` node — each factor is linearly
        #     proportional to the product (``direct`` + unit weight).
        if not edge_semantic:
            src_node = nodes_by_id.get(edge.get("from"))
            dst_node = nodes_by_id.get(edge.get("to"))
            if src_node and src_node.get("op") == "power":
                raw_exp = src_node.get("exponent", "")
                try:
                    exp_val = float(raw_exp)
                except (TypeError, ValueError):
                    exp_val = None
                if exp_val is not None:
                    abs_exp = abs(exp_val)
                    if exp_val < 0:
                        edge_semantic = "inverse"
                    elif abs_exp > 1:
                        edge_semantic = "direct"
                    if edge_semantic and edge_weight is None and abs_exp > 0:
                        edge_weight = abs_exp
                elif isinstance(raw_exp, str) and raw_exp.lstrip().startswith("-"):
                    # Symbolic-negative exponent (``-n``, ``-(n+1)``…) —
                    # we know it's inverse, but the magnitude is unknown
                    # at render time, so default the strength to 1.
                    edge_semantic = "inverse"
                    if edge_weight is None:
                        edge_weight = 1.0
            if not edge_semantic and dst_node and dst_node.get("op") == "multiply":
                edge_semantic = "direct"
                if edge_weight is None:
                    edge_weight = 1.0

        arrow = default_arrow
        if edge_styles and edge_semantic in edge_styles:
            es = edge_styles[edge_semantic]
            arrow = es.get("arrow", arrow)

        # Edges *into* a logical-connective relation node (``⟹``, ``⟺``)
        # are inferred as the ``logical`` edge class. This is a
        # render-time classification — the rendered appearance (arrow
        # kind, stroke, dash pattern, width) lives entirely in the
        # theme's ``edgeStyles.logical`` entry, so themes that don't
        # care about it just omit the key and the edges render like any
        # other.
        dst_node = nodes_by_id.get(edge.get("to"))
        is_logical_edge = bool(
            dst_node and dst_node.get("op") in _LOGICAL_CONNECTIVE_OPS
        )
        if is_logical_edge and edge_styles and "logical" in edge_styles:
            arrow = edge_styles["logical"].get("arrow", arrow)

        edge_role = edge.get("role", "")
        display_label = edge_label or edge_role

        # Roles whose visual arrow points outward (reversed from the
        # data-model direction).  Data edges always flow inward
        # (child → parent); these roles swap src/dst at render time
        # so the arrow reads naturally — e.g. "derivative →wrt→ x".
        # ── Keep in sync with VISUAL_REVERSE_ROLES in
        #    static/graph-panel/d3-semantic-graph.js ──
        VISUAL_REVERSE_ROLES = {}
        if edge_role in VISUAL_REVERSE_ROLES:
            src, dst = dst, src

        if display_label:
            lines.append(f"  {src} {arrow}|{display_label}| {dst}")
        else:
            lines.append(f"  {src} {arrow} {dst}")

        # When the theme opts in to per-edge link styling, we paint
        # *every* edge from the theme palette — tagged edges get their
        # semantic's colors; untagged ones fall back to ``neutral`` so
        # the diagram matches what the legend advertises instead of
        # leaking Mermaid's grey default.
        if paint_by_semantic and edge_styles:
            # Logical edges paint from their own theme entry when it's
            # defined; otherwise they fall back to the semantic-based
            # palette like any other edge.
            effective_key = (
                "logical" if is_logical_edge and "logical" in edge_styles
                else (edge_semantic or "neutral")
            )
            es = edge_styles.get(effective_key, {})
            ls_parts = []
            if es.get("stroke"):
                ls_parts.append(f"stroke:{es['stroke']}")
            width_px = _resolve_edge_width(effective_key, edge_weight, edge_styles)
            if width_px is not None:
                # Mermaid accepts fractional px; format to 2dp and trim.
                ls_parts.append(f"stroke-width:{width_px:g}px")
            if es.get("strokeDasharray"):
                ls_parts.append(f"stroke-dasharray:{es['strokeDasharray']}")
            if ls_parts:
                link_style_lines.append(f"  linkStyle {i} {','.join(ls_parts)}")

    lines.extend(link_style_lines)

    if not paint_by_semantic and edge_style:
        ls_parts = []
        if edge_style.get("stroke"):
            ls_parts.append(f"stroke:{edge_style['stroke']}")
        sw = edge_style.get("strokeWidth")
        if sw:
            ls_parts.append(f"stroke-width:{sw}px")
        if ls_parts:
            lines.append(f"  linkStyle default {','.join(ls_parts)}")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert a semantic graph (JSON) to a Mermaid flowchart.",
    )
    parser.add_argument(
        "input",
        nargs="?",
        default=None,
        help="Path to semantic graph JSON file, or '-' for stdin",
    )
    parser.add_argument(
        "--theme", "-t",
        default="default-light",
        help="Theme name (loads from themes/semantic-graph/). Default: 'default-light'",
    )
    parser.add_argument(
        "--theme-file",
        default=None,
        help="Path to a custom theme JSON file (overrides --theme)",
    )
    parser.add_argument(
        "--label-mode",
        choices=["emoji", "latex", "plain"],
        default=None,
        help="Override label mode from the theme",
    )
    parser.add_argument(
        "--show",
        default=None,
        help="Comma-separated fields to show on nodes: emoji,unit,role,quantity,dimension,label",
    )
    parser.add_argument(
        "--color-by",
        default=None,
        choices=["type", "role"],
        help="Property to color nodes by (default: type)",
    )
    parser.add_argument(
        "--list-themes",
        action="store_true",
        help="List available built-in themes and exit",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="Write output to file instead of stdout",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate the input graph against the semantic-graph schema before rendering",
    )
    parser.add_argument(
        "--wrap",
        action="store_true",
        help="Wrap output in a ```mermaid code fence",
    )
    args = parser.parse_args()

    if args.list_themes:
        for name in list_themes():
            print(name)
        return

    if args.input is None:
        parser.error("the following arguments are required: input")

    # Load graph
    if args.input == "-":
        graph = json.load(sys.stdin)
    else:
        path = Path(args.input)
        if not path.exists():
            print(f"❌ File not found: {path}", file=sys.stderr)
            sys.exit(1)
        with open(path, encoding="utf-8") as f:
            graph = json.load(f)

    # Validate graph
    if args.validate:
        errors = validate_graph(graph)
        if errors:
            print("❌ Graph failed schema validation:", file=sys.stderr)
            for e in errors:
                print(f"  {e}", file=sys.stderr)
            sys.exit(1)

    # Load theme
    if args.theme_file:
        with open(args.theme_file, encoding="utf-8") as f:
            theme = json.load(f)
    else:
        try:
            theme = load_theme(args.theme)
        except FileNotFoundError as exc:
            print(f"❌ {exc}", file=sys.stderr)
            sys.exit(1)

    show = set(args.show.split(",")) if args.show else None
    result = semantic_graph_to_mermaid(
        graph, theme=theme, label_mode=args.label_mode,
        show=show, color_by=args.color_by,
    )

    if args.wrap:
        result = f"```mermaid\n{result}```\n"

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result)
        print(f"✅ Mermaid diagram written to {args.output}")
    else:
        print(result, end="")


if __name__ == "__main__":
    main()
