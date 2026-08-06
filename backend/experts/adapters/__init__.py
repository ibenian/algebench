"""DSPy adapters maintained here rather than upstream (for now).

``LineAdapter`` is written to be signature-agnostic and dependency-free so it can
be proposed to DSPy later; nothing in it knows about AlgeBench.
"""

from .line_adapter import LineAdapter, LineFormatError

__all__ = ["LineAdapter", "LineFormatError"]
