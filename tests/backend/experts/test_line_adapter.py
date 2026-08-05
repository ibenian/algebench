r"""LineAdapter: a wire format with no escape layer, so LaTeX survives verbatim.

The bug this exists to make impossible: JSON string escaping and LaTeX both use
backslash, and five letters collide (``\b \f \n \r \t``). A model writing
``"\right"`` instead of ``"\\right"`` yields *valid* JSON that decodes to a
carriage return plus ``ight``, which parses as the product ``i·g·h·t``. Nothing
errors; the expression is simply a different one.

So the tests that matter here are not "does it round-trip" (it obviously does)
but:

* single-backslash LaTeX survives **byte-identical**, and
* anything the format cannot carry **raises** instead of truncating — silent
  truncation would be the same class of bug wearing new clothes.
"""

from __future__ import annotations

from typing import Literal, Optional

import dspy
import pytest
from pydantic import BaseModel, Field

from backend.experts.adapters import LineAdapter, LineFormatError
from dspy.utils.exceptions import AdapterParseError

BS = chr(92)
CR = chr(13)


class Step(BaseModel):
    change_type: Literal["rewrite", "solve"] = Field(description="the KIND of move")
    expr_latex: str = Field(description="COMPLETE LaTeX")
    justification: str = Field(description="why this step is valid")


class Sig(dspy.Signature):
    goal: str = dspy.InputField()
    steps: list[Step] = dspy.OutputField(desc="the derivation")
    tags: list[str] = dspy.OutputField(desc="keywords")
    title: str = dspy.OutputField()


# The exact commands whose first letter collides with a JSON escape.
COLLIDING = [rf"{BS}right)", rf"{BS}frac{{b}}{{2a}}", rf"{BS}theta",
             rf"{BS}neq", rf"{BS}beta", rf"{BS}times", rf"{BS}tau"]

COMPLETION = f"""[[ ## steps ## ]]
change_type: rewrite
expr_latex: x^{{2}} + {BS}frac{{b}}{{a}} {BS}cdot x = -{BS}frac{{c}}{{a}}
justification: Make the leading coefficient 1.

change_type: solve
expr_latex: x + {BS}frac{{b}}{{2a}} = {BS}pm{BS}sqrt{{{BS}frac{{b^2-4ac}}{{4a^2}}}}
justification: Both roots are kept.

[[ ## tags ## ]]
quadratic
completing the square

[[ ## title ## ]]
Quadratic Formula

[[ ## completed ## ]]
"""


# ── the point of the whole exercise ──────────────────────────────────────────

@pytest.mark.parametrize("command", COLLIDING)
def test_single_backslash_latex_survives_byte_identical(command):
    r"""Written with ONE backslash — as in a document — and unchanged on arrival.

    Under JSON each of these decodes to a control character plus a word
    fragment; here there is no decoding step to get wrong.
    """
    out = LineAdapter().parse_field("expr_latex", f"x = {command}", str)
    assert out == f"x = {command}"
    assert not any(ord(c) < 32 for c in out)


def test_a_full_completion_parses_with_latex_intact():
    fields = LineAdapter().parse(Sig, COMPLETION)
    assert [s.change_type for s in fields["steps"]] == ["rewrite", "solve"]
    assert fields["steps"][1].expr_latex == (
        f"x + {BS}frac{{b}}{{2a}} = {BS}pm{BS}sqrt{{{BS}frac{{b^2-4ac}}{{4a^2}}}}")
    assert fields["tags"] == ["quadratic", "completing the square"]
    assert fields["title"] == "Quadratic Formula"


def test_pydantic_validation_is_preserved():
    """Leaving JSON must not cost us the model's own validation."""
    bad = COMPLETION.replace("change_type: rewrite", "change_type: nonsense")
    with pytest.raises(AdapterParseError):
        LineAdapter().parse(Sig, bad)


# ── the properties that disqualified the alternatives ────────────────────────

