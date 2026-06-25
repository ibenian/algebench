#!/usr/bin/env python3
"""Read and write the AlgeBench version.

The single source of truth for the application version is the ``VERSION`` file
at the repository root — a plain text file holding a semantic version like
``0.10.0`` (no leading ``v``). The running app reads it (see
``backend/server.py``) and the release skill (`algebench-release`) reads/bumps
it when cutting a release.

Usage:
    ./run.sh scripts/version.py                       # print current version
    ./run.sh scripts/version.py --get                 # print current version
    ./run.sh scripts/version.py --set 0.11.0          # write an explicit version
    ./run.sh scripts/version.py --bump minor          # bump + write, print new
    ./run.sh scripts/version.py --next minor          # print next, do NOT write
    ./run.sh scripts/version.py --next minor --from 0.9.0   # next relative to a given base

Bump levels: ``major`` | ``minor`` | ``patch``.

Exit codes:
    0  success
    1  invalid version string or arguments
"""

import argparse
import re
import sys
from pathlib import Path

VERSION_FILE = Path(__file__).resolve().parent.parent / "VERSION"

_SEMVER_RE = re.compile(r"^\s*v?(\d+)\.(\d+)\.(\d+)\s*$")


def parse_version(text: str) -> tuple[int, int, int]:
    """Parse ``MAJOR.MINOR.PATCH`` (optional leading ``v``) into a tuple."""
    m = _SEMVER_RE.match(text or "")
    if not m:
        raise ValueError(f"not a semantic version: {text!r}")
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def format_version(parts: tuple[int, int, int]) -> str:
    return f"{parts[0]}.{parts[1]}.{parts[2]}"


def bump(version: str, level: str) -> str:
    """Return the next version after bumping ``level`` (major/minor/patch)."""
    major, minor, patch = parse_version(version)
    if level == "major":
        return format_version((major + 1, 0, 0))
    if level == "minor":
        return format_version((major, minor + 1, 0))
    if level == "patch":
        return format_version((major, minor, patch + 1))
    raise ValueError(f"unknown bump level: {level!r} (use major|minor|patch)")


def read_version() -> str:
    """Read and validate the current version from the VERSION file."""
    if not VERSION_FILE.is_file():
        raise FileNotFoundError(f"VERSION file not found at {VERSION_FILE}")
    text = VERSION_FILE.read_text(encoding="utf-8").strip()
    return format_version(parse_version(text))


def write_version(version: str) -> str:
    """Validate and write a version to the VERSION file. Returns the value written."""
    normalized = format_version(parse_version(version))
    VERSION_FILE.write_text(normalized + "\n", encoding="utf-8")
    return normalized


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Read and write the AlgeBench version.")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--get", action="store_true", help="print the current version (default)")
    g.add_argument("--set", metavar="VERSION", help="write an explicit version")
    g.add_argument("--bump", choices=["major", "minor", "patch"], help="bump + write, print new")
    g.add_argument("--next", dest="next_level", choices=["major", "minor", "patch"],
                   help="print the next version without writing")
    p.add_argument("--from", dest="base", metavar="VERSION",
                   help="base version for --next (default: current VERSION file)")
    args = p.parse_args(argv)

    try:
        if args.set is not None:
            print(write_version(args.set))
        elif args.bump is not None:
            print(write_version(bump(read_version(), args.bump)))
        elif args.next_level is not None:
            base = args.base if args.base is not None else read_version()
            print(bump(base, args.next_level))
        else:  # --get or no flag
            print(read_version())
    except (ValueError, FileNotFoundError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
