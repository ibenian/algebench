r"""Model-authored LaTeX must never reach a JSON decoder (#543).

``dspy.adapters.utils.parse_value`` short-circuits on a flat ``str``
(``if annotation is str: return str(value)``), so those fields are safe under
``ChatAdapter`` no matter what. **Every other annotation** goes through
``json_repair.loads`` — and ``\r \n \t \f \b`` are valid JSON escapes as well as
LaTeX command prefixes, so ``\right`` written with one backslash decodes to
CR + ``ight`` and parses as the product ``i·g·h·t``. Nothing raises; the
corruption is invisible downstream.

The fix is structural: a signature carrying LaTeX in a non-``str`` field must run
under ``LineAdapter``, whose wire format has no escape layer. These tests pin
that arrangement so it cannot quietly regress — either by a signature growing a
``dict``-shaped field again, or by the adapter's own guard going soft.
"""

from __future__ import annotations

import pytest

from backend.experts.adapters import LineAdapter
from backend.experts.adapters.line_adapter import LineFormatError, _is_leaf
from backend.experts.modules.proof_completion.signature import ProofCompletionSig
from backend.experts.modules.proof_edit.intent import ProofEditSig


#: Signatures whose output carries model-authored LaTeX in a non-``str`` field.
#: Each MUST be expressible in the line format — that is what lets its call site
#: install ``LineAdapter`` instead of handing the field to ``json_repair``.
LATEX_BEARING = [ProofCompletionSig, ProofEditSig]


@pytest.mark.parametrize("signature", LATEX_BEARING,
                         ids=lambda s: s.__name__)
def test_latex_bearing_signature_is_line_expressible(signature):
    """Every output field survives ``check_annotation`` — no JSON fallback."""
    adapter = LineAdapter()
    for name, field in signature.output_fields.items():
        try:
            adapter.check_annotation(name, field.annotation)
        except LineFormatError as exc:                       # pragma: no cover
            pytest.fail(
                f"{signature.__name__}.{name} is not expressible in the line "
                f"format, so this signature cannot use LineAdapter and its "
                f"LaTeX would be JSON-decoded: {exc}")


def test_proof_edit_steps_is_a_model_not_a_dict():
    """``steps`` must stay ``list[ProposedStep]``.

    As ``list[dict]`` it was accepted by the guard (see
    ``test_bare_dict_is_not_a_leaf``) yet still JSON-decoded — the exact
    combination that makes the corruption invisible. A model also restores the
    field validation a bare ``dict`` has none of.
    """
    from backend.experts.modules.proof_edit.intent import ProposedStep
    ann = ProofEditSig.output_fields["steps"].annotation
    assert ann == list[ProposedStep], f"steps regressed to {ann}"


def test_edit_intent_uses_line_adapter():
    """``EditIntentParser.forward`` must install LineAdapter, via ``dspy.context``.

    Structure, not source text — an ``adapter=`` kwarg on ``Predict`` LOOKS like
    it selects an adapter and does not: ``Predict.forward`` reads
    ``settings.adapter``, so the kwarg sits inertly in ``self.config`` and is
    forwarded to the LM as a generation parameter. That mistake shipped in #539
    and passed review, so it is worth a test that can tell the two apart.

    Losing this silently reinstates the JSON escape layer on ``steps``, and
    ``propose_edit`` swallows the resulting parse failure into a "not an edit" —
    so the symptom would be edits quietly falling through to tutor chat.
    """
    import ast
    import inspect
    from backend.experts.modules.proof_edit import intent

    tree = ast.parse(inspect.getsource(intent))
    forward = next(
        (n for n in ast.walk(tree)
         if isinstance(n, ast.FunctionDef) and n.name == "forward"), None)
    assert forward is not None, "EditIntentParser.forward has been renamed"

    contexts = [n for n in ast.walk(forward)
                if isinstance(n, ast.Call)
                and getattr(n.func, "attr", "") == "context"]
    assert contexts, (
        "forward() no longer opens a dspy.context — the adapter is whatever is "
        "globally configured, which means ChatAdapter and a JSON-decoded `steps`")
    assert any(kw.arg == "adapter" for c in contexts for kw in c.keywords), (
        "dspy.context is opened without an adapter= keyword")

    # And the predictor itself must NOT carry the inert kwarg.
    predicts = [n for n in ast.walk(tree)
                if isinstance(n, ast.Call)
                and getattr(n.func, "attr", "") == "Predict"]
    assert not any(kw.arg == "adapter" for p in predicts for kw in p.keywords), (
        "adapter= passed to dspy.Predict does nothing but reach the LM as a "
        "generation kwarg; install it with dspy.context instead")


@pytest.mark.parametrize("annotation", [dict, set, tuple, frozenset])
def test_bare_dict_is_not_a_leaf(annotation):
    """A BARE collection must not pass as a scalar.

    ``get_origin`` returns the container for ``dict[str, str]`` but ``None`` for
    a bare ``dict``, so the original check called it a leaf. That is worst for
    ``list[dict]``, which is validated by its ITEM type: the bare-``dict`` item
    made the whole field look expressible, and each item would have been
    ``str()``-ed onto a line as a Python repr.
    """
    assert _is_leaf(annotation) is False


def test_list_of_bare_dict_is_refused():
    """The composite case the leaf bug let through, checked end to end."""
    with pytest.raises(LineFormatError):
        LineAdapter().check_annotation("views", list[dict])


def test_flat_str_fields_need_no_adapter():
    """Documents WHY the four ``prompt_endpoints`` fields were never at risk.

    They are flat ``str``, and ``parse_value`` returns those verbatim. This is
    the distinction #517 missed — it audited for a missing repair call rather
    than for the field type — and the reason #539 was closed as obsolete.
    """
    from dspy.adapters.utils import parse_value
    mangled = "\r" + "ight)^{2}"          # what a JSON decoder makes of \right
    assert parse_value(mangled, str) == mangled     # untouched: no decode ran
