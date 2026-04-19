#!/usr/bin/env python3
"""Render LaTeX expressions as styled HTML with optional Mermaid diagrams.

Usage:
    # LaTeX only (default)
    ./run.sh scripts/render_math.py "y = x^2 - 2x + 1"

    # LaTeX + Mermaid diagram
    ./run.sh scripts/render_math.py "F = m \\cdot a" --mermaid

    # Mermaid with a specific theme and label mode
    ./run.sh scripts/render_math.py "E = mc^2" --mermaid --graph-theme role-colored-light --label-mode latex

    # Mermaid only (no LaTeX block)
    ./run.sh scripts/render_math.py "E = mc^2" --mermaid --no-latex

    # Write to a specific file instead of /tmp
    ./run.sh scripts/render_math.py "E = mc^2" -o output.html

Exit codes:
    0  Success
    1  Parse error or invalid input
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import webbrowser
from pathlib import Path
from typing import Any

try:
    from latex_to_graph import latex_to_semantic_graph
    from graph_to_mermaid import semantic_graph_to_mermaid, load_theme, validate_graph
except ImportError:
    from scripts.latex_to_graph import latex_to_semantic_graph
    from scripts.graph_to_mermaid import semantic_graph_to_mermaid, load_theme, validate_graph

_GRAPH_PANEL_DIR = Path(__file__).resolve().parent.parent / "static" / "graph-panel"


def _read_asset(name: str) -> str:
    return (_GRAPH_PANEL_DIR / name).read_text(encoding="utf-8")


_GRAPH_PANEL_CSS = _read_asset("graph-panel.css")
_GRAPH_PANEL_JS = _read_asset("graph-panel.js").replace("export class", "class")


FRAGMENT_CSS = """\
  .render-math-container {{
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
  }}
  .render-math-container .card {{
    background: {card_bg};
    border: 1px solid {border};
    border-radius: 12px;
    padding: 2rem;
    max-width: 900px;
    width: 100%;
    box-shadow: 0 2px 8px {shadow};
  }}
  .render-math-container .card h2 {{
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: {muted};
    margin-bottom: 1rem;
  }}
  .render-math-container .latex-block {{
    font-size: 1.6rem;
    text-align: center;
    padding: 1.5rem 0;
  }}
  .render-math-container .mermaid {{
    display: flex;
    justify-content: center;
    padding: 1rem 0;
  }}
  {graph_panel_css}
  .graph-panel-tooltip {{
    background: {card_bg};
    border: 1px solid {border};
    box-shadow: 0 4px 16px {shadow};
  }}
  .graph-panel-info {{
    background: {card_bg};
    border-left: 1px solid {border};
    box-shadow: -4px 0 16px {shadow};
    color: {fg};
  }}
  .graph-panel-info h3 {{
    color: {muted};
  }}
  .graph-panel-info .gp-field {{
    border-bottom: 1px solid {border};
  }}
  .graph-panel-info .gp-close {{
    color: {muted};
  }}
"""

FRAGMENT_TEMPLATE = """\
<style>
{fragment_css}
</style>
<div class="render-math-container">
{body}
</div>
{hover_script}
"""

PAGE_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body, {{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}});"></script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.esm.min.mjs';
  mermaid.initialize({{ startOnLoad: true, theme: '{mermaid_theme}' }});
</script>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: {bg};
    color: {fg};
    padding: 2rem;
    min-height: 100vh;
  }}
  .json-toggle {{
    position: fixed;
    bottom: 1rem;
    left: 1rem;
    background: {card_bg};
    border: 1px solid {border};
    border-radius: 6px;
    color: {muted};
    font-family: monospace;
    font-size: 0.85rem;
    padding: 0.3rem 0.6rem;
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.15s;
    z-index: 800;
  }}
  .json-toggle:hover {{ opacity: 1; }}
  .json-overlay {{
    display: none;
    position: fixed;
    bottom: 3rem;
    left: 1rem;
    max-width: 500px;
    max-height: 60vh;
    overflow: auto;
    background: {card_bg};
    border: 1px solid {border};
    border-radius: 8px;
    box-shadow: 0 4px 16px {shadow};
    font-size: 0.7rem;
    line-height: 1.4;
    padding: 1rem;
    color: {fg};
    white-space: pre-wrap;
    word-break: break-word;
    z-index: 800;
  }}
  .json-overlay.open {{ display: block; }}
  .json-overlay::-webkit-scrollbar {{
    width: 6px;
  }}
  .json-overlay::-webkit-scrollbar-track {{
    background: transparent;
  }}
  .json-overlay::-webkit-scrollbar-thumb {{
    background: {border};
    border-radius: 3px;
  }}
  .json-overlay::-webkit-scrollbar-thumb:hover {{
    background: {muted};
  }}
</style>
</head>
<body>
{fragment}
{json_viewer}
</body>
</html>
"""

