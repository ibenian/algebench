"""In-memory per-IP rate limiting for billable endpoints.

State lives in this worker process, which is correct for a single Render
instance. Scaling to multiple workers would require a shared store (Redis).
"""

import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


def client_ip(request: Request) -> str:
    """Best-effort client IP, honoring the proxy chain Render sits behind.

    Render terminates TLS at its edge and forwards the original client in
    ``X-Forwarded-For`` (first hop = original client). ``request.client.host``
    alone would be the proxy, collapsing every visitor into one bucket.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class SlidingWindowRateLimiter:
    """Per-key sliding-window limiter: at most ``max_requests`` per ``window`` seconds."""

    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_purge = 0.0

    def _purge(self, now: float) -> None:
        """Drop keys whose newest hit has aged out, bounding memory under many IPs."""
        cutoff = now - self.window
        stale = [k for k, q in self._hits.items() if not q or q[-1] < cutoff]
        for k in stale:
            del self._hits[k]
        self._last_purge = now

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window
        with self._lock:
            if now - self._last_purge > self.window:
                self._purge(now)
            q = self._hits[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max_requests:
                return False
            q.append(now)
            return True


def _parse_spec(spec: str, default_max: int, default_window: int) -> tuple[int, int]:
    """Parse a ``"count/seconds"`` spec; fall back to defaults on bad input."""
    try:
        count_s, window_s = spec.split("/", 1)
        return max(1, int(count_s)), max(1, int(window_s))
    except (ValueError, AttributeError):
        return default_max, default_window


def limiter_from_env(env_name: str, default_max: int, default_window: int) -> SlidingWindowRateLimiter:
    """Build a limiter, letting ``env_name`` (``"count/seconds"``) override defaults."""
    spec = os.environ.get(env_name, "")
    max_req, window = _parse_spec(spec, default_max, default_window) if spec else (default_max, default_window)
    return SlidingWindowRateLimiter(max_req, window)


def rate_limit_dependency(limiter: SlidingWindowRateLimiter):
    """FastAPI dependency that 429s when the caller's IP exceeds ``limiter``."""

    async def _dependency(request: Request) -> None:
        if not limiter.allow(client_ip(request)):
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please slow down and try again shortly.",
                headers={"Retry-After": str(int(limiter.window))},
            )

    return _dependency
