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


# ── Behaviour, not just constants ────────────────────────────────────────────
#
# The tests above compare literals and assert a helper name is absent. That is
# not enough on its own: a regression could drop `--exclude-newer` from a uv
# call, or skip the fail-closed version guard entirely, and every one of them
# would still pass — reintroducing exactly the install-time exposure this floor
# exists to prevent. These exercise the behaviour instead.

import sys  # noqa: E402
from unittest import mock  # noqa: E402

import pytest  # noqa: E402

sys.path.insert(0, str(REPO_ROOT / "scripts"))
import dependency_audit_report as audit  # noqa: E402


def _completed(stdout: str = "", returncode: int = 0):
    return mock.Mock(stdout=stdout, stderr="", returncode=returncode)


@pytest.mark.parametrize(
    "stdout,returncode,why",
    [
        ("uv 0.10.12\n", 0, "below the floor"),
        ("", 0, "no version in the output"),
        ("uv 0.11.15\n", 1, "nonzero exit, even though the output looks like a version"),
        ("uv garbage\n", 0, "unparseable version"),
    ],
)
def test_require_uv_refuses_anything_it_cannot_vouch_for(stdout, returncode, why) -> None:
    with mock.patch.object(audit.subprocess, "run", return_value=_completed(stdout, returncode)):
        with pytest.raises(SystemExit) as exc:
            audit._require_uv()
    assert "uv" in str(exc.value).lower(), why


def test_require_uv_refuses_when_uv_is_not_installed() -> None:
    """`uv self update` is useless advice here, so the message must differ."""
    with mock.patch.object(audit.subprocess, "run", side_effect=OSError("no such file")):
        with pytest.raises(SystemExit) as exc:
            audit._require_uv()
    assert "self update" not in str(exc.value), "do not tell the user to update a uv they do not have"


def test_require_uv_accepts_a_version_at_or_above_the_floor() -> None:
    for version in ("0.11.15", "0.11.32", "1.0.0"):
        with mock.patch.object(audit.subprocess, "run", return_value=_completed(f"uv {version}\n")):
            audit._require_uv()   # must not raise


def _uv_argv(monkeypatch, apply_cooldown: bool) -> list[str]:
    """Capture the argv `resolve()` hands to uv, without running it."""
    seen: list[str] = []

    def fake_run(cmd, **kw):
        seen.extend(cmd)
        return _completed()

    monkeypatch.setattr(audit.subprocess, "run", fake_run)
    monkeypatch.setattr(Path, "write_text", lambda self, *a, **k: None)
    monkeypatch.setattr(Path, "read_text", lambda self, *a, **k: "")
    audit.resolve(Path("lock"), Path("out"), apply_cooldown=apply_cooldown)
    return seen


def test_cooldown_resolution_passes_the_configured_cutoff(monkeypatch) -> None:
    argv = _uv_argv(monkeypatch, apply_cooldown=True)
    assert "--exclude-newer" in argv, "the cooldown column must be resolved with an explicit cutoff"
    assert argv[argv.index("--exclude-newer") + 1] == audit.cutoff()


def test_no_cooldown_resolution_passes_an_explicit_zero(monkeypatch) -> None:
    """Not merely 'no flag': omitting it would let an inherited
    UV_EXCLUDE_NEWER decide, making the two columns depend on the caller."""
    argv = _uv_argv(monkeypatch, apply_cooldown=False)
    assert "--exclude-newer" in argv
    assert argv[argv.index("--exclude-newer") + 1] == "0 days"


def test_cutoff_refuses_an_unreadable_uv_toml(monkeypatch) -> None:
    """A silently dropped cooldown would make the report claim the opposite of
    the policy it exists to check."""
    monkeypatch.setattr(audit, "UV_TOML", REPO_ROOT / "does-not-exist.toml")
    with pytest.raises(SystemExit):
        audit.cutoff()
    assert "unknown" in audit.cooldown(), "the heading must still render something"
