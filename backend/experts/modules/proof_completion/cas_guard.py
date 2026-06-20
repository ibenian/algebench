"""Process-isolated, killable execution for heavy sympy calls (issue #386).

Why this exists
---------------
sympy's heuristic routines (``simplify`` / ``solveset`` / ``limit`` /
``nsimplify`` / ``integrate``) carry no termination or complexity guarantee: an
intermediate expression tree can blow up super-linearly, after which the
``O(tree-size)`` compare/hash loop pins a CPU core. Python cannot kill a thread,
so the previous ``ThreadPoolExecutor`` guard bounded only the *wait* on the
result — a timed-out call kept a worker thread burning a core **forever**,
surviving the request that started it and accumulating across a session until
the box was unusable (issue #386).

This module bounds the *computation*, not just the wait, by running heavy sympy
in a pool of **separate processes** that can be signalled and ultimately
``SIGKILL``ed. A wall-clock budget therefore translates into the work actually
stopping and the core being reclaimed.

The escalation ladder (each rung independently configurable)
------------------------------------------------------------
1. **client timeout** — the caller stops *waiting* and gets ``default`` back, so
   a derive never blocks on a pathological step. This is deliberately separate
   from recycle/recovery: the caller is unblocked *immediately*, while killing
   and respawning the wedged worker proceeds in the background.
   (``ALGEBENCH_CAS_CLIENT_TIMEOUT``, default = ``ALGEBENCH_VERIFY_TIMEOUT`` = 2.0s)
2. **graceful kill** — the abandoned worker is sent ``SIGTERM``; its handler
   raises into the running sympy call, unwinding it (``finally`` blocks run) so
   the process exits cleanly. Interrupts any call that is executing Python
   bytecode (which sympy overwhelmingly is). The grace window before escalation
   is ``ALGEBENCH_CAS_GRACEFUL_TIMEOUT`` (default 1.0s).
3. **hard kill** — if the worker is wedged in an uninterruptible C routine and
   ignores ``SIGTERM`` past the grace window, it is ``SIGKILL``ed
   unconditionally. The core is reclaimed regardless of what the worker is doing.

A retired worker is never reused: a fresh one is spawned to refill the pool.
This also contains memory blow-ups (the bloated child RSS dies with it) and
keeps a pathological expression's sympy cache out of the long-lived server.

Isolation modes (``ALGEBENCH_CAS_ISOLATION``)
---------------------------------------------
* ``process`` *(default)* — the full ladder above.
* ``thread``  — legacy shared ``ThreadPoolExecutor``; bounds only the wait
  (rungs 2-3 are no-ops). The test suite runs in this mode so heavy sympy entry
  points stay monkeypatchable in-process; also the automatic fallback when no
  process start method is usable.
* ``inline``  — call directly, no isolation, no timeout. Fastest; for pure-logic
  unit tests.

Picklability contract
----------------------
In ``process`` mode the callable and its arguments cross a process boundary, so
``fn`` must be a **module-level** (picklable-by-reference) function and the
arguments/result must be picklable (sympy objects are). Lambdas and closures are
not picklable — callers that need them should expose a top-level helper instead
(see the ``_op_*`` helpers in ``step_grounding``).
"""

from __future__ import annotations

import atexit
import logging
import multiprocessing as mp
import os
import queue
import signal
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable, Optional

log = logging.getLogger(__name__)

# Log markers so CAS output is identifiable at a glance in the shared server log:
#   🧬  parent-side CAS-subsystem events (timeout / kill / saturation)
#   🖥️   output emitted FROM a worker subprocess (tagged with its pid)
_CAS_TAG = "🧬 CAS"
_WORKER_EMOJI = "🖥️"

# Set True inside a worker process so a (mis)guided ``guard`` call there can
# never recurse into building its own pool — it degrades to inline instead.
_IS_WORKER = False


# --------------------------------------------------------------------------- #
# configuration
# --------------------------------------------------------------------------- #


