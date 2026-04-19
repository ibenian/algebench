#!/usr/bin/env python3
"""Convert a semantic graph (JSON) into a Mermaid flowchart diagram.

Reads a semantic graph produced by ``latex_to_graph.py`` and renders it as
Mermaid syntax with a configurable visual theme (loaded from
``themes/semantic-graph/``).

Usage:
    # From a JSON file
    ./run.sh scripts/graph_to_mermaid.py graph.json

    # With a named theme
    ./run.sh scripts/graph_to_mermaid.py --theme role-colored-light graph.json

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
    "diamond": ("{",   "}"),
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
    "negate": "−",
    "power": "(·)ⁿ",
    "equals": "=",
    "derivative": "d/dt",
    "integral": "∫",
    "sum": "Σ",
    "product": "∏",
    "sin": "sin",
    "cos": "cos",
    "tan": "tan",
    "log": "log",
    "exp": "exp",
    "sqrt": "√",
    "abs": "|·|",
    "arcsin": "arcsin",
    "arccos": "arccos",
    "arctan": "arctan",
}

OPERATOR_LATEX: dict[str, str] = {
    "add": "+",
    "subtract": "-",
    "multiply": r"\times",
    "divide": r"\div",
    "negate": "-",
    "power": r"(\cdot)^n",
    "equals": "=",
    "derivative": r"\frac{d}{dt}",
    "integral": r"\int",
    "sum": r"\sum",
    "product": r"\prod",
    "sin": r"\sin",
    "cos": r"\cos",
    "tan": r"\tan",
    "log": r"\log",
    "exp": r"\exp",
    "sqrt": r"\sqrt{\cdot}",
    "abs": r"|\cdot|",
}

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
    path = d / f"{name}.json"
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


def _format_label(
    node: dict[str, str],
    label_mode: str,
    show: set[str] | None = None,
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
            return f"${{(\\cdot)}}^{{{exponent}}}$"
        node_latex = node.get("latex")
        if node_latex:
            symbol = node_latex
        else:
            symbol = OPERATOR_LATEX.get(op, OPERATOR_SYMBOLS.get(op, op))
        return f"${symbol}$"

    if node_type == "relation":
        rel_emoji = node.get("emoji", "")
        rel_label = node.get("label", op)
        if rel_emoji:
            return f"${rel_emoji}$"
        return rel_label

    # --- Symbol / number nodes ---
    emoji = node.get("emoji", "")
    latex = node.get("latex", "")
    node_id = node.get("id", "")
    sym = node_id if not node_id.startswith("__") else ""
    raw_symbol = sym or node.get("label", "?")

    # Render the symbol as inline LaTeX. We use single-``$`` delimiters here
    # because Mermaid's own KaTeX integration (``$$...$$``) swallows the
    # surrounding ``<br/>`` separators and collapses multi-line labels. The
    # client instead runs a post-Mermaid pass via ``window.katex`` to rewrite
    # every ``$...$`` span in the rendered SVG — see ``graph-view.js``.
    symbol_latex = latex or raw_symbol
    display_name = f"${symbol_latex}$"

    # Treat the rendered head as "the symbol" for deduplication. For a number
    # node where ``label == latex == "-1"``, we don't want a second line
    # repeating the same glyph.
    head_texts = {raw_symbol, symbol_latex}

    if show is not None:
        # Multi-line label layout. Mermaid's normal string form doesn't honour
        # `<br/>` once KaTeX is active in the same label, so we emit the
        # backtick-delimited *markdown string* form instead — real newlines
        # inside the backticks become line breaks in the rendered node.
        lines: list[str] = []

        head_parts: list[str] = []
        if "emoji" in show and emoji:
            head_parts.append(emoji)
        head_parts.append(display_name)
        lines.append(" ".join(head_parts))

        desc_text = None
        if "description" in show and node.get("description"):
            desc_text = node["description"]
        elif "label" in show and node.get("label") and node["label"] != sym:
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
    """Make a node ID safe for Mermaid (no special chars)."""
    out = node_id
    for ch in "-. {}()*":
        out = out.replace(ch, "_")
    return out


def _escape_mermaid_label(label: str) -> str:
    """Escape characters that Mermaid 11 misinterprets as markdown.

    Only escapes +/- outside of ``$$...$$`` LaTeX blocks, since KaTeX
    needs the raw characters.
    """
    if "$$" not in label:
        return label.replace("+", "#43;").replace("-", "#45;")
    # Split on LaTeX delimiters, only escape non-LaTeX parts
    parts = label.split("$$")
    for i in range(0, len(parts), 2):  # even indices are outside $$
        parts[i] = parts[i].replace("+", "#43;").replace("-", "#45;")
    return "$$".join(parts)


def _wrap_shape(sanitized_id: str, label: str, shape: str) -> str:
    """Wrap a label in Mermaid shape delimiters.

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
    edge_style = theme.get("edgeStyle", {})
    edge_styles = theme.get("edgeStyles", {})
    use_link_style = theme.get("useLinkStyle", False)
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

    # Node definitions. Mermaid 11's typed-shape form (``@{ ... }``) doesn't
    # accept the inline ``:::className`` shortcut, so we emit those classes
    # via separate ``class nid className`` statements instead.
    typed_class_assignments: list[tuple[str, str]] = []
    for node in nodes:
        nid = _sanitize_id(node["id"])
        ntype = node.get("type", "scalar")
        ns = node_styles.get(ntype, {})
        # Node-level ``shape`` wins over the type default so specific ops
        # (e.g. ``negate`` → ``inv_triangle``) can pick their own visual.
        shape = node.get("shape") or ns.get("shape", "rect")
        label = _format_label(node, lm, show=show)
        node_def = _wrap_shape(nid, label, shape)
        class_key = node.get(color_prop, ntype) if color_prop != "type" else ntype
        cls_name: str | None = None
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

    # Edge definitions
    default_arrow = edge_style.get("arrow", "-->") if edge_style else "-->"
    for i, edge in enumerate(edges):
        src = _sanitize_id(edge["from"])
        dst = _sanitize_id(edge["to"])
        edge_label = edge.get("label", "")
        edge_semantic = edge.get("semantic", "")

        arrow = default_arrow
        if edge_styles and edge_semantic in edge_styles:
            es = edge_styles[edge_semantic]
            arrow = es.get("arrow", arrow)

        if edge_label:
            lines.append(f"  {src} {arrow}|{edge_label}| {dst}")
        else:
            lines.append(f"  {src} {arrow} {dst}")

        if use_link_style and edge_styles and edge_semantic:
            es = edge_styles.get(edge_semantic, {})
            ls_parts = []
            if es.get("stroke"):
                ls_parts.append(f"stroke:{es['stroke']}")
            sw = es.get("strokeWidth")
            if sw:
                ls_parts.append(f"stroke-width:{sw}px")
            if ls_parts:
                link_style_lines.append(f"  linkStyle {i} {','.join(ls_parts)}")

    lines.extend(link_style_lines)

    if not use_link_style and edge_style:
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
