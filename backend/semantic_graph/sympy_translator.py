"""SymPy-based LaTeX-to-semantic-graph translator.

Absorbs the core of ``scripts/latex_to_graph.py``: SymPy parsing,
expression walking, graph node/edge building, domain labelling,
and statement splitting.
"""

from __future__ import annotations

import re
from typing import Any

import sympy
from sympy import (
    Symbol, Function, Number, Rational, Integer, Float,
    Add, Mul, Pow, Eq, Abs,
    StrictGreaterThan, StrictLessThan, GreaterThan, LessThan,
    sin, cos, tan, log, exp, sqrt, factorial,
    Derivative, Integral, Limit, Sum, Product,
    pi, E, I, oo,
    S,
)
from sympy.parsing.latex import parse_latex
from sympy.physics.quantum.state import KetBase, BraBase
from sympy.physics.quantum import InnerProduct, OuterProduct

from backend.model.semantic_graph import SemanticGraph

from .id_utils import _slug_id
from .preprocessor import LaTeXPreprocessor
from .constants import (
    KNOWN_VARIABLES,
    OPERATOR_MAP,
    CONSTANT_MAP,
    RELATION_MAP,
    _ASYMMETRIC_OPS,
    _SYMMETRIC_OPS,
    _META_RELATION_OPS,
    _PLACEHOLDER_NAME_RE,
    _STYLE_SYMBOL_COMMAND_RE,
    _SIMPLE_STYLED_SYMBOL_RE,
    _OPERATOR_GLYPHS,
    _SUPERSCRIPT_MAP,
    _OP_KINDS,
    _OPERATOR_KINDS,
)


# ---------------------------------------------------------------------------
# Module-level compiled regexes
# ---------------------------------------------------------------------------

_QUAD_COMMA_RE = re.compile(r",\s*\\(?:quad|qquad)\b")
_LEADING_SPACE_CMD_RE = re.compile(r"^\s*(?:\\(?:quad|qquad|,|;|!|:)\s*)+")


# ---------------------------------------------------------------------------
# Relation-kind predicates
# ---------------------------------------------------------------------------

def is_asymmetric_relation(op: str) -> bool:
    """True for directional relations that need lhs/rhs edge roles."""
    return op in _ASYMMETRIC_OPS


def is_symmetric_relation(op: str) -> bool:
    """True for relations that can be flattened into an n-ary node."""
    return op in _SYMMETRIC_OPS


def is_meta_relation(op: str) -> bool:
    """True for logical connectives (implies, iff) that use type='operator'."""
    return op in _META_RELATION_OPS


def is_relation(op: str) -> bool:
    """True if this op uses type='relation' in the graph.

    Meta-relations (implies, iff) are asymmetric but use type='operator',
    so they are excluded here.
    """
    return (is_asymmetric_relation(op) or is_symmetric_relation(op)) and not is_meta_relation(op)


# ---------------------------------------------------------------------------
# Public utility functions (used by renderers, TTS, AI enrichment)
# ---------------------------------------------------------------------------

def operator_kind(node: dict) -> str | None:
    """Return the operator-kind tag for a node, or ``None`` for non-ops."""
    if node.get("type") not in _OP_KINDS:
        return None
    op = node.get("op")
    if op and op in _OPERATOR_KINDS:
        return _OPERATOR_KINDS[op]
    return "function" if node.get("type") == "function" else "arithmetic"


def _to_superscript(s: str) -> str:
    return "".join(_SUPERSCRIPT_MAP.get(c, c) for c in str(s))


def _operator_glyph(node: dict) -> str | None:
    """Synthesize the compact glyph for an operator node from its ``op``."""
    op = node.get("op")
    if not op:
        return None
    if op == "power":
        exp = node.get("exponent")
        if exp is not None and str(exp) == "-1":
            return "1/(·)"
        return f"(·){_to_superscript(exp)}" if exp else "(·)˙"
    if op in ("derivative", "partial_derivative"):
        d = "∂" if op == "partial_derivative" else "d"
        wrt = node.get("with_respect_to")
        return f"{d}·/{d}{wrt}" if wrt else f"{d}·/{d}·"
    return _OPERATOR_GLYPHS.get(op)


def node_short_label(node: dict) -> str:
    """Return the SHORT label — compact symbol for the graph node.

    A node id is an internal wiring key, never a display string, so it is
    never used here — display comes from ``latex`` / ``subexpr`` / ``label``
    (and ``op`` / a glyph for operators). Falls back to ``?`` only when a node
    genuinely carries nothing displayable.
    """
    if node.get("type") in _OP_KINDS:
        if node.get("latex"):
            return node["latex"]
        glyph = _operator_glyph(node)
        if glyph:
            return glyph
        return node.get("op") or node.get("subexpr") or "?"
    return node.get("latex") or node.get("subexpr") or node.get("label") or "?"


def node_long_label(node: dict) -> str:
    """Return the LONG label — full applied form for the details panel."""
    return node.get("subexpr") or node.get("latex") or node_short_label(node)


def parse_var_overrides(var_specs: list[str] | None) -> dict[str, dict[str, str]]:
    """Parse ``--var`` CLI arguments into ``{symbol_name: {prop: value}}``."""
    overrides: dict[str, dict[str, str]] = {}
    if not var_specs:
        return overrides
    for spec in var_specs:
        if ":" not in spec:
            raise ValueError(f"Invalid --var format (expected name:key=val,...): {spec!r}")
        name, rest = spec.split(":", 1)
        props: dict[str, str] = {}
        for pair in rest.split(","):
            if "=" not in pair:
                raise ValueError(f"Invalid property (expected key=value): {pair!r} in --var {spec!r}")
            k, v = pair.split("=", 1)
            props[k.strip()] = v.strip()
        overrides[name.strip()] = props
    return overrides


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_inverse_pow(expr: sympy.Basic) -> bool:
    if not isinstance(expr, Pow):
        return False
    exp = expr.args[1]
    if isinstance(exp, Number) and exp < 0:
        return True
    if isinstance(exp, Mul) and exp.args and exp.args[0] == sympy.S.NegativeOne:
        return True
    return False


def _is_braket_constant_side(content: str) -> bool:
    s = content.strip()
    if not s:
        return False
    try:
        float(s)
        return True
    except ValueError:
        return False


def _braket_skeleton_latex(bra_content: str, ket_content: str) -> str:
    r"""Build a compact braket label where symbolic slots show ``\cdot``."""
    bra_disp = bra_content if _is_braket_constant_side(bra_content) else r"\cdot"
    ket_disp = ket_content if _is_braket_constant_side(ket_content) else r"\cdot"
    return rf"\langle {bra_disp}\,|\,{ket_disp}\rangle"


# ---------------------------------------------------------------------------
# LaTeX preprocessing (before SymPy parsing)
# ---------------------------------------------------------------------------

def _extract_latex_commands(latex: str) -> dict[str, str]:
    r"""Scan raw LaTeX for ``\command`` tokens and return {name: \name}."""
    commands = {m.group(1): m.group(0) for m in re.finditer(r"\\([a-zA-Z]+)", latex)}
    for m in _STYLE_SYMBOL_COMMAND_RE.finditer(latex):
        body = m.group("body").strip()
        if not _SIMPLE_STYLED_SYMBOL_RE.fullmatch(body):
            continue
        sym_name = body[1:] if body.startswith("\\") else body
        commands[sym_name] = m.group(0)
    return commands


def _strip_symbol_font_commands(latex: str) -> str:
    r"""Unwrap symbol-only style commands before SymPy parsing."""
    def _repl(m: re.Match) -> str:
        body = m.group("body").strip()
        if not _SIMPLE_STYLED_SYMBOL_RE.fullmatch(body):
            return m.group(0)
        return "{" + body + "}"
    return _STYLE_SYMBOL_COMMAND_RE.sub(_repl, latex)


def _normalize_latex(latex: str) -> str:
    r"""Normalize LaTeX constructs alien to SymPy's ``parse_latex``."""
    _html_cmd = re.compile(r"\\html[A-Za-z]+")
    parts: list[str] = []
    i = 0
    while i < len(latex):
        m = _html_cmd.match(latex, i)
        if m:
            j = m.end()
            if j < len(latex) and latex[j] == "{":
                depth = 1
                j += 1
                while j < len(latex) and depth > 0:
                    if latex[j] == "{": depth += 1
                    elif latex[j] == "}": depth -= 1
                    j += 1
            if j < len(latex) and latex[j] == "{":
                depth = 1
                j += 1
                start = j
                while j < len(latex) and depth > 0:
                    if latex[j] == "{": depth += 1
                    elif latex[j] == "}": depth -= 1
                    j += 1
                parts.append(latex[start:j - 1])
            i = j
        else:
            parts.append(latex[i])
            i += 1
    latex = "".join(parts)
    latex = re.sub(r"\\[lr]vert\b", "|", latex)
    latex = re.sub(r"\\vert\b", "|", latex)
    return latex


def _normalize_mid_tokens(s: str) -> str:
    r"""Replace each ``\mid`` command (and the whitespace around it) with a
    bare ``|``, in a single linear pass.

    Equivalent to ``re.sub(r"\s*\\mid\b\s*", "|", s)`` but without a regex.
    The ``\s*\\mid\s*`` form is a polynomial-ReDoS shape (CWE-1333): static
    scanners flag it even when a lookbehind makes it linear at runtime, and the
    naive version really is O(n^2) on attacker-supplied whitespace. A direct
    scan is unambiguously linear and carries no backtracking surface.
    """
    token = "\\mid"
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        j = s.find(token, i)
        if j < 0:
            out.append(s[i:])
            break
        end = j + len(token)
        # Honor the trailing ``\b``: ``\mid`` must not be glued to a word char
        # (e.g. ``\midpoint`` is not a match).
        if end < n and (s[end].isalnum() or s[end] == "_"):
            out.append(s[i:end])
            i = end
            continue
        out.append(s[i:j].rstrip())   # drop whitespace immediately before token
        out.append("|")
        i = end
        while i < n and s[i].isspace():  # drop whitespace immediately after token
            i += 1
    return "".join(out)


def _rewrite_conditional_bar(latex: str) -> tuple[str, set[str]]:
    r"""Rewrite ``P(A|B)`` → ``P(A, B)`` so SymPy sees a two-arg function.

    SymPy's ``parse_latex`` treats ``|`` as absolute-value delimiters,
    which causes ``P(A|B)`` to collapse.  This pass detects bare ``|``
    or ``\mid`` inside function-call parentheses and rewrites them as
    commas.

    Only single unpaired ``|`` is rewritten — paired ``|…|`` (absolute
    value) is left untouched.  Example:

    * ``P(A|B)``          → ``P(A, B)``         ← conditional bar
    * ``P(|X| \geq a)``   → unchanged           ← absolute value
    * ``P(A \mid B)``     → ``P(A, B)``         ← \mid form

    Returns:
        A tuple ``(rewritten_latex, conditional_bar_funcs)`` where
        *conditional_bar_funcs* is the set of function names (e.g.
        ``{"P"}``) that had a conditional bar rewritten.  The graph
        builder uses this to tag the condition-argument edge with
        ``role="condition"`` so the renderer can reconstruct ``P(·|·)``.
    """
    if "|" not in latex and r"\mid" not in latex:
        return latex, set()

    out: list[str] = []
    conditional_bar_funcs: set[str] = set()
    i = 0
    n = len(latex)
    while i < n:
        # Look for '(' preceded by an identifier — a function call.
        if latex[i] == "(":
            j = i - 1
            while j >= 0 and latex[j] in " \t":
                j -= 1
            is_func_call = j >= 0 and (latex[j].isalpha() or latex[j] == "}")

            if is_func_call:
                # Extract the function name preceding the '('.
                name_end = j + 1
                name_start = j
                while name_start > 0 and (latex[name_start - 1].isalpha()
                                          or latex[name_start - 1] == "_"):
                    name_start -= 1
                func_name = latex[name_start:name_end].strip()

                # Scan the parenthesized body to find matching ')'.
                depth = 1
                body_start = i + 1
                k = body_start
                while k < n and depth > 0:
                    if latex[k] == "(":
                        depth += 1
                    elif latex[k] == ")":
                        depth -= 1
                    k += 1
                body_end = k - 1  # index of matching ')'
                body = latex[body_start:body_end]

                # Normalize \mid → | ONLY within this function body.
                # Uses a linear, regex-free scan (see _normalize_mid_tokens) —
                # the equivalent \s*\\mid\s* regex is a polynomial ReDoS shape.
                body = _normalize_mid_tokens(body)

                # Count bare pipes in body (not inside nested parens).
                # Detect: is there exactly one unpaired |?
                pipe_positions = _find_unpaired_pipes(body)
                if len(pipe_positions) == 1:
                    # Single unpaired pipe → conditional bar → rewrite to comma.
                    pp = pipe_positions[0]
                    body = body[:pp] + ", " + body[pp + 1:]
                    conditional_bar_funcs.add(func_name)

                out.append("(")
                out.append(body)
                out.append(")")
                i = body_end + 1
                continue

        out.append(latex[i])
        i += 1

    return "".join(out), conditional_bar_funcs


# Assertion operators that can appear inside function-call parens.
# Ordered longest-first so greedy matching picks e.g. ``\geq`` before ``>``.
_ASSERTION_OPS: list[str] = [
    r"\notin", r"\geq", r"\leq", r"\neq",
    r"\ge", r"\le", r"\ne",
    r"\gt", r"\lt", r"\in",
    "=", ">", "<",
]

# Map assertion LaTeX operators → graph relation op names + emoji.
_ASSERTION_OP_META: dict[str, dict[str, str]] = {
    "=":       {"op": "equals",        "emoji": "="},
    r"\geq":   {"op": "greater_equal", "emoji": "≥"},
    r"\ge":    {"op": "greater_equal", "emoji": "≥"},
    r"\leq":   {"op": "less_equal",    "emoji": "≤"},
    r"\le":    {"op": "less_equal",    "emoji": "≤"},
    r"\gt":    {"op": "greater_than",  "emoji": ">"},
    ">":       {"op": "greater_than",  "emoji": ">"},
    r"\lt":    {"op": "less_than",     "emoji": "<"},
    "<":       {"op": "less_than",     "emoji": "<"},
    r"\neq":   {"op": "not_equal",     "emoji": "≠"},
    r"\ne":    {"op": "not_equal",     "emoji": "≠"},
    r"\in":    {"op": "element_of",    "emoji": "∈"},
    r"\notin": {"op": "not_element_of","emoji": "∉"},
}


def _rewrite_assertion_ops(latex: str) -> tuple[str, dict[str, list[str]]]:
    r"""Rewrite assertion operators inside function-call parens to ``,``.

    Probability expressions like ``P(X = k)`` or ``P(|X-\mu| \geq k)``
    contain an assertion (relation) inside the function arguments.
    SymPy's ``parse_latex`` cannot handle relation operators inside
    function calls — it silently collapses the expression.  This
    preprocessor rewrites the operator to ``,`` so SymPy sees
    ``P(X, k)``, and records which function names had an assertion
    and what operator(s) were used so the subexpr restorer can show
    the original operator(s) again.

    Both single-operator assertions (``P(X = k)``) and chained
    inequalities (``P(1 < X \leq 10)``) are supported.

    Returns
    -------
    tuple[str, dict[str, list[str]]]
        ``(rewritten_latex, assertion_funcs)`` where
        *assertion_funcs* maps function names to a list of the
        original LaTeX operator strings (e.g. ``{"P": ["\\geq"]}``
        for single-op, ``{"P": ["<", "\\leq"]}`` for chained).
    """
    # Quick bail-out: nothing to do if no operator could be present.
    if not any(op in latex for op in _ASSERTION_OPS):
        return latex, {}

    out: list[str] = []
    assertion_funcs: dict[str, list[str]] = {}
    i = 0
    n = len(latex)
    while i < n:
        if latex[i] == "(":
            j = i - 1
            while j >= 0 and latex[j] in " \t":
                j -= 1
            is_func_call = j >= 0 and (latex[j].isalpha() or latex[j] == "}")

            if is_func_call:
                name_end = j + 1
                name_start = j
                while name_start > 0 and (latex[name_start - 1].isalpha()
                                          or latex[name_start - 1] == "_"):
                    name_start -= 1
                func_name = latex[name_start:name_end].strip()

                # Scan the parenthesized body to find matching ')'.
                depth = 1
                body_start = i + 1
                k = body_start
                while k < n and depth > 0:
                    if latex[k] == "(":
                        depth += 1
                    elif latex[k] == ")":
                        depth -= 1
                    k += 1
                body_end = k - 1
                body = latex[body_start:body_end]

                # Find assertion operators at depth 0 within the body.
                op_hits: list[tuple[int, int, str]] = []  # (start, end, op)
                d = 0
                bi = 0
                blen = len(body)
                while bi < blen:
                    c = body[bi]
                    if c in "({":
                        d += 1
                        bi += 1
                    elif c in ")}":
                        d -= 1
                        bi += 1
                    elif d == 0:
                        matched = False
                        for op in _ASSERTION_OPS:
                            end = bi + len(op)
                            if body[bi:end] == op:
                                # For LaTeX commands (\geq, \ne, …) the
                                # next char must NOT be alphabetic, else
                                # we'd match \ne inside \neg.
                                if op.startswith("\\") and end < blen \
                                        and body[end].isalpha():
                                    continue
                                op_hits.append((bi, end, op))
                                bi = end
                                matched = True
                                break
                        if not matched:
                            bi += 1
                    else:
                        bi += 1

                if len(op_hits) >= 1:
                    # Replace operators with commas right-to-left so
                    # earlier indices remain valid.
                    for start_op, end_op, _orig_op in reversed(op_hits):
                        # Consume optional whitespace around the operator.
                        before = start_op
                        while before > 0 and body[before - 1] == " ":
                            before -= 1
                        after = end_op
                        while after < len(body) and body[after] == " ":
                            after += 1
                        body = body[:before] + ", " + body[after:]
                    assertion_funcs[func_name] = [h[2] for h in op_hits]

                out.append("(")
                out.append(body)
                out.append(")")
                i = body_end + 1
                continue

        out.append(latex[i])
        i += 1

    return "".join(out), assertion_funcs


# ---------------------------------------------------------------------------
# Prefix operator rewriter  (\neg, \forall, \exists)
# ---------------------------------------------------------------------------
# ``\neg X``, ``\forall x``, ``\exists x`` without parentheses are parsed
# by SymPy as implicit multiplication (``neg * X``) instead of function
# calls (``neg(X)``).  We rewrite ``\CMD TOKEN`` → ``\CMD(TOKEN)`` where
# TOKEN is a single variable, a braced group, or a LaTeX command with
# its argument.

_PREFIX_OPS = [r"\neg", r"\forall", r"\exists"]

# Build one compiled regex per prefix command.
_PREFIX_OP_RES: list[tuple[str, re.Pattern[str]]] = []
for _cmd in _PREFIX_OPS:
    _escaped = re.escape(_cmd)
    _PREFIX_OP_RES.append((_cmd, re.compile(
        _escaped + r"\s+"                        # \cmd + mandatory whitespace
        r"(?!"                                    # NOT followed by…
        r"\(|\\left\s*\(|\\left\s*\[|\\left\s*\{"  # already-parenthesized
        r")"
        r"("                                      # capture the operand
        r"\\[a-zA-Z]+\{[^{}]*\}"                 # \cmd{...}
        r"|\\[a-zA-Z]+"                          # bare \command
        r"|[A-Za-z]"                             # single letter variable
        r"|\{[^{}]*\}"                           # braced group {…}
        r")"
    )))


def _rewrite_prefix_ops(latex: str) -> str:
    r"""Rewrite ``\neg X`` → ``\neg(X)`` (and ``\forall``, ``\exists``).

    Ensures SymPy parses prefix operators as function calls rather than
    implicit multiplication.

    Only rewrites when the operand is **not** already parenthesized.
    Handles: ``\neg P``, ``\forall x``, ``\exists x``.
    Skips:   ``\neg (P \land Q)``, ``\forall\left(…\right)``.
    """
    for cmd, pattern in _PREFIX_OP_RES:
        if cmd not in latex:
            continue
        escaped = re.escape(cmd)
        latex = pattern.sub(escaped + r"(\1)", latex)
    return latex


