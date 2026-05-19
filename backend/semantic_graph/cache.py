"""Graph cache — thin wrapper around a dict with (latex, domain) composite keys."""

from __future__ import annotations

from typing import Any

_MISS = object()


class GraphCache:
    """Memoize parsed semantic graphs by (latex, domain) key."""

    def __init__(self) -> None:
        self._store: dict[str | tuple[str, str | None], dict | None] = {}

    def get(self, latex: str, domain: str | None = None) -> dict | None | Any:
        """Return the cached graph, or the *_MISS* sentinel if absent."""
        key = (latex, domain) if domain else latex
        return self._store.get(key, _MISS)

    def put(
        self,
        latex: str,
        domain: str | None,
        graph: dict | None,
    ) -> None:
        """Store *graph* under the (latex, domain) key."""
        key = (latex, domain) if domain else latex
        self._store[key] = graph

    def clear(self) -> None:
        """Drop all cached entries."""
        self._store.clear()

    def __len__(self) -> int:
        return len(self._store)

    def __contains__(self, key: object) -> bool:
        return key in self._store
