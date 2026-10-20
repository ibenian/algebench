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
from functools import lru_cache

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


def _utf16(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


@lru_cache(maxsize=64)
def highlight(language: str, source: str) -> dict:
    """``{"tokens": [...], "error": str | None}`` for ``source`` in ``language``."""
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
                text = lines[row]
                col, end_col = _utf16(text[:pos - line_start]), _utf16(text[:stop - line_start])
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
