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
from sympy.core.function import AppliedUndef
from sympy.parsing.latex import parse_latex
from sympy.printing.jscode import jscode

# Tiny standalone module — no cross-import of the heavy translator.
from backend.semantic_graph.id_utils import _slug_id

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


def _sanitize_subscript_braces(expr: sympy.Basic) -> sympy.Basic:
    """Strip LaTeX subscript braces from symbol names.

    ``parse_latex`` emits ``Symbol("x_{i}")`` for ``x_i`` — the braces
    are not valid in JavaScript/mathjs identifiers.  This replaces them:

    * ``x_{i}``   → ``x_i``
    * ``p_{ij}``  → ``p_ij``
    * ``a_{12}``  → ``a_12``

    Nested braces (rare) are also stripped.
    """
    subs: dict[Symbol, Symbol] = {}
    for sym in expr.free_symbols:
        name = sym.name
        if "{" not in name and "}" not in name:
            continue
        clean = name.replace("{", "").replace("}", "")
        if clean != name:
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

    # Safety-net: strip LaTeX subscript braces that may slip through
    # (e.g. from parse_latex symbols like ``x_{i}``).
    result = result.replace("{", "").replace("}", "")

    return result.strip()


# ── LaTeX → mathjs full pipeline ──────────────────────────────────────

def _clean_placeholder_name(latex: str) -> str:
    """Turn an override's original LaTeX into a bare mathjs identifier.

    ``v_{\\text{rms}}`` → ``v_rms``, ``\\Delta v`` → ``Delta_v``.

    Delegates to :func:`_slug_id`, the same function that mints semantic
    graph node ids, so "the two paths agree on the name" holds by
    construction rather than by two implementations resembling each
    other. They did not: a hand-rolled per-character substitution turns
    ``\\Delta v_{a, b}`` into ``Delta_v_a__b`` where the graph says
    ``Delta_v_a_b``, and a name that disagrees is silently dropped
    downstream by ``_compile_view_extras``.

    Only the font-command unwrap is done here — ``_slug_id`` handles
    ``\\text`` but not ``\\mathrm``/``\\mathit``.
    """
    return _slug_id(
        re.sub(r"\\(?:mathrm|mathit)\{([^{}]*)\}", r"\1", latex))


def _protect_subscripts(latex: str) -> tuple[str, dict]:
    """Keep compound symbols and multi-char subscripts whole through parsing.

    ``parse_latex`` reads ``g_{feet}`` as ``g`` times an implicit product
    ``f·e·e·t``, so the symbol arrives named ``g_f*(e*(e*t))`` — a name
    that then leaks into chart scripts, variable lists and feature LaTeX.
    ``\\Delta v`` fares no better: it becomes ``Symbol('Delta') * v``, so
    a phantom ``Delta`` gets its own slider and the plotted residual is a
    different expression entirely (issue #531).

    The graph translator already solved both for its own pipeline, so
    reuse its collapsers (which also handle Greek indices like
    ``g_{\\mu\\nu}`` and refuse to touch large-operator subscripts such
    as ``\\sum_{...}``) and map the ``\\Theta_{N}`` / ``\\Xi_{N}``
    placeholders back onto clean identifier symbols here.

    Returns the rewritten LaTeX and the ``{placeholder: real}`` symbol map.
    """
    # Imported lazily: sympy_translator imports heavy graph machinery, and
    # this module is also used from lightweight contexts.
    from backend.semantic_graph.sympy_translator import (
        _collapse_compound_symbols, _collapse_multichar_subscripts,
        _strip_tracked_accents,
    )

    # ``parse_latex`` reads an accent command as a factor: ``\hat{n}``
    # becomes ``Symbol('hat') * Symbol('n')``, so a phantom ``hat``
    # variable turns up with its own slider. The graph translator already
    # strips these; the accent is display-only, so dropping it here is
    # exactly right for evaluation.
    latex = _strip_tracked_accents(latex, {})

    # ``\dot{h}`` is a derivative, not an accent — parse_latex would read
    # it as ``Symbol('dot') * h``. The preprocessor rewrites it to
    # ``\frac{dh}{dt}``, which parses as a real Derivative.
    from backend.semantic_graph.preprocessor import LaTeXPreprocessor
    latex = LaTeXPreprocessor.rewrite_dot_derivatives(latex)

    # ``\text``/``\mathrm`` wrappers *inside a subscript* are display-only
    # (``g_{\text{feet}}``); unwrap them so the collapser sees plain letters.
    # The graph pipeline handles free-standing \text via its own pass.
    latex = re.sub(r"_\{\\(?:text|mathrm|mathit)\{([^{}]*)\}\}", r"_{\1}", latex)

    # Compound identifiers first, matching the graph pipeline's order, so
    # ``\Delta v_{e}`` is taken whole rather than split at the subscript.
    rewritten, overrides = _collapse_compound_symbols(latex)
    rewritten, subscript_overrides = _collapse_multichar_subscripts(rewritten)
    overrides.update(subscript_overrides)

    mapping: dict[sympy.Symbol, sympy.Symbol] = {}
    for placeholder, meta in overrides.items():
        # meta["latex"] is the original token, e.g. ``v_{\text{rms}}``
        # or ``\Delta v``.
        clean = _clean_placeholder_name(meta.get("latex", ""))
        if clean:
            mapping[sympy.Symbol(placeholder)] = sympy.Symbol(clean)
    return rewritten, mapping


