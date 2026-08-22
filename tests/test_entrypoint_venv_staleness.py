"""Both entrypoints must notice a stale .venv.

`./algebench` and `./run.sh` have now diverged on venv handling twice — first
when the requirements.lock change landed in one and not the other, then again
when provisioning moved to scripts/setup-venv.sh and `algebench` was wired
straight to it, bypassing the staleness check that had been added to `run.sh`.
Both times a comment said "shared with run.sh" while the behaviour was not.

Comments plainly do not hold this invariant, so these tests do. They read the
scripts rather than executing them: running `./algebench` execs a server, and
running `setup-venv.sh` for real would reinstall 110 packages.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALGEBENCH = ROOT / "algebench"
RUN_SH = ROOT / "run.sh"


def _ensure_venv_body() -> str:
    """The body of algebench's ensure_venv()."""
    src = ALGEBENCH.read_text()
    m = re.search(r"ensure_venv\(\)\s*\{(.*?)\n\}", src, re.S)
    assert m, "algebench no longer defines ensure_venv() — update this test"
    return m.group(1)


def test_algebench_compares_the_lock_against_the_stamp():
    """Existence of the interpreter is not enough to call a venv current.

    Regression: `[ -x "$VENV/bin/python3" ] || setup-venv.sh` short-circuits on
    an existing venv, so a lock pulled from git was silently ignored and the
    server started on stale dependencies.
    """
    body = _ensure_venv_body()
    assert "requirements.lock" in body, (
        "ensure_venv() must compare against requirements.lock, not just check "
        "that the interpreter exists"
    )
    assert ".lock-stamp" in body, (
        "ensure_venv() must compare the lock against .venv/.lock-stamp"
    )


def test_algebench_reinstalls_rather_than_only_warning():
    """This entrypoint execs the server, so nothing downstream can catch it."""
    body = _ensure_venv_body()
    assert "setup-venv.sh" in body, (
        "ensure_venv() must invoke setup-venv.sh when the venv is stale — "
        "warning is not enough here, unlike run.sh"
    )


def test_run_sh_still_warns_about_a_stale_venv():
    """run.sh warns rather than installs; both behaviours are deliberate."""
    src = RUN_SH.read_text()
    assert ".lock-stamp" in src, "run.sh lost its staleness check"
    assert "setup-venv.sh" in src, "run.sh must point at setup-venv.sh"


def test_neither_entrypoint_provisions_the_venv_itself():
    """Provisioning lives in setup-venv.sh alone — one implementation.

    A second copy is how the two drifted apart in the first place.
    """
    for path in (ALGEBENCH, RUN_SH):
        src = path.read_text()
        assert "uv venv" not in src, (
            f"{path.name} creates a venv itself; that belongs to setup-venv.sh"
        )
        assert "python3 -m venv" not in src, (
            f"{path.name} creates a venv itself; that belongs to setup-venv.sh"
        )
