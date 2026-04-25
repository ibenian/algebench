"""Confirm the Pydantic SemanticGraph model stays aligned with what the parser produces.

We feed a handful of representative LaTeX strings through
``scripts/latex_to_graph.py`` and round-trip the resulting graphs through
``agents.models.SemanticGraph``. Any shape the parser emits must validate;
otherwise enrichment will reject perfectly good unenriched graphs.

Also rounds-trips inline graphs from ``scenes/*.json`` if any are present.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from agents.models import SemanticGraph


REPO_ROOT = Path(__file__).resolve().parents[2]
SCENES_DIR = REPO_ROOT / "scenes"
SCRIPTS_DIR = REPO_ROOT / "scripts"


REPRESENTATIVE_LATEX = [
    ("newton", r"F = m a", "mechanics"),
    ("kepler", r"P^2 = a^3", "celestial_mechanics"),
    ("ideal_gas", r"P V = n R T", "thermodynamics"),
    ("ohm", r"V = I R", "electromagnetism"),
    ("kinetic", r"E = \frac{1}{2} m v^2", "mechanics"),
    ("schrodinger", r"i \hbar \frac{\partial \psi}{\partial t} = H \psi", "quantum_mechanics"),
]


def _import_latex_to_graph():
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    import latex_to_graph  # type: ignore
    return latex_to_graph


def _gather_inline_scene_graphs():
    graphs = []
    if not SCENES_DIR.is_dir():
        return graphs
    for scene in sorted(SCENES_DIR.glob("*.json")):
        try:
            data = json.loads(scene.read_text())
        except json.JSONDecodeError:
            continue
        steps = data.get("steps") or []
        for i, step in enumerate(steps):
            sg = step.get("semanticGraph") or {}
            g = sg.get("graph")
            if isinstance(g, dict) and "nodes" in g and "edges" in g:
                graphs.append((f"{scene.name}#step{i}", g))
    return graphs


@pytest.mark.parametrize("name,latex,domain", REPRESENTATIVE_LATEX, ids=[t[0] for t in REPRESENTATIVE_LATEX])
def test_parser_output_validates(name, latex, domain) -> None:
    l2g = _import_latex_to_graph()
    graph = l2g.latex_to_semantic_graph(latex, domain=domain)
    SemanticGraph.model_validate(graph)


INLINE_GRAPHS = _gather_inline_scene_graphs()


@pytest.mark.skipif(not INLINE_GRAPHS, reason="no inline scene graphs to validate")
@pytest.mark.parametrize("label,graph", INLINE_GRAPHS, ids=[g[0] for g in INLINE_GRAPHS])
def test_inline_scene_graph_validates(label, graph) -> None:
    SemanticGraph.model_validate(graph)