# Functions whose argument ``parse_latex`` grabs greedily (see below).
_FN_NAMES = (
    "sin|cos|tan|sec|csc|cot|sinh|cosh|tanh|coth|sech|csch|"
    "arcsin|arccos|arctan|ln|log|exp"
)
# A bare argument is a single letter or a Greek-letter command — and
# nothing else. The whitelist matters: matching any ``\cmd`` swallows the
# sizing command in ``\log\left(\frac{m_0}{m_f}\right)``, rewriting it to
# ``\log(\left)(...)`` — which does not parse at all, so an expression the
# reader can see on screen is dropped entirely (found via #531).
_GREEK_ARG = (
    "alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|"
    "iota|kappa|lambda|mu|nu|xi|omicron|pi|varpi|rho|varrho|sigma|"
    "varsigma|tau|upsilon|phi|varphi|chi|psi|omega|"
    "Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|ell|hbar"
)
# ``\cos\phi`` or ``\cos{\phi}`` followed by more factors. Not matched
# when a power follows the name (``\cos^2\phi``) or when the argument is
# already parenthesised.
_BARE_FN_ARG_RE = re.compile(
    rf"\\({_FN_NAMES})(?!\^)\s*"
    rf"(?:\{{([^{{}}]*)\}}|(\\(?:{_GREEK_ARG})(?![A-Za-z])|[A-Za-z]))"
    rf"((?:_\{{[^{{}}]*\}}|_[A-Za-z0-9])?)"
)


def _parenthesize_function_args(latex: str) -> str:
    r"""Bracket a function's argument so it cannot swallow the product.

    ``parse_latex`` reads ``\cos\phi \cdot a`` as ``cos(a \phi)`` and
    ``\sin\theta \cdot b \cdot c`` as ``sin(c(b\theta))`` — the whole
    trailing product is absorbed into the argument, silently plotting a
    different function. Only the parenthesised form parses correctly, so
    make the argument explicit before handing the string over.
    """
    def repl(m: re.Match) -> str:
        fn, braced, bare, sub = m.groups()
        return f"\\{fn}({(braced if braced is not None else bare)}{sub})"

    return _BARE_FN_ARG_RE.sub(repl, latex)