# ---------------------------------------------------------------------------
# Infix set / logic operator rewriter
# ---------------------------------------------------------------------------
# LaTeX infix operators that SymPy can't parse (e.g. ``\cap``, ``\cup``,
# ``\land``, ``\lor``).  We rewrite them to ``\Xi_{N}(LHS, RHS)``
# placeholder function calls — SymPy parses ``\Xi_{N}`` as a callable
# symbol, which the walker then converts to the proper operator node.
#
# Precedence groups are processed tightest-first so inner operators
# become function calls before outer operators are scanned.  Within
# each group operators associate left-to-right:
#   ``A \cap B \cap C`` → ``\Xi_{N}(\Xi_{M}(A, B), C)``

# Each entry: (latex_cmd, graph_op, emoji, node_type, original_latex)
_INFIX_OP_CATALOG: list[tuple[str, str, str, str]] = [
    # --- Precedence 0 (tightest): function composition ---
    # SymPy has no ``Compose`` for arbitrary symbols, so ``f \circ g``
    # would otherwise parse as ``f · circ · g`` (a stray ``circ`` symbol
    # multiplied in).  Rewriting it as an infix call gives a proper
    # ``compose`` operator node with two operands (issue #443).
    (r"\circ",     "compose",        "∘", "operator"),
    # --- Precedence 1: intersection / conjunction ---
    (r"\cap",      "intersection",   "∩", "operator"),
    (r"\land",     "conjunction",    "∧", "operator"),
    (r"\wedge",    "conjunction",    "∧", "operator"),
    # --- Precedence 2: union / disjunction / set difference ---
    (r"\cup",      "union",          "∪", "operator"),
    (r"\lor",      "disjunction",    "∨", "operator"),
    (r"\vee",      "disjunction",    "∨", "operator"),
    (r"\setminus", "set_difference", "∖", "operator"),
]

# Ordered precedence groups (tightest first).
# Each group is a list of LaTeX commands at that precedence level.
_INFIX_PRECEDENCE: list[list[str]] = [
    [r"\circ"],
    [r"\cap", r"\land", r"\wedge"],
    [r"\cup", r"\lor", r"\vee", r"\setminus"],
]

# Quick lookup from LaTeX command → metadata.
_INFIX_OP_BY_CMD: dict[str, dict[str, str]] = {
    entry[0]: {"op": entry[1], "emoji": entry[2], "type": entry[3],
               "latex_cmd": entry[0]}
    for entry in _INFIX_OP_CATALOG
}

# Sentinel prefix for infix-op Xi placeholders (avoids collisions with
# the multichar-subscript and text-command Xi placeholders which use
# small numeric indices).
_INFIX_XI_START = 900


_INFIX_RELATION_FENCES: list[str] = [
    # Relation operators that act as segment boundaries for infix
    # rewriting.  Sorted longest-first so greedy matching works.
    r"\Longleftrightarrow", r"\Longrightarrow",
    r"\Leftrightarrow", r"\Rightarrow",
    r"\subseteq", r"\supseteq",
    r"\implies", r"\approx", r"\subset", r"\supset",
    r"\equiv", r"\notin", r"\propto",
    r"\geq", r"\leq", r"\neq", r"\sim", r"\iff",
    r"\ge", r"\le", r"\ne", r"\gt", r"\lt", r"\in",
    r"\to", r"\mid",
    "=", ">", "<",
    # A bare depth-0 comma separates statements / list items — an infix
    # operator's operands are never split across it, so it must fence the
    # rewrite (otherwise ``A = B, C \circ D = E`` glues ``B`` and ``C \circ D``
    # into one ``\Xi(B, C, D)`` call, destroying the statement boundary).
    # The escaped thin-space ``\,`` is guarded against in the matcher below.
    ",",
]


def _rewrite_infix_ops(
    latex: str,
) -> tuple[str, dict[str, dict[str, str]]]:
    r"""Rewrite LaTeX infix operators to ``\Xi_{N}(LHS, RHS)`` calls.

    Recursively processes parenthesized and braced groups so operators
    inside function arguments (e.g. ``P(A \cap B)``) are also rewritten.

    Relation operators (``=``, ``\leq``, ``\iff``, …) act as segment
    boundaries: the rewriter processes each segment independently so
    it never wraps across an equation.

    Returns ``(rewritten_latex, infix_overrides)`` where
    *infix_overrides* maps each ``Xi_{N}`` placeholder name to its
    operator metadata (``op``, ``emoji``, ``type``, ``latex_cmd``).
    """
    # Quick bail-out.
    all_cmds = [cmd for group in _INFIX_PRECEDENCE for cmd in group]
    if not any(cmd in latex for cmd in all_cmds):
        return latex, {}

    infix_overrides: dict[str, dict[str, str]] = {}
    xi_counter = [_INFIX_XI_START]  # mutable counter for nested calls

    def _alloc_placeholder(cmd: str) -> str:
        """Allocate a new Xi placeholder for the given command."""
        idx = xi_counter[0]
        xi_counter[0] += 1
        ph_name = f"Xi_{{{idx}}}"
        infix_overrides[ph_name] = _INFIX_OP_BY_CMD[cmd].copy()
        return rf"\Xi_{{{idx}}}"

    def _process_segment(s: str) -> str:
        """Process a single relation-free segment for infix operators."""
        # Recurse into existing parenthesized/braced/pipe groups.
        s = _recurse_into_groups(s)
        # Rewrite operators at depth 0, one precedence group at a time.
        for group in _INFIX_PRECEDENCE:
            present = [cmd for cmd in group if cmd in s]
            if not present:
                continue
            while True:
                split = _split_on_infix(s, present)
                if split is None:
                    break
                lhs, hit_cmd, rhs = split
                lhs = _process_segment(lhs)
                rhs = _process_segment(rhs)
                placeholder = _alloc_placeholder(hit_cmd)
                s = rf"{placeholder}({lhs}, {rhs})"
        return s

    def _process(s: str) -> str:
        """Split on relation fences, process each segment, reassemble."""
        segments, separators = _split_on_relation_fences(s)
        if not separators:
            # No relation fences — process the whole string.
            return _process_segment(s)
        processed = [_process_segment(seg) for seg in segments]
        # Reassemble with exactly one space around each separator. Segments
        # keep the leading/trailing whitespace from their split points, so
        # strip those boundaries — otherwise ``= `` + `` \text{x}`` reassembles
        # to ``=  \text{x}`` (a double space that leaks into the subexpr).
        out: list[str] = [processed[0].rstrip()]
        for sep, seg in zip(separators, processed[1:]):
            # A comma is list/statement punctuation — no space *before* it
            # (``B, C``, not ``B , C``). Relation operators get a space each
            # side (``B = C``).
            out.append(f"{sep} " if sep == "," else f" {sep} ")
            out.append(seg.strip())
        return "".join(out).strip()

    def _recurse_into_groups(s: str) -> str:
        """Find parenthesized/braced/pipe groups and recursively process."""
        all_cmds_local = [cmd for grp in _INFIX_PRECEDENCE
                          for cmd in grp]
        out: list[str] = []
        i = 0
        n = len(s)
        while i < n:
            c = s[i]
            if c in "({":
                close = ")" if c == "(" else "}"
                depth = 1
                k = i + 1
                while k < n and depth > 0:
                    if s[k] in "({":
                        depth += 1
                    elif s[k] in ")}":
                        depth -= 1
                    k += 1
                inner = s[i + 1:k - 1]
                if any(cmd in inner for cmd in all_cmds_local):
                    inner = _process(inner)
                out.append(c)
                out.append(inner)
                out.append(close)
                i = k
            elif c == "|":
                # Try to find matching closing |.
                k = i + 1
                depth = 0
                while k < n:
                    if s[k] in "({":
                        depth += 1
                    elif s[k] in ")}":
                        depth -= 1
                    elif s[k] == "|" and depth == 0:
                        break
                    k += 1
                if k < n:
                    inner = s[i + 1:k]
                    if any(cmd in inner for cmd in all_cmds_local):
                        inner = _process(inner)
                    out.append("|")
                    out.append(inner)
                    out.append("|")
                    i = k + 1
                else:
                    out.append(c)
                    i += 1
            else:
                out.append(s[i])
                i += 1
        return "".join(out)

    latex = _process(latex)
    return latex, infix_overrides


def _split_on_relation_fences(
    latex: str,
) -> tuple[list[str], list[str]]:
    """Split *latex* on depth-0 relation operators (=, \\leq, \\iff, …).

    Returns ``(segments, separators)`` where ``len(segments) ==
    len(separators) + 1``.  If no relation operator is found,
    ``segments`` has one element and ``separators`` is empty.
    """
    depths = _compute_depth_map(latex)
    segments: list[str] = []
    separators: list[str] = []
    seg_start = 0
    i = 0
    n = len(latex)

    while i < n:
        if depths[i] != 0:
            i += 1
            continue
        found = False
        for fence in _INFIX_RELATION_FENCES:
            end = i + len(fence)
            if end > n:
                continue
            if latex[i:end] != fence:
                continue
            if all(depths[k] == 0 for k in range(i, end)):
                # Word-boundary for LaTeX commands.
                if fence.startswith("\\") and end < n and latex[end].isalpha():
                    continue
                # A comma preceded by an odd run of backslashes is the escaped
                # thin-space ``\,`` — a spacing command, not a separator.
                if fence == ",":
                    bs = 0
                    k = i - 1
                    while k >= 0 and latex[k] == "\\":
                        bs += 1
                        k -= 1
                    if bs % 2 == 1:
                        continue
                segments.append(latex[seg_start:i])
                separators.append(fence)
                seg_start = end
                i = end
                found = True
                break
        if not found:
            i += 1

    segments.append(latex[seg_start:])
    return segments, separators


def _split_on_infix(
    latex: str, cmds: list[str],
) -> tuple[str, str, str] | None:
    r"""Find the **rightmost** depth-0 infix operator and split around it.

    Returns ``(lhs, cmd, rhs)`` or ``None`` if no operator found.

    Using the *rightmost* hit gives left-associative grouping:
    ``A \cap B \cap C`` splits as ``(A \cap B, \cap, C)`` so the
    recursive caller wraps the LHS first, yielding
    ``Xi(Xi(A, B), C)``.

    ``|…|`` absolute-value pairs are treated as balanced groups so
    ``|A \cap B|`` is not split across the pipes.
    """
    # Forward pass: build a depth map so we know which characters are
    # at depth 0 vs. inside groups.  This handles ``()``, ``{}``, and
    # paired ``|…|`` (absolute-value notation).
    depths = _compute_depth_map(latex)

    # Scan right-to-left for the rightmost depth-0 operator.
    i = len(latex) - 1
    while i >= 0:
        if depths[i] != 0:
            i -= 1
            continue
        for cmd in cmds:
            start = i - len(cmd) + 1
            if start < 0:
                continue
            if latex[start:i + 1] != cmd:
                continue
            # All characters of the cmd must be at depth 0.
            if any(depths[k] != 0 for k in range(start, i + 1)):
                continue
            end = i + 1
            if (cmd.startswith("\\") and end < len(latex)
                    and latex[end].isalpha()):
                break  # word boundary
            lhs = latex[:start].rstrip()
            rhs = latex[end:].lstrip()
            return lhs, cmd, rhs
        i -= 1

    return None


def _compute_depth_map(latex: str) -> list[int]:
    """Compute a per-character depth map for ``()``, ``{}``, ``|…|`` groups.

    Returns a list of integers, one per character.  Characters at the
    top level have depth 0; characters inside parenthesized, braced,
    or pipe-delimited groups have depth > 0.
    """
    n = len(latex)
    depths = [0] * n
    depth = 0

    # First pass: handle () and {} — these are unambiguous.
    for i in range(n):
        c = latex[i]
        if c in "({":
            depths[i] = depth
            depth += 1
        elif c in ")}":
            depth -= 1
            depths[i] = depth
        else:
            depths[i] = depth

    # Second pass: handle | pairs.  Scan left-to-right and greedily
    # pair | characters at the same brace/paren depth.
    pipe_stack: list[tuple[int, int]] = []  # (position, depth_at_pipe)
    for i in range(n):
        if latex[i] != "|":
            continue
        d = depths[i]
        if pipe_stack and pipe_stack[-1][1] == d:
            # Close the pair.
            open_pos, _ = pipe_stack.pop()
            # Mark everything between the pipes as depth+1.
            for j in range(open_pos + 1, i):
                depths[j] += 1
        else:
            # Open a new pair.
            pipe_stack.append((i, d))

    return depths


def _restore_conditional_bar_in_subexpr(subexpr: str) -> str:
    r"""Replace the last ``,`` inside the function's parens with ``\mid``.

    SymPy renders ``P(A, B)`` as ``P{\left(A,B \right)}`` in the subexpr;
    we want ``P{\left(A \mid B \right)}`` to match the original
    conditional-probability notation.
    """
    # Find the innermost paren group that contains the function args.
    # SymPy wraps as ``P{\left( ... \right)}``, so the comma is inside
    # nested ``{`` and ``\left(`` — track depth with both ``(){}`` pairs.
    depth = 0
    last_comma = -1
    # Find the opening ``(`` or ``\left(`` after the function name.
    paren_depth = -1
    for i, c in enumerate(subexpr):
        if c in "({":
            depth += 1
            if c == "(" and paren_depth < 0:
                paren_depth = depth
        elif c in ")}":
            depth -= 1
        elif c == "," and paren_depth > 0 and depth == paren_depth:
            last_comma = i
    if last_comma < 0:
        return subexpr
    # Consume optional whitespace after the comma so spacing is clean.
    after = last_comma + 1
    while after < len(subexpr) and subexpr[after] == " ":
        after += 1
    return subexpr[:last_comma] + r" \mid " + subexpr[after:]


def _restore_all_conditional_bars(
    latex: str, func_names: set[str],
) -> str:
    r"""Restore conditional bars in ALL occurrences of named functions.

    Scans *latex* for every call to a function whose name is in
    *func_names* and replaces the **last** comma at argument-level depth
    with ``\mid``.  Handles both SymPy's ``P{\left(A,B \right)}`` and
    plain ``P(A,B)`` forms.
    """
    if not func_names:
        return latex

    # Build a regex that finds the function name followed by the opening
    # delimiter — either ``{\left(`` or plain ``(``.
    escaped = "|".join(
        re.escape(f) for f in sorted(func_names, key=len, reverse=True)
    )
    pattern = re.compile(
        rf"(?:{escaped})"       # function name
        r"(?:\{\\left\(|(?:\{)?\()"  # opening delimiters
    )

    result: list[str] = []
    pos = 0
    for m in pattern.finditer(latex):
        start = m.start()
        result.append(latex[pos:start])

        # Walk forward from end of match to find the balanced close.
        depth = 1
        k = m.end()
        last_comma = -1
        while k < len(latex) and depth > 0:
            c = latex[k]
            if c in "({":
                depth += 1
            elif c in ")}":
                depth -= 1
            elif c == "," and depth == 1:
                last_comma = k          # track *last* comma at top level
            k += 1

        func_region = latex[start:k]
        if last_comma >= 0:
            rel = last_comma - start    # offset relative to func_region
            after = rel + 1
            while after < len(func_region) and func_region[after] == " ":
                after += 1
            func_region = (
                func_region[:rel] + r" \mid " + func_region[after:]
            )
        result.append(func_region)
        pos = k

    result.append(latex[pos:])
    return "".join(result)


def _restore_all_assertion_ops(
    latex: str, func_names: dict[str, list[str]] | set[str],
) -> str:
    r"""Restore assertion operators in ALL occurrences of named functions.

    The preprocessor rewrites e.g. ``P(X = k)`` → ``P(X, k)`` or
    ``P(|X-\mu| \geq k)`` → ``P(|X-\mu|, k)`` before SymPy parsing.
    SymPy then renders ``P{\left(X,k \right)}`` in subexprs.  This
    function restores commas at argument depth to the original
    operator(s) for functions in *func_names*.

    For single-operator assertions (``[\"=\"]``), only the **last**
    comma is replaced.  For chained inequalities (``[\"<\", \"\\leq\"]``),
    all commas are replaced in order with the corresponding operators.

    *func_names* can be a ``dict[str, list[str]]`` mapping function name →
    original operator list (e.g. ``{"P": ["\\geq"]}``) or a legacy
    ``set[str]`` which defaults the operator to ``["="]``.

    Uses the same scanning logic as ``_restore_all_conditional_bars``.
    """
    if not func_names:
        return latex

    # Normalise to dict form.
    if isinstance(func_names, set):
        func_map: dict[str, list[str]] = {f: ["="] for f in func_names}
    else:
        func_map = func_names

    escaped = "|".join(
        re.escape(f) for f in sorted(func_map, key=len, reverse=True)
    )
    pattern = re.compile(
        rf"(?P<fname>{escaped})"
        r"(?:\{\\left\(|(?:\{)?\()"
    )

    result: list[str] = []
    pos = 0
    for m in pattern.finditer(latex):
        start = m.start()
        fname = m.group("fname")
        orig_ops = func_map.get(fname, ["="])
        result.append(latex[pos:start])

        depth = 1
        k = m.end()
        comma_positions: list[int] = []
        while k < len(latex) and depth > 0:
            c = latex[k]
            if c in "({":
                depth += 1
            elif c in ")}":
                depth -= 1
            elif c == "," and depth == 1:
                comma_positions.append(k)
            k += 1

        func_region = latex[start:k]
        if comma_positions:
            if len(orig_ops) == 1:
                # Single-op: replace LAST comma (backward-compatible).
                last_comma = comma_positions[-1]
                rel = last_comma - start
                after = rel + 1
                while after < len(func_region) and func_region[after] == " ":
                    after += 1
                func_region = (
                    func_region[:rel]
                    + f" {orig_ops[0]} "
                    + func_region[after:]
                )
            else:
                # Chained: replace ALL commas right-to-left with their
                # corresponding operators.
                n_replace = min(len(comma_positions), len(orig_ops))
                for idx in range(n_replace - 1, -1, -1):
                    comma_abs = comma_positions[idx]
                    rel = comma_abs - start
                    after = rel + 1
                    while (after < len(func_region)
                           and func_region[after] == " "):
                        after += 1
                    func_region = (
                        func_region[:rel]
                        + f" {orig_ops[idx]} "
                        + func_region[after:]
                    )
        result.append(func_region)
        pos = k

    result.append(latex[pos:])
    return "".join(result)


def _find_unpaired_pipes(s: str) -> list[int]:
    """Find positions of ``|`` chars that are NOT part of ``|…|`` pairs.

    Inside function-call bodies, paired ``|`` (absolute value) comes in
    ``|expr|`` form.  An unpaired ``|`` is the conditional bar.

    Heuristic: a ``|`` at position *p* is paired if there's another ``|``
    at some later position *q* such that there's non-whitespace content
    between them (the absolute-value body).  A single ``|`` with no
    viable partner is unpaired → conditional bar.
    """
    # Collect pipe positions that aren't inside nested parens/braces.
    pipes: list[int] = []
    depth_paren = 0
    depth_brace = 0
    i = 0
    while i < len(s):
        c = s[i]
        if c == "(":
            depth_paren += 1
        elif c == ")":
            depth_paren -= 1
        elif c == "{":
            depth_brace += 1
        elif c == "}":
            depth_brace -= 1
        elif c == "|" and depth_paren == 0 and depth_brace == 0:
            pipes.append(i)
        i += 1

    if not pipes:
        return []

    # Even count → all paired (absolute values); odd → one is conditional.
    if len(pipes) % 2 == 0:
        return []  # all paired

    # Odd count: find which pipe is the conditional bar.
    # Strategy: try to greedily pair pipes left→right.  The leftover is
    # the conditional bar.
    # A valid |…| pair has non-whitespace between the pipes.
    paired = set()
    j = 0
    while j < len(pipes) - 1:
        left = pipes[j]
        right = pipes[j + 1]
        between = s[left + 1:right].strip()
        if between:
            # Valid absolute-value pair.
            paired.add(j)
            paired.add(j + 1)
            j += 2
        else:
            j += 1

    unpaired = [pipes[k] for k in range(len(pipes)) if k not in paired]
    return unpaired


