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

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from validate_model_parity import CHECKS, CheckFailure, identical  # noqa: E402


@pytest.mark.parametrize("label,check", CHECKS, ids=[c[0].replace(" ", "-") for c in CHECKS])
def test_model_parity_check(label: str, check) -> None:
    """Run each check from scripts/validate_model_parity.py.

    WHY THIS EXISTS WHEN validate-data.yml ALREADY RUNS THE SCRIPT
    -------------------------------------------------------------
    Not the same duplication as the `backend-model.yml` workflow that was deleted
    in favour of the script. That one repeated the whole apparatus — checkout,
    install, ~20s, a second named check — to run tests already running. This is
    0.23s inside a suite that runs anyway, and it buys something the script cannot:

      * tests.yml is a REQUIRED check and is deliberately NOT path-filtered, so
        these checks run on every PR.
      * validate-data.yml is path-filtered and therefore cannot be required. Its
        filter is a hand-maintained list; today it names every file that can break
        a mirror, but the moment one joins the set and is not added, the script
        silently stops covering it. This wrapper is filter-independent.

    The logic itself lives in the script — house pattern (validate_schema.py,
    validate_content.py, audit_expressions.py) and runnable while editing.
    Restating it here would leave two implementations to keep in step, which is
    the exact failure these checks exist to catch.
    """
    try:
        check(verbose=False)
    except CheckFailure as e:
        pytest.fail(str(e))


def test_the_comparison_can_see_numeric_type() -> None:
    """Guards the guard.

    `==` holds `0 == 0.0`, including inside lists and dicts, so a round-trip
    assertion written with it cannot detect int-to-float coercion. Measured: with
    a plain `==`, annotating a coordinate as `float` — which rewrites every
    integer in every published lesson — passed the entire suite.
    """
    assert 0 == 0.0 and not identical(0, 0.0)
    assert not identical({"p": [0, 1]}, {"p": [0.0, 1.0]})
    assert identical({"p": [0, 1]}, {"p": [0, 1]})


def test_size_tuple_is_chart_only() -> None:
    """The schema's type conditional: `[w, h]` on a chart, a number elsewhere."""
    from pydantic import ValidationError

    from backend.model.lesson import Element

    assert Element.model_validate({"type": "chart", "size": [6, 3]}).size == [6, 3]
    assert Element.model_validate({"type": "point", "size": 12}).size == 12
    with pytest.raises(ValidationError):
        Element.model_validate({"type": "point", "size": [6, 3]})
    with pytest.raises(ValidationError):
        Element.model_validate({"type": "chart", "size": 8})
    with pytest.raises(ValidationError):
        Element.model_validate({"type": "chart", "size": [6, 0]})
