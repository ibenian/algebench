"""Tests for per-IP rate limiting (backend/util/ratelimit.py)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.util.ratelimit import (
    SlidingWindowRateLimiter,
    _parse_spec,
    client_ip,
    limiter_from_env,
)


class TestSlidingWindow:
    def test_allows_up_to_limit_then_denies(self):
        rl = SlidingWindowRateLimiter(max_requests=3, window_seconds=60)
        assert [rl.allow("ip") for _ in range(4)] == [True, True, True, False]

    def test_window_expiry_allows_again(self):
        # monotonic() values are supplied by a fake clock so we don't sleep.
        clock = [1000.0]
        rl = SlidingWindowRateLimiter(max_requests=2, window_seconds=10)
        import backend.util.ratelimit as mod

        orig = mod.time.monotonic
        mod.time.monotonic = lambda: clock[0]
        try:
            assert rl.allow("ip") is True
            assert rl.allow("ip") is True
            assert rl.allow("ip") is False          # at limit
            clock[0] += 11                            # whole window elapses
            assert rl.allow("ip") is True             # bucket reset
        finally:
            mod.time.monotonic = orig

    def test_per_key_isolation(self):
        rl = SlidingWindowRateLimiter(max_requests=1, window_seconds=60)
        assert rl.allow("a") is True
        assert rl.allow("b") is True                  # different key, own bucket
        assert rl.allow("a") is False                 # a is now over its limit

    def test_purge_drops_stale_keys(self):
        clock = [1000.0]
        rl = SlidingWindowRateLimiter(max_requests=5, window_seconds=10)
        import backend.util.ratelimit as mod

        orig = mod.time.monotonic
        mod.time.monotonic = lambda: clock[0]
        try:
            rl.allow("old")
            assert "old" in rl._hits
            clock[0] += 100                           # well past window + purge interval
            rl.allow("new")                           # triggers a purge pass
            assert "old" not in rl._hits
            assert "new" in rl._hits
        finally:
            mod.time.monotonic = orig


class TestParseSpec:
    def test_valid_spec(self):
        assert _parse_spec("5/30", 20, 60) == (5, 30)

    def test_bad_spec_falls_back(self):
        assert _parse_spec("garbage", 20, 60) == (20, 60)
        assert _parse_spec("5", 20, 60) == (20, 60)
        assert _parse_spec("", 20, 60) == (20, 60)

    def test_clamps_to_minimum_one(self):
        assert _parse_spec("0/0", 20, 60) == (1, 1)


class TestLimiterFromEnv:
    def test_uses_default_when_unset(self, monkeypatch):
        monkeypatch.delenv("ALGEBENCH_RATELIMIT_TEST", raising=False)
        rl = limiter_from_env("ALGEBENCH_RATELIMIT_TEST", 20, 60)
        assert (rl.max_requests, rl.window) == (20, 60)

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("ALGEBENCH_RATELIMIT_TEST", "7/15")
        rl = limiter_from_env("ALGEBENCH_RATELIMIT_TEST", 20, 60)
        assert (rl.max_requests, rl.window) == (7, 15)


class TestClientIp:
    class _Req:
        def __init__(self, headers, client_host="2.2.2.2"):
            self.headers = headers
            self.client = type("C", (), {"host": client_host})()

    def test_forwarded_for_first_hop(self):
        req = self._Req({"x-forwarded-for": "1.1.1.1, 10.0.0.1, 10.0.0.2"})
        assert client_ip(req) == "1.1.1.1"

    def test_falls_back_to_client_host(self):
        req = self._Req({})
        assert client_ip(req) == "2.2.2.2"