_EXPECTATION_STYLE_RE: re.Pattern[str] = re.compile(
    r"\\(?:mathbb|mathbf|mathrm|operatorname)\s*\{E\}\s*$"
)


def _is_expectation_operator(latex: str, j: int) -> bool:
    r"""Return True if the token ending at index ``j`` is expectation ``E``.

    Matches a bare single-letter ``E`` (not part of a longer identifier)
    or a styled form like ``\mathbb{E}`` / ``\mathrm{E}``.
    """
    if j < 0:
        return False
    # Bare E.  In LaTeX adjacent letters are implicit multiplication
    # (``aE[X]`` = ``a · E[X]``), so a preceding letter is fine; only a
    # backslash would make this part of a command name.
    if latex[j] == "E":
        return not (j > 0 and latex[j - 1] == "\\")
    # Styled E: \mathbb{E}, \mathrm{E}, \operatorname{E}, …
    if latex[j] == "}":
        return _EXPECTATION_STYLE_RE.search(latex[: j + 1]) is not None
    return False


def _rewrite_bracket_functions(latex: str) -> str:
    r"""Rewrite ``E[X]`` → ``E(X)`` so SymPy sees a function call.

    SymPy's ``parse_latex`` treats square brackets as grouping, so
    ``E[X]`` parses as implicit multiplication ``E · X``.  This pass
    detects the expectation operator immediately before ``[`` and
    rewrites the brackets to parentheses.

    Only the expectation operator ``E`` qualifies — either bare
    (``E[X]``) or styled (``\mathbb{E}[X]``, ``\mathrm{E}[X]``, …).
    Every other ``identifier[…]`` (concentration ``k[A]``, probability
    ``P[A]``, indexing ``a[i]``, matrices) is left untouched, since
    ``E[X]`` is the only bracket form that denotes a function call.
    """
    if "[" not in latex:
        return latex

    out: list[str] = []
    i = 0
    n = len(latex)
    while i < n:
        if latex[i] == "[":
            # Only the expectation operator E[...] is a function call.
            j = i - 1
            while j >= 0 and latex[j] in " \t":
                j -= 1
            is_func = _is_expectation_operator(latex, j)

            if is_func:
                # Find matching ']'.
                depth = 1
                k = i + 1
                while k < n and depth > 0:
                    if latex[k] == "[":
                        depth += 1
                    elif latex[k] == "]":
                        depth -= 1
                    k += 1
                # Rewrite [...] → (...)
                out.append("(")
                out.append(latex[i + 1:k - 1])
                out.append(")")
                i = k
                continue

        out.append(latex[i])
        i += 1

    return "".join(out)


# Base index for concentration placeholders.  Kept well above the small
# indices used by the other ``\Xi_{N}`` collapse passes (subscripts, text,
# overline — all start near 0) so the merged-override dict never clashes.
_CONCENTRATION_XI_BASE = 600


def _collapse_concentration_brackets(
    latex: str,
    start_idx: int = _CONCENTRATION_XI_BASE,
) -> tuple[str, dict[str, dict[str, str]]]:
    r"""Rewrite chemistry concentration brackets ``[A]`` into placeholders.

    In chemistry, ``[A]`` denotes the molar concentration of species *A* —
    a unary *operator* applied to the species, **not** grouping or a
    function call.  SymPy has no concept of this, so each ``[species]`` is
    replaced with a ``\Xi_{N}(species)`` placeholder function and recorded
    in *overrides* with ``concentration=True``.  The walker turns that
    placeholder into a dedicated ``concentration`` operator node fed by the
    species, and the subexpr restorer rebuilds the original ``[…]`` form.

    A trailing subscript (``[A]_0`` — initial concentration) is folded into
    the species argument (``A_{0}``) so the two forms stay distinct.  A
    trailing superscript (``[A]^2``) is left outside the bracket so it
    becomes an ordinary power over the concentration node.
    """
    if "[" not in latex:
        return latex, {}

    overrides: dict[str, dict[str, str]] = {}
    out: list[str] = []
    i = 0
    n = len(latex)
    counter = start_idx
    while i < n:
        if latex[i] == "[":
            # Find the matching ``]`` (single level of nesting tolerated).
            depth = 1
            k = i + 1
            while k < n and depth > 0:
                if latex[k] == "[":
                    depth += 1
                elif latex[k] == "]":
                    depth -= 1
                k += 1
            if depth == 0:
                content = latex[i + 1:k - 1].strip()
                # Absorb a trailing subscript: ``[A]_0`` / ``[A]_{0}``.
                sub_latex = ""
                arg = content
                j = k
                while j < n and latex[j] in " \t":
                    j += 1
                if j < n and latex[j] == "_":
                    j += 1
                    if j < n and latex[j] == "{":
                        depth2 = 1
                        m = j + 1
                        while m < n and depth2 > 0:
                            if latex[m] == "{":
                                depth2 += 1
                            elif latex[m] == "}":
                                depth2 -= 1
                            m += 1
                        sub_body = latex[j + 1:m - 1]
                        sub_latex = "_{" + sub_body + "}"
                        arg = f"{content}_{{{sub_body}}}"
                        k = m
                    elif j < n:
                        sub_body = latex[j]
                        sub_latex = "_" + sub_body
                        arg = f"{content}_{{{sub_body}}}"
                        k = j + 1
                name = f"Xi_{{{counter}}}"
                overrides[name] = {
                    "concentration": True,
                    "label": "concentration",
                    "original_latex": f"[{content}]{sub_latex}",
                    "latex": f"[{content}]{sub_latex}",
                }
                out.append(rf"\Xi_{{{counter}}}({arg})")
                counter += 1
                i = k
                continue
        out.append(latex[i])
        i += 1

    return "".join(out), overrides


def _normalize_script_order(latex: str) -> str:
    r"""Rewrite ``base^{up}_{down}`` as ``base_{down}^{up}``.

    A symbol carrying both a superscript and a subscript (e.g. the tensor
    ``R^\rho_{\sigma\mu\nu}``) is visually identical regardless of script
    order, but SymPy's grammar binds the *second* script to the *first*:
    ``R^\rho_{\sigma\mu\nu}`` parses as ``R ** (rho_{sigma mu nu})`` — the
    subscript indices get glued onto the exponent.  Writing the subscript
    first (``R_{\sigma\mu\nu}^\rho``) makes SymPy bind the subscript to the
    base, so only the (deferred) superscript becomes a power.  This also
    fixes ordinary cases like ``a^2_i`` → ``a_i^2`` (i.e. ``(a_i)**2``).
    """
    _script = r"(?:\{[^{}]*\}|\\[A-Za-z]+|[A-Za-z0-9])"
    _base = r"(?:\\[A-Za-z]+|[A-Za-z])"
    pattern = re.compile(rf"({_base})\^({_script})_({_script})")
    # Apply repeatedly so chained rewrites settle (rare, but cheap).
    prev = None
    while prev != latex:
        prev = latex
        latex = pattern.sub(r"\1_\3^\2", latex)
    return latex


def _collapse_multichar_subscripts(
    latex: str,
) -> tuple[str, dict[str, dict[str, str]]]:
    r"""Collapse symbols with multi-char alphabetic subscripts into placeholders.

    SymPy's ``parse_latex`` treats ``v_{rms}`` as ``v`` subscripted by
    ``r \cdot m \cdot s``.  This pass replaces the full token
    (``v_{rms}``) with a ``\Xi_{N}`` placeholder and records the
    original text in *overrides* so the postprocessor can restore it.
    """
    overrides: dict[str, dict[str, str]] = {}
    seen: dict[str, int] = {}

    # Match: optional \cmd base OR single alpha base, then a subscript made of
    # 2+ contiguous tokens, where each token is a *Greek-letter* command (\mu)
    # or a bare letter.  This catches both bare-letter subscripts (v_{rms}) and
    # multi-Greek-letter tensor indices (g_{\mu\nu}) — the latter would
    # otherwise be parsed by SymPy as an implicit product \mu·\nu.
    #
    # The command alternative is restricted to a Greek whitelist so that
    # operator/relation subscripts like \lim_{x \to a} or \sum_{d \mid n}
    # (where \to / \mid are not indices) are left untouched.
    _greek = (
        r"alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|"
        r"iota|kappa|lambda|mu|nu|xi|omicron|pi|varpi|rho|varrho|sigma|"
        r"varsigma|tau|upsilon|phi|varphi|chi|psi|omega|"
        r"Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega"
    )
    _sub_token = rf"(?:\\(?:{_greek})|[A-Za-z])"

    # Large operators whose subscript is a bound variable / index, NOT part of
    # the symbol name (e.g. \sum_\mu, \int_\mu, \lim_\mu).  These must never be
    # collapsed — doing so would erase the operator.  \partial and \nabla are
    # deliberately absent: their indexed forms (\partial_\mu, \nabla_\mu) are
    # treated as leaf symbols, so collapsing them is correct.
    _operators = (
        r"sum|prod|coprod|int|iint|iiint|oint|lim|limsup|liminf|"
        r"max|min|sup|inf|arg|det|gcd|bigcup|bigcap|bigoplus|bigotimes|"
        r"bigvee|bigwedge|bigsqcup"
    )
    # Base: a \cmd (not a large operator) or a single bare letter.
    _base = rf"(?:\\(?!(?:{_operators})(?![A-Za-z]))[A-Za-z]+|[A-Za-z])"
    # Subscript: braced 2+ contiguous tokens (v_{rms}, g_{\mu\nu}), a braced
    # single Greek command (\nabla_{\mu}), or an *unbraced* single Greek command
    # (\nabla_\mu).  Single bare letters (v_i) are left to SymPy.
    _greek_cmd = rf"\\(?:{_greek})"
    pattern = re.compile(
        rf"({_base})"
        rf"_(\{{(?:{_sub_token}{{2,}}|{_greek_cmd})\}}|{_greek_cmd})"
    )

    def _repl(m: re.Match) -> str:
        base = m.group(1)
        sub = m.group(2)
        full = m.group(0)
        # Strip surrounding braces when present so the override carries the bare
        # subscript content (which we re-wrap below).
        if sub.startswith("{"):
            sub = sub[1:-1]
        if full not in seen:
            idx = len(seen)
            seen[full] = idx
            # Greek-command subscripts (e.g. \mu\nu) must stay in math mode so
            # they render as Greek letters; bare-letter subscripts (e.g. rms)
            # use \text to avoid implicit multiplication on restore.
            sub_latex = sub if "\\" in sub else rf"\text{{{sub}}}"
            overrides[f"Xi_{{{idx}}}"] = {
                "latex": rf"{base}_{{{sub_latex}}}",
                "type": "scalar",
            }
        return rf"\Xi_{{{seen[full]}}}"

    rewritten = pattern.sub(_repl, latex)
    return rewritten, overrides


def _collapse_text_commands(latex: str) -> tuple[str, dict[str, dict[str, str]]]:
    r"""Replace ``\text{NAME}`` with ``\Xi_{N}`` placeholder symbols."""
    overrides: dict[str, dict[str, str]] = {}
    seen: dict[str, int] = {}

    def repl(m: re.Match) -> str:
        content = m.group(1).strip()
        if content not in seen:
            idx = len(seen)
            seen[content] = idx
            overrides[f"Xi_{{{idx}}}"] = {
                "label": content,
                "latex": r"\text{" + content + "}",
                "type": "text",
            }
        return rf"\Xi_{{{seen[content]}}}"

    rewritten = re.sub(r"\\text\{([^{}]+)\}", repl, latex)
    return rewritten, overrides


def _collapse_overline(
    latex: str,
    start_idx: int = 0,
) -> tuple[str, dict[str, dict[str, str]]]:
    r"""Replace ``\overline{X}`` with ``\Xi_{N}`` placeholder symbols.

    ``\overline`` is semantically ambiguous — it can mean complex conjugate,
    logical NOT, statistical mean, or closure depending on the domain.
    Rather than interpreting it, we treat ``\overline{X}`` as a distinct
    scalar variable whose display label is ``\overline{X}``.

    *start_idx* avoids ``Xi_{N}`` collisions with earlier collapse passes.
    """
    overrides: dict[str, dict[str, str]] = {}
    if r"\overline" not in latex:
        return latex, overrides

    seen: dict[str, int] = {}
    _counter = [start_idx]

    # Match \overline{...} with balanced braces (single nesting level)
    pattern = re.compile(
        r"\\overline\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}"
    )

    def repl(m: re.Match) -> str:
        body = m.group(1).strip()
        full = m.group(0)
        if full not in seen:
            idx = _counter[0]
            _counter[0] += 1
            seen[full] = idx
            overrides[f"Xi_{{{idx}}}"] = {
                "label": rf"\overline{{{body}}}",
                "latex": rf"\overline{{{body}}}",
                "type": "scalar",
            }
        return rf"\Xi_{{{seen[full]}}}"

    rewritten = pattern.sub(repl, latex)
    return rewritten, overrides


def _collapse_braket_notation(latex: str) -> tuple[str, dict[str, dict[str, str]]]:
    r"""Replace Dirac braket inner products with ``\Phi_{N}`` placeholders."""
    overrides: dict[str, dict[str, str]] = {}
    if "|" not in latex:
        return latex, overrides
    seen: dict[str, int] = {}
    out: list[str] = []
    i = 0
    n = len(latex)
    while i < n:
        start = i
        pos = i
        if latex[pos:pos + 5] == "\\left":
            tmp = pos + 5
            while tmp < n and latex[tmp] in " \t":
                tmp += 1
            if latex[tmp:tmp + 7] == "\\langle":
                pos = tmp
        if latex[pos:pos + 7] != "\\langle":
            out.append(latex[i])
            i += 1
            continue
        content_start = pos + 7
        pipe_pos = latex.find("|", content_start)
        if pipe_pos == -1:
            out.append(latex[i])
            i += 1
            continue
        rangle_pos = latex.find("\\rangle", pipe_pos + 1)
        if rangle_pos == -1:
            out.append(latex[i])
            i += 1
            continue
        if latex.find("|", pipe_pos + 1, rangle_pos) != -1:
            out.append(latex[i])
            i += 1
            continue
        bra_content = latex[content_start:pipe_pos].strip()
        ket_content = latex[pipe_pos + 1:rangle_pos].strip()
        end = rangle_pos + 7
        j = end
        while j < n and latex[j] in " \t":
            j += 1
        if latex[j:j + 6] == "\\right":
            k = j + 6
            while k < n and latex[k] in " \t":
                k += 1
            if k < n and latex[k] == ".":
                end = k + 1
        full = latex[start:end]
        if full not in seen:
            idx = len(seen)
            seen[full] = idx
            overrides[f"Phi_{{{idx}}}"] = {
                "latex": _braket_skeleton_latex(bra_content, ket_content),
                "type": "operator",
                "op": "inner_product",
                "bra_content": bra_content,
                "ket_content": ket_content,
                "original_latex": full,
            }
        out.append(rf"\Phi_{{{seen[full]}}}")
        i = end
    return "".join(out), overrides


def _collapse_compound_symbols(latex: str) -> tuple[str, dict[str, dict[str, str]]]:
    r"""Replace compound identifiers like ``\Delta t`` with ``\Theta_{N}``."""
    overrides: dict[str, dict[str, str]] = {}
    seen: dict[str, int] = {}

    def repl(m: re.Match) -> str:
        prefix_cmd = m.group(1)
        operand = m.group(2)
        suffix = m.group(3) or ""
        compound = f"{prefix_cmd} {operand}{suffix}"
        if compound not in seen:
            idx = len(seen)
            seen[compound] = idx
            overrides[f"Theta_{{{idx}}}"] = {
                "latex": compound,
                "type": "scalar",
            }
        return rf"\Theta_{{{seen[compound]}}}"

    greek_operands = (
        r"alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|"
        r"iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|"
        r"upsilon|phi|varphi|chi|psi|omega|"
        r"Alpha|Beta|Gamma|Delta|Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|"
        r"Mu|Nu|Xi|Omicron|Pi|Rho|Sigma|Tau|Upsilon|Phi|Chi|Psi|Omega|"
        r"ell|hbar"
    )
    sub_sup_atom = r"(?:\{[^{}]*\}|\\[A-Za-z]+|[A-Za-z0-9])"
    sub_sup_chain = rf"(?:[_^]{sub_sup_atom})*"
    spacing = r"(?:\s|\\,|\\;|\\!|\\:|\\quad|\\qquad)*"
    pattern = (
        r"(\\(?:Delta|delta))"
        + spacing
        + rf"(\\(?:{greek_operands})(?![A-Za-z])|[A-Za-z])"
        + r"(?![A-Za-z])"
        + rf"({sub_sup_chain})"
    )
    rewritten = re.sub(pattern, repl, latex)

    # Also collapse Greek letter commands with subscripts, e.g.
    # ``\epsilon_0``, ``\epsilon_{0}``, ``\mu_{r}``.  SymPy's
    # ``parse_latex`` embeds braces in the symbol name
    # (``Symbol('epsilon_{0}')``), which breaks ``sympy.latex()``
    # Greek-letter detection — it outputs bare ``epsilon_{0}`` instead
    # of ``\epsilon_{0}``.  Collapsing to a ``\Theta_{N}`` placeholder
    # lets the existing restore pipeline produce the correct LaTeX.
    greek_sub_pattern = re.compile(
        r"(\\(?:" + greek_operands + r"))"
        r"(_\{[^{}]+\}|_[A-Za-z0-9])"  # braced or single-char subscript
    )

    def _repl_greek_sub(m: re.Match) -> str:
        full = m.group(0)
        cmd = m.group(1)   # e.g. \epsilon
        # Skip already-collapsed placeholders (\Theta_{N}, \Xi_{N}, \Phi_{N})
        if cmd in (r"\Theta", r"\Xi", r"\Phi"):
            return full
        # Normalise to braced subscript: \epsilon_0 → \epsilon_{0}
        sub = m.group(2)   # e.g. _0 or _{0}
        if not sub.startswith("_{"):
            sub = "_{" + sub[1:] + "}"
        canonical = cmd + sub
        if full not in seen:
            idx = len(seen)
            seen[full] = idx
            overrides[f"Theta_{{{idx}}}"] = {
                "latex": canonical,
                "type": "scalar",
            }
        return rf"\Theta_{{{seen[full]}}}"

    rewritten = greek_sub_pattern.sub(_repl_greek_sub, rewritten)

    return rewritten, overrides


def _extract_parenthetical_annotations(latex: str) -> tuple[str, list[dict[str, str]]]:
    r"""Strip trailing parenthetical annotations from LaTeX.

    Delegates to :meth:`LaTeXPreprocessor.extract_parenthetical_annotations`
    so both entry points share one discriminator.
    """
    return LaTeXPreprocessor.extract_parenthetical_annotations(latex)


# Accent commands that SymPy's ``parse_latex`` doesn't understand — it
# treats ``\vec{F}`` as ``Symbol("vec") * Symbol("F")``.  We strip these
# before parsing and restore them via the postprocessor.  Font commands
# (``\mathbf``, ``\mathrm``, …) are intentionally excluded — they are
# handled downstream by ``_strip_symbol_font_commands``.
# Note: ``dot``/``ddot``/``dddot``/``ddddot`` are intentionally excluded —
# they carry derivative semantics (``\dot{x}`` ≡ ``dx/dt``) and are
# handled by ``LaTeXPreprocessor.rewrite_dot_derivatives``.
_TRACKED_ACCENT_RE = re.compile(
    r"\\(vec|hat|bar|tilde"
    r"|widehat|widetilde|check|breve|mathring|acute|grave)"
    r"\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}"
)


