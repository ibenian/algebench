"""Path sanitization utilities for safe file serving."""

import re
from pathlib import Path

# Charset floor for every filename routed through sanitize_path. This is an
# early-reject hygiene gate, NOT the traversal defense: it still permits "."
# and "/", so "../foo" passes the regex — confinement is enforced solely by
# resolve() + is_relative_to below. Its job is to bounce exotic input (spaces,
# unicode, shell/encoding tricks, control bytes). Note it also rejects "~"
# (not in the set), but sanitize_path checks "~" explicitly too so the
# guarantee does not silently depend on the charset. All served assets
# (scenes, objects, graph-panel, domains, js) conform to this charset.
_SAFE_CHARS = re.compile(r"[A-Za-z0-9_.\-/]+")


def sanitize_path(root: Path, filename: str) -> Path | None:
    """Confine *filename* under *root*; return the resolved Path or None.

    *filename* must be a relative path. Every rejection that applies to
    untrusted input lives here so callers never re-implement it:

      * empty / null byte / characters outside ``[A-Za-z0-9_.\\-/]`` — hygiene;
      * ``~`` prefix — never expand a home directory;
      * absolute paths — untrusted input addresses files by relative name only;
      * ``..`` traversal and symlink escapes — defeated by the confinement below.

    The traversal defense is ``(root / filename).resolve()`` followed by
    ``is_relative_to(root)``: ``resolve()`` collapses ``..`` and follows
    symlinks, and ``is_relative_to`` then rejects anything that escaped the
    root. Callers needing a stricter, object-specific shape (e.g. a single
    path segment, or a fixed suffix) layer that on top.

    Trusted, internally-generated absolute paths (e.g. CLI args, or a path the
    caller already confined via this function) must NOT be routed back through
    here — load them directly.
    """
    if not filename or '\x00' in filename:
        return None
    if filename.startswith('~'):
        return None
    if not _SAFE_CHARS.fullmatch(filename):
        return None
    if Path(filename).is_absolute():
        return None
    root = root.resolve()
    try:
        path = (root / filename).resolve()
        if not path.is_relative_to(root):
            return None
        return path
    except (OSError, RuntimeError):
        return None
