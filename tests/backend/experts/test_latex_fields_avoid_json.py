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
from backend.experts.handlers.proof_animation.term_descriptions import (
    TermDescriptionsSig,
)
from backend.experts.modules.expression_analysis.proposer import (
    MoreProbesSig, VizProposalSig,
)
from backend.experts.modules.proof_completion.judge import (
    DomainStepJudgeSig, ProofJudgeSig,
)
from backend.experts.modules.proof_completion.signature import ProofCompletionSig
from backend.experts.modules.proof_edit.intent import ProofEditSig


#: Signatures whose output carries model-authored LaTeX in a non-``str`` field.
#: Each MUST be expressible in the line format — that is what lets its call site
#: install ``LineAdapter`` instead of handing the field to ``json_repair``.
LATEX_BEARING = [ProofCompletionSig, ProofEditSig, VizProposalSig,
                 MoreProbesSig, TermDescriptionsSig]

#: Every signature with a non-``str`` output field, LaTeX-bearing or not. The
#: judges carry only ``float``/``bool``, so nothing can be *mangled* there — but
#: #543's second criterion is that the adapter is a stated choice per signature
#: rather than a default only some of them were audited against, and a scalar is
#: JSON-decoded exactly like everything else.
NON_STR_OUTPUT = LATEX_BEARING + [ProofJudgeSig, DomainStepJudgeSig]

#: Where each of those is CALLED, and the function that must open the context.
#: A signature being line-EXPRESSIBLE buys nothing on its own; the adapter is
#: chosen per call site, and the global one is ``ChatAdapter``.
CALL_SITES = [
    ("backend.experts.modules.proof_edit.intent", "forward"),
    ("backend.experts.modules.expression_analysis.proposer", "forward"),
    ("backend.experts.handlers.proof_animation.term_descriptions",
     "describe_terms"),
    ("backend.experts.modules.proof_completion.judge", "__call__"),
]


