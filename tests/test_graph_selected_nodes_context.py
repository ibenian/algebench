"""Selected semantic-graph node(s) in the agent system prompt.

``build_system_prompt`` surfaces the ``runtime.graphPanel`` selection so the
AI tutor can reason about exactly what the user has highlighted. This covers
the three cases: nothing selected, a single node (legacy ``selectedNode``),
and a multi-selection (``selectedNodes``, active node last).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.agent_tools import build_system_prompt  # noqa: E402


def _ctx(*, selected_node=None, selected_nodes=None):
    gp = {
        "open": True,
        "hasGraph": True,
        "stepNumber": 2,
        "nodeCount": 3,
        "edgeCount": 1,
        "theme": "default-dark",
        "labelMode": "short",
        "direction": "TB",
        "zoom": 100,
        "nodes": [
            {"id": "a", "type": "expr"},
            {"id": "b", "type": "op", "op": "add"},
            {"id": "c"},
        ],
        "edges": [{"from": "a", "to": "b"}],
    }
    if selected_node is not None:
        gp["selectedNode"] = selected_node
    if selected_nodes is not None:
        gp["selectedNodes"] = selected_nodes
    return {"runtime": {"graphPanel": gp}, "currentScene": {}}


def test_no_node_selected():
    prompt = build_system_prompt(_ctx())
    assert "## Active Semantic Graph" in prompt
    assert "- No node selected." in prompt
    assert "Selected node" not in prompt


def test_single_selected_node_legacy_field():
    node = {
        "id": "b", "type": "op", "op": "add",
        "neighbors": {"incoming": ["a"], "outgoing": []},
    }
    prompt = build_system_prompt(_ctx(selected_node=node))
    assert "## Active Semantic Graph — selected: b (op/add)" in prompt
    assert "**Selected node** `b`:" in prompt
    assert "- type: op" in prompt
    assert "- incoming: a" in prompt
    assert "- No node selected." not in prompt


def test_multiple_selected_nodes():
    nodes = [
        {"id": "a", "type": "expr",
         "neighbors": {"incoming": [], "outgoing": ["b"]}},
        {"id": "b", "type": "op", "op": "add",
         "neighbors": {"incoming": ["a"], "outgoing": []}},
    ]
    # Active node is the last one (Cmd+Click semantics).
    prompt = build_system_prompt(
        _ctx(selected_nodes=nodes, selected_node=nodes[-1])
    )
    assert "## Active Semantic Graph — 2 nodes selected" in prompt
    assert "**Selected nodes** (2):" in prompt
    assert "  - `a`:" in prompt
    assert "  - `b` (active):" in prompt
    assert "- No node selected." not in prompt
    # Both nodes' details are rendered.
    assert "    - outgoing: b" in prompt
    assert "    - incoming: a" in prompt