def _strip_tracked_accents(
    latex: str,
    accent_map: dict[str, str],
) -> str:
    r"""Strip tracked accent commands and record them in *accent_map*.

    ``\vec{F}`` → ``F`` with ``accent_map["F"] = "vec"``.
    Nested accents are handled by iterating until stable.
    """
    prev = None
    cleaned = latex
    while cleaned != prev:
        prev = cleaned
        def _replace(m: re.Match) -> str:
            accent = m.group(1)
            body = m.group(2)
            # Only record single-token bodies (no nested commands)
            if body and "\\" not in body:
                accent_map.setdefault(body, accent)
            return body
        cleaned = _TRACKED_ACCENT_RE.sub(_replace, cleaned)
    return cleaned


def _preprocess_latex(latex: str) -> tuple[str, set[str]]:
    """Rewrite LaTeX patterns that SymPy's parse_latex doesn't handle.

    Returns ``(preprocessed_latex, bare_sum_indices)`` where
    *bare_sum_indices* is the set of index variable names that were
    given synthetic ``{idx=0}^{\\infty}`` bounds by the preprocessor.
    Names from ``\\sum_i`` forms keep the index visible; names starting
    with ``BARE_SUM_DUMMY_PREFIX`` (from bare ``\\sum``) are suppressed
    entirely by the translator.
    """
    def _expand_higher_deriv(m: re.Match) -> str:
        op = m.group(1)
        order = int(m.group(2) or m.group(3))
        func = m.group(4).strip()
        var = m.group(5).strip()
        if order <= 1:
            return m.group(0)
        wrapper = r"\frac{%s}{%s %s}" % (op, op, var)
        core = r"\frac{%s %s}{%s %s}" % (op, func, op, var)
        return wrapper * (order - 1) + core

    latex = re.sub(
        r"\\frac\{(d|\\partial)\^(?:\{(\d+)\}|(\d+))([^{}\d][^{}]*)\}\{\1\s*([^{}\s]+)\s*\^(?:\{\d+\}|\d+)\}",
        _expand_higher_deriv,
        latex,
    )
    latex = LaTeXPreprocessor.rewrite_dot_derivatives(latex)
    latex = LaTeXPreprocessor.normalize_frac_derivatives(latex)
    bare_sum_indices: set[str] = set()
    latex = LaTeXPreprocessor.normalize_bare_sums(latex, captured=bare_sum_indices)
    # Rewrite closed line integrals: \oint → \int (SymPy doesn't know \oint)
    latex = re.sub(r"\\oint\b", r"\\int", latex)
    latex = re.sub(r"_([A-Za-z0-9])(?![A-Za-z0-9_{])", r"_{\1}", latex)
    latex = re.sub(r"\\(?:quad|qquad|,|;|!)\s*", " ", latex)
    return latex, bare_sum_indices


def _inject_annotations(graph: dict, annotations: list[dict[str, str]]) -> None:
    """Append parenthetical annotation nodes to the graph."""
    for i, ann in enumerate(annotations):
        node_id = f"__annotation_{i}"
        node: dict[str, Any] = {"id": node_id}
        node.update(ann)
        graph.setdefault("nodes", []).append(node)


# ---------------------------------------------------------------------------
# Expression classification
# ---------------------------------------------------------------------------

def _classify_expression(expr: sympy.Basic) -> dict[str, Any]:
    """Classify the expression using SymPy's ODE/PDE tools."""
    from sympy import classify_ode, Function as SympyFunction

    derivs = list(expr.atoms(Derivative))
    if not derivs:
        return {"kind": "algebraic"}

    dep_syms: set[Symbol] = set()
    indep_syms: set[Symbol] = set()
    max_order = 0
    for d in derivs:
        if isinstance(d.expr, Symbol):
            dep_syms.add(d.expr)
        deriv_order = 0
        for var, count in d.variable_count:
            indep_syms.add(var)
            deriv_order += int(count)
        max_order = max(max_order, deriv_order)

    is_pde = len(indep_syms) > 1
    kind = "PDE" if is_pde else "ODE"

    meta: dict[str, Any] = {
        "kind": kind,
        "order": max_order,
        "dependent_variables": sorted(str(s) for s in dep_syms),
        "independent_variables": sorted(str(s) for s in indep_syms),
    }

    if not is_pde and len(dep_syms) == 1 and len(indep_syms) == 1:
        dep_sym = next(iter(dep_syms))
        indep_sym = next(iter(indep_syms))
        func = SympyFunction(dep_sym.name)(indep_sym)
        func_expr = expr.subs(dep_sym, func)
        if isinstance(func_expr, Eq):
            ode_expr = func_expr.lhs - func_expr.rhs
        else:
            ode_expr = func_expr
        try:
            hints = classify_ode(ode_expr, func)
            classifications = [h for h in hints
                               if isinstance(h, str) and not h.endswith("_Integral")]
            if classifications:
                meta["sympy_hints"] = classifications
            meta["linear"] = any("linear" in h for h in classifications)
            meta["homogeneous"] = any("homogeneous" in h for h in classifications)
            meta["constant_coefficients"] = any("constant_coeff" in h for h in classifications)
        except Exception:
            pass

    return meta


# ---------------------------------------------------------------------------
# Piecewise / cases detection
# ---------------------------------------------------------------------------

_CASES_BEGIN = r"\begin{cases}"
_CASES_END = r"\end{cases}"


def _extract_piecewise(latex: str) -> tuple[str | None, list[tuple[str, str | None]]] | None:
    r"""Detect ``\begin{cases}...\end{cases}`` and extract branches.

    Returns ``(lhs_latex, branches)`` where *lhs_latex* is the part before
    the cases environment (e.g. ``"f(x) ="``) stripped of the trailing
    ``=``, and each branch is ``(value_latex, condition_latex | None)``.
    Returns ``None`` if no cases environment is found.
    """
    # Use simple string search instead of regex to avoid polynomial
    # backtracking on crafted input (CodeQL: polynomial-redos).
    start = latex.find(_CASES_BEGIN)
    if start == -1:
        return None
    body_start = start + len(_CASES_BEGIN)
    end = latex.find(_CASES_END, body_start)
    if end == -1:
        return None

    before = latex[:start].strip()
    body = latex[body_start:end].strip()

    # Strip trailing = from the lhs
    lhs = before.rstrip("= ").strip() if before else None

    # Split branches on \\ at env depth 0 within the body
    branches: list[tuple[str, str | None]] = []
    for row in re.split(r"\\\\", body):
        row = row.strip()
        if not row:
            continue
        # & separates value from condition
        if "&" in row:
            val, cond = row.split("&", 1)
            branches.append((val.strip(), cond.strip()))
        else:
            branches.append((row.strip(), None))

    return (lhs, branches)


# ---------------------------------------------------------------------------
# Statement splitting
# ---------------------------------------------------------------------------

def _split_on_statement_separators(latex: str) -> list[str]:
    r"""Split on ``\\`` and ``, \quad`` at brace/env depth 0."""
    parts: list[str] = []
    depth = 0      # brace / paren / bracket depth
    env_depth = 0  # \begin{...} / \end{...} environment depth
    i = 0
    start = 0
    n = len(latex)
    while i < n:
        ch = latex[i]
        if ch in "{([":
            depth += 1
            i += 1
        elif ch in "})]":
            if depth > 0:
                depth -= 1
            i += 1
        elif ch == "\\" and depth == 0:
            # Track \begin{...} / \end{...} environments
            if latex[i:i + 7] == r"\begin{":
                env_depth += 1
                i += 7
                continue
            if latex[i:i + 5] == r"\end{":
                if env_depth > 0:
                    env_depth -= 1
                i += 5
                continue
            if i + 1 < n and latex[i + 1] == "\\" and env_depth == 0:
                end_of_bs = i + 2
                after = end_of_bs
                while after < n and latex[after] in " \t":
                    after += 1
                if after < n and latex[after] == "[":
                    bracket_end = latex.find("]", after + 1)
                    if bracket_end != -1:
                        after = bracket_end + 1
                    else:
                        after = end_of_bs
                else:
                    after = end_of_bs
                parts.append(latex[start:i])
                start = after
                i = after
            else:
                i += 1
        elif ch == "," and depth == 0 and env_depth == 0:
            bs = 0
            j = i - 1
            while j >= 0 and latex[j] == "\\":
                bs += 1
                j -= 1
            if bs % 2 == 1:
                i += 1
                continue
            m = _QUAD_COMMA_RE.match(latex, i)
            if m:
                parts.append(latex[start:i])
                start = m.end()
                i = start
                continue
            i += 1
        else:
            i += 1
    parts.append(latex[start:])
    nonempty = [p.strip() for p in parts if p.strip()]
    return nonempty if nonempty else [latex]


def _split_on_top_level_comma(latex: str) -> list[str]:
    r"""Split on bare commas at brace/paren/bracket depth 0."""
    parts: list[str] = []
    depth = 0
    start = 0
    for i, ch in enumerate(latex):
        if ch in "{([":
            depth += 1
        elif ch in "})]":
            if depth > 0:
                depth -= 1
        elif ch == "," and depth == 0:
            bs = 0
            j = i - 1
            while j >= 0 and latex[j] == "\\":
                bs += 1
                j -= 1
            if bs % 2 == 1:
                continue
            parts.append(latex[start:i])
            start = i + 1
    parts.append(latex[start:])
    nonempty = [p.strip() for p in parts if p.strip()]
    return nonempty if nonempty else [latex]


def _is_bare_variable(clause: str) -> bool:
    r"""Return ``True`` when *clause* looks like a bare variable/symbol."""
    stripped = _LEADING_SPACE_CMD_RE.sub("", clause).strip()
    if not stripped:
        return False
    if _split_on_relation(stripped) is not None:
        return False
    d = 0
    for ch in stripped:
        if ch in "{([":
            d += 1
        elif ch in "})]":
            if d > 0:
                d -= 1
        elif d == 0 and ch in "=+":
            return False
    return True


def _rejoin_subject_group_commas(clauses: list[str]) -> list[str]:
    r"""Re-join comma-separated subject lists preceding a relation."""
    if len(clauses) <= 1:
        return clauses
    result = list(clauses)
    changed = True
    while changed:
        changed = False
        merged: list[str] = []
        i = 0
        while i < len(result):
            if (
                i + 1 < len(result)
                and _is_bare_variable(result[i])
                and _split_on_relation(result[i + 1]) is not None
            ):
                merged.append(result[i] + ", " + result[i + 1])
                i += 2
                changed = True
            else:
                merged.append(result[i])
                i += 1
        result = merged
    return result


# ---------------------------------------------------------------------------
# Relation detection
# ---------------------------------------------------------------------------

def _split_on_relation(latex: str) -> tuple[str, dict[str, str], str] | None:
    """Find the leftmost top-level relation operator from RELATION_MAP."""
    best: tuple[int, str, dict[str, str]] | None = None
    n = len(latex)
    depth = [0] * n
    d = 0
    for i in range(n):
        if latex[i] in "{([":
            d += 1
        depth[i] = d
        if latex[i] in "})]" and d > 0:
            d -= 1
            depth[i] = d
    for cmd, meta in RELATION_MAP:
        clen = len(cmd)
        cmd_is_alpha = cmd[-1].isalpha()
        idx = 0
        while idx <= n - clen:
            pos = latex.find(cmd, idx)
            if pos == -1:
                break
            end = pos + clen
            if cmd_is_alpha and end < n and latex[end].isalpha():
                idx = end
                continue
            if depth[pos] == 0:
                if best is None or pos < best[0]:
                    best = (pos, cmd, meta)
                break
            idx = pos + 1
    if best is not None:
        idx, cmd, meta = best
        lhs = latex[:idx].strip()
        rhs = latex[idx + len(cmd):].strip()
        if lhs and rhs:
            return lhs, meta, rhs
    return None


def _split_chained_equals(latex: str) -> list[str] | None:
    r"""Split on all ``=`` at depth 0 when 2+ bare ``=`` exist.

    Returns a list of the individual parts (e.g. ``["a", "b", "c"]``
    for ``a = b = c``), or ``None`` when fewer than two ``=`` are found.
    """
    n = len(latex)
    d = 0
    eq_positions: list[int] = []
    for i in range(n):
        ch = latex[i]
        if ch in "{([":
            d += 1
        elif ch in "})]" and d > 0:
            d -= 1
        elif ch == "=" and d == 0:
            eq_positions.append(i)
    if len(eq_positions) < 2:
        return None
    parts: list[str] = []
    prev = 0
    for pos in eq_positions:
        parts.append(latex[prev:pos].strip())
        prev = pos + 1
    parts.append(latex[prev:].strip())
    if all(parts):
        return parts
    return None


def _split_on_single_equals(latex: str) -> tuple[str, str] | None:
    r"""Split on ``=`` at depth 0.  Returns ``(lhs, rhs)`` or ``None``."""
    d = 0
    for i, ch in enumerate(latex):
        if ch in "{([":
            d += 1
        elif ch in "})]" and d > 0:
            d -= 1
        elif ch == "=" and d == 0:
            lhs = latex[:i].strip()
            rhs = latex[i + 1:].strip()
            if lhs and rhs:
                return lhs, rhs
            return None
    return None


# ---------------------------------------------------------------------------
# SemanticGraphBuilder — SymPy AST walker
# ---------------------------------------------------------------------------

# Matches ``\oint`` or ``\int`` commands in LaTeX — used to tag each
# Integral node as closed or open based on left-to-right position.
_INTEGRAL_CMD_RE: re.Pattern[str] = re.compile(r"\\(oint|int)\b")


