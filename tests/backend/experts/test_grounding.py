"""Tests for sympy grounding + trajectory consistency."""

from __future__ import annotations

import sympy as sp
import pytest

from backend.semantic_graph.service import SemanticGraphService
from backend.experts.modules.proof_completion import dataset as D
from backend.experts.modules.proof_completion.graph_ops import apply
from backend.experts.modules.proof_completion.grounding import (
    graph_to_sympy,
    is_grounded,
    per_step_groundable,
    step_groundings,
    sympy_equiv,
    trajectory_consistent,
)

SVC = SemanticGraphService()
x, y, a, b, n, v = sp.symbols("x y a b n v")

ROUNDTRIP = [
    (r"x^2 + 2 x + 1", x ** 2 + 2 * x + 1),
    (r"(x+1)^2", (x + 1) ** 2),
    (r"a^2 - b^2", a ** 2 - b ** 2),
    (r"(a-b)(a+b)", (a - b) * (a + b)),
    (r"\frac{d}{dx} x^3", sp.Derivative(x ** 3, x)),
    (r"\int_0^1 x^2 dx", sp.Integral(x ** 2, (x, 0, 1))),   # definite
    (r"\int x^2 dx", sp.Integral(x ** 2, x)),                # indefinite
    # Integration variable read off the first-class ``differential`` node:
    (r"\int \frac{1}{v} dv", sp.Integral(1 / v, v)),
    (r"\int dx", sp.Integral(1, x)),                         # bare differential
    (r"\int \int (x+y) \, dx \, dy", sp.Integral(x + y, x, y)),  # multi-variable
    (r"\frac{a}{b}", a / b),
    (r"x^{n}", x ** n),
    # Logarithms carry their base as a separate ``base``-role operand (``e`` for
    # ``\ln``/bare ``\log``); the grounder must split it off the argument so the
    # base doesn't fail the single-arg check (regression: #log-grounding).
    (r"\ln(v)", sp.log(v)),
    (r"\log(x)", sp.log(x)),
    (r"\log_{2}(x)", sp.log(x, 2)),
]


@pytest.mark.parametrize("latex,expected", ROUNDTRIP)
def test_graph_grounds_to_source_expression(latex, expected):
    g = SVC.latex_to_graph(latex)
    assert sympy_equiv(graph_to_sympy(g), expected)
    assert is_grounded(g, expected) is True


def test_sympify_exponent_handles_all_stored_forms_and_bad_input():
    # A power node's exponent is stored as a plain number ("2"), a LaTeX subexpr
    # ("-z^{2}" for e^{-z^2}), or — if the model emits junk — malformed LaTeX. The
    # first two must ground; the third must raise UngroundableGraph (the clean
    # "can't ground this" signal callers handle), NOT bubble up a raw parse_latex
    # exception that aborts the whole grounding.
    from backend.experts.modules.proof_completion.grounding import (
        _sympify_exponent, UngroundableGraph,
    )
    z = sp.Symbol("z")
    assert _sympify_exponent("2") == 2                 # numeric fast path (sympify)
    assert _sympify_exponent("-z^{2}") == -z ** 2      # LaTeX fallback (parse_latex)
    with pytest.raises(UngroundableGraph):
        _sympify_exponent(r"\frac{")                   # malformed → clean raise


def test_legacy_integral_without_differential_node_still_grounds():
    """Back-compat: an older graph that carries the integration variable on the
    integral's ``with_respect_to`` (with a ``wrt`` edge from the bare variable,
    no ``differential`` node) must still ground to the right ``Integral``."""
    from backend.model.semantic_graph import SemanticGraph
    legacy = SemanticGraph.model_validate({
        "nodes": [
            {"id": "__integral_1", "type": "operator", "op": "integral",
             "with_respect_to": "x"},
            {"id": "x", "type": "scalar", "latex": "x"},
            {"id": "__power_2", "type": "operator", "op": "power", "exponent": "2"},
        ],
        "edges": [
            {"from": "x", "to": "__integral_1", "role": "wrt"},
            {"from": "x", "to": "__power_2"},
            {"from": "__power_2", "to": "__integral_1"},
        ],
    })
    assert sympy_equiv(graph_to_sympy(legacy), sp.Integral(x ** 2, x))


