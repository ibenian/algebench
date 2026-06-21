"""Root test configuration — shared pytest options."""

from __future__ import annotations

import os

# The CAS guard (issue #386) defaults to process isolation in production. For the
# test suite we default to ``thread`` mode: it keeps the heavy sympy entry points
# monkeypatchable in-process and avoids paying per-worker spawn/import cost on
# every grounding test. Tests that specifically exercise process isolation set
# this env var themselves and call ``cas_guard._reset_for_tests()``.
os.environ.setdefault("ALGEBENCH_CAS_ISOLATION", "thread")


def pytest_addoption(parser):
    parser.addoption(
        "--exhaustive",
        action="store_true",
        default=False,
        help="Run the full exhaustive cross-product (~504 combos). Used by CI.",
    )
    parser.addoption(
        "--sampled",
        action="store",
        type=int,
        default=200,
        metavar="N",
        help="Sample N cases from the full cross-product (default: 200).",
    )
