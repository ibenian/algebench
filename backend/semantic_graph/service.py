"""SemanticGraphService — orchestrator for the LaTeX → semantic graph pipeline."""

from __future__ import annotations

from backend.model.semantic_graph import SemanticGraph

from .cache import GraphCache, _MISS
from .equation_chain import derive_equation_chain_graph
from .postprocessor import GraphPostprocessor
from .preprocessor import LaTeXPreprocessor
from .sympy_translator import latex_to_semantic_graph


class SemanticGraphService:
    """Orchestrator that wires cache, preprocessor, translator, and postprocessor."""

    def __init__(self) -> None:
        self._cache = GraphCache()
        self._preprocessor = LaTeXPreprocessor()
        self._postprocessor = GraphPostprocessor()

    def derive(self, latex: str, domain: str | None = None) -> SemanticGraph | None:
        """Parse *latex* and return a ``SemanticGraph``, or None on failure.

        Results are memoized by (latex, domain).
        """
        if not isinstance(latex, str) or not latex:
            return None

        cached = self._cache.get(latex, domain)
        if cached is not _MISS:
            return cached

        graph = derive_equation_chain_graph(latex)
        if graph is not None:
            if domain:
                graph.domain = domain
            self._cache.put(latex, domain, graph)
            return graph

        result = self._preprocessor.preprocess(latex)
        try:
            raw = latex_to_semantic_graph(result.cleaned_latex, domain=domain)
        except Exception:
            raw = None
        graph = self._postprocessor.postprocess(raw, result)

        self._cache.put(latex, domain, graph)
        return graph

    def clear_cache(self) -> None:
        """Drop all cached graphs."""
        self._cache.clear()
