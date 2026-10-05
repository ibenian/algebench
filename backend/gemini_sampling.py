"""Sampling settings and output hygiene for Gemini calls.

Gemini 3 models are tuned for the default ``temperature`` of 1.0, and Google's
developer guide warns that lower values "may lead to unexpected behavior, such
as looping or degraded performance". A chat reply that loops does not stop by
itself: it runs to the output ceiling (one reply reached ~171k characters of a
self-extending list). So every chat call (a) leaves temperature at the model's
default on Gemini 3, (b) caps its output, and (c) trims a runaway tail from a
reply that hit that cap.

https://ai.google.dev/gemini-api/docs/generate-content/gemini-3
"""

from __future__ import annotations

import re

# Generous for a tutoring reply (a long worked answer is ~1-2k tokens), small
# enough that a degenerate loop costs seconds, not a minute of tokens.
CHAT_MAX_OUTPUT_TOKENS = 4096


def is_gemini3(model: str | None) -> bool:
    """True for a Gemini 3 model id, with or without a provider prefix."""
    name = (model or '').strip().lower()
    for prefix in ('gemini/', 'models/', 'google/', 'vertex_ai/'):
        if name.startswith(prefix):
            name = name[len(prefix):]
    return name.startswith('gemini-3')


def gemini_temperature(model: str | None, preferred: float) -> float | None:
    """The temperature to send: ``None`` (the model default, 1.0) on Gemini 3,
    whatever the caller preferred, otherwise."""
    return None if is_gemini3(model) else preferred


def hit_output_limit(finish_reason) -> bool:
    """Did generation stop because it ran out of output tokens?"""
    return str(finish_reason or '').upper().endswith('MAX_TOKENS')


_BREAK_LINE = re.compile(r'^\s*(<br\s*/?>)?\s*$', re.IGNORECASE)


def trim_runaway(text: str, hit_limit: bool, *, min_run: int = 25, max_line: int = 48) -> tuple[str, bool]:
    """Cut the degenerate tail off a reply that ran into the output limit.

    Only a reply that *hit the limit* is touched -- a complete reply is the
    model's own, however list-heavy. The loop this guards against is a list
    of short items that keeps extending itself, so the cut goes where the
    first run of ``min_run`` consecutive short lines starts (blank lines and
    stray ``<br>`` do not break or count toward a run). With no such run the
    reply is cut back to its last paragraph break and marked as truncated.

    Returns ``(text, trimmed)``.
    """
    if not hit_limit or not text:
        return text, False
    lines = text.split('\n')
    run_start, run_len = None, 0
    for k, line in enumerate(lines):
        if _BREAK_LINE.match(line):
            continue
        if len(line.strip()) <= max_line:
            if run_len == 0:
                run_start = k
            run_len += 1
            if run_len >= min_run:
                head = lines[:run_start]
                # A heading or <br> introducing the runaway list goes with it.
                while head and (_BREAK_LINE.match(head[-1]) or head[-1].lstrip().startswith('#')):
                    head.pop()
                return '\n'.join(head).rstrip(), True
        else:
            run_len = 0
    cut = text.rfind('\n\n')
    body = text[:cut] if cut > 0 else text
    return body.rstrip() + '\n\n…', True
