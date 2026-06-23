#!/usr/bin/env python3
"""Generate visual examination reports for the semantic graph pipeline.

Renders every expression from the domain test catalogs as a row containing:
  - rendered LaTeX (KaTeX)
  - Mermaid semantic graph
  - expandable JSON panel

Supports two output modes:
  - Single file:  -o report.html  (requires internet for KaTeX/Mermaid CDN)
  - Site directory: --outdir _site  (one HTML per domain + index page)

The site mode is used by CI to deploy to GitHub Pages.

Usage:
    ./run.sh scripts/semantic_graph_report.py
    ./run.sh scripts/semantic_graph_report.py -o report.html
    ./run.sh scripts/semantic_graph_report.py --outdir _site
    ./run.sh scripts/semantic_graph_report.py --theme default-dark
"""

from __future__ import annotations

import argparse
import json
import textwrap
import traceback
from pathlib import Path
from typing import Any

# Support both direct and module invocation
try:
    from graph_to_mermaid import semantic_graph_to_mermaid, load_theme
except ImportError:
    from scripts.graph_to_mermaid import semantic_graph_to_mermaid, load_theme

from backend.semantic_graph.mathjs_converter import latex_to_mathjs
from backend.semantic_graph.service import SemanticGraphService

# The report reflects the PRODUCTION renderer — the full service pipeline
# (preprocess → chain/disjunction handling → translate → postprocess), not the
# bare translator. So e.g. `x = 2 \lor x = 3` renders as Or(Eq, Eq).
_SERVICE = SemanticGraphService()

