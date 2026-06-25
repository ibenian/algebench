"""Tests for the version helper (`scripts/version.py`) and the server's
`get_app_version()` validation.

The version helper is the release/deploy tooling's single source of version
parsing/bumping logic, and its value is injected verbatim into ``index.html`` —
so both the pure functions and the strict server-side validation are guarded
here against regressions.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts import version as ver


# ---- parse / format ----

@pytest.mark.parametrize("text,expected", [
    ("0.10.0", (0, 10, 0)),
    ("v0.10.0", (0, 10, 0)),      # optional leading v
    ("  1.2.3 ", (1, 2, 3)),       # surrounding whitespace
    ("12.34.56", (12, 34, 56)),
])
def test_parse_version_ok(text, expected):
    assert ver.parse_version(text) == expected


@pytest.mark.parametrize("bad", ["", "1.2", "1.2.3.4", "x.y.z", "1.2.3-rc1", "v", "1..3"])
def test_parse_version_rejects_garbage(bad):
    with pytest.raises(ValueError):
        ver.parse_version(bad)


def test_format_version():
    assert ver.format_version((0, 11, 0)) == "0.11.0"


# ---- bump ----

@pytest.mark.parametrize("cur,level,expected", [
    ("0.10.0", "patch", "0.10.1"),
    ("0.10.0", "minor", "0.11.0"),
    ("0.10.5", "minor", "0.11.0"),   # minor resets patch
    ("0.10.5", "major", "1.0.0"),    # major resets minor + patch
    ("v0.9.0", "minor", "0.10.0"),   # tolerates leading v
])
def test_bump(cur, level, expected):
    assert ver.bump(cur, level) == expected


def test_bump_unknown_level():
    with pytest.raises(ValueError):
        ver.bump("0.1.0", "huge")


# ---- read / write (round-trip via a temp file) ----

def test_read_write_roundtrip(tmp_path, monkeypatch):
    f = tmp_path / "VERSION"
    monkeypatch.setattr(ver, "VERSION_FILE", f)
    assert ver.write_version("v2.3.4") == "2.3.4"   # normalizes (drops v)
    assert f.read_text().strip() == "2.3.4"
    assert ver.read_version() == "2.3.4"


def test_write_version_rejects_garbage(tmp_path, monkeypatch):
    monkeypatch.setattr(ver, "VERSION_FILE", tmp_path / "VERSION")
    with pytest.raises(ValueError):
        ver.write_version("not-a-version")


def test_read_version_missing_file(tmp_path, monkeypatch):
    monkeypatch.setattr(ver, "VERSION_FILE", tmp_path / "nope")
    with pytest.raises(FileNotFoundError):
        ver.read_version()


# ---- CLI ----

def test_cli_get(tmp_path, monkeypatch, capsys):
    f = tmp_path / "VERSION"
    f.write_text("0.10.0\n")
    monkeypatch.setattr(ver, "VERSION_FILE", f)
    assert ver.main(["--get"]) == 0
    assert capsys.readouterr().out.strip() == "0.10.0"


def test_cli_next_does_not_write(tmp_path, monkeypatch, capsys):
    f = tmp_path / "VERSION"
    f.write_text("0.10.0\n")
    monkeypatch.setattr(ver, "VERSION_FILE", f)
    assert ver.main(["--next", "minor"]) == 0
    assert capsys.readouterr().out.strip() == "0.11.0"
    assert f.read_text().strip() == "0.10.0"   # unchanged


def test_cli_next_from_base(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(ver, "VERSION_FILE", tmp_path / "VERSION")
    assert ver.main(["--next", "minor", "--from", "0.9.0"]) == 0
    assert capsys.readouterr().out.strip() == "0.10.0"


def test_cli_bump_writes(tmp_path, monkeypatch, capsys):
    f = tmp_path / "VERSION"
    f.write_text("0.10.0\n")
    monkeypatch.setattr(ver, "VERSION_FILE", f)
    assert ver.main(["--bump", "minor"]) == 0
    assert capsys.readouterr().out.strip() == "0.11.0"
    assert f.read_text().strip() == "0.11.0"


def test_cli_set_invalid_returns_error(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(ver, "VERSION_FILE", tmp_path / "VERSION")
    assert ver.main(["--set", "bogus"]) == 1
    assert "error" in capsys.readouterr().err.lower()


# ---- server-side validation (get_app_version) ----

def test_get_app_version_valid(tmp_path, monkeypatch):
    from backend import server
    f = tmp_path / "VERSION"
    f.write_text("0.10.0\n")
    monkeypatch.setattr(server, "version_file_path", f)
    assert server.get_app_version() == "0.10.0"


def test_get_app_version_strips_leading_v(tmp_path, monkeypatch):
    from backend import server
    f = tmp_path / "VERSION"
    f.write_text("v0.10.0\n")
    monkeypatch.setattr(server, "version_file_path", f)
    assert server.get_app_version() == "0.10.0"


@pytest.mark.parametrize("bad", ['0.10.0"><script>', "garbage", "1.2", ""])
def test_get_app_version_falls_back_on_bad_input(tmp_path, monkeypatch, bad):
    from backend import server
    f = tmp_path / "VERSION"
    f.write_text(bad)
    monkeypatch.setattr(server, "version_file_path", f)
    assert server.get_app_version() == "dev"


def test_get_app_version_missing_file(tmp_path, monkeypatch):
    from backend import server
    monkeypatch.setattr(server, "version_file_path", tmp_path / "nope")
    assert server.get_app_version() == "dev"
