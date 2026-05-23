"""Tests for backend.semantic_graph.sympy_translator."""

from __future__ import annotations

import pytest

from backend.semantic_graph.sympy_translator import (
    latex_to_semantic_graph,
    node_short_label,
    node_long_label,
    operator_kind,
    is_asymmetric_relation,
    is_symmetric_relation,
    is_meta_relation,
    is_relation,
    SemanticGraphBuilder,
    _normalize_latex,
    _preprocess_latex,
    _collapse_text_commands,
    _collapse_compound_symbols,
    _split_on_statement_separators,
    _split_on_top_level_comma,
    _split_on_relation,
    _split_chained_equals,
    _is_bare_variable,
    _rejoin_subject_group_commas,
    _classify_expression,
)


# ------------------------------------------------------------------
# Utility functions
# ------------------------------------------------------------------

class TestOperatorKind:
    def test_arithmetic(self):
        assert operator_kind({"type": "operator", "op": "add"}) == "arithmetic"

    def test_function(self):
        assert operator_kind({"type": "function", "op": "sin"}) == "function"

    def test_comparison(self):
        assert operator_kind({"type": "relation", "op": "equals"}) == "comparison"

    def test_non_op(self):
        assert operator_kind({"type": "scalar", "op": "add"}) is None

    def test_unknown_op_defaults(self):
        assert operator_kind({"type": "operator", "op": "unknown_op"}) == "arithmetic"

    def test_unknown_function_defaults(self):
        assert operator_kind({"type": "function", "op": "unknown_fn"}) == "function"


class TestRelationPredicates:
    @pytest.mark.parametrize("op", [
        "greater_than", "less_than", "greater_equal", "less_equal",
        "element_of", "not_element_of",
    ])
    def test_asymmetric(self, op):
        assert is_asymmetric_relation(op) is True
        assert is_symmetric_relation(op) is False
        assert is_meta_relation(op) is False
        assert is_relation(op) is True

    def test_meta_asymmetric(self):
        """implies is both meta and asymmetric — needs lhs/rhs roles."""
        assert is_meta_relation("implies") is True
        assert is_asymmetric_relation("implies") is True
        assert is_symmetric_relation("implies") is False
        assert is_relation("implies") is False  # type="operator", not "relation"

    def test_meta_symmetric(self):
        """iff is both meta and symmetric — flattens to n-ary when chained."""
        assert is_meta_relation("iff") is True
        assert is_symmetric_relation("iff") is True
        assert is_asymmetric_relation("iff") is False
        assert is_relation("iff") is False  # type="operator", not "relation"

    @pytest.mark.parametrize("op", [
        "equals", "approximately", "not_equal", "proportional", "maps_to",
    ])
    def test_symmetric(self, op):
        assert is_symmetric_relation(op) is True
        assert is_asymmetric_relation(op) is False
        assert is_meta_relation(op) is False
        assert is_relation(op) is True

    @pytest.mark.parametrize("op", ["add", "multiply", "power", "sin"])
    def test_non_relation(self, op):
        assert is_relation(op) is False
        assert is_asymmetric_relation(op) is False
        assert is_symmetric_relation(op) is False
        assert is_meta_relation(op) is False

    def test_every_op_is_classified(self):
        """Every RELATION_MAP op is asymmetric or symmetric (meta overlaps both)."""
        from backend.semantic_graph.constants import RELATION_MAP
        all_ops = {meta["op"] for _, meta in RELATION_MAP}
        all_ops.add("equals")
        for op in all_ops:
            asym = is_asymmetric_relation(op)
            sym = is_symmetric_relation(op)
            meta = is_meta_relation(op)
            # Symmetric and asymmetric are mutually exclusive
            assert not (sym and asym), f"{op!r} is both symmetric and asymmetric"
            # Meta ops must be either asymmetric or symmetric
            if meta:
                assert asym or sym, f"{op!r} is meta but neither asymmetric nor symmetric"
            # Every op must be at least one
            assert asym or sym, (
                f"{op!r} is neither asymmetric nor symmetric"
            )


class TestNodeLabels:
    def test_short_label_operator_with_latex(self):
        assert node_short_label({"type": "operator", "latex": "+"}) == "+"

    def test_short_label_operator_glyph(self):
        assert node_short_label({"type": "relation", "op": "equals"}) == "="

    def test_short_label_data_node(self):
        assert node_short_label({"type": "scalar", "latex": "F"}) == "F"

    def test_short_label_fallback_id(self):
        assert node_short_label({"type": "scalar", "id": "x"}) == "x"

    def test_long_label_subexpr(self):
        assert node_long_label({"subexpr": "a + b", "latex": "a"}) == "a + b"

    def test_long_label_fallback(self):
        assert node_long_label({"type": "scalar", "id": "x"}) == "x"


