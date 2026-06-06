"""Shared helper for proof-completion scripts: load .env.local + run a program.

``run.sh`` does not source ``.env.local`` (only the ``algebench`` launcher
does), so scripts that call the LM load it here. Values already in the
environment win.
"""

from __future__ import annotations

import os
import time
import traceback

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env_local() -> None:
    path = os.path.join(_ROOT, ".env.local")
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def run_program(prog, example):
    """Call a DSPy program with an example's inputs; return (pred, error)."""
    kwargs = dict(
        context=example.context,
        context_id=example.context_id,
        lesson_context=getattr(example, "lesson_context", ""),
        instruction=getattr(example, "instruction", ""),
    )
    try:
        return prog(**kwargs), None
    except Exception as exc:  # LM/parse failure → counted as a miss
        return None, exc


def predict_all(prog, data, label="predict", threads=8):
    """Run a program over a dataset concurrently, returning predictions in order."""
    from concurrent.futures import ThreadPoolExecutor
    import threading

    n = len(data)
    preds: list = [None] * n
    t0 = time.time()
    done = {"count": 0, "errors": 0}
    lock = threading.Lock()  # guard the shared counters across worker threads

    def work(idx_ex):
        idx, ex = idx_ex
        pred, err = run_program(prog, ex)
        with lock:
            done["count"] += 1
            if err is not None:
                done["errors"] += 1
            count, errors = done["count"], done["errors"]
        if count % 5 == 0 or count == n:
            print(f"  [{label}] {count}/{n}  errors={errors}  "
                  f"({time.time() - t0:.0f}s)", flush=True)
        return idx, pred

    with ThreadPoolExecutor(max_workers=threads) as pool:
        for idx, pred in pool.map(work, list(enumerate(data))):
            preds[idx] = pred
    return preds
