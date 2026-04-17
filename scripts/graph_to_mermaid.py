#!/usr/bin/env python3
"""Convert a semantic graph (JSON) into a Mermaid flowchart diagram.

Reads a semantic graph produced by ``latex_to_graph.py`` and renders it as
Mermaid syntax with configurable styling.

Usage:
    # From a JSON file
    ./run.sh scripts/graph_to_mermaid.py graph.json

    # With a named style
    ./run.sh scripts/graph_to_mermaid.py --style role-colored graph.json

    # Pipe from latex_to_graph
    ./run.sh scripts/latex_to_graph.py "F = m \\cdot a" | ./run.sh scripts/graph_to_mermaid.py -

    # LaTeX labels instead of emoji
    ./run.sh scripts/graph_to_mermaid.py --label-mode latex graph.json

    # Write output to file
    ./run.sh scripts/graph_to_mermaid.py -o diagram.md graph.json

Exit codes:
    0  Success
    1  Invalid input or missing style
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


STYLES_DIR = Path(__file__).parent / "styles"
SCHEMA_PATH = Path(__file__).parent.parent / "schemas" / "semantic-graph.schema.json"

SHAPE_WRAPPERS: dict[str, tuple[str, str]] = {
    "rect":    ("[",   "]"),
    "circle":  ("((", "))"),
    "stadium": ("([", "])"),
    "hexagon": ("{{", "}}"),
    "diamond": ("{",   "}"),
}

OPERATOR_SYMBOLS: dict[str, str] = {
    "add": "+",
    "multiply": "×",
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
    "multiply": r"\times",
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


def load_style(name: str, styles_dir: Path | None = None) -> dict[str, Any]:
    """Load a style JSON file by name from the styles directory."""
    d = styles_dir or STYLES_DIR
    path = d / f"{name}.json"
    if not path.exists():
        available = sorted(p.stem for p in d.glob("*.json"))
        raise FileNotFoundError(
            f"Style {name!r} not found in {d}. "
            f"Available: {', '.join(available)}"
        )
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def list_styles(styles_dir: Path | None = None) -> list[str]:
    """Return names of all available styles."""
    d = styles_dir or STYLES_DIR
    return sorted(p.stem for p in d.glob("*.json"))


# ---------------------------------------------------------------------------
# Label formatting
# ---------------------------------------------------------------------------

def _format_label(node: dict[str, str], label_mode: str) -> str:
    """Format a node label based on the label mode."""
    node_type = node.get("type", "")
    op = node.get("op", "")

    if node_type in ("operator", "function"):
        exponent = node.get("exponent", "")
        if op == "power" and exponent:
            return f"$${{(\\cdot)}}^{{{exponent}}}$$"
        symbol = OPERATOR_LATEX.get(op, OPERATOR_SYMBOLS.get(op, op))
        return f"$${symbol}$$"

    if node_type == "relation":
        rel_emoji = node.get("emoji", "")
        rel_label = node.get("label", op)
        if rel_emoji:
            return f"$${rel_emoji}$$"
        return rel_label

    emoji = node.get("emoji", "")
    latex = node.get("latex", "")
    node_id = node.get("id", "")
    sym = node_id if not node_id.startswith("__") else ""
    display_name = sym or node.get("label", "?")

    # Use LaTeX rendering when the symbol has a latex field that differs
    # from the plain name (e.g. \psi, \hbar), or always in latex mode
    if latex and (label_mode == "latex" or latex != display_name):
        display_name = f"$${latex}$$"

    if label_mode == "emoji":
        if emoji:
            return f"{emoji} {display_name}"
        return display_name
    # plain and latex
    return display_name


# ---------------------------------------------------------------------------
# Mermaid generation
# ---------------------------------------------------------------------------

def _sanitize_id(node_id: str) -> str:
    """Make a node ID safe for Mermaid (no special chars)."""
    return node_id.replace("-", "_").replace(".", "_").replace(" ", "_")


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
    """Wrap a label in Mermaid shape delimiters."""
    left, right = SHAPE_WRAPPERS.get(shape, ("[", "]"))
    escaped = label.replace('"', "'")
    escaped = _escape_mermaid_label(escaped)
    return f'{sanitized_id}{left}"{escaped}"{right}'


def _style_directive(sanitized_id: str, style: dict[str, Any]) -> str:
    """Build a Mermaid ``style`` directive for a node."""
    parts = []
    if style.get("fill"):
        parts.append(f"fill:{style['fill']}")
    if style.get("stroke"):
        parts.append(f"stroke:{style['stroke']}")
    if style.get("color"):
        parts.append(f"color:{style['color']}")
    sw = style.get("strokeWidth")
    if sw:
        parts.append(f"stroke-width:{sw}px")
    fs = style.get("fontSize")
    if fs:
        parts.append(f"font-size:{fs}px")
    if not parts:
        return ""
    return f"  style {sanitized_id} {','.join(parts)}"


def semantic_graph_to_mermaid(
    graph: dict[str, Any],
    style: dict[str, Any] | None = None,
    label_mode: str | None = None,
) -> str:
    """Convert a semantic graph dict to a Mermaid flowchart string.

    Parameters
    ----------
    graph : dict
        Semantic graph with ``nodes`` and ``edges``.
    style : dict, optional
        Style definition. Falls back to the ``default`` style.
    label_mode : str, optional
        Override the style's ``labelMode`` (``emoji``, ``latex``, ``plain``).
    """
    if style is None:
        style = load_style("default")

    direction = style.get("direction", "LR")
    lm = label_mode or style.get("labelMode", "emoji")
    node_styles = style.get("nodeStyles", {})
    edge_style = style.get("edgeStyle", {})
    edge_styles = style.get("edgeStyles", {})
    use_link_style = style.get("useLinkStyle", False)
    global_font_size = style.get("fontSize")

    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    lines: list[str] = [f"flowchart {direction}"]
    link_style_lines: list[str] = []

    # classDef — one per node type instead of per-node style directives
    emitted_classes: set[str] = set()
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

    # Node definitions
    tooltip_lines: list[str] = []
    for node in nodes:
        nid = _sanitize_id(node["id"])
        ntype = node.get("type", "scalar")
        ns = node_styles.get(ntype, {})
        shape = ns.get("shape", "rect")
        label = _format_label(node, lm)
        node_def = _wrap_shape(nid, label, shape)
        if ntype in emitted_classes:
            node_def += f":::{ntype}"
        lines.append(f"  {node_def}")
        # Tooltip with descriptive label + type
        desc = node.get("label", "")
        node_id = node.get("id", "")
        sym = node_id if not node_id.startswith("__") else ""
        if desc and sym and desc != sym:
            tooltip_lines.append(f'  click {nid} "#" "{desc} ({ntype})"')

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
    lines.extend(tooltip_lines)

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
        "--style", "-s",
        default="default",
        help="Style name (loads from styles/ directory). Default: 'default'",
    )
    parser.add_argument(
        "--style-file",
        default=None,
        help="Path to a custom style JSON file (overrides --style)",
    )
    parser.add_argument(
        "--label-mode",
        choices=["emoji", "latex", "plain"],
        default=None,
        help="Override label mode from the style",
    )
    parser.add_argument(
        "--list-styles",
        action="store_true",
        help="List available built-in styles and exit",
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

    if args.list_styles:
        for name in list_styles():
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

    # Load style
    if args.style_file:
        with open(args.style_file, encoding="utf-8") as f:
            style = json.load(f)
    else:
        try:
            style = load_style(args.style)
        except FileNotFoundError as exc:
            print(f"❌ {exc}", file=sys.stderr)
            sys.exit(1)

    result = semantic_graph_to_mermaid(graph, style=style, label_mode=args.label_mode)

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
