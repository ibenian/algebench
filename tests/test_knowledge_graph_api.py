"""Tests for /api/knowledge-graph: every lesson's optional knowledgeGraph block,
served from the same mtime-cached lesson index as the picker."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import backend.server as server


def _write(path: Path, spec) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(spec), encoding="utf-8")


def _setup(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "scenes_dir", tmp_path)
    monkeypatch.setattr(server, "_lesson_summary_cache", {})


KG = {
    "focus": "dsa.deque",
    "concepts": [
        {"id": "dsa.deque", "label": "Deque", "glossary": "deque"},
        {"id": "dsa.stack", "label": "Stack"},
    ],
    "relations": [{"source": "dsa.stack", "target": "dsa.deque", "type": "specializes"}],
}


def test_only_lessons_with_a_graph_are_listed_with_coverage(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    _write(tmp_path / "plain.json", {"title": "Plain", "scenes": [{}]})
    _write(tmp_path / "draft" / "kg.json", {
        "title": "With graph", "scenes": [{}], "knowledgeGraph": KG,
        "glossary": {"deque": {"term": "Deque", "markdown": "double-ended", "prompt": "x"},
                     "unused": {"markdown": "not referenced"}},
    })
    out = server.list_lesson_knowledge_graphs()
    assert out["lessonCount"] == 2
    assert [l["id"] for l in out["lessons"]] == ["draft/kg"]
    lesson = out["lessons"][0]
    assert lesson["draft"] is True and lesson["title"] == "With graph"
    assert lesson["knowledgeGraph"] == KG
    # only glossary entries a concept names explicitly, and only term/markdown
    assert lesson["glossary"] == {"deque": {"term": "Deque", "markdown": "double-ended"}}


def test_picker_summaries_do_not_carry_the_graph(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    _write(tmp_path / "kg.json", {"title": "With graph", "scenes": [{}], "knowledgeGraph": KG})
    (summary,) = server.list_builtin_lessons()
    assert not any(k.startswith("_") for k in summary)
    assert "knowledgeGraph" not in summary


def test_malformed_or_oversized_blocks_are_skipped(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    _write(tmp_path / "bad.json", {"title": "Bad", "scenes": [{}], "knowledgeGraph": ["not", "an", "object"]})
    big = {"concepts": [{"id": f"c{i}", "label": "x" * 200} for i in range(2000)]}
    _write(tmp_path / "big.json", {"title": "Big", "scenes": [{}], "knowledgeGraph": big})
    out = server.list_lesson_knowledge_graphs()
    assert out["lessons"] == []
    assert out["lessonCount"] == 2


def test_edits_are_picked_up(tmp_path, monkeypatch):
    import os, time
    _setup(tmp_path, monkeypatch)
    path = tmp_path / "kg.json"
    _write(path, {"title": "T", "scenes": [{}]})
    assert server.list_lesson_knowledge_graphs()["lessons"] == []
    _write(path, {"title": "T", "scenes": [{}], "knowledgeGraph": KG})
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 10_000_000))
    assert len(server.list_lesson_knowledge_graphs()["lessons"]) == 1


def test_real_demo_lessons_are_served():
    out = server.list_lesson_knowledge_graphs()
    ids = {l["id"] for l in out["lessons"]}
    assert "draft/parenthesis-validation" in ids
    assert out["lessonCount"] >= len(ids)


# ---------- strict schema validation of the knowledgeGraph block ----------

def _lesson_validator():
    from jsonschema import Draft202012Validator
    from scripts.validate_schema import load_schema
    return Draft202012Validator(load_schema("lesson"))


def _demo_lesson():
    path = Path(__file__).parent.parent / "scenes" / "draft" / "parenthesis-validation.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_demo_lesson_knowledge_graph_is_schema_valid():
    from scripts.validate_schema import validate_data
    assert validate_data(_demo_lesson(), _lesson_validator(), verbose=False) == []


def test_removed_live_update_example_field_is_rejected():
    """The dev demo moved out of lesson content (src/graph-explorer/fixtures/);
    the strict schema must not accept it back."""
    from scripts.validate_schema import validate_data
    spec = _demo_lesson()
    spec["knowledgeGraph"]["liveUpdateExample"] = {"concepts": [{"id": "x", "label": "X"}]}
    errors = validate_data(spec, _lesson_validator(), verbose=True)
    assert errors, "liveUpdateExample must fail strict validation"
    assert any("liveUpdateExample" in e for e in errors)


def test_server_no_longer_special_cases_the_demo_field(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch)
    kg = {**KG, "liveUpdateExample": {"concepts": [{"id": "x", "label": "X", "glossary": "extra"}]}}
    _write(tmp_path / "kg.json", {"title": "T", "scenes": [{}], "knowledgeGraph": kg,
                                  "glossary": {"deque": {"markdown": "d"}, "extra": {"markdown": "e"}}})
    (lesson,) = server.list_lesson_knowledge_graphs()["lessons"]
    assert set(lesson["glossary"]) == {"deque"}, "only the real concepts' glossary keys are looked up"
