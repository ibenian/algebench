"""Tests for scripts/latex_to_graph.py"""

from __future__ import annotations

import sys
import os
import pytest

# Allow importing from scripts/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from scripts.latex_to_graph import (
    latex_to_semantic_graph,
    parse_var_overrides,
    _preprocess_latex,
    _split_on_top_level_comma,
    _extract_parenthetical_annotations,
    _inject_annotations,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_node(graph, **attrs):
    """Find a node in the graph matching all given attrs."""
    for node in graph["nodes"]:
        if all(node.get(k) == v for k, v in attrs.items()):
            return node
    return None


def _find_nodes(graph, **attrs):
    """Find all nodes matching given attrs."""
    return [n for n in graph["nodes"]
            if all(n.get(k) == v for k, v in attrs.items())]


def _has_edge(graph, src, dst):
    """Check if an edge exists from src to dst."""
    return {"from": src, "to": dst} in graph["edges"]


# ---------------------------------------------------------------------------
# Graph structure
# ---------------------------------------------------------------------------

class TestGraphStructure:
    def test_returns_nodes_and_edges(self):
        g = latex_to_semantic_graph("x + y")
        assert "nodes" in g
        assert "edges" in g
        assert "classification" in g

    def test_simple_addition(self):
        g = latex_to_semantic_graph("x + y")
        assert _find_node(g, id="x", type="scalar")
        assert _find_node(g, id="y", type="scalar")
        assert _find_node(g, type="operator", op="add")

    def test_simple_multiplication(self):
        # Parser emits structural fields only — labels/quantities are filled
        # by the enricher, not pre-baked from a hardcoded symbol table.
        g = latex_to_semantic_graph("m \\cdot a")
        assert _find_node(g, id="m", type="scalar")
        assert _find_node(g, id="a", type="vector")  # 'a' is in vector hints
        assert _find_node(g, type="operator", op="multiply")

    def test_equation(self):
        g = latex_to_semantic_graph("F = m \\cdot a")
        assert _find_node(g, id="F", type="vector")
        assert _find_node(g, type="operator", op="equals")

    def test_power(self):
        g = latex_to_semantic_graph("x^2")
        assert _find_node(g, id="x")
        assert _find_node(g, type="operator", op="power")

    def test_edges_connect_operands_to_operator(self):
        g = latex_to_semantic_graph("x + y")
        add_node = _find_node(g, type="operator", op="add")
        assert add_node is not None
        assert _has_edge(g, "x", add_node["id"])
        assert _has_edge(g, "y", add_node["id"])


# ---------------------------------------------------------------------------
# Known variables & metadata
# ---------------------------------------------------------------------------

class TestKnownVariables:
    def test_known_vector_gets_type_hint_only(self):
        # The parser used to bake in a hardcoded label/emoji/quantity/unit
        # for ``F`` (force, 🏹, M·L·T⁻², N). That guess was misleading in
        # other domains and is now the enricher's job. The parser emits
        # only ``type`` (so the renderer picks the right node shape) and
        # ``latex`` (so KaTeX renders the symbol nicely).
        g = latex_to_semantic_graph("F")
        node = _find_node(g, id="F")
        assert node["type"] == "vector"
        assert node["latex"] == "F"
        # No semantic claims pre-filled — those wait for the enricher.
        for forbidden in ("label", "emoji", "quantity", "dimension", "unit", "role", "value"):
            assert forbidden not in node, f"{forbidden!r} should not be parser-set"

    def test_unknown_variable_gets_defaults(self):
        g = latex_to_semantic_graph("Q")
        node = _find_node(g, id="Q")
        # Unknown symbols intentionally have no ``label`` — the SymPy
        # identifier would just duplicate the rendered ``latex`` field.
        assert "label" not in node
        assert node["type"] == "scalar"

    def test_symbol_deduplication(self):
        g = latex_to_semantic_graph("x + x")
        x_nodes = _find_nodes(g, id="x")
        assert len(x_nodes) == 1

    def test_subscripted_greek_subexpr_keeps_latex_command(self):
        # Regression for gh-197: hover tooltip rendered \rho_0 as plain
        # text "rho_0" because the node's `subexpr` came straight from
        # `sympy.latex(Symbol("rho_{0}"))`, which drops the backslash.
        # The subexpr must carry the same LaTeX command as `latex`.
        g = latex_to_semantic_graph(r"\rho_0 + 1")
        node = _find_node(g, id="rho_{0}")
        assert node["latex"] == r"\rho_{0}"
        assert node["subexpr"] == r"\rho_{0}"

    def test_compound_mul_subexpr_recovers_greek_command(self):
        # Regression for gh-197: a non-root Mul containing a Greek-named
        # Symbol must propagate the backslash through `_subexpr_ordered`'s
        # per-factor recursion. Pre-fix, factors fell through to
        # `sympy.latex(Symbol("rho_{0}"))` and joined the compound string
        # as bare `rho_{0}`. The Mul must not be the root — root nodes
        # get `subexpr` from the original input verbatim, masking the bug.
        g = latex_to_semantic_graph(r"\rho_0 V + 1")
        muls = _find_nodes(g, type="operator", op="multiply")
        assert muls
        sub = muls[0].get("subexpr", "")
        assert r"\rho_{0}" in sub, sub
        assert "rho_{0}" not in sub.replace(r"\rho_{0}", ""), sub

    def test_non_greek_subscripted_symbol_not_falsely_prefixed(self):
        # Negative case: `x_0` is a plain ASCII variable, not a LaTeX
        # macro. `_symbol_latex` must NOT invent a `\x` command for it.
        g = latex_to_semantic_graph(r"x_0 + 1")
        node = _find_node(g, id="x_{0}")
        assert node["latex"] == "x_{0}"
        assert node["subexpr"] == "x_{0}"


# ---------------------------------------------------------------------------
# Numbers and constants
# ---------------------------------------------------------------------------

class TestNumbersAndConstants:
    def test_integer(self):
        g = latex_to_semantic_graph("2 x")
        assert _find_node(g, type="number")

    def test_fraction(self):
        g = latex_to_semantic_graph("\\frac{1}{2}")
        # Should produce a number node or a division
        assert len(g["nodes"]) > 0

    def test_float_label_no_precision_noise(self):
        """Regression: Float(7.2) label was '7.20000000000000' (gh-145)."""
        g = latex_to_semantic_graph("7.2 x")
        num = _find_node(g, type="number")
        assert num is not None
        assert num["label"] == "7.2"

    def test_negative_integer_label_preserved(self):
        """Regression: -122 label should stay '-122', not be split (gh-145)."""
        g = latex_to_semantic_graph("-122")
        num = _find_node(g, type="number", label="-122")
        assert num is not None

    def test_negative_fraction_subexpr_no_digit_concat(self):
        """Regression: -122/7.2 multiply subexpr was '-1 122 ...' (gh-145).

        When SymPy's as_ordered_factors splits Integer(-122) into -1*122,
        the LaTeX join produces '-1122' visually.  The fix uses expr.args
        which keeps -122 unified.
        """
        g = latex_to_semantic_graph(r"e^{-122/7.2}")
        mul = _find_node(g, type="operator", op="multiply")
        assert mul is not None
        assert "-1 122" not in mul.get("subexpr", "")

    def test_float_exponent_no_precision_noise(self):
        """Regression: x^{7.2} exponent was '7.20000000000000' (gh-145)."""
        g = latex_to_semantic_graph("x^{7.2}")
        pw = _find_node(g, type="operator", op="power")
        assert pw is not None
        assert pw["exponent"] == "7.2"


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

class TestFunctions:
    def test_sin(self):
        g = latex_to_semantic_graph("\\sin(x)")
        assert _find_node(g, type="function", op="sin")
        assert _find_node(g, id="x")

    def test_cos(self):
        g = latex_to_semantic_graph("\\cos(\\theta)")
        assert _find_node(g, type="function", op="cos")

    def test_sqrt(self):
        g = latex_to_semantic_graph("\\sqrt{x}")
        assert _find_node(g, type="operator", op="power") or \
               _find_node(g, type="function", op="sqrt")