# ------------------------------------------------------------------
# Preprocessing
# ------------------------------------------------------------------

class TestNormalizeLatex:
    def test_html_class_stripped(self):
        result = _normalize_latex(r"\htmlClass{highlighted}{F = ma}")
        assert "htmlClass" not in result
        assert "F = ma" in result

    def test_vert_normalized(self):
        assert "|" in _normalize_latex(r"\lvert x \rvert")

    def test_plain_passthrough(self):
        assert _normalize_latex("x + y") == "x + y"


class TestPreprocessLatex:
    def test_spacing_stripped(self):
        result = _preprocess_latex(r"a \quad b")
        assert r"\quad" not in result

    def test_brace_bare_subscript(self):
        result = _preprocess_latex(r"C_d")
        assert r"C_{d}" in result


class TestCollapseTextCommands:
    def test_basic(self):
        result, overrides = _collapse_text_commands(r"\text{const}")
        assert r"\text{const}" not in result
        assert r"\Xi" in result
        assert len(overrides) == 1

    def test_dedup(self):
        result, overrides = _collapse_text_commands(r"\text{sp} + \text{sp}")
        assert len(overrides) == 1


class TestCollapseCompoundSymbols:
    def test_delta_t(self):
        result, overrides = _collapse_compound_symbols(r"\Delta t")
        assert r"\Theta" in result
        assert len(overrides) == 1
        key = list(overrides.keys())[0]
        assert overrides[key]["latex"] == r"\Delta t"

    def test_partial_not_collapsed(self):
        result, overrides = _collapse_compound_symbols(r"\partial x")
        assert r"\Theta" not in result


# ------------------------------------------------------------------
# Statement splitting
# ------------------------------------------------------------------

class TestSplitOnStatementSeparators:
    def test_backslash_backslash(self):
        parts = _split_on_statement_separators(r"a = 1 \\ b = 2")
        assert len(parts) == 2

    def test_comma_quad(self):
        parts = _split_on_statement_separators(r"a = 1, \quad b = 2")
        assert len(parts) == 2

    def test_no_separator(self):
        parts = _split_on_statement_separators("a = 1")
        assert len(parts) == 1

    def test_nested_not_split(self):
        parts = _split_on_statement_separators(r"\frac{a \\ b}{c}")
        assert len(parts) == 1


class TestSplitOnTopLevelComma:
    def test_escaped_comma(self):
        parts = _split_on_top_level_comma(r"a\, b")
        assert len(parts) == 1


class TestIsBareVariable:
    def test_single_letter(self):
        assert _is_bare_variable("x") is True

    def test_greek(self):
        assert _is_bare_variable(r"\alpha") is True

    def test_with_relation(self):
        assert _is_bare_variable(r"x \in \mathbb{R}") is False

    def test_with_equals(self):
        assert _is_bare_variable("x = 1") is False


class TestRejoinSubjectGroupCommas:
    def test_basic_rejoin(self):
        clauses = [r"\alpha", r"\beta \in \mathbb{C}"]
        result = _rejoin_subject_group_commas(clauses)
        assert len(result) == 1
        assert r"\alpha" in result[0]
        assert r"\beta" in result[0]

    def test_no_rejoin_needed(self):
        clauses = ["a = 1", "b = 2"]
        result = _rejoin_subject_group_commas(clauses)
        assert len(result) == 2


# ------------------------------------------------------------------
# Relation detection
# ------------------------------------------------------------------

class TestSplitOnRelation:
    def test_equals_not_detected(self):
        # Bare = is handled by SymPy, not RELATION_MAP
        assert _split_on_relation("a = b") is None

    def test_approx(self):
        result = _split_on_relation(r"a \approx b")
        assert result is not None
        lhs, meta, rhs = result
        assert lhs == "a"
        assert meta["op"] == "approximately"

    def test_element_of(self):
        result = _split_on_relation(r"x \in \mathbb{R}")
        assert result is not None
        assert result[1]["op"] == "element_of"

    def test_nested_not_matched(self):
        assert _split_on_relation(r"\frac{a \in b}{c}") is None


