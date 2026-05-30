"""Convert LaTeX math expressions to mathjs-compatible script strings.

Pipeline: LaTeX → ``parse_latex()`` → SymPy → ``jscode()`` → regex
conversion → mathjs string.

The public API is :func:`latex_to_mathjs` which accepts a raw LaTeX
string (typically the ``subexpr`` field on a semantic graph node) and
returns a ``(script, variables)`` tuple ready for client-side
``math.compile()`` / ``compiled.evaluate(scope)``.

Relations (``Eq``, ``Gt``, ``Lt``, …) are automatically converted to
``LHS - RHS`` so charts can plot zero-crossings.
"""

from __future__ import annotations

import re

import sympy
from sympy import E, Rel, Symbol
from sympy import pi as sympy_pi
from sympy.parsing.latex import parse_latex
from sympy.printing.jscode import jscode

# ── Constants ──────────────────────────────────────────────────────────

# Symbols that ``parse_latex`` emits as plain ``Symbol`` instances but
# which should be treated as SymPy constants for numeric evaluation.
_SYMBOL_TO_CONSTANT: dict[Symbol, sympy.Basic] = {
    Symbol("e"): E,
    Symbol("pi"): sympy_pi,
}

# ``jscode`` emits ``Math.<name>`` — map the few constant names to their
# mathjs equivalents.  Function names (``sin``, ``cos``, …) just drop
# the ``Math.`` prefix since mathjs uses bare function names.
_JS_CONST_MAP: dict[str, str] = {
    "PI": "pi",
    "E": "e",
    "LN2": "ln2",
    "LN10": "ln10",
    "SQRT2": "sqrt(2)",
    "SQRT1_2": "sqrt(1/2)",
}


# ── Prime-character helpers ───────────────────────────────────────────

_PRIME_SUFFIXES = {1: "prime", 2: "dprime", 3: "tprime"}


def _prime_suffix(count: int) -> str:
    """Return a suffix for *count* prime marks: 1→prime, 2→dprime, etc."""
    return _PRIME_SUFFIXES.get(count, f"{count}prime")


def _sanitize_primed_symbols(expr: sympy.Basic) -> sympy.Basic:
    """Replace primed free symbols with valid-identifier equivalents.

    ``Symbol("u'")`` → ``Symbol("u_prime")``, ``Symbol("x''")`` →
    ``Symbol("x_dprime")``, etc.  This ensures ``jscode()`` emits valid
    JavaScript/mathjs identifiers.
    """
    subs: dict[Symbol, Symbol] = {}
    for sym in expr.free_symbols:
        name = sym.name
        if "'" not in name:
            continue
        base = name.rstrip("'")
        prime_count = len(name) - len(base)
        clean = f"{base}_{_prime_suffix(prime_count)}" if base else f"_{_prime_suffix(prime_count)}"
        subs[sym] = Symbol(clean)
    return expr.subs(subs) if subs else expr


# ── jscode → mathjs conversion ────────────────────────────────────────

def jscode_to_mathjs(js_code: str) -> str:
    """Convert SymPy ``jscode()`` output to a mathjs-compatible string.

    Transformations performed:

    * ``Math.sin(x)``  →  ``sin(x)``  (strip ``Math.`` prefix)
    * ``Math.PI``      →  ``pi``      (map JS constants)
    * ``Math.E``       →  ``e``
    * Comment blocks emitted by ``jscode(strict=False)`` for unsupported
      functions are stripped, leaving bare function names that mathjs
      handles natively (e.g. ``factorial(x)``).
    * Prime characters in identifiers are sanitized:
      ``u'`` → ``u_prime``, ``u''`` → ``u_dprime``.
    """
    # Strip ``// Not supported …`` comment lines.
    js_code = re.sub(r"//[^\n]*\n?", "", js_code)

    # Replace ``Math.<name>`` with either a constant alias or the bare
    # function name.
    def _replace(m: re.Match) -> str:
        name = m.group(1)
        return _JS_CONST_MAP.get(name, name)

    result = re.sub(r"Math\.(\w+)", _replace, js_code)

    # Safety-net: sanitize any remaining prime characters in identifiers.
    # ``jscode`` may emit ``u'`` or ``u''`` for primed symbols — these
    # are not valid JS/mathjs identifiers.
    result = re.sub(r"(\w)('{2,})", lambda m: m.group(1) + "_" + _prime_suffix(len(m.group(2))), result)
    result = re.sub(r"(\w)'", r"\1_prime", result)

    return result.strip()


# ── LaTeX → mathjs full pipeline ──────────────────────────────────────

def latex_to_mathjs(latex: str) -> tuple[str, list[str]]:
    """Convert a LaTeX expression to a mathjs script string.

    Parameters
    ----------
    latex:
        Raw LaTeX (e.g. the ``subexpr`` field of a semantic graph node).

    Returns
    -------
    (script, variables):
        *script* is a mathjs-compatible expression string.
        *variables* is a sorted list of free-symbol names (variables the
        caller must supply numeric values for).

    Raises
    ------
    ValueError:
        If ``parse_latex`` cannot parse the input.

    Notes
    -----
    * Relations (``=``, ``>``, ``<``, ``\\geq``, ``\\leq``, ``\\neq``)
      are automatically converted to ``LHS - RHS`` so the chart can
      plot the zero-crossing.
    * ``Symbol('e')`` and ``Symbol('pi')`` are replaced with SymPy's
      numeric constants ``E`` and ``pi`` before code generation so they
      don't appear as free variables.
    """
    try:
        expr = parse_latex(latex)
    except Exception as exc:
        raise ValueError(f"parse_latex failed: {exc}") from exc

    # Auto-detect relations and build LHS − RHS.
    if isinstance(expr, Rel):
        expr = expr.lhs - expr.rhs

    # Replace Symbol('e') → E, Symbol('pi') → π, etc.
    expr = expr.subs(_SYMBOL_TO_CONSTANT)

    # Normalize sub-expressions that ``parse_latex`` leaves in
    # un-evaluated form (e.g. ``log(x, E)`` with two args instead of
    # the canonical single-arg ``log(x)``).
    expr = expr.doit()

    # Sanitize primed symbols (u' → u_prime) so jscode emits valid
    # JavaScript identifiers.
    expr = _sanitize_primed_symbols(expr)

    # Extract free variables (after substitution).
    variables = sorted(str(s) for s in expr.free_symbols)

    # Generate JavaScript, then convert to mathjs.
    js = jscode(expr, strict=False)
    script = jscode_to_mathjs(js)

    return script, variables