# ---------------------------------------------------------------------------
# Calculus (Integrals, Sums, Derivatives)
# ---------------------------------------------------------------------------

class TestCalculus:
    def test_integral_with_limits(self):
        g = latex_to_semantic_graph("\\int_0^1 x^2 dx")
        integral_node = _find_node(g, type="operator", op="integral")
        assert integral_node is not None
        assert _find_node(g, id="x") is not None
        assert _find_node(g, label="0") is not None
        assert _find_node(g, label="1") is not None

    def test_sum_with_limits(self):
        g = latex_to_semantic_graph("\\sum_{n=1}^\\infty n")
        sum_node = _find_node(g, type="operator", op="sum")
        assert sum_node is not None
        assert _find_node(g, id="n") is not None
        assert _find_node(g, label="1") is not None
        assert _find_node(g, label="infinity") is not None

class TestDerivatives:
    def test_first_order_derivative(self):
        g = latex_to_semantic_graph("\\frac{d v}{d t}")
        deriv = _find_node(g, type="operator", op="derivative")
        assert deriv is not None
        assert "t" in deriv.get("with_respect_to", "")

    def test_dot_notation_preprocessed(self):
        result = _preprocess_latex(r"\dot{x}")
        assert r"\frac" in result
        assert "d t" in result or "dt" in result

    def test_dot_notation_graph(self):
        g = latex_to_semantic_graph(r"\dot{x}")
        deriv = _find_node(g, type="operator", op="derivative")
        assert deriv is not None
        assert "t" in deriv.get("with_respect_to", "")

    def test_ddot_notation_preprocessed(self):
        result = _preprocess_latex(r"\ddot{x}")
        assert result.count(r"\frac") == 2

    def test_ddot_notation_graph(self):
        g = latex_to_semantic_graph(r"\ddot{x}")
        deriv = _find_node(g, type="operator", op="derivative")
        assert deriv is not None
        # SymPy collapses nested derivatives; ddot produces Derivative(x, t, t)
        assert "t" in deriv.get("with_respect_to", "")

    def test_higher_order_derivative(self):
        result = _preprocess_latex(r"\frac{d^2 y}{dy^2}")
        assert result.count(r"\frac") == 2

    def test_higher_order_derivative_graph(self):
        g = latex_to_semantic_graph(r"\frac{d^2 y}{d y^2}")
        deriv = _find_node(g, type="operator", op="derivative")
        assert deriv is not None
        assert "y" in deriv.get("with_respect_to", "")

    def test_higher_order_derivative_braced(self):
        result = _preprocess_latex(r"\frac{d^{2} y}{dy^{2}}")
        assert result.count(r"\frac") == 2

    def test_higher_order_partial_braced(self):
        result = _preprocess_latex(r"\frac{\partial^{3} u}{\partial x^{3}}")
        assert result.count(r"\frac") == 3


# ---------------------------------------------------------------------------
# Relation operators (proportional, implies, iff, maps_to, approximately)
# ---------------------------------------------------------------------------

class TestRelations:
    """Relations that SymPy's parse_latex cannot handle natively."""

    def test_proportional(self):
        g = latex_to_semantic_graph(r"F \propto m a")
        rel = _find_node(g, type="relation", op="proportional")
        assert rel is not None
        assert rel["label"] == "proportional to"
        assert rel["emoji"] == "∝"
        assert _find_node(g, id="F")
        assert _find_node(g, type="operator", op="multiply")

    def test_implies(self):
        g = latex_to_semantic_graph(r"x > 0 \implies x^2 > 0")
        rel = _find_node(g, type="relation", op="implies")
        assert rel is not None
        assert rel["label"] == "implies"
        assert rel["emoji"] == "⇒"

    def test_rightarrow_implies(self):
        g = latex_to_semantic_graph(r"x > 0 \Rightarrow x^2 > 0")
        rel = _find_node(g, type="relation", op="implies")
        assert rel is not None
        assert rel["emoji"] == "⇒"

    def test_iff(self):
        g = latex_to_semantic_graph(r"x = 0 \iff x^2 = 0")
        rel = _find_node(g, type="relation", op="iff")
        assert rel is not None
        assert rel["label"] == "if and only if"
        assert rel["emoji"] == "⇔"

    def test_leftrightarrow_iff(self):
        g = latex_to_semantic_graph(r"A \Leftrightarrow B")
        rel = _find_node(g, type="relation", op="iff")
        assert rel is not None
        assert rel["emoji"] == "⇔"
        assert _find_node(g, id="A")
        assert _find_node(g, id="B")

    def test_approximately(self):
        g = latex_to_semantic_graph(r"\pi \approx 3.14")
        rel = _find_node(g, type="relation", op="approximately")
        assert rel is not None
        assert rel["label"] == "approximately equal"
        assert rel["emoji"] == "≈"
        # parse_latex emits ``\pi`` as a Symbol named ``pi`` (not the
        # sympy.pi NumberSymbol), so the parser routes it through the
        # symbol path — KNOWN_VARIABLES["pi"] still pins type=constant.
        assert _find_node(g, id="pi", type="constant")

    def test_maps_to(self):
        g = latex_to_semantic_graph(r"x \to y")
        rel = _find_node(g, type="relation", op="maps_to")
        assert rel is not None
        assert rel["label"] == "maps to"
        assert rel["emoji"] == "→"
        assert _find_node(g, id="x")
        assert _find_node(g, id="y")

    def test_maps_to_function(self):
        g = latex_to_semantic_graph(r"f(x) \to f(x+1)")
        rel = _find_node(g, type="relation", op="maps_to")
        assert rel is not None

    def test_relation_has_two_edges(self):
        """Every relation node should connect LHS and RHS."""
        g = latex_to_semantic_graph(r"F \propto m a")
        rel = _find_node(g, type="relation", op="proportional")
        incoming = [e for e in g["edges"] if e["to"] == rel["id"]]
        assert len(incoming) == 2

    def test_leftmost_relation_wins(self):
        """When multiple relations appear, split on the leftmost one."""
        g = latex_to_semantic_graph(r"x \to y \implies z")
        # \to is leftmost, so it should be the relation
        rel = _find_node(g, type="relation", op="maps_to")
        assert rel is not None


class TestComparisonOperators:
    """Asymmetric comparison operators (>, <, >=, <=) — issue #242."""

    def test_greater_than(self):
        g = latex_to_semantic_graph(r"x > 0")
        op = _find_node(g, type="operator", op="greater_than")
        assert op is not None
        assert _find_node(g, id="x")

    def test_less_than(self):
        g = latex_to_semantic_graph(r"x < 5")
        op = _find_node(g, type="operator", op="less_than")
        assert op is not None
        assert _find_node(g, id="x")

    def test_geq(self):
        g = latex_to_semantic_graph(r"x \geq y + 1")
        op = _find_node(g, type="operator", op="greater_equal")
        assert op is not None

    def test_leq(self):
        g = latex_to_semantic_graph(r"a \leq b")
        op = _find_node(g, type="operator", op="less_equal")
        assert op is not None
        assert _find_node(g, id="a")
        assert _find_node(g, id="b")

    def test_gt_latex_command(self):
        """\\gt is not handled by SymPy — routed through RELATION_MAP."""
        g = latex_to_semantic_graph(r"x \gt 0")
        rel = _find_node(g, type="relation", op="greater_than")
        assert rel is not None

    def test_lt_latex_command(self):
        """\\lt is not handled by SymPy — routed through RELATION_MAP."""
        g = latex_to_semantic_graph(r"x \lt 5")
        rel = _find_node(g, type="relation", op="less_than")
        assert rel is not None

    def test_comparison_in_comma_constraint(self):
        """Comparison as a constraint clause after comma."""
        g = latex_to_semantic_graph(r"f(x) = x^2, x > 0")
        gt = _find_node(g, type="operator", op="greater_than")
        eq = _find_node(g, type="operator", op="equals")
        assert gt is not None
        assert eq is not None

    def test_comparison_has_two_children(self):
        g = latex_to_semantic_graph(r"x > 0")
        op = _find_node(g, type="operator", op="greater_than")
        incoming = [e for e in g["edges"] if e["to"] == op["id"]]
        assert len(incoming) == 2


