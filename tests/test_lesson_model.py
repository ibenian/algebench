"""Keep `backend/model/lesson.py` honest against `schemas/lesson.schema.json`.

The schema is hand-maintained (and edited by the ``algebench-schema-generator``
skill), so the pydantic mirror can silently fall behind it — exactly the drift
``.github/workflows/frontend-types.yml`` guards against on the TypeScript side.
``backend/model/semantic_graph.py`` has no such guard today; this is the one for
lessons.

Three checks, cheapest signal last:

A. **Corpus round-trip** — parse every published lesson through the model, dump
   it, assert it comes back identical. Catches the two severe failures: silent
   data loss (a mishandled ``from``/``from_`` alias, a dropped key) and a type
   that is too narrow to accept real content. Self-maintaining: every lesson
   added to the repo extends coverage.

B. **Field conformance** — every field the model declares must exist in the
   matching ``$defs`` block. Catches a stale field, which jsonschema CANNOT
   because ``$defs.element`` is ``additionalProperties: true``.

C. **Import isolation** — the model must stay free of dspy/litellm/sympy so the
   CI job for it installs three packages and runs in seconds.

``scenes/draft/`` is skipped for the same reason ``test_scene_schemas.py`` skips
it: drafts are WIP and allowed to lag the schema.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from backend.model.lesson import (  # noqa: E402
    Camera, Element, InfoOverlay, RemoveDirective, Scene, Slider, Step, View,
)

REPO_ROOT = Path(__file__).parent.parent
SCENES_DIR = REPO_ROOT / "scenes"
SCHEMA_PATH = REPO_ROOT / "schemas" / "lesson.schema.json"

SCENE_FILES = sorted(SCENES_DIR.glob("*.json"))


@pytest.fixture(scope="module")
def schema() -> dict:
    with open(SCHEMA_PATH) as f:
        return json.load(f)


def _dump(model) -> dict:
    """Serialize the way the wire does: JSON mode (lists, not tuples), aliases out,
    absent keys absent."""
    return model.model_dump(mode="json", by_alias=True, exclude_none=True)


def _identical(a, b) -> bool:
    """Structural equality that also compares NUMERIC TYPE.

    `==` cannot do this job: Python holds `0 == 0.0`, and that equality reaches
    inside lists and dicts, so `{"position": [0, 0, 10]}` compares equal to
    `{"position": [0.0, 0.0, 10.0]}`. The round-trip assertion below is supposed
    to guard exactly that coercion — measured: with a plain `==`, reverting
    `Num` to `float` (the bug that once failed all 16 lessons) passed every test
    in this file. It only ever caught the tuple-vs-list half of the problem,
    which `==` does see.
    """
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return type(a) is type(b) and a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_identical(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_identical(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b


# ── A. Corpus round-trip ─────────────────────────────────────────────────────

@pytest.mark.parametrize("path", SCENE_FILES, ids=lambda p: p.name)
def test_model_round_trips_published_lesson(path: Path) -> None:
    raw = json.loads(path.read_text())
    scenes = raw.get("scenes") or [raw]
    for i, original in enumerate(scenes):
        parsed = Scene.model_validate(original)
        assert _identical(_dump(parsed), original), (
            f"{path.name} scene {i} ({original.get('title')!r}) did not round-trip — "
            f"the model is lossy or a type is too narrow"
        )


def test_round_trip_covers_the_whole_corpus() -> None:
    """Guard the guard: a glob that silently matches nothing proves nothing."""
    assert len(SCENE_FILES) >= 10, f"expected the published corpus, found {len(SCENE_FILES)} files"


def test_from_alias_round_trips() -> None:
    """`from` is the one alias in the model, so it is the one place the two
    languages can silently diverge. Pin both directions."""
    el = Element.model_validate({"type": "vector", "from": [0, 0, 0], "to": [2, 1, 0]})
    assert el.from_ == [0, 0, 0]
    assert "from" in _dump(el) and "from_" not in _dump(el)


# ── B. Field conformance ─────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "model,defn",
    [
        (Scene, "scene"), (Step, "step"), (Element, "element"), (Slider, "slider"),
        (Camera, "camera"), (View, "view"), (RemoveDirective, "removeDirective"),
        (InfoOverlay, "infoOverlay"),
    ],
    ids=lambda x: x if isinstance(x, str) else x.__name__,
)
def test_every_model_field_exists_in_the_schema(schema: dict, model, defn: str) -> None:
    allowed = set(schema["$defs"][defn]["properties"])
    # Resolve aliases: the model's `from_` is the schema's `from`.
    declared = {f.alias or name for name, f in model.model_fields.items()}
    extra = declared - allowed
    assert not extra, f"{model.__name__} declares field(s) absent from $defs.{defn}: {sorted(extra)}"


# ── C. Import isolation ──────────────────────────────────────────────────────

def test_model_imports_nothing_heavy() -> None:
    """A design requirement, not just CI convenience: the model must be usable
    from scripts and from a three-package CI job without the LM stack."""
    code = (
        "import sys; import backend.model.lesson; "
        "heavy = [m for m in ('dspy', 'litellm', 'sympy', 'fastapi', 'torch') if m in sys.modules]; "
        "print(','.join(heavy))"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=REPO_ROOT, capture_output=True, text=True, check=True,
    )
    assert out.stdout.strip() == "", f"backend.model.lesson pulled in heavy deps: {out.stdout.strip()}"