def test_grounding_rejects_wrong_expression():
    g = SVC.latex_to_graph(r"x^2 + 2 x + 1")
    assert is_grounded(g, x ** 2 + 3 * x + 1) is False


def test_equations_ground_up_to_sign():
    g = SVC.latex_to_graph(r"F = m a")
    F, m, aa = sp.symbols("F m a")
    assert is_grounded(g, sp.Eq(F, m * aa)) is True
    assert is_grounded(g, sp.Eq(m * aa, F)) is True  # sides swapped


def test_expanded_and_factored_forms_are_equivalent():
    # different graphs, same math: factored vs expanded both ground equal
    factored = SVC.latex_to_graph(r"(a-b)(a+b)")
    assert is_grounded(factored, a ** 2 - b ** 2) is True


def test_inequalities_and_logic_ground():
    cases = [
        (r"2 x + 1 < 7", sp.Lt(2 * x + 1, 7)),
        (r"3 x \leq 9", sp.Le(3 * x, 9)),
        (r"x^2 \geq 4", sp.Ge(x ** 2, 4)),
        (r"x \neq 0", sp.Ne(x, 0)),
        (r"x > 2 \implies x > 0", sp.Implies(sp.Gt(x, 2), sp.Gt(x, 0))),
    ]
    for latex, expected in cases:
        g = SVC.latex_to_graph(latex)
        assert is_grounded(g, expected) is True, latex


def test_inequality_direction_is_respected():
    # 3 > x is the same relation as x < 3 (canonical), but x < 3 != x <= 3
    assert sympy_equiv(sp.Gt(3, x), sp.Lt(x, 3)) is True
    assert sympy_equiv(sp.Lt(x, 3), sp.Le(x, 3)) is False
    # a true inequality must not match its reverse
    assert sympy_equiv(sp.Lt(x, 3), sp.Gt(x, 3)) is False


def test_inequality_and_logic_domains_are_groundable():
    for dom in ("inequalities", "logic"):
        exs = D.generate(n=4, seed=4, domains=[dom], max_ops=120)
        assert exs, f"no examples for {dom}"
        for e in exs:
            sg = step_groundings(e.context.start, e.gold_ops, e.step_exprs)
            assert all(s is True for s in sg), (dom, sg)


def test_trajectory_consistent_on_gold():
    exs = D.generate(n=6, seed=99, max_steps=1)
    assert exs
    for ex in exs:
        assert trajectory_consistent(ex.context.start, ex.gold_ops, ex.context.target)


def test_trajectory_inconsistent_when_ops_missing():
    exs = D.generate(n=3, seed=1, max_steps=1)
    ex = exs[0]
    # dropping the last op should break the reconstruction
    assert not trajectory_consistent(ex.context.start, ex.gold_ops[:-1], ex.context.target)


def test_multistep_generation_tags_steps_and_grounds_every_waypoint():
    exs = D.generate(n=20, seed=1, max_steps=3, max_ops=60)
    assert exs
    multi = [e for e in exs if e.n_steps > 1]
    assert multi, "expected at least one multi-step chain"
    for e in exs:
        # ops are tagged with contiguous 1..n_steps step indices
        assert sorted(set(o.step for o in e.gold_ops)) == list(range(1, e.n_steps + 1))
        # one expected expression per step
        assert len(e.step_exprs) == e.n_steps
        # every waypoint of the gold trajectory grounds to its expected expr
        assert all(s is True for s in step_groundings(
            e.context.start, e.gold_ops, e.step_exprs))


def test_per_step_groundable_counts_valid_waypoints():
    exs = D.generate(n=6, seed=2, max_steps=3, max_ops=60)
    e = next(x for x in exs if x.n_steps > 1)
    ok, total = per_step_groundable(e.context.start, e.gold_ops)
    assert total == e.n_steps
    assert ok == total  # gold waypoints are all valid math