class TestRelationOperandComma:
    """Comma inside an \\implies / \\iff operand groups as a conjunction
    on that side, not as a top-level statement separator (#208).

    Previously the comma split ran before relation detection, so
    ``A \\implies B, C`` parsed as two parallel rooted clauses
    (``A \\implies B`` and ``C``) — the second consequent was orphaned
    from the implies node entirely.
    """

    def _reaches(self, graph, src, dst):
        """Return True iff a directed edge path exists from *src* to *dst*."""
        adj: dict[str, list[str]] = {}
        for e in graph["edges"]:
            adj.setdefault(e["from"], []).append(e["to"])
        seen = {src}
        stack = [src]
        while stack:
            cur = stack.pop()
            if cur == dst:
                return True
            for nxt in adj.get(cur, []):
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        return False

    def test_implies_with_comma_rhs_groups_as_conjunction(self):
        g = latex_to_semantic_graph(r"x > 0 \implies y = 1, z = 2")
        impl = _find_node(g, type="relation", op="implies")
        assert impl is not None
        # Both consequent clauses must reach the implies node.
        equals_nodes = _find_nodes(g, type="operator", op="equals")
        assert len(equals_nodes) == 2
        for eq in equals_nodes:
            assert self._reaches(g, eq["id"], impl["id"]), (
                f"clause {eq.get('subexpr')!r} does not reach implies"
            )
        # And they reach it through a synthetic ``and`` conjunction node.
        conj = _find_node(g, type="relation", op="and")
        assert conj is not None
        assert self._reaches(g, conj["id"], impl["id"])

    def test_iff_with_comma_rhs_groups_as_conjunction(self):
        g = latex_to_semantic_graph(r"P \iff A, B")
        iff = _find_node(g, type="relation", op="iff")
        conj = _find_node(g, type="relation", op="and")
        assert iff is not None and conj is not None
        assert self._reaches(g, conj["id"], iff["id"])
        assert self._reaches(g, "A", iff["id"])
        assert self._reaches(g, "B", iff["id"])

    def test_implies_with_comma_lhs_groups_as_conjunction(self):
        """Comma on the LHS of an implication groups the antecedents."""
        g = latex_to_semantic_graph(r"A, B \implies C")
        impl = _find_node(g, type="relation", op="implies")
        conj = _find_node(g, type="relation", op="and")
        assert impl is not None and conj is not None
        assert self._reaches(g, "A", conj["id"])
        assert self._reaches(g, "B", conj["id"])
        assert self._reaches(g, conj["id"], impl["id"])
        assert self._reaches(g, "C", impl["id"])

    def test_function_arg_comma_inside_implies_unaffected(self):
        """Comma inside a function-argument group ``f(x, y)`` stays a
        function arg — it's not at top level on the side, so no
        conjunction node is emitted."""
        g = latex_to_semantic_graph(r"x = 1 \implies f(x, y) = 0")
        # No ``and`` conjunction should appear — comma is depth>0.
        assert _find_node(g, type="relation", op="and") is None
        impl = _find_node(g, type="relation", op="implies")
        assert impl is not None

    def test_top_level_comma_without_relation_unchanged(self):
        """Without a top-level relation, comma still acts as a statement
        separator — no synthetic ``and`` node."""
        g = latex_to_semantic_graph(r"a = 1, b = 2")
        assert _find_node(g, type="relation", op="and") is None
        equals_nodes = _find_nodes(g, type="operator", op="equals")
        assert len(equals_nodes) == 2


class TestTextCommand:
    """\\text{NAME} should become a single text node, not decomposed into
    per-character multiplications (SymPy's parse_latex default behavior)."""

    def test_text_becomes_single_constant(self):
        g = latex_to_semantic_graph(r"T = \text{const}")
        node = _find_node(g, type="annotation", label="const")
        assert node is not None
        assert node["latex"] == r"\text{const}"
        # No stray per-character symbols (c, o, n, s) should appear.
        for letter in ("c", "o", "n", "s"):
            assert _find_node(g, id=letter) is None, f"stray {letter!r} symbol leaked"

    def test_text_with_implies(self):
        """Regression: T = \\text{const} \\implies dP = k_B T / m · dρ
        previously decomposed 'const' into c·o·n·s·t inside the LHS equation."""
        g = latex_to_semantic_graph(
            r"T = \text{const} \implies dP = \frac{k_B T}{m}\, d\rho"
        )
        assert _find_node(g, type="annotation", label="const") is not None
        assert _find_node(g, type="relation", op="implies") is not None
        # Two equals nodes: one per side of the implication.
        equals_nodes = [n for n in g["nodes"]
                        if n.get("type") == "operator" and n.get("op") == "equals"]
        assert len(equals_nodes) == 2

    def test_repeated_text_dedups(self):
        """Same \\text{...} content should map to one node, not duplicate."""
        g = latex_to_semantic_graph(r"\text{foo} + \text{foo} = \text{bar}")
        foo_nodes = [n for n in g["nodes"]
                     if n.get("type") == "annotation" and n.get("label") == "foo"]
        assert len(foo_nodes) == 1
        assert _find_node(g, type="annotation", label="bar") is not None


# ---------------------------------------------------------------------------
# Complex real-world formulas
# ---------------------------------------------------------------------------

