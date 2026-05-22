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

    def test_html_escapes_special_chars(self, tmp_path: Path):
        md = tmp_path / "report.md"
        md.write_text("a < b & c > d\n")
        out = convert(md, tmp_path / "out")

        html = out.read_text()
        assert "a &lt; b &amp; c &gt; d" in html

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
