"""Gemini 3 sampling defaults and the runaway-reply guard."""
from backend.gemini_sampling import gemini_temperature, hit_output_limit, is_gemini3, trim_runaway


def test_gemini3_uses_the_default_temperature():
    for model in ('gemini-3-flash-preview', 'gemini/gemini-3-pro', 'models/gemini-3.1-flash'):
        assert is_gemini3(model)
        assert gemini_temperature(model, 0.7) is None
    for model in ('gemini-2.5-flash', 'gemini/gemini-2.5-pro', 'openai/gpt-4o', '', None):
        assert not is_gemini3(model)
        assert gemini_temperature(model, 0.7) == 0.7


def test_finish_reason_parsing():
    assert hit_output_limit('MAX_TOKENS')
    assert hit_output_limit('FinishReason.MAX_TOKENS')
    assert not hit_output_limit('FinishReason.STOP')
    assert not hit_output_limit(None)


ANSWER = ("In this scene, yes, they are hand-picked (Action, Romance, Sci-fi) to make the math easy to follow.\n\n"
          "Would you like to skip ahead to Scene 6 to see what the learned versions look like compared to these?")


def test_runaway_list_is_cut_where_it_starts():
    runaway = ANSWER + '\n\n<br>\n\nShortcuts\n\n' + '\n\n'.join(f'"Term {k}"' for k in range(400))
    out, trimmed = trim_runaway(runaway, hit_limit=True)
    assert trimmed
    assert out == ANSWER


def test_complete_replies_are_never_touched():
    listy = ANSWER + '\n\n' + '\n'.join(f'- item {k}' for k in range(60))
    assert trim_runaway(listy, hit_limit=False) == (listy, False)


def test_truncated_prose_is_cut_back_to_a_paragraph():
    prose = ANSWER + '\n\nAnd then a long sentence that was cut off mid-way because the model ran out of tok'
    out, trimmed = trim_runaway(prose, hit_limit=True)
    assert trimmed and out == ANSWER + '\n\n…'


def test_short_legit_list_survives_a_limit_hit():
    text = ANSWER + '\n\n' + '\n'.join(f'- step {k}' for k in range(8)) + '\n\nA final long paragraph that got cut off by the output cap in the mid'
    out, trimmed = trim_runaway(text, hit_limit=True)
    assert trimmed and '- step 7' in out and not out.endswith('mid')
