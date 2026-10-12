"""/api/scene names the file the server was launched with, without exposing absolute paths."""

import json
import sys
from pathlib import Path
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient

import backend.server as server

SPEC = {"title": "Lab", "scenes": [{"title": "One", "elements": []}]}


def _client(tmp_path, monkeypatch, scene: Path) -> TestClient:
    scene.parent.mkdir(parents=True, exist_ok=True)
    scene.write_text(json.dumps(SPEC), encoding="utf-8")
    monkeypatch.setattr(server, "scenes_dir", tmp_path / "scenes")
    return TestClient(server.create_app(initial_scene_path=str(scene)))


def test_scene_under_scenes_dir_is_named_by_its_relative_path(tmp_path, monkeypatch):
    res = _client(tmp_path, monkeypatch, tmp_path / "scenes" / "draft" / "lab.json").get("/api/scene")
    assert res.json()["title"] == "Lab"
    assert unquote(res.headers["X-AlgeBench-Scene-Label"]) == "lab.json"
    assert unquote(res.headers["X-AlgeBench-Scene-Path"]) == "scenes/draft/lab.json"


def test_scene_outside_scenes_dir_is_named_by_file_name_only(tmp_path, monkeypatch):
    res = _client(tmp_path, monkeypatch, tmp_path / "elsewhere" / "mine.json").get("/api/scene")
    assert unquote(res.headers["X-AlgeBench-Scene-Path"]) == "mine.json"
    assert str(tmp_path) not in res.headers["X-AlgeBench-Scene-Path"]


def test_no_launch_scene_sends_no_name(monkeypatch):
    res = TestClient(server.create_app()).get("/api/scene")
    assert "X-AlgeBench-Scene-Label" not in res.headers