class TestComplexFormulas:
    """Parse real physics/math formulas and verify the graph captures key
    structural features (node types, operators, symbols, classification)."""

    def test_euler_identity(self):
        """e^{i pi} + 1 = 0 — symbols, constants, power, addition, equality.
        Note: parse_latex treats 'e', 'i', and 'pi' as plain Symbols, so all
        three flow through the symbol path. KNOWN_VARIABLES["pi"] still pins
        type=constant; ``e`` / ``i`` default to scalar."""
        g = latex_to_semantic_graph(r"e^{i \pi} + 1 = 0")
        assert _find_node(g, type="operator", op="equals")
        assert _find_node(g, id="e")
        assert _find_node(g, id="pi", type="constant")  # label/emoji are enricher's job
        assert _find_node(g, type="operator", op="power")
        assert _find_node(g, type="operator", op="add")
        assert g["classification"]["kind"] == "algebraic"

    def test_kinetic_energy(self):
        """K = 1/2 m v^2 — equation with fraction, multiplication, power."""
        g = latex_to_semantic_graph(r"K = \frac{1}{2} m v^2")
        assert _find_node(g, type="operator", op="equals")
        assert _find_node(g, id="K")
        assert _find_node(g, id="m")  # parser doesn't pre-fill labels
        assert _find_node(g, id="v")
        assert _find_node(g, type="operator", op="power")
        assert _find_node(g, type="operator", op="multiply")

    def test_gaussian_integral(self):
        """integral from -inf to inf of e^{-x^2} dx = sqrt(pi) —
        definite integral, exponential, constant, equality."""
        g = latex_to_semantic_graph(
            r"\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}"
        )
        assert _find_node(g, type="operator", op="equals")
        assert _find_node(g, type="operator", op="integral")
        assert _find_node(g, type="operator", op="power")
        assert _find_node(g, id="x")
        assert g["classification"]["kind"] == "algebraic"

    def test_wave_equation_pde(self):
        """u_tt = c^2 u_xx — second-order PDE, partial derivatives."""
        g = latex_to_semantic_graph(
            r"\frac{\partial^2 u}{\partial t^2} = c^2 \frac{\partial^2 u}{\partial x^2}"
        )
        derivs = _find_nodes(g, type="operator", op="derivative")
        assert len(derivs) == 2
        wrt_vars = {d["with_respect_to"] for d in derivs}
        assert "t" in wrt_vars
        assert "x" in wrt_vars
        c = g["classification"]
        assert c["kind"] == "PDE"
        assert c["order"] == 2
        assert set(c["independent_variables"]) == {"t", "x"}

    def test_harmonic_oscillator_ode(self):
        """x'' + omega^2 x = 0 — second-order linear ODE."""
        g = latex_to_semantic_graph(
            r"\frac{d^2 x}{dt^2} + \omega^2 x = 0"
        )
        assert _find_node(g, type="operator", op="derivative")
        assert _find_node(g, id="omega")  # label/quantity left for the enricher
        c = g["classification"]
        assert c["kind"] == "ODE"
        assert c["order"] == 2
        assert c.get("linear") is True

    def test_schrodinger_time_independent(self):
        """E psi = -(h^2/2m) psi'' + V psi — ODE with many operators."""
        g = latex_to_semantic_graph(
            r"E \psi = -\frac{h^2}{2m} \frac{d^2 \psi}{dx^2} + V \psi"
        )
        assert _find_node(g, id="psi")
        assert _find_node(g, id="h")
        assert _find_node(g, type="operator", op="derivative")
        assert _find_node(g, type="operator", op="equals")
        c = g["classification"]
        assert c["kind"] == "ODE"
        assert c["order"] == 2

    def test_coulomb_law(self):
        """F = k q1 q2 / r^2 — subscripted variables, fractions."""
        g = latex_to_semantic_graph(r"F = k \frac{q_1 q_2}{r^2}")
        assert _find_node(g, type="operator", op="equals")
        assert _find_node(g, id="F")
        assert _find_node(g, id="r")
        assert _find_node(g, type="operator", op="power")
        # q_1 and q_2 are distinct symbols
        nodes = g["nodes"]
        q_nodes = [n for n in nodes if n["id"].startswith("q_")]
        assert len(q_nodes) == 2

    def test_taylor_series_sin(self):
        """sin(x) = sum — function, summation, factorial, power."""
        g = latex_to_semantic_graph(
            r"\sin(x) = \sum_{n=0}^{\infty} \frac{(-1)^n}{(2n+1)!} x^{2n+1}"
        )
        assert _find_node(g, type="function", op="sin")
        assert _find_node(g, type="operator", op="sum")
        assert _find_node(g, type="operator", op="equals")
        # Should have factorial node
        assert _find_node(g, op="factorial")
        assert g["classification"]["kind"] == "algebraic"

    def test_lorentz_factor(self):
        """gamma = 1/sqrt(1 - v^2/c^2) — nested fractions, sqrt via power."""
        g = latex_to_semantic_graph(
            r"\gamma = \frac{1}{\sqrt{1 - \frac{v^2}{c^2}}}"
        )
        assert _find_node(g, id="gamma")
        assert _find_node(g, id="v")  # parser emits structural fields only
        assert _find_node(g, id="c")
        assert _find_node(g, type="operator", op="equals")
        assert g["classification"]["kind"] == "algebraic"

    def test_quadratic_formula(self):
        """x = (-b +/- sqrt(b^2 - 4ac)) / 2a — covers many node types."""
        g = latex_to_semantic_graph(
            r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
        )
        assert _find_node(g, type="operator", op="equals")
        assert _find_node(g, id="x")
        assert _find_node(g, id="a")
        assert _find_node(g, id="b")
        assert _find_node(g, id="c")
        # Must have both addition and multiplication
        assert _find_node(g, type="operator", op="add")
        assert _find_node(g, type="operator", op="multiply")
        assert _find_node(g, type="operator", op="power")
        # Graph should be non-trivial
        assert len(g["nodes"]) >= 10
        assert len(g["edges"]) >= 10


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

class TestClassification:
    def test_algebraic_expression(self):
        g = latex_to_semantic_graph("x^2 + y^2")
        assert g["classification"]["kind"] == "algebraic"

    def test_ode_detected(self):
        g = latex_to_semantic_graph("\\frac{d v}{d t} = a")
        c = g["classification"]
        assert c["kind"] == "ODE"
        assert c["order"] == 1

    def test_algebraic_equation(self):
        g = latex_to_semantic_graph("E = m c^2")
        assert g["classification"]["kind"] == "algebraic"

    def test_mixed_partial_derivative_order(self):
        """Mixed partial d²u/(dx dt) should report order 2, not 1."""
        g = latex_to_semantic_graph(
            r"\frac{\partial}{\partial x}\frac{\partial u}{\partial t} = 0"
        )
        c = g["classification"]
        assert c["kind"] == "PDE"
        assert c["order"] == 2


# ---------------------------------------------------------------------------
# Variable overrides
# ---------------------------------------------------------------------------

class TestOverrides:
    def test_parse_var_overrides_single(self):
        result = parse_var_overrides(["m:unit=kg,tooltip=Mass"])
        assert result == {"m": {"unit": "kg", "tooltip": "Mass"}}

    def test_parse_var_overrides_multiple(self):
        result = parse_var_overrides([
            "m:unit=kg",
            "a:unit=m/s²",
        ])
        assert result["m"]["unit"] == "kg"
        assert result["a"]["unit"] == "m/s²"

    def test_parse_var_overrides_none(self):
        assert parse_var_overrides(None) == {}

    def test_parse_var_overrides_invalid_format(self):
        with pytest.raises(ValueError, match="Invalid --var format"):
            parse_var_overrides(["bad"])

    def test_parse_var_overrides_invalid_property(self):
        with pytest.raises(ValueError, match="Invalid property"):
            parse_var_overrides(["m:noequalssign"])

    def test_overrides_applied_to_graph(self):
        # Overrides still win — authors can pin any field explicitly.
        # The parser no longer pre-fills ``label`` for ``m``, so the
        # override is the only source of label / unit / tooltip metadata.
        g = latex_to_semantic_graph("F = m \\cdot a", overrides={
            "m": {"label": "mass", "unit": "kg", "tooltip": "Inertial mass"},
        })
        m_node = _find_node(g, id="m")
        assert m_node["unit"] == "kg"
        assert m_node["tooltip"] == "Inertial mass"
        assert m_node["label"] == "mass"


# ---------------------------------------------------------------------------
# Edge semantics (direct / inverse)
# ---------------------------------------------------------------------------

def _edge(graph, src, dst):
    """Return the edge matching (src -> dst), or None."""
    for e in graph["edges"]:
        if e.get("from") == src and e.get("to") == dst:
            return e
    return None