class TestSplitChainedEquals:
    def test_two_equals(self):
        result = _split_chained_equals("a = b = c")
        assert result is not None
        assert result == ["a", "b", "c"]

    def test_three_equals(self):
        result = _split_chained_equals("a = b = c = d")
        assert result is not None
        assert result == ["a", "b", "c", "d"]

    def test_single_equals(self):
        assert _split_chained_equals("a = b") is None


# ------------------------------------------------------------------
# SemanticGraphBuilder
# ------------------------------------------------------------------

class TestSemanticGraphBuilder:
    def test_simple_symbol(self):
        from sympy import Symbol
        builder = SemanticGraphBuilder()
        graph = builder.build(Symbol("x"))
        assert any(n["id"] == "x" for n in graph["nodes"])

    def test_addition(self):
        from sympy import Symbol
        x, y = Symbol("x"), Symbol("y")
        builder = SemanticGraphBuilder()
        graph = builder.build(x + y)
        ops = [n for n in graph["nodes"] if n.get("op") == "add"]
        assert len(ops) == 1

    def test_symbol_dedup(self):
        from sympy import Symbol
        x = Symbol("x")
        builder = SemanticGraphBuilder()
        graph = builder.build(x + x)
        x_nodes = [n for n in graph["nodes"] if n["id"] == "x"]
        assert len(x_nodes) == 1


# ------------------------------------------------------------------
# Classification
# ------------------------------------------------------------------

class TestClassifyExpression:
    def test_algebraic(self):
        from sympy import Symbol
        x = Symbol("x")
        result = _classify_expression(x + 1)
        assert result["kind"] == "algebraic"

    def test_ode(self):
        from sympy import Symbol, Derivative
        x, t = Symbol("x"), Symbol("t")
        expr = Derivative(x, t) - x
        result = _classify_expression(expr)
        assert result["kind"] == "ODE"
        assert result["order"] == 1


# ------------------------------------------------------------------
# Full pipeline (latex_to_semantic_graph)
# ------------------------------------------------------------------

class TestLatexToSemanticGraph:
    def test_simple_equation(self):
        graph = latex_to_semantic_graph("F = m a")
        assert graph.nodes is not None
        assert graph.edges is not None
        assert graph.classification is not None

    def test_returns_equals_node(self):
        graph = latex_to_semantic_graph("F = m a")
        eq_nodes = [n for n in graph.nodes if n.op == "equals"]
        assert len(eq_nodes) >= 1

    def test_quadratic(self):
        graph = latex_to_semantic_graph("E = mc^2")
        ids = {n.id for n in graph.nodes}
        assert "E" in ids

    def test_domain_carried(self):
        graph = latex_to_semantic_graph("F = ma", domain="physics")
        assert graph.domain == "physics"

    def test_chained_equals(self):
        graph = latex_to_semantic_graph("a = b = c")
        eq_nodes = [n for n in graph.nodes
                     if n.type == "relation" and n.op == "equals"]
        assert len(eq_nodes) >= 1

    def test_statement_separator(self):
        graph = latex_to_semantic_graph(r"a = 1 \\ b = 2")
        assert graph.classification.kind == "statements"
        assert graph.classification.count == 2

    def test_relation_approx(self):
        graph = latex_to_semantic_graph(r"a \approx b")
        rel_nodes = [n for n in graph.nodes
                     if n.op == "approximately"]
        assert len(rel_nodes) == 1

    def test_element_of_relation(self):
        graph = latex_to_semantic_graph(r"x \in \mathbb{R}")
        rel_nodes = [n for n in graph.nodes
                     if n.op == "element_of"]
        assert len(rel_nodes) == 1

    def test_invalid_latex_raises(self):
        with pytest.raises(ValueError):
            latex_to_semantic_graph("")

    def test_parenthetical_annotation(self):
        graph = latex_to_semantic_graph(r"F = ma \quad (v_e \text{ constant})")
        ann_nodes = [n for n in graph.nodes
                     if n.id.startswith("__annotation_")]
        assert len(ann_nodes) >= 1

    def test_compound_symbol(self):
        graph = latex_to_semantic_graph(r"\Delta t = 1")
        node_latexes = [(n.latex or "") for n in graph.nodes]
        assert any(r"\Delta t" in lt for lt in node_latexes)

    def test_text_command(self):
        graph = latex_to_semantic_graph(r"I_{\text{sp}} = 300")
        all_text = " ".join(
            str(v) for n in graph.nodes for v in n.model_dump().values()
        )
        assert "sp" in all_text