def _parse_normalized(latex: str, keep_derivatives: bool = False) -> sympy.Basic:
    """Parse + normalize, leaving any relation intact.

    Shared front half of :func:`latex_to_sympy`: subscript protection,
    constant substitution, ``doit()`` and identifier sanitizing, but no
    relation collapsing — callers decide what an equation means.

    Raises
    ------
    ValueError:
        If ``parse_latex`` cannot parse the input.
    """
    protected, subscript_map = _protect_subscripts(
        _parenthesize_function_args(latex))
    try:
        expr = parse_latex(protected)
    except Exception as exc:
        raise ValueError(f"parse_latex failed: {exc}") from exc

    # Restore multi-character subscripts (g_{900000} → g_feet).
    if subscript_map:
        expr = expr.subs(subscript_map)

    # Replace Symbol('e') → E, Symbol('pi') → π, etc.
    expr = expr.subs(_SYMBOL_TO_CONSTANT)

    # Normalize sub-expressions that ``parse_latex`` leaves in
    # un-evaluated form (e.g. ``log(x, E)`` with two args instead of
    # the canonical single-arg ``log(x)``).
    #
    # ``doit()`` also EVALUATES derivatives, and ``d/dt h`` where ``h`` is
    # a plain symbol (not a function of t) evaluates to ZERO — silently
    # deleting the subject of an equation like ``dh/dt = -V sin γ``.
    # Callers that read such an equation as a definition ask to keep it.
    if not (keep_derivatives and expr.has(sympy.Derivative)):
        expr = expr.doit()

    # Sanitize primed symbols (u' → u_prime) so jscode emits valid
    # JavaScript identifiers.
    expr = _sanitize_primed_symbols(expr)

    # Strip LaTeX subscript braces (x_{i} → x_i) so jscode emits
    # valid JavaScript/mathjs identifiers.
    return _sanitize_subscript_braces(expr)


def latex_to_sympy(latex: str) -> sympy.Basic:
    """Parse LaTeX into a normalized SymPy expression.

    Relations collapse to ``LHS - RHS`` so a chart can plot the
    zero-crossing — the long-standing behaviour the chart pipeline
    depends on. Use :func:`latex_to_sympy_defined` when an equation that
    *defines* a quantity should be read as that quantity instead.
    """
    expr = _parse_normalized(latex)
    if isinstance(expr, Rel):
        expr = expr.lhs - expr.rhs
    return expr


def latex_to_sympy_defined(
    latex: str,
) -> tuple[sympy.Basic, sympy.Symbol | None, sympy.Symbol | None, str | None]:
    """Parse LaTeX, reading a definition as the quantity it defines.

    An equation whose one side names a quantity that does not occur on the
    other is a *definition*: the natural reading is "plot the formula, call
    the vertical axis by that name", not "plot the difference and hunt for
    its zero". Two forms qualify:

    * a bare symbol — ``g_{feet} = \\omega^2 R``
    * a function application — ``\\rho(h) = \\rho_0 e^{-h/H}``, whose
      argument is also the obvious variable to sweep (and whose unapplied
      ``rho(h)`` term would otherwise poison the generated script)
    * a derivative — ``\\frac{d}{dt} h = -V \\sin\\gamma``, the rate of
      change being what the equation is *about*. It need NOT sit alone on
      its side: ``m \\frac{dv}{dt} + bv = F`` is still a statement about
      ``dv/dt``, so the equation is solved for it (issue #535).

    Returns ``(formula, defined_symbol, argument, display_latex)``.
    ``argument`` is set only for the function form, ``display_latex`` only
    when the defined quantity does not render as a plain symbol. Every
    other relation (an equation to be solved, an inequality) still gives
    ``(LHS - RHS, None, None, None)``, as does a plain expression.
    """
    expr = _parse_normalized(latex, keep_derivatives=True)
    if isinstance(expr, sympy.Eq):
        lhs, rhs = expr.lhs, expr.rhs
        for side, other in ((lhs, rhs), (rhs, lhs)):
            # ``not other.has(Derivative)`` on the next two: a side carrying an
            # unevaluatable derivative can never become the plotted expression,
            # because ``Derivative(v, t)`` is SymPy repr, not mathjs. Without
            # this, ``m dv/dt + bv = F`` matched "F is defined by the left" and
            # shipped that string to the browser to evaluate (#535).
            if (isinstance(side, Symbol) and side not in other.free_symbols
                    and not other.has(sympy.Derivative)):
                return other, side, None, None
            if (isinstance(side, AppliedUndef) and not other.has(side.func)
                    and not other.has(sympy.Derivative)):
                args = [a for a in side.args if isinstance(a, Symbol)]
                return (other, Symbol(side.func.__name__),
                        args[0] if len(args) == 1 else None, None)
            if isinstance(side, sympy.Derivative) and not other.has(sympy.Derivative):
                return other.doit(), _derivative_symbol(side), None, sympy.latex(side)

        # A derivative buried in a sum or product is STILL what the equation is
        # about, so isolate it rather than collapsing. Falling through to
        # ``.doit()`` below would evaluate ``Derivative(Symbol('v'), t)`` to
        # ZERO — SymPy is right that a plain Symbol has no t-dependence, but the
        # reader meant an unknown function of t. The term simply vanished, and
        # ``dv/dt + kv = 0`` plotted ``k·v``: the sign of a physics curve,
        # silently flipped, with nothing failing anywhere (#535).
        solved = _solve_for_derivative(lhs, rhs)
        if solved is not None:
            return solved

    collapsed = (expr.lhs - expr.rhs) if isinstance(expr, Rel) else expr
    return _resolve_derivatives(collapsed), None, None, None


