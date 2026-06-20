"""Tests for the killable, process-isolated CAS guard (issue #386).

Covers configuration parsing, the three isolation modes, and — the heart of the
issue — that a non-terminating CPU-bound call is actually *stopped* (worker
killed, core reclaimed) rather than left burning, with the client timeout
decoupled from the kill/recycle.
"""

from __future__ import annotations

import multiprocessing as mp
import os
import time

import pytest

from backend.experts.modules.proof_completion import cas_guard
from tests.backend.experts import cas_workers as W


# --------------------------------------------------------------------------- #
# fixtures
# --------------------------------------------------------------------------- #


@pytest.fixture(autouse=True)
def _clean_guard():
    """Each test starts and ends with a fresh, torn-down guard.

    The guard refuses callables that aren't on its allow-list, so the test
    helpers are registered here (registration persists; that's fine).
    """
    for fn in (W.inc, W.echo, W.boom, W.sleep_then, W.spin, W.spin_ignoring_sigterm):
        cas_guard.register(fn)
    cas_guard._reset_for_tests()
    yield
    cas_guard._reset_for_tests()


def _our_workers():
    return [c for c in mp.active_children() if c.name == "cas-worker"]


def _wait_until(pred, timeout=5.0, interval=0.02):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pred():
            return True
        time.sleep(interval)
    return pred()


# --------------------------------------------------------------------------- #
# configuration
# --------------------------------------------------------------------------- #


def test_config_defaults(monkeypatch):
    for var in ("ALGEBENCH_CAS_ISOLATION", "ALGEBENCH_CAS_CLIENT_TIMEOUT",
                "ALGEBENCH_VERIFY_TIMEOUT", "ALGEBENCH_CAS_POOL_SIZE",
                "ALGEBENCH_CAS_GRACEFUL_TIMEOUT", "ALGEBENCH_CAS_MAX_CALLS"):
        monkeypatch.delenv(var, raising=False)
    cfg = cas_guard.CasConfig.from_env()
    assert cfg.isolation == "process"
    assert cfg.client_timeout == 2.0          # default
    assert cfg.pool_size >= 1
    assert cfg.start_method in mp.get_all_start_methods()


def test_config_verify_timeout_backcompat(monkeypatch):
    monkeypatch.setenv("ALGEBENCH_VERIFY_TIMEOUT", "5.0")
    monkeypatch.delenv("ALGEBENCH_CAS_CLIENT_TIMEOUT", raising=False)
    assert cas_guard.CasConfig.from_env().client_timeout == 5.0


def test_config_client_timeout_overrides_legacy(monkeypatch):
    monkeypatch.setenv("ALGEBENCH_VERIFY_TIMEOUT", "5.0")
    monkeypatch.setenv("ALGEBENCH_CAS_CLIENT_TIMEOUT", "0.5")
    assert cas_guard.CasConfig.from_env().client_timeout == 0.5


def test_config_invalid_values_fall_back(monkeypatch):
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "bogus")
    monkeypatch.setenv("ALGEBENCH_CAS_POOL_SIZE", "not-an-int")
    monkeypatch.setenv("ALGEBENCH_CAS_CLIENT_TIMEOUT", "nope")
    monkeypatch.setenv("ALGEBENCH_CAS_START_METHOD", "bogus")
    cfg = cas_guard.CasConfig.from_env()
    assert cfg.isolation == "process"         # invalid -> default
    assert cfg.pool_size >= 1
    assert cfg.client_timeout == 2.0
    assert cfg.start_method in mp.get_all_start_methods()


# --------------------------------------------------------------------------- #
# inline mode
# --------------------------------------------------------------------------- #


def test_inline_runs_and_swallows_errors(monkeypatch):
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "inline")
    cas_guard._reset_for_tests()
    assert cas_guard.guard(W.inc, 41) == 42
    assert cas_guard.guard(W.boom, default="D") == "D"


def test_guard_refuses_unregistered_callable(monkeypatch, caplog):
    """An op not on the allow-list is refused (defense in depth), not executed."""
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "inline")
    cas_guard._reset_for_tests()
    ran = {"hit": False}

    def _rogue():
        ran["hit"] = True
        return "ran"

    with caplog.at_level("ERROR"):
        assert cas_guard.guard(_rogue, default="REFUSED") == "REFUSED"
    assert ran["hit"] is False
    assert "allow-list" in caplog.text


# --------------------------------------------------------------------------- #
# thread mode
# --------------------------------------------------------------------------- #


def test_thread_bounds_wait(monkeypatch):
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "thread")
    cas_guard._reset_for_tests()
    assert cas_guard.guard(W.inc, 10) == 11
    t0 = time.monotonic()
    out = cas_guard.guard(W.sleep_then, 5, "x", default="D", timeout=0.3)
    assert out == "D"
    assert time.monotonic() - t0 < 2.0        # gave up on the wait quickly