def test_dataset_carries_source_expressions():
    exs = D.generate(n=6, seed=5, max_steps=1)
    for ex in exs:
        assert ex.start_expr is not None and ex.target_expr is not None
        # applying gold to start yields a graph that is never grounded to the
        # WRONG math (True when groundable, None when the walk can't model it).
        applied = apply(ex.context.start, ex.gold_ops)
        assert is_grounded(applied, ex.target_expr) is not False


def test_dirac_kets_and_bras_ground_symmetrically():
    # Kets and bras are Dirac leaves keyed by their rendered content, so the same
    # ket/bra in two states maps to the same sympy atom (cross-state equivalence).
    # The renderer handles both `ket` and `bra`; grounding must too (regression:
    # bra nodes used to raise "node type 'bra'" while kets grounded).
    from sympy.physics.quantum.state import Ket, Bra
    ket = graph_to_sympy(SVC.latex_to_graph(
        r"\lvert\psi\rangle = \alpha\lvert 0\rangle + \beta\lvert 1\rangle", domain="quantum"))
    al, be = sp.symbols(r"\alpha \beta")
    assert ket == sp.Eq(Ket(r"\psi"), al * Ket("0") + be * Ket("1"))
    # bra: same shape, Bra atoms — must not raise
    bra = graph_to_sympy(SVC.latex_to_graph(
        r"\langle\phi\rvert = 2\langle 0\rvert + 3\langle 1\rvert", domain="quantum"))
    assert bra == sp.Eq(Bra(r"\phi"), 2 * Bra("0") + 3 * Bra("1"))


def test_chained_inequality_grounds_as_conjunction():
    # "a <= g <= b" (an entry-corridor-style bound) parses with a nested
    # relation; it must ground to the standard conjunction And(a<=g, g<=b).
    g = SVC.latex_to_graph(r"a \leq x \leq b")
    got = graph_to_sympy(g)
    expected = sp.And(a <= x, x <= b)
    assert sympy_equiv(got, expected)
    assert is_grounded(g, expected) is True
    # and a WRONG corridor is rejected, not blessed
    assert is_grounded(g, sp.And(a <= x, x <= a)) is False


def test_undefined_function_application_grounds_opaquely():
    # ``f(x) = ...`` — a function name the grounder doesn't model — used to raise
    # UngroundableGraph("function 'f'"), dropping the state to "unchecked" in the
    # step checker. It must ground as an *undefined* sympy function application:
    # opaque (nothing evaluates) but structurally comparable across states.
    f = sp.Function("f")
    got = graph_to_sympy(SVC.latex_to_graph(r"f(x) = x^2"))
    assert got == sp.Eq(f(x), x ** 2)
    # the real regression: the normal-distribution PDF finale (substitute the
    # derived constant back into the density's general form)
    pdf = graph_to_sympy(SVC.latex_to_graph(
        r"f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}",
        domain="statistics"))
    assert isinstance(pdf, sp.Equality)
    assert pdf.lhs.func == f
    # opaque soundness: same function+args equal, different functions are not
    assert graph_to_sympy(SVC.latex_to_graph(r"f(x)")) == f(x)
    assert graph_to_sympy(SVC.latex_to_graph(r"g(x)")) != f(x)


def test_substitution_into_definition_grades_plausible_not_unchecked():
    # The transition "C = 1/(σ√(2π))  →  f(x) = C·e^{...} with C substituted"
    # introduces a definition rather than transforming the previous equation, so
    # the CAS cannot decide it — but with f(x) grounding as an undefined function
    # the state is convertible, and the pair must rank BLUE (plausible, eligible
    # for the domain-judge rescue) instead of GRAY (unchecked).
    from backend.experts.modules.proof_completion.step_grounding import (
        Tier, classify_pair,
    )
    prev = graph_to_sympy(SVC.latex_to_graph(
        r"C = \frac{1}{\sigma \sqrt{2 \cdot \pi}}", domain="statistics"))
    curr = graph_to_sympy(SVC.latex_to_graph(
        r"f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}",
        domain="statistics"))
    verdict = classify_pair(prev, curr, change_type="substitute", index=9)
    assert verdict.tier == Tier.BLUE


