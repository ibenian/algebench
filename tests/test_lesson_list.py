"""Tests for the lesson summaries behind the Built-in Lessons picker."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import backend.server as server


def _write(path: Path, spec) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(spec), encoding="utf-8")


def _lessons(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "scenes_dir", tmp_path)
    monkeypatch.setattr(server, "_lesson_summary_cache", {})
    return {l["id"]: l for l in server.list_builtin_lessons()}


def test_builtins_and_drafts_are_listed_with_ids_and_flags(tmp_path, monkeypatch):
    _write(tmp_path / "alpha.json", {"title": "Alpha", "scenes": [
        {"description": "First  scene\nof alpha.", "steps": [{}, {}]},
        {"steps": [{}]},
    ], "import": ["astrodynamics"]})
    _write(tmp_path / "draft" / "beta.json", {"title": "Beta", "scenes": [{"steps": []}]})
    lessons = _lessons(tmp_path, monkeypatch)
    assert set(lessons) == {"alpha", "draft/beta"}
    alpha = lessons["alpha"]
    assert alpha["draft"] is False
    assert alpha["title"] == "Alpha"
    assert alpha["description"] == "First scene of alpha."
    assert (alpha["sceneCount"], alpha["stepCount"]) == (2, 3)
    assert alpha["domains"] == ["astrodynamics"]
    assert lessons["draft/beta"]["draft"] is True


def test_search_text_covers_every_scene_title_and_description(tmp_path, monkeypatch):
    _write(tmp_path / "gamma.json", {"title": "Gamma", "scenes": [
        {"title": "Intro", "description": "short"},
        {"title": "Deep Dive", "description": "the characteristic   polynomial"},
    ]})
    text = _lessons(tmp_path, monkeypatch)["gamma"]["searchText"]
    assert text == "Intro short Deep Dive the characteristic polynomial"


def test_long_descriptions_are_cut_on_a_word(tmp_path, monkeypatch):
    _write(tmp_path / "long.json", {"title": "Long", "scenes": [{"description": "word " * 200}]})
    desc = _lessons(tmp_path, monkeypatch)["long"]["description"]
    assert len(desc) <= server.LESSON_DESCRIPTION_MAX + 1
    assert desc.endswith("word…")


def test_broken_or_odd_files_are_skipped_or_defaulted(tmp_path, monkeypatch):
    (tmp_path / "broken.json").write_text("{not json", encoding="utf-8")
    _write(tmp_path / "list.json", [1, 2])
    _write(tmp_path / "untitled.json", {"scenes": "nope"})
    lessons = _lessons(tmp_path, monkeypatch)
    assert set(lessons) == {"untitled"}
    assert lessons["untitled"]["title"] == "untitled"
    assert lessons["untitled"]["sceneCount"] == 0


def test_real_scenes_dir_lists_every_lesson():
    lessons = server.list_builtin_lessons()
    ids = {l["id"] for l in lessons}
    assert set(server.list_builtin_scenes()) <= ids
    assert any(l["draft"] for l in lessons)
