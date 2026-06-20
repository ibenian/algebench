"""Top-level, picklable helpers for the CAS guard process-isolation tests.

These live in an importable (non-test) module so a spawned worker can unpickle
them by reference — a function defined inside a test function or closure cannot
cross a process boundary.
"""

from __future__ import annotations

import signal
import time


def inc(n):
    return n + 1


def echo(x):
    return x


def boom():
    raise ValueError("kaboom")


def sleep_then(seconds, value):
    time.sleep(seconds)
    return value


def spin():
    """A pure-Python busy loop — interruptible by SIGTERM (the graceful rung)."""
    while True:
        pass


def spin_ignoring_sigterm():
    """Busy loop that ignores SIGTERM, forcing the hard SIGKILL rung."""
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    while True:
        pass