def test_capital_E_is_free_symbol():
    """Capital E must ground as a free symbol, not Euler's number (issue #526)."""
    E = sp.Symbol("E")
    m, c = sp.symbols("m c")
    # E^2 should be E**2, not exp(2)
    assert graph_to_sympy(SVC.latex_to_graph(r"E^2")) == E**2
    # E = mc^2 should have E as a free symbol
    result = graph_to_sympy(SVC.latex_to_graph(r"E = m c^2"))
    assert result == sp.Eq(E, m * c**2)


# --------------------------------------------------------------------------- #
# named constants (issue #541)
# --------------------------------------------------------------------------- #

CONSTANT_GROUNDING = [
    # \pi and \infty reach the grounder as LaTeX ("\pi", "\infty"), not as the
    # bare names the old table was keyed on — so they used to survive as free
    # symbols and silently poison every comparison they took part in.
    (r"\sin(\pi)", sp.Integer(0)),
    (r"\cos(2\pi)", sp.Integer(1)),
    (r"\tan(\frac{\pi}{4})", sp.Integer(1)),
    (r"\frac{\pi}{2}", sp.pi / 2),
    (r"\pi r^2", sp.pi * sp.Symbol("r") ** 2),
    (r"2\pi", 2 * sp.pi),
    (r"\sqrt{\pi}", sp.sqrt(sp.pi)),
    (r"\infty", sp.oo),
]


@pytest.mark.parametrize("latex,expected", CONSTANT_GROUNDING)
def test_named_constants_ground_to_sympy_values(latex, expected):
    assert graph_to_sympy(SVC.latex_to_graph(latex)) == expected


@pytest.mark.parametrize("latex", [r"\sin(\pi)", r"\pi r^2", r"2\pi", r"\infty",
                                   r"\frac{\pi}{2}"])
def test_pi_and_infinity_are_never_free_symbols(latex):
    """The sharp end of #541: a free ``\\pi`` makes two *different* expressions
    compare equal because both sides agree on the same meaningless symbol."""
    free = {str(s) for s in graph_to_sympy(SVC.latex_to_graph(latex)).free_symbols}
    assert r"\pi" not in free and "pi" not in free
    assert r"\infty" not in free and "oo" not in free


def test_pi_carrying_expressions_are_distinguishable():
    """With \\pi free, these graded as equivalent; with \\pi grounded they don't."""
    half = graph_to_sympy(SVC.latex_to_graph(r"\sin(\frac{\pi}{2})"))
    whole = graph_to_sympy(SVC.latex_to_graph(r"\sin(\pi)"))
    assert half == 1 and whole == 0
    assert not sympy_equiv(half, whole)


def test_lowercase_e_still_grounds_to_eulers_number():
    """Regression guard for #526/#538: ``e`` is Euler's number, ``E`` is free."""
    assert graph_to_sympy(SVC.latex_to_graph(r"e")) == sp.E
    assert graph_to_sympy(SVC.latex_to_graph(r"e^x")) == sp.exp(x)
    assert graph_to_sympy(SVC.latex_to_graph(r"E")) == sp.Symbol("E")


@pytest.mark.parametrize("latex", [r"i", r"i^2", r"a_i + i", r"z = a + b i"])
def test_index_i_stays_a_free_symbol(latex):
    """``i`` is far more often an index (``a_i``, ``\\sum_i``) than the imaginary
    unit, and the parser spells both ``latex="i"`` on a *scalar* leaf. Grounding
    it by name would reintroduce #526 in a much more common spelling, so bare
    ``i`` is deliberately left alone (#541)."""
    got = graph_to_sympy(SVC.latex_to_graph(latex))
    assert sp.Symbol("i") in got.free_symbols
    assert sp.I not in got.atoms()


def test_constant_leaves_ground_the_imaginary_unit():
    """A ``type="constant"`` leaf is only emitted when the sympy expression *is*
    that constant, so it carries the provenance a bare symbol lacks — ``i`` is
    safe to ground there even though it is not safe to ground by name."""
    from backend.experts.modules.proof_completion.grounding import (
        _CONSTANTS, _CONSTANTS_BY_TYPE, _symbol,
    )
    from backend.model.semantic_graph import SemanticGraphNode

    assert _CONSTANTS_BY_TYPE["i"] is sp.I
    assert "i" not in _CONSTANTS          # ...but not by bare name
    assert _symbol(SemanticGraphNode(id="c1", type="constant", latex="i")) is sp.I
    assert _symbol(SemanticGraphNode(id="s1", type="scalar", latex="i")) == sp.Symbol("i")


