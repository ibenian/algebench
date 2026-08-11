"""Repair a proposed viewport's sweep so the curve actually shows something.

The proposer picks ``x_min``/``x_max`` from the CAS report, and every numeric
``approx`` in that report is computed by :func:`_pin_others` with *every*
non-swept symbol set to **1**.  The view it writes then renders with its OWN
``pinned`` values, which are the physical ones.  So the sweep is chosen in one
parameter regime and drawn in another, and nothing reconciles the two.

The barometric entry velocity is the worst case::

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

from backend.experts.modules.proof_completion.cas_guard import (
    cas_register_safe_function, guard,
)

log = logging.getLogger(__name__)

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

# How much of the best available variation the chosen window must show. The
# ladder stops at the SMALLEST span reaching this, so a flat window is widened to
# where the curve reads — not to the largest span that technically varies more.
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
    """The smallest enlargement of [lo, hi] across which the curve reads.

    Only ever enlarges. Shrinking an over-wide sweep is the mirror problem and
    wants a different measure entirely: relative variation grows without bound on
    an unbounded function, so "take the tightest span with the best variation"
    cheerfully crops a parabola's arms and clips a projectile at its apex. That
    needs the feature locations, not a magnitude — left for its own change.
    """
    base = hi - lo
    if base <= 0:
        return None
    scored: list[tuple[float, float]] = []      # (span, variation)
    for k in range(1, _MAX_DOUBLINGS + 1):
        span = base * (2.0 ** k)
        if not math.isfinite(span) or span <= 0:
            break
        scored.append((span, _variation(
            [y for _, y in _sample(fn, *_window_at(lo, hi, span))])))
    if not scored:
        return None
    best = max(v for _, v in scored)
    if best < MIN_VARIATION:
        return None                             # flat at every scale we can reach
    span = min(s for s, v in scored if v >= best * _RETAIN)
    return _window_at(lo, hi, span)


def _repair_one(expr, var, view: dict) -> Optional[dict]:
    """Return a repair record for *view*, or None to leave it untouched."""
    x_range = view.get("x_range") or []
    if len(x_range) != 2:
        return None
    lo, hi = _finite(x_range[0]), _finite(x_range[1])
    if lo is None or hi is None or hi <= lo:
        return None

    pinned = view.get("pinned") or {}
    subs = {}
    for sym in expr.free_symbols:
        if sym == var:
            continue
        value = _finite(pinned.get(str(sym)))
        if value is None:
            return None            # unpinned parameter — nothing to evaluate
        subs[sym] = sympy.Float(value)

    try:
        fn = sympy.lambdify(var, expr.subs(subs), "math")
    except Exception:
        return None

    if _variation([y for _, y in _sample(fn, lo, hi)]) >= MIN_VARIATION:
        return None                # the proposed sweep already reads

    window = _widened(fn, lo, hi)
    if window is None:
        return None                # flat at every scale — genuinely constant here

    return {"from": [lo, hi],
            "to": [round(window[0], 6), round(window[1], 6)],
            "reason": "widen"}


def repair_view_ranges(expression_latex: str, views: list[dict],
                       timeout: Optional[float] = None) -> None:
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
        return
    expr, var = parsed
    for view in views:
        record = guard(_repair_one, expr, var, view, default=None, timeout=timeout)
        if record is None:
            continue
        view["x_range"] = record["to"]
        view["range_repaired"] = record
        log.info("expression_analysis: %s sweep %s → %s",
                 record["reason"], record["from"], record["to"])


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
