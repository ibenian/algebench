"""Repair a proposed viewport's sweep so the curve actually shows something.

The proposer picks ``x_min``/``x_max`` from the CAS report, and every numeric
``approx`` in that report is computed by :func:`_pin_others` with *every*
non-swept symbol set to **1**.  The view it writes then renders with its OWN
``pinned`` values, which are the physical ones.  So the sweep is chosen in one
parameter regime and drawn in another, and nothing reconciles the two.

The Allen-Eggers velocity solution is the worst case::

    V(h) = V_E exp(-ρ₀H/(2β sin γ) · e^{-h/H})

Under the report's unit pinning the scale height is H = 1, so a sweep of
``[-5, 20]`` is a perfectly sensible twenty scale heights.  Rendered at the
view's own H = 6360 it spans 0.4% of ONE scale height: ``e^{-h/H}`` never leaves
1, the curve is flat to 0.16%, and an exponential reaches the learner as a
horizontal line.

So this module does the arithmetic the proposer could not: substitute the view's
own pinned values, sample, and widen a window the curve is flat across.  Same
contract as the handler's other post-processing passes: the LM proposes, the CAS
disposes.

Deliberately one-directional.  The mirror problem — a sweep so wide the whole
story is crushed against one edge — is NOT handled here, because it cannot be
decided by the same measure: relative variation grows without bound on an
unbounded function, so "take the tightest span with the most variation" crops a
parabola's arms and clips a projectile at its apex.  Shrinking wants the feature
locations, evaluated at the view's own pinning, which is its own change.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Optional

import sympy

from backend.experts.modules.expression_analysis.build_log import note
from backend.experts.modules.proof_completion.cas_guard import (
    cas_register_safe_function, guard,
)

log = logging.getLogger(__name__)

# Every view produces exactly one line under this tag, whether or not the range
# changed. Grep it to answer "did this pass even look at my view?" — a question
# the previous log-only-on-change version could not distinguish from "the pass
# never ran".
_LOG_TAG = "[view-ranges]"

# Relative peak-to-peak variation a sweep must show to count as informative.
# 2% is comfortably above float noise and below anything a learner would read as
# "flat" — the entry-velocity view that motivated this managed 0.16%.
MIN_VARIATION = 0.02

# Samples per candidate window. Enough to catch a feature living in a narrow band
# without making the scan costly.
_SAMPLES = 96

# How far the ladder climbs, in doublings of the proposed span. A sweep planned
# at the report's unit pinning and rendered at a physical scale needs ×2^11
# before an exponential even starts to bend (1 → 6360); 2^24 leaves headroom
# without letting a genuinely constant expression run away.
_MAX_DOUBLINGS = 24

# How much of the curve's total span (across every scale sampled) the chosen
# window must put on screen. The ladder stops at the SMALLEST span reaching this,
# so a flat window is widened to where the curve reads and no further.
_RETAIN = 0.9


def _finite(value: Any) -> Optional[float]:
    """Real, finite float or None — the one shape the sampling loop trusts."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _variation(samples: list[float]) -> float:
    """Peak-to-peak spread of *samples*, relative to their own magnitude.

    Relative, not absolute: a curve running 16 652 → 16 631 moves 21 units and is
    still flat, while one running 0.001 → 0.05 barely moves in absolute terms and
    is the whole story. Scaling by the largest magnitude present reads both
    correctly.
    """
    if len(samples) < 2:
        return 0.0
    lo, hi = min(samples), max(samples)
    scale = max(abs(lo), abs(hi))
    if scale < 1e-300:
        return 0.0
    return (hi - lo) / scale


def _grid(lo: float, hi: float) -> list[float]:
    step = (hi - lo) / (_SAMPLES - 1)
    return [lo + i * step for i in range(_SAMPLES)]


def _sample(fn, lo: float, hi: float) -> list[tuple[float, float]]:
    """Evaluate *fn* across [lo, hi] as (x, y), keeping only finite results.

    Singularities and out-of-domain stretches are expected — a pole contributes
    no sample rather than aborting the whole window.
    """
    if not (math.isfinite(lo) and math.isfinite(hi)) or hi <= lo:
        return []
    out = []
    for x in _grid(lo, hi):
        try:
            y = _finite(fn(x))
        except Exception:
            y = None
        if y is not None:
            out.append((x, y))
    return out


def _window_at(lo: float, hi: float, span: float) -> tuple[float, float]:
    """Rescale [lo, hi] to *span*, keeping the origin where the proposer put it.

    Proportional, not centred: ``[-5, 20]`` sits one fifth left of zero and stays
    one fifth left of zero at every size, so the proposer's judgement about how
    much of the negative side to show survives the rescale instead of drifting
    toward a symmetric window it never asked for. A left edge already at 0 — the
    physical bound the prompt asks for on a quantity that cannot go negative — is
    the t=0 case of the same rule, and stays pinned at 0.
    """
    original = hi - lo
    if lo <= 0 <= hi and original > 0:
        t = -lo / original
        return (-t * span, (1.0 - t) * span)
    centre = (lo + hi) / 2.0
    return (centre - span / 2.0, centre + span / 2.0)


