"""The minimum uv version is declared twice; keep the copies equal.

`uv.toml`'s ``required-version`` is the primary gate — uv itself refuses to run
below it, on every project command, with an actionable message. Nothing in the
repo hand-rolls a version comparison against it.

The exception is `scripts/dependency_audit_report.py`: ``uv tool run`` resolves
tools outside the project and does NOT honour ``required-version`` (measured), and
that is the one call which actually installs packages — the exposure the
advisories describe. So it keeps a narrow check of its own, and that check needs
the floor as a Python constant.

This test is what stops the two copies drifting when the floor is bumped for the
next advisory and only one file is updated.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
UV_TOML = REPO_ROOT / "uv.toml"
AUDIT = REPO_ROOT / "scripts" / "dependency_audit_report.py"

ADVISORY_FIX = (0, 11, 15)   # GHSA-4gg8-gxpx-9rph, the later of the two install-time fixes


def _required_version() -> str:
    m = re.search(r'^required-version = ">=([0-9.]+)"', UV_TOML.read_text(), re.M)
    assert m, "required-version not found in uv.toml — the primary gate is missing"
    return m.group(1)


def _audit_floor() -> str:
    m = re.search(r'^UV_MIN = "([0-9.]+)"', AUDIT.read_text(), re.M)
    assert m, f"UV_MIN not found in {AUDIT.name}"
    return m.group(1)


def test_floor_matches_between_uv_toml_and_the_audit_script() -> None:
    toml, audit = _required_version(), _audit_floor()
    assert toml == audit, (
        f"uv floor disagrees: uv.toml requires >={toml}, {AUDIT.name} checks {audit}. "
        "Bump both, or the audit script's `uv tool run` install path will keep "
        "accepting a uv that uv.toml rejects everywhere else."
    )


def test_floor_is_at_least_the_advisory_fix() -> None:
    """Lowering the floor past 0.11.15 reintroduces a known install-time
    vulnerability, so make that require deliberately editing a test."""
    floor = tuple(int(p) for p in _required_version().split("."))
    assert floor >= ADVISORY_FIX, f"uv floor {floor} is below the advisory fix {ADVISORY_FIX}"


def test_no_hand_rolled_version_gate_returned_to_setup_venv() -> None:
    """setup-venv.sh delegates to uv's own `required-version`.

    An earlier revision compared versions in shell and produced four separate
    defects (fail-open on an empty version, a pipefail abort that swallowed the
    diagnostic, an ignored exit code, and garbage misreported as a parse
    failure). uv does this correctly; this guards against reintroducing it.
    """
    text = (REPO_ROOT / "scripts" / "setup-venv.sh").read_text()
    assert "uv_older_than" not in text, (
        "setup-venv.sh has a hand-rolled uv version comparison again — "
        "uv.toml's required-version already enforces the floor for every uv command."
    )
