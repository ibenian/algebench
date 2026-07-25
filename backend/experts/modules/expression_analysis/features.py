"""CAS behavior-feature detection for a single expression.

The behavior-feature catalog of the equation-behavior pedagogy proposal
(``docs/proposals/equation-behavior-pedagogy-proposal.md`` §6.1) in code:
a fixed ontology of behavioral features — zeros, extrema, inflections,
singularities/vertical asymptotes, end behavior, periodicity, parity —
each detected **symbolically** by SymPy. Detection is mechanical; no LM is
involved at this layer. The pedagogical *ranking* of what's detected is
the proposer's job (``proposer.py``).

Every heavy SymPy call runs through the killable CAS guard (issue #386),
one guarded op per feature so a pathological ``solveset`` degrades that
one feature to ``status: "unresolved"`` instead of taking the whole
analysis down. Ops are module-level and registered on the guard's
allow-list (picklability contract for process isolation).

Symbolic-first matters pedagogically: a detected peak comes back as an
*expression* (``t = v_0/g``), which the UI can surface as the *why*, not
just the where. When classification needs a sign the symbols don't
determine (is ``-g`` negative?), free parameters are pinned to 1 — the
"representative constant" policy of the parametric proposal §4.4 — and
the feature is marked ``assumed`` so the UI stays honest about it.
"""
from __future__ import annotations

from typing import Any, Optional

import sympy
from sympy import (
    S, Symbol, diff, latex, limit, oo, periodicity, solveset,
)
from sympy.calculus.util import continuous_domain

from backend.experts.modules.proof_completion.cas_guard import (
    cas_register_safe_function, guard,
)
from backend.semantic_graph.mathjs_converter import (
    latex_to_sympy_defined, sympy_to_mathjs,
)

# Bounds keeping the report reviewable and the JSON small: an expression
# with more than this many of one feature kind is summarized, not listed.
MAX_POINTS = 8

# Sweep-variable preference when the caller doesn't name one. Mirrors the
# frontend convention (charts default to the first variable) but prefers
# the symbols that overwhelmingly mean "the independent variable".
_PREFERRED_VARS = ("x", "t", "r", "n", "u", "v")


# ── serialization helpers (run INSIDE the guarded worker) ──────────────

def _num(value) -> Optional[float]:
    """Real float approximation of a SymPy value, or None."""
    try:
        v = complex(value.evalf())
        if abs(v.imag) > 1e-9:
            return None
        f = float(v.real)
        return f if f == f and abs(f) != float("inf") else None
    except Exception:
        return None


def _point(value, subs: Optional[dict] = None) -> dict:
    """Serialize one symbolic location/value: LaTeX + numeric approx.

    ``subs`` carries the representative-constant pinning used for the
    approx when the value itself is symbolic.
    """
    out: dict[str, Any] = {"latex": latex(value)}
    approx = _num(value if not subs else value.subs(subs))
    if approx is not None:
        out["approx"] = round(approx, 6)
    return out


def _finite_solutions(solset) -> tuple[list, Optional[str]]:
    """Split a solveset result into listable points + an optional family note.

    ``FiniteSet`` elements are listable; infinite families (``ImageSet``,
    e.g. sin's zeros) and unresolved ``ConditionSet``s are reported as a
    LaTeX description instead of a fake enumeration.

    With symbolic parameters, ``solveset`` wraps its answer in
    ``Intersection({…}, Reals)`` because realness depends on the
    parameters (``2 v_0/g`` is real unless ``g = 0``). Unwrap it: the
    finite candidates ARE the pedagogically meaningful answer under the
    representative-constant policy, so keep them and drop only elements
    that are provably non-real.
    """
    if isinstance(solset, sympy.Intersection) and S.Reals in solset.args:
        finite = [a for a in solset.args if isinstance(a, sympy.FiniteSet)]
        if finite:
            solset = sympy.FiniteSet(
                *[e for e in finite[0] if e.is_real is not False])
    if isinstance(solset, sympy.FiniteSet):
        return list(solset)[:MAX_POINTS], None
    if solset is S.EmptySet:
        return [], None
    try:
        return [], latex(solset)
    except Exception:
        return [], str(solset)


def _pin_others(expr, var) -> dict:
    """Representative-constant substitution for every free symbol but ``var``."""
    return {s: sympy.Integer(1) for s in expr.free_symbols if s != var}


# ── guarded ops (module-level; picklable; one per feature) ─────────────