def test_constant_table_is_derived_from_the_parser_s_spellings():
    """The grounder's table and ``CONSTANT_MAP`` drifted once (#541); deriving
    one from the other is what keeps them from drifting again."""
    from backend.experts.modules.proof_completion.grounding import _CONSTANTS_BY_TYPE
    from backend.semantic_graph.constants import CONSTANT_MAP

    for const, meta in CONSTANT_MAP.items():
        assert _CONSTANTS_BY_TYPE[meta["latex"]] is const


def test_no_known_variable_is_typed_constant_as_i():
    """The ``i`` split in ``_symbol`` grounds ``latex="i"`` on a *constant* leaf
    to ``sp.I`` while leaving scalar ``i`` free. That is only sound while no
    constant-typed node can carry ``latex="i"`` — ``CONSTANT_MAP`` maps it from
    ``sp.I`` alone, and ``KNOWN_VARIABLES`` types only ``pi`` as a constant.
    A new ``KNOWN_VARIABLES`` entry typed ``"constant"`` with ``latex="i"``
    would silently turn every index ``i`` into the imaginary unit (#526/#541),
    so pin it here rather than trusting the comment (PR #556 review)."""
    from backend.semantic_graph.constants import KNOWN_VARIABLES

    typed_constant = {
        name: meta for name, meta in KNOWN_VARIABLES.items()
        if meta.get("type") == "constant"
    }
    assert all(meta.get("latex") != "i" for meta in typed_constant.values()), (
        f"a KNOWN_VARIABLES entry is typed constant with latex='i': {typed_constant}"
    )
    # ...and the one entry that *is* typed constant must agree with CONSTANT_MAP,
    # so routing it through the constant tier can't change its value.
    from backend.experts.modules.proof_completion.grounding import _CONSTANTS_BY_TYPE
    for name, meta in typed_constant.items():
        assert _CONSTANTS_BY_TYPE.get(meta["latex"]) is not None, (
            f"KNOWN_VARIABLES[{name!r}] is typed constant but its latex "
            f"{meta['latex']!r} has no CONSTANT_MAP value"
        )


def test_boolean_literal_leaves_ground_to_sympy_booleans():
    """Sympy collapses tautologies to ``S.true``/``S.false``, which the
    translator emits as a constant leaf with a ``label`` and *no* ``latex``.
    Those used to fall through to ``Symbol(node.id)`` — a graph-local counter
    like ``__const_3`` — so two tautologies grounded to two different
    meaningless symbols and compared unequal (PR #556 review)."""
    from backend.experts.modules.proof_completion.grounding import _symbol
    from backend.model.semantic_graph import SemanticGraphNode

    assert _symbol(SemanticGraphNode(id="__const_3", type="constant", label="true")) is sp.true
    assert _symbol(SemanticGraphNode(id="__const_9", type="constant", label="false")) is sp.false
    # id must not leak into the result for either literal
    for nid in ("__const_3", "__const_9"):
        for label in ("true", "false"):
            got = _symbol(SemanticGraphNode(id=nid, type="constant", label=label))
            assert not got.free_symbols

    # a named constant still wins on latex, and an unlabelled constant is untouched
    assert _symbol(SemanticGraphNode(id="c", type="constant", latex=r"\pi", label="pi")) is sp.pi
    assert _symbol(SemanticGraphNode(id="c2", type="constant", label="infinity",
                                     latex=r"\infty")) is sp.oo


def test_latex_tautologies_still_ground_to_true():
    """Guard the LaTeX path the boolean fix does *not* touch: these keep a
    relation node and are evaluated by sympy at grounding time."""
    for tex in (r"x = x", r"1 = 1", r"x + 0 = x"):
        assert graph_to_sympy(SVC.latex_to_graph(tex)) == sp.true
