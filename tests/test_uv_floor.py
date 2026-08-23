"""The minimum uv version is declared twice; keep the copies equal.

`scripts/setup-venv.sh` gates environment creation, and
`scripts/dependency_audit_report.py` gates its own uv/uvx subprocesses — the
audit script is documented, run directly and from CI, and `run.sh` only checks
that a `.venv` exists, so setup-venv.sh is not on that path. Both therefore need
the floor, and neither can read the other cheaply: setup-venv.sh runs before the
venv exists, so it cannot import Python.

Duplication is the pragmatic answer; this test is what stops it drifting when
someone bumps the floor for the next advisory and updates only one file.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
SETUP_VENV = REPO_ROOT / "scripts" / "setup-venv.sh"
AUDIT = REPO_ROOT / "scripts" / "dependency_audit_report.py"


def _shell_const(name: str) -> str:
    m = re.search(rf'^{name}="([^"]+)"', SETUP_VENV.read_text(), re.M)
    assert m, f"{name} not found in {SETUP_VENV.name}"
    return m.group(1)


def _python_const(name: str) -> str:
    m = re.search(rf'^{name} = "([^"]+)"', AUDIT.read_text(), re.M)
    assert m, f"{name} not found in {AUDIT.name}"
    return m.group(1)


def test_uv_floor_matches_across_shell_and_python() -> None:
    shell, python = _shell_const("UV_MIN"), _python_const("UV_MIN")
    assert shell == python, (
        f"UV_MIN disagrees: {SETUP_VENV.name} says {shell!r}, {AUDIT.name} says {python!r}. "
        "Bump both, or the audit script will keep running uv below the floor "
        "setup-venv.sh enforces."
    )


def test_uv_floor_is_at_least_the_advisory_fix() -> None:
    """0.11.15 fixes GHSA-4gg8-gxpx-9rph (arbitrary file write via entry point
    names), the later of the two install-time advisories. Lowering the floor past
    it reintroduces a known vulnerability, so make that require editing a test."""
    floor = tuple(int(p) for p in _shell_const("UV_MIN").split("."))
    assert floor >= (0, 11, 15), f"UV_MIN {floor} is below the advisory fix (0, 11, 15)"


def test_duration_floor_is_below_the_security_floor() -> None:
    """UV_DURATION_MIN only explains WHY a very old uv fails; it must stay below
    UV_MIN or the explanatory branch in setup-venv.sh becomes unreachable."""
    dur = tuple(int(p) for p in _shell_const("UV_DURATION_MIN").split("."))
    floor = tuple(int(p) for p in _shell_const("UV_MIN").split("."))
    assert dur < floor, f"UV_DURATION_MIN {dur} must be below UV_MIN {floor}"