def test_a_colon_inside_a_value_is_safe():
    """Splits on the FIRST colon only. YAML rejects this outright."""
    step = LineAdapter().parse_field("s", "change_type: rewrite\nexpr_latex: a\n"
                            "justification: Note: divide by a", list[Step])[0]
    assert step.justification == "Note: divide by a"


def test_a_leading_brace_is_not_reinterpreted():
    """YAML silently turns ``{x}`` into a mapping; here it is just text."""
    assert LineAdapter().parse_field("tex", "{x}", str) == "{x}"


def test_a_percent_sign_is_safe():
    """configparser's default interpolation raises on this; LaTeX uses ``%``."""
    assert LineAdapter().parse_field("why", "100% of cases, 50% off", str) == "100% of cases, 50% off"


# ── what it CANNOT carry must be loud, never truncated ───────────────────────

def test_a_newline_in_a_rendered_value_raises():
    r"""Refuse to EMIT what we could not read back."""
    with pytest.raises(LineFormatError, match="newline"):
        LineAdapter().render_value("expr_latex", "line one\nline two", str)


def test_a_value_spilling_onto_a_second_line_raises():
    """RFC822 would FOLD this onto the previous value, silently rewriting the
    author's text. We refuse instead — a spilled value is a model slip."""
    with pytest.raises(LineFormatError, match="must not span lines"):
        LineAdapter().parse_field("s", "change_type: rewrite\nexpr_latex: a\n   oops", list[Step])


def test_indentation_is_tolerated():
    """Models mirror the indented example in the prompt. Rejecting that made a
    perfectly good response fail — and the inherited JSONAdapter fallback then
    HID the failure behind a second, silent LM call. Caught in a live run."""
    block = ("  change_type: rewrite\n"
             "  expr_latex: a " + BS + "cdot x\n"
             "  justification: w")
    step = LineAdapter().parse_field("s", block, list[Step])[0]
    assert step.expr_latex == "a " + BS + "cdot x"


def test_a_spill_that_looks_like_a_key_is_still_caught():
    """Two independent guards make tolerating indentation safe.

    A key must be a BARE IDENTIFIER, so prose before a colon is rejected as a
    spill; and a key that *is* an identifier is still checked against the
    model's fields. Between them, a value spilling onto a second line cannot be
    silently absorbed however it happens to be worded.
    """
    with pytest.raises(LineFormatError, match="must not span lines"):
        LineAdapter().parse_field("s", "change_type: rewrite\n  and then: we divide", list[Step])

    with pytest.raises(LineFormatError, match="unknown key"):
        LineAdapter().parse_field("s", "change_type: rewrite\n  note: we divide", list[Step])


def test_an_unknown_key_raises():
    with pytest.raises(LineFormatError, match="unknown key"):
        LineAdapter().parse_field("s", "change_type: rewrite\nnope: x", list[Step])


def test_a_duplicate_key_raises_in_a_SINGLE_model_field():
    """One model, one value per key — a repeat there is genuinely ambiguous.

    In a ``list[Model]`` field a repeat means the next item began (see
    ``test_run_together_blocks_are_split_not_merged``); with only ONE model
    expected there is no next item, so it stays an error.
    """
    with pytest.raises(LineFormatError, match="duplicate"):
        LineAdapter().parse_field(
            "s", "change_type: rewrite\nchange_type: solve", Optional[Step])


def test_a_missing_output_field_raises():
    with pytest.raises(AdapterParseError, match="missing output field"):
        LineAdapter().parse(Sig, "[[ ## title ## ]]\nonly this\n")


# ── demos must speak the same dialect the prompt demands ─────────────────────

def test_demos_render_in_line_format_not_json():
    """A demo rendered as JSON while the prompt demands lines would silently
    teach the wrong format — and would be baked into any compiled program."""
    body = LineAdapter().format_assistant_message_content(
        Sig, {"steps": [Step(change_type="rewrite",
                             expr_latex=rf"a {BS}cdot x",
                             justification="w")],
              "tags": ["t1", "t2"], "title": "T"})
    assert rf"expr_latex: a {BS}cdot x" in body
    assert '{"' not in body                      # no JSON anywhere
    assert "t1\nt2" in body


