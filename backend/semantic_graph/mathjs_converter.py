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

def _protect_subscripts(latex: str) -> tuple[str, dict]:
    """Keep multi-character subscripts whole through ``parse_latex``.

    ``parse_latex`` reads ``g_{feet}`` as ``g`` times an implicit product
    ``f·e·e·t``, so the symbol arrives named ``g_f*(e*(e*t))`` — a name
    that then leaks into chart scripts, variable lists and feature LaTeX.

    The graph translator already solved this for its own pipeline, so
    reuse its collapser (which also handles Greek indices like
    ``g_{\\mu\\nu}`` and refuses to touch large-operator subscripts such
    as ``\\sum_{...}``) and map the ``\\Xi_{N}`` placeholders back onto
    clean identifier symbols here.

    Returns the rewritten LaTeX and the ``{placeholder: real}`` symbol map.
    """
    # Imported lazily: sympy_translator imports heavy graph machinery, and
    # this module is also used from lightweight contexts.
    from backend.semantic_graph.sympy_translator import (
        _collapse_multichar_subscripts, _strip_tracked_accents,
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
    rewritten, overrides = _collapse_multichar_subscripts(latex)
    mapping: dict[sympy.Symbol, sympy.Symbol] = {}
    for placeholder, meta in overrides.items():
        # meta["latex"] is the original token, e.g. ``v_{\text{rms}}``.
        clean = re.sub(r"\\(?:text|mathrm|mathit)\{([^{}]*)\}", r"\1",
                       meta.get("latex", ""))
        clean = clean.replace("\\", "").replace("{", "").replace("}", "")
        clean = re.sub(r"[^A-Za-z0-9_]", "_", clean).strip("_")
        if clean:
            mapping[sympy.Symbol(placeholder)] = sympy.Symbol(clean)
    return rewritten, mapping


# Functions whose argument ``parse_latex`` grabs greedily (see below).
_FN_NAMES = (
    "sin|cos|tan|sec|csc|cot|sinh|cosh|tanh|coth|sech|csch|"
    "arcsin|arccos|arctan|ln|log|exp"
)
# ``\cos\phi`` or ``\cos{\phi}`` followed by more factors. Not matched
# when a power follows the name (``\cos^2\phi``) or when the argument is
# already parenthesised.
_BARE_FN_ARG_RE = re.compile(
    rf"\\({_FN_NAMES})(?!\^)\s*"
    rf"(?:\{{([^{{}}]*)\}}|(\\[A-Za-z]+|[A-Za-z]))"
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
      change being what the equation is *about*

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
            if isinstance(side, Symbol) and side not in other.free_symbols:
                return other, side, None, None
            if isinstance(side, AppliedUndef) and not other.has(side.func):
                args = [a for a in side.args if isinstance(a, Symbol)]
                return (other, Symbol(side.func.__name__),
                        args[0] if len(args) == 1 else None, None)
            if isinstance(side, sympy.Derivative) and not other.has(sympy.Derivative):
                target = side.expr
                wrt = "_".join(str(v) for v, _ in side.variable_count)
                name = f"d{target}_d{wrt}"
                return other.doit(), Symbol(name), None, sympy.latex(side)
    if isinstance(expr, Rel):
        return (expr.lhs - expr.rhs).doit(), None, None, None
    return expr.doit(), None, None, None


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
