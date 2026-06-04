"""Node-id helpers, shared by the translator and the postprocessor.

A node id is an internal wiring key, never a display string — display always
comes from ``latex`` / ``subexpr`` / ``label``. A clean id is a plain
identifier (letters, digits, underscores). These live in their own tiny module
so both ``sympy_translator`` and ``postprocessor`` can mint clean ids without a
cross-import of the heavy translator module.
"""

from __future__ import annotations

import re

# The invariant the rest of the pipeline relies on: every node id matches this.
_CLEAN_ID_RE = re.compile(r"^[A-Za-z0-9_]+$")


def _slug_id(raw: str) -> str:
    """Reduce a (possibly LaTeX-bearing) string to a clean ``[A-Za-z0-9_]``
    identifier suitable for a node id. LaTeX/display content lives in the
    node's ``latex`` / ``subexpr`` — the id only needs to be a stable,
    collision-free wiring key.

        ``V_{\\text{exit}}`` → ``V_exit``      ``\\gamma_{\\alpha}`` → ``gamma_alpha``
        ``I_{sp}``           → ``I_sp``        ``\\epsilon_{0}``     → ``epsilon_0``
        ``\\Delta \\gamma``  → ``Delta_gamma``
    """
    if _CLEAN_ID_RE.fullmatch(raw):
        return raw  # already clean (plain symbols, operator ids) — leave as-is
    s = re.sub(r"\\text\{([^{}]*)\}", r"\1", raw)   # \text{exit} → exit
    s = s.replace("\\", "")                          # \gamma → gamma
    s = s.replace("{", "").replace("}", "")          # _{E} → _E
    s = re.sub(r"[^A-Za-z0-9_]+", "_", s)            # any leftover → _
    s = re.sub(r"_+", "_", s).strip("_")             # tidy underscores
    return s or "sym"