@pytest.mark.parametrize("signature", NON_STR_OUTPUT,
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


@pytest.mark.parametrize("module_name,func_name", CALL_SITES,
                         ids=lambda v: v.rsplit(".", 1)[-1])
def test_call_site_installs_line_adapter(module_name, func_name):
    """Every function calling a LaTeX-bearing predictor must open the context.

    Structure, not source text — an ``adapter=`` kwarg on ``Predict`` LOOKS like
    it selects an adapter and does not: ``Predict.forward`` reads
    ``settings.adapter``, so the kwarg sits inertly in ``self.config`` and is
    forwarded to the LM as a generation parameter. That mistake shipped in #539
    and passed review, so it is worth a test that can tell the two apart.

    EVERY definition of the named function is checked, not the first one found:
    ``proposer`` has two (``VizProposer`` and ``MoreProbesGenerator``), and a
    test that stopped at the first would have passed with the second left on
    ChatAdapter.

    Losing this silently reinstates the JSON escape layer, and each of these
    callers swallows the resulting parse failure — ``propose_edit`` returns "not
    an edit", ``propose_views`` abstains, ``describe_terms`` returns ``{}``. So
    the symptom is not an error but silence.
    """
    import ast
    import importlib
    import inspect

    tree = ast.parse(inspect.getsource(importlib.import_module(module_name)))
    funcs = [n for n in ast.walk(tree)
             if isinstance(n, ast.FunctionDef) and n.name == func_name]
    assert funcs, f"{module_name}.{func_name} has been renamed"

    for func in funcs:
        contexts = [n for n in ast.walk(func)
                    if isinstance(n, ast.Call)
                    and getattr(n.func, "attr", "") == "context"]
        assert any(kw.arg == "adapter" for c in contexts for kw in c.keywords), (
            f"{module_name}.{func_name} does not open a dspy.context(adapter=…) "
            f"— the adapter is whatever is globally configured, which means "
            f"ChatAdapter and a JSON-decoded output field")

    # And no predictor may carry the inert kwarg.
    predicts = [n for n in ast.walk(tree)
                if isinstance(n, ast.Call)
                and getattr(n.func, "attr", "") == "Predict"]
    assert not any(kw.arg == "adapter" for p in predicts for kw in p.keywords), (
        "adapter= passed to dspy.Predict does nothing but reach the LM as a "
        "generation kwarg; install it with dspy.context instead")


@pytest.mark.parametrize("signature", NON_STR_OUTPUT, ids=lambda s: s.__name__)
def test_no_output_field_is_a_bare_mapping(signature):
    """#543's first acceptance criterion, checked directly.

    ``check_annotation`` already refuses these, so this is not redundant belt
    and braces: it names the *shape* that was wrong rather than the adapter that
    happens to reject it, and it keeps failing usefully if the guard is ever
    relaxed.
    """
    for name, field in signature.output_fields.items():
        ann = field.annotation
        assert ann not in (dict, list[dict]), (
            f"{signature.__name__}.{name} is {ann} — a JSON-decoded shape with "
            f"no field validation. Reshape it into a flat pydantic model.")


def test_viz_proposal_latex_survives_a_real_parse():
    """End to end on the field #543 called the sharpest case.

    ``views[].plots[].latex`` was model-authored LaTeX two levels inside a
    ``list[dict]``, JSON-decoded on every expression-analysis call. Here the
    same LaTeX goes through the adapter that now carries it, written the way a
    model actually writes it — ONE backslash. Under a JSON decoder ``\\right``
    becomes CR + ``ight`` and ``\\theta`` becomes TAB + ``heta``; both would then
    parse as implicit products, silently.
    """
    completion = (
        "[[ ## abstain ## ]]\nFalse\n\n"
        "[[ ## abstain_reason ## ]]\n\n\n"
        "[[ ## title ## ]]\nDamped Oscillation\n\n"
        "[[ ## story ## ]]\nA swing that never quite stops.\n\n"
        "[[ ## ranked ## ]]\nfeature: peak\nusefulness: 5\nwhy: it is the point\n\n"
        "[[ ## views ## ]]\n"
        "kind: plane-2d\nx_var: t\nx_min: 0\nx_max: 10\n"
        "pinned: beta=0.3\nmark: peak\nrationale: the whole decay\n\n"
        "[[ ## plots ## ]]\n"
        "view: 1\n"
        r"latex: \left(e^{-\beta t}\right)\cos\theta" "\n"
        "label: envelope\n\n"
        "[[ ## annotations ## ]]\n"
        "view: 1\nkind: vline\n"
        r"at: \frac{\pi}{2\theta}" "\n"
        "to: \nlabel: quarter turn\ngroup: \n\n"
        "[[ ## probes ## ]]\n"
        "question: What happens as $t$ grows?\n"
        "option_1: it grows\noption_2: it decays\noption_3: \noption_4: \n"
        "correct_index: 2\nexplanation: the envelope shrinks\nfeature: peak\n\n"
        "[[ ## variable_glossary ## ]]\n"
        "name: t\ndescription: time since release, in seconds\n\n"
        "[[ ## completed ## ]]\n"
    )
    parsed = LineAdapter().parse(VizProposalSig, completion)

    plot = parsed["plots"][0]
    assert plot.latex == r"\left(e^{-\beta t}\right)\cos\theta"
    assert parsed["annotations"][0].at == r"\frac{\pi}{2\theta}"
    # The specific corruption: a JSON decode would leave control characters and
    # eat the command names. Neither survives here, because no decode ran.
    for field in (plot.latex, parsed["annotations"][0].at):
        assert not any(c in field for c in "\r\n\t\f\b")
        assert "ight" not in field.replace("right", "")
        assert "heta" not in field.replace("theta", "")

    # And the flat wire still re-nests into the shape the page consumes.
    from backend.experts.modules.expression_analysis.proposer import _assemble_views
    views = _assemble_views(parsed["views"], parsed["plots"],
                            parsed["annotations"])
    assert views[0].plots[0].latex == plot.latex
    assert views[0].pinned == {"beta": 0.3}


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
