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

from server import resolve_scene_path_safe, script_dir, scenes_dir


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


def test_resolved_path_within_allowed_roots():
    scene_files = list(scenes_dir.glob("*.json"))
    if not scene_files:
        return
    name = scene_files[0].name
    result = resolve_scene_path_safe(f"scenes/{name}")
    assert result is not None
    allowed = (scenes_dir.resolve(), script_dir.resolve())
    assert any(
        result == root or str(result).startswith(str(root) + '/')
        for root in allowed
    )
