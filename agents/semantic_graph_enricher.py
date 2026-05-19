"""Re-export shim — canonical source is ``backend.agents.semantic_graph_enricher``."""

import backend.agents.semantic_graph_enricher as _src
from backend.agents.semantic_graph_enricher import *  # noqa: F401, F403

# Star-import excludes underscore-prefixed names. Re-export them explicitly
# so tests that import private helpers (e.g. _build_payload) still work.
import sys as _sys
_this = _sys.modules[__name__]
for _name in dir(_src):
    if not hasattr(_this, _name):
        setattr(_this, _name, getattr(_src, _name))
del _sys, _this, _name
