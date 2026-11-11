"""build_system_prompt renders runtime.knowledgeGraph — the Knowledge Graph view
the learner last explored (src/graph-explorer/agent-context.ts)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.agent_tools import build_system_prompt, knowledge_graph_section

KG = {
    "open": True, "context": "lesson:draft/parenthesis-validation", "presentation": "embedded", "scope": "local",
    "focus": {"id": "md", "label": "Monotonic Deque", "category": "data-structure", "role": "focus",
              "definition": "A deque of indices kept in decreasing value order."},
    "selected": {"id": "dq", "label": "Deque", "role": "selected", "definition": "double-ended queue"},
    "visibleConcepts": [{"id": "md", "label": "Monotonic Deque", "role": "focus"},
                        {"id": "dq", "label": "Deque", "category": "data-structure", "expanded": True}],
    "visibleRelations": ["Monotonic Deque specializes Deque"],
    "conceptsOmitted": 0, "relationsOmitted": 0, "recentFoci": ["Stack"], "totalConcepts": 10,
}


def _prompt(kg):
    return build_system_prompt({"runtime": {"knowledgeGraph": kg}, "currentScene": {}})


def test_open_graph_is_in_the_system_prompt():
    p = _prompt(KG)
    assert "## Knowledge Graph — OPEN now (embedded, lesson panel)" in p
    assert "**Focus**: Monotonic Deque [data-structure, focus] — A deque of indices" in p
    assert "**Selected concept**: Deque [selected] — double-ended queue" in p
    assert "Visible concepts (2): Monotonic Deque [focus]; Deque [data-structure, expanded]" in p
    assert "  - Monotonic Deque specializes Deque" in p
    assert "Earlier foci (most recent first): Stack" in p
    assert "Scope: local" in p


def test_closed_graph_is_still_reported_as_the_last_view():
    p = _prompt({**KG, "open": False, "presentation": "closed", "context": "global"})
    assert "## Knowledge Graph — closed — this is the LAST view the learner explored (global explorer)" in p
    assert "Monotonic Deque" in p


def test_selected_relationship():
    s = knowledge_graph_section({**KG, "selected": {"kind": "relation", "sentence": "Stack specializes Deque",
                                                    "description": "one-ended deque"}})
    assert "**Selected relationship**: Stack specializes Deque — one-ended deque" in s


def test_absent_or_malformed_context_adds_nothing():
    assert knowledge_graph_section(None) == ""
    assert knowledge_graph_section("nope") == ""
    assert "## Knowledge Graph" not in _prompt(None)
    # junk entries are skipped, not crashed on
    s = knowledge_graph_section({"open": False, "visibleConcepts": [None, 3, {"label": "Ok"}],
                                 "visibleRelations": [None, "A uses B"], "recentFoci": [5, "X"]})
    assert "Visible concepts (1): Ok" in s and "  - A uses B" in s and "Earlier foci (most recent first): X" in s


def test_server_caps_client_lists():
    big = {**KG, "visibleConcepts": [{"label": f"C{i}"} for i in range(500)],
           "visibleRelations": [f"R{i}" for i in range(500)],
           "focus": {"label": "F", "definition": "x" * 5000}}
    s = knowledge_graph_section(big)
    assert s.count("\n  - R") == 60
    assert "C39" in s and "C40" not in s
    assert len(s) < 6000
