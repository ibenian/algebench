"""Why a call to the model failed, in words a reader can act on.

A failed model call used to reach the reader as "Sorry, I encountered an error", whatever the cause. Most causes
are not worth retrying (a spending cap or a rejected key stays until the owner fixes it), so the reader is told
which one it was. Works on the google-genai errors (``code``, ``status``) and on litellm's (``status_code``), the
two clients the server and the experts call Gemini through; anything else falls back to None.
"""

SPENDING_CAP = ("The AI is unavailable: this server's Gemini project has reached its monthly spending cap. "
                "It comes back when the owner raises the cap (ai.studio/spend) or the month resets.")
RATE_LIMITED = "The AI is getting too many requests right now (Gemini rate limit). Wait a minute and try again."
KEY_REJECTED = "The AI is unavailable: Gemini rejected this server's API key. The owner needs to check it."
UNAVAILABLE = "The AI service is temporarily unavailable. Try again in a moment."


def _status(error: BaseException) -> int | None:
    for attr in ("code", "status_code"):
        value = getattr(error, attr, None)
        if isinstance(value, int):
            return value
    return None


def model_error_message(error: BaseException) -> str | None:
    """A reader-facing explanation of a failed model call, or None when the cause is not one we can name."""
    text = str(error)
    lower = text.lower()
    status = _status(error)
    if "spending cap" in lower or "spend cap" in lower:
        return SPENDING_CAP
    if status == 429 or "resource_exhausted" in lower or "ratelimiterror" in lower:
        return RATE_LIMITED
    if status in (401, 403) or "api key not valid" in lower or "permission_denied" in lower:
        return KEY_REJECTED
    if status in (500, 502, 503, 504) or "unavailable" in lower or "overloaded" in lower:
        return UNAVAILABLE
    return None