# --------------------------------------------------------------------------- #
# process mode — correctness
# --------------------------------------------------------------------------- #


def test_process_runs_picklable(monkeypatch):
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "process")
    monkeypatch.setenv("ALGEBENCH_CAS_POOL_SIZE", "2")
    cas_guard._reset_for_tests()
    assert cas_guard.guard(W.inc, 41) == 42
    assert cas_guard.guard(W.echo, "hi") == "hi"


def test_process_roundtrips_sympy(monkeypatch):
    import sympy as sp
    from backend.experts.modules.proof_completion.grounding import sympy_equiv

    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "process")
    cas_guard._reset_for_tests()
    x = sp.Symbol("x")
    assert cas_guard.guard(sympy_equiv, x + 1, 1 + x, default=False) is True
    assert cas_guard.guard(sympy_equiv, x + 1, x + 2, default=False) is False


def test_process_error_returns_default_keeps_worker(monkeypatch):
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "process")
    monkeypatch.setenv("ALGEBENCH_CAS_POOL_SIZE", "1")
    cas_guard._reset_for_tests()
    assert cas_guard.guard(W.boom, default="D") == "D"
    # a raised exception is a clean "no result" — the worker is reused, not killed
    assert cas_guard.guard(W.inc, 7) == 8
    assert len(_our_workers()) == 1


# --------------------------------------------------------------------------- #
# process mode — the killable guarantee (issue #386 acceptance criteria)
# --------------------------------------------------------------------------- #


def test_process_kills_nonterminating_and_reclaims(monkeypatch):
    """A non-terminating CPU-bound call is stopped and its worker reaped."""
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "process")
    monkeypatch.setenv("ALGEBENCH_CAS_POOL_SIZE", "1")
    monkeypatch.setenv("ALGEBENCH_CAS_CLIENT_TIMEOUT", "0.5")
    monkeypatch.setenv("ALGEBENCH_CAS_GRACEFUL_TIMEOUT", "0.5")
    cas_guard._reset_for_tests()

    cas_guard.warm_up()                        # exclude cold-spawn warm-up cost
    t0 = time.monotonic()
    out = cas_guard.guard(W.spin, default="GAVE_UP")
    elapsed = time.monotonic() - t0
    assert out == "GAVE_UP"
    assert elapsed < 2.0                       # client gave up ~ client_timeout

    # the runaway worker must not survive — no lingering core-burner
    assert _wait_until(lambda: len(_our_workers()) == 0), "worker was not reaped"

    # pool self-heals: a fresh worker serves the next call correctly
    assert cas_guard.guard(W.inc, 100) == 101


def test_client_timeout_separate_from_recovery(monkeypatch):
    """The caller returns at the client timeout even when the kill grace is long."""
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "process")
    monkeypatch.setenv("ALGEBENCH_CAS_POOL_SIZE", "1")
    monkeypatch.setenv("ALGEBENCH_CAS_CLIENT_TIMEOUT", "0.4")
    monkeypatch.setenv("ALGEBENCH_CAS_GRACEFUL_TIMEOUT", "3.0")  # long on purpose
    cas_guard._reset_for_tests()

    cas_guard.warm_up()                        # exclude cold-spawn warm-up cost
    t0 = time.monotonic()
    out = cas_guard.guard(W.spin, default="GAVE_UP")
    elapsed = time.monotonic() - t0
    assert out == "GAVE_UP"
    # client timeout (0.4) decoupled from the 3.0s graceful window: returns fast
    assert elapsed < 1.5


def test_graceful_sigterm_path(monkeypatch, caplog):
    """A SIGTERM-interruptible worker exits without escalating to SIGKILL."""
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "process")
    monkeypatch.setenv("ALGEBENCH_CAS_POOL_SIZE", "1")
    monkeypatch.setenv("ALGEBENCH_CAS_CLIENT_TIMEOUT", "0.4")
    monkeypatch.setenv("ALGEBENCH_CAS_GRACEFUL_TIMEOUT", "2.0")
    cas_guard._reset_for_tests()
    with caplog.at_level("WARNING"):
        assert cas_guard.guard(W.spin, default="D") == "D"
        assert _wait_until(lambda: len(_our_workers()) == 0)
    assert "SIGKILL" not in caplog.text       # graceful unwind sufficed


def test_hard_sigkill_path(monkeypatch, caplog):
    """A worker that ignores SIGTERM is force-killed; the core is still reclaimed."""
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "process")
    monkeypatch.setenv("ALGEBENCH_CAS_POOL_SIZE", "1")
    monkeypatch.setenv("ALGEBENCH_CAS_CLIENT_TIMEOUT", "0.4")
    monkeypatch.setenv("ALGEBENCH_CAS_GRACEFUL_TIMEOUT", "0.3")
    cas_guard._reset_for_tests()
    with caplog.at_level("WARNING"):
        assert cas_guard.guard(W.spin_ignoring_sigterm, default="D") == "D"
        assert _wait_until(lambda: len(_our_workers()) == 0), "not force-killed"
    assert "SIGKILL" in caplog.text
    assert cas_guard._WORKER_EMOJI in caplog.text   # tagged as a child-process event


