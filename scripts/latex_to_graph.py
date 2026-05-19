#!/usr/bin/env python3
"""Convert LaTeX expressions into semantic graphs (JSON).

Thin CLI wrapper — all domain logic lives in ``backend.semantic_graph``.

Usage:
    # Parse a single expression
    ./run.sh scripts/latex_to_graph.py "F = m \\cdot a"

    # Pretty-print output
    ./run.sh scripts/latex_to_graph.py --pretty "E = mc^2"

    # Override variable properties (any property: label, emoji, type, unit, tooltip, ai_prompt, latex)
    ./run.sh scripts/latex_to_graph.py --pretty \\
        --var 'm:unit=kg,tooltip=Inertial mass of the object' \\
        --var 'a:unit=m/s²,ai_prompt=Explain acceleration in Newtonian mechanics' \\
        "F = m \\cdot a"

    # Write output to file
    ./run.sh scripts/latex_to_graph.py -o graph.json "\\frac{d}{dt}(mv) = F"

Exit codes:
    0  Success
    1  Parse error or invalid input
"""

from __future__ import annotations

import argparse
import json
import sys

# ---------------------------------------------------------------------------
# Re-exports from backend.semantic_graph — keeps existing callers working
# until imports are migrated (step 14).
# ---------------------------------------------------------------------------
from backend.semantic_graph.sympy_translator import (  # noqa: F401
    latex_to_semantic_graph,
    parse_var_overrides,
    operator_kind,
    node_short_label,
    node_long_label,
    SemanticGraphBuilder,
    _preprocess_latex,
    _split_on_top_level_comma,
    _extract_parenthetical_annotations,
    _inject_annotations,
    _collapse_braket_notation,
    _collapse_compound_symbols,
    _collapse_text_commands,
    _normalize_latex,
    _classify_expression,
    _split_on_statement_separators,
    _split_on_relation,
    _split_chained_equals,
    _build_relation_graph,
    _build_comma_separated_graph,
    _is_bare_variable,
    _rejoin_subject_group_commas,
)
from backend.semantic_graph.constants import (  # noqa: F401
    DIMENSIONS,
    DIMENSION_PATTERN,
    RELATION_MAP,
)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert LaTeX expressions to semantic graphs (JSON).",
    )
    parser.add_argument("latex", help="LaTeX expression to parse")
    parser.add_argument("--pretty", action="store_true",
                        help="Pretty-print the JSON output")
    parser.add_argument("-o", "--output", type=str, default=None,
                        help="Write JSON to a file instead of stdout")
    parser.add_argument("--domain", type=str, default=None,
                        help="Domain of the expression (e.g. 'thermodynamics', 'linear_algebra')")
    parser.add_argument("--var", action="append", dest="vars", metavar="NAME:KEY=VAL,...",
                        help="Override variable properties. "
                             "Example: --var 'm:unit=kg,tooltip=Inertial mass' "
                             "--var 'a:unit=m/s²,ai_prompt=Explain acceleration'")
    args = parser.parse_args()

    try:
        overrides = parse_var_overrides(args.vars)
        graph = latex_to_semantic_graph(args.latex, overrides=overrides, domain=args.domain)
    except ValueError as exc:
        print(f"❌ {exc}", file=sys.stderr)
        sys.exit(1)

    indent = 2 if args.pretty else None
    result = json.dumps(graph, indent=indent, ensure_ascii=False)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result + "\n")
        print(f"✅ Graph written to {args.output}")
    else:
        print(result)


if __name__ == "__main__":
    main()
