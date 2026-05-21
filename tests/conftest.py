"""Root test configuration — shared pytest options."""

from __future__ import annotations


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
        default="200",
        metavar="N",
        help="Sample N cases from the full cross-product (default: 200).",
    )
