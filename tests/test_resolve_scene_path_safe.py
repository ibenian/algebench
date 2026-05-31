"""Regression tests for resolve_scene_path_safe (issue #287).

Ensures the API-facing path resolver rejects absolute paths, traversal
attempts, and home-dir expansion while still allowing valid relative
paths within the project.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.server import resolve_scene_path_safe, script_dir, scenes_dir


def test_rejects_absolute_path_outside_project():
    assert resolve_scene_path_safe("/etc/passwd") is None
    assert resolve_scene_path_safe("/tmp/something.json") is None


def test_accepts_absolute_path_within_project():
    scene_files = list(scenes_dir.glob("*.json"))
    if not scene_files:
        return
    abs_path = str(scene_files[0].resolve())
    result = resolve_scene_path_safe(abs_path)
    assert result is not None
    assert result == scene_files[0].resolve()


def test_rejects_home_expansion():
    assert resolve_scene_path_safe("~/secret.json") is None
    assert resolve_scene_path_safe("~/.ssh/config") is None


def test_rejects_traversal_outside_project():
    assert resolve_scene_path_safe("../../etc/passwd") is None
    assert resolve_scene_path_safe("../../../tmp/evil.json") is None
    assert resolve_scene_path_safe("scenes/../../outside.json") is None


def test_rejects_empty_and_none():
    assert resolve_scene_path_safe("") is None
    assert resolve_scene_path_safe(None) is None


def test_accepts_valid_scene_by_relative_path():
    scene_files = list(scenes_dir.glob("*.json"))
    if not scene_files:
        return
    name = scene_files[0].name
    result = resolve_scene_path_safe(f"scenes/{name}")
    assert result is not None
    assert result == (scenes_dir / name).resolve()


def test_accepts_valid_scene_bare_name():
    scene_files = list(scenes_dir.glob("*.json"))
    if not scene_files:
        return
    name = scene_files[0].name
    result = resolve_scene_path_safe(name)
    assert result is not None
    assert result.name == name


def test_resolved_path_within_scenes_dir():
    scene_files = list(scenes_dir.glob("*.json"))
    if not scene_files:
        return
    name = scene_files[0].name
    result = resolve_scene_path_safe(f"scenes/{name}")
    assert result is not None
    # Confinement is to scenes_dir only — script_dir is no longer an allowed root.
    assert str(result).startswith(str(scenes_dir.resolve()) + os.sep)


def test_rejects_json_in_project_root_outside_scenes():
    """Valid JSON elsewhere in the repo must NOT be served (issue: .claude/launch.json leak)."""
    # Create a throwaway JSON file at the project root, confirm it is rejected.
    probe = script_dir / "__probe_resolve_scene_path_safe__.json"
    try:
        probe.write_text("{}")
        assert resolve_scene_path_safe("__probe_resolve_scene_path_safe__.json") is None
    finally:
        probe.unlink(missing_ok=True)


def test_rejects_non_json_inside_scenes():
    """Even within scenes/, a non-.json file must be rejected."""
    probe = scenes_dir / "__probe_resolve_scene_path_safe__.txt"
    try:
        probe.write_text("not json")
        assert resolve_scene_path_safe("scenes/__probe_resolve_scene_path_safe__.txt") is None
        assert resolve_scene_path_safe("__probe_resolve_scene_path_safe__.txt") is None
    finally:
        probe.unlink(missing_ok=True)