def test_worker_logging_is_tagged():
    """Worker child output is prefixed with the child emoji + its pid."""
    import logging
    root = logging.getLogger()
    saved, saved_level = root.handlers[:], root.level
    try:
        cas_guard._install_worker_logging()
        fmt = logging.getLogger().handlers[0].formatter._fmt
        assert cas_guard._WORKER_EMOJI in fmt
        assert "cas-worker[" in fmt
        assert str(os.getpid()) in fmt
    finally:
        root.handlers[:] = saved
        root.setLevel(saved_level)
        logging.captureWarnings(False)


# --------------------------------------------------------------------------- #
# process mode — recycling, saturation, concurrency
# --------------------------------------------------------------------------- #


def test_worker_recycles_after_max_calls(monkeypatch):
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "process")
    monkeypatch.setenv("ALGEBENCH_CAS_POOL_SIZE", "1")
    monkeypatch.setenv("ALGEBENCH_CAS_MAX_CALLS", "3")
    cas_guard._reset_for_tests()
    pids = []
    for i in range(7):
        assert cas_guard.guard(W.inc, i) == i + 1
        workers = _our_workers()
        if workers:
            pids.append(workers[0].pid)
        time.sleep(0.05)
    # recycling means more than one distinct worker pid was used over the run
    assert len(set(pids)) >= 2


def test_pool_saturation_degrades(monkeypatch):
    """When every worker is busy and none free up, calls degrade to default."""
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "process")
    monkeypatch.setenv("ALGEBENCH_CAS_POOL_SIZE", "1")
    monkeypatch.setenv("ALGEBENCH_CAS_CLIENT_TIMEOUT", "5.0")
    monkeypatch.setenv("ALGEBENCH_CAS_ACQUIRE_TIMEOUT", "0.3")
    cas_guard._reset_for_tests()

    import threading
    results = {}

    def hog():
        results["hog"] = cas_guard.guard(W.sleep_then, 2.0, "slow", default="D")

    t = threading.Thread(target=hog)
    t.start()
    time.sleep(0.3)                            # let the single worker get busy
    t0 = time.monotonic()
    # no worker free; cannot grow past pool_size=1 -> degrade after acquire timeout
    out = cas_guard.guard(W.inc, 1, default="SATURATED")
    assert out == "SATURATED"
    assert time.monotonic() - t0 < 2.0
    t.join()
    assert results["hog"] == "slow"


def test_concurrent_mixed_load(monkeypatch):
    """Concurrent fast + runaway calls: fast ones stay correct, runaways killed.

    A generous acquire timeout means fast calls *wait* for a worker to free up
    (after the runaways are killed and respawned) rather than degrading, so the
    pool's correctness under concurrency is what's exercised here.
    """
    monkeypatch.setenv("ALGEBENCH_CAS_ISOLATION", "process")
    monkeypatch.setenv("ALGEBENCH_CAS_POOL_SIZE", "3")
    monkeypatch.setenv("ALGEBENCH_CAS_CLIENT_TIMEOUT", "0.5")
    monkeypatch.setenv("ALGEBENCH_CAS_GRACEFUL_TIMEOUT", "0.3")
    monkeypatch.setenv("ALGEBENCH_CAS_ACQUIRE_TIMEOUT", "15.0")
    cas_guard._reset_for_tests()
    cas_guard.warm_up()

    import threading
    out = {}

    def fast(i):
        out[i] = cas_guard.guard(W.inc, i, default=-1)

    def slow(i):
        out[i] = cas_guard.guard(W.spin, default="killed")

    threads = [threading.Thread(target=(slow if i % 4 == 0 else fast), args=(i,))
               for i in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    for i in range(12):
        if i % 4 == 0:
            assert out[i] == "killed"
        else:
            assert out[i] == i + 1          # fast calls correct, never wrong
    # all runaway workers reaped; pool back to a healthy bounded size
    assert _wait_until(lambda: len(_our_workers()) <= 3)


# --------------------------------------------------------------------------- #
# observability
# --------------------------------------------------------------------------- #


def test_log_timeout_preview_is_bounded(caplog):
    """The timeout preview is capped — a huge arg can't format a giant string."""
    huge = "x" * 100_000
    with caplog.at_level("WARNING"):
        cas_guard._log_timeout(W.inc, (huge, huge), 1.23, pid=999)
    assert "timeout after 1.23s" in caplog.text
    assert "pid=999" in caplog.text
    assert len(caplog.text) < 2000          # not the full 100k string
