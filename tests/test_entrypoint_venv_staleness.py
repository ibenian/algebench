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
SETUP_VENV = ROOT / "scripts" / "setup-venv.sh"


def _setup_venv_gate() -> str:
    """The `if ...; then` line that decides whether setup-venv.sh creates a venv.

    Asserting on this rather than on whole-file text matters: the comment above
    the condition necessarily names bin/python3 and bin/pip to explain itself,
    and `$VENV/bin/pip` appears again where the script actually installs. Both
    would satisfy a substring search over the file while the real gate said
    something else entirely.
    """
    src = SETUP_VENV.read_text()
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith("if [") and "$VENV" in stripped:
            return stripped
    raise AssertionError("no venv-gating `if` found in setup-venv.sh")


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


def test_setup_venv_keys_creation_on_the_interpreter_not_the_directory():
    """A directory is not a usable venv.

    Regression: `[ ! -d "$VENV" ]` skipped creation whenever .venv/ existed, so
    an interrupted setup — directory present, bin/ empty — fell through to
    `$VENV/bin/pip install` and died on a raw "no such file".

    Third instance of this shape in these scripts: algebench once used "python3
    exists" to mean "venv matches the lock", and setup-venv.sh used "directory
    exists" to mean "venv is usable".
    """
    gate = _setup_venv_gate()
    assert "bin/python3" in gate, (
        f"setup-venv.sh must gate creation on the interpreter existing; gate is: {gate}"
    )
    assert "bin/pip" in gate, (
        f"setup-venv.sh must gate creation on pip existing — the install step "
        f"needs it; gate is: {gate}"
    )


def test_setup_venv_replaces_an_incomplete_venv_without_rm_rf():
    """Recreation goes through each tool's --clear, not a hand-rolled delete."""
    src = SETUP_VENV.read_text()
    assert "--clear" in src, "setup-venv.sh must use --clear to replace an incomplete venv"
    code = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
    assert "rm -rf" not in code, (
        "setup-venv.sh should not rm -rf a venv directory; use --clear"
    )


def test_algebench_update_checks_for_uv_before_using_it():
    """--update cannot fall back (pip cannot build a universal lock), so it must explain."""
    src = ALGEBENCH.read_text()
    update = src[src.index('if [ "$1" = "--update" ]'):]
    assert "command -v uv" in update, (
        "--update must check for uv and explain, not emit 'command not found'"
    )
