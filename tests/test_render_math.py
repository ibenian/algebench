"""Tests for scripts/render_math.py"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from scripts.render_math import MathRenderer


# ---------------------------------------------------------------------------
# HTML generation
# ---------------------------------------------------------------------------

class TestMathRendererHTML:
    def test_latex_only_default(self):
        r = MathRenderer("x^2 + 1")
        html = r.render_html()
        assert "$$x^2 + 1$$" in html
        assert "katex" in html
        assert "mermaid" not in html.split("</style>")[-1].split("<script")[0]

    def test_mermaid_included_when_enabled(self):
        r = MathRenderer("F = ma", show_mermaid=True)
        html = r.render_html()
        assert "flowchart" in html
        assert "Semantic Graph" in html

    def test_both_latex_and_mermaid(self):
        r = MathRenderer("E = mc^2", show_mermaid=True)
        html = r.render_html()
        assert "$$E = mc^2$$" in html
        assert "flowchart" in html

    def test_mermaid_only(self):
        r = MathRenderer("F = ma", show_latex=False, show_mermaid=True)
        html = r.render_html()
        assert "<h2>LaTeX</h2>" not in html
        assert 'class="latex-block"' not in html
        assert "flowchart" in html

    def test_theme_applied(self):
        r = MathRenderer("x + y", show_mermaid=True, graph_theme="role-colored-light")
        html = r.render_html()
        assert "flowchart TB" in html

    def test_label_mode_latex(self):
        r = MathRenderer("F = ma", show_mermaid=True, label_mode="latex")
        html = r.render_html()
        # All labels use single-``$`` inline math — see _format_label docstring
        # in scripts/graph_to_mermaid.py for why we avoid Mermaid's built-in
        # MathML-only KaTeX path.
        assert "$F$" in html or r"$\times$" in html

    def test_label_mode_plain(self):
        r = MathRenderer("F = ma", show_mermaid=True, label_mode="plain")
        html = r.render_html()
        assert "⚖️" not in html.split("flowchart")[1]


# ---------------------------------------------------------------------------
# Color mode detection (from each theme's declared ``mode`` field)
# ---------------------------------------------------------------------------

class TestColorModeDetection:
    def test_light_mode_default(self):
        r = MathRenderer("x", graph_theme="default-light")
        assert r.color_mode == "light"

    def test_dark_mode_for_dark_themes(self):
        r = MathRenderer("x", graph_theme="minimal-dark")
        assert r.color_mode == "dark"

    def test_dark_mode_for_linalg_dark(self):
        r = MathRenderer("x", graph_theme="linalg-dark")
        assert r.color_mode == "dark"

    def test_color_mode_override(self):
        r = MathRenderer("x", graph_theme="minimal-dark", color_mode="light")
        assert r.color_mode == "light"

    def test_dark_mode_colors_in_html(self):
        r = MathRenderer("x", graph_theme="minimal-dark")
        html = r.render_html()
        assert "#0d1117" in html

    def test_light_mode_colors_in_html(self):
        r = MathRenderer("x", graph_theme="default-light")
        html = r.render_html()
        assert "#f8f9fa" in html


# ---------------------------------------------------------------------------
# File output
# ---------------------------------------------------------------------------

class TestFileOutput:
    def test_write_to_tmp(self):
        r = MathRenderer("x^2")
        path = r.write()
        assert path.exists()
        assert path.suffix == ".html"
        assert "/tmp/" in str(path)
        content = path.read_text()
        assert "$$x^2$$" in content
        path.unlink()

    def test_write_to_explicit_path(self, tmp_path):
        out = tmp_path / "test_output.html"
        r = MathRenderer("y = mx + b")
        path = r.write(out)
        assert path == out
        assert out.exists()
        assert "$$y = mx + b$$" in out.read_text()

    def test_write_mermaid_to_file(self, tmp_path):
        out = tmp_path / "mermaid.html"
        r = MathRenderer("a + b", show_mermaid=True)
        r.write(out)
        content = out.read_text()
        assert "flowchart" in content
        assert "katex" in content


# ---------------------------------------------------------------------------
# Theme dict input
# ---------------------------------------------------------------------------

class TestThemeDictInput:
    def test_custom_theme_dict(self):
        custom = {
            "name": "my-custom",
            "mode": "light",
            "direction": "RL",
            "labelMode": "plain",
            "nodeStyles": {
                "scalar": {"shape": "rect", "fill": "#fff", "stroke": "#000", "color": "#000"},
                "operator": {"shape": "circle", "fill": "#eee", "stroke": "#333", "color": "#000"},
            },
            "edgeStyle": {"stroke": "#555", "strokeWidth": 1},
        }
        r = MathRenderer("x + y", show_mermaid=True, graph_theme=custom)
        html = r.render_html()
        assert "flowchart RL" in html


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_complex_expression(self):
        r = MathRenderer(r"\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}", show_mermaid=True)
        html = r.render_html()
        assert "flowchart" in html
        assert "katex" in html

    def test_empty_body_when_nothing_enabled(self):
        r = MathRenderer("x", show_latex=False, show_mermaid=False)
        html = r.render_html()
        assert "<body>" in html

    def test_title_truncation(self):
        long = "x" * 100
        r = MathRenderer(long)
        html = r.render_html()
        assert f"<title>render_math: {'x' * 60}</title>" in html

    def test_all_themes_render(self):
        from scripts.graph_to_mermaid import list_themes
        for name in list_themes():
            r = MathRenderer("a + b", show_mermaid=True, graph_theme=name)
            html = r.render_html()
            assert "flowchart" in html