def test_render_then_parse_round_trips():
    steps = [Step(change_type="rewrite", expr_latex=rf"{BS}frac{{a}}{{b}}",
                  justification="j1"),
             Step(change_type="solve", expr_latex=rf"x = {BS}pm 3",
                  justification="j2")]
    text = LineAdapter().render_value("steps", steps, list[Step])
    assert LineAdapter().parse_field("steps", text, list[Step]) == steps


def test_optional_model_field_is_supported():
    class Wrapper(BaseModel):
        a: str

    assert LineAdapter().parse_field("w", "a: hello", Optional[Wrapper]).a == "hello"


def test_an_empty_list_item_raises_rather_than_vanishing():
    """``['a', '', 'b']`` would render as ``a\\n\\nb`` and read back as
    ``['a', 'b']`` — a silent drop, which is the exact failure class this
    format exists to remove. Found by asking what separates list elements."""
    with pytest.raises(LineFormatError, match="empty list item"):
        LineAdapter().render_value("tags", ["a", "", "b"], list[str])


def test_list_separators_are_what_they_claim():
    """list[str] -> one per line; list[BaseModel] -> blank line between blocks."""
    assert LineAdapter().render_value("tags", ["a", "b"], list[str]) == "a\nb"

    two = [Step(change_type="rewrite", expr_latex="x", justification="j"),
           Step(change_type="solve", expr_latex="y", justification="k")]
    rendered = LineAdapter().render_value("steps", two, list[Step])
    assert "\n\n" in rendered
    assert len(LineAdapter().parse_field("steps", rendered, list[Step])) == 2


@pytest.mark.parametrize("blanks", [1, 2, 4])
def test_the_number_of_blank_lines_between_blocks_does_not_matter(blanks):
    text = ("change_type: rewrite\nexpr_latex: a\njustification: j"
            + "\n" * (blanks + 1)
            + "change_type: solve\nexpr_latex: b\njustification: k")
    assert len(LineAdapter().parse_field("steps", text, list[Step])) == 2


def test_run_together_blocks_are_split_not_merged():
    """Run-together blocks must not silently merge — they are RECOVERED.

    This previously raised on the duplicate key, which honoured the invariant
    (no silent merge) but threw the data away with it. Models omit the blank
    line often enough that raising was not viable: for a caller that swallows
    parse failures — ``propose_edit`` returns "not an edit" — the symptom was not
    an error but silence, a valid request dropping to chat with nothing to show
    (#543). A repeated key is unambiguous evidence the next item began, so the
    split recovers every block instead.

    The invariant this test has always protected is unchanged: the two blocks
    must not end up as one item.
    """
    text = ("change_type: rewrite\nexpr_latex: a\njustification: j\n"
            "change_type: solve\nexpr_latex: b\njustification: k")
    steps = LineAdapter().parse_field("steps", text, list[Step])
    assert [s.change_type for s in steps] == ["rewrite", "solve"]
    assert [s.expr_latex for s in steps] == ["a", "b"]
    assert [s.justification for s in steps] == ["j", "k"]


def test_blank_line_separated_blocks_still_parse():
    """The documented separator keeps working — the fallback is additive."""
    text = ("change_type: rewrite\nexpr_latex: a\njustification: j\n\n"
            "change_type: solve\nexpr_latex: b\njustification: k")
    steps = LineAdapter().parse_field("steps", text, list[Step])
    assert [s.expr_latex for s in steps] == ["a", "b"]


def test_a_value_spilling_onto_a_second_line_still_raises():
    """The split must not soften the real error it was masking.

    A continuation line is not ``key: value``, so it is passed through to
    ``parse_block`` untouched and still fails — honouring it would silently
    truncate the author's text.
    """
    text = ("change_type: rewrite\nexpr_latex: a\njustification: first line\n"
            "and the rest of the sentence spilled here")
    with pytest.raises(LineFormatError, match="must not span lines"):
        LineAdapter().parse_field("steps", text, list[Step])