def _envf(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _envi(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _default_start_method() -> str:
    """forkserver on Linux (cheap, thread-safe), spawn elsewhere.

    Plain ``fork`` is unsafe in a threaded server (the child inherits locks held
    by other threads); ``forkserver`` forks from a clean single-threaded helper
    and so is safe, while still avoiding spawn's full interpreter restart.
    """
    avail = set(mp.get_all_start_methods())
    if sys.platform.startswith("linux") and "forkserver" in avail:
        return "forkserver"
    if "spawn" in avail:
        return "spawn"
    return next(iter(avail))


def _default_pool_size() -> int:
    # cores - 1 so guarded work can't oversubscribe the box, capped so a
    # many-core machine doesn't hold a wall of warm sympy interpreters in RAM.
    cores = os.cpu_count() or 2
    return max(1, min(4, cores - 1))


@dataclass(frozen=True)
class CasConfig:
    """Snapshot of the guard's tunables, read from the environment once."""

    isolation: str          # process | thread | inline
    client_timeout: float   # rung 1: how long the caller waits (seconds)
    graceful_timeout: float  # rung 2->3: SIGTERM grace before SIGKILL (seconds)
    acquire_timeout: float  # max wait for a free worker before degrading
    spawn_timeout: float    # max wait for a fresh worker to warm up (import)
    pool_size: int          # number of persistent worker processes
    max_calls: int          # recycle a worker after N calls (0 = never)
    start_method: str       # process start method

    @staticmethod
    def from_env() -> "CasConfig":
        isolation = os.environ.get("ALGEBENCH_CAS_ISOLATION", "process").strip().lower()
        if isolation not in ("process", "thread", "inline"):
            isolation = "process"
        # Back-compat: ALGEBENCH_VERIFY_TIMEOUT was the old single knob; it is
        # the default for the new, explicit client timeout.
        legacy = _envf("ALGEBENCH_VERIFY_TIMEOUT", 2.0)
        client_timeout = _envf("ALGEBENCH_CAS_CLIENT_TIMEOUT", legacy)
        graceful_timeout = _envf("ALGEBENCH_CAS_GRACEFUL_TIMEOUT", 1.0)
        acquire_timeout = _envf("ALGEBENCH_CAS_ACQUIRE_TIMEOUT", client_timeout)
        # Spawn (macOS/Windows) restarts the interpreter and re-imports sympy, so
        # a fresh worker's warm-up can far exceed a tight client timeout. We wait
        # for it separately (handshake) so warm-up is never charged to a call.
        spawn_timeout = _envf("ALGEBENCH_CAS_SPAWN_TIMEOUT", 30.0)
        pool_size = _envi("ALGEBENCH_CAS_POOL_SIZE", _default_pool_size())
        pool_size = max(1, pool_size)
        max_calls = max(0, _envi("ALGEBENCH_CAS_MAX_CALLS", 200))
        start_method = os.environ.get(
            "ALGEBENCH_CAS_START_METHOD", _default_start_method()).strip().lower()
        if start_method not in mp.get_all_start_methods():
            start_method = _default_start_method()
        return CasConfig(
            isolation=isolation,
            client_timeout=max(0.01, client_timeout),
            graceful_timeout=max(0.0, graceful_timeout),
            acquire_timeout=max(0.0, acquire_timeout),
            spawn_timeout=max(0.5, spawn_timeout),
            pool_size=pool_size,
            max_calls=max_calls,
            start_method=start_method,
        )


# --------------------------------------------------------------------------- #
# worker process
# --------------------------------------------------------------------------- #


class _GracefulInterrupt(BaseException):
    """Raised in a worker by the SIGTERM handler to unwind the current call."""


_READY = "__cas_ready__"


def _install_worker_logging() -> None:
    """Tag every log record / warning emitted by this worker child.

    A worker inherits the parent's stderr fd, so without this its output (sympy
    warnings, an unexpected error we log, etc.) would interleave into the server
    log indistinguishable from parent output. We prefix it with 🖥️ + the worker
    pid so subprocess output is greppable and attributable. ``captureWarnings`` routes
    ``warnings.warn`` (e.g. sympy's) through logging so those get the tag too.
    """
    tag = f"{_WORKER_EMOJI} cas-worker[{os.getpid()}]"
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(f"%(levelname)s {tag} %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]          # replace anything inherited via fork
    root.setLevel(logging.WARNING)
    logging.captureWarnings(True)


def _worker_loop(conn) -> None:
    """Worker entry point: run one picklable ``fn(*args)`` at a time.

    Single-threaded by design — the call runs on the main thread, so a SIGTERM
    handler raising :class:`_GracefulInterrupt` interrupts it at the next
    bytecode boundary (rung 2). On interrupt the worker simply exits; the parent
    has already returned ``default`` to the caller and will respawn a clean
    replacement.
    """
    global _IS_WORKER
    _IS_WORKER = True
    _install_worker_logging()

    def _on_term(_signum, _frame):
        # One-shot: a second SIGTERM (or one arriving during interpreter
        # shutdown) falls through to the default handler, terminating cleanly
        # instead of raising a Python traceback to stderr.
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        raise _GracefulInterrupt()

    signal.signal(signal.SIGTERM, _on_term)
    # Don't let a parent KeyboardInterrupt storm the worker with stack noise.
    try:
        signal.signal(signal.SIGINT, signal.SIG_IGN)
    except (ValueError, OSError):
        pass

    # Handshake: tell the parent we are imported and listening, so it can charge
    # warm-up to the spawn budget rather than to the first call's timeout.
    try:
        conn.send(_READY)
    except Exception:
        return

    try:
        while True:
            try:
                msg = conn.recv()
            except (EOFError, OSError):
                return  # parent closed the pipe — shut down
            if msg is None:
                return  # explicit shutdown sentinel
            fn, args = msg
            try:
                result = fn(*args)
                payload = ("ok", result)
            except _GracefulInterrupt:
                return  # reaped mid-call — exit so the parent gets a fresh worker
            except Exception as exc:  # a real sympy error is a clean "no result"
                payload = ("err", f"{type(exc).__name__}: {exc}"[:200])
            try:
                conn.send(payload)
            except _GracefulInterrupt:
                return
            except Exception:
                # Result not picklable / pipe broke — report a generic failure
                # rather than wedging. Best effort; ignore if even this fails.
                try:
                    conn.send(("err", "unsendable result"))
                except Exception:
                    return
    except _GracefulInterrupt:
        return
    except BaseException:
        return


class _Worker:
    """A handle to one worker process plus its parent-side pipe end."""

    __slots__ = ("proc", "conn", "calls")

    def __init__(self, proc, conn):
        self.proc = proc
        self.conn = conn
        self.calls = 0

    def call(self, fn, args, timeout: float):
        """Send a job and wait up to ``timeout`` for its result.

        Returns ``("ok", value)`` / ``("err", msg)`` / ``("timeout", None)``.
        Raises :class:`_WorkerBroken` if the worker died or the pipe failed.
        """
        self.calls += 1
        try:
            self.conn.send((fn, args))
        except Exception as exc:  # pragma: no cover - pickling/pipe failure
            raise _WorkerBroken(str(exc)) from exc
        if not self.conn.poll(timeout):
            return ("timeout", None)
        try:
            status, payload = self.conn.recv()
        except (EOFError, OSError) as exc:
            raise _WorkerBroken(str(exc)) from exc
        return (status, payload)

    def signal_stop(self) -> None:
        """Request a graceful stop *now* (cheap, non-blocking SIGTERM).

        Sent synchronously at retire time so a runaway starts unwinding
        immediately, rather than only when its reap task reaches the front of the
        reaper queue (which, under a burst of timeouts, can be several blocking
        joins later — leaving multiple workers burning cores meanwhile).
        """
        try:
            if self.proc.is_alive():
                self.proc.terminate()   # SIGTERM
        except Exception:               # pragma: no cover - already-dead race
            pass

    def reap(self, graceful_timeout: float) -> None:
        """Escalating teardown: SIGTERM (graceful) then SIGKILL (hard).

        ``signal_stop`` may already have sent the SIGTERM; the ``is_alive`` guard
        below makes the re-send a no-op in that case. The pipe is closed only
        *after* the process is gone — closing it first would race the worker's
        idle ``recv`` (EOF) against our SIGTERM, landing the signal during the
        worker's own shutdown.
        """
        p = self.proc
        try:
            if p.is_alive():
                p.terminate()           # rung 2: SIGTERM — unwind the call
                p.join(graceful_timeout)
            if p.is_alive():
                log.warning("%s %s worker pid=%s ignored SIGTERM; SIGKILL",
                            _CAS_TAG, _WORKER_EMOJI, p.pid)
                p.kill()                # rung 3: SIGKILL — reclaim the core
                p.join()
        except Exception:               # pragma: no cover - already-dead races
            pass
        finally:
            try:
                self.conn.close()
            except Exception:
                pass


class _WorkerBroken(Exception):
    """The worker process died or its pipe failed."""


# --------------------------------------------------------------------------- #
# process pool
# --------------------------------------------------------------------------- #


class _CasPool:
    """Bounded, self-healing pool of pre-importable worker processes."""

    def __init__(self, cfg: CasConfig):
        self.cfg = cfg
        self.ctx = mp.get_context(cfg.start_method)
        self._idle: "queue.Queue[_Worker]" = queue.Queue()
        self._lock = threading.Lock()
        self._count = 0                 # live workers (idle + checked-out)
        self._closed = False
        # Reaping (SIGTERM grace + join) runs off the caller's thread so the
        # client timeout stays decoupled from recycle/recovery time.
        self._reaper = ThreadPoolExecutor(
            max_workers=cfg.pool_size + 2, thread_name_prefix="cas-reap")
        # One-time confirmation the killable pool is live (visible with --debug).
        log.debug("%s pool up: process mode, size=%d start=%s "
                  "client=%.1fs graceful=%.1fs max_calls=%d",
                  _CAS_TAG, cfg.pool_size, cfg.start_method,
                  cfg.client_timeout, cfg.graceful_timeout, cfg.max_calls)

    # -- worker lifecycle -------------------------------------------------- #

    def _spawn(self) -> Optional["_Worker"]:
        """Start a worker and wait (spawn budget) for its readiness handshake."""
        parent, child = self.ctx.Pipe()
        proc = self.ctx.Process(
            target=_worker_loop, args=(child,), name="cas-worker", daemon=True)
        proc.start()
        child.close()                   # the child holds its own end
        w = _Worker(proc, parent)
        try:
            if not parent.poll(self.cfg.spawn_timeout) or parent.recv() != _READY:
                raise _WorkerBroken("worker failed to signal ready")
        except Exception:               # pragma: no cover - warm-up failure
            w.reap(self.cfg.graceful_timeout)
            return None
        log.debug("%s %s worker spawned pid=%s", _CAS_TAG, _WORKER_EMOJI, proc.pid)
        return w

    def _acquire(self) -> Optional["_Worker"]:
        deadline = time.monotonic() + self.cfg.acquire_timeout
        while True:
            try:
                return self._idle.get_nowait()
            except queue.Empty:
                pass
            # Reserve a slot under the lock, then spawn OUTSIDE it — the spawn
            # handshake can take seconds and must not block other acquirers.
            reserved = False
            with self._lock:
                if self._closed:
                    return None
                if self._count < self.cfg.pool_size:
                    self._count += 1
                    reserved = True
            if reserved:
                w = self._spawn()
                if w is None:
                    with self._lock:
                        self._count -= 1
                    return None
                return w
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            try:
                # Short poll so a slot freed by a retirement is noticed promptly.
                return self._idle.get(timeout=min(remaining, 0.05))
            except queue.Empty:
                continue

    def _release(self, w: "_Worker") -> None:
        # Recycle on call-count for cache/memory hygiene, else return to idle.
        if self.cfg.max_calls and w.calls >= self.cfg.max_calls:
            self._retire(w)
            return
        if self._closed:
            self._retire(w)
            return
        self._idle.put(w)

    def _retire(self, w: "_Worker") -> None:
        with self._lock:
            self._count -= 1
        # Interrupt the worker NOW (cheap) so a runaway stops burning a core
        # immediately; the reaper only does the blocking join + SIGKILL escalation.
        w.signal_stop()
        try:
            self._reaper.submit(w.reap, self.cfg.graceful_timeout)
        except RuntimeError:            # reaper already shut down (at exit)
            w.reap(self.cfg.graceful_timeout)

    # -- the public entry -------------------------------------------------- #

    def run(self, fn: Callable, args: tuple, default: Any, timeout: float) -> Any:
        w = self._acquire()
        if w is None:
            log.warning("%s pool saturated (size=%d); degrading %s",
                        _CAS_TAG, self.cfg.pool_size, getattr(fn, "__name__", fn))
            return default
        t0 = time.monotonic()
        try:
            status, payload = w.call(fn, args, timeout)
        except _WorkerBroken:
            self._retire(w)
            return default
        if status == "ok":
            self._release(w)
            return payload
        if status == "err":
            self._release(w)            # an exception is a clean return
            return default
        # status == "timeout": the caller gives up now; the wedged worker is
        # retired (SIGTERM->SIGKILL) on a background thread.
        _log_timeout(fn, args, time.monotonic() - t0, w.proc.pid)
        self._retire(w)
        return default

    def shutdown(self) -> None:
        with self._lock:
            self._closed = True
        while True:
            try:
                w = self._idle.get_nowait()
            except queue.Empty:
                break
            w.reap(self.cfg.graceful_timeout)
        self._reaper.shutdown(wait=False)


# --------------------------------------------------------------------------- #
# observability
# --------------------------------------------------------------------------- #


def _log_timeout(fn, args, elapsed: float, pid=None) -> None:
    """Capture the pathological input so prod can see what actually hung."""
    name = getattr(fn, "__name__", repr(fn))
    try:
        shown = ", ".join(str(a) for a in args)[:300]
    except Exception:                   # pragma: no cover - hostile __str__
        shown = "<unprintable args>"
    log.warning("%s %s worker pid=%s timeout after %.2fs: %s(%s)",
                _CAS_TAG, _WORKER_EMOJI, pid, elapsed, name, shown)


# --------------------------------------------------------------------------- #
# module-level singletons + public API
# --------------------------------------------------------------------------- #

_CONFIG: Optional[CasConfig] = None
_POOL: Optional[_CasPool] = None
_THREAD_POOL: Optional[ThreadPoolExecutor] = None
_LOCK = threading.Lock()


def current_config() -> CasConfig:
    """The active config, parsed from the environment on first use."""
    global _CONFIG
    if _CONFIG is None:
        with _LOCK:
            if _CONFIG is None:
                _CONFIG = CasConfig.from_env()
    return _CONFIG


def _pool() -> _CasPool:
    global _POOL
    if _POOL is None:
        with _LOCK:
            if _POOL is None:
                _POOL = _CasPool(current_config())
    return _POOL


def _thread_pool() -> ThreadPoolExecutor:
    global _THREAD_POOL
    if _THREAD_POOL is None:
        with _LOCK:
            if _THREAD_POOL is None:
                _THREAD_POOL = ThreadPoolExecutor(
                    max_workers=max(8, current_config().pool_size * 8),
                    thread_name_prefix="cas-thread")
    return _THREAD_POOL


def guard(fn: Callable, *args, default: Any = None,
          timeout: Optional[float] = None) -> Any:
    """Run ``fn(*args)`` under the configured isolation; ``default`` on timeout/error.

    The single choke point every heavy sympy call goes through. In ``process``
    mode ``fn`` must be picklable (module-level) — see the module docstring.
    ``timeout`` overrides the configured client timeout for this one call.
    """
    cfg = current_config()
    t = cfg.client_timeout if timeout is None else timeout

    # Never recurse into a pool from inside a worker, and honour explicit modes.
    if _IS_WORKER or cfg.isolation == "inline":
        try:
            return fn(*args)
        except Exception:
            return default

    if cfg.isolation == "thread":
        try:
            return _thread_pool().submit(fn, *args).result(timeout=t)
        except Exception:
            return default

    # process mode
    try:
        return _pool().run(fn, args, default, t)
    except Exception:                   # pragma: no cover - pool-level failure
        log.exception("%s process guard failed; degrading", _CAS_TAG)
        return default


def warm_up() -> None:
    """Eagerly build the process pool (pay spawn/import cost up front).

    Optional: call once at server start so the first derive isn't slowed by
    worker warm-up. A no-op outside ``process`` mode.
    """
    if current_config().isolation == "process" and not _IS_WORKER:
        try:
            pool = _pool()
            workers = [pool._acquire() for _ in range(pool.cfg.pool_size)]
            for w in workers:
                if w is not None:
                    pool._release(w)
        except Exception:               # pragma: no cover - best effort
            log.exception("%s warm-up failed", _CAS_TAG)


def shutdown() -> None:
    """Tear down the pools (registered at exit; also used by tests)."""
    global _POOL, _THREAD_POOL
    pool, tpool = _POOL, _THREAD_POOL
    _POOL = None
    if pool is not None:
        pool.shutdown()
    if tpool is not None:
        tpool.shutdown(wait=False)
        _THREAD_POOL = None


def _reset_for_tests() -> None:
    """Drop cached config + pools so the next call re-reads the environment."""
    global _CONFIG
    shutdown()
    _CONFIG = None


atexit.register(shutdown)
