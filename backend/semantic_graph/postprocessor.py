"""Graph postprocessor — reverses preprocessing transformations after SymPy parsing."""

from __future__ import annotations

import re
from typing import Any

from backend.model.semantic_graph import SemanticGraph, SemanticGraphNode, SemanticGraphEdge

from .constants import _ORDER_TO_ACCENT
from .sympy_translator import _slug_id


def _re_sub_literal(pattern: str, replacement: str, text: str) -> str:
    """``re.sub`` that treats *replacement* as a literal string."""
    return re.sub(pattern, lambda _m, r=replacement: r, text)


class GraphPostprocessor:
    """Stateless postprocessor: each method mutates a ``SemanticGraph`` in-place."""

    # ------------------------------------------------------------------
    # Public orchestrator
    # ------------------------------------------------------------------

    def postprocess(
        self,
        graph: SemanticGraph | None,
        result: Any,
    ) -> SemanticGraph | None:
        """Run all postprocessing passes on *graph* using *result* metadata.

        *result* is a ``PreprocessResult`` (or any object with the same attrs).
        Returns ``None`` when the graph is degenerate or absent.
        """
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

    # ------------------------------------------------------------------
    # Individual passes
    # ------------------------------------------------------------------

    @staticmethod
    def reject_degenerate(graph: SemanticGraph) -> bool:
        """Return ``True`` if the graph is a single ``__expr_*`` placeholder."""
        nodes = graph.nodes
        if len(nodes) == 1 and nodes[0].id.startswith("__expr_"):
            return True
        return False

    @staticmethod
    def restore_dot_notation(
        graph: SemanticGraph,
        dotted_vars: dict[str, int],
    ) -> None:
        """Walk every node's ``subexpr`` and restore ``\\dot`` notation."""
        if not dotted_vars:
            return
        for node in graph.nodes:
            sub = node.subexpr
            if isinstance(sub, str) and "\\frac" in sub:
                node.subexpr = _restore_dot_notation_str(sub, dotted_vars)

    @staticmethod
    def restore_accents(
        graph: SemanticGraph | None,
        accent_map: dict[str, str],
    ) -> None:
        """Re-wrap stripped accents in each node's display ``latex`` field.

        Also restores ``subexpr`` on every node so compound sub-expressions
        (e.g. ``"F = m a"``) become ``"\\vec{F} = m \\vec{a}"``.
        """
        if not graph or not accent_map:
            return
        # Pass 1: symbol nodes — restore latex, type, and subexpr
        for node in graph.nodes:
            if node.type in ("operator", "relation"):
                continue
            latex = node.latex
            if not isinstance(latex, str) or not latex:
                continue
            for body, accent in accent_map.items():
                if f"\\{accent}{{{body}}}" in latex:
                    continue
                if latex == body:
                    node.latex = f"\\{accent}{{{body}}}"
                    if accent == "vec":
                        node.type = "vector"
                    if hasattr(node, "subexpr") and node.subexpr == body:
                        node.subexpr = f"\\{accent}{{{body}}}"
                    break
                if latex.startswith(body) and len(latex) > len(body):
                    tail = latex[len(body):]
                    if tail[0] in "_^":
                        node.latex = f"\\{accent}{{{body}}}{tail}"
                        if accent == "vec":
                            node.type = "vector"
                        if hasattr(node, "subexpr") and node.subexpr:
                            if node.subexpr == body:
                                node.subexpr = f"\\{accent}{{{body}}}"
                            elif node.subexpr.startswith(body) and len(node.subexpr) > len(body) and node.subexpr[len(body)] in "_^":
                                node.subexpr = f"\\{accent}{{{body}}}{node.subexpr[len(body):]}"
                        break

        # Pass 2: restore accents inside *all* nodes' subexpr strings
        # (operators, relations, etc. whose subexpr is a compound expression
        # like "F = m a" → "\vec{F} = m \vec{a}").
        # Sort by body length descending so longer matches replace first
        # (avoids partial replacements on overlapping names).
        sorted_items = sorted(accent_map.items(), key=lambda kv: -len(kv[0]))
        for node in graph.nodes:
            subexpr = getattr(node, "subexpr", None)
            if not isinstance(subexpr, str) or not subexpr:
                continue
            for body, accent in sorted_items:
                wrapped = f"\\{accent}{{{body}}}"
                if wrapped in subexpr:
                    continue  # already restored
                # Use word-boundary-aware replacement to avoid corrupting
                # LaTeX commands (e.g. body "a" must not match inside \tan).
                # Match ``body`` only when NOT preceded by a backslash or
                # letter, and NOT followed by a letter.
                pattern = re.compile(
                    r"(?<!\\)(?<![A-Za-z])" + re.escape(body) + r"(?![A-Za-z])"
                )
                if pattern.search(subexpr):
                    # Use a lambda to avoid backslash interpretation in
                    # the replacement string (e.g. \hat → \h escape error).
                    subexpr = pattern.sub(lambda _: wrapped, subexpr)
            node.subexpr = subexpr

    @staticmethod
    def restore_subscripts(graph: SemanticGraph, mapping: dict[str, str]) -> None:
        """Swap each Greek placeholder back to the original subscript body."""
        if not mapping:
            return
        items = sorted(mapping.items(), key=lambda kv: -len(kv[0]))

        def rewrite(s: str) -> str:
            if not isinstance(s, str):
                return s
            for greek_name, original in items:
                s = s.replace(f"\\{greek_name}", original)
                s = s.replace(f"{{{greek_name}}}", f"{{{original}}}")
                s = s.replace(f"_{greek_name}", f"_{original}")
            return s

        def _display_of(original: str) -> tuple[str, bool]:
            if original.startswith("\\text{") and original.endswith("}"):
                return original[len("\\text{"):-1], True
            return original, False

        _TEXT_POLLUTION_KEYS = ("emoji", "quantity", "dimension", "unit", "value", "role")

        # A node id is an internal wiring key, never a display string. When we
        # restore a collapsed subscript we put the readable form in
        # ``label`` / ``latex`` / ``subexpr`` and keep the id a clean slug —
        # otherwise ``\text{exit}`` etc. would leak back into the id.
        for node in graph.nodes:
            node_id = node.id
            if node_id in mapping:
                original = mapping[node_id]
                display, is_text = _display_of(original)
                node.id = _slug_id(display)
                node.label = display
                node.latex = original
                if is_text:
                    node.type = "text"
                    for k in _TEXT_POLLUTION_KEYS:
                        setattr(node, k, None)
                    node.role = None
                if node.subexpr is not None:
                    node.subexpr = rewrite(node.subexpr)
                continue
            if isinstance(node.id, str):
                node.id = _slug_id(rewrite(node.id))
            for field in ("label", "latex", "subexpr"):
                val = getattr(node, field, None)
                if isinstance(val, str):
                    setattr(node, field, rewrite(val))
        for edge in graph.edges:
            for attr in ("from_", "to"):
                val = getattr(edge, attr)
                if isinstance(val, str):
                    if val in mapping:
                        display, _ = _display_of(mapping[val])
                        setattr(edge, attr, _slug_id(display))
                    else:
                        setattr(edge, attr, _slug_id(rewrite(val)))

    @staticmethod
    def inject_annotations(
        graph: SemanticGraph,
        annotations: list[dict[str, str]],
    ) -> None:
        """Append parenthetical annotation nodes to the graph."""
        for i, ann in enumerate(annotations):
            node_id = f"__annotation_{i}"
            node = SemanticGraphNode(
                id=node_id,
                type=ann.get("type", "annotation"),
                label=ann.get("label"),
                latex=ann.get("latex"),
            )
            graph.nodes.append(node)


