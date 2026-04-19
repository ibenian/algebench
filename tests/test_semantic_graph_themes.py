"""Schema-validate every semantic-graph theme file.

Ensures themes/semantic-graph/*.json all conform to
schemas/semantic-graph-theme.schema.json. Adding a malformed theme (bad
enum, unknown property, malformed color) will fail this test.
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
THEMES_DIR = REPO_ROOT / "themes" / "semantic-graph"
SCHEMA_PATH = REPO_ROOT / "schemas" / "semantic-graph-theme.schema.json"


@pytest.fixture(scope="module")
def schema() -> dict:
    with open(SCHEMA_PATH) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def validator(schema: dict) -> Draft202012Validator:
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def theme_files() -> list[Path]:
    files = sorted(THEMES_DIR.glob("*.json"))
    assert files, f"No theme files found under {THEMES_DIR}"
    return files


def test_schema_is_well_formed(schema: dict) -> None:
    Draft202012Validator.check_schema(schema)


@pytest.mark.parametrize("theme_path", theme_files(), ids=lambda p: p.name)
def test_theme_matches_schema(theme_path: Path, validator: Draft202012Validator) -> None:
    with open(theme_path) as f:
        data = json.load(f)

    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        lines = [f"{theme_path.name} failed schema validation:"]
        for error in errors:
            location = " > ".join(str(p) for p in error.absolute_path) or "(root)"
            lines.append(f"  [{location}] {error.message}")
        pytest.fail("\n".join(lines))


@pytest.mark.parametrize("theme_path", theme_files(), ids=lambda p: p.name)
def test_theme_name_matches_filename(theme_path: Path) -> None:
    """Schema requires `name` to match the filename stem."""
    with open(theme_path) as f:
        data = json.load(f)
    assert data.get("name") == theme_path.stem, (
        f"{theme_path.name}: name field {data.get('name')!r} must match "
        f"filename stem {theme_path.stem!r}"
    )
