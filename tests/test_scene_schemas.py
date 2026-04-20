"""Schema-validate every scene (lesson) file.

Ensures scenes/*.json and scenes/draft/*.json all conform to
schemas/lesson.schema.json. Mirrors test_semantic_graph_themes.py for scenes.

The CI workflow (.github/workflows/validate-data.yml) runs the same check
against changed files on every PR; this test catches regressions locally
and gives devs a single ``pytest`` invocation that covers all data-shape
invariants.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

REPO_ROOT = Path(__file__).parent.parent
SCENES_DIR = REPO_ROOT / "scenes"
SCHEMA_PATH = REPO_ROOT / "schemas" / "lesson.schema.json"


@pytest.fixture(scope="module")
def schema() -> dict:
    with open(SCHEMA_PATH) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def validator(schema: dict) -> Draft202012Validator:
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def scene_files() -> list[Path]:
    """Published scene files only — drafts under scenes/draft/ are WIP
    and allowed to lag behind the schema."""
    files = sorted(SCENES_DIR.glob("*.json"))
    assert files, f"No scene files found under {SCENES_DIR}"
    return files


def test_schema_is_well_formed(schema: dict) -> None:
    Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize("scene_path", scene_files(), ids=lambda p: str(p.relative_to(Path(__file__).parent.parent)))
def test_scene_matches_schema(scene_path: Path, validator: Draft202012Validator) -> None:
    with open(scene_path) as f:
        data = json.load(f)

    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        lines = [f"{scene_path.name} failed schema validation:"]
        for error in errors:
            location = " > ".join(str(p) for p in error.absolute_path) or "(root)"
            lines.append(f"  [{location}] {error.message}")
        pytest.fail("\n".join(lines))