class TestEdgeSemantics:
    """Heuristics:

    - ``base → Pow(n)`` edges stay untagged at parse time. The
      proportionality semantics live on the *outgoing* edge from a
      power node and are recovered by the renderer at draw time
      (it reads ``exponent`` off the power node and tags the
      downstream edge ``direct``/``inverse`` accordingly). This
      keeps the parsed graph lean and gives a single source of
      truth for the heuristic.
    - Every factor of a ``Mul`` is tagged ``direct`` at parse time —
      each operand is linearly proportional to the product, and
      multiply has many incoming edges so we can't recover this at
      render time without inspecting the source side.
    - Addition/subtraction/equality edges stay untagged: summands
      compose additively, not proportionally.
    """

    def test_pow_edges_are_not_tagged_at_parse_time(self):
        # The base→power edge stays plain. The renderer reads
        # ``exponent`` off the power node and applies the semantic
        # to the *outgoing* edge instead — see
        # ``scripts/graph_to_mermaid.semantic_graph_to_mermaid``.
        for latex_src in ("y = a / b", r"y = \frac{a}{b}", "y = x^2",
                          "y = x^3", r"F = \frac{1}{r^2}"):
            g = latex_to_semantic_graph(latex_src)
            pow_nodes = _find_nodes(g, type="operator", op="power")
            assert pow_nodes, f"expected a power node for {latex_src!r}"
            for pn in pow_nodes:
                incoming = [e for e in g["edges"] if e["to"] == pn["id"]]
                assert incoming, "power node should have an incoming edge"
                for edge in incoming:
                    assert "semantic" not in edge, (
                        f"{latex_src!r}: pow incoming edge should not be tagged "
                        f"at parse time (got {edge})"
                    )
                    assert "weight" not in edge, (
                        f"{latex_src!r}: pow incoming edge should not have a "
                        f"weight at parse time (got {edge})"
                    )

    def test_addition_has_no_semantic_tags(self):
        g = latex_to_semantic_graph("y = a + b")
        add_edges = [e for e in g["edges"] if e["to"].startswith("__add")]
        assert add_edges, "expected at least one add-edge"
        for edge in add_edges:
            assert "semantic" not in edge
            assert "weight" not in edge

    def test_multiplication_tags_factors_as_direct(self):
        # ``a · t`` — both operands are linearly proportional to the
        # product, so every factor edge gets ``direct`` + weight 1.
        g = latex_to_semantic_graph(r"y = a \cdot t")
        mul_edges = [e for e in g["edges"] if e["to"].startswith("__multiply")]
        assert len(mul_edges) == 2
        for edge in mul_edges:
            assert edge.get("semantic") == "direct"
            assert edge.get("weight") == 1.0

    def test_edge_weight_survives_schema_validation(self):
        from scripts.graph_to_mermaid import validate_graph
        g = latex_to_semantic_graph(r"v = \frac{x}{t^2}")
        errs = validate_graph(g)
        assert errs == [], f"unexpected schema errors: {errs}"

    def test_multiply_skips_tagging_for_inverse_pow_children(self):
        # ``a/b`` is ``Mul(a, Pow(b, -1))``. The factor edge for ``a``
        # is still ``direct`` but the edge from the inverse-power child
        # must stay plain so the renderer's power-source inference can
        # paint it ``inverse``.
        g = latex_to_semantic_graph(r"y = a / b")
        mul_node = _find_node(g, type="operator", op="multiply")
        assert mul_node is not None
        a_edge = next(e for e in g["edges"]
                      if e["to"] == mul_node["id"] and e["from"] == "a")
        assert a_edge.get("semantic") == "direct"
        assert a_edge.get("weight") == 1.0
        pow_edge = next(e for e in g["edges"]
                        if e["to"] == mul_node["id"] and e["from"].startswith("__power"))
        assert "semantic" not in pow_edge, (
            f"inverse-pow → multiply edge must stay plain (got {pow_edge})"
        )
        assert "weight" not in pow_edge

    def test_symbolic_negative_pow_absorbs_exponent(self):
        # ``x^{-n}`` should produce a single power node with
        # ``exponent="-n"`` and just one incoming edge from the base —
        # no extra ``__negate``/``n`` children. This is what lets the
        # renderer paint the outgoing edge ``inverse``.
        g = latex_to_semantic_graph(r"y = x^{-n}")
        pow_nodes = _find_nodes(g, type="operator", op="power")
        assert len(pow_nodes) == 1
        pn = pow_nodes[0]
        assert pn.get("exponent") == "-n"
        incoming = [e for e in g["edges"] if e["to"] == pn["id"]]
        assert len(incoming) == 1
        assert incoming[0]["from"] == "x"
        # And no negate/exponent helper nodes leaked through.
        assert not _find_nodes(g, type="operator", op="negation")


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

class TestErrors:
    def test_invalid_latex_raises(self):
        with pytest.raises(ValueError, match="Failed to parse"):
            latex_to_semantic_graph("\\frac{}")


# ---------------------------------------------------------------------------
# Comma-separated clauses (issue #144)
# ---------------------------------------------------------------------------

class TestCommaSplit:
    """Low-level brace-aware splitting."""

    def test_no_comma_returns_single_clause(self):
        assert _split_on_top_level_comma("x + y") == ["x + y"]

    def test_top_level_comma_splits(self):
        assert _split_on_top_level_comma("a = 1, b = 2") == ["a = 1", "b = 2"]

    def test_three_clauses(self):
        assert _split_on_top_level_comma("a, b, c") == ["a", "b", "c"]

    def test_comma_inside_braces_not_split(self):
        # \text{const, extra} must stay as a single clause — the comma
        # is brace-nested.
        assert _split_on_top_level_comma(r"\text{const, extra}") == [
            r"\text{const, extra}"
        ]

    def test_comma_inside_parens_not_split(self):
        # Function argument lists must not split.
        assert _split_on_top_level_comma("f(x, y)") == ["f(x, y)"]

    def test_comma_inside_brackets_not_split(self):
        # e.g. interval notation or matrix indexing.
        assert _split_on_top_level_comma("A[i, j]") == ["A[i, j]"]

    def test_mixed_nested_and_top_level(self):
        # Top-level comma splits; nested commas are preserved intact.
        assert _split_on_top_level_comma("f(x, y) = 0, g(a, b) = 1") == [
            "f(x, y) = 0",
            "g(a, b) = 1",
        ]

    def test_multi_function_call_all_args_preserved(self):
        """Multiple function calls in one expression — every argument
        comma is inside a ``(...)`` and must be preserved."""
        assert _split_on_top_level_comma("f(x, y) + g(a, b, c)") == [
            "f(x, y) + g(a, b, c)"
        ]

    def test_multi_index_subscript_not_split(self):
        r"""``A_{i, j}`` — the comma is inside a subscript brace group
        (brace depth 1) and must not be treated as a separator."""
        assert _split_on_top_level_comma("A_{i, j}") == ["A_{i, j}"]
        # Even in a larger expression with other top-level operators.
        assert _split_on_top_level_comma("A_{i, j} + B_{k, l}") == [
            "A_{i, j} + B_{k, l}"
        ]

    def test_set_literal_not_split(self):
        r"""``\{1, 2, 3\}`` — LaTeX set notation. The escaped ``\{`` and
        ``\}`` still count as brace-depth boundaries so the enclosed
        commas are nested (not separators)."""
        assert _split_on_top_level_comma(r"\{1, 2, 3\}") == [r"\{1, 2, 3\}"]

    def test_ordered_pair_not_split(self):
        """``(a, b)`` — pair notation. The inner comma is paren-nested."""
        assert _split_on_top_level_comma("(a, b)") == ["(a, b)"]

    def test_integral_with_thin_space_and_top_level_comma(self):
        r"""``\int f(x)\,dx, g = 0`` — contains ``\,`` (not a separator,
        via backslash-parity) inside an integral AND a real top-level
        comma. Only the real one should split."""
        assert _split_on_top_level_comma(r"\int f(x)\,dx, g = 0") == [
            r"\int f(x)\,dx",
            "g = 0",
        ]

    def test_trailing_comma_produces_no_empty_clause(self):
        assert _split_on_top_level_comma("a = 1,") == ["a = 1"]

    def test_leading_comma_dropped(self):
        assert _split_on_top_level_comma(", b = 2") == ["b = 2"]

    def test_latex_thin_space_not_split(self):
        r"""``\,`` is a LaTeX thin-space command — the trailing comma is
        part of the command, not a clause separator."""
        assert _split_on_top_level_comma(r"a \, b") == [r"a \, b"]
        # And combined with a real top-level comma, only the real one splits.
        assert _split_on_top_level_comma(r"a \, b, c") == [r"a \, b", "c"]

    def test_double_backslash_before_comma_still_splits(self):
        r"""``\\,`` — escaped backslash followed by a literal comma. The
        comma is NOT escaped, so the split should happen."""
        assert _split_on_top_level_comma(r"a \\, b") == [r"a \\", "b"]