def test_stray_and_trailing_blank_lines_are_ignored():
    assert LineAdapter().parse_field("tags", "a\n\n\nb\n\nc\n\n", list[str]) == \
        ["a", "b", "c"]


# ── field-type coverage: what is supported, and what must be REFUSED ─────────

@pytest.mark.parametrize("annotation,text,expected", [
    (str, "hello", "hello"),
    (int, "42", 42),
    (float, "3.5", 3.5),
    (bool, "true", True),
    (Literal["a", "b"], "a", "a"),
    (Optional[str], "x", "x"),
    (list[str], "a\nb", ["a", "b"]),
    (list[int], "1\n2", [1, 2]),
    (list[float], "1.5\n2.5", [1.5, 2.5]),
])
def test_supported_field_types_coerce_correctly(annotation, text, expected):
    """``list[int]`` returning ``['1', '2']`` would be a SILENT type error — the
    caller declared ints and the list is the field value, so pydantic never sees
    it. Each item is coerced to the declared type."""
    got = LineAdapter().parse_field("f", text, annotation)
    assert got == expected
    if isinstance(expected, list) and expected:
        assert type(got[0]) is type(expected[0])


@pytest.mark.parametrize("annotation", [
    dict[str, str],          # fell through to json_repair — reinstating JSON
    list[list[str]],         # was silently FLATTENED to a list of strings
    set[str],
    tuple[str, str],
])
def test_inexpressible_field_types_are_refused(annotation):
    """An unsupported annotation must not fall through to DSPy's ``parse_value``.

    That path is ``json_repair`` — which would silently reinstate the very JSON
    escaping this adapter exists to remove. Found by auditing type coverage
    before merge: ``dict`` did exactly that, and ``list[list[...]]`` was
    flattened without complaint.
    """
    with pytest.raises(LineFormatError):
        LineAdapter().parse_field("f", "whatever", annotation)


def test_a_literal_field_advertises_its_allowed_values():
    """The JSON-schema path listed ``enum`` values; omitting them here would be a
    regression in what the model is told, pushing it toward guessing."""
    assert "one of: rewrite | solve" in LineAdapter().describe_field("steps", list[Step])


def test_a_long_description_is_not_truncated():
    """An earlier version sliced descriptions at 60 chars, cutting them
    mid-sentence — strictly less than the JSON schema told the model."""
    long = ("the KIND of move: 'rewrite' (equivalence-preserving rearrangement), "
            "'solve' (narrows toward a solution), 'given' (a premise)")

    class Wordy(BaseModel):
        change_type: str = Field(description=long)

    spec = LineAdapter().describe_field("f", list[Wordy])
    assert long in spec


@pytest.mark.parametrize("name", ["Image", "ToolCalls"])
def test_dspy_media_and_tool_types_are_refused_as_outputs(name):
    """Subclasses of DSPy's media base class serialise to message CONTENT, not text.

    ``Image`` is the trap: its only field is ``url: str``, so it passes a naive
    leaf test and would render as ``url: …`` — text where the provider expects
    an image part. They stay fine as INPUTS; this adapter does not touch those.
    """
    import dspy.adapters.types as T

    with pytest.raises(LineFormatError, match="serialises to message content"):
        LineAdapter().describe_field("f", getattr(T, name))


def test_silent_json_fallback_is_refused():
    """The unlogged ``ChatAdapter`` -> ``JSONAdapter`` retry must be OFF (#527).

    Left on, a parse bug in this adapter is invisible: DSPy catches it, silently
    re-asks as JSON — a second, unlogged LM call — and the field values go back
    through the escape layer this class exists to remove. The corruption being
    prevented returns by the back door with no trace.
    """
    assert LineAdapter().use_json_adapter_fallback is False


