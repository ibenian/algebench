"""Tests for backend.server.generate_html template injection.

Guards the ``__DEBUG_MODE__`` / ``__SKIP_TOUR__`` placeholder replacements that
drive the front-end debug logging and guided-tour skip gates — easy to regress
on a placeholder rename or index.html edit.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.server import generate_html


def test_debug_flag_injection():
    assert 'data-debug-mode="true"' in generate_html(debug=True)
    assert 'data-debug-mode="false"' in generate_html(debug=False)


def test_skip_tour_flag_injection():
    assert 'data-skip-tour="true"' in generate_html(skip_tour=True)
    assert 'data-skip-tour="false"' in generate_html(skip_tour=False)


def test_flags_compose():
    html = generate_html(debug=True, skip_tour=True)
    assert 'data-debug-mode="true"' in html
    assert 'data-skip-tour="true"' in html


def test_no_placeholder_leftovers():
    # Both placeholders must be fully substituted regardless of flag values.
    for debug in (True, False):
        for skip_tour in (True, False):
            html = generate_html(debug=debug, skip_tour=skip_tour)
            assert '__DEBUG_MODE__' not in html
            assert '__SKIP_TOUR__' not in html


def test_defaults_are_false():
    html = generate_html()
    assert 'data-debug-mode="false"' in html
    assert 'data-skip-tour="false"' in html