class TestCommaSeparatedClauses:
    """Full graph behaviour for comma-separated statements (issue #144)."""

    def test_issue_144_exact_example(self):
        r"""The exact example from issue #144 must parse both clauses.
        Before the fix, the second clause was silently dropped by SymPy."""
        g = latex_to_semantic_graph(
            r"\frac{dh}{dt} = -V \sin \gamma, \quad \gamma = \text{const}"
        )
        # Both clauses present: the first has a Derivative, the second
        # has a 'const' text node.
        assert _find_nodes(g, type="operator", op="derivative"), (
            "first clause (derivative) must survive"
        )
        assert _find_node(g, label="const"), (
            "second clause (γ = const) must survive — this is the bug"
        )
        # Graph carries two independent statements — no parent/relation node.
        assert g["classification"]["kind"] == "statements"
        assert g["classification"]["count"] == 2

    def test_no_parent_relation_node_is_emitted(self):
        """Per author intent (issue #144 follow-up): the comma is a pure
        statement separator, not a logical operator. The graph must NOT
        carry a parent ``and`` / ``comma`` / ``conjunction`` relation node
        artificially joining the clauses."""
        g = latex_to_semantic_graph("a = 1, b = 2")
        assert _find_node(g, type="relation", op="and") is None
        assert _find_node(g, type="relation", op="comma") is None
        assert _find_node(g, type="relation", op="conjunction") is None

    def test_simultaneous_definitions(self):
        """a = 1, b = 2 — two independent equations as separate statements."""
        g = latex_to_semantic_graph("a = 1, b = 2")
        # Both variables a and b are present.
        assert _find_node(g, id="a") is not None
        assert _find_node(g, id="b") is not None
        # Two equals nodes, one per clause.
        equals_nodes = _find_nodes(g, type="operator", op="equals")
        assert len(equals_nodes) == 2
        # The graph has exactly two roots (nodes with no outgoing edges
        # among the operator/relation nodes) — the two equals nodes.
        out_set = {e["from"] for e in g["edges"]}
        op_roots = [n for n in g["nodes"]
                    if n.get("type") in ("operator", "relation")
                    and n["id"] not in out_set]
        assert len(op_roots) == 2, (
            f"expected two statement roots, got {len(op_roots)}: {op_roots}"
        )

    def test_simultaneous_definitions_truly_disconnected(self):
        """`a = 1, b = 2` shares no variables — the two statement
        sub-graphs must be genuinely disconnected (no path between them)."""
        g = latex_to_semantic_graph("a = 1, b = 2")
        # Build undirected adjacency and check connected components.
        from collections import defaultdict
        adj = defaultdict(set)
        for e in g["edges"]:
            adj[e["from"]].add(e["to"])
            adj[e["to"]].add(e["from"])
        node_ids = {n["id"] for n in g["nodes"]}
        visited = set()

        def walk(start):
            stack, seen = [start], set()
            while stack:
                n = stack.pop()
                if n in seen:
                    continue
                seen.add(n)
                stack.extend(adj[n] - seen)
            return seen

        components = 0
        for nid in node_ids:
            if nid not in visited:
                comp = walk(nid)
                visited |= comp
                components += 1
        assert components == 2, (
            f"expected 2 disconnected components, got {components}"
        )

    def test_constraint_after_equation(self):
        """f(x) = x^2, x > 0 — equation plus domain constraint."""
        g = latex_to_semantic_graph("y = x^2, x > 0")
        # x must be a single shared node across both clauses — shared
        # variables dedup even without a parent relation node.
        x_nodes = _find_nodes(g, id="x")
        assert len(x_nodes) == 1, (
            "x should be shared between the equation and the constraint, "
            f"got {len(x_nodes)} nodes"
        )

    def test_three_clauses_all_present(self):
        g = latex_to_semantic_graph("a = 1, b = 2, c = 3")
        equals_nodes = _find_nodes(g, type="operator", op="equals")
        assert len(equals_nodes) == 3
        assert g["classification"]["count"] == 3

    def test_classification_lists_per_clause_kinds(self):
        """Per-clause classifications are preserved under
        ``classification.clauses`` so downstream consumers can see e.g.
        that clause 0 is algebraic and clause 1 is too, without walking
        the subtrees."""
        g = latex_to_semantic_graph("a = 1, b = 2")
        cls = g["classification"]
        assert cls["kind"] == "statements"
        assert cls["count"] == 2
        assert "clauses" in cls
        assert len(cls["clauses"]) == 2
        # Every clause must have its own ``kind`` field populated.
        for sub in cls["clauses"]:
            assert "kind" in sub

    def test_four_clauses_all_present(self):
        """Any number of commas — the splitter iterates, the builder
        prefixes operator ids ``c0_``, ``c1_``, …, and the graph holds
        one independent subtree per clause."""
        g = latex_to_semantic_graph("a = 1, b = 2, c = 3, d = 4")
        equals_nodes = _find_nodes(g, type="operator", op="equals")
        assert len(equals_nodes) == 4
        assert g["classification"]["count"] == 4
        # All four clause equals-node ids must be uniquely prefixed.
        equals_ids = {n["id"] for n in equals_nodes}
        assert equals_ids == {
            "c0___equals_1", "c1___equals_1", "c2___equals_1", "c3___equals_1",
        }

    def test_multi_clause_mixed_variable_sharing(self):
        """Three clauses where two share a variable and the third doesn't:
        ``a = 1, a + b = 5, c = 3``. The graph should have exactly two
        connected components (clauses 0+1 glued through shared ``a``;
        clause 2 standalone)."""
        g = latex_to_semantic_graph("a = 1, a + b = 5, c = 3")
        assert g["classification"]["count"] == 3
        # Count connected components via undirected traversal.
        from collections import defaultdict
        adj = defaultdict(set)
        for e in g["edges"]:
            adj[e["from"]].add(e["to"])
            adj[e["to"]].add(e["from"])
        node_ids = {n["id"] for n in g["nodes"]}
        visited = set()

        def walk(start):
            stack, seen = [start], set()
            while stack:
                n = stack.pop()
                if n in seen:
                    continue
                seen.add(n)
                stack.extend(adj[n] - seen)
            return seen

        components = 0
        for nid in node_ids:
            if nid not in visited:
                visited |= walk(nid)
                components += 1
        assert components == 2, (
            f"expected 2 components (a-clauses merged via shared 'a', "
            f"c standalone); got {components}"
        )
        # ``a`` must be shared — single node referenced by both c0 and c1 equals.
        a_nodes = _find_nodes(g, id="a")
        assert len(a_nodes) == 1

    def test_comma_inside_text_not_split(self):
        r"""Commas inside \text{...} must not trigger a split —
        otherwise \text{a, b} would be broken into two bogus clauses."""
        g = latex_to_semantic_graph(r"x = \text{foo, bar}")
        # Single equation — not multi-statement.
        assert g["classification"].get("kind") != "statements"
        equals_nodes = _find_nodes(g, type="operator", op="equals")
        assert len(equals_nodes) == 1

    def test_comma_inside_function_args_not_split(self):
        """f(x, y) — function argument commas must not split."""
        g = latex_to_semantic_graph("f(x, y)")
        # Single statement — the comma is a function-arg separator, not a
        # statement separator.
        assert g["classification"].get("kind") != "statements"

    def test_failed_clause_raises_not_silently_dropped(self):
        """Per issue #137: parse failures must surface, not silently drop.
        When one clause is malformed, the whole expression should raise."""
        with pytest.raises(ValueError):
            latex_to_semantic_graph(r"a = 1, \frac{}")

    def test_shared_variable_dedup_across_clauses(self):
        r"""γ appearing in both clauses must collapse to one node,
        consistent with existing in-clause variable dedup."""
        g = latex_to_semantic_graph(
            r"\frac{dh}{dt} = -V \sin \gamma, \gamma = \text{const}"
        )
        gamma_nodes = _find_nodes(g, id="gamma")
        assert len(gamma_nodes) == 1, (
            f"gamma should be shared across clauses, got {len(gamma_nodes)}"
        )

    def test_clause_subexprs_strip_leading_spacing_commands(self):
        r"""Authors write ``a, \quad b`` for visual spacing. The ``\quad``
        is visual only — it must not leak into the second clause's root
        subexpr (would render as empty whitespace in the UI)."""
        g = latex_to_semantic_graph(
            r"\frac{dh}{dt} = -V \sin \gamma, \quad \gamma = \text{const}"
        )
        equals_nodes = _find_nodes(g, type="operator", op="equals")
        subexprs = {n.get("subexpr", "") for n in equals_nodes}
        # Neither equals subexpr should start with a leading \quad/\qquad/etc.
        for s in subexprs:
            assert not s.lstrip().startswith("\\quad"), (
                f"leading \\quad leaked into clause subexpr: {s!r}"
            )
            assert not s.lstrip().startswith("\\qquad"), (
                f"leading \\qquad leaked into clause subexpr: {s!r}"
            )
        # And the γ = const clause should be clean.
        assert any("\\gamma = \\text{const}" in s for s in subexprs)

    def test_distinct_text_per_clause_not_merged(self):
        r"""Regression for Copilot review on PR #155: each clause runs
        ``_collapse_text_commands`` independently, so ``\text{foo}`` in
        clause 0 and ``\text{bar}`` in clause 1 would both produce the
        symbol id ``Xi_{0}``. Without per-clause namespacing of text
        placeholders, the merge step would incorrectly dedup them into
        a single text node — clause 1's ``bar`` would disappear."""
        g = latex_to_semantic_graph(r"x = \text{foo}, y = \text{bar}")
        text_nodes = _find_nodes(g, type="annotation")
        labels = sorted(n.get("label") for n in text_nodes)
        assert labels == ["bar", "foo"], (
            f"expected two distinct text nodes (foo, bar), got {labels!r} "
            f"— Xi_{{N}} placeholder collision across clauses"
        )
        # Both equals nodes must survive, each with its own text operand.
        equals_nodes = _find_nodes(g, type="operator", op="equals")
        assert len(equals_nodes) == 2

    def test_same_text_per_clause_each_gets_its_own_node(self):
        r"""``\text{foo}`` appearing in two clauses should produce two
        distinct text nodes — each clause is an independent statement
        and text placeholders are per-clause, not globally shared."""
        g = latex_to_semantic_graph(r"x = \text{foo}, y = \text{foo}")
        text_nodes = _find_nodes(g, type="annotation", label="foo")
        assert len(text_nodes) == 2, (
            f"expected two independent 'foo' text nodes (one per clause), "
            f"got {len(text_nodes)}"
        )

    def test_each_clause_has_its_own_clean_subexpr(self):
        r"""Each clause's root node should carry only that clause's LaTeX
        as its subexpr — not the full comma-joined expression. No clause
        should leak the other clause's content into its subexpr."""
        g = latex_to_semantic_graph(
            r"\frac{dh}{dt} = -V \sin \gamma, \quad \gamma = \text{const}"
        )
        equals_nodes = _find_nodes(g, type="operator", op="equals")
        subexprs = [n.get("subexpr", "") for n in equals_nodes]
        # Neither subexpr should contain a comma (that would mean the
        # whole original expression leaked in).
        for s in subexprs:
            assert "," not in s, (
                f"clause subexpr should not carry the top-level comma: {s!r}"
            )
        # First clause has the derivative/sin, second has \text{const}.
        has_deriv = any("dh" in s and "dt" in s for s in subexprs)
        has_const = any("\\text{const}" in s for s in subexprs)
        assert has_deriv and has_const, (
            f"each clause should own a distinct subexpr, got {subexprs!r}"
        )


