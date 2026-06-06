"""ProofCompletionExpert — a self-contained expert package.

Importing this package self-registers everything via decorators (no central
config): the expert module and its metric.
"""

from __future__ import annotations

from . import outputs        # registers the graph_trajectory output kind
from . import signature      # ProofCompletionSig (uses outputs)
from . import metric         # @register_metric("proof_completion")
from . import module         # @register_expert("proof_completion")
from .domains import discover_domains

discover_domains()  # register the per-domain example generators

# Re-export the expert class so `from ...modules.proof_completion import ...` works.
from .module import ProofCompletionExpert  # noqa: E402

__all__ = ["ProofCompletionExpert"]
