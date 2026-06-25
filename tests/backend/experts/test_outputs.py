"""Tests for the strongly-typed graph-op discriminated union."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.experts.modules.proof_completion.outputs import (
    GRAPH_OP_ADAPTER,
    AddNode,
    DerivationStep,
    ProofTrajectory,
    RemoveEdge,
    RemoveNode,
    _JUSTIFICATION_MAX,
    _OPERATION_MAX,
)
from backend.model.semantic_graph import SemanticGraphNode


def _step(_i=1, expr="x^2 = 4"):   # _i: positional index kept for call sites, unused now
    return DerivationStep(operation="rewrite", expr_latex=expr, justification="valid",
                          change_type="rewrite")


def _node(nid="x"):
    return SemanticGraphNode(id=nid, type="scalar")


def test_each_op_has_only_its_own_fields():
    # RemoveNode has no `node` field; extra='forbid' rejects it.
    with pytest.raises(ValidationError):
        RemoveNode(node_id="x", node=_node(), explanation="e", justification="j")


def test_adapter_dispatches_on_discriminator():
    op = GRAPH_OP_ADAPTER.validate_python(
        {"op": "remove_edge", "edge_from": "a", "edge_to": "b",
         "explanation": "e", "justification": "j"}
    )
    assert isinstance(op, RemoveEdge)
    assert op.edge_from == "a" and op.edge_to == "b"


def test_unknown_discriminator_is_rejected():
    with pytest.raises(ValidationError):
        GRAPH_OP_ADAPTER.validate_python(
            {"op": "frobnicate", "explanation": "e", "justification": "j"}
        )


def test_trajectory_roundtrips_steps():
    traj = ProofTrajectory(
        steps=[_step(1, "x^2 - 4 = 0"), _step(2, "x^2 = 4")],
    )
    dumped = traj.model_dump(by_alias=True)
    back = ProofTrajectory.model_validate(dumped)
    assert [s.expr_latex for s in back.steps] == ["x^2 - 4 = 0", "x^2 = 4"]


def test_expert_result_preserves_subclass_fields_on_dump():
    # ExpertResult.outputs is list[SerializeAsAny[Output]] — dumping must keep
    # the concrete subclass fields (e.g. ProofTrajectory.steps), not just the base.
    from backend.experts.outputs import ExpertResult

    traj = ProofTrajectory(steps=[_step(1, "x = 2")])
    result = ExpertResult(expert="proof_completion", context_id="semanticGraph",
                          outputs=[traj])
    d = result.model_dump(by_alias=True)
    assert d["outputs"][0]["kind"] == "proof_trajectory"
    assert len(d["outputs"][0]["steps"]) == 1          # subclass field survived
    assert d["outputs"][0]["steps"][0]["expr_latex"] == "x = 2"
    # single() returns the one output for single-output experts
    assert result.single() is traj
    import pytest
    with pytest.raises(ValueError):
        ExpertResult(expert="e", context_id="c", outputs=[traj, traj]).single()


def test_overlong_justification_is_clamped_not_rejected():
    # A justification past the cap must NOT fail validation (which would abort the
    # whole derive) — it's trimmed to the cap with an ellipsis instead.
    long_just = "because " + "x" * (_JUSTIFICATION_MAX + 200)
    step = DerivationStep(operation="rewrite", expr_latex="x^2 = 4",
                          justification=long_just, change_type="rewrite")
    assert len(step.justification) <= _JUSTIFICATION_MAX
    assert step.justification.endswith("…")


def test_overlong_operation_is_clamped():
    step = DerivationStep(operation="o " + "p" * (_OPERATION_MAX + 50),
                          expr_latex="x = 2", justification="j", change_type="solve")
    assert len(step.operation) <= _OPERATION_MAX
    assert step.operation.endswith("…")


def test_normal_length_prose_is_unchanged():
    step = DerivationStep(operation="add 4 to both sides", expr_latex="x^2 = 4",
                          justification="isolate the squared term", change_type="rewrite")
    assert step.operation == "add 4 to both sides"
    assert step.justification == "isolate the squared term"


def test_overlong_expr_latex_still_rejected():
    # expr_latex is NOT clamped — truncating LaTeX would corrupt the math.
    with pytest.raises(ValidationError):
        DerivationStep(operation="o", expr_latex="x" * 700,
                       justification="j", change_type="rewrite")


# --- JSON-escape mangling repair (the \frac→"rac", \rho→"ho" bug) -------------

# The model emits a prose field with a SINGLE backslash inside the JSON string
# (``$\frac…$``); the JSON parser reads ``\f``/``\r`` as control-char escapes and
# eats the command's first letter. ``\x0c`` (form feed) is what ``\f`` leaves
# behind, ``\x0d`` (CR) is what ``\r`` leaves behind.
_MANGLED_OP = "Substitute drag force, $F_D = \x0crac{1}{2} \rho A C_d V^2$, here."
_FIXED_OP = "Substitute drag force, $F_D = \\frac{1}{2} \\rho A C_d V^2$, here."


def test_mangled_operation_is_repaired():
    step = DerivationStep(operation=_MANGLED_OP, expr_latex="x = 2",
                          justification="j", change_type="substitute")
    assert step.operation == _FIXED_OP
    assert "\x0c" not in step.operation and "\r" not in step.operation


def test_mangled_justification_is_repaired():
    step = DerivationStep(operation="o", expr_latex="x = 2",
                          justification=_MANGLED_OP, change_type="substitute")
    assert step.justification == _FIXED_OP


def test_repair_is_idempotent_and_noop_for_clean_text():
    # already-correct prose with doubled backslashes must be left untouched
    step = DerivationStep(operation=_FIXED_OP, expr_latex="x = 2",
                          justification="add $\\frac{c}{a}$ to both sides",
                          change_type="rewrite")
    assert step.operation == _FIXED_OP
    assert step.justification == "add $\\frac{c}{a}$ to both sides"


def test_repair_leaves_real_whitespace_alone():
    # a newline/tab NOT followed by a lowercase letter is genuine whitespace
    step = DerivationStep(operation="line one\n2nd part\tEnd", expr_latex="x = 2",
                          justification="j", change_type="rewrite")
    assert step.operation == "line one\n2nd part\tEnd"


def test_repair_is_scoped_to_math_real_prose_newline_preserved():
    # a real line break in PROSE (outside $…$) before a lowercase word must NOT
    # be turned into a literal '\n' — we only un-mangle whitespace inside math.
    txt = "first line\nthen the rest, with $x = 2$"
    step = DerivationStep(operation=txt, expr_latex="x = 2", justification="j",
                          change_type="rewrite")
    assert step.operation == txt   # newline preserved as a genuine line break


def test_repair_fixes_ambiguous_whitespace_inside_math():
    # the SAME char that's left alone in prose IS repaired inside $…$: here a CR
    # (\r) ate the backslash of \rho, sitting inside the math span.
    step = DerivationStep(operation="density $\rho A$ term", expr_latex="x = 2",
                          justification="j", change_type="rewrite")
    assert step.operation == "density $\\rho A$ term"


def test_expr_latex_is_never_rewritten():
    # expression fields are immune — the repair must not touch them even if a
    # stray control char somehow appears (here a benign one stays as-is).
    step = DerivationStep(operation="o", expr_latex="\\frac{1}{2} \\rho",
                          justification="j", change_type="rewrite")
    assert step.expr_latex == "\\frac{1}{2} \\rho"


def test_graph_op_prose_is_repaired():
    op = GRAPH_OP_ADAPTER.validate_python(
        {"op": "remove_edge", "edge_from": "a", "edge_to": "b",
         "explanation": _MANGLED_OP, "justification": _MANGLED_OP}
    )
    assert op.explanation == _FIXED_OP
    assert op.justification == _FIXED_OP


def test_change_type_roundtrips_and_is_required():
    # survives a dump/validate round trip
    tagged = DerivationStep(operation="take the root", expr_latex="x = 2",
                            justification="both sides nonneg", change_type="solve")
    back = DerivationStep.model_validate(tagged.model_dump())
    assert back.change_type == "solve"
    # required: a step without a declared change_type is rejected
    with pytest.raises(ValidationError):
        DerivationStep.model_validate(
            {"operation": "rewrite", "expr_latex": "x^2 = 4", "justification": "valid"})
    # invalid value is rejected
    with pytest.raises(ValidationError):
        DerivationStep(operation="o", expr_latex="x", justification="j",
                       change_type="guess")
