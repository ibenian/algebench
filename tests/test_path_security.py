"""Tests for path traversal protection in server endpoints."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import server


class TestLoadBuiltinScene:
    """load_builtin_scene must reject traversal attempts."""

    def test_simple_name_resolves(self):
        scenes = server.list_builtin_scenes()
        if scenes:
            result = server.load_builtin_scene(scenes[0])
            assert result is not None

    def test_dotdot_traversal_rejected(self):
        assert server.load_builtin_scene("../server") is None
        assert server.load_builtin_scene("../../etc/passwd") is None

    def test_absolute_path_rejected(self):
        assert server.load_builtin_scene("/etc/passwd") is None

    def test_nonexistent_returns_none(self):
        assert server.load_builtin_scene("nonexistent_scene_xyz") is None


class TestResolveScenePathSafe:
    """resolve_scene_path_safe must confine paths to allowed roots."""

    def test_empty_returns_none(self):
        assert server.resolve_scene_path_safe("") is None
        assert server.resolve_scene_path_safe(None) is None

    def test_tilde_expansion_rejected(self):
        assert server.resolve_scene_path_safe("~/secrets.json") is None
        assert server.resolve_scene_path_safe("~root/.bashrc") is None

    def test_absolute_path_rejected(self):
        assert server.resolve_scene_path_safe("/etc/passwd") is None
        assert server.resolve_scene_path_safe("/tmp/evil.json") is None

    def test_dotdot_traversal_rejected(self):
        assert server.resolve_scene_path_safe("../../../etc/passwd") is None
        assert server.resolve_scene_path_safe("scenes/../../server.py") is None

    def test_valid_scene_resolves(self):
        scenes = server.list_builtin_scenes()
        if scenes:
            path = server.resolve_scene_path_safe(f"scenes/{scenes[0]}.json")
            assert path is not None
            assert path.is_relative_to(server.scenes_dir.resolve()) or \
                   path.is_relative_to(server.script_dir.resolve())

    def test_result_within_allowed_roots(self):
        scenes = server.list_builtin_scenes()
        if scenes:
            path = server.resolve_scene_path_safe(f"scenes/{scenes[0]}.json")
            if path:
                allowed = (server.scenes_dir.resolve(), server.script_dir.resolve())
                assert any(path.is_relative_to(r) for r in allowed)