# Report-only showcase (not a test catalog): disjunction of equations, where the
# connective is the root and each relation is a branch. Format matches the domain
# catalogs' (test_id, latex, tag, …) so the section builder picks them up.
_DISJUNCTION_SHOWCASE = [
    ("disj_two_roots", r"x = 2 \lor x = 3", None),
    ("disj_two_roots_vee", r"x = 2 \vee x = 3", None),
    ("disj_quadratic_roots",
     r"x = \frac{-b + \sqrt{b^2 - 4ac}}{2a} \lor "
     r"x = \frac{-b - \sqrt{b^2 - 4ac}}{2a}", None),
]
from tests.backend.semantic_graph.domains.test_domain_arithmetic import (
    ALL_EXPRESSIONS as ARITHMETIC_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_algebra import (
    ALL_EXPRESSIONS as ALGEBRA_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_calculus import (
    ALL_EXPRESSIONS as CALCULUS_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_ode import (
    ALL_EXPRESSIONS as ODE_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_structural import (
    ALL_EXPRESSIONS as STRUCTURAL_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_mechanics import (
    ALL_EXPRESSIONS as MECHANICS_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_em import (
    ALL_EXPRESSIONS as EM_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_thermo import (
    ALL_EXPRESSIONS as THERMO_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_waves import (
    ALL_EXPRESSIONS as WAVES_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_pde import (
    ALL_EXPRESSIONS as PDE_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_trigonometry import (
    ALL_EXPRESSIONS as TRIG_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_linalg import (
    ALL_EXPRESSIONS as LINALG_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_complex import (
    ALL_EXPRESSIONS as COMPLEX_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_logic import (
    ALL_EXPRESSIONS as LOGIC_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_number_theory import (
    ALL_EXPRESSIONS as NUMBER_THEORY_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_probability import (
    ALL_EXPRESSIONS as PROBABILITY_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_combinatorics import (
    ALL_EXPRESSIONS as COMBINATORICS_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_quantum import (
    ALL_EXPRESSIONS as QUANTUM_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_relativity import (
    ALL_EXPRESSIONS as RELATIVITY_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_fluids import (
    ALL_EXPRESSIONS as FLUIDS_EXPRESSIONS,
)
from tests.backend.semantic_graph.domains.test_domain_chemistry import (
    ALL_EXPRESSIONS as CHEMISTRY_EXPRESSIONS,
)


# ── Expression catalog ─────────────────────────────────────────────────
# Each domain contributes (section_name, [(test_id, latex), ...]).
# Expand this list as new domain test files are added.

# Report-only showcase (not a test catalog): bare integral forms, so the
# integral node structure (integrand + differential + lb/ub bounds) is easy to
# eyeball.
_INTEGRAL_SHOWCASE = [
    ("integral_indefinite", r"\int x^2 \, dx", None),
    ("integral_definite", r"\int_0^1 x^2 \, dx", None),
    ("integral_reciprocal", r"\int_a^b \frac{1}{x} \, dx", None),
    ("integral_exp_decay", r"\int_0^h e^{-z/H} \, dz", None),
]


def _collect_expressions() -> list[tuple[str, list[tuple[str, str, str | None]]]]:
    # Each section: (display name, catalog, domain hint passed to the parser).
    # The domain hint must match the one used by the domain's test suite.
    sections: list[tuple[str, list[tuple[str, str, str | None]]]] = []
    for name, catalog, domain in (
        ("Arithmetic", ARITHMETIC_EXPRESSIONS, None),
        ("Algebra", ALGEBRA_EXPRESSIONS, None),
        ("Calculus", CALCULUS_EXPRESSIONS, None),
        ("Integrals (showcase)", _INTEGRAL_SHOWCASE, None),
        ("ODE", ODE_EXPRESSIONS, None),
        ("PDE", PDE_EXPRESSIONS, None),
        ("Structural", STRUCTURAL_EXPRESSIONS, None),
        ("Mechanics", MECHANICS_EXPRESSIONS, None),
        ("Electromagnetism", EM_EXPRESSIONS, None),
        ("Thermodynamics", THERMO_EXPRESSIONS, None),
        ("Waves & Optics", WAVES_EXPRESSIONS, None),
        ("Trigonometry", TRIG_EXPRESSIONS, None),
        ("Linear Algebra", LINALG_EXPRESSIONS, None),
        ("Complex Analysis", COMPLEX_EXPRESSIONS, None),
        ("Logic & Set Theory", LOGIC_EXPRESSIONS, None),
        ("Disjunction (roots)", _DISJUNCTION_SHOWCASE, None),
        ("Number Theory", NUMBER_THEORY_EXPRESSIONS, None),
        ("Probability & Statistics", PROBABILITY_EXPRESSIONS, None),
        ("Combinatorics", COMBINATORICS_EXPRESSIONS, None),
        ("Quantum Mechanics", QUANTUM_EXPRESSIONS, "quantum_mechanics"),
        ("Relativity", RELATIVITY_EXPRESSIONS, "mechanics"),
        ("Fluid Dynamics", FLUIDS_EXPRESSIONS, "mechanics"),
        ("Chemistry", CHEMISTRY_EXPRESSIONS, "chemistry"),
    ):
        items = [
            (tid, latex, domain)
            for tid, latex, tag, *_ in catalog
            if tag is None  # skip XFAIL / SKIP entries
        ]
        sections.append((name, items))
    return sections


# ── HTML templates ─────────────────────────────────────────────────────

THEMES = {
    "light": {
        "bg": "#f8f9fa",
        "fg": "#1a1a2e",
        "card_bg": "#ffffff",
        "border": "#e2e8f0",
        "shadow": "rgba(0,0,0,0.06)",
        "muted": "#718096",
        "mermaid_theme": "default",
        "error_bg": "#fff5f5",
        "error_border": "#feb2b2",
        "error_fg": "#c53030",
    },
    "dark": {
        "bg": "#0d1117",
        "fg": "#e6edf3",
        "card_bg": "#161b22",
        "border": "#30363d",
        "shadow": "rgba(0,0,0,0.3)",
        "muted": "#8b949e",
        "mermaid_theme": "dark",
        "error_bg": "#2d1b1b",
        "error_border": "#6b2020",
        "error_fg": "#f87171",
    },
}


_PROJECT_ROOT = Path(__file__).resolve().parent.parent

_D3_MODULE_URL = (
    "https://cdn.jsdelivr.net/gh/ibenian/algebench@main"
    "/static/graph-panel/d3-semantic-graph.js"
)


def _load_d3_css() -> str:
    """Read the D3 semantic graph CSS and return it for inline embedding."""
    css_path = _PROJECT_ROOT / "static" / "graph-panel" / "d3-semantic-graph.css"
    return css_path.read_text(encoding="utf-8")


def _load_chart_css() -> str:
    """Read the chart overlay CSS and return it for inline embedding."""
    css_path = _PROJECT_ROOT / "static" / "graph-panel" / "sg-chart.css"
    return css_path.read_text(encoding="utf-8")


def _page_template() -> str:
    return textwrap.dedent("""\
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Semantic Graph Visual Report</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"
      onload="renderMathInElement(document.body, {{delimiters:[{{left:'$$',right:'$$',display:true}},{{left:'$',right:'$',display:false}}]}});"></script>
    <script src="https://cdn.jsdelivr.net/npm/mathjs@13.0.0/lib/browser/math.js"></script>
    <script type="importmap">{{
      "imports": {{
        "/labels.js": "data:text/javascript,export function makeAiAskButton(){{return document.createElement('span')}}",
        "/expr.js": "data:text/javascript,const m=math.create(math.all);m.import({{binomial:(n,k)=>m.combinations(n,k),erfc:x=>1-m.erf(x),beta:(a,b)=>m.gamma(a)*m.gamma(b)/m.gamma(a%2Bb),conjugate:x=>m.conj(x)}});export function compileExpr(s){{return m.compile(s)}}export function evalExpr(c,t,opts){{const scope=opts%26%26opts.extraScope?{{...opts.extraScope}}:{{}};return c.evaluate(scope)}}",
        "/proof-animation/dock-seq.js": "data:text/javascript,let n=0;export const nextDockSeq=()=>%2B%2Bn"
      }}
    }}</script>
    <script>
      window.__SG_REPORT_THEME__ = {theme_json};
    </script>
    <script type="module">
      import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.esm.min.mjs';
      mermaid.initialize({{ startOnLoad: false, theme: '{mermaid_theme}',
        flowchart: {{ htmlLabels: true, curve: 'basis' }} }});
      try {{ await mermaid.run(); }} catch (_) {{}}
      // KaTeX is loaded via a defer script which may not have executed yet
      // when this module runs.  Poll briefly (defer + module ordering is
      // not guaranteed across browsers).
      for (let i = 0; i < 50 && !window.katex; i++)
        await new Promise(r => setTimeout(r, 50));
      if (window.katex) {{
        const INLINE_MATH = /\\$([^$\\n]+)\\$/g;
        document.querySelectorAll(
          'foreignObject span, foreignObject div, foreignObject p, .nodeLabel'
        ).forEach((host) => {{
          if (!host.textContent || host.textContent.indexOf('$') === -1) return;
          const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
          const textNodes = [];
          while (walker.nextNode()) textNodes.push(walker.currentNode);
          textNodes.forEach((tn) => {{
            const src = tn.nodeValue;
            if (!src || src.indexOf('$') === -1) return;
            INLINE_MATH.lastIndex = 0;
            if (!INLINE_MATH.test(src)) return;
            INLINE_MATH.lastIndex = 0;
            const frag = document.createDocumentFragment();
            let last = 0, m;
            while ((m = INLINE_MATH.exec(src)) !== null) {{
              if (m.index > last)
                frag.appendChild(document.createTextNode(src.slice(last, m.index)));
              const span = document.createElement('span');
              try {{ katex.render(m[1], span, {{ throwOnError: false, displayMode: false }}); }}
              catch (_) {{ span.textContent = m[0]; }}
              frag.appendChild(span);
              last = m.index + m[0].length;
            }}
            if (last < src.length)
              frag.appendChild(document.createTextNode(src.slice(last)));
            tn.parentNode.replaceChild(frag, tn);
          }});
        }});
        document.querySelectorAll('svg g.node foreignObject').forEach((fo) => {{
          const outer = fo.firstElementChild;
          if (!outer || outer.dataset?.gvCentered === 'wrapper') return;
          const NS = 'http://www.w3.org/1999/xhtml';
          const wrapper = document.createElementNS(NS, 'div');
          wrapper.dataset.gvCentered = 'wrapper';
          Object.assign(wrapper.style, {{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '100%', height: '100%',
          }});
          fo.replaceChild(wrapper, outer);
          wrapper.appendChild(outer);
        }});
        // Resize foreignObject + parent node rect after KaTeX renders accents
        document.querySelectorAll('svg g.node foreignObject').forEach((fo) => {{
          const content = fo.querySelector('[data-gv-centered="wrapper"]') || fo.firstElementChild;
          if (!content) return;
          const bbox = content.getBoundingClientRect();
          const foRect = fo.getBoundingClientRect();
          // Only expand if content is taller/wider than current foreignObject
          const PAD = 8;
          const neededH = bbox.height + PAD;
          const neededW = bbox.width + PAD;
          const curH = parseFloat(fo.getAttribute('height')) || foRect.height;
          const curW = parseFloat(fo.getAttribute('width')) || foRect.width;
          if (neededH > curH) {{
            const dh = neededH - curH;
            fo.setAttribute('height', neededH);
            // Shift foreignObject up by half the delta to keep node centered
            const curY = parseFloat(fo.getAttribute('y')) || 0;
            fo.setAttribute('y', curY - dh / 2);
            // Also expand parent rect/polygon
            const nodeG = fo.closest('g.node');
            if (nodeG) {{
              const rect = nodeG.querySelector('rect, .basic');
              if (rect) {{
                const rh = parseFloat(rect.getAttribute('height')) || 0;
                if (rh && rh < neededH) {{
                  rect.setAttribute('height', neededH);
                  const ry = parseFloat(rect.getAttribute('y')) || 0;
                  rect.setAttribute('y', ry - dh / 2);
                }}
              }}
            }}
          }}
          if (neededW > curW) {{
            const dw = neededW - curW;
            fo.setAttribute('width', neededW);
            const curX = parseFloat(fo.getAttribute('x')) || 0;
            fo.setAttribute('x', curX - dw / 2);
            const nodeG = fo.closest('g.node');
            if (nodeG) {{
              const rect = nodeG.querySelector('rect, .basic');
              if (rect) {{
                const rw = parseFloat(rect.getAttribute('width')) || 0;
                if (rw && rw < neededW) {{
                  rect.setAttribute('width', neededW);
                  const rx = parseFloat(rect.getAttribute('x')) || 0;
                  rect.setAttribute('x', rx - dw / 2);
                }}
              }}
            }}
          }}
        }});
        // Fix KaTeX accent arrow colors: SVG paths inside foreignObject
        // default to fill:black which is invisible on dark backgrounds.
        // Use inline style (not attribute) to override any CSS rules.
        document.querySelectorAll('svg g.node foreignObject .katex svg path').forEach((p) => {{
          const textColor = window.getComputedStyle(p.closest('.katex')).color;
          p.style.fill = textColor;
        }});
      }}
    </script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      ::-webkit-scrollbar {{ width: 6px; height: 6px; }}
      ::-webkit-scrollbar-track {{ background: transparent; }}
      ::-webkit-scrollbar-thumb {{
        background: {border};
        border-radius: 3px;
      }}
      ::-webkit-scrollbar-thumb:hover {{ background: {muted}; }}
      ::-webkit-scrollbar-corner {{ background: transparent; }}
      * {{
        scrollbar-width: thin;
        scrollbar-color: {border} transparent;
      }}
      body {{
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: {bg};
        color: {fg};
        padding: 2rem;
      }}
      h1 {{
        font-size: 1.4rem;
        margin-bottom: 0.5rem;
      }}
      .report-meta {{
        font-size: 0.8rem;
        color: {muted};
        margin-bottom: 2rem;
      }}
      .section-title {{
        font-size: 1.1rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: {muted};
        margin: 2rem 0 1rem 0;
        border-bottom: 1px solid {border};
        padding-bottom: 0.5rem;
      }}
      .row {{
        display: grid;
        grid-template-columns: 1fr 2fr auto;
        gap: 1rem;
        align-items: start;
        background: {card_bg};
        border: 1px solid {border};
        border-radius: 8px;
        padding: 1rem 1.2rem;
        margin-bottom: 0.75rem;
        box-shadow: 0 1px 4px {shadow};
      }}
      .row-id {{
        font-family: monospace;
        font-size: 0.7rem;
        color: {muted};
        margin-bottom: 0.3rem;
      }}
      .row-latex {{
        font-size: 1.2rem;
        padding: 0.5rem 0;
      }}
      .row-graph {{
        min-width: 0;
        overflow-x: auto;
      }}
      .row-graph .mermaid {{
        font-size: 0.85rem;
      }}
      .row-graph .mermaid svg g.node foreignObject {{
        overflow: visible !important;
      }}
      /* KaTeX accent arrows (e.g. \vec) render as SVG paths that default
         to fill:black — invisible on dark backgrounds. Inherit text color. */
      .katex .accent-body svg path,
      .katex .overlay svg path {{
        fill: currentColor;
      }}
      .row-actions {{
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        align-self: center;
      }}
      .row-toggle,
      .row-toggle-d3 {{
        background: none;
        border: 1px solid {border};
        border-radius: 4px;
        color: {muted};
        font-family: monospace;
        font-size: 0.75rem;
        padding: 0.2rem 0.5rem;
        cursor: pointer;
        white-space: nowrap;
      }}
      .row-toggle:hover,
      .row-toggle-d3:hover {{
        color: {fg};
        border-color: {fg};
      }}
      .row-panel {{
        display: none;
        grid-column: 1 / -1;
        background: {bg};
        border: 1px solid {border};
        border-radius: 6px;
        padding: 0.8rem;
        font-family: monospace;
        font-size: 0.7rem;
        line-height: 1.4;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 400px;
        overflow: auto;
      }}
      .row-panel.open {{
        display: block;
      }}
      .row-error {{
        grid-column: 2 / 3;
        background: {error_bg};
        border: 1px solid {error_border};
        border-radius: 6px;
        padding: 0.5rem 0.8rem;
        font-family: monospace;
        font-size: 0.75rem;
        color: {error_fg};
        white-space: pre-wrap;
      }}
      .summary {{
        margin-top: 2rem;
        padding: 1rem;
        background: {card_bg};
        border: 1px solid {border};
        border-radius: 8px;
        font-size: 0.85rem;
      }}
      .summary .count {{
        font-weight: 600;
      }}
      .row-panel.row-latex-src {{
        position: relative;
      }}
      .row-copy-latex {{
        position: absolute;
        top: 0.4rem;
        right: 0.4rem;
      }}
      .row-panel.row-json {{
        display: none;
        padding: 0;
      }}
      .row-panel.row-json.open {{
        display: flex;
        gap: 1px;
      }}
      .row-json-pane {{
        flex: 1;
        min-width: 0;
        max-height: 400px;
        overflow: auto;
        padding: 0.5rem 0.8rem;
        position: relative;
      }}
      .row-json-pane pre {{
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.7rem;
        line-height: 1.4;
      }}
      .row-json-header {{
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: sticky;
        top: 0;
        background: {card_bg};
        padding: 0.2rem 0;
        z-index: 1;
        margin-bottom: 0.3rem;
      }}
      .row-json-label {{
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: {muted};
      }}
      .row-copy-btn {{
        background: none;
        border: 1px solid {border};
        border-radius: 3px;
        color: {muted};
        font-size: 0.6rem;
        padding: 1px 5px;
        cursor: pointer;
        line-height: 1.3;
      }}
      .row-copy-btn:hover {{
        color: {fg};
        border-color: {fg};
      }}
      .row-copy-btn.copied {{
        color: #66bb6a;
        border-color: #66bb6a;
      }}
      .row-toggle.active {{
        color: {fg};
        border-color: {fg};
        background: {bg};
      }}
      .row-panel.row-d3 {{
        position: relative;
        height: 400px;
        padding: 0;
        overflow: hidden;
        font-family: inherit;
        white-space: normal;
        word-break: normal;
      }}
      .row-panel.row-d3.open {{
        display: block;
      }}
      .row-d3-placeholder {{
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: {muted};
        font-size: 0.85rem;
      }}
      {d3_css}
      {chart_css}
    </style>
    </head>
    <body>
    <h1>Semantic Graph &mdash; Visual Examination Report</h1>
    <div class="report-meta">{meta}</div>
    {body}
    <script>
    document.querySelectorAll('.row-toggle').forEach(btn => {{
      btn.addEventListener('click', () => {{
        const target = btn.dataset.target;
        const panel = btn.closest('.row').querySelector('.' + target);
        if (panel) panel.classList.toggle('open');
      }});
    }});
    function copyText(text, btn) {{
      function onSuccess() {{
        btn.textContent = 'copied';
        btn.classList.add('copied');
        setTimeout(function() {{ btn.textContent = 'copy'; btn.classList.remove('copied'); }}, 1500);
      }}
      if (navigator.clipboard && navigator.clipboard.writeText) {{
        navigator.clipboard.writeText(text).then(onSuccess, function() {{ fallbackCopy(text, btn, onSuccess); }});
      }} else {{
        fallbackCopy(text, btn, onSuccess);
      }}
    }}
    function fallbackCopy(text, btn, onSuccess) {{
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {{ ok = document.execCommand('copy'); }} catch(e) {{}}
      document.body.removeChild(ta);
      if (ok) onSuccess();
    }}
    document.querySelectorAll('.row-copy-btn').forEach(btn => {{
      btn.addEventListener('click', () => {{
        const pane = btn.closest('.row-json-pane');
        var text;
        if (pane) {{
          text = pane.querySelector('pre').textContent;
        }} else {{
          text = btn.parentElement.dataset.latex || '';
        }}
        copyText(text, btn);
      }});
    }});
    </script>
    <script>
    // Patch fetchTheme to use inlined theme data
    (function() {{
      var _origFetch = window.fetch;
      window.fetch = function(url, opts) {{
        if (typeof url === 'string' && url.startsWith('/api/graph/theme/')) {{
          var theme = window.__SG_REPORT_THEME__;
          return Promise.resolve(new Response(JSON.stringify(theme), {{
            status: 200, headers: {{ 'Content-Type': 'application/json' }}
          }}));
        }}
        return _origFetch.call(this, url, opts);
      }};
    }})();

    Promise.all([
      import('{d3_module_url}'),
      import('{chart_module_url}'),
    ]).then(function(mods) {{
      var D3SemanticGraphRenderer = mods[0].D3SemanticGraphRenderer;
      var SgChartManager = mods[1].SgChartManager;
      document.querySelectorAll('.row-toggle-d3').forEach(function(btn) {{
        btn.addEventListener('click', function() {{
          var row = btn.closest('.row');
          var panel = row.querySelector('.row-d3');
          if (!panel) return;
          panel.classList.toggle('open');
          if (!panel.classList.contains('open')) return;
          if (panel.dataset.rendered) return;
          panel.dataset.rendered = '1';
          var graphJson = panel.dataset.graph;
          if (!graphJson) return;
          panel.innerHTML = '';
          try {{
            var graph = JSON.parse(graphJson);
            var chartMgr = new SgChartManager(panel, graph, {{
              katex: window.katex || null,
            }});
            var renderer = new D3SemanticGraphRenderer(panel, {{
              direction: '{d3_direction}',
              labels: 'description',
              theme: '{d3_theme}',
              katex: window.katex || null,
              onTransformChange: function(t) {{ chartMgr.setTransform(t); }},
              onChartClick: function(nodeId, nodeData, btnEl) {{
                // Always open — never toggle.  Only the × button closes.
                chartMgr.openChart(nodeId, btnEl);
              }},
            }});
            if (chartMgr.setRenderer) chartMgr.setRenderer(renderer);
            renderer.render(graph);
          }} catch (err) {{
            panel.dataset.rendered = '';
            panel.innerHTML = '<div style="padding:1em;color:#e57373">Render error: ' + err.message + '</div>';
            console.error('D3 panel render error:', err);
          }}
        }});
      }});
    }});
    </script>
    </body>
    </html>
    """)


def _precompute_chart_scripts(graph_dict: dict[str, Any]) -> None:
    """Pre-compute mathjs scripts for nodes that have ``subexpr``.

    Mutates *graph_dict* in-place, adding a ``chartScript`` key to each
    eligible node.  Errors are silently skipped — nodes without a
    ``chartScript`` will simply not offer charting in the report.
    """
    for node in graph_dict.get("nodes", []):
        subexpr = node.get("subexpr")
        if not subexpr:
            continue
        try:
            script, variables = latex_to_mathjs(subexpr)
            node["chartScript"] = {"script": script, "variables": variables}
        except Exception:
            pass  # silently skip — chart button just won't appear


def _render_row(
    test_id: str,
    latex: str,
    theme: dict[str, Any],
    domain: str | None = None,
) -> tuple[str, bool]:
    """Render a single expression row. Returns (html, success)."""
    parts: list[str] = []
    parts.append(f'<div class="row">')
    parts.append(f'  <div>')
    parts.append(f'    <div class="row-id">{test_id}</div>')
    parts.append(f'    <div class="row-latex">$${_escape_html(latex)}$$</div>')
    parts.append(f'  </div>')

    graph_json = None
    try:
        graph_obj = _SERVICE.latex_to_graph(latex, domain=domain)
        if graph_obj is None:
            raise ValueError("parser returned None")
        graph_dict = graph_obj.model_dump(by_alias=True, exclude_none=True)
        _precompute_chart_scripts(graph_dict)
        mermaid_src = semantic_graph_to_mermaid(graph_dict, theme=theme)
        graph_json = json.dumps(graph_dict, indent=2, ensure_ascii=False)

        parts.append(f'  <div class="row-graph">')
        parts.append(f'    <pre class="mermaid">{_escape_html(mermaid_src)}</pre>')
        parts.append(f'  </div>')
        success = True
    except Exception:
        tb = traceback.format_exc()
        parts.append(
            f'  <div class="row-error">{_escape_html(tb)}</div>'
        )
        success = False

    # Always render action buttons so LaTeX source is accessible even on error.
    parts.append(f'  <div class="row-actions">')
    parts.append(
        f'    <button class="row-toggle" data-target="row-latex-src" '
        f'title="Toggle LaTeX source">LaTeX</button>'
    )
    if graph_json is not None:
        parts.append(
            f'    <button class="row-toggle" data-target="row-json" '
            f'title="Toggle JSON">{{}}</button>'
        )
        parts.append(
            f'    <button class="row-toggle-d3" '
            f'title="Toggle D3 graph">D3</button>'
        )
    parts.append(f'  </div>')
    parts.append(
        f'  <div class="row-panel row-latex-src" data-latex="{_escape_attr(latex)}">'
        f'<button class="row-copy-btn row-copy-latex" title="Copy LaTeX">copy</button>'
        f'{_escape_html(latex)}</div>'
    )
    if graph_json is not None:
        parts.append(
            f'  <div class="row-panel row-json">'
            f'<div class="row-json-pane">'
            f'<div class="row-json-header"><span class="row-json-label">Semantic Graph JSON</span>'
            f'<button class="row-copy-btn" title="Copy JSON">copy</button></div>'
            f'<pre>{_escape_html(graph_json)}</pre></div>'
            f'<div class="row-json-pane">'
            f'<div class="row-json-header"><span class="row-json-label">Mermaid Script</span>'
            f'<button class="row-copy-btn" title="Copy Mermaid">copy</button></div>'
            f'<pre>{_escape_html(mermaid_src)}</pre></div>'
            f'</div>'
        )
        compact_json = json.dumps(
            graph_dict, separators=(",", ":"), ensure_ascii=False,
        )
        parts.append(
            f'  <div class="row-panel row-d3" data-graph="{_escape_attr(compact_json)}">'
            f'<div class="row-d3-placeholder">Click D3 to render</div></div>'
        )

    parts.append('</div>')
    return "\n".join(parts), success


def _escape_html(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _escape_attr(s: str) -> str:
    return _escape_html(s).replace('"', "&quot;")


def _build_report_html(
    sections: list[tuple[str, list[tuple[str, str, str | None]]]],
    *,
    graph_theme: str,
    theme: dict[str, Any],
    colors: dict[str, str],
    d3_module_url: str | None = None,
    chart_module_url: str | None = None,
) -> tuple[str, int, int]:
    """Build report HTML body and return (html, ok_count, err_count)."""
    import datetime

    total = sum(len(exprs) for _, exprs in sections)
    body_parts: list[str] = []
    ok_count = 0
    err_count = 0

    for section_name, expressions in sections:
        body_parts.append(
            f'<div class="section-title">{section_name} '
            f'({len(expressions)} expressions)</div>'
        )
        for test_id, latex, domain in expressions:
            row_html, success = _render_row(test_id, latex, theme, domain)
            body_parts.append(row_html)
            if success:
                ok_count += 1
            else:
                err_count += 1

    summary_icon = "✅" if err_count == 0 else "❌"
    summary = (
        f'<div class="summary">'
        f'{summary_icon} '
        f'<span class="count">{ok_count}</span> rendered, '
        f'<span class="count">{err_count}</span> errors '
        f'out of <span class="count">{total}</span> expressions'
        f'</div>'
    )
    body_parts.append(summary)

    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    meta = f"Generated {now} &middot; theme: {graph_theme} &middot; {total} expressions"

    d3_css = _load_d3_css()
    chart_css = _load_chart_css()
    theme_json_str = json.dumps(theme, ensure_ascii=False)
    d3_direction = theme.get("direction", "LR")
    # Mermaid reverses edge direction (child→parent), so its LR puts
    # leaves on the left and the root relation on the right.  The D3
    # renderer uses raw parent→child edges, so we flip the direction
    # to produce the same visual flow.
    dir_map = {"LR": "right-left", "RL": "left-right", "TB": "bottom-up", "BT": "top-down"}
    d3_direction_full = dir_map.get(d3_direction, "right-left")
    effective_d3_url = d3_module_url or _D3_MODULE_URL
    effective_chart_url = chart_module_url or "./sg-chart.js"

    html = _page_template().format(
        body="\n".join(body_parts),
        meta=meta,
        theme_json=theme_json_str,
        d3_css=d3_css,
        chart_css=chart_css,
        d3_module_url=effective_d3_url,
        chart_module_url=effective_chart_url,
        d3_direction=d3_direction_full,
        d3_theme=graph_theme,
        **colors,
    )
    return html, ok_count, err_count


def generate_report(
    *,
    graph_theme: str = "default-dark",
    output: Path | None = None,
) -> Path:
    import shutil

    theme = load_theme(graph_theme)
    color_mode = theme.get("mode", "dark")
    colors = THEMES[color_mode]
    sections = _collect_expressions()

    if output is None:
        import tempfile
        fd, path = tempfile.mkstemp(prefix="sg_report_", suffix=".html")
        import os
        os.close(fd)
        output = Path(path)

    d3_js_src = _PROJECT_ROOT / "static" / "graph-panel" / "d3-semantic-graph.js"
    d3_js_dst = output.parent / "d3-semantic-graph.js"
    shutil.copy2(d3_js_src, d3_js_dst)

    chart_js_src = _PROJECT_ROOT / "static" / "graph-panel" / "sg-chart.js"
    chart_js_dst = output.parent / "sg-chart.js"
    shutil.copy2(chart_js_src, chart_js_dst)

    chart_script_src = _PROJECT_ROOT / "static" / "graph-panel" / "sg-chart-script.js"
    chart_script_dst = output.parent / "sg-chart-script.js"
    shutil.copy2(chart_script_src, chart_script_dst)

    html, _, _ = _build_report_html(
        sections, graph_theme=graph_theme, theme=theme, colors=colors,
        d3_module_url="./d3-semantic-graph.js",
        chart_module_url="./sg-chart.js",
    )

    output.write_text(html, encoding="utf-8")
    return output


def _index_template() -> str:
    return textwrap.dedent("""\
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Semantic Graph Reports</title>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      body {{
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: {bg}; color: {fg}; padding: 2rem;
      }}
      h1 {{ font-size: 1.4rem; margin-bottom: 0.5rem; }}
      .meta {{ font-size: 0.8rem; color: {muted}; margin-bottom: 2rem; }}
      .domain-list {{ list-style: none; }}
      .domain-list li {{
        background: {card_bg}; border: 1px solid {border}; border-radius: 8px;
        padding: 1rem 1.2rem; margin-bottom: 0.75rem;
        box-shadow: 0 1px 4px {shadow};
      }}
      .domain-list a {{
        color: {fg}; text-decoration: none; font-weight: 600; font-size: 1.05rem;
      }}
      .domain-list a:hover {{ text-decoration: underline; }}
      .domain-list .stats {{
        font-size: 0.8rem; color: {muted}; margin-top: 0.3rem;
      }}
    </style>
    </head>
    <body>
    <h1>Semantic Graph &mdash; Visual Examination Reports</h1>
    <div class="meta">{meta}</div>
    <ul class="domain-list">
    {entries}
    </ul>
    </body>
    </html>
    """)


def generate_site(
    *,
    graph_theme: str = "default-dark",
    outdir: Path,
) -> Path:
    import datetime
    import shutil

    outdir.mkdir(parents=True, exist_ok=True)

    d3_js_src = _PROJECT_ROOT / "static" / "graph-panel" / "d3-semantic-graph.js"
    d3_js_dst = outdir / "d3-semantic-graph.js"
    shutil.copy2(d3_js_src, d3_js_dst)

    chart_js_src = _PROJECT_ROOT / "static" / "graph-panel" / "sg-chart.js"
    chart_js_dst = outdir / "sg-chart.js"
    shutil.copy2(chart_js_src, chart_js_dst)

    chart_script_src = _PROJECT_ROOT / "static" / "graph-panel" / "sg-chart-script.js"
    chart_script_dst = outdir / "sg-chart-script.js"
    shutil.copy2(chart_script_src, chart_script_dst)

    # Cache-bust the ES modules on every (re)generation — browsers cache module
    # imports aggressively, so without this a regenerated report keeps running the
    # stale JS (won't reflect renderer changes).
    _d3_ver = int(d3_js_dst.stat().st_mtime)
    _chart_ver = int(chart_js_dst.stat().st_mtime)

    theme = load_theme(graph_theme)
    color_mode = theme.get("mode", "dark")
    colors = THEMES[color_mode]
    sections = _collect_expressions()

    index_entries: list[str] = []
    total_ok = 0
    total_err = 0

    for section_name, expressions in sections:
        slug = section_name.lower().replace(" ", "-")
        filename = f"{slug}.html"

        html, ok, err = _build_report_html(
            [(section_name, expressions)],
            graph_theme=graph_theme, theme=theme, colors=colors,
            d3_module_url=f"./d3-semantic-graph.js?v={_d3_ver}",
            chart_module_url=f"./sg-chart.js?v={_chart_ver}",
        )
        (outdir / filename).write_text(html, encoding="utf-8")
        total_ok += ok
        total_err += err

        icon = "✅" if err == 0 else "❌"
        index_entries.append(
            f'<li><a href="{filename}">{icon} {section_name}</a>'
            f'<div class="stats">{ok} rendered, {err} errors '
            f'out of {len(expressions)} expressions</div></li>'
        )

    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    total = total_ok + total_err
    meta = (
        f"Generated {now} &middot; theme: {graph_theme} "
        f"&middot; {total} expressions across {len(sections)} domains"
    )

    index_html = _index_template().format(
        entries="\n".join(index_entries),
        meta=meta,
        **colors,
    )
    index_path = outdir / "index.html"
    index_path.write_text(index_html, encoding="utf-8")
    return outdir


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate semantic graph visual examination report.",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "-o", "--output",
        type=Path,
        default=None,
        help="Output single HTML file (default: temp file)",
    )
    group.add_argument(
        "--outdir",
        type=Path,
        default=None,
        help="Output directory for per-domain reports + index page",
    )
    parser.add_argument(
        "--theme",
        default="default-dark",
        help="Semantic graph theme (default: default-dark)",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="Open the report in the default browser",
    )
    args = parser.parse_args()

    if args.outdir:
        out = generate_site(graph_theme=args.theme, outdir=args.outdir)
        print(f"✅ {out}/index.html")
        target = out / "index.html"
    else:
        out = generate_report(graph_theme=args.theme, output=args.output)
        print(f"✅ {out}")
        target = out

    if args.open:
        import webbrowser
        webbrowser.open(f"file://{target}")


if __name__ == "__main__":
    main()
