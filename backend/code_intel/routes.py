"""HTTP router for code analysis: ``POST /api/code/analyze``.

The client sends a code file's language and source and gets back what the
analyzer for that language found. ``create_app`` mounts it with
``fastapp.include_router(build_code_router())``.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.code_intel.python_symbols import MAX_SOURCE_CHARS, analyze_python

_ANALYZERS = {"python": analyze_python}


class AnalyzeRequest(BaseModel):
    language: str
    source: str


def build_code_router() -> APIRouter:
    router = APIRouter()

    @router.post("/api/code/analyze")
    async def post_code_analyze(req: AnalyzeRequest):
        analyzer = _ANALYZERS.get(req.language)
        if analyzer is None:
            return JSONResponse({"error": f"no analyzer for {req.language!r}"}, status_code=400)
        if len(req.source) > MAX_SOURCE_CHARS:
            return JSONResponse({"error": "source too large to analyze"}, status_code=413)
        # Parsing is quick, but keep it off the event loop like the other analysis endpoints.
        return JSONResponse(await asyncio.to_thread(analyzer, req.source))

    return router
