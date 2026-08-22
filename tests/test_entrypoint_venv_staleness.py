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


def _code_only(path: Path) -> str:
    """`path` with comment lines removed.

    Every assertion about *behaviour* must go through this. A substring search
    over the raw file is satisfied by the comment that explains the behaviour —
    which is exactly how two assertions in this file came to guard their own
    documentation instead of the code.
    """
    return "\n".join(
        line for line in path.read_text().splitlines()
        if not line.lstrip().startswith("#")
    )


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
    """The body of algebench's ensure_venv(), comments stripped.

    Comment-stripped for the same reason `_code_only` exists: this body carries
    a comment naming requirements.lock and setup-venv.sh to explain itself, so a
    substring search over the raw text is satisfied by the explanation alone.
    """
    src = _code_only(ALGEBENCH)
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
    # Comment-stripped: run.sh explains this behaviour in a comment that names
    # setup-venv.sh, which would satisfy a search over the raw file on its own.
    code = _code_only(RUN_SH)
    assert ".lock-stamp" in code, "run.sh lost its staleness check"
    assert "setup-venv.sh" in code, "run.sh must point at setup-venv.sh"


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
    code = _code_only(SETUP_VENV)
    assert 'CLEAR="--clear"' in code, (
        "setup-venv.sh must set CLEAR=--clear when replacing an incomplete venv "
        "(comments mentioning --clear do not count)"
    )
    # Both creation paths must actually receive it; asserting only on the
    # assignment would pass while the flag was never passed to anything.
    for cmd in ("uv venv", "python3 -m venv"):
        line = next((l for l in code.splitlines() if cmd in l and "$VENV" in l), None)
        assert line is not None, f"setup-venv.sh no longer creates a venv with `{cmd}`"
        assert "$CLEAR" in line, (
            f"`{cmd}` must be passed $CLEAR so an incomplete venv is replaced; "
            f"line is: {line.strip()}"
        )
    assert "rm -rf" not in code, (
        "setup-venv.sh should not rm -rf a venv directory; use --clear"
    )


def test_neither_entrypoint_manages_dependencies():
    """Updating dependencies is uv's job, driven by the update-glt skill.

    The launcher used to carry an --update flag that bumped gemini-live-tools
    *and* relocked every other pin — a second, divergent implementation of what
    README documents as a plain uv command, and one that could leave a bumped
    requirements.txt against an unchanged lock when uv was missing. Provisioning
    (install what the lock says) stays; resolution (decide what the lock says)
    does not belong in an entrypoint.
    """
    for path in (ALGEBENCH, RUN_SH):
        code = _code_only(path)
        assert "uv pip compile" not in code, (
            f"{path.name} resolves dependencies; that belongs to uv, driven by "
            f"the update-glt skill"
        )
        assert "--update" not in code, (
            f"{path.name} has an update flag again; dependency updates go "
            f"through the update-glt skill"
        )
