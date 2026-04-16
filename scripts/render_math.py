#!/usr/bin/env python3
"""Render LaTeX expressions as styled HTML with optional Mermaid diagrams.

Usage:
    # LaTeX only (default)
    ./run.sh scripts/render_math.py "y = x^2 - 2x + 1"

    # LaTeX + Mermaid diagram
    ./run.sh scripts/render_math.py "F = m \\cdot a" --mermaid

    # Mermaid with a specific style and label mode
    ./run.sh scripts/render_math.py "E = mc^2" --mermaid --style role-colored --label-mode latex

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
import sys
import tempfile
import webbrowser
from pathlib import Path
from typing import Any

from latex_to_graph import latex_to_semantic_graph
from graph_to_mermaid import semantic_graph_to_mermaid, load_style


HTML_TEMPLATE = """\
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
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
    min-height: 100vh;
  }}
  .card {{
    background: {card_bg};
    border: 1px solid {border};
    border-radius: 12px;
    padding: 2rem;
    max-width: 900px;
    width: 100%;
    box-shadow: 0 2px 8px {shadow};
  }}
  .card h2 {{
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: {muted};
    margin-bottom: 1rem;
  }}
  .latex-block {{
    font-size: 1.6rem;
    text-align: center;
    padding: 1.5rem 0;
  }}
  .mermaid {{
    display: flex;
    justify-content: center;
    padding: 1rem 0;
  }}
  .meta {{
    font-size: 0.75rem;
    color: {muted};
    text-align: center;
    margin-top: 0.5rem;
  }}
</style>
</head>
<body>
{body}
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

DARK_STYLES = {"minimal-dark", "linalg-dark"}


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
    style : str or dict
        Mermaid style name or style dict. Default ``"default"``.
    label_mode : str
        Mermaid label mode: ``"emoji"``, ``"latex"``, ``"plain"``.
    theme : str or None
        Force ``"light"`` or ``"dark"``. Auto-detected from style if ``None``.
    """

    def __init__(
        self,
        latex: str,
        *,
        show_latex: bool = True,
        show_mermaid: bool = False,
        style: str | dict[str, Any] = "default",
        label_mode: str | None = None,
        theme: str | None = None,
    ) -> None:
        self.latex = latex
        self.show_latex = show_latex
        self.show_mermaid = show_mermaid
        self.label_mode = label_mode

        if isinstance(style, str):
            self.style_name = style
            self.style = load_style(style)
        else:
            self.style_name = style.get("name", "custom")
            self.style = style

        if theme:
            self.theme = theme
        else:
            self.theme = "dark" if self.style_name in DARK_STYLES else "light"

    def _build_latex_card(self) -> str:
        return (
            '<div class="card">\n'
            "  <h2>LaTeX</h2>\n"
            f'  <div class="latex-block">$${self.latex}$$</div>\n'
            "</div>"
        )

    def _build_mermaid_card(self) -> str:
        graph = latex_to_semantic_graph(self.latex)
        mermaid_src = semantic_graph_to_mermaid(
            graph, style=self.style, label_mode=self.label_mode,
        )
        meta = f'style: {self.style_name}'
        if self.label_mode:
            meta += f', labels: {self.label_mode}'
        return (
            '<div class="card">\n'
            "  <h2>Semantic Graph</h2>\n"
            f'  <pre class="mermaid">\n{mermaid_src}  </pre>\n'
            f'  <div class="meta">{meta}</div>\n'
            "</div>"
        )

    def render_html(self) -> str:
        """Return a complete HTML string."""
        parts: list[str] = []
        if self.show_latex:
            parts.append(self._build_latex_card())
        if self.show_mermaid:
            parts.append(self._build_mermaid_card())

        colors = THEMES[self.theme]
        return HTML_TEMPLATE.format(
            title=f"render_math: {self.latex[:60]}",
            body="\n".join(parts),
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
    parser.add_argument("latex", help="LaTeX expression to render")
    parser.add_argument(
        "--mermaid", action="store_true",
        help="Include a Mermaid semantic-graph diagram",
    )
    parser.add_argument(
        "--no-latex", action="store_true",
        help="Omit the LaTeX rendering (use with --mermaid)",
    )
    parser.add_argument(
        "--style", "-s", default="default",
        help="Mermaid style name (default: 'default')",
    )
    parser.add_argument(
        "--label-mode", choices=["emoji", "latex", "plain"], default=None,
        help="Mermaid label mode",
    )
    parser.add_argument(
        "--theme", choices=["light", "dark"], default=None,
        help="Force light or dark theme (auto-detected from style if omitted)",
    )
    parser.add_argument(
        "-o", "--output", default=None,
        help="Write HTML to this path instead of /tmp",
    )
    parser.add_argument(
        "--no-open", action="store_true",
        help="Don't open the browser automatically",
    )
    args = parser.parse_args()

    show_latex = not args.no_latex
    if not show_latex and not args.mermaid:
        parser.error("--no-latex requires --mermaid")

    try:
        renderer = MathRenderer(
            args.latex,
            show_latex=show_latex,
            show_mermaid=args.mermaid,
            style=args.style,
            label_mode=args.label_mode,
            theme=args.theme,
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
