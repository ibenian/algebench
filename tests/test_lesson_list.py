"""Tests for the lesson summaries behind the Built-in Lessons picker."""

import json
import os
import time
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


def test_every_scene_title_and_description_is_searchable(tmp_path, monkeypatch):
    _write(tmp_path / "gamma.json", {"title": "Gamma", "scenes": [
        {"title": "Intro", "description": "short"},
        {"title": "Deep   Dive", "description": "the characteristic   polynomial"},
    ]})
    gamma = _lessons(tmp_path, monkeypatch)["gamma"]
    assert gamma["sceneTitles"] == ["Intro", "Deep Dive"]
    assert gamma["searchText"] == "short the characteristic polynomial"


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


def test_glossary_terms_come_from_the_lesson_and_its_domains(tmp_path, monkeypatch):
    domains = tmp_path / "static"
    _write(domains / "domains" / "stats" / "docs.json", {"glossary": {
        "MAD": {"term": "median absolute deviation", "aliases": ["MADs"]},
    }})
    monkeypatch.setattr(server, "static_dir", domains)
    monkeypatch.setattr(server, "_domain_terms_cache", {})
    scenes = tmp_path / "scenes"
    _write(scenes / "delta.json", {"title": "Delta", "import": ["stats", "missing"], "glossary": {
        "eigenvalue": {"term": "eigenvalue", "aliases": ["eigenvalues"]},
        "mad": {"term": "MAD"},
    }})
    terms = _lessons(scenes, monkeypatch)["delta"]["glossary"]
    assert terms == ["eigenvalue", "eigenvalues", "mad", "median absolute deviation", "MADs"]


def test_index_is_built_at_startup_and_edits_are_picked_up(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(server, "scenes_dir", tmp_path)
    monkeypatch.setattr(server, "_lesson_summary_cache", {})
    lesson = tmp_path / "eps.json"
    _write(lesson, {"title": "Eps", "scenes": []})
    with TestClient(server.create_app()):
        for _ in range(100):
            if lesson in server._lesson_summary_cache:
                break
            time.sleep(0.02)
        assert server._lesson_summary_cache[lesson][1]["title"] == "Eps"

    _write(lesson, {"title": "Eps 2", "scenes": []})
    os.utime(lesson, ns=(time.time_ns(), time.time_ns() + 10**9))
    assert {l["id"]: l for l in server.list_builtin_lessons()}["eps"]["title"] == "Eps 2"


def test_refresh_rebuilds_even_when_mtimes_match(tmp_path, monkeypatch):
    lesson = tmp_path / "zeta.json"
    _write(lesson, {"title": "Zeta", "scenes": []})
    assert _lessons(tmp_path, monkeypatch)["zeta"]["title"] == "Zeta"
    st = lesson.stat()
    _write(lesson, {"title": "Zeta 2", "scenes": []})
    os.utime(lesson, ns=(st.st_atime_ns, st.st_mtime_ns))   # an edit the mtime check misses
    assert server.list_builtin_lessons()[0]["title"] == "Zeta"
    assert server.list_builtin_lessons(refresh=True)[0]["title"] == "Zeta 2"


def test_invalid_utf8_lesson_is_skipped(tmp_path, monkeypatch):
    (tmp_path / "latin1.json").write_bytes('{"title": "Caf\xe9"}'.encode("latin-1"))
    _write(tmp_path / "ok.json", {"title": "Ok", "scenes": []})
    assert set(_lessons(tmp_path, monkeypatch)) == {"ok"}


def test_a_description_with_no_spaces_is_cut_by_characters(tmp_path, monkeypatch):
    _write(tmp_path / "run.json", {"title": "Run", "scenes": [{"description": "x" * 400}]})
    desc = _lessons(tmp_path, monkeypatch)["run"]["description"]
    assert desc == "x" * server.LESSON_DESCRIPTION_MAX + "…"
