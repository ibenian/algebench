#!/usr/bin/env python3
"""Convert LOC-REPORT.md to a styled HTML page for GitHub Pages.

Reads the markdown report and wraps it in an HTML template with
client-side rendering via marked.js and Mermaid.

Usage:
    python scripts/loc_report_to_html.py LOC-REPORT.md --outdir _site
"""

from __future__ import annotations

import argparse
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
  .markdown-alert {
    border-left: 3px solid; padding: 0.5rem 1rem; margin: 0.5rem 0;
    background: #161b22; border-radius: 4px;
  }
  .markdown-alert-title { font-weight: 600; margin-bottom: 0.25rem; display: flex; align-items: center; gap: 0.4rem; }
  .markdown-alert-note  { border-color: #539bf5; }
  .markdown-alert-note .markdown-alert-title { color: #539bf5; }
  .markdown-alert-tip   { border-color: #57ab5a; }
  .markdown-alert-tip .markdown-alert-title { color: #57ab5a; }
  .markdown-alert-important { border-color: #986ee2; }
  .markdown-alert-important .markdown-alert-title { color: #986ee2; }
  .markdown-alert-warning { border-color: #c69026; }
  .markdown-alert-warning .markdown-alert-title { color: #c69026; }
  .markdown-alert-caution { border-color: #e5534b; }
  .markdown-alert-caution .markdown-alert-title { color: #e5534b; }
</style>
</head>
<body>
<div id="content"></div>

<script src="https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js"></script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: false, theme: 'dark' });

  const md = document.getElementById('raw-md').textContent;

  const alertIcons = {
    note: 'ℹ️', tip: '💡', important: '❗',
    warning: '⚠️', caution: '🛑'
  };

  const renderer = new marked.Renderer();
  const origCode = renderer.code.bind(renderer);
  renderer.code = function(code, language) {
    if (language === 'mermaid') {
      return '<div class="mermaid">' + code + '</div>';
    }
    return origCode(code, language);
  };
  const origBlockquote = renderer.blockquote.bind(renderer);
  renderer.blockquote = function(quote) {
    const m = quote.match(/^\\s*<p>\\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\][\\s\\n]*/i);
    if (m) {
      const kind = m[1].toLowerCase();
      const body = quote.replace(m[0], '<p>');
      const icon = alertIcons[kind] || '';
      return '<div class="markdown-alert markdown-alert-' + kind + '">'
        + '<p class="markdown-alert-title">' + icon + ' ' + m[1] + '</p>'
        + body + '</div>';
    }
    return origBlockquote(quote);
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
    # <script> is a raw text element — HTML entities are NOT decoded.
    # Only escape sequences that would prematurely close the tag.
    safe = md_content.replace("</script", "<\\/script")

    page = _html_template().replace("MARKDOWN_PLACEHOLDER", safe)

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