class SemanticGraphBuilder:
    """Walks a SymPy expression tree and emits nodes + edges."""

    def __init__(
        self,
        overrides: dict[str, dict[str, str]] | None = None,
        latex_commands: dict[str, str] | None = None,
        original_latex: str | None = None,
        bare_sum_indices: set[str] | None = None,
        conditional_bar_funcs: set[str] | None = None,
        assertion_funcs: dict[str, list[str]] | None = None,
    ) -> None:
        self.nodes: list[dict[str, str]] = []
        self.edges: list[dict[str, str]] = []
        self._id_counter = 0
        self._seen_symbols: dict[str, str] = {}
        # Named constants (π, e, i, ∞) are shared like symbols: a single node
        # per constant, reused on every occurrence.  Keyed by the SymPy
        # constant object so repeat appearances (e.g. the implicit ``e`` base
        # of two natural logs) collapse onto one node instead of duplicating.
        self._seen_constants: dict[Any, str] = {}
        self._overrides = overrides or {}
        self._latex_commands = latex_commands or {}
        self._original_latex = original_latex or ""
        self._bare_sum_indices: set[str] = bare_sum_indices or set()
        self._conditional_bar_funcs: set[str] = conditional_bar_funcs or set()
        self._assertion_funcs: dict[str, list[str]] = assertion_funcs or {}
        self._symbol_order = self._build_symbol_order()
        # Per-integral closed-integral flags: scan the *original* LaTeX for
        # \oint vs \int in left-to-right order so each Integral node can be
        # tagged independently (avoids the old global-boolean bug that
        # marked *all* integrals as closed when *any* \oint appeared).
        self._integral_closed_flags: list[bool] = [
            m.group(1) == "oint"
            for m in _INTEGRAL_CMD_RE.finditer(self._original_latex)
        ]
        self._integral_walk_idx: int = 0

    @staticmethod
    def _fmt_number(expr: sympy.Basic) -> str:
        if isinstance(expr, sympy.Float):
            return sympy.latex(expr)
        return str(expr)

    def _next_id(self, prefix: str = "n") -> str:
        # Slug the prefix so function nodes keyed on a LaTeX-bearing name
        # (``a_{D}`` → ``__a_D_2``) stay clean. Operator prefixes
        # (``multiply``, ``equals``) are already clean and pass through.
        self._id_counter += 1
        return f"__{_slug_id(prefix)}_{self._id_counter}"

    def _add_node(self, node_id: str, **attrs: str) -> None:
        node: dict[str, str] = {"id": node_id}
        node.update(attrs)
        self.nodes.append(node)

    def _add_edge(
        self,
        src: str,
        dst: str,
        *,
        semantic: str | None = None,
        weight: float | None = None,
        role: str | None = None,
    ) -> None:
        edge: dict[str, Any] = {"from": src, "to": dst}
        if semantic:
            edge["semantic"] = semantic
        if weight is not None:
            edge["weight"] = weight
        if role:
            edge["role"] = role
        self.edges.append(edge)

    def _resolve_placeholders(self, s: str | None) -> str | None:
        """Substitute any ``Xi_{N}`` / ``Theta_{N}`` / ``Phi_{N}`` placeholder
        token in *s* with its override's display latex.

        Multi-char subscripts, ``\\text{…}`` groups and compound identifiers are
        collapsed into placeholder symbols before SymPy parsing; a *standalone*
        placeholder (``v_{rms}`` → ``Xi_{0}``) gets its latex restored straight
        from the override, but a *composed* one (``V_{\\text{exit}}`` →
        ``V_{Xi_{0}}``) would otherwise leak the raw ``Xi_{0}`` into the display.
        Iterates to a fixed point so nested placeholders fully unfold.
        """
        if not s or not self._overrides:
            return s
        for _ in range(12):  # bounded; placeholders nest at most a few deep
            changed = False
            for ph, ovr in self._overrides.items():
                # ONLY the synthetic collapse sentinels (``Xi_{N}`` / ``Theta_{N}``
                # / ``Phi_{N}``) are safe to substitute. User/symbol overrides
                # (e.g. ``{"m": {"label": "mass"}}``) must never bleed into other
                # symbols' display — see test_user_override_does_not_corrupt_text_macros.
                if not _PLACEHOLDER_KEY_RE.match(ph):
                    continue
                if ph in s:
                    repl = ovr.get("latex") or ovr.get("label") or ""
                    if repl and repl != ph:
                        s = s.replace(ph, repl)
                        changed = True
            if not changed:
                break
        return s

    def _mint_symbol_id(self, name: str) -> str:
        """Mint a clean, collision-free node id for a symbol.

        Derived by slugging the sympy *name* (with placeholder tokens resolved,
        so ``V_{Xi_{0}}`` → ``V_exit`` and ``Xi_{0}`` → ``v_rms``). The name —
        not the display latex — is the right source: it already has font
        commands stripped (``\\mathbb{R}`` parses to name ``R``), so the id
        stays ``R`` instead of ``mathbbR``. A numeric suffix is appended if the
        slug already names a different node in this graph, so two distinct
        symbols never merge. Display never uses the id, so a suffix is purely
        cosmetic.
        """
        base = _slug_id(self._resolve_placeholders(name) or name)
        if base == "sym":
            base = _slug_id(name)
        existing = {n["id"] for n in self.nodes}
        if base not in existing:
            return base
        i = 2
        while f"{base}_{i}" in existing:
            i += 1
        return f"{base}_{i}"

    def _fresh_diff_id(self, var_id: str) -> str:
        """Mint the id for an integral differential node from its variable id.

        The natural id is ``d`` + ``var_id`` (``dv`` for variable ``v``) — the
        SAME id a *loose* differential symbol parses to (``\\,dv`` → id ``dv``),
        so the integral's differential morphs to/from a non-integral state for
        free. A numeric suffix is appended only on the pathological collision of
        two same-variable integrals in one graph (``∫f dx = ∫g dx``), where node
        ids must still be unique; that case loses the loose-symbol morph but stays
        a valid graph.
        """
        base = f"d{var_id}"
        existing = {n["id"] for n in self.nodes}
        if base not in existing:
            return base
        i = 2
        while f"{base}_{i}" in existing:
            i += 1
        return f"{base}_{i}"

    def _fix_bar_subexpr(self, subexpr: str) -> str:
        """Restore ``|`` conditional bars and ``=`` assertion equals
        in *subexpr* if needed."""
        if self._conditional_bar_funcs:
            subexpr = _restore_all_conditional_bars(
                subexpr, self._conditional_bar_funcs)
        if self._assertion_funcs:
            subexpr = _restore_all_assertion_ops(
                subexpr, self._assertion_funcs)
        return subexpr

    def build(self, expr: sympy.Basic, original_latex: str | None = None) -> dict:
        """Build the graph from *expr* and return ``{nodes, edges}``."""
        root_id = self._walk(expr)
        if original_latex:
            subexpr = self._fix_bar_subexpr(original_latex.strip())
            for node in self.nodes:
                if node["id"] == root_id:
                    # Skip infix-operator root nodes (``f \circ g``, ``A \cap B``):
                    # the walker already built their subexpr from the original
                    # ``\circ``/``\cap`` notation, whereas ``original_latex`` here
                    # is the placeholder-rewritten form (``\Xi_{900}(f, g)``) that
                    # would leak into the tooltip.
                    if node.get("_xi_idx") is None:
                        node["subexpr"] = subexpr
                    break
        self._cleanup_infix_subexprs()
        return {"nodes": self.nodes, "edges": self._dedupe_edges()}

    def _dedupe_edges(self) -> list[dict[str, Any]]:
        """Drop duplicate METADATA edges, preserving order and operand arity.

        A repeated ``from→to`` pair means two different things depending on the
        edge, and conflating them loses math:

        * **Metadata edges** (those carrying a ``role`` — ``wrt`` and friends):
          a repeat is pure redundancy, and can double up adjacency entries in
          some consumers. Dropped.
        * **Operand edges** (role-less): multiplicity IS the arity. ``a \\cdot
          a`` has two operand edges from ``a``, and collapsing them to one makes
          the node render — and convert to sympy — as plain ``a``.

        That second case was a silent, arity-losing bug: a step written ``a
        \\cdot a`` re-rendered as ``a``, and because ``graph_to_sympy`` reads the
        same graph, its confidence badge graded the wrong expression. Hence the
        ``role`` guard below — dedupe only where duplication is genuinely
        redundant. See ``tests/backend/semantic_graph/test_repeated_operands.py``.

        The key stays the full attribute tuple so genuinely distinct edges
        (different ``role``/``semantic``) between the same pair are always kept.
        """
        seen: set[tuple] = set()
        deduped: list[dict[str, Any]] = []
        for edge in self.edges:
            key = (
                edge.get("from"), edge.get("to"),
                edge.get("role"), edge.get("semantic"),
            )
            if key in seen and edge.get("role"):
                continue
            seen.add(key)
            deduped.append(edge)
        return deduped

    # ------------------------------------------------------------------
    # Xi placeholder cleanup
    # ------------------------------------------------------------------

    # Matches the *header* of a Xi placeholder call — everything up to
    # the opening paren.  The two forms are:
    #   SymPy-generated:  ``\operatorname{Xi}_{900}{\left(``
    #                  or ``\operatorname{Xi}_{900}^{c}{\left(``
    #   Original-latex:   ``\Xi_{900}(``
    _XI_HEADER_RE = re.compile(
        r"\\(?:operatorname\{)?Xi(?:\})?_\{(\d+)\}"
        r"(\^(?:\{[^{}]*\}|[a-zA-Z0-9]))?"       # optional exponent (captured)
        r"\{?\\left\("
        r"|"
        r"\\Xi_\{(\d+)\}\s*\("
    )

    def _cleanup_infix_subexprs(self) -> None:
        r"""Replace ``\Xi_{N}(…)`` remnants in ancestor subexprs.

        SymPy's ``latex()`` renders infix placeholders as
        ``\operatorname{Xi}_{900}{\left(A,B \right)}`` or as
        ``\Xi_{900}(A, B)`` in the raw original-latex string.  This
        pass replaces those fragments with the actual subexpr of the
        corresponding infix operator node (e.g. ``A \cap B``).
        """
        if not self._overrides:
            return
        # Build mapping: Xi index → infix node subexpr.
        # Prefer the _xi_idx stored on the node (set in _walk when the
        # Xi placeholder is resolved) so that duplicate ops (e.g. two
        # ``union`` nodes) each map to their own subexpr.
        infix_subexprs: dict[int, str] = {}
        # First pass: nodes with explicit _xi_idx (preferred).
        seen_idxs: set[int] = set()
        for nd in self.nodes:
            xi_idx = nd.get("_xi_idx")
            if xi_idx is not None and nd.get("subexpr"):
                infix_subexprs[xi_idx] = nd["subexpr"]
                seen_idxs.add(xi_idx)
        # Fallback: match by op for nodes without _xi_idx (legacy).
        for name, ovr in self._overrides.items():
            if "op" not in ovr or "type" not in ovr:
                continue
            m = _PLACEHOLDER_NAME_RE.fullmatch(name)
            if not m:
                continue
            idx = int(name.split("{")[1].rstrip("}"))
            if idx in seen_idxs:
                continue  # already resolved via _xi_idx
            for nd in self.nodes:
                if nd.get("op") == ovr["op"] and nd.get("subexpr"):
                    infix_subexprs[idx] = nd["subexpr"]
                    break
        if not infix_subexprs:
            return

        def _replace_xi_calls(s: str) -> str:
            """Scan *s* and replace each Xi placeholder call with its subexpr."""
            result: list[str] = []
            pos = 0
            while pos < len(s):
                m = self._XI_HEADER_RE.search(s, pos)
                if not m:
                    result.append(s[pos:])
                    break
                result.append(s[pos:m.start()])
                # Groups: (1)=sympy idx, (2)=optional exponent, (3)=original idx
                idx = int(m.group(1) or m.group(3))
                exponent = m.group(2) or ""  # e.g. "^{c}"
                replacement = infix_subexprs.get(idx)
                if replacement is None:
                    # Unknown Xi — keep original
                    result.append(m.group(0))
                    pos = m.end()
                    continue
                # Find matching close: scan for balanced parens
                is_sympy = m.group(1) is not None  # \left( … \right) form
                depth = 1
                i = m.end()
                while i < len(s) and depth > 0:
                    if is_sympy:
                        if s[i:].startswith(r"\left("):
                            depth += 1
                            i += 6
                            continue
                        if s[i:].startswith(r"\right)"):
                            depth -= 1
                            if depth == 0:
                                i += 7  # skip past \right)
                                # Also skip trailing ``}`` if present
                                if i < len(s) and s[i] == "}":
                                    i += 1
                                break
                            i += 7
                            continue
                    else:
                        if s[i] == "(":
                            depth += 1
                        elif s[i] == ")":
                            depth -= 1
                            if depth == 0:
                                i += 1
                                break
                    i += 1
                # Wrap in parens if an exponent is present so it
                # applies to the full group: ``(A \cup B)^{c}``
                if exponent:
                    result.append(f"({replacement}){exponent}")
                else:
                    result.append(replacement)
                pos = i
            return "".join(result)

        for nd in self.nodes:
            sub = nd.get("subexpr")
            if not sub or "Xi" not in sub:
                continue
            nd["subexpr"] = _replace_xi_calls(sub)

        # Strip internal _xi_idx field — it was only needed for mapping.
        for nd in self.nodes:
            nd.pop("_xi_idx", None)

    def _build_symbol_order(self) -> dict[str, int]:
        if not self._original_latex:
            return {}
        order: dict[str, int] = {}
        candidates: set[str] = set()
        for ch in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ":
            candidates.add(ch)
        candidates |= set(KNOWN_VARIABLES.keys())
        candidates |= set(self._latex_commands.keys())
        if self._overrides:
            candidates |= set(self._overrides.keys())
        for name in candidates:
            latex_cmd = self._latex_commands.get(name, "")
            for token in (latex_cmd, name):
                if token:
                    pos = self._original_latex.find(token)
                    if pos >= 0:
                        order[name] = pos
                        break
        return order

    def _original_position(self, sym_name: str) -> int:
        return self._symbol_order.get(sym_name, len(self._original_latex))

    def _symbol_latex(self, name: str) -> str | None:
        if name in self._latex_commands:
            return self._latex_commands[name]
        if "_" in name:
            base = name.split("_")[0]
            if base in self._latex_commands:
                return self._latex_commands[base] + name[len(base):]
        if (
            len(name) > 1
            and name[0] == "d"
            and name[1:] in self._latex_commands
        ):
            return r"\mathrm{d}" + self._latex_commands[name[1:]]
        return None

    def _is_partial_derivative(self, expr) -> bool:
        if not self._original_latex:
            return False
        for v, _ in expr.variable_count:
            v_name = str(v)
            if re.search(rf"\\partial\s*\\?\{{?{re.escape(v_name)}\b", self._original_latex):
                return True
        return False

    def _subexpr_ordered(self, expr: sympy.Basic) -> str:
        """Like ``sympy.latex(expr)`` but with terms in authorial order."""
        if isinstance(expr, Symbol):
            name = expr.name
            if name in self._overrides and self._overrides[name].get("latex"):
                if name.startswith("Theta_{") or name.startswith("Xi_{"):
                    return self._overrides[name]["latex"]
            sym_latex = self._symbol_latex(name)
            if sym_latex is not None:
                return sym_latex
        if not self._original_latex:
            return sympy.latex(expr)

        if isinstance(expr, Mul):
            if expr.args and expr.args[0] == sympy.S.NegativeOne:
                rest = expr.args[1:]
                if len(rest) == 1:
                    sub = rest[0]
                    s = self._subexpr_ordered(sub)
                    if isinstance(sub, Add):
                        s = rf"\left({s}\right)"
                    return "-" + s
                # Same evaluate=False as the negation walker: a plain
                # ``Mul(*rest)`` re-multiplies the factors and tears fraction
                # structure apart (``1/(4a^2)`` → ``(1/4)·a^{-2}``), so the
                # displayed subexpr would not match the preserved graph shape.
                inner = Mul(*rest, evaluate=False)
                return "-" + self._subexpr_ordered(inner)
            factors = list(expr.args)
            factors.sort(key=lambda f: self._original_position(
                str(f.args[0]) if isinstance(f, Pow) else str(f)
            ))
            parts = []
            for f in factors:
                s = self._subexpr_ordered(f)
                if isinstance(f, Add):
                    s = rf"\left({s}\right)"
                parts.append(s)
            if self._original_latex:
                for i, f in enumerate(factors):
                    if not (isinstance(f, Symbol) and f.name == "nabla"):
                        continue
                    if i + 1 >= len(factors):
                        break
                    companion = str(factors[i + 1])
                    cross_pat = rf"\\nabla\s*\\times\s*\\?{re.escape(companion)}\b"
                    dot_pat = rf"\\nabla\s*\\cdot\s*\\?{re.escape(companion)}\b"
                    if re.search(cross_pat, self._original_latex):
                        parts[i] = parts[i] + r" \times"
                    elif re.search(dot_pat, self._original_latex):
                        parts[i] = parts[i] + r" \cdot"
                    break
            return " ".join(parts)

        if isinstance(expr, Add):
            terms = list(expr.as_ordered_terms())
            terms.sort(key=lambda t: self._original_position(
                str(t.args[0]) if isinstance(t, (Mul, Pow)) else str(t)
            ))
            parts = []
            for i, t in enumerate(terms):
                s = self._subexpr_ordered(t)
                if i > 0 and not s.startswith("-"):
                    s = "+ " + s
                elif i > 0:
                    s = "- " + s[1:].lstrip()
                parts.append(s)
            return " ".join(parts)

        if isinstance(expr, Derivative) and self._is_partial_derivative(expr):
            func_latex = self._subexpr_ordered(expr.expr)
            var_parts = []
            for v, count in expr.variable_count:
                v_latex = self._subexpr_ordered(v)
                if int(count) > 1:
                    var_parts.append(rf"\partial {v_latex}^{{{int(count)}}}")
                else:
                    var_parts.append(rf"\partial {v_latex}")
            total_order = sum(int(c) for _, c in expr.variable_count)
            num = rf"\partial^{{{total_order}}} {func_latex}" if total_order > 1 else rf"\partial {func_latex}"
            den = " ".join(var_parts)
            return rf"\frac{{{num}}}{{{den}}}"

        # Build a symbol->latex map so compound expressions (e.g. ``Pow``
        # like ``dOmega**2``) keep the original command-based rendering
        # (``\mathrm{d}\Omega``) instead of leaking the raw symbol name.
        symbol_names: dict[Symbol, str] = {}
        for sym in expr.free_symbols:
            if not isinstance(sym, Symbol):
                continue
            sym_latex = self._symbol_latex(sym.name)
            if sym_latex is not None:
                symbol_names[sym] = sym_latex
        if symbol_names:
            result = self._restore_placeholders(
                sympy.latex(expr, symbol_names=symbol_names))
        else:
            result = self._restore_placeholders(sympy.latex(expr))

        # SymPy always renders natural log as ``\log``; restore the
        # original ``\ln`` notation when the input LaTeX used it.
        if "ln" in self._latex_commands:
            result = result.replace(r"\log", r"\ln")

        # Strip synthetic dummy bounds injected for bare \sum / \prod.
        for dummy in LaTeXPreprocessor.BARE_SUM_DUMMIES:
            result = re.sub(
                rf"_\{{\\{dummy}=0\}}\^\{{\\infty\}}\s*",
                " ",
                result,
            )

        # Strip synthetic bounds from visible bare-sum indices (``\sum_n``
        # → SymPy ``\sum_{n=0}^{\infty}``): keep the index subscript but
        # drop the injected ``=0`` lower / ``\infty`` upper bounds so the
        # rendered source matches the original ``\sum_n`` notation.
        for idx in self._bare_sum_indices:
            if idx in LaTeXPreprocessor.BARE_SUM_DUMMIES:
                continue
            result = re.sub(
                rf"_\{{{re.escape(idx)}=0\}}\^\{{\\infty\}}",
                rf"_{{{idx}}}",
                result,
            )

        # SymPy renders ``\neg(X)`` as ``\operatorname{neg}{\left(X \right)}``.
        # Same for ``\forall(X)`` and ``\exists(X)``.
        # Restore the compact ``\cmd X`` form.
        for _pfx_cmd, _pfx_latex in (
            ("neg", r"\\neg"),
            ("forall", r"\\forall"),
            ("exists", r"\\exists"),
        ):
            result = re.sub(
                rf"\\operatorname\{{{_pfx_cmd}\}}\{{\\left\(([^)]*?)\\right\)\}}",
                _pfx_latex + r" \1",
                result,
            )

        # Restore conditional bars in any function calls that had them.
        # SymPy renders P(A, B) but we want P(A \mid B).  This applies
        # to the entire subexpr string, so composite expressions like
        # ``P(B, A) P(A)`` are also fixed.
        if self._conditional_bar_funcs:
            result = _restore_all_conditional_bars(
                result, self._conditional_bar_funcs)

        # Restore assertion equals in any function calls that had them.
        # SymPy renders P(X, k) but we want P(X = k).
        if self._assertion_funcs:
            result = _restore_all_assertion_ops(
                result, self._assertion_funcs)

        return result

    def _restore_placeholders(self, latex: str) -> str:
        if not self._overrides:
            return latex
        # --- Concentration placeholders first ---
        # SymPy renders ``Xi_{N}(A)`` as ``\operatorname{Xi}_{N}{\left(A
        # \right)}`` (and ``Xi_{N}(A)**2`` as ``\operatorname{Xi}_{N}^{2}{
        # \left(A \right)}``).  Replace the whole function-application form
        # with the original ``[…]`` notation, hoisting any power that SymPy
        # tucked between the name and the argument back to the outside.
        for name, attrs in self._overrides.items():
            if not attrs.get("concentration"):
                continue
            m_c = re.match(r"(Xi|Theta|Phi)_\{(\d+)\}", name)
            if not m_c:
                continue
            orig = (attrs.get("original_latex")
                    or attrs.get("latex") or "").strip()
            base, idx = m_c.group(1), m_c.group(2)
            pat = re.compile(
                rf"\\operatorname\{{{base}}}_\{{{idx}}}"
                rf"(\^\{{[^{{}}]*}})?"
                rf"\{{\\left\(.*?\\right\)}}"
            )
            latex = pat.sub(lambda mm: orig + (mm.group(1) or ""), latex)
            # Bare-token fallbacks (no rendered args).
            latex = latex.replace(rf"\{name}", orig)
            latex = latex.replace(name, orig)
        for name, attrs in self._overrides.items():
            if not _PLACEHOLDER_NAME_RE.fullmatch(name):
                continue
            if attrs.get("concentration"):
                continue
            real = attrs.get("original_latex") or attrs.get("latex")
            if not real:
                continue
            stripped = real.strip()
            if (
                re.search(r"\s", real)
                and not (
                    (stripped.startswith("{") and stripped.endswith("}"))
                    or (stripped.startswith("(") and stripped.endswith(")"))
                )
            ):
                replacement = "{" + real + "}"
            else:
                replacement = real
            latex = latex.replace("\\" + name, replacement)
            # SymPy renders Function('Xi_{0}') as \operatorname{Xi}_{0} —
            # the base and subscript are split across LaTeX groups.
            # Build that form so subexpr fields get cleaned up too.
            m_ph = re.match(r"(Xi|Theta|Phi)_\{(\d+)\}", name)
            if m_ph:
                opname_form = rf"\operatorname{{{m_ph.group(1)}}}_{{{m_ph.group(2)}}}"
                latex = latex.replace(opname_form, replacement)
            latex = latex.replace(name, replacement)
        return latex

    def _set_subexpr(self, node_id: str, expr: sympy.Basic) -> None:
        for node in self.nodes:
            if node["id"] == node_id and "subexpr" not in node:
                subexpr = self._subexpr_ordered(expr)
                # Restore conditional bar: P(A, B) → P(A \mid B)
                if (isinstance(expr, sympy.Function)
                        and type(expr).__name__ in self._conditional_bar_funcs
                        and len(expr.args) >= 2):
                    subexpr = _restore_conditional_bar_in_subexpr(subexpr)
                node["subexpr"] = subexpr
                break

    def _walk(self, expr: sympy.Basic) -> str:
        node_id = self._walk_inner(expr)
        self._set_subexpr(node_id, expr)
        return node_id

    def _walk_inner(self, expr: sympy.Basic) -> str:  # noqa: C901
        """Recursively walk *expr*, returning the node id."""

        # --- Symbols ---
        if isinstance(expr, Symbol):
            name = expr.name
            if name in self._seen_symbols:
                return self._seen_symbols[name]
            meta = KNOWN_VARIABLES.get(name, {})
            latex_fallback = self._symbol_latex(name) or name
            attrs: dict[str, Any] = {
                "type": meta.get("type", "scalar"),
                "latex": meta.get("latex", latex_fallback),
            }
            if name in self._overrides:
                _INTERNAL_OVERRIDE_KEYS = {
                    "bra_content", "ket_content", "original_latex",
                    "latex_cmd", "concentration",
                }
                attrs.update({
                    k: v for k, v in self._overrides[name].items()
                    if k not in _INTERNAL_OVERRIDE_KEYS
                })
            if (
                "subexpr" not in attrs
                and name in self._overrides
                and self._overrides[name].get("latex")
                and (name.startswith("Theta_{") or name.startswith("Xi_{"))
            ):
                attrs["subexpr"] = self._overrides[name]["latex"]
            # The sympy name carries placeholder tokens for collapsed
            # sub-expressions (``Xi_{0}`` for ``\text{exit}`` etc.). Resolve
            # them in the display fields so a composed symbol like
            # ``V_{Xi_{0}}`` renders as ``V_{\text{exit}}`` instead of leaking
            # the placeholder, then mint a clean id from the resolved form.
            # The id is an internal wiring key only — never a display string.
            attrs["latex"] = self._resolve_placeholders(attrs.get("latex"))
            if attrs.get("subexpr"):
                attrs["subexpr"] = self._resolve_placeholders(attrs["subexpr"])
            node_id = self._mint_symbol_id(name)
            self._add_node(node_id, **attrs)
            self._seen_symbols[name] = node_id

            if (
                name.startswith("Phi_{")
                and name in self._overrides
                and self._overrides[name].get("op") == "inner_product"
            ):
                ovr = self._overrides[name]
                for n in self.nodes:
                    if n["id"] == node_id:
                        n["subexpr"] = ovr.get("original_latex", ovr["latex"])
                        break
                for part_key, edge_role in (
                    ("bra_content", "lhs"),
                    ("ket_content", "rhs"),
                ):
                    content = ovr.get(part_key, "").strip()
                    if not content or _is_braket_constant_side(content):
                        continue
                    try:
                        inner_expr = parse_latex(content)
                        child_id = self._walk(inner_expr)
                        self._add_edge(child_id, node_id, role=edge_role)
                    except Exception:
                        pass

            return node_id

        # --- Constants ---
        for const, meta in CONSTANT_MAP.items():
            if expr is const:
                # Share one node per named constant (like symbols), so e.g.
                # the implicit ``e`` base of two natural logs collapses onto a
                # single node instead of being duplicated.
                if const in self._seen_constants:
                    return self._seen_constants[const]
                node_id = self._next_id("const")
                attrs: dict[str, Any] = {"type": "constant"}
                if meta.get("label"):
                    attrs["label"] = meta["label"]
                if meta.get("latex"):
                    attrs["latex"] = meta["latex"]
                self._add_node(node_id, **attrs)
                self._seen_constants[const] = node_id
                return node_id

        # --- Boolean literals (S.true / S.false) ---
        # SymPy collapses tautologies like Eq(x,x) to BooleanTrue.
        # Emit as a constant node, not an expression with op="BooleanTrue".
        if expr is S.true or expr is S.false:
            node_id = self._next_id("const")
            label = "true" if expr is S.true else "false"
            self._add_node(node_id, type="constant", label=label)
            return node_id

        # --- Numbers ---
        if isinstance(expr, Number):
            node_id = self._next_id("num")
            self._add_node(node_id, label=self._fmt_number(expr), type="number")
            return node_id

        # --- Factorial (unary operator, not a function) ---
        if isinstance(expr, factorial):
            node_id = self._next_id("factorial")
            self._add_node(node_id, type="operator", op="factorial")
            child_id = self._walk(expr.args[0])
            self._add_edge(child_id, node_id)
            return node_id

        # --- Functions ---
        # Map SymPy class names to canonical operation names where they differ.
        _FUNC_OP_MAP: dict[str, str] = {
            "binomial": "choose",  # C(n,k) — "choose", not "binomial"
            "Abs": "abs",          # normalize SymPy's uppercase class name
        }

        if isinstance(expr, sympy.Function):
            func_name = type(expr).__name__
            op_name = _FUNC_OP_MAP.get(func_name, func_name)
            # --- Concentration placeholder (chemistry ``[A]``) ---
            # ``\Xi_{N}(species)`` injected by _collapse_concentration_brackets
            # becomes a dedicated unary ``concentration`` operator node fed by
            # the species.  The subexpr is the original ``[…]`` form so the
            # placeholder never leaks into display.
            if (
                _PLACEHOLDER_NAME_RE.fullmatch(func_name)
                and func_name in self._overrides
                and self._overrides[func_name].get("concentration")
            ):
                ovr = self._overrides[func_name]
                node_id = self._next_id("concentration")
                self._add_node(
                    node_id, type="operator", op="concentration",
                    # Use ``\thinspace`` (backslash-letters) rather than ``\,``
                    # (backslash-punct): Mermaid's string parser strips a
                    # backslash before punctuation, mangling ``\,`` → ``,`` and
                    # turning the thin spaces into literal commas in KaTeX.
                    # ``\thinspace`` survives Mermaid and renders identically to
                    # ``\,`` in both the D3 and Mermaid KaTeX passes.
                    latex=r"[\thinspace\cdot\thinspace]",
                    subexpr=ovr.get("original_latex", ovr.get("latex", "")),
                )
                if expr.args:
                    child_id = self._walk(expr.args[0])
                    self._add_edge(child_id, node_id)
                return node_id
            # Resolve Xi_{N} placeholders used as functions.
            if _PLACEHOLDER_NAME_RE.fullmatch(func_name) and func_name in self._overrides:
                ovr = self._overrides[func_name]
                # --- Infix operator placeholder (e.g. \cap → Xi_{900}) ---
                # These carry an "op" key from _INFIX_OP_BY_CMD; emit an
                # operator node instead of a function node.
                if "op" in ovr and "type" in ovr:
                    infix_op = ovr["op"]
                    infix_emoji = ovr.get("emoji", "")
                    infix_latex = ovr.get("latex_cmd", "")
                    node_id = self._next_id(infix_op)
                    # Walk children and add edges.
                    child_ids: list[str] = []
                    for arg in expr.args:
                        child_id = self._walk(arg)
                        child_ids.append(child_id)
                        self._add_edge(child_id, node_id)
                    # Build subexpr: "LHS \cap RHS"
                    child_subexprs = []
                    for cid in child_ids:
                        for nd in self.nodes:
                            if nd["id"] == cid:
                                child_subexprs.append(
                                    nd.get("subexpr", cid))
                                break
                    subexpr = f" {infix_latex} ".join(child_subexprs)
                    # Extract Xi index so _cleanup_infix_subexprs can
                    # match this node directly (not by op name).
                    xi_idx = int(func_name.split("{")[1].rstrip("}"))
                    self._add_node(
                        node_id, type=ovr["type"], op=infix_op,
                        emoji=infix_emoji, subexpr=subexpr,
                        _xi_idx=xi_idx,
                    )
                    return node_id
                # --- Text-command placeholder (e.g. \text{Res} → Xi_{0}) ---
                op_name = ovr.get("label", op_name)
            func_latex = self._latex_commands.get(func_name)
            if func_latex is None:
                # Composed placeholder in the function name: ``x_{\text{ph}}``
                # is collapsed to ``x_{Xi_{0}}`` before parsing, and only the
                # standalone form is handled above. Without restoration the
                # node has no latex and the renderer falls back to the raw
                # ``Xi`` token — resolve it so the display shows real KaTeX
                # and op/id carry the readable name.
                resolved = self._resolve_placeholders(op_name)
                if resolved and resolved != op_name:
                    func_latex = resolved
                    op_name = re.sub(r"\\text\{([^{}]+)\}", r"\1", resolved)
            node_id = self._next_id(op_name)
            func_attrs: dict[str, str] = {"type": "function", "op": op_name}
            if func_latex:
                func_attrs["latex"] = func_latex
            self._add_node(node_id, **func_attrs)
            # log(arg, base) — mark the base edge with role="base"
            # P(A|B) → P(A, B) — mark the last arg with role="condition"
            # P(X=k) → P(X, k) — build inner relation node for the assertion
            is_log = isinstance(expr, log)
            has_cond_bar = (op_name in self._conditional_bar_funcs
                           and len(expr.args) >= 2)
            orig_ops = self._assertion_funcs.get(op_name)
            has_assertion = (orig_ops is not None
                            and len(expr.args) >= 2
                            and len(orig_ops) == len(expr.args) - 1)

            if has_assertion and len(orig_ops) == 1:
                # Single-op assertion: P(X = k) → one relation node.
                orig_op = orig_ops[0]
                meta = _ASSERTION_OP_META.get(
                    orig_op, {"op": "equals", "emoji": "="})
                rel_op = meta["op"]
                rel_emoji = meta["emoji"]
                rel_id = self._next_id(rel_op)
                # Walk all args and connect to the inner relation node
                # with lhs/rhs roles (first arg = lhs, last = rhs).
                child_ids: list[str] = []
                last_idx = len(expr.args) - 1
                for i, arg in enumerate(expr.args):
                    child_id = self._walk(arg)
                    child_ids.append(child_id)
                    if i == 0:
                        edge_role: str | None = "lhs"
                    elif i == last_idx:
                        edge_role = "rhs"
                    else:
                        edge_role = None
                    self._add_edge(child_id, rel_id, role=edge_role)
                # Build subexpr from children: "lhs_subexpr OP rhs_subexpr"
                child_subexprs: list[str] = []
                for cid in child_ids:
                    for nd in self.nodes:
                        if nd["id"] == cid:
                            child_subexprs.append(nd.get("subexpr", cid))
                            break
                rel_subexpr = f" {orig_op} ".join(child_subexprs)
                self._add_node(
                    rel_id, type="relation", op=rel_op,
                    emoji=rel_emoji, subexpr=rel_subexpr,
                )
                # Connect the inner relation to the function.
                self._add_edge(rel_id, node_id, role="assertion")
            elif has_assertion:
                # Chained assertion: P(1 < X ≤ 10) → right-associative
                # chain of relation nodes.  Each consecutive pair of
                # children is joined by its operator, and each new
                # relation node becomes the lhs of the next one.
                child_ids = []
                for arg in expr.args:
                    child_ids.append(self._walk(arg))
                child_subexprs = []
                for cid in child_ids:
                    for nd in self.nodes:
                        if nd["id"] == cid:
                            child_subexprs.append(nd.get("subexpr", cid))
                            break
                prev_id: str = child_ids[0]
                prev_subexpr: str = child_subexprs[0]
                for j, op_latex in enumerate(orig_ops):
                    meta = _ASSERTION_OP_META.get(
                        op_latex, {"op": "equals", "emoji": "="})
                    rel_op = meta["op"]
                    rel_emoji = meta["emoji"]
                    rel_id = self._next_id(rel_op)
                    rhs_child = child_ids[j + 1]
                    rel_subexpr = (
                        f"{prev_subexpr} {op_latex} "
                        f"{child_subexprs[j + 1]}"
                    )
                    self._add_edge(prev_id, rel_id, role="lhs")
                    self._add_edge(rhs_child, rel_id, role="rhs")
                    self._add_node(
                        rel_id, type="relation", op=rel_op,
                        emoji=rel_emoji, subexpr=rel_subexpr,
                    )
                    prev_id = rel_id
                    prev_subexpr = rel_subexpr
                # Connect outermost relation to the function.
                self._add_edge(prev_id, node_id, role="assertion")
            else:
                last_idx = len(expr.args) - 1
                for i, arg in enumerate(expr.args):
                    child_id = self._walk(arg)
                    if is_log and i == 1:
                        edge_role = "base"
                    elif has_cond_bar and i == last_idx:
                        edge_role = "condition"
                    else:
                        edge_role = None
                    self._add_edge(child_id, node_id, role=edge_role)
            return node_id

        # --- Limit ---
        if isinstance(expr, Limit):
            node_id = self._next_id("limit")
            # Limit(expression, variable, point, direction)
            child_id = self._walk(expr.args[0])
            self._add_edge(child_id, node_id)
            var_id = self._walk(expr.args[1])
            point_id = self._walk(expr.args[2])

            # "x → 0" is its own tends_to node: the approach
            # specification that the limit operates on.
            tends_id = self._next_id("tends_to")
            self._add_edge(var_id, tends_id, role="lhs")
            self._add_edge(point_id, tends_id, role="rhs")
            var_latex = self._subexpr_ordered(expr.args[1])
            point_latex = self._subexpr_ordered(expr.args[2])
            tends_attrs: dict[str, str] = {
                "type": "operator", "op": "tends_to",
                "with_respect_to": var_id,
                "limit_point": point_id,
                "subexpr": f"{var_latex} \\to {point_latex}",
            }
            if len(expr.args) > 3:
                direction = str(expr.args[3])
                if direction != "+-":  # omit default (bilateral)
                    tends_attrs["limit_direction"] = direction
            self._add_node(tends_id, **tends_attrs)

            self._add_edge(tends_id, node_id)
            self._add_node(node_id, type="operator", op="limit")
            return node_id

        # --- Derivative ---
        if isinstance(expr, Derivative):
            node_id = self._next_id("deriv")
            op_name = "partial_derivative" if self._is_partial_derivative(expr) else "derivative"
            child_id = self._walk(expr.expr)
            self._add_edge(child_id, node_id)
            wrt_ids: list[str] = []
            for v, _ in expr.variable_count:
                var_id = self._walk(v)
                wrt_ids.append(var_id)
                self._add_edge(var_id, node_id, role="wrt")
            self._add_node(node_id, type="operator", op=op_name,
                           with_respect_to=", ".join(wrt_ids))
            return node_id

        # --- Integral ---
        if isinstance(expr, Integral):
            idx = self._integral_walk_idx
            self._integral_walk_idx += 1
            is_closed = (
                idx < len(self._integral_closed_flags)
                and self._integral_closed_flags[idx]
            )
            op = "closed_integral" if is_closed else "integral"
            node_id = self._next_id(op)
            # The integration variable is modeled as a first-class ``differential``
            # node (``dv`` for ∫…dv) connected to the integral by a ``wrt`` edge —
            # the wrt edge now carries the differential, NOT the bare variable.
            # SymPy absorbs the ``dv``
            # token into ``Integral.limits`` (it never survives as an integrand
            # factor), so we synthesize the differential here from each limit
            # variable. This keeps the integrand variable's node un-shared (it
            # appears only in the integrand, so it keeps a bare id and morphs
            # across the ∫ boundary "for free"), and lets the differential morph
            # to/from a loose ``dv`` symbol since both carry the same ``dv`` id.
            # ``with_respect_to`` is still set on the integral as summary metadata
            # for the semantic views (mermaid / graph panel).
            wrt_ids: list[str] = []
            diff_specs: list[tuple[str, str]] = []   # (diff_id, var_latex)
            lower_nid: str | None = None
            upper_nid: str | None = None
            node_attrs: dict[str, str] = {"type": "operator", "op": op}
            for limit_tuple in expr.limits:
                var = limit_tuple[0]
                var_id = self._seen_symbols.get(var.name) or self._mint_symbol_id(var.name)
                wrt_ids.append(var_id)
                var_latex = self._subexpr_ordered(var)
                diff_specs.append((self._fresh_diff_id(var_id), var_latex))
                if len(limit_tuple) >= 3:
                    lower_nid = self._walk(limit_tuple[1])
                    upper_nid = self._walk(limit_tuple[2])
            node_attrs["with_respect_to"] = ", ".join(wrt_ids)
            if lower_nid is not None:
                node_attrs["lower_bound"] = lower_nid
            if upper_nid is not None:
                node_attrs["upper_bound"] = upper_nid
            self._add_node(node_id, **node_attrs)
            for (diff_id, var_latex), var_id in zip(diff_specs, wrt_ids):
                self._add_node(diff_id, type="differential",
                               latex=f"d{var_latex}", with_respect_to=var_id)
                self._add_edge(diff_id, node_id, role="wrt")
            if lower_nid is not None:
                self._add_edge(lower_nid, node_id, role="lb")
            if upper_nid is not None:
                self._add_edge(upper_nid, node_id, role="ub")
            child_id = self._walk(expr.function)
            self._add_edge(child_id, node_id)
            return node_id

        # --- Sum / Product ---
        if isinstance(expr, (Sum, Product)):
            op_name = "sum" if isinstance(expr, Sum) else "product"
            node_id = self._next_id(op_name)
            wrt_ids: list[str] = []
            lower_nid = None
            upper_nid = None
            node_attrs: dict[str, Any] = {"type": "operator", "op": op_name}
            for limit_tuple in expr.limits:
                idx_name = str(limit_tuple[0])
                # Completely bare ``\sum`` (no subscript at all) gets a
                # dummy index to satisfy SymPy — skip it entirely so the
                # graph doesn't show a meaningless synthetic node.
                if idx_name in LaTeXPreprocessor.BARE_SUM_DUMMIES:
                    continue
                synthetic = idx_name in self._bare_sum_indices
                var_id = self._walk(limit_tuple[0])
                wrt_ids.append(var_id)
                if len(limit_tuple) >= 3:
                    lb_expr = limit_tuple[1]
                    ub_expr = limit_tuple[2]

                    # Check if this index variable had synthetic bounds
                    # injected by the preprocessor for bare ``\sum_i``
                    # notation.  Only suppress bounds when the index is
                    # known-synthetic — explicit ``\sum_{n=0}^{\infty}``
                    # must keep its bound nodes.
                    if synthetic:
                        self._add_edge(var_id, node_id, role="wrt")
                    else:
                        lower_nid = self._walk(lb_expr)
                        upper_nid = self._walk(ub_expr)

                        # Index variable → sum/product with role="wrt"
                        # so downstream renderers always know the index.
                        self._add_edge(var_id, node_id, role="wrt")

                        # Index specification: ``n = 0`` as a symmetric
                        # equals node — no roles (same as any other ``=``).
                        idx_id = self._next_id("equals")
                        var_latex = self._subexpr_ordered(limit_tuple[0])
                        lb_latex = self._subexpr_ordered(lb_expr)
                        self._add_node(
                            idx_id, type="relation", op="equals",
                            subexpr=f"{var_latex} = {lb_latex}",
                        )
                        self._add_edge(var_id, idx_id)
                        self._add_edge(lower_nid, idx_id)
                        self._add_edge(idx_id, node_id, role="lb")

                        # Upper bound feeds directly into the sum/product.
                        self._add_edge(upper_nid, node_id, role="ub")

            if wrt_ids:
                node_attrs["with_respect_to"] = ", ".join(wrt_ids)
            if lower_nid is not None:
                node_attrs["lower_bound"] = lower_nid
            if upper_nid is not None:
                node_attrs["upper_bound"] = upper_nid
            self._add_node(node_id, **node_attrs)
            child_id = self._walk(expr.function)
            self._add_edge(child_id, node_id)

            # For bare sums (all indices were dummies), override the
            # subexpr to strip the synthetic bounds that were only
            # needed for SymPy parsing.
            if not wrt_ids:
                body_subexpr = self._subexpr_ordered(expr.function)
                cmd = r"\sum" if isinstance(expr, Sum) else r"\prod"
                for node in self.nodes:
                    if node["id"] == node_id:
                        node["subexpr"] = rf"{cmd} {body_subexpr}"
                        break

            return node_id

        # --- Power with literal exponent ---
        if isinstance(expr, Pow) and isinstance(expr.args[1], Number):
            exponent = expr.args[1]
            exp_val = self._fmt_number(exponent)
            node_id = self._next_id("power")
            attrs: dict[str, Any] = {"type": "operator", "op": "power", "exponent": exp_val}
            if exponent == -1:
                attrs["latex"] = r"\dfrac{1}{(\cdot)}"
            self._add_node(node_id, **attrs)
            base_id = self._walk(expr.args[0])
            self._add_edge(base_id, node_id)
            return node_id

        # --- Power with symbolic-negative exponent (single factor) ---
        # Only collapse a *single*-factor negated exponent (``-1 * thing``,
        # e.g. ``x^{-n}`` or ``e^{-\lambda}``) into one node so the renderer
        # can paint the base→power edge ``inverse``.  A genuine product like
        # ``-ikx`` (``Mul(-1, i, k, x)``) must instead fall through to the
        # general operator branch so the exponent expands into its own
        # subtree — mirroring the positive ``e^{ikx}`` case.
        if (
            isinstance(expr, Pow)
            and isinstance(expr.args[1], Mul)
            and len(expr.args[1].args) == 2
            and expr.args[1].args[0] == sympy.S.NegativeOne
        ):
            node_id = self._next_id("power")
            # Render the exponent as LaTeX (not str()) so the simple ``-n``
            # case stays clean.
            self._add_node(
                node_id, type="operator", op="power",
                exponent=self._subexpr_ordered(expr.args[1]),
            )
            base_id = self._walk(expr.args[0])
            self._add_edge(base_id, node_id)
            return node_id

        # --- Unary negation ---
        if (
            isinstance(expr, Mul)
            and len(expr.args) >= 2
            and expr.args[0] == sympy.S.NegativeOne
        ):
            rest = expr.args[1:]
            node_id = self._next_id("negation")
            self._add_node(node_id, type="operator", op="negation")
            if len(rest) == 1:
                child_id = self._walk(rest[0])
            else:
                # Rebuild the negated body WITHOUT re-evaluation. A plain
                # ``Mul(*rest)`` lets SymPy re-multiply the factors, which
                # distributes a fraction's denominator constant into a
                # ``Rational`` coefficient — e.g. ``-\frac{4ac}{4a^2}`` turns
                # ``1/(4a^2)`` into ``(1/4)·a^{-2}`` and reforms as
                # ``-4ac·\frac{1/4}{a^2}``. ``evaluate=False`` preserves the
                # original numerator/denominator structure so the term
                # round-trips as ``-\frac{4ac}{4a^2}`` (issue: negated fraction
                # reforming).
                child_id = self._walk(Mul(*rest, evaluate=False))
            self._add_edge(child_id, node_id)
            return node_id

        # --- Binary/n-ary operators ---
        op_name = OPERATOR_MAP.get(type(expr))
        if op_name is not None:
            node_id = self._next_id(op_name)
            node_type = "relation" if is_relation(op_name) else "operator"
            self._add_node(node_id, type=node_type, op=op_name)
            edge_semantic = "direct" if op_name == "multiply" else None
            edge_weight = 1.0 if op_name == "multiply" else None
            asymmetric = is_asymmetric_relation(op_name)
            for i, arg in enumerate(expr.args):
                child_semantic = edge_semantic
                child_weight = edge_weight
                if op_name == "multiply" and _is_inverse_pow(arg):
                    child_semantic = None
                    child_weight = None
                child_id = self._walk(arg)
                if asymmetric:
                    edge_role = "lhs" if i == 0 else "rhs"
                elif op_name == "power" and i == 1:
                    edge_role = "exp"
                else:
                    edge_role = None
                self._add_edge(
                    child_id, node_id,
                    semantic=child_semantic, weight=child_weight, role=edge_role,
                )
            return node_id

        # --- Dirac notation ---
        if isinstance(expr, KetBase):
            label_arg = expr.args[0] if expr.args else ""
            label_latex = sympy.latex(label_arg)
            node_id = self._next_id("ket")
            ket_latex = rf"\left|{label_latex}\right\rangle"
            self._add_node(node_id, type="ket", latex=ket_latex, subexpr=ket_latex)
            return node_id

        if isinstance(expr, BraBase):
            label_arg = expr.args[0] if expr.args else ""
            label_latex = sympy.latex(label_arg)
            node_id = self._next_id("bra")
            bra_latex = rf"\left\langle {label_latex}\right|"
            self._add_node(node_id, type="bra", latex=bra_latex, subexpr=bra_latex)
            return node_id

        if isinstance(expr, InnerProduct):
            node_id = self._next_id("braket")
            bra_arg = expr.args[0]
            ket_arg = expr.args[1]
            bra_label = sympy.latex(bra_arg.args[0]) if bra_arg.args else ""
            ket_label = sympy.latex(ket_arg.args[0]) if ket_arg.args else ""
            skeleton = _braket_skeleton_latex(bra_label, ket_label)
            full_latex = rf"\left\langle {bra_label}\middle|{ket_label}\right\rangle"
            self._add_node(
                node_id, type="operator", op="inner_product",
                latex=skeleton, subexpr=full_latex,
            )
            for inner_arg, edge_role in (
                (bra_arg, "lhs"),
                (ket_arg, "rhs"),
            ):
                if not inner_arg.args:
                    continue
                inner_label = inner_arg.args[0]
                if isinstance(inner_label, Number):
                    continue
                child_id = self._walk(inner_label)
                self._add_edge(child_id, node_id, role=edge_role)
            return node_id

        if isinstance(expr, OuterProduct):
            # ``|ψ⟩⟨φ|`` — render as an operator node (mirroring
            # ``inner_product``) instead of falling through to the generic
            # ``expression`` fallback, which showed the bare class name
            # ``OuterProduct`` in a symbol box.  The ket and bra become
            # ``lhs``/``rhs`` children so the structure reads consistently.
            node_id = self._next_id("outer_product")
            ket_arg = expr.args[0]
            bra_arg = expr.args[1]
            ket_label = sympy.latex(ket_arg.args[0]) if ket_arg.args else ""
            bra_label = sympy.latex(bra_arg.args[0]) if bra_arg.args else ""
            # Render the operator glyph as ``\otimes`` (× in a circle) — the
            # conventional outer/tensor-product symbol.  It's distinct from
            # ``multiply``'s bare ``×`` and far more compact than the bra-ket
            # skeleton, while the full ``|ψ⟩⟨φ|`` stays in ``subexpr``.
            glyph = r"\otimes"
            full_latex = (
                rf"\left|{ket_label}\right\rangle"
                rf"\left\langle {bra_label}\right|"
            )
            self._add_node(
                node_id, type="operator", op="outer_product",
                latex=glyph, subexpr=full_latex,
            )
            ket_id = self._walk(ket_arg)
            self._add_edge(ket_id, node_id, role="lhs")
            bra_id = self._walk(bra_arg)
            self._add_edge(bra_id, node_id, role="rhs")
            return node_id

        # --- Fallback ---
        node_id = self._next_id("expr")
        self._add_node(node_id, type="expression", op=type(expr).__name__)
        for arg in expr.args:
            child_id = self._walk(arg)
            self._add_edge(child_id, node_id)
        return node_id


