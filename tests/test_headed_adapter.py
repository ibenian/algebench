"""A response that leaves out its first field's header is parsed with the header put back; others still fail."""
import dspy
import pytest
from dspy.utils.exceptions import AdapterParseError

from backend.experts.llm_config import make_adapter


class Sig(dspy.Signature):
    """Answer."""
    question: str = dspy.InputField()
    plan: str = dspy.OutputField()
    closing: str = dspy.OutputField()


def test_the_missing_first_header_is_restored():
    text = "I will do it.\n\n[[ ## closing ## ]]\nDone.\n\n[[ ## completed ## ]]"
    out = make_adapter(restore_first_header=True).parse(Sig, text)
    assert out == {"plan": "I will do it.", "closing": "Done."}
    with pytest.raises(AdapterParseError):
        make_adapter().parse(Sig, text)


def test_other_slips_still_raise():
    with pytest.raises(AdapterParseError):
        make_adapter(restore_first_header=True).parse(Sig, "[[ ## plan ## ]]\nI will do it.\n\n[[ ## completed ## ]]")