def _widened(fn, lo: float, hi: float) -> Optional[tuple[float, float]]:
    """The smallest enlargement of [lo, hi] showing most of the curve's range.

    Scored by COVERAGE — what fraction of the function's whole span, across every
    scale sampled, this window puts on screen. The obvious alternative, reusing
    the relative :func:`_variation` that detected the flatness, stops far too
    early wherever the curve passes near zero: a window holding V ∈ [50, 1500]
    scores 0.97 on that measure, because it divides by its own largest value,
    even though the curve actually runs to 11 055 and the window shows an eighth
    of it. Against the global span the same window scores 0.13 and the search
    keeps climbing.

    Only ever enlarges. Shrinking an over-wide sweep is the mirror problem and
    needs a different measure again — see the module docstring.
    """
    base = hi - lo
    if base <= 0:
        return None
    scored: list[tuple[float, float, float]] = []      # (span, y_lo, y_hi)
    for k in range(1, _MAX_DOUBLINGS + 1):
        span = base * (2.0 ** k)
        if not math.isfinite(span) or span <= 0:
            break
        ys = [y for _, y in _sample(fn, *_window_at(lo, hi, span))]
        if ys:
            scored.append((span, min(ys), max(ys)))
    if not scored:
        return None
    global_lo = min(y for _, y, _ in scored)
    global_hi = max(y for _, _, y in scored)
    global_span = global_hi - global_lo
    scale = max(abs(global_lo), abs(global_hi))
    if global_span <= 0 or scale < 1e-300 or (global_span / scale) < MIN_VARIATION:
        return None                             # flat at every scale we can reach
    covering = [s for s, y_lo, y_hi in scored
                if (y_hi - y_lo) >= global_span * _RETAIN]
    if not covering:
        return None
    return _window_at(lo, hi, min(covering))


def _swept_symbol(expr, view: dict, fallback):
    """The symbol THIS view sweeps — its own ``x_var``, not a global guess.

    Each view names the variable it sweeps, and different views of one
    expression can sweep different variables. Re-deriving a single variable from
    the expression and applying it to every view mistakes the swept variable for
    an unpinned parameter (``no value pinned for h``, where h is the very thing
    on the x-axis) and blocks the repair outright.
    """
    name = str(view.get("x_var") or "").strip()
    if name:
        for sym in expr.free_symbols:
            if str(sym) == name:
                return sym
    return fallback


def _repair_one(expr, var, view: dict) -> dict:
    """Decide what to do with *view*. Always reports; ``to`` only when changing.

    Every outcome is named, including the ones that change nothing. A pass whose
    only signal is "I did something" cannot be told apart from a pass that never
    ran — which is exactly the question anyone debugging a suspicious range asks
    first — so the declines carry a ``why`` and get logged too.
    """
    x_range = view.get("x_range") or []
    if len(x_range) != 2:
        return {"why": "malformed-range"}
    lo, hi = _finite(x_range[0]), _finite(x_range[1])
    if lo is None or hi is None or hi <= lo:
        return {"why": "malformed-range"}

    swept = _swept_symbol(expr, view, var)
    if swept is None:
        return {"why": "no-swept-variable"}

    pinned = view.get("pinned") or {}
    subs = {}
    for sym in expr.free_symbols:
        if sym == swept:
            continue
        value = _finite(pinned.get(str(sym)))
        if value is None:
            # Not a silent skip: a view that pins no value for a parameter also
            # cannot be PLOTTED (the sliders are built from `pinned`), so this
            # says something is wrong upstream, not merely unmeasurable here.
            return {"why": f"unpinned:{sym}"}
        subs[sym] = sympy.Float(value)

    try:
        fn = sympy.lambdify(swept, expr.subs(subs), "math")
    except Exception:
        return {"why": "not-evaluable"}

    samples = [y for _, y in _sample(fn, lo, hi)]
    if len(samples) < 2:
        # NOT flat: `_variation` returns 0.0 for an empty or single-point sample
        # set, which is indistinguishable from a genuinely constant curve. A
        # window the expression has no values across (a `sqrt` over negatives,
        # an evaluation that errors everywhere) is a DIFFERENT and more serious
        # finding — the view cannot be plotted at all — and reporting it as
        # "flat at every scale" hides that. Same distinction as `unresolved`
        # vs "no features": unknown is not absent.
        return {"why": "undefined-here", "samples": len(samples)}

    variation = _variation(samples)
    if variation >= MIN_VARIATION:
        return {"why": "already-reads", "variation": round(variation, 4)}

    window = _widened(fn, lo, hi)
    if window is None:
        return {"why": "flat-at-every-scale", "variation": round(variation, 4)}

    return {"why": "widened", "from": [lo, hi],
            "to": [round(window[0], 6), round(window[1], 6)],
            "reason": "widen", "variation": round(variation, 4)}