# ---------------------------------------------------------------------------
# Compound symbols (\Delta t, \Delta x, etc.) — regression for #179
# ---------------------------------------------------------------------------

class TestCompoundSymbols:
    def test_delta_t_is_single_symbol(self):
        """``\\Delta t`` must collapse to one node, not Δ multiplied by t."""
        g = latex_to_semantic_graph(r"v = \Delta t")
        # No multiply operator should appear — Δt is one identifier.
        muls = _find_nodes(g, type="operator", op="multiply")
        assert not muls, (
            f"\\Delta t should not produce a multiply node, got {muls!r}"
        )
        # No standalone Delta or t node — only the compound and v.
        delta_nodes = _find_nodes(g, latex=r"\Delta")
        assert not delta_nodes, "\\Delta must not be split off as its own node"
        # The compound symbol's latex field should be the original LaTeX.
        compound = _find_node(g, latex=r"\Delta t")
        assert compound is not None, "expected a node with latex = '\\Delta t'"
        assert compound.get("subexpr") == r"\Delta t"

    def test_delta_x_over_delta_t(self):
        """``\\Delta x / \\Delta t`` produces two compound nodes, no split."""
        g = latex_to_semantic_graph(r"v = \frac{\Delta x}{\Delta t}")
        compounds = sorted(
            n.get("latex") for n in g["nodes"]
            if n.get("latex") in (r"\Delta x", r"\Delta t")
        )
        assert compounds == [r"\Delta t", r"\Delta x"], (
            f"both \\Delta x and \\Delta t should be present as compounds, "
            f"got {compounds!r}"
        )
        # No standalone Δ or stray t/x sharing the name with the compound.
        assert not _find_nodes(g, latex=r"\Delta")

    def test_lone_delta_unchanged(self):
        """Bare ``\\Delta`` (e.g. discriminant) must remain a single Δ."""
        g = latex_to_semantic_graph(r"\Delta = b^2 - 4ac")
        delta = _find_node(g, latex=r"\Delta")
        assert delta is not None, "bare \\Delta should still produce a Δ node"
        # And no compound-collapsing should have triggered.
        thetas = [n for n in g["nodes"]
                  if isinstance(n.get("id"), str) and n["id"].startswith("Theta_{")]
        assert not thetas, "no compound placeholder should be created for lone \\Delta"

    def test_partial_derivative_still_parses(self):
        """``\\partial`` must NOT be collapsed — derivatives still need it."""
        g = latex_to_semantic_graph(r"\frac{\partial u}{\partial x} = 0")
        derivs = _find_nodes(g, type="operator", op="derivative")
        assert derivs, (
            "\\partial u / \\partial x should still be recognized as a "
            "derivative, not a fraction of compound symbols"
        )

    def test_delta_with_greek_operand(self):
        """``\\Delta\\theta`` collapses to one node with the right LaTeX."""
        g = latex_to_semantic_graph(r"\Delta\theta = 5")
        compound = _find_node(g, latex=r"\Delta \theta")
        assert compound is not None, (
            "\\Delta\\theta should collapse to a single Δθ node"
        )

    def test_delta_with_letter_subscript(self):
        """``\\Delta t_0`` collapses with the subscript absorbed into the
        placeholder, not left dangling as ``\\Theta_{N}_0`` (invalid).
        """
        g = latex_to_semantic_graph(r"v = \Delta t_0")
        compound = _find_node(g, latex=r"\Delta t_0")
        assert compound is not None, (
            "\\Delta t_0 should collapse to a single node, "
            "with the subscript absorbed into the compound"
        )
        # No spurious standalone Delta/t/0 nodes.
        assert not _find_nodes(g, latex=r"\Delta")

    def test_delta_with_greek_subscript(self):
        """``\\Delta\\theta_0`` collapses despite the trailing subscript —
        regression for the ``\\b`` boundary that previously prevented
        Greek-operand matches when followed by ``_``.
        """
        g = latex_to_semantic_graph(r"v = \Delta\theta_0")
        compound = _find_node(g, latex=r"\Delta \theta_0")
        assert compound is not None, (
            "\\Delta\\theta_0 should collapse — the regex must allow a "
            "trailing subscript after a Greek operand"
        )

    def test_delta_with_braced_subscript(self):
        """``\\Delta\\theta_{ij}`` collapses with the braced subscript
        absorbed into the compound.
        """
        g = latex_to_semantic_graph(r"v = \Delta\theta_{ij}")
        compound = _find_node(g, latex=r"\Delta \theta_{ij}")
        assert compound is not None

    def test_delta_with_superscript(self):
        """``\\Delta\\theta^2`` collapses with the superscript absorbed."""
        g = latex_to_semantic_graph(r"v = \Delta\theta^2")
        compound = _find_node(g, latex=r"\Delta \theta^2")
        assert compound is not None

    def test_nabla_does_not_collapse_function_application(self):
        """``\\nabla f(x,y)`` keeps the gradient operator + function shape;
        ``\\nabla`` must not be collapsed onto the following identifier.

        Regression for the ``gradient-descent-terrain`` scene cluster,
        which uses ``\\nabla f(...)`` throughout — collapsing would make
        ``f(x,y)`` parse as a function call on the compound symbol
        ``\\nabla f`` instead of the gradient operator applied to ``f``
        evaluated at ``(x, y)``.
        """
        g = latex_to_semantic_graph(r"\nabla f(x,y)")
        # No compound placeholder should be created — ``\nabla`` stands alone.
        thetas = [n for n in g["nodes"]
                  if isinstance(n.get("id"), str) and n["id"].startswith("Theta_{")]
        assert not thetas, (
            "\\nabla must not be collapsed onto its operand; got "
            f"placeholder nodes {thetas!r}"
        )
        # ``\nabla`` should still appear as its own node.
        nabla = _find_node(g, latex=r"\nabla")
        assert nabla is not None, "\\nabla should remain a standalone node"

    def test_compound_in_power_atomicity(self):
        """``(\\Delta t)^2`` must render with the compound braced — the
        exponent has to bind to the whole ``\\Delta t``, not to ``t`` alone.

        SymPy emits ``\\Theta_{0}^{2}`` for the Pow node's subexpr; the
        restoration step needs to wrap the multi-token replacement in
        braces so the result reads as ``(Δt)²`` rather than ``Δ(t²)``.
        """
        g = latex_to_semantic_graph(r"y = (\Delta t)^2")
        power_subexprs = [
            n.get("subexpr", "") for n in g["nodes"]
            if n.get("op") == "power"
        ]
        assert power_subexprs, "expected a power node in the graph"
        for s in power_subexprs:
            assert r"{\Delta t}" in s, (
                "the compound symbol inside a power must be braced for "
                f"correct precedence, got subexpr={s!r}"
            )
            assert r"\Delta t^" not in s, (
                "unbraced ``\\Delta t^...`` reads as ``Δ(t^...)`` in "
                "LaTeX — exponent must apply to the whole compound"
            )

    def test_compound_with_thin_space_macro(self):
        """``\\Delta\\,t`` — physics typographic spacing — collapses
        identically to ``\\Delta t``.

        Regression for an authoring pattern where the typesetter inserts
        a thin space between the prefix and operand; without macro-aware
        whitespace handling, the regex doesn't fire and SymPy falls back
        to the implicit-multiplication split.
        """
        g = latex_to_semantic_graph(r"v = \Delta\,t")
        compound = _find_node(g, latex=r"\Delta t")
        assert compound is not None, (
            "\\Delta\\,t should collapse to a single \\Delta t node — "
            "spacing macros must not block the compound-symbol rule"
        )
        assert not _find_nodes(g, type="operator", op="multiply"), (
            "\\Delta\\,t must not produce an implicit-multiplication node"
        )

    def test_compound_with_quad_macro(self):
        """``\\Delta \\quad t`` — collapses despite the wide spacing macro."""
        g = latex_to_semantic_graph(r"v = \Delta \quad t")
        compound = _find_node(g, latex=r"\Delta t")
        assert compound is not None

    def test_user_override_does_not_corrupt_text_macros(self):
        """User-supplied overrides keyed on a real symbol (e.g. ``t``)
        must NOT bleed into ``\\text{...}``, ``\\tan``, ``\\left``, etc.

        Regression for the placeholder-restoration over-reach: the old
        loop ran ``str.replace`` for every override regardless of whether
        the key was a synthetic ``Theta_{N}``/``Xi_{N}`` sentinel, which
        meant overriding a single letter would silently chew matching
        characters out of unrelated LaTeX macros.
        """
        g = latex_to_semantic_graph(
            r"\text{const} + t",
            overrides={"t": {"latex": r"\mathrm{t}"}},
        )
        # No node's latex/subexpr should contain the corrupted form
        # ``\ex`` (what's left after a ``\mathrm{t}`` ate the ``t`` of
        # ``\text``). Check both the override is honored *and* \text
        # survives intact.
        const = _find_node(g, latex=r"\text{const}")
        assert const is not None, (
            "user override on 't' must not corrupt \\text{const}"
        )
        for node in g["nodes"]:
            for field in ("latex", "subexpr"):
                value = node.get(field)
                if isinstance(value, str):
                    assert r"\ex" not in value or r"\text" in value, (
                        f"\\text macro corrupted in {field}={value!r}"
                    )

    def test_explicit_product_not_collapsed(self):
        """``\\Delta \\cdot t`` and ``\\Delta \\times t`` mean Δ * t —
        the explicit operator must defeat the compound-symbol heuristic.

        This is the disambiguation contract: adjacency = single symbol,
        ``\\cdot`` / ``\\times`` = explicit multiplication.
        """
        for op_latex in (r"\cdot", r"\times"):
            g = latex_to_semantic_graph(rf"v = \Delta {op_latex} t")
            assert _find_nodes(g, type="operator", op="multiply"), (
                f"\\Delta {op_latex} t should produce a multiply node"
            )
            assert _find_node(g, latex=r"\Delta") is not None, (
                f"\\Delta {op_latex} t must keep \\Delta as its own node"
            )
            assert _find_node(g, latex="t") is not None, (
                f"\\Delta {op_latex} t must keep t as its own node"
            )

    def test_compound_in_relation_subexpr(self):
        """``\\Delta t \\propto x`` must not leak placeholder tokens
        (``\\Theta_{0}``) into the LHS root node's ``subexpr``."""
        g = latex_to_semantic_graph(r"\Delta t \propto x")
        rel = _find_node(g, type="relation")
        assert rel is not None, "should produce a relation node"
        for node in g["nodes"]:
            for field in ("latex", "subexpr"):
                value = node.get(field)
                if isinstance(value, str):
                    assert "Theta" not in value, (
                        f"placeholder leaked into {field}={value!r}"
                    )