THEMES = {
    "light": {
        "bg": "#f8f9fa",
        "fg": "#1a1a2e",
        "card_bg": "#ffffff",
        "border": "#e2e8f0",
        "shadow": "rgba(0,0,0,0.06)",
        "muted": "#718096",
        "mermaid_theme": "default",
    },
    "dark": {
        "bg": "#0d1117",
        "fg": "#e6edf3",
        "card_bg": "#161b22",
        "border": "#30363d",
        "shadow": "rgba(0,0,0,0.3)",
        "muted": "#8b949e",
        "mermaid_theme": "dark",
    },
}

class MathRenderer:
    """Renders a LaTeX expression to a self-contained HTML file.

    Parameters
    ----------
    latex : str
        LaTeX expression (e.g. ``"F = m \\cdot a"``).
    show_latex : bool
        Include a KaTeX-rendered LaTeX block. Default ``True``.
    show_mermaid : bool
        Include a Mermaid semantic graph diagram. Default ``False``.
    graph_theme : str or dict
        Semantic-graph theme name or theme dict. Default ``"default-light"``.
    label_mode : str
        Mermaid label mode: ``"emoji"``, ``"latex"``, ``"plain"``.
    color_mode : str or None
        Force ``"light"`` or ``"dark"`` page chrome. Defaults to the theme's
        declared ``mode`` field.
    """

    def __init__(
        self,
        latex: str = "",
        *,
        graph: dict[str, Any] | None = None,
        show_latex: bool = True,
        show_mermaid: bool = False,
        graph_theme: str | dict[str, Any] = "default-light",
        label_mode: str | None = None,
        color_mode: str | None = None,
        validate: bool = False,
        show: set[str] | None = None,
        color_by: str | None = None,
    ) -> None:
        self.latex = latex
        self._graph = graph
        self.show_latex = show_latex and not graph
        self.show_mermaid = show_mermaid or bool(graph)
        self.label_mode = label_mode
        self.validate = validate
        self.show = show
        self.color_by = color_by

        if isinstance(graph_theme, str):
            self.graph_theme_name = graph_theme
            self.graph_theme = load_theme(graph_theme)
        else:
            self.graph_theme_name = graph_theme.get("name", "custom")
            self.graph_theme = graph_theme

        self.color_mode = color_mode or self.graph_theme.get("mode", "light")

    def _build_latex_card(self) -> str:
        return (
            '<div class="card">\n'
            "  <h2>LaTeX</h2>\n"
            f'  <div class="latex-block">$${self.latex}$$</div>\n'
            "</div>"
        )

    def _build_mermaid_card(self) -> tuple[str, dict]:
        graph = self._graph if self._graph else latex_to_semantic_graph(self.latex)
        if self.validate:
            errors = validate_graph(graph)
            if errors:
                raise ValueError(
                    "Graph failed schema validation:\n"
                    + "\n".join(f"  {e}" for e in errors)
                )
        mermaid_src = semantic_graph_to_mermaid(
            graph, theme=self.graph_theme, label_mode=self.label_mode,
            show=self.show, color_by=self.color_by,
        )
        card = (
            '<div class="card">\n'
            "  <h2>Semantic Graph</h2>\n"
            f'  <pre class="mermaid">\n{mermaid_src}  </pre>\n'
            "</div>"
        )
        return card, graph

    @staticmethod
    def _build_hover_script(graph: dict) -> str:
        if not graph.get("nodes"):
            return ""
        graph_panel_js = _GRAPH_PANEL_JS
        graph_json = json.dumps(graph).replace("</", "<\\/")
        return (
            f'<script type="application/json" id="semantic-graph-data">'
            f'{graph_json}</script>\n'
            f'<script type="module">\n'
            f'{graph_panel_js}\n'
            f'const graph = JSON.parse('
            f'document.getElementById("semantic-graph-data").textContent);\n'
            f'function waitForSvg(cb, tries) {{\n'
            f'  const svg = document.querySelector(".render-math-container svg");\n'
            f'  if (svg) {{ cb(svg); return; }}\n'
            f'  if (tries > 0) setTimeout(() => waitForSvg(cb, tries - 1), 500);\n'
            f'}}\n'
            f'waitForSvg((svg) => {{\n'
            f'  const gp = new SemanticGraphPanel(graph, '
            f'{{ container: svg.parentElement, katex }});\n'
            f'  gp.attach();\n'
            f'}}, 20);\n'
            f'</script>\n'
        )

    def render_fragment(self) -> str:
        """Return an embeddable HTML fragment (style + cards + script).

        The fragment is self-contained except for external dependencies
        (KaTeX, Mermaid) which the host page must provide.
        """
        parts: list[str] = []
        graph: dict | None = None
        if self.show_latex:
            parts.append(self._build_latex_card())
        if self.show_mermaid:
            card, graph = self._build_mermaid_card()
            parts.append(card)

        self._last_graph = graph
        hover_script = self._build_hover_script(graph) if graph else ""
        colors = THEMES[self.color_mode]

        fragment_css = FRAGMENT_CSS.format(
            graph_panel_css=_GRAPH_PANEL_CSS,
            **colors,
        )
        return FRAGMENT_TEMPLATE.format(
            fragment_css=fragment_css,
            body="\n".join(parts),
            hover_script=hover_script,
        )

    def render_html(self) -> str:
        """Return a complete standalone HTML page."""
        colors = THEMES[self.color_mode]
        fragment = self.render_fragment()
        json_viewer = ""
        if self._last_graph:
            graph_json = json.dumps(self._last_graph, indent=2, ensure_ascii=False)
            json_viewer = (
                '<button class="json-toggle" onclick="'
                "document.querySelector('.json-overlay').classList.toggle('open')"
                '" title="Show semantic graph JSON">&lbrace; &rbrace;</button>\n'
                f'<pre class="json-overlay">{graph_json}</pre>\n'
            )
        return PAGE_TEMPLATE.format(
            title=f"render_math: {self.latex[:60]}",
            fragment=fragment,
            json_viewer=json_viewer,
            **colors,
        )

    def write(self, path: str | Path | None = None) -> Path:
        """Write HTML to *path* (or a temp file) and return the path."""
        html = self.render_html()
        if path:
            p = Path(path)
            p.write_text(html, encoding="utf-8")
            return p
        with tempfile.NamedTemporaryFile(
            suffix=".html", prefix="render_math_", delete=False, dir="/tmp",
        ) as f:
            f.write(html.encode("utf-8"))
            return Path(f.name)

    def open(self, path: str | Path | None = None) -> Path:
        """Write HTML and open it in the default browser."""
        p = self.write(path)
        webbrowser.open(f"file://{p}")
        return p


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render LaTeX as HTML with optional Mermaid diagram.",
    )
    parser.add_argument("latex", nargs="?", default="",
                        help="LaTeX expression to render")
    parser.add_argument(
        "--graph", "-g", default=None,
        help="Path to semantic graph JSON file (skip LaTeX parsing)",
    )
    parser.add_argument(
        "--mermaid", action="store_true",
        help="Include a Mermaid semantic-graph diagram",
    )
    parser.add_argument(
        "--no-latex", action="store_true",
        help="Omit the LaTeX rendering (use with --mermaid)",
    )
    parser.add_argument(
        "--graph-theme", "-t", default="default-light",
        help="Semantic-graph theme name (default: 'default-light')",
    )
    parser.add_argument(
        "--label-mode", choices=["emoji", "latex", "plain"], default=None,
        help="Mermaid label mode",
    )
    parser.add_argument(
        "--direction", choices=["LR", "RL", "TB", "BT"], default=None,
        help="Override Mermaid flowchart direction (default: from theme)",
    )
    parser.add_argument(
        "--color-mode", choices=["light", "dark"], default=None,
        help="Force light or dark page chrome (defaults to the theme's 'mode')",
    )
    parser.add_argument(
        "-o", "--output", default=None,
        help="Write HTML to this path instead of /tmp",
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
        "--validate", action="store_true",
        help="Validate the semantic graph against the schema before rendering",
    )
    parser.add_argument(
        "--no-open", action="store_true",
        help="Don't open the browser automatically",
    )
    args = parser.parse_args()

    graph = None
    if args.graph:
        graph_path = Path(args.graph)
        if not graph_path.exists():
            print(f"❌ File not found: {graph_path}", file=sys.stderr)
            sys.exit(1)
        with open(graph_path, encoding="utf-8") as f:
            graph = json.load(f)
    elif not args.latex:
        parser.error("either latex or --graph is required")

    show_latex = not args.no_latex
    if not show_latex and not args.mermaid and not graph:
        parser.error("--no-latex requires --mermaid")

    try:
        graph_theme: str | dict[str, Any] = args.graph_theme
        if args.direction:
            if isinstance(graph_theme, str):
                graph_theme = load_theme(graph_theme)
            graph_theme["direction"] = args.direction
        show_fields = set(args.show.split(",")) if args.show else None
        renderer = MathRenderer(
            args.latex,
            graph=graph,
            show_latex=show_latex,
            show_mermaid=args.mermaid,
            graph_theme=graph_theme,
            label_mode=args.label_mode,
            color_mode=args.color_mode,
            validate=args.validate,
            show=show_fields,
            color_by=args.color_by,
        )
    except (ValueError, FileNotFoundError) as exc:
        print(f"❌ {exc}", file=sys.stderr)
        sys.exit(1)

    if args.no_open:
        path = renderer.write(args.output)
    else:
        path = renderer.open(args.output)

    print(f"✅ {path}")


if __name__ == "__main__":
    main()