def _derivative_symbol(d: sympy.Derivative) -> Symbol:
    """A flat identifier for a derivative — ``Derivative(v, t)`` -> ``dv_dt``."""
    wrt = "_".join(str(v) for v, _ in d.variable_count)
    return Symbol(f"d{d.expr}_d{wrt}")


def _solve_for_derivative(lhs, rhs):
    """``(formula, dv_dt, None, latex)`` when the equation resolves to one
    derivative, else None.

    Only attempted for a SINGLE derivative with a SINGLE solution: more than
    one of either is not a rate this expression is "about", and guessing which
    would be exactly the kind of silent choice #535 is about.
    """
    derivs = (lhs - rhs).atoms(sympy.Derivative)
    if len(derivs) != 1:
        return None
    d = next(iter(derivs))
    try:
        sols = sympy.solve(sympy.Eq(lhs - rhs, 0), d)
    except Exception:
        return None
    if len(sols) != 1:
        return None
    return sols[0], _derivative_symbol(d), None, sympy.latex(d)


def _is_opaque_derivative(d: sympy.Derivative) -> bool:
    """True when ``.doit()`` would evaluate ``d`` to zero rather than compute it.

    The distinction the whole fix turns on. ``Derivative(x**2, x)`` is real
    calculus and ``.doit()`` gives ``2x``; ``Derivative(v, t)`` — a bare symbol
    against a variable it does not contain — evaluates to **0**, because SymPy
    is correctly told ``v`` has no ``t``-dependence while the reader meant an
    unknown function of ``t``.
    """
    wrt = {var for var, _ in d.variable_count}
    return not (d.expr.free_symbols & wrt)


def _resolve_derivatives(expr):
    """Evaluate what is genuinely computable; flatten only what is not.

    Order matters, and getting it wrong is a regression rather than a nuance
    (Copilot, #536). Flattening *everything* before ``.doit()`` would turn a
    standalone ``\\frac{d}{dx} x^2`` into a symbol instead of ``2x`` — and one
    named ``dx**2_dx`` at that, which is not even a valid identifier. So:

    1. flatten only the OPAQUE derivatives, which ``.doit()`` would zero;
    2. ``.doit()``, so real calculus is still performed;
    3. flatten anything left, so no ``Derivative`` can reach ``sympy_to_mathjs``
       — the browser has no such function.

    A symbol is the honest representation for step 1 and 3: the chart samples
    scalars, so there is no trajectory to differentiate and nothing to
    *compute*. The rate is an INPUT, and gets its own slider —
    ``m·(dv/dt) + bv = F`` then reads as "what force does this acceleration
    require at this speed?".
    """
    opaque = {d: _derivative_symbol(d) for d in expr.atoms(sympy.Derivative)
              if _is_opaque_derivative(d)}
    expr = expr.subs(opaque).doit() if opaque else expr.doit()
    leftover = {d: _derivative_symbol(d) for d in expr.atoms(sympy.Derivative)}
    return expr.subs(leftover) if leftover else expr


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
    return sympy_to_mathjs(latex_to_sympy(latex))


def sympy_to_mathjs(expr: sympy.Basic) -> tuple[str, list[str]]:
    """Code-generate a mathjs script from an already-normalized SymPy expression.

    The back half of :func:`latex_to_mathjs`, exposed for callers that
    already hold the parsed expression (e.g. the expression-analysis
    expert, which parses once and derives many artifacts from it).
    """
    # Extract free variables (after substitution).
    variables = sorted(str(s) for s in expr.free_symbols)

    # Generate JavaScript, then convert to mathjs.
    js = jscode(expr, strict=False)
    script = jscode_to_mathjs(js)

    return script, variables