# ------------------------------------------------------------------
# String-level helpers (used by the graph-level methods above)
# ------------------------------------------------------------------

def _restore_dot_notation_str(
    latex: str,
    dotted_vars: dict[str, int],
) -> str:
    """Collapse ``\\frac{d[...]}{d t[...]} X`` back to ``\\dot{X}`` form."""
    if not isinstance(latex, str) or not dotted_vars or "\\frac" not in latex:
        return latex
    for var, order in sorted(dotted_vars.items(), key=lambda kv: -kv[1]):
        if order not in _ORDER_TO_ACCENT:
            continue
        accent = _ORDER_TO_ACCENT[order]
        escaped_var = re.escape(var)
        if order == 1:
            patterns = [
                rf"\\frac\{{d\}}\{{d\s*t\}}\s*{escaped_var}",
                rf"\\frac\{{d\s*{escaped_var}\}}\{{d\s*t\}}",
            ]
        else:
            patterns = [
                rf"\\frac\{{d\^\{{{order}\}}\}}"
                rf"\{{d\s*t\^\{{{order}\}}\}}\s*{escaped_var}"
            ]
        replacement = f"\\{accent}{{{var}}}"
        for pattern in patterns:
            latex = _re_sub_literal(pattern, replacement, latex)
    return latex
