"""Path sanitization utilities for safe file serving."""

import os
from pathlib import Path


def sanitize_path(root: Path, filename: str) -> Path | None:
    """Confine *filename* under *root*; return the resolved Path or None.

    Validates that the resolved path stays within the allowed directory
    root, preventing path traversal attacks.  Handles absolute paths
    already under root, relative paths with ``..`` components, symlink
    escapes, and null-byte injection.
    """
    if '\x00' in filename:
        return None
    resolved_root = root.resolve()
    resolved = Path(filename).resolve()
    if resolved.is_relative_to(resolved_root):
        safe = resolved_root / resolved.relative_to(resolved_root)
        return safe
    normalized = os.path.normpath(filename)
    if os.path.isabs(normalized) or normalized.split(os.sep)[0] == '..':
        return None
    path = (resolved_root / normalized).resolve()
    if not path.is_relative_to(resolved_root):
        return None
    return path