def _op_parse(latex_src: str):
    """Parse + normalize; returns ``(expression, defined_symbol)``.

    ``defined_symbol`` is set when the input is a definition such as
    ``g_{feet} = \\omega^2 R``: the expression analyzed is then the
    formula alone, and the symbol names what it produces (the y axis),
    instead of collapsing to ``LHS - RHS`` and hunting for a zero.
    """
    return latex_to_sympy_defined(latex_src)


def _op_zeros(expr, var) -> dict:
    points, family = _finite_solutions(solveset(expr, var, domain=S.Reals))
    return {
        "points": [_point(p, _pin_others(expr, var)) for p in points],
        "family": family,
    }


def _op_singularities(expr, var) -> dict:
    """Discontinuities + one-sided limits → vertical-asymptote classification."""
    sings, family = _finite_solutions(
        sympy.calculus.singularities(expr, var, domain=S.Reals))
    subs = _pin_others(expr, var)
    out = []
    for p in sings:
        entry: dict[str, Any] = {"location": _point(p, subs)}
        try:
            left = limit(expr, var, p, "-")
            right = limit(expr, var, p, "+")
            entry["left_limit"] = _point(left, subs)
            entry["right_limit"] = _point(right, subs)
            entry["vertical_asymptote"] = bool(
                left.has(oo, -oo) or right.has(oo, -oo))
        except Exception:
            entry["vertical_asymptote"] = None
        out.append(entry)
    return {"points": out, "family": family}


def _op_extrema(expr, var) -> dict:
    """Critical points of ``f`` with second-derivative classification.

    Classification falls back to representative constants (all other
    symbols → 1) when the sign is symbolically undetermined; such points
    carry ``assumed`` so the caller can label them honestly.
    """
    d1 = diff(expr, var)
    crits, family = _finite_solutions(solveset(d1, var, domain=S.Reals))
    d2 = diff(expr, var, 2)
    subs = _pin_others(expr, var)
    out = []
    for p in crits:
        curv = d2.subs(var, p)
        kind, assumed = None, False
        if curv.is_positive:
            kind = "minimum"
        elif curv.is_negative:
            kind = "maximum"
        else:
            approx = _num(curv.subs(subs))
            if approx is not None and approx != 0:
                kind = "minimum" if approx > 0 else "maximum"
                assumed = bool(subs)
        entry = {
            "location": _point(p, subs),
            "value": _point(expr.subs(var, p), subs),
            "kind": kind or "critical",
        }
        if assumed:
            entry["assumed"] = {str(k): 1 for k in subs}
        out.append(entry)
    return {"points": out, "family": family}


def _op_inflections(expr, var) -> dict:
    pts, family = _finite_solutions(solveset(diff(expr, var, 2), var, domain=S.Reals))
    subs = _pin_others(expr, var)
    return {"points": [_point(p, subs) for p in pts], "family": family}


def _op_limits_at_infinity(expr, var) -> dict:
    """Limits at ±∞; horizontal or oblique asymptotes when they exist."""
    subs = _pin_others(expr, var)
    out = []
    for direction, point in (("+inf", oo), ("-inf", -oo)):
        entry: dict[str, Any] = {"direction": direction}
        try:
            lim = limit(expr, var, point)
            if lim.has(oo, -oo):
                entry["limit"] = latex(lim)
                # Oblique asymptote: f ~ m·x + b with finite nonzero m.
                m = limit(expr / var, var, point)
                if m.is_finite and not m.is_zero:
                    b = limit(expr - m * var, var, point)
                    if b.is_finite:
                        entry["oblique_asymptote"] = {
                            "slope": _point(m, subs), "intercept": _point(b, subs)}
            else:
                entry["limit"] = _point(lim, subs)
                entry["horizontal_asymptote"] = True
        except Exception:
            entry["limit"] = None
        out.append(entry)
    return {"directions": out}


def _op_periodicity(expr, var) -> Optional[dict]:
    p = periodicity(expr, var)
    return _point(p) if p is not None else None


def _op_parity(expr, var) -> Optional[str]:
    """"even" / "odd" via simplification of f(−x) ∓ f(x); None if neither."""
    flipped = expr.subs(var, -var)
    if sympy.simplify(flipped - expr) == 0:
        return "even"
    if sympy.simplify(flipped + expr) == 0:
        return "odd"
    return None


def _op_domain(expr, var) -> Optional[str]:
    try:
        return latex(continuous_domain(expr, var, S.Reals))
    except Exception:
        return None


