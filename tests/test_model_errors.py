"""A failed model call names its cause to the reader, from either client the server calls Gemini through."""

import litellm
from google.genai import errors

from backend.util.model_errors import (KEY_REJECTED, RATE_LIMITED, SPENDING_CAP, UNAVAILABLE,
                                       model_error_message)

CAP = "Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend"


def _genai(code: int, message: str, status: str) -> errors.APIError:
    return errors.ClientError(code, {"error": {"code": code, "message": message, "status": status}}) if code < 500 \
        else errors.ServerError(code, {"error": {"code": code, "message": message, "status": status}})


def test_a_spending_cap_is_named_not_mistaken_for_a_rate_limit():
    assert model_error_message(_genai(429, CAP, "RESOURCE_EXHAUSTED")) == SPENDING_CAP
    # What the experts see: litellm's wrapper around the same answer.
    wrapped = litellm.RateLimitError(message=f'GeminiException - {{"error": {{"code": 429, "message": "{CAP}"}}}}',
                                     llm_provider="gemini", model="gemini-2.5-flash")
    assert model_error_message(wrapped) == SPENDING_CAP


def test_other_causes():
    assert model_error_message(_genai(429, "Quota exceeded for requests per minute", "RESOURCE_EXHAUSTED")) == RATE_LIMITED
    assert model_error_message(_genai(400, "API key not valid. Please pass a valid API key.", "INVALID_ARGUMENT")) == KEY_REJECTED
    assert model_error_message(_genai(403, "Permission denied", "PERMISSION_DENIED")) == KEY_REJECTED
    assert model_error_message(_genai(503, "The model is overloaded", "UNAVAILABLE")) == UNAVAILABLE


def test_an_unknown_cause_is_left_to_the_caller():
    assert model_error_message(ValueError("could not parse the answer")) is None
