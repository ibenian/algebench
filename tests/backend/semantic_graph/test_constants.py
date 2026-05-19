"""Smoke tests for backend.semantic_graph.constants.

Validates that every constant is importable and has the expected type/size,
without duplicating the values themselves.
"""

from __future__ import annotations

import re

from backend.semantic_graph.constants import (
    _GREEK_POOL,
    _ACCENT_COMMANDS,
    _DOT_ACCENT_ORDERS,
    _ORDER_TO_ACCENT,
    _CHAIN_RELATION_COMMANDS,
    _LOGICAL_CONNECTIVE_COMMANDS,
    DIMENSIONS,
    DIMENSION_PATTERN,
    KNOWN_VARIABLES,
    OPERATOR_MAP,
    _ASYMMETRIC_OPS,
    _META_RELATION_OPS,
    _PLACEHOLDER_NAME_RE,
    CONSTANT_MAP,
    RELATION_MAP,
    _STYLE_SYMBOL_COMMAND_RE,
    _SIMPLE_STYLED_SYMBOL_RE,
    _OPERATOR_GLYPHS,
    _SUPERSCRIPT_MAP,
    _OP_KINDS,
    _OPERATOR_KINDS,
)


class TestPreprocessorConstants:
    def test_greek_pool_length(self):
        assert len(_GREEK_POOL) == 22
        assert all(isinstance(g, str) for g in _GREEK_POOL)

    def test_accent_commands_tuple(self):
        assert isinstance(_ACCENT_COMMANDS, tuple)
        assert "vec" in _ACCENT_COMMANDS
        assert "dot" not in _ACCENT_COMMANDS

    def test_dot_accent_orders_and_inverse(self):
        assert _DOT_ACCENT_ORDERS["dot"] == 1
        assert _DOT_ACCENT_ORDERS["ddddot"] == 4
        for order, accent in _ORDER_TO_ACCENT.items():
            assert _DOT_ACCENT_ORDERS[accent] == order


class TestEquationChainConstants:
    def test_chain_relation_commands(self):
        assert isinstance(_CHAIN_RELATION_COMMANDS, tuple)
        assert "\\approx" in _CHAIN_RELATION_COMMANDS

    def test_logical_connective_commands(self):
        assert isinstance(_LOGICAL_CONNECTIVE_COMMANDS, tuple)
        assert "\\implies" in _LOGICAL_CONNECTIVE_COMMANDS


class TestTranslatorConstants:
    def test_dimensions_si_units(self):
        assert len(DIMENSIONS) == 7
        assert DIMENSIONS["M"]["si_unit"] == "kg"

    def test_dimension_pattern_compiles(self):
        pat = re.compile(DIMENSION_PATTERN)
        assert pat.match("1")
        assert pat.match("M")
        assert not pat.match("XYZ")

    def test_known_variables(self):
        assert "F" in KNOWN_VARIABLES
        assert KNOWN_VARIABLES["pi"]["type"] == "constant"

    def test_operator_map_keys_are_types(self):
        for key in OPERATOR_MAP:
            assert isinstance(key, type)

    def test_asymmetric_ops(self):
        assert "element_of" in _ASYMMETRIC_OPS
        assert "equals" not in _ASYMMETRIC_OPS

    def test_meta_relation_ops(self):
        assert _META_RELATION_OPS == {"implies", "iff"}

    def test_placeholder_name_re(self):
        assert isinstance(_PLACEHOLDER_NAME_RE, re.Pattern)
        assert _PLACEHOLDER_NAME_RE.match("Theta_{0}")
        assert not _PLACEHOLDER_NAME_RE.match("alpha")

    def test_constant_map(self):
        assert len(CONSTANT_MAP) == 4

    def test_relation_map(self):
        assert isinstance(RELATION_MAP, list)
        assert len(RELATION_MAP) == 15
        ops = {entry[1]["op"] for entry in RELATION_MAP}
        assert "element_of" in ops

    def test_style_regex_patterns(self):
        assert isinstance(_STYLE_SYMBOL_COMMAND_RE, re.Pattern)
        assert isinstance(_SIMPLE_STYLED_SYMBOL_RE, re.Pattern)
        m = _STYLE_SYMBOL_COMMAND_RE.match(r"\mathbb{R}")
        assert m and m.group("style") == "mathbb"


class TestPostprocessorConstants:
    def test_operator_glyphs(self):
        assert _OPERATOR_GLYPHS["equals"] == "="
        assert _OPERATOR_GLYPHS["integral"] == "∫"

    def test_superscript_map(self):
        assert _SUPERSCRIPT_MAP["2"] == "²"

    def test_op_kinds(self):
        assert isinstance(_OP_KINDS, frozenset)
        assert "operator" in _OP_KINDS

    def test_operator_kinds(self):
        assert _OPERATOR_KINDS["add"] == "arithmetic"
        assert _OPERATOR_KINDS["sin"] == "function"
        assert _OPERATOR_KINDS["implies"] == "logical"
        assert _OPERATOR_KINDS["inner_product"] == "quantum"