def _op_chart_script(expr) -> dict:
    """Evaluable mathjs script — same shape as a graph node's ``chartScript``.

    Included so consumers can plot the expression through the existing
    ``expr.js`` evaluation path instead of hand-writing evaluators.
    """
    script, variables = sympy_to_mathjs(expr)
    return {"script": script, "variables": variables}


for _fn in (_op_parse, _op_zeros, _op_singularities, _op_extrema,
            _op_inflections, _op_limits_at_infinity, _op_periodicity,
            _op_parity, _op_domain, _op_chart_script):
    cas_register_safe_function(_fn)


def _symbol_latex(name: str) -> str:
    """LaTeX display form of a sanitized variable name.

    Names arrive identifier-sanitized for mathjs (``omega``, ``v_0``,
    ``u_prime``); UIs need renderable LaTeX (``\\omega``, ``v_{0}``,
    ``u'``). SymPy handles greek/subscripts; prime suffixes are reversed
    here (mirror of mathjs_converter's ``_sanitize_primed_symbols``).
    """
    primes = ""
    for suffix, marks in (("_tprime", "'''"), ("_dprime", "''"), ("_prime", "'")):
        if name.endswith(suffix):
            name, primes = name[: -len(suffix)], marks
            break
    try:
        return latex(Symbol(name)) + primes
    except Exception:
        return name + primes


# ── public API ─────────────────────────────────────────────────────────

def pick_variable(expr, requested: Optional[str] = None) -> Optional[Symbol]:
    """Choose the sweep variable: the caller's, else by convention."""
    symbols = {str(s): s for s in expr.free_symbols}
    if not symbols:
        return None
    if requested and requested in symbols:
        return symbols[requested]
    for name in _PREFERRED_VARS:
        if name in symbols:
            return symbols[name]
    return symbols[sorted(symbols)[0]]


_UNRESOLVED = {"status": "unresolved"}


def analyze(latex_src: str, variable: Optional[str] = None,
            timeout: Optional[float] = None) -> dict:
    """Detect the full feature catalog for one LaTeX expression.

    Returns a JSON-able report::

        {
          "expression": "<normalized latex>",
          "variable": "t",
          "variables": ["g", "t", "v_0"],
          "variables_latex": {"g": "g", "t": "t", "v_0": "v_{0}"},
          "chartScript": {"script": "<mathjs>", "variables": [...]},
          "features": { "zeros": …, "extrema": …, "singularities": …,
                        "inflections": …, "limits_at_infinity": …,
                        "periodicity": …, "parity": …, "domain": … }
        }

    or ``{"error": …}`` when the expression doesn't parse. A feature whose
    guarded op timed out reports ``{"status": "unresolved"}`` — degraded,
    never absent, so the proposer can still reason about the rest.
    """
    parsed = guard(_op_parse, latex_src, default=None, timeout=timeout)
    if parsed is None:
        return {"error": f"could not parse expression: {latex_src[:200]}"}
    expr, defined = parsed

    var = pick_variable(expr, variable)
    chart_script = guard(_op_chart_script, expr, default=None, timeout=timeout)

    if var is None:
        return {
            "expression": latex(expr),
            "dependent": str(defined) if defined is not None else None,
            "dependentLatex": _symbol_latex(str(defined)) if defined is not None else None,
            "variable": None,
            "variables": [],
            "variables_latex": {},
            "chartScript": chart_script,
            "features": {"constant": _point(expr)},
        }

    def run(fn, default=_UNRESOLVED):
        return guard(fn, expr, var, default=default, timeout=timeout)

    features = {
        "zeros": run(_op_zeros),
        "extrema": run(_op_extrema),
        "singularities": run(_op_singularities),
        "inflections": run(_op_inflections),
        "limits_at_infinity": run(_op_limits_at_infinity),
        "periodicity": run(_op_periodicity, default=None),
        "parity": run(_op_parity, default=None),
        "domain": run(_op_domain, default=None),
    }
    names = sorted(str(s) for s in expr.free_symbols)
    return {
        "expression": latex(expr),
        # For a definition (``g_{feet} = \\omega^2 R``) the analyzed
        # expression is the formula and ``dependent`` names what it
        # produces — the quantity belonging on the vertical axis. None for
        # a plain expression or an equation to be solved (LHS − RHS).
        "dependent": str(defined) if defined is not None else None,
        "dependentLatex": _symbol_latex(str(defined)) if defined is not None else None,
        "variable": str(var),
        "variables": names,
        "variables_latex": {n: _symbol_latex(n) for n in names},
        "chartScript": chart_script,
        "features": features,
    }


__all__ = ["MAX_POINTS", "analyze", "pick_variable"]
