r"""prompt_endpoints re-asks on an unparseable response instead of failing (#517, #528).

``ChatAdapter``'s silent ``JSONAdapter`` fallback used to absorb a malformed
response for these four predictors. It is refused now (``llm_config.make_adapter``
builds every adapter with ``json_fallback=False``), because that path re-decoded
every field through JSON escaping — the only route by which a flat ``str`` LaTeX
field such as ``start_latex`` can be corrupted, since ``ChatAdapter`` otherwise
returns ``str`` verbatim.

Removing it without a replacement would turn a transient formatting slip into a
failed request: this module is the only DSPy caller with no exception handling of
its own. ``_ask`` re-asks ONCE in the SAME wire format — the resilience the
fallback actually provided, minus the escape layer.
"""

from __future__ import annotations

import pytest
from dspy.utils.exceptions import AdapterParseError

import backend.experts.handlers.proof_animation.prompt_endpoints as PE


class _Pred:
    """Stands in for a ``dspy.Predict``; fails the first ``n_fail`` calls."""

    def __init__(self, n_fail: int, result="ok"):
        self.n_fail, self.result, self.calls = n_fail, result, 0

    def __call__(self, **kwargs):
        self.calls += 1
        if self.calls <= self.n_fail:
            # A REAL signature: AdapterParseError formats its message from
            # ``signature.output_fields``, so a stub would fail in the ctor.
            raise AdapterParseError(adapter_name="ChatAdapter",
                                    signature=PE.BothEndpointsSig,
                                    lm_response="junk", message="unparseable")
        return self.result


@pytest.fixture
def patched(monkeypatch):
    """Swap ``_predictor`` for a stub, bypassing its ``@cache`` and any LM."""
    def install(pred):
        monkeypatch.setattr(PE, "_predictor", lambda sig: pred)
        return pred
    return install


def test_transient_parse_failure_is_retried(patched):
    """One bad response must not fail the request — re-ask and succeed."""
    pred = patched(_Pred(n_fail=1))
    assert PE._ask(PE.BothEndpointsSig, prompt="derive the quadratic formula") == "ok"
    assert pred.calls == 2, "expected exactly one re-ask"


def test_persistent_parse_failure_propagates(patched):
    """It must RAISE, never silently degrade.

    Anything still unparseable after the retry means we cannot read what the
    model named, so there is no derivation to run. The endpoint logs it and
    returns a generic error — honest, unlike the fallback's quiet success.
    """
    pred = patched(_Pred(n_fail=99))
    with pytest.raises(AdapterParseError):
        PE._ask(PE.BothEndpointsSig, prompt="derive the quadratic formula")
    assert pred.calls == PE._PARSE_ATTEMPTS, "must not retry forever"


def test_clean_response_costs_exactly_one_call(patched):
    """The happy path must not pay for the guard."""
    pred = patched(_Pred(n_fail=0))
    PE._ask(PE.BothEndpointsSig, prompt="derive the quadratic formula")
    assert pred.calls == 1


@pytest.mark.parametrize("sig", ["BothEndpointsSig", "StartGivenTargetSig",
                                 "TargetGivenStartSig", "ProofQuestionSig"])
def test_every_predictor_in_this_module_goes_through_ask(sig):
    """A new call site added straight onto ``_predictor`` would be unguarded.

    The whole point is that this module has no other exception handling, so a
    raw ``_predictor(...)(...)`` call is a hole. Assert the source routes all
    four through ``_ask``.
    """
    import inspect
    src = inspect.getsource(PE)
    assert f"_ask({sig}" in src, f"{sig} is not called through _ask"
    # `_ask` itself is the one legitimate `_predictor(...)` call; any other is a
    # call site that skipped the guard.
    assert src.count("_predictor(signature)(**kwargs)") == 1
    assert f"_predictor({sig})" not in src, \
        f"{sig} is invoked directly, bypassing the retry guard"
