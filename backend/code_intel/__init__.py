"""Static analysis of the code files a lesson shows in its Code panel.

Lessons display source (``codeFiles``); they never execute it. This package reads
that source to tell the client what it contains, so the panel and the 3D view can
point at the same things. Each language gets its own analyzer module; the router
in :mod:`backend.code_intel.routes` picks one by language.

Today: Python, via the standard ``ast`` module — every variable and every
expression built on one (``temps[stack[-1]]``, ``node.next``), with exact spans.
New analyses (scopes, call graphs, other languages) belong here too.
"""

from backend.code_intel.python_symbols import analyze_python
from backend.code_intel.routes import build_code_router

__all__ = ["analyze_python", "build_code_router"]