# ---------------------------------------------------------------------------
# Graph assembly
# ---------------------------------------------------------------------------

_PMOD_RE = re.compile(
    r"\\pmod\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*$"
)


def _extract_pmod(rhs_latex: str) -> tuple[str, str | None]:
    r"""Strip a trailing ``\pmod{…}`` from *rhs_latex*.

    Returns ``(cleaned_rhs, modulus_latex)`` where *modulus_latex* is
    ``None`` when no ``\pmod`` was found.
    """
    m = _PMOD_RE.search(rhs_latex)
    if m is None:
        return rhs_latex, None
    modulus = m.group(1).strip()
    cleaned = rhs_latex[:m.start()].strip()
    return cleaned, modulus


def _build_relation_graph(
    lhs_latex: str,
    rel_meta: dict[str, str],
    rhs_latex: str,
    original_latex: str,
    *,
    overrides: dict[str, dict[str, str]] | None,
    latex_commands: dict[str, str] | None = None,
    parenthetical_annotations: list | None = None,
    domain: str | None = None,
    bare_sum_indices: set[str] | None = None,
    conditional_bar_funcs: set[str] | None = None,
    assertion_funcs: dict[str, list[str]] | None = None,

) -> dict:
    r"""Build a graph for a binary relation ``lhs <op> rhs``."""

    # --- Handle \pmod annotation ---
    # For congruent relations, \pmod becomes a modulus attribute + edge.
    # For other relations (equals, etc.), \pmod becomes an annotation node.
    modulus_latex: str | None = None
    rhs_latex, modulus_latex = _extract_pmod(rhs_latex)

    builder = SemanticGraphBuilder(
        overrides=overrides,
        latex_commands=latex_commands or {},
        original_latex=original_latex,
        bare_sum_indices=bare_sum_indices,
        conditional_bar_funcs=conditional_bar_funcs,
        assertion_funcs=assertion_funcs,
    )

    def _walk_relation_side(side_latex: str) -> tuple[str, sympy.Basic | None]:
        side_clauses = _split_on_top_level_comma(side_latex)
        if len(side_clauses) <= 1:
            expr = parse_latex(side_latex)
            return builder._walk(expr), expr

        clause_roots: list[str] = []
        for clause in side_clauses:
            cleaned = _LEADING_SPACE_CMD_RE.sub("", clause).strip()
            sub_expr = parse_latex(cleaned)
            cid = builder._walk(sub_expr)
            for node in builder.nodes:
                if node["id"] == cid:
                    node["subexpr"] = builder._restore_placeholders(cleaned)
                    break
            clause_roots.append(cid)
        conj_id = builder._next_id("and")
        builder._add_node(
            conj_id, type="operator", op="and", label="and", emoji=",",
            subexpr=builder._restore_placeholders(side_latex.strip()),
        )
        for cid in clause_roots:
            builder._add_edge(cid, conj_id)
        return conj_id, None

    try:
        lhs_id, lhs_expr = _walk_relation_side(lhs_latex)
        rhs_id, rhs_expr = _walk_relation_side(rhs_latex)
    except Exception as exc:
        raise ValueError(f"Failed to parse LaTeX: {exc}") from exc

    for node in builder.nodes:
        if node["id"] == lhs_id and lhs_expr is not None:
            restored = builder._fix_bar_subexpr(
                builder._restore_placeholders(lhs_latex.strip()))
            if "Xi" not in restored or node.get("type") not in ("operator",):
                node["subexpr"] = restored
        elif node["id"] == rhs_id and rhs_expr is not None:
            restored = builder._fix_bar_subexpr(
                builder._restore_placeholders(rhs_latex.strip()))
            if "Xi" not in restored or node.get("type") not in ("operator",):
                node["subexpr"] = restored

    rel_id = builder._next_id(rel_meta["op"])
    rel_type = "relation" if is_relation(rel_meta["op"]) else "operator"
    rel_extra: dict[str, str] = {}
    is_congruent = rel_meta.get("op") == "congruent"
    if modulus_latex is not None and is_congruent:
        rel_extra["modulus"] = modulus_latex
    builder._add_node(
        rel_id, type=rel_type,
        subexpr=builder._fix_bar_subexpr(original_latex.strip()),
        **rel_meta, **rel_extra,
    )
    rel_asymmetric = is_asymmetric_relation(rel_meta["op"])
    builder._add_edge(lhs_id, rel_id, role="lhs" if rel_asymmetric else None)
    builder._add_edge(rhs_id, rel_id, role="rhs" if rel_asymmetric else None)

    # --- Connect modulus to the graph ---
    if modulus_latex is not None:
        if is_congruent:
            # Congruent: modulus is structural — connect via modulus edge
            try:
                mod_expr = parse_latex(modulus_latex)
                mod_id = builder._walk(mod_expr)
                builder._add_edge(mod_id, rel_id, role="modulus")
            except Exception:
                pass  # modulus couldn't be parsed — already stored as attribute
        else:
            # Non-congruent (e.g. equals): \pmod is an annotation
            ann = {
                "type": "annotation",
                "label": f"mod {modulus_latex}",
                "latex": rf"\pmod{{{modulus_latex}}}",
            }
            if parenthetical_annotations is None:
                parenthetical_annotations = []
            parenthetical_annotations.append(ann)

    builder._cleanup_infix_subexprs()
    graph: dict = {"nodes": builder.nodes, "edges": builder.edges}
    if lhs_expr is not None and rhs_expr is not None:
        try:
            combined = lhs_expr - rhs_expr
        except TypeError:
            combined = lhs_expr
        graph["classification"] = _classify_expression(combined)
    else:
        graph["classification"] = {"kind": "algebraic"}
    if domain:
        graph["domain"] = domain
    _inject_annotations(graph, parenthetical_annotations or [])
    return graph