_WHY_PROSE = {
    "already-reads": "the proposer's sweep {rng} already shows the curve moving",
    "flat-at-every-scale": "the curve is flat at every scale — nothing to widen to",
    "malformed-range": "the proposer gave no usable sweep ({rng})",
    "not-evaluable": "the expression could not be evaluated at these values",
    "undefined-here": "the expression has no defined values across {rng}, so "
                      "there is nothing to measure (and nothing to plot)",
}

# Declines that mean "this view is broken", not "this view is fine as proposed".
# Anything listed here is noted at `warning` level so the summary counts it; the
# rest are the routine `ok` of a pass that looked and had nothing to do.
_WARNING_WHYS = frozenset({"undefined-here", "malformed-range", "not-evaluable"})


def _prose(record: dict, lo_hi: list) -> str:
    """The decline, said in words rather than a slug."""
    why = record.get("why", "")
    if why.startswith("unpinned:"):
        return (f"no value pinned for {why.split(':', 1)[1]}, so the curve "
                f"cannot be sampled (and the view cannot be plotted either)")
    return _WHY_PROSE.get(why, why).format(rng=_fmt_range(lo_hi))


def _handle(view: dict, index: int) -> str:
    """How a note names this viewport: its id, else a positional stand-in.

    Views built by the proposer carry an id; a caller assembling one by hand may
    not, so an anonymous view still gets a handle rather than a bare ``None``
    that every note would share.
    """
    return str(view.get("id") or f"#{index + 1}")


def _fmt_range(rng) -> str:
    try:
        lo, hi = rng
        return f"[{lo:g}, {hi:g}]"
    except Exception:
        return str(rng)


def repair_view_ranges(expression_latex: str, views: list[dict],
                       timeout: Optional[float] = None,
                       notes: Optional[list] = None) -> None:
    """Widen any proposed sweep the curve is flat across, in place.

    Each repaired view records what changed under ``range_repaired`` so a
    reviewing author sees the correction rather than a silently different
    picture. Views that already read well, that pin no value for some parameter,
    or whose expression is genuinely constant are left exactly as proposed.
    """
    if not views:
        return
    parsed = guard(_parse, expression_latex, default=None, timeout=timeout)
    if parsed is None:
        log.info("%s skipped %d view(s): expression did not parse",
                 _LOG_TAG, len(views))
        # One note PER VIEW, not one for the batch. A single unscoped warning
        # satisfies "something went wrong" but not the contract this pass is
        # built on: a client filtering notes by view id would find nothing for
        # any of them, which reads as "never looked at" — the exact ambiguity
        # the per-view accounting exists to remove (Copilot, #553).
        for i, view in enumerate(views):
            note(notes, "view-ranges", "warning",
                 "could not re-parse the expression, so this sweep was not "
                 "checked", view=_handle(view, i), why="unparsed-expression")
        return
    expr, var = parsed
    for i, view in enumerate(views):
        n = _handle(view, i)
        original = list(view.get("x_range") or [])
        record = guard(_repair_one, expr, var, view, default=None, timeout=timeout)
        if record is None:                      # the guard itself gave up
            log.info("%s %s: op timed out or errored", _LOG_TAG, n)
            note(notes, "view-ranges", "warning",
                 "checking the sweep timed out, so it was left as proposed",
                 view=n)
            continue
        if "to" not in record:
            log.info("%s %s: left alone (%s)", _LOG_TAG, n, record["why"])
            why = record["why"]
            level = ("warning" if why.startswith("unpinned:")
                     or why in _WARNING_WHYS else "ok")
            note(notes, "view-ranges", level, _prose(record, original), view=n,
                 why=why)
            continue
        view["x_range"] = record["to"]
        view["range_repaired"] = {k: record[k] for k in ("from", "to", "reason")}
        log.info("%s %s: widened %s → %s (variation was %.4f)", _LOG_TAG,
                 n, record["from"], record["to"], record["variation"])
        note(notes, "view-ranges", "changed",
             f"the proposer's sweep {_fmt_range(record['from'])} is flat at its "
             f"own pinned values (the curve varies by "
             f"{record['variation'] * 100:.1f}% across it) — widened to "
             f"{_fmt_range(record['to'])}",
             view=n, **{"from": record["from"], "to": record["to"],
                        "variation": record["variation"]})


def _parse(expression_latex: str):
    """(expression, swept symbol) for the analyzed LaTeX, or None."""
    from backend.experts.modules.expression_analysis.features import (
        _op_parse, pick_variable,
    )
    parsed = _op_parse(expression_latex)
    if parsed is None:
        return None
    expr, _defined, defined_arg, _defined_latex = parsed
    var = pick_variable(expr, str(defined_arg) if defined_arg is not None else None)
    return None if var is None else (expr, var)


# Both run under ``guard`` (sympify + lambdify on LM-shaped input is exactly the
# kind of work that wants an isolation boundary), so both must be on its
# allow-list — module-level, hence picklable for process mode.
for _fn in (_parse, _repair_one):
    cas_register_safe_function(_fn)
