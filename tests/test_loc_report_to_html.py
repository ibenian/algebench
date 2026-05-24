"""Tests for scripts/loc_report_to_html.py"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pathlib import Path

from scripts.loc_report_to_html import convert


class TestConvert:
    def test_produces_index_html(self, tmp_path: Path):
        md = tmp_path / "report.md"
        md.write_text("# Hello\n")
        outdir = tmp_path / "out"

        result = convert(md, outdir)

        assert result == outdir / "index.html"
        assert result.exists()

    def test_html_contains_markdown(self, tmp_path: Path):
        md = tmp_path / "report.md"
        md.write_text("# Lines of Code\n| Lang | Lines |\n")
        out = convert(md, tmp_path / "out")

        html = out.read_text()
        assert "# Lines of Code" in html
        assert "| Lang | Lines |" in html

    def test_preserves_raw_markdown_in_script(self, tmp_path: Path):
        md = tmp_path / "report.md"
        md.write_text("a < b & c > d\n")
        out = convert(md, tmp_path / "out")

        html = out.read_text()
        assert "a < b & c > d" in html

    def test_escapes_script_close_tag(self, tmp_path: Path):
        md = tmp_path / "report.md"
        md.write_text("code has </script> in it\n")
        out = convert(md, tmp_path / "out")

        html = out.read_text()
        script_start = html.index('<script id="raw-md"')
        script_body = html[script_start:html.index("</script>", script_start)]
        assert "</script" not in script_body.split("\n", 1)[1]
        assert "<\\/script" in html

    def test_escapes_script_close_tag_case_insensitive(self, tmp_path: Path):
        md = tmp_path / "report.md"
        md.write_text("code has </SCRIPT> in it\n")
        out = convert(md, tmp_path / "out")

        html = out.read_text()
        script_start = html.index('<script id="raw-md"')
        script_body = html[script_start:html.index("</script>", script_start)]
        assert "</SCRIPT" not in script_body

    def test_github_alert_css_present(self, tmp_path: Path):
        md = tmp_path / "report.md"
        md.write_text("> [!NOTE]\n> Some note\n")
        out = convert(md, tmp_path / "out")

        html = out.read_text()
        assert "markdown-alert-note" in html
        assert "markdown-alert-title" in html

    def test_mermaid_block_rendered(self, tmp_path: Path):
        md = tmp_path / "report.md"
        md.write_text("```mermaid\nxychart-beta\n```\n")
        out = convert(md, tmp_path / "out")

        html = out.read_text()
        assert "mermaid" in html

    def test_creates_output_dir(self, tmp_path: Path):
        md = tmp_path / "report.md"
        md.write_text("test\n")
        outdir = tmp_path / "nested" / "deep" / "out"

        result = convert(md, outdir)
        assert result.exists()