def _build_chained_asymmetric_relation_graph(
    part_latexes: list[str],
    rel_meta: dict[str, str],
    original_latex: str,
    *,
    overrides: dict[str, dict[str, str]] | None,
    latex_commands: dict[str, str] | None = None,
    parenthetical_annotations: list | None = None,
    domain: str | None = None,
    bare_sum_indices: set[str] | None = None,
    conditional_bar_funcs: set[str] | None = None,
    assertion_funcs: dict[str, list[str]] | None = None,

) -> dict:
    r"""Build right-associative nested binary nodes for chained asymmetric relations.

    ``P \implies Q \implies R`` becomes::

        Q --lhs--> implies₁ <--rhs-- R
        P --lhs--> implies₂ <--rhs-- implies₁

    Each part is parsed independently via SymPy, then connected with
    nested binary relation nodes from right to left.
    """
    builder = SemanticGraphBuilder(
        overrides=overrides,
        latex_commands=latex_commands or {},
        original_latex=original_latex,
        bare_sum_indices=bare_sum_indices,
        conditional_bar_funcs=conditional_bar_funcs,
        assertion_funcs=assertion_funcs,
    )
    part_ids: list[str] = []
    try:
        for part_latex in part_latexes:
            expr = parse_latex(part_latex)
            pid = builder._walk(expr)
            restored = builder._restore_placeholders(part_latex.strip())
            for node in builder.nodes:
                if node["id"] == pid:
                    # Don't overwrite a walker-built subexpr on infix
                    # operator nodes — they already have the correct form.
                    if "Xi" not in restored or node.get("type") not in ("operator",):
                        node["subexpr"] = restored
                    break
            part_ids.append(pid)
    except Exception as exc:
        raise ValueError(f"Failed to parse LaTeX: {exc}") from exc

    op = rel_meta["op"]
    rel_type = "relation" if is_relation(op) else "operator"

    # Build right-associative chain: fold from the right.
    rhs_id = part_ids[-1]
    for i in range(len(part_ids) - 2, -1, -1):
        lhs_id = part_ids[i]
        rel_id = builder._next_id(op)
        builder._add_node(
            rel_id, type=rel_type,
            subexpr=builder._fix_bar_subexpr(original_latex.strip()),
            **rel_meta,
        )
        builder._add_edge(lhs_id, rel_id, role="lhs")
        builder._add_edge(rhs_id, rel_id, role="rhs")
        rhs_id = rel_id

    builder._cleanup_infix_subexprs()
    graph: dict = {"nodes": builder.nodes, "edges": builder.edges}
    graph["classification"] = {"kind": "algebraic"}
    if domain:
        graph["domain"] = domain
    _inject_annotations(graph, parenthetical_annotations or [])
    return graph


def _build_nary_relation_graph(
    part_latexes: list[str],
    rel_meta: dict[str, str],
    original_latex: str,
    *,
    overrides: dict[str, dict[str, str]] | None,
    latex_commands: dict[str, str] | None = None,
    parenthetical_annotations: list | None = None,
    domain: str | None = None,
    bare_sum_indices: set[str] | None = None,
    conditional_bar_funcs: set[str] | None = None,
    assertion_funcs: dict[str, list[str]] | None = None,

) -> dict:
    r"""Build an n-ary relation graph: all parts feed into one relation node.

    Used for chained symmetric relations such as ``a = b = c`` or
    ``a \approx b \approx c``.  Each part is parsed independently and
    connected to a single relation node.
    """
    builder = SemanticGraphBuilder(
        overrides=overrides,
        latex_commands=latex_commands or {},
        original_latex=original_latex,
        bare_sum_indices=bare_sum_indices,
        conditional_bar_funcs=conditional_bar_funcs,
        assertion_funcs=assertion_funcs,
    )
    part_ids: list[str] = []
    first_expr = None
    try:
        for part_latex in part_latexes:
            expr = parse_latex(part_latex)
            if first_expr is None:
                first_expr = expr
            pid = builder._walk(expr)
            restored = builder._restore_placeholders(part_latex.strip())
            for node in builder.nodes:
                if node["id"] == pid:
                    if "Xi" not in restored or node.get("type") not in ("operator",):
                        node["subexpr"] = restored
                    break
            part_ids.append(pid)
    except Exception as exc:
        raise ValueError(f"Failed to parse LaTeX: {exc}") from exc

    op = rel_meta["op"]
    rel_type = "relation" if is_relation(op) else "operator"
    rel_id = builder._next_id(op)
    builder._add_node(
        rel_id, type=rel_type,
        subexpr=builder._fix_bar_subexpr(original_latex.strip()),
        **rel_meta,
    )
    for pid in part_ids:
        builder._add_edge(pid, rel_id)

    builder._cleanup_infix_subexprs()
    graph: dict = {"nodes": builder.nodes, "edges": builder.edges}
    graph["classification"] = (
        _classify_expression(first_expr) if first_expr is not None
        else {"kind": "algebraic"}
    )
    if domain:
        graph["domain"] = domain
    _inject_annotations(graph, parenthetical_annotations or [])
    return graph


def _walk_condition_into(
    builder: SemanticGraphBuilder,
    cond_latex: str,
    overrides: dict[str, dict[str, str]] | None = None,
) -> str:
    """Parse a condition expression and add its nodes/edges to *builder*.

    Handles relational conditions like ``x \\geq 0`` by splitting on
    the relation and walking each side through the same builder so that
    symbol dedup works across the whole piecewise graph.
    Returns the root node ID of the condition sub-graph.
    """
    preprocessed, _ = _preprocess_latex(cond_latex)
    rel = _split_on_relation(preprocessed)

    if rel is not None:
        lhs_latex, rel_meta, rhs_latex = rel
        try:
            lhs_expr = parse_latex(lhs_latex)
            lhs_id = builder._walk(lhs_expr)
        except Exception:
            lhs_id = builder._next_id("unparsed")
            builder._add_node(lhs_id, type="scalar", latex=lhs_latex)
        try:
            rhs_expr = parse_latex(rhs_latex)
            rhs_id = builder._walk(rhs_expr)
        except Exception:
            rhs_id = builder._next_id("unparsed")
            builder._add_node(rhs_id, type="scalar", latex=rhs_latex)

        rel_id = builder._next_id(rel_meta["op"])
        rel_type = "relation" if is_relation(rel_meta["op"]) else "operator"
        builder._add_node(
            rel_id, type=rel_type,
            subexpr=builder._restore_placeholders(cond_latex.strip()),
            **rel_meta,
        )
        is_asym = is_asymmetric_relation(rel_meta["op"])
        builder._add_edge(lhs_id, rel_id, role="lhs" if is_asym else None)
        builder._add_edge(rhs_id, rel_id, role="rhs" if is_asym else None)
        return rel_id

    # Check for bare equals: x = 0
    eq_split = _split_on_single_equals(preprocessed)
    if eq_split is not None:
        lhs_latex, rhs_latex = eq_split
        try:
            lhs_expr = parse_latex(lhs_latex)
            lhs_id = builder._walk(lhs_expr)
        except Exception:
            lhs_id = builder._next_id("unparsed")
            builder._add_node(lhs_id, type="scalar", latex=lhs_latex)
        try:
            rhs_expr = parse_latex(rhs_latex)
            rhs_id = builder._walk(rhs_expr)
        except Exception:
            rhs_id = builder._next_id("unparsed")
            builder._add_node(rhs_id, type="scalar", latex=rhs_latex)

        eq_id = builder._next_id("equals")
        builder._add_node(
            eq_id, type="relation", op="equals",
            subexpr=builder._restore_placeholders(cond_latex.strip()),
        )
        builder._add_edge(lhs_id, eq_id)
        builder._add_edge(rhs_id, eq_id)
        return eq_id

    # Fallback: parse as a plain expression
    try:
        expr = parse_latex(preprocessed)
        cond_id = builder._walk(expr)
        for node in builder.nodes:
            if node["id"] == cond_id:
                node["subexpr"] = builder._restore_placeholders(cond_latex)
                break
        return cond_id
    except Exception:
        cond_id = builder._next_id("unparsed")
        builder._add_node(
            cond_id, type="scalar", latex=cond_latex,
            subexpr=cond_latex,
        )
        return cond_id


def _build_piecewise_graph(
    lhs_latex: str | None,
    branches: list[tuple[str, str | None]],
    original_latex: str,
    *,
    overrides: dict[str, dict[str, str]] | None = None,
    latex_commands: dict[str, str] | None = None,
    parenthetical_annotations: list | None = None,
    domain: str | None = None,
) -> dict:
    r"""Build a graph for ``\begin{cases}...\end{cases}`` piecewise expressions.

    *lhs_latex* is the expression before ``= \begin{cases}`` (may be ``None``
    for bare cases).  Each branch is ``(value_latex, condition_latex | None)``.

    Each branch gets an explicit ``branch`` intermediary node that groups
    a value sub-graph (``value`` role) with its condition sub-graph
    (``condition`` role).  The ``piecewise`` operator node then collects
    branches.  A branch without a condition (the "otherwise" case) has
    only a ``value`` edge.  If *lhs_latex* is present, the whole thing is
    wrapped in an ``equals`` relation.
    """
    builder = SemanticGraphBuilder(
        overrides=overrides,
        latex_commands=latex_commands or {},
        original_latex=original_latex,
    )

    pw_id = builder._next_id("piecewise")
    builder._add_node(
        pw_id, type="operator", op="piecewise", label="piecewise",
        subexpr=builder._fix_bar_subexpr(original_latex.strip()),
    )

    for val_latex, cond_latex in branches:
        # Build the branch label from value & condition
        branch_subexpr = val_latex
        if cond_latex:
            branch_subexpr = f"{val_latex} \\text{{ if }} {cond_latex}"

        branch_id = builder._next_id("branch")
        builder._add_node(
            branch_id, type="operator", op="branch", label="branch",
            subexpr=builder._restore_placeholders(branch_subexpr),
        )
        builder._add_edge(branch_id, pw_id)

        # Parse value expression
        try:
            val_expr = parse_latex(val_latex)
            val_id = builder._walk(val_expr)
            for node in builder.nodes:
                if node["id"] == val_id:
                    node["subexpr"] = builder._restore_placeholders(val_latex)
                    break
        except Exception:
            val_id = builder._next_id("unparsed")
            builder._add_node(
                val_id, type="scalar", latex=val_latex,
                subexpr=val_latex,
            )
        builder._add_edge(val_id, branch_id, role="value")

        # Parse condition expression (if present)
        if cond_latex:
            cond_id = _walk_condition_into(builder, cond_latex, overrides)
            builder._add_edge(cond_id, branch_id, role="condition")

    graph: dict = {"nodes": builder.nodes, "edges": builder.edges}

    # Wrap in equals if there's a lhs
    if lhs_latex:
        try:
            lhs_expr = parse_latex(lhs_latex)
            lhs_id = builder._walk(lhs_expr)
            for node in builder.nodes:
                if node["id"] == lhs_id:
                    node["subexpr"] = builder._restore_placeholders(lhs_latex)
                    break
        except Exception:
            lhs_id = builder._next_id("unparsed")
            builder._add_node(
                lhs_id, type="scalar", latex=lhs_latex,
                subexpr=lhs_latex,
            )
        eq_id = builder._next_id("equals")
        builder._add_node(eq_id, type="relation", op="equals",
                          subexpr=builder._fix_bar_subexpr(
                              original_latex.strip()))
        builder._add_edge(lhs_id, eq_id)
        builder._add_edge(pw_id, eq_id)
        graph = {"nodes": builder.nodes, "edges": builder.edges}

    graph["classification"] = {"kind": "piecewise", "branches": len(branches)}
    if domain:
        graph["domain"] = domain
    _inject_annotations(graph, parenthetical_annotations or [])
    return graph




