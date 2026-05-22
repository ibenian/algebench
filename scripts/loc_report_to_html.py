#!/usr/bin/env python3
"""Convert LOC-REPORT.md to a styled HTML page for GitHub Pages.

Reads the markdown report and wraps it in an HTML template with
client-side rendering via marked.js and Mermaid.

Usage:
    python scripts/loc_report_to_html.py LOC-REPORT.md --outdir _site
"""

from __future__ import annotations

import argparse
import html
from pathlib import Path


def _html_template() -> str:
    return """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lines of Code Report — AlgeBench</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0d1117; color: #e6edf3; padding: 2rem; line-height: 1.6;
    max-width: 960px; margin: 0 auto;
  }
  h1 { font-size: 1.5rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #30363d; padding-bottom: 0.5rem; }
  h2 { font-size: 1.2rem; margin: 1.5rem 0 0.5rem; color: #8b949e; }
  p { margin: 0.5rem 0; }
  blockquote {
    border-left: 3px solid #30363d; padding: 0.5rem 1rem;
    color: #8b949e; margin: 0.5rem 0; background: #161b22; border-radius: 4px;
  }
  table {
    border-collapse: collapse; width: 100%; margin: 0.5rem 0;
    background: #161b22; border-radius: 8px; overflow: hidden;
  }
  th, td {
    border: 1px solid #30363d; padding: 0.5rem 0.75rem; text-align: left;
    font-size: 0.85rem;
  }
  th { background: #1c2128; font-weight: 600; }
  pre {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 1rem; overflow-x: auto; font-size: 0.8rem; margin: 0.5rem 0;
  }
  code { font-family: 'JetBrains Mono', 'Fira Code', monospace; }
  .mermaid { background: #161b22; border-radius: 8px; padding: 1rem; margin: 0.5rem 0; }
  a { color: #58a6ff; }
  .markdown-alert { margin: 0.5rem 0; }
</style>
</head>
<body>
<div id="content"></div>

<script src="https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js"></script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: false, theme: 'dark' });

  const md = document.getElementById('raw-md').textContent;

  const renderer = new marked.Renderer();
  const origCode = renderer.code.bind(renderer);
  renderer.code = function(obj) {
    if (obj.lang === 'mermaid') {
      return '<div class="mermaid">' + obj.text + '</div>';
    }
    return origCode(obj);
  };

  marked.setOptions({ renderer, gfm: true, breaks: false });
  document.getElementById('content').innerHTML = marked.parse(md);

  await mermaid.run();
</script>
<script id="raw-md" type="text/plain">
MARKDOWN_PLACEHOLDER
</script>
</body>
</html>
"""


def convert(md_path: Path, outdir: Path) -> Path:
    outdir.mkdir(parents=True, exist_ok=True)

    md_content = md_path.read_text(encoding="utf-8")
    escaped = html.escape(md_content, quote=False)

    page = _html_template().replace("MARKDOWN_PLACEHOLDER", escaped)

    out_file = outdir / "index.html"
    out_file.write_text(page, encoding="utf-8")
    return out_file


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert LOC report markdown to HTML")
    parser.add_argument("input", type=Path, help="Path to LOC-REPORT.md")
    parser.add_argument("--outdir", type=Path, required=True, help="Output directory")
    args = parser.parse_args()

    out = convert(args.input, args.outdir)
    print(f"✅ {out}")


if __name__ == "__main__":
    main()