# ---------------------------------------------------------------------------
# Parenthetical annotation extraction
# ---------------------------------------------------------------------------

class TestParentheticalAnnotations:
    """Tests for _extract_parenthetical_annotations and annotation node injection."""

    def test_simple_text_annotation(self):
        latex = r"F = m \cdot a \quad (v_e \text{ constant})"
        cleaned, anns = _extract_parenthetical_annotations(latex)
        assert cleaned == r"F = m \cdot a"
        assert len(anns) == 1
        assert anns[0]["type"] == "annotation"
        assert "constant" in anns[0]["label"]
        assert r"\text" in anns[0]["latex"]

    def test_no_annotation(self):
        latex = r"x^2 + y^2 = r^2"
        cleaned, anns = _extract_parenthetical_annotations(latex)
        assert cleaned == latex
        assert anns == []

    def test_plain_math_parentheses_not_extracted(self):
        latex = r"(a + b)^2 = a^2 + 2ab + b^2"
        cleaned, anns = _extract_parenthetical_annotations(latex)
        assert cleaned == latex
        assert anns == []

    def test_qquad_spacing(self):
        latex = r"E = mc^2 \qquad (c \text{ speed of light})"
        cleaned, anns = _extract_parenthetical_annotations(latex)
        assert cleaned == r"E = mc^2"
        assert len(anns) == 1
        assert "speed of light" in anns[0]["label"]

    def test_multiple_annotations(self):
        latex = r"a = b \quad (x \text{ pos}) \quad (y \text{ neg})"
        cleaned, anns = _extract_parenthetical_annotations(latex)
        assert cleaned == r"a = b"
        assert len(anns) == 2

    def test_inject_annotations_adds_nodes(self):
        graph = {"nodes": [{"id": "x", "type": "variable"}], "edges": []}
        anns = [
            {"latex": r"v_e \text{ constant}", "label": "v_e constant", "type": "annotation"},
        ]
        _inject_annotations(graph, anns)
        assert len(graph["nodes"]) == 2
        anno = graph["nodes"][1]
        assert anno["id"] == "__annotation_0"
        assert anno["type"] == "annotation"
        assert anno["label"] == "v_e constant"

    def test_inject_empty_annotations(self):
        graph = {"nodes": [{"id": "x", "type": "variable"}], "edges": []}
        _inject_annotations(graph, [])
        assert len(graph["nodes"]) == 1

    def test_end_to_end_annotation_in_graph(self):
        g = latex_to_semantic_graph(r"F = m a \quad (m \text{ constant})")
        anno = _find_node(g, type="annotation")
        assert anno is not None, "annotation node should be in graph"
        assert anno["id"] == "__annotation_0"
        assert "constant" in anno["label"]

    def test_annotation_does_not_break_equation_parsing(self):
        g = latex_to_semantic_graph(r"v = v_0 + a t \quad (a \text{ constant})")
        eq = _find_node(g, op="equals")
        assert eq is not None, "equation should still parse correctly"
        anno = _find_node(g, type="annotation")
        assert anno is not None
