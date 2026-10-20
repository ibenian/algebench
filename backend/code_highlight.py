"""Syntax colouring for the Code panel: Pygments tokens as column ranges per line.

``POST /api/code/highlight`` takes a code file's language and source and returns
``{"tokens": [{line, col, endCol, kind}], "error": str | None}``. Lines are
1-based; columns are 0-based UTF-16 offsets, the units JavaScript strings index
by, so the client can split a line's text at them directly (a character outside
the Basic Multilingual Plane counts as two). A token spanning lines (a
docstring) comes back once per line.

``kind`` is one of a few broad categories (keyword, string, comment, …) rather
than Pygments' full type tree, so a theme colours a handful of classes. Text
with no category (plain names, punctuation, whitespace) is left out: it keeps
the panel's default colour. The panel draws these ranges first and anything else
that marks code by column range (variable references, for example) layers on
top, splitting the coloured spans as it needs to.

Any language Pygments knows by name or alias is coloured; an unknown one gets
no tokens and an explanation, and the panel shows the source uncoloured.
"""

from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pygments.lexers import get_lexer_by_name
from pygments.token import Comment, Keyword, Name, Number, Operator, String
from pygments.util import ClassNotFound

MAX_SOURCE_CHARS = 200_000

# Most specific first: Keyword.Constant (True, None) before Keyword, Operator.Word (and, not) before Operator.
_CATEGORIES = (
    (Keyword.Constant, "constant"),
    (Keyword, "keyword"),
    (Operator.Word, "keyword"),
    (Name.Builtin, "builtin"),
    (Name.Function, "function"),
    (Name.Class, "class"),
    (Name.Decorator, "decorator"),
    (String, "string"),
    (Number, "number"),
    (Comment, "comment"),
    (Operator, "operator"),
)


def _kind(ttype) -> str | None:
    for parent, kind in _CATEGORIES:
        if ttype in parent:
            return kind
    return None


_ASTRAL = re.compile("[\U00010000-\U0010FFFF]")


def _utf16_columns(text: str) -> list[int] | None:
    """UTF-16 offset of every character boundary in ``text``, or None when they equal the character offsets
    (no character outside the Basic Multilingual Plane, the common case). Computed once per line, so
    converting each token's columns is a lookup, not a re-encode of the line so far."""
    if not _ASTRAL.search(text):
        return None
    out, at = [0], 0
    for ch in text:
        at += 2 if ord(ch) > 0xFFFF else 1
        out.append(at)
    return out


def highlight(language: str, source: str) -> dict:
    """``{"tokens": [...], "error": str | None}`` for ``source`` in ``language``.

    Not cached: a result can be large (one dict per token), so a server cache keyed by source would let
    varied requests pin a lot of memory. The panel caches each file's tokens in the browser instead.
    """
    if len(source) > MAX_SOURCE_CHARS:
        return {"tokens": [], "error": "source too large to highlight"}
    try:
        # No newline stripping or adding: token offsets must index the source exactly as the panel shows it.
        lexer = get_lexer_by_name(language, stripnl=False, stripall=False, ensurenl=False)
    except ClassNotFound:
        return {"tokens": [], "error": f"no highlighter for {language!r}"}
    lines = source.split("\n")
    starts, at = [], 0
    for text in lines:
        starts.append(at)
        at += len(text) + 1
    tokens = []
    columns: dict[int, list[int] | None] = {}   # per line, computed on its first token
    line = 0
    for index, ttype, value in lexer.get_tokens_unprocessed(source):
        kind = _kind(ttype)
        if kind is None or not value:
            continue
        # One range per line the token covers.
        end = index + len(value)
        while line + 1 < len(starts) and starts[line + 1] <= index:
            line += 1
        row, pos = line, index
        while pos < end and row < len(lines):
            line_start, line_end = starts[row], starts[row] + len(lines[row])
            stop = min(end, line_end)
            if stop > pos:
                if row not in columns:
                    columns[row] = _utf16_columns(lines[row])
                units = columns[row]
                a, b = pos - line_start, stop - line_start
                col, end_col = (a, b) if units is None else (units[a], units[b])
                last = tokens[-1] if tokens else None
                # Pygments splits some tokens (a string's quotes and body): touching pieces of a kind become one.
                if last and last["line"] == row + 1 and last["kind"] == kind and last["endCol"] == col:
                    last["endCol"] = end_col
                else:
                    tokens.append({"line": row + 1, "kind": kind, "col": col, "endCol": end_col})
            row += 1
            pos = starts[row] if row < len(starts) else end
    return {"tokens": tokens, "error": None}


class HighlightRequest(BaseModel):
    language: str
    source: str


def build_code_highlight_router() -> APIRouter:
    router = APIRouter()

    @router.post("/api/code/highlight")
    async def post_code_highlight(req: HighlightRequest):
        if len(req.source) > MAX_SOURCE_CHARS:
            return JSONResponse({"error": "source too large to highlight"}, status_code=413)
        # Lexing is quick, but keep it off the event loop like the other analysis endpoints.
        return JSONResponse(await asyncio.to_thread(highlight, req.language, req.source))

    return router
