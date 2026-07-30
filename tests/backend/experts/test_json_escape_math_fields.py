r"""JSON-mangled LaTeX in fields that are ENTIRELY math.

Observed in a real derivation: a step written ``\left(x + \frac{b}{2a}\right)^2``
came back rendering as ``(x + \frac{b}{2a} \cdot i \cdot g \cdot h \cdot t)^2``.

The cause is that ``\r`` is a valid JSON escape. When the model emits ``\right``
with a single backslash, the decoder turns it into a CARRIAGE RETURN followed by
``ight`` — and ``ight`` is then perfectly good implicit multiplication,
``i·g·h·t``. Nothing errors. The step renders, grounds, and is graded, as a
silently different expression. That is the dangerous shape of this bug: not a
crash, a wrong answer wearing a confidence badge.

``_unmangle_json_escapes`` already existed but could not catch it: it repairs the
whitespace-ambiguous control chars only inside ``$…$``, to avoid eating real line
breaks in prose. A pure-LaTeX field has no ``$`` delimiters and no prose worth
protecting, so it needs the whole-string variant.
"""

from __future__ import annotations

import pytest

from backend.experts.modules.proof_completion.outputs import (
    DerivationStep, unmangle_math, _unmangle_json_escapes,
)

CR = "\r"

# exactly what the JSON decoder produces for a single-backslash \right
MANGLED_RIGHT = r"\left(x + \frac{b}{2 \cdot a}" + CR + "ight)^{2} = 5"
CLEAN_RIGHT = r"\left(x + \frac{b}{2 \cdot a}\right)^{2} = 5"


def test_the_prose_repair_alone_does_not_fix_a_bare_math_field():
    """Documents WHY a second variant is needed, not just that it exists."""
    assert CR in _unmangle_json_escapes(MANGLED_RIGHT)


def test_unmangle_math_restores_the_command():
    assert unmangle_math(MANGLED_RIGHT) == CLEAN_RIGHT


@pytest.mark.parametrize("ctrl,command", [
    ("\r", r"\right"), ("\n", r"\neq"), ("\t", r"\text"),
    ("\x0c", r"\frac"), ("\x08", r"\beta"),
])
def test_every_json_control_escape_round_trips(ctrl, command):
    r"""``\r \n \t \f \b`` are all LaTeX command prefixes AND JSON escapes."""
    mangled = "x = " + ctrl + command[2:]
    assert unmangle_math(mangled) == "x = " + command


def test_it_is_idempotent_and_a_noop_on_clean_input():
    assert unmangle_math(CLEAN_RIGHT) == CLEAN_RIGHT
    assert unmangle_math(unmangle_math(MANGLED_RIGHT)) == CLEAN_RIGHT
    assert unmangle_math("") == ""


def test_derivation_step_repairs_expr_latex():
    step = DerivationStep(operation="find a common denominator",
                          expr_latex=MANGLED_RIGHT,
                          justification="multiply by 4a/4a",
                          change_type="rewrite")
    assert CR not in step.expr_latex
    assert step.expr_latex == CLEAN_RIGHT


def test_the_phantom_product_is_gone_end_to_end():
    r"""The actual symptom: ``i·g·h·t`` appearing in the parsed expression.

    Asserted on the sympy result rather than the string, because the string
    being right is only interesting insofar as the MATH comes out right — and
    the failure mode here was a well-formed expression that meant something else.
    """
    from backend.experts.modules.proof_completion.grounding import graph_to_sympy
    from backend.semantic_graph.service import SemanticGraphService

    svc = SemanticGraphService()
    step = DerivationStep(operation="op", expr_latex=MANGLED_RIGHT,
                          justification="j", change_type="rewrite")
    expr = graph_to_sympy(svc.latex_to_graph(step.expr_latex, domain="algebra"))
    names = {str(s) for s in expr.free_symbols}
    assert names == {"x", "a", "b"}, f"phantom symbols leaked: {names}"
    assert not ({"i", "g", "h", "t"} & names)


def test_proof_edit_math_fields_are_repaired_too():
    """The proof-edit path has the same pure-LaTeX fields and the same hazard."""
    from backend.experts.modules.proof_edit.intent import _clean, _clean_math

    assert _clean_math(MANGLED_RIGHT) == CLEAN_RIGHT
    assert CR in _clean(MANGLED_RIGHT)          # the prose variant still won't