def _build_comma_separated_graph(
    clauses: list[str],
    overrides: dict[str, dict[str, str]] | None,
    domain: str | None,
) -> dict:
    r"""Parse each clause independently as parallel statements."""
    merged_nodes: dict[str, dict] = {}
    merged_edges: list[dict] = []
    clause_classifications: list[dict] = []
    cleaned_clauses: list[str] = []

    for clause in clauses:
        cleaned_clauses.append(_LEADING_SPACE_CMD_RE.sub("", clause).strip())

    for ci, clause in enumerate(cleaned_clauses):
        try:
            sub = _latex_to_semantic_graph_dict(clause, overrides=overrides, domain=domain)
        except Exception as exc:
            raise ValueError(
                f"Failed to parse clause {ci + 1} ({clause!r}) of "
                f"comma-separated expression: {exc}"
            ) from exc
        if not isinstance(sub, dict) or not sub.get("nodes"):
            raise ValueError(
                f"Clause {ci + 1} ({clause!r}) produced no graph nodes"
            )

        prefix = f"c{ci}_"

        # Which nodes are clause-LOCAL (get a per-clause prefix so identical
        # entries in different statements stay distinct) vs SHARED across
        # clauses. Operators/relations (``__*``) are always local. Text
        # literals (``\text{foo}`` → type "text") are local too — the same
        # label in two statements is two independent literals. Real symbols
        # (variables) are shared: ``a`` in two clauses is one node (see
        # test_multi_clause_mixed_variable_sharing). Node *type* drives this
        # now — previously it keyed off the dirty ``Xi_{…}`` placeholder id,
        # which clean ids no longer carry.
        rename_map: dict[str, str] = {}
        for n in sub.get("nodes") or []:
            if not isinstance(n, dict) or not isinstance(n.get("id"), str):
                continue
            nid = n["id"]
            if nid.startswith("__") or n.get("type") == "text":
                rename_map[nid] = prefix + nid

        for n in sub.get("nodes") or []:
            if not isinstance(n, dict) or "id" not in n:
                continue
            new_id = rename_map.get(n["id"], n["id"])
            cloned = dict(n)
            cloned["id"] = new_id
            if new_id not in merged_nodes:
                merged_nodes[new_id] = cloned
            else:
                for k, v in cloned.items():
                    merged_nodes[new_id].setdefault(k, v)

        for e in sub.get("edges") or []:
            new_edge = dict(e)
            new_edge["from"] = rename_map.get(e.get("from", ""), e.get("from", ""))
            new_edge["to"] = rename_map.get(e.get("to", ""), e.get("to", ""))
            merged_edges.append(new_edge)

        sub_cls = sub.get("classification")
        if isinstance(sub_cls, dict):
            clause_classifications.append(sub_cls)
        else:
            clause_classifications.append({"kind": "algebraic"})

    result: dict = {
        "nodes": list(merged_nodes.values()),
        "edges": merged_edges,
        "classification": {
            "kind": "statements",
            "count": len(cleaned_clauses),
            "clauses": clause_classifications,
        },
    }
    if domain:
        result["domain"] = domain
    return result


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def _latex_to_semantic_graph_dict(
    latex: str,
    overrides: dict[str, dict[str, str]] | None = None,
    domain: str | None = None,
) -> dict:
    """Parse a LaTeX string and return a semantic graph dict (internal)."""
    user_overrides = overrides
    latex = _normalize_latex(latex)
    # Strip trailing parenthetical annotations before any rewrite pass —
    # otherwise ``_rewrite_assertion_ops`` reads ``h \qquad (c = 1)`` as a
    # function call ``qquad(c = 1)`` and mangles the side condition to
    # ``(c, 1)`` before it can be extracted (issue #435).
    latex, parenthetical_annotations = _extract_parenthetical_annotations(latex)
    latex, infix_overrides = _rewrite_infix_ops(latex)
    latex = _rewrite_prefix_ops(latex)
    # The bracket→paren rewrite only fires on the expectation operator
    # ``E[X]`` → ``E(X)`` (see ``_rewrite_bracket_functions``); every other
    # ``x[…]`` is left untouched.  In chemistry we skip it entirely so that a
    # stray ``E[A]`` is read as a concentration (E is a species/coefficient),
    # not an expectation — chemistry's ``[…]`` brackets are turned into
    # dedicated concentration nodes by the collapse pass below, on the
    # to-be-parsed copy only (the original ``[…]`` stays in ``latex`` for
    # display/ordering).
    if domain != "chemistry":
        latex = _rewrite_bracket_functions(latex)
    latex, conditional_bar_funcs = _rewrite_conditional_bar(latex)
    latex, assertion_funcs = _rewrite_assertion_ops(latex)

    # --- Piecewise / cases environment ---
    pw = _extract_piecewise(latex)
    if pw is not None:
        lhs_latex, branches = pw
        return _build_piecewise_graph(
            lhs_latex, branches, latex,
            overrides={**infix_overrides, **(user_overrides or {})},
            parenthetical_annotations=parenthetical_annotations,
            domain=domain,
        )

    # --- Strong statement separators ---
    strong_clauses = _split_on_statement_separators(latex)
    if len(strong_clauses) > 1:
        # Infix operators (``\circ``, ``\cap``, …) are rewritten to ``\Xi_{N}``
        # placeholders above; the per-clause re-parse needs their overrides to
        # resolve those placeholders back to operator nodes (else a clause like
        # ``\Xi_{900}(f, g) = h`` yields a raw ``Xi_{900}`` function node).
        clause_overrides = {**infix_overrides, **(user_overrides or {})}
        graph = _build_comma_separated_graph(
            strong_clauses, overrides=clause_overrides, domain=domain,
        )
        _inject_annotations(graph, parenthetical_annotations)
        return graph

    # Normalize tensor script order (base^{up}_{down} → base_{down}^{up}) on the
    # raw LaTeX, *before* any placeholder-collapse pass — otherwise the reorder
    # would split a \Theta_{N}/\Xi_{N} placeholder token apart.
    script_normalized = _normalize_script_order(latex)
    if domain == "chemistry":
        script_normalized, concentration_overrides = (
            _collapse_concentration_brackets(script_normalized)
        )
    else:
        concentration_overrides = {}
    braket_collapsed, braket_overrides = _collapse_braket_notation(script_normalized)
    compound_collapsed, compound_overrides = _collapse_compound_symbols(braket_collapsed)
    subscript_collapsed, subscript_overrides = _collapse_multichar_subscripts(compound_collapsed)
    collapsed, text_overrides = _collapse_text_commands(subscript_collapsed)
    # Count existing Xi_{N} placeholders to avoid index collisions
    xi_count = len(subscript_overrides) + len(text_overrides)
    overline_collapsed, overline_overrides = _collapse_overline(collapsed, start_idx=xi_count)
    font_unwrapped = _strip_symbol_font_commands(overline_collapsed)
    preprocessed, bare_sum_indices = _preprocess_latex(font_unwrapped)

    # --- Strip \pmod{…} before SymPy sees it (non-congruent paths) ---
    # For \equiv expressions, _build_relation_graph handles \pmod itself.
    # For everything else (=, single expression, etc.), \pmod would be
    # parsed as a raw symbol — strip it and inject an annotation instead.
    if r"\equiv" not in preprocessed:
        preprocessed, pmod_modulus = _extract_pmod(preprocessed)
        if pmod_modulus is not None:
            parenthetical_annotations.append({
                "type": "annotation",
                "label": f"mod {pmod_modulus}",
                "latex": rf"\pmod{{{pmod_modulus}}}",
            })

    latex_commands = _extract_latex_commands(latex)
    merged_overrides: dict[str, dict[str, str]] = {
        **concentration_overrides,
        **braket_overrides,
        **compound_overrides,
        **subscript_overrides,
        **text_overrides,
        **overline_overrides,
        **infix_overrides,
        **(user_overrides or {}),
    }
    overrides = merged_overrides

    rel = _split_on_relation(preprocessed)

    # --- Meta relations (implies, iff) take priority over commas ---
    if rel is not None and is_meta_relation(rel[1]["op"]):
        lhs_latex, rel_meta, rhs_latex = rel
        op = rel_meta["op"]

        # Detect chain: P \implies Q \implies R → [P, Q, R]
        parts = [lhs_latex]
        remaining = rhs_latex
        while True:
            inner = _split_on_relation(remaining)
            if inner is not None and inner[1]["op"] == op:
                parts.append(inner[0])
                remaining = inner[2]
            else:
                parts.append(remaining)
                break

        if len(parts) >= 3:
            if is_symmetric_relation(op):
                # Symmetric meta-relations (iff) → single n-ary node.
                return _build_nary_relation_graph(
                    parts, rel_meta, latex,
                    overrides=overrides, latex_commands=latex_commands,
                    parenthetical_annotations=parenthetical_annotations,
                    domain=domain, bare_sum_indices=bare_sum_indices,
                    conditional_bar_funcs=conditional_bar_funcs,
                    assertion_funcs=assertion_funcs,
                )
            else:
                # Asymmetric meta-relations (implies) → right-associative nesting.
                return _build_chained_asymmetric_relation_graph(
                    parts, rel_meta, latex,
                    overrides=overrides, latex_commands=latex_commands,
                    parenthetical_annotations=parenthetical_annotations,
                    domain=domain, bare_sum_indices=bare_sum_indices,
                    conditional_bar_funcs=conditional_bar_funcs,
                    assertion_funcs=assertion_funcs,
                )

        graph = _build_relation_graph(
            lhs_latex, rel_meta, rhs_latex, latex,
            overrides=overrides, latex_commands=latex_commands,
            parenthetical_annotations=parenthetical_annotations, domain=domain,
            bare_sum_indices=bare_sum_indices,
            conditional_bar_funcs=conditional_bar_funcs,
            assertion_funcs=assertion_funcs,
        )
        return graph

    # --- Bare-comma split ---
    clauses = _split_on_top_level_comma(latex)
    if len(clauses) > 1:
        clauses = _rejoin_subject_group_commas(clauses)
    if len(clauses) > 1:
        # Pass infix overrides (``\circ``/``\cap`` → ``\Xi_{N}``) so each clause
        # re-parse can resolve its placeholders back to operator nodes.
        clause_overrides = {**infix_overrides, **(user_overrides or {})}
        graph = _build_comma_separated_graph(
            clauses, overrides=clause_overrides, domain=domain,
        )
        _inject_annotations(graph, parenthetical_annotations)
        return graph

    # --- Object-level relations ---
    if rel is not None:
        lhs_latex, rel_meta, rhs_latex = rel
        op = rel_meta["op"]

        # Chained symmetric relations → single n-ary node.
        if is_symmetric_relation(op):
            parts = [lhs_latex]
            remaining = rhs_latex
            while True:
                inner = _split_on_relation(remaining)
                if inner is not None and inner[1]["op"] == op:
                    parts.append(inner[0])
                    remaining = inner[2]
                else:
                    parts.append(remaining)
                    break
            if len(parts) >= 3:
                return _build_nary_relation_graph(
                    parts, rel_meta, latex,
                    overrides=overrides, latex_commands=latex_commands,
                    parenthetical_annotations=parenthetical_annotations,
                    domain=domain, bare_sum_indices=bare_sum_indices,
                    conditional_bar_funcs=conditional_bar_funcs,
                    assertion_funcs=assertion_funcs,
                )

        graph = _build_relation_graph(
            lhs_latex, rel_meta, rhs_latex, latex,
            overrides=overrides, latex_commands=latex_commands,
            parenthetical_annotations=parenthetical_annotations, domain=domain,
            bare_sum_indices=bare_sum_indices,
            conditional_bar_funcs=conditional_bar_funcs,
            assertion_funcs=assertion_funcs,
        )
        return graph

    # --- Chained equals (n-ary: a = b = c → single = node) ---
    chained_parts = _split_chained_equals(preprocessed)
    if chained_parts is not None:
        eq_meta = {"op": "equals", "label": "equals", "emoji": "="}
        return _build_nary_relation_graph(
            chained_parts, eq_meta, latex,
            overrides=overrides, latex_commands=latex_commands,
            parenthetical_annotations=parenthetical_annotations,
            domain=domain, bare_sum_indices=bare_sum_indices,
            conditional_bar_funcs=conditional_bar_funcs,
            assertion_funcs=assertion_funcs,
        )

    # --- Single expression ---
    try:
        expr = parse_latex(preprocessed)
    except Exception as exc:
        raise ValueError(f"Failed to parse LaTeX: {exc}") from exc

    # SymPy eagerly simplifies tautological equations — e.g.
    # ``-(-x) = x`` → ``Eq(x, x)`` → ``BooleanTrue``.  When that
    # happens and the original LaTeX contained ``=``, split on the
    # equals sign and parse each side independently so the structural
    # graph is preserved.
    if expr is S.true or expr is S.false:
        eq_split = _split_on_single_equals(preprocessed)
        if eq_split is not None:
            lhs_latex, rhs_latex = eq_split
            builder = SemanticGraphBuilder(
                overrides=overrides, latex_commands=latex_commands,
                original_latex=latex, bare_sum_indices=bare_sum_indices,
                conditional_bar_funcs=conditional_bar_funcs,
                assertion_funcs=assertion_funcs,
            )
            try:
                lhs_expr = parse_latex(lhs_latex)
                rhs_expr = parse_latex(rhs_latex)
            except Exception as exc2:
                raise ValueError(f"Failed to parse LaTeX: {exc2}") from exc2
            lhs_id = builder._walk(lhs_expr)
            rhs_id = builder._walk(rhs_expr)
            # Annotate each subtree root with original LaTeX
            for n in builder.nodes:
                if n["id"] == lhs_id:
                    n["subexpr"] = builder._restore_placeholders(
                        lhs_latex.strip())
                elif n["id"] == rhs_id:
                    n["subexpr"] = builder._restore_placeholders(
                        rhs_latex.strip())
            eq_id = builder._next_id("equals")
            builder._add_node(eq_id, type="relation", op="equals",
                              subexpr=latex.strip())
            builder._add_edge(lhs_id, eq_id)
            builder._add_edge(rhs_id, eq_id)
            graph = {"nodes": builder.nodes, "edges": builder.edges}
            graph["classification"] = {"kind": "algebraic"}
            if domain:
                graph["domain"] = domain
            _inject_annotations(graph, parenthetical_annotations)
            return graph

    classification = _classify_expression(expr)
    builder = SemanticGraphBuilder(
        overrides=overrides, latex_commands=latex_commands,
        original_latex=latex, bare_sum_indices=bare_sum_indices,
        conditional_bar_funcs=conditional_bar_funcs,
        assertion_funcs=assertion_funcs,
    )
    graph = builder.build(expr, original_latex=latex)
    graph["classification"] = classification
    if domain:
        graph["domain"] = domain
    _inject_annotations(graph, parenthetical_annotations)
    return graph


def _resolve_xi_node_ids(graph: SemanticGraph) -> None:
    """Rename ``Xi_{N}`` / ``Theta_{N}`` / ``cK_Xi_{N}`` node ids to clean display forms.

    Multi-char subscripts like ``v_{rms}`` are collapsed into ``Xi_{0}``
    placeholders before SymPy parsing; Greek subscripts like
    ``\\epsilon_0`` are collapsed into ``Theta_{N}`` placeholders.
    The node's ``latex`` field holds the restored form.  This pass
    derives a clean id from that latex and renames nodes + edges
    consistently.
    """
    _PLACEHOLDER_ID_RE = re.compile(r"(c\d+_)?(?:Xi|Theta)_\{\d+\}")
    rename_map: dict[str, str] = {}
    for node in graph.nodes:
        m = _PLACEHOLDER_ID_RE.fullmatch(node.id)
        if not m:
            continue
        clause_prefix = m.group(1) or ""
        latex_val = getattr(node, "latex", None) or ""
        clean = re.sub(r"\\text\{([^{}]+)\}", r"\1", latex_val)
        # Greek subscript placeholders (Theta_): the latex is e.g.
        # ``\epsilon_{0}`` — strip the leading command backslash so
        # the node id stays ``epsilon_{0}`` (internal identifier),
        # while latex/subexpr keep the proper ``\epsilon_{0}`` form.
        bare_id = node.id[len(clause_prefix):]
        if bare_id.startswith("Theta_{"):
            clean = re.sub(r"^\\", "", clean)
        # Preserve the clause prefix (e.g. ``c0_``) so that the same
        # variable appearing in different clauses keeps a unique id.
        if clause_prefix:
            clean = clause_prefix + clean
        if clean and clean != node.id:
            rename_map[node.id] = clean
    if not rename_map:
        return
    for node in graph.nodes:
        if node.id in rename_map:
            node.id = rename_map[node.id]
    for edge in graph.edges:
        if edge.from_ in rename_map:
            edge.from_ = rename_map[edge.from_]
        if edge.to in rename_map:
            edge.to = rename_map[edge.to]


# Synthetic collapse sentinels (multichar subscripts, ``\text{…}``, compound
# identifiers, braket inner products) — the only override keys safe to
# substitute back into a symbol's display latex. A leading ``cN_`` is the
# per-clause prefix used in comma-separated statements.
_PLACEHOLDER_KEY_RE = re.compile(r"^(?:c\d+_)?(?:Xi|Theta|Phi)_\{\d+\}$")


def latex_to_semantic_graph(
    latex: str,
    overrides: dict[str, dict[str, str]] | None = None,
    domain: str | None = None,
) -> SemanticGraph:
    """Parse a LaTeX string and return a ``SemanticGraph`` model instance."""
    # Strip LaTeX accent commands (\vec, \hat, …) before SymPy parsing —
    # SymPy's parse_latex treats them as unknown symbols (e.g. \vec{F} →
    # Symbol("vec") * Symbol("F")).  After graph construction we restore
    # the accents on the matching nodes via the postprocessor.
    #
    # Only strip *tracked* accents — not font commands (\mathbf, \mathrm,
    # etc.) which are handled downstream by ``_strip_symbol_font_commands``.
    from .postprocessor import GraphPostprocessor

    accent_map: dict[str, str] = {}
    cleaned = _strip_tracked_accents(latex, accent_map)
    raw = _latex_to_semantic_graph_dict(cleaned, overrides=overrides, domain=domain)
    graph = SemanticGraph.model_validate(raw)
    _resolve_xi_node_ids(graph)
    if accent_map:
        GraphPostprocessor.restore_accents(graph, accent_map)
    return graph
