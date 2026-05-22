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
    sin, cos, tan, log, exp, sqrt,
    Derivative, Integral, Limit, Sum, Product,
    pi, E, I, oo,
    S,
)
from sympy.parsing.latex import parse_latex
from sympy.physics.quantum.state import KetBase, BraBase
from sympy.physics.quantum import InnerProduct

from backend.model.semantic_graph import SemanticGraph

from .preprocessor import LaTeXPreprocessor
from .constants import (
    KNOWN_VARIABLES,
    OPERATOR_MAP,
    CONSTANT_MAP,
    RELATION_MAP,
    _ASYMMETRIC_OPS,
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
        return f"(·){_to_superscript(node.get('exponent', 'n'))}"
    if op in ("derivative", "partial_derivative"):
        d = "∂" if op == "partial_derivative" else "d"
        wrt = node.get("with_respect_to")
        return f"{d}·/{d}{wrt}" if wrt else f"{d}·/{d}·"
    return _OPERATOR_GLYPHS.get(op)


def node_short_label(node: dict) -> str:
    """Return the SHORT label — compact symbol for the graph node."""
    if node.get("type") in _OP_KINDS:
        if node.get("latex"):
            return node["latex"]
        glyph = _operator_glyph(node)
        if glyph:
            return glyph
        return node.get("op") or node.get("id", "")
    if node.get("latex"):
        return node["latex"]
    if node.get("label"):
        return node["label"]
    return node.get("id", "")


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
    return rewritten, overrides


def _extract_parenthetical_annotations(latex: str) -> tuple[str, list[dict[str, str]]]:
    r"""Strip trailing parenthetical annotations from LaTeX."""
    annotations: list[dict[str, str]] = []
    spacing = r"(?:\s|\\quad|\\qquad|\\,|\\;|\\!|\\:)*"
    pattern = re.compile(
        spacing + r"\(([^()]*\\text\{[^{}]+\}[^()]*)\)\s*$"
    )
    while True:
        m = pattern.search(latex)
        if not m:
            break
        inner = m.group(1).strip()
        label = re.sub(r"\\text\{([^{}]+)\}", r"\1", inner)
        label = re.sub(r"\\[A-Za-z]+\s*", "", label)
        label = re.sub(r"[{}]", "", label)
        label = re.sub(r"\s+", " ", label).strip()
        annotations.append({
            "latex": inner,
            "label": label,
            "type": "annotation",
        })
        latex = latex[:m.start()].rstrip()
    annotations.reverse()
    return latex, annotations


def _preprocess_latex(latex: str) -> str:
    """Rewrite LaTeX patterns that SymPy's parse_latex doesn't handle."""
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
    latex = re.sub(r"_([A-Za-z0-9])(?![A-Za-z0-9_{])", r"_{\1}", latex)
    latex = re.sub(r"\\(?:quad|qquad|,|;|!)\s*", " ", latex)
    return latex


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
# Statement splitting
# ---------------------------------------------------------------------------

def _split_on_statement_separators(latex: str) -> list[str]:
    r"""Split on ``\\`` and ``, \quad`` at brace depth 0."""
    parts: list[str] = []
    depth = 0
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
            if i + 1 < n and latex[i + 1] == "\\":
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
        elif ch == "," and depth == 0:
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


def _split_chained_equals(latex: str) -> tuple[str, dict[str, str], str] | None:
    r"""Split on first ``=`` only when 2+ bare ``=`` exist at depth 0."""
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
    first = eq_positions[0]
    lhs = latex[:first].strip()
    rhs = latex[first + 1:].strip()
    if lhs and rhs:
        meta = {"op": "equals", "label": "equals", "emoji": "="}
        return lhs, meta, rhs
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

class SemanticGraphBuilder:
    """Walks a SymPy expression tree and emits nodes + edges."""

    def __init__(
        self,
        overrides: dict[str, dict[str, str]] | None = None,
        latex_commands: dict[str, str] | None = None,
        original_latex: str | None = None,
    ) -> None:
        self.nodes: list[dict[str, str]] = []
        self.edges: list[dict[str, str]] = []
        self._id_counter = 0
        self._seen_symbols: dict[str, str] = {}
        self._overrides = overrides or {}
        self._latex_commands = latex_commands or {}
        self._original_latex = original_latex or ""
        self._symbol_order = self._build_symbol_order()

    @staticmethod
    def _fmt_number(expr: sympy.Basic) -> str:
        if isinstance(expr, sympy.Float):
            return sympy.latex(expr)
        return str(expr)

    def _next_id(self, prefix: str = "n") -> str:
        self._id_counter += 1
        return f"__{prefix}_{self._id_counter}"

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

    def build(self, expr: sympy.Basic, original_latex: str | None = None) -> dict:
        """Build the graph from *expr* and return ``{nodes, edges}``."""
        root_id = self._walk(expr)
        if original_latex:
            for node in self.nodes:
                if node["id"] == root_id:
                    node["subexpr"] = original_latex.strip()
                    break
        return {"nodes": self.nodes, "edges": self.edges}

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
                inner = Mul(*rest)
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

        return self._restore_placeholders(sympy.latex(expr))

    def _restore_placeholders(self, latex: str) -> str:
        if not self._overrides:
            return latex
        for name, attrs in self._overrides.items():
            if not _PLACEHOLDER_NAME_RE.fullmatch(name):
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
            latex = latex.replace(name, replacement)
        return latex

    def _set_subexpr(self, node_id: str, expr: sympy.Basic) -> None:
        for node in self.nodes:
            if node["id"] == node_id and "subexpr" not in node:
                node["subexpr"] = self._subexpr_ordered(expr)
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
            node_id = name
            latex_fallback = self._symbol_latex(name) or name
            attrs: dict[str, Any] = {
                "type": meta.get("type", "scalar"),
                "latex": meta.get("latex", latex_fallback),
            }
            if name in self._overrides:
                _INTERNAL_OVERRIDE_KEYS = {
                    "bra_content", "ket_content", "original_latex",
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
                node_id = self._next_id("const")
                attrs: dict[str, Any] = {"type": "constant"}
                if meta.get("label"):
                    attrs["label"] = meta["label"]
                self._add_node(node_id, **attrs)
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

        # --- Functions ---
        # Map SymPy class names to canonical operation names where they differ.
        _FUNC_OP_MAP: dict[str, str] = {
            "binomial": "choose",  # C(n,k) — "choose", not "binomial"
            "Abs": "abs",          # normalize SymPy's uppercase class name
        }

        if isinstance(expr, sympy.Function):
            func_name = type(expr).__name__
            op_name = _FUNC_OP_MAP.get(func_name, func_name)
            node_id = self._next_id(op_name)
            func_latex = self._latex_commands.get(func_name)
            func_attrs: dict[str, str] = {"type": "function", "op": op_name}
            if func_latex:
                func_attrs["latex"] = func_latex
            self._add_node(node_id, **func_attrs)
            for arg in expr.args:
                child_id = self._walk(arg)
                self._add_edge(child_id, node_id)
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
            self._add_edge(tends_id, point_id, role="rhs")
            tends_attrs: dict[str, str] = {
                "type": "operator", "op": "tends_to",
                "with_respect_to": var_id,
                "limit_point": point_id,
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
            self._add_node(node_id, type="operator", op=op_name,
                           with_respect_to=", ".join(wrt_ids))
            return node_id

        # --- Integral ---
        if isinstance(expr, Integral):
            node_id = self._next_id("integral")
            wrt_ids: list[str] = []
            lower_nid: str | None = None
            upper_nid: str | None = None
            node_attrs: dict[str, str] = {"type": "operator", "op": "integral"}
            for limit_tuple in expr.limits:
                var_id = self._walk(limit_tuple[0])
                wrt_ids.append(var_id)
                if len(limit_tuple) >= 3:
                    lower_nid = self._walk(limit_tuple[1])
                    upper_nid = self._walk(limit_tuple[2])
            node_attrs["with_respect_to"] = ", ".join(wrt_ids)
            if lower_nid is not None:
                node_attrs["lower_bound"] = lower_nid
            if upper_nid is not None:
                node_attrs["upper_bound"] = upper_nid
            self._add_node(node_id, **node_attrs)
            child_id = self._walk(expr.function)
            self._add_edge(child_id, node_id)
            return node_id

        # --- Sum / Product ---
        if isinstance(expr, (Sum, Product)):
            op_name = "sum" if isinstance(expr, Sum) else "product"
            node_id = self._next_id(op_name)
            wrt_ids = []
            lower_nid = None
            upper_nid = None
            node_attrs = {"type": "operator", "op": op_name}
            for limit_tuple in expr.limits:
                var_id = self._walk(limit_tuple[0])
                wrt_ids.append(var_id)
                if len(limit_tuple) >= 3:
                    lower_nid = self._walk(limit_tuple[1])
                    upper_nid = self._walk(limit_tuple[2])
            node_attrs["with_respect_to"] = ", ".join(wrt_ids)
            if lower_nid is not None:
                node_attrs["lower_bound"] = lower_nid
            if upper_nid is not None:
                node_attrs["upper_bound"] = upper_nid
            self._add_node(node_id, **node_attrs)
            child_id = self._walk(expr.function)
            self._add_edge(child_id, node_id)
            return node_id

        # --- Power with literal exponent ---
        if isinstance(expr, Pow) and isinstance(expr.args[1], Number):
            exponent = expr.args[1]
            exp_val = self._fmt_number(exponent)
            node_id = self._next_id("power")
            self._add_node(node_id, type="operator", op="power", exponent=exp_val)
            base_id = self._walk(expr.args[0])
            self._add_edge(base_id, node_id)
            return node_id

        # --- Power with symbolic-negative exponent ---
        if (
            isinstance(expr, Pow)
            and isinstance(expr.args[1], Mul)
            and expr.args[1].args
            and expr.args[1].args[0] == sympy.S.NegativeOne
        ):
            node_id = self._next_id("power")
            self._add_node(
                node_id, type="operator", op="power", exponent=self._fmt_number(expr.args[1])
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
                child_id = self._walk(Mul(*rest))
            self._add_edge(child_id, node_id)
            return node_id

        # --- Binary/n-ary operators ---
        op_name = OPERATOR_MAP.get(type(expr))
        if op_name is not None:
            node_id = self._next_id(op_name)
            self._add_node(node_id, type="operator", op=op_name)
            edge_semantic = "direct" if op_name == "multiply" else None
            edge_weight = 1.0 if op_name == "multiply" else None
            asymmetric = op_name in _ASYMMETRIC_OPS
            for i, arg in enumerate(expr.args):
                child_semantic = edge_semantic
                child_weight = edge_weight
                if op_name == "multiply" and _is_inverse_pow(arg):
                    child_semantic = None
                    child_weight = None
                child_id = self._walk(arg)
                edge_role = ("lhs" if i == 0 else "rhs") if asymmetric else None
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
) -> dict:
    r"""Build a graph for a binary relation ``lhs <op> rhs``."""
    builder = SemanticGraphBuilder(
        overrides=overrides,
        latex_commands=latex_commands or {},
        original_latex=original_latex,
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
            conj_id, type="relation", op="and", label="and", emoji=",",
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
            node["subexpr"] = builder._restore_placeholders(lhs_latex.strip())
        elif node["id"] == rhs_id and rhs_expr is not None:
            node["subexpr"] = builder._restore_placeholders(rhs_latex.strip())

    rel_id = builder._next_id(rel_meta["op"])
    builder._add_node(
        rel_id, type="relation", subexpr=original_latex.strip(), **rel_meta,
    )
    rel_asymmetric = rel_meta["op"] in _ASYMMETRIC_OPS
    builder._add_edge(lhs_id, rel_id, role="lhs" if rel_asymmetric else None)
    builder._add_edge(rhs_id, rel_id, role="rhs" if rel_asymmetric else None)

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

        def _rename(nid: str, p: str = prefix) -> str:
            if not isinstance(nid, str):
                return nid
            if nid.startswith("__"):
                return p + nid
            if nid.startswith("Xi_{") or nid.startswith("Theta_{") or nid.startswith("Phi_{"):
                return p + nid
            return nid

        for n in sub.get("nodes") or []:
            if not isinstance(n, dict) or "id" not in n:
                continue
            new_id = _rename(n["id"])
            cloned = dict(n)
            cloned["id"] = new_id
            if new_id not in merged_nodes:
                merged_nodes[new_id] = cloned
            else:
                for k, v in cloned.items():
                    merged_nodes[new_id].setdefault(k, v)

        for e in sub.get("edges") or []:
            new_edge = dict(e)
            new_edge["from"] = _rename(e.get("from", ""))
            new_edge["to"] = _rename(e.get("to", ""))
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
    latex, parenthetical_annotations = _extract_parenthetical_annotations(latex)

    # --- Strong statement separators ---
    strong_clauses = _split_on_statement_separators(latex)
    if len(strong_clauses) > 1:
        graph = _build_comma_separated_graph(
            strong_clauses, overrides=user_overrides, domain=domain,
        )
        _inject_annotations(graph, parenthetical_annotations)
        return graph

    braket_collapsed, braket_overrides = _collapse_braket_notation(latex)
    compound_collapsed, compound_overrides = _collapse_compound_symbols(braket_collapsed)
    collapsed, text_overrides = _collapse_text_commands(compound_collapsed)
    font_unwrapped = _strip_symbol_font_commands(collapsed)
    preprocessed = _preprocess_latex(font_unwrapped)
    latex_commands = _extract_latex_commands(latex)
    merged_overrides: dict[str, dict[str, str]] = {
        **braket_overrides,
        **compound_overrides,
        **text_overrides,
        **(user_overrides or {}),
    }
    overrides = merged_overrides

    rel = _split_on_relation(preprocessed)

    # --- Meta relations (implies, iff) take priority over commas ---
    if rel is not None and rel[1]["op"] in _META_RELATION_OPS:
        lhs_latex, rel_meta, rhs_latex = rel
        graph = _build_relation_graph(
            lhs_latex, rel_meta, rhs_latex, latex,
            overrides=overrides, latex_commands=latex_commands,
            parenthetical_annotations=parenthetical_annotations, domain=domain,
        )
        return graph

    # --- Bare-comma split ---
    clauses = _split_on_top_level_comma(latex)
    if len(clauses) > 1:
        clauses = _rejoin_subject_group_commas(clauses)
    if len(clauses) > 1:
        graph = _build_comma_separated_graph(
            clauses, overrides=user_overrides, domain=domain,
        )
        _inject_annotations(graph, parenthetical_annotations)
        return graph

    # --- Object-level relations ---
    if rel is not None:
        lhs_latex, rel_meta, rhs_latex = rel
        graph = _build_relation_graph(
            lhs_latex, rel_meta, rhs_latex, latex,
            overrides=overrides, latex_commands=latex_commands,
            parenthetical_annotations=parenthetical_annotations, domain=domain,
        )
        return graph

    # --- Chained equals ---
    chained = _split_chained_equals(preprocessed)
    if chained is not None:
        lhs_latex, rel_meta, rhs_latex = chained
        builder = SemanticGraphBuilder(overrides=overrides, latex_commands=latex_commands, original_latex=latex)
        try:
            lhs_expr = parse_latex(lhs_latex)
            lhs_id = builder._walk(lhs_expr)
            rhs_expr = parse_latex(rhs_latex)
            rhs_id = builder._walk(rhs_expr)
        except Exception as exc:
            raise ValueError(f"Failed to parse LaTeX: {exc}") from exc
        for node in builder.nodes:
            if node["id"] == lhs_id:
                node["subexpr"] = builder._restore_placeholders(lhs_latex.strip())
            elif node["id"] == rhs_id:
                node["subexpr"] = builder._restore_placeholders(rhs_latex.strip())
        rel_id = builder._next_id(rel_meta["op"])
        builder._add_node(rel_id, type="relation", subexpr=latex.strip(), **rel_meta)
        builder._add_edge(lhs_id, rel_id)
        builder._add_edge(rhs_id, rel_id)
        graph = {"nodes": builder.nodes, "edges": builder.edges}
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
        _inject_annotations(graph, parenthetical_annotations)
        return graph

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
                original_latex=latex,
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
            builder._add_node(eq_id, type="operator", op="equals",
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
    builder = SemanticGraphBuilder(overrides=overrides, latex_commands=latex_commands, original_latex=latex)
    graph = builder.build(expr, original_latex=latex)
    graph["classification"] = classification
    if domain:
        graph["domain"] = domain
    _inject_annotations(graph, parenthetical_annotations)
    return graph


def latex_to_semantic_graph(
    latex: str,
    overrides: dict[str, dict[str, str]] | None = None,
    domain: str | None = None,
) -> SemanticGraph:
    """Parse a LaTeX string and return a ``SemanticGraph`` model instance."""
    raw = _latex_to_semantic_graph_dict(latex, overrides=overrides, domain=domain)
    return SemanticGraph.model_validate(raw)
