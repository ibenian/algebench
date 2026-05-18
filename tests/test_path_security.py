"""Tests for path traversal protection in server endpoints."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import server


class TestLoadScene:
    """_load_scene must reject paths outside allowed directories."""

    def test_dict_input_accepted(self):
        spec = server._load_scene({"scenes": [{"objects": []}]})
        assert isinstance(spec, dict)

    def test_valid_scene_file_accepted(self):
        scenes = server.list_builtin_scenes()
        if scenes:
            path = server.scenes_dir / f"{scenes[0]}.json"
            if path.exists():
                spec = server._load_scene(str(path))
                assert isinstance(spec, dict)

    def test_traversal_rejected(self):
        import pytest
        with pytest.raises(ValueError, match="Path outside allowed directories"):
            server._load_scene("/etc/passwd")

    def test_dotdot_traversal_rejected(self):
        import pytest
        with pytest.raises(ValueError, match="Path outside allowed directories"):
            server._load_scene("../../../etc/passwd")

    def test_tmp_path_rejected(self):
        import pytest
        with pytest.raises(ValueError, match="Path outside allowed directories"):
            server._load_scene("/tmp/evil.json")

    def test_trusted_allows_any_path(self):
        import tempfile, json
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"scenes": [{"objects": []}]}, f)
            f.flush()
            spec = server._load_scene(f.name, trusted=True)
            assert isinstance(spec, dict)


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

    def test_absolute_path_outside_roots_rejected(self):
        assert server.resolve_scene_path_safe("/etc/passwd") is None
        assert server.resolve_scene_path_safe("/tmp/evil.json") is None

    def test_absolute_path_inside_roots_allowed(self):
        scenes = server.list_builtin_scenes()
        if scenes:
            abs_path = str(server.scenes_dir / f"{scenes[0]}.json")
            result = server.resolve_scene_path_safe(abs_path)
            assert result is not None

    def test_dotdot_traversal_outside_roots_rejected(self):
        assert server.resolve_scene_path_safe("../../../etc/passwd") is None

    def test_dotdot_within_roots_contained(self):
        scenes = server.list_builtin_scenes()
        if scenes:
            result = server.resolve_scene_path_safe(f"scenes/../scenes/{scenes[0]}.json")
            if result:
                allowed = (server.scenes_dir.resolve(), server.script_dir.resolve())
                assert any(result.is_relative_to(r) for r in allowed)

    def test_valid_scene_resolves(self):
        scenes = server.list_builtin_scenes()
        if scenes:
            path = server.resolve_scene_path_safe(f"scenes/{scenes[0]}.json")
            assert path is not None
            allowed = (server.scenes_dir.resolve(), server.script_dir.resolve())
            assert any(path.is_relative_to(r) for r in allowed)