def test_parse_failure_raises_instead_of_re_asking_as_json():
    """End-to-end: an unparseable response RAISES; no second LM call is made.

    The unit tests above prove ``parse`` raises. This proves the raise actually
    escapes ``__call__`` — which it did not before the fallback was refused, and
    that gap is exactly what made the trapdoor invisible.
    """
    calls: list[dict] = []

    class OneShotLM(dspy.LM):
        """Returns a response no line parser can accept, and counts calls."""

        def __init__(self):
            super().__init__("openai/gpt-4o-mini", api_key="x", cache=False)

        def __call__(self, prompt=None, messages=None, **kwargs):
            calls.append(kwargs)
            # A line with no ``key: value`` shape at all — no colon, so it
            # fails KEY_PATTERN and `steps` can never be built. Unparseable by
            # construction, and by a different route than a value that spills
            # onto a second line (which the same check also catches).
            return ["[[ ## steps ## ]]\nnot a key value line at all\n"
                    "[[ ## completed ## ]]\n"]

    lm = OneShotLM()
    with dspy.context(lm=lm, adapter=LineAdapter()):
        with pytest.raises(AdapterParseError):
            dspy.Predict(Sig)(goal="solve it")

    assert len(calls) == 1, (
        f"expected exactly one LM call, got {len(calls)} — the JSONAdapter "
        f"fallback fired and silently re-asked")


def test_media_base_class_resolves(monkeypatch):
    """The media base class must RESOLVE, whatever DSPy currently calls it.

    It is ``BaseType`` in 2.6 and ``Type`` in 3.x (issue #527). ``_media_base``
    returning ``None`` is the dangerous outcome, because it is silent: every
    check above would then pass and an ``Image`` output field would render as
    ``url: …`` text. The test above catches the rename only for the two types it
    names; this catches the resolution itself, so a THIRD rename fails here with
    an obvious message instead of quietly disarming the guard.
    """
    from backend.experts.adapters.line_adapter import _media_base

    _media_base.cache_clear()
    base = _media_base()
    assert base is not None, (
        "DSPy's media base class resolved to None — it has been renamed again; "
        "add the new spelling to _media_base()")
    import dspy.adapters.types as T
    assert issubclass(T.Image, base)

    # and the guard must not be silently disarmed if it ever DOESN'T resolve
    monkeypatch.setattr("backend.experts.adapters.line_adapter._media_base",
                        lambda: None)
    from backend.experts.adapters.line_adapter import _is_special
    assert _is_special(T.Image) is False   # documents the fail-open behaviour
    _media_base.cache_clear()


# ── Copilot review, #522 ─────────────────────────────────────────────────────

@pytest.mark.parametrize("annotation,expect_leaf", [
    (Optional[str], True),
    (str | None, True),                    # PEP 604 — was NOT unwrapped
    (Optional[Step], False),
    (Step | None, False),                  # PEP 604 — was treated as a SCALAR
])
def test_both_optional_spellings_unwrap(annotation, expect_leaf):
    r"""``Optional[T]`` and ``T | None`` must behave identically.

    ``get_origin(Optional[T])`` is ``typing.Union``; ``get_origin(T | None)`` is
    ``types.UnionType`` — a different object. Checking only the former left
    ``Step | None`` unwrapped, so it was classed a leaf and would have been
    ``str()``-ed into the line as garbage.
    """
    from backend.experts.adapters.line_adapter import _is_leaf, _unwrap_optional

    assert _unwrap_optional(annotation) in (str, Step)
    assert _is_leaf(annotation) is expect_leaf


def test_a_duplicate_output_section_raises_rather_than_dropping():
    """``ChatAdapter`` keeps the first block and drops the rest silently.

    That is truncation, and this adapter's contract is to raise rather than
    truncate — a second ``[[ ## steps ## ]]`` means the model produced more than
    we would return, and losing it costs derivation steps without a trace.
    """
    dup = COMPLETION + "\n[[ ## tags ## ]]\nan extra block\n"
    with pytest.raises(AdapterParseError, match="more than once"):
        LineAdapter().parse(Sig, dup)
