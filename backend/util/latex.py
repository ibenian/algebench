"""Inline-LaTeX delimiter scanning over prose/markdown captions.

Reusable and dependency-free (stdlib only). Captions across AlgeBench mix prose
with inline math wrapped in ``$…$`` and display math in ``$$…$$`` — the chat
panel, the proof-animation caption renderer (``static/proof-animation``), and the
proof-completion expert all need to answer the same low-level questions:

* **where** is the math in a caption (to render only those segments as KaTeX), and
* **are the delimiters balanced** (an unclosed ``$`` leaks raw LaTeX into prose).

This module is the single source of truth for both. It is deliberately *not*
inside the proof-completion expert — well-formedness of ``$…$`` is a generic
string property useful anywhere a caption is produced or consumed.

The scanner honours backslash escapes (``\\$`` is a literal dollar, ``\\{`` a
literal brace) and treats a maximal run of two dollars as a display delimiter
(``$$…$$``) and a single dollar as inline (``$…$``). A run of three or more
dollars, or a delimiter that is opened but never closed, is *unbalanced*.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple


@dataclass(frozen=True)
class MathSegment:
    """One delimited math span found in a caption.

    ``content`` is the text *between* the delimiters (delimiters excluded);
    ``start``/``end`` are offsets into the original string spanning the whole
    segment *including* its delimiters, so ``text[start:end]`` round-trips.
    """

    display: bool          # True for $$…$$, False for $…$
    content: str           # text between the delimiters
    start: int             # offset of the opening delimiter
    end: int               # offset just past the closing delimiter

    @property
    def delimiter(self) -> str:
        return "$$" if self.display else "$"


def _scan(text: str) -> Tuple[List[MathSegment], bool]:
    """Scan ``text`` once: return ``(complete_segments, balanced)``.

    ``balanced`` is False if any ``$``/``$$`` delimiter is opened and never
    closed (the unbalanced-dollar bug), or if a run of three or more dollars is
    encountered (never a valid delimiter). Escaped ``\\$`` is not a delimiter.
    """
    segments: List[MathSegment] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "\\":               # escape — skip the escaped char wholesale
            i += 2
            continue
        if c != "$":
            i += 1
            continue
        # how many dollars in this run?
        run = 1
        while i + run < n and text[i + run] == "$":
            run += 1
        if run >= 3:                # $$$… is never a valid delimiter
            return segments, False
        display = run == 2
        open_start = i
        j = i + run                 # content begins after the opening delimiter
        content_start = j
        closed = False
        while j < n:
            if text[j] == "\\":
                j += 2
                continue
            if text[j] == "$":
                close_run = 1
                while j + close_run < n and text[j + close_run] == "$":
                    close_run += 1
                want = 2 if display else 1
                if close_run >= want:
                    seg = MathSegment(display, text[content_start:j],
                                      open_start, j + want)
                    segments.append(seg)
                    i = j + want
                    closed = True
                    break
                # a lone $ inside a $$…$$ block — treat as content, keep scanning
                j += close_run
                continue
            j += 1
        if not closed:              # opened a delimiter that never closes
            return segments, False
    return segments, True


def math_segments(text: str) -> List[MathSegment]:
    """All complete ``$…$`` / ``$$…$$`` segments, in order of appearance.

    Stops at the first unbalanced delimiter (returns what was parsed so far);
    use :func:`delimiters_balanced` to test for that case.
    """
    return _scan(text or "")[0]


def delimiters_balanced(text: str) -> bool:
    """True iff every ``$`` / ``$$`` math delimiter in ``text`` is closed.

    This is the core well-formedness check for the unbalanced-``$`` defect: a
    caption like ``and $V = 7.8 \\text{ km/s}`` (no closing ``$``) returns False.
    Prose dollars that are escaped (``\\$5``) do not count as delimiters.
    """
    return _scan(text or "")[1]


def braces_balanced(text: str) -> bool:
    """True iff ``{`` / ``}`` are balanced (ignoring escaped ``\\{`` / ``\\}``).

    A useful companion check for inline LaTeX: ``\\frac{a}{b`` (missing ``}``)
    will not render. Operates on the raw string; callers usually run it on a
    segment's ``content``.
    """
    depth = 0
    i, n = 0, len(text or "")
    while i < n:
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth < 0:
                return False
        i += 1
    return depth == 0


def strip_math_delimiters(text: str) -> str:
    """Return ``text`` with the ``$``/``$$`` delimiters removed, content kept.

    Only well-formed segments are unwrapped; an unbalanced tail is left as-is.
    Handy for plain-text fallbacks (e.g. a TTS summary that should read the math
    content without the dollar signs).
    """
    segs = math_segments(text)
    if not segs:
        return text or ""
    out: List[str] = []
    cursor = 0
    for seg in segs:
        out.append(text[cursor:seg.start])
        out.append(seg.content)
        cursor = seg.end
    out.append(text[cursor:])
    return "".join(out)
