#!/usr/bin/env python3
"""
algebench - Interactive 3D Math Visualizer with AI Chat

Usage:
    algebench                        Launch empty viewer
    algebench scene.json             Launch with a scene file
    algebench --port 9000            Use custom port
"""

import sys
import json
import os
import re
import asyncio
import webbrowser
import builtins
from pathlib import Path
import threading
import time
import signal
import subprocess
import argparse
import tty
import termios
import select
from urllib.parse import quote
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse, Response, JSONResponse, HTMLResponse, FileResponse
from pydantic import BaseModel
import uvicorn
from google import genai
from google.genai import types

script_dir = Path(__file__).parent.resolve()
scenes_dir = script_dir / "scenes"

# Make scripts/ importable (no __init__.py there, so add its parent to sys.path
# and import via a fully qualified module name via importlib).
import importlib.util as _iu
def _load_script_module(rel_path: str, mod_name: str):
    spec = _iu.spec_from_file_location(mod_name, script_dir / rel_path)
    if spec is None or spec.loader is None:
        return None
    mod = _iu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Semantic-graph auto-derivation for proof steps missing explicit graphs.
# Called on every scene-load endpoint so the Graph tab can show a diagram
# even for steps that were authored without a ``semanticGraph`` field.
# ---------------------------------------------------------------------------
_latex_graph_cache: dict[str, dict | None] = {}

# Greek placeholders for multi-character subscripts. SymPy's parse_latex
# treats multi-letter identifiers as implicit multiplication (``\text{prop}``
# → ``p*r*o*p``), but single-symbol Greek letters round-trip cleanly, so we
# swap in a Greek letter, parse, then rewrite the resulting graph back.
_GREEK_POOL = [
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
    "iota", "kappa", "lambda", "mu", "nu", "xi", "rho", "sigma", "tau",
    "upsilon", "phi", "chi", "psi", "omega",
]


# Purely visual decorators SymPy's LaTeX parser chokes on — strip them
# before parsing so ``\vec{F}`` is treated as just ``F``. The graph's
# display latex loses the decoration; authors can re-add it via scene
# ``highlights`` metadata or hand-crafted ``semanticGraph`` entries.
#
# ``\dot``/``\ddot``/``\dddot``/``\ddddot`` are intentionally NOT in this
# list — they have semantic meaning (time derivatives) and get rewritten
# to ``\frac{d…}{dt}`` form by :func:`_rewrite_dot_derivatives` *before*
# the accent stripper runs, so SymPy parses them as real ``Derivative``
# objects rather than dropping the decoration entirely.
_ACCENT_COMMANDS = (
    "vec", "hat", "bar", "tilde",
    "overline", "underline", "widehat", "widetilde", "check", "breve",
    "mathring", "acute", "grave",
    "mathbf", "mathrm", "mathit", "mathsf", "mathcal", "mathfrak",
    "boldsymbol", "bm", "operatorname",
)


# ---------------------------------------------------------------------------
# Dot-accent → fraction rewrite. SymPy's LaTeX parser doesn't understand
# overhead-dot notation — ``\dot{m}`` comes back as ``dot * m`` (two symbols
# multiplied). Since the dot IS semantically a time derivative, we rewrite
# it to ``\frac{d m}{d t}`` so SymPy returns a proper ``Derivative`` node
# and the graph gains a real ``d/dt`` operator subgraph. ``\ddot`` nests as
# ``\frac{d}{d t}\frac{d x}{d t}`` because SymPy's parser doesn't recognise
# the flat ``\frac{d^2 x}{d t^2}`` form.
# ---------------------------------------------------------------------------
_DOT_ACCENT_ORDERS: dict[str, int] = {
    "dot": 1, "ddot": 2, "dddot": 3, "ddddot": 4,
}


def _rewrite_dot_derivatives(
    latex: str,
    captured: dict[str, int] | None = None,
) -> str:
    """Rewrite ``\\dot{X}``/``\\ddot{X}``/... into ``\\frac{dX}{dt}`` form.

    Trailing subscripts or superscripts on the accented body are absorbed
    into the differentiated variable. Physics notation ``\\dot{m}_{exhaust}``
    means ``d(m_{exhaust})/dt`` (the exhaust subsystem's mass-flow rate),
    not ``(dm/dt)_{exhaust}`` — so they belong inside the numerator.

    When *captured* is provided, every rewritten accent is recorded as
    ``{var_latex: max_order}`` so callers can later restore the original
    ``\\dot{X}`` notation in graph node subexprs for display (without
    sacrificing SymPy's ability to parse the intermediate form as a real
    ``Derivative`` node).
    """
    if not isinstance(latex, str) or "\\" not in latex:
        return latex
    # Quick bail-out: no dot accent commands present.
    if not any(f"\\{cmd}{{" in latex for cmd in _DOT_ACCENT_ORDERS):
        return latex

    def find_matching_brace(s: str, open_idx: int) -> int | None:
        """Given s[open_idx] == '{', return index of matching '}' or None."""
        if open_idx >= len(s) or s[open_idx] != "{":
            return None
        depth = 1
        j = open_idx + 1
        while j < len(s):
            c = s[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return j
            j += 1
        return None

    def consume_sub_sup(s: str, pos: int) -> tuple[str, int]:
        """Consume one ``_{…}``/``^{…}`` or ``_x``/``^x`` token. Returns
        ``(literal, new_pos)``. ``('', pos)`` when there's nothing to eat."""
        if pos >= len(s) or s[pos] not in "_^":
            return "", pos
        op = s[pos]
        p = pos + 1
        if p >= len(s):
            return "", pos
        if s[p] == "{":
            end = find_matching_brace(s, p)
            if end is None:
                return "", pos
            return op + s[p:end + 1], end + 1
        # Single-char sub/sup: _x or ^2
        return op + s[p], p + 1

    out: list[str] = []
    i = 0
    n = len(latex)
    while i < n:
        if latex[i] != "\\":
            out.append(latex[i])
            i += 1
            continue
        matched_cmd: str | None = None
        for cmd in _DOT_ACCENT_ORDERS:
            end = i + 1 + len(cmd)
            if latex.startswith(cmd, i + 1) and end < n and latex[end] == "{":
                matched_cmd = cmd
                break
        if matched_cmd is None:
            out.append(latex[i])
            i += 1
            continue
        order = _DOT_ACCENT_ORDERS[matched_cmd]
        body_open = i + 1 + len(matched_cmd)
        body_close = find_matching_brace(latex, body_open)
        if body_close is None:
            out.append(latex[i])
            i += 1
            continue
        body = latex[body_open + 1:body_close]
        # Recurse so nested accents (``\dot{\dot{x}}`` → second-order, or
        # ``\dot{\vec{p}}`` → ``\frac{d \vec{p}}{d t}``) are handled too.
        body = _rewrite_dot_derivatives(body, captured)
        j = body_close + 1
        # Absorb any trailing subscript/superscript chain as part of the
        # differentiated variable.
        suffix = ""
        while True:
            tok, new_j = consume_sub_sup(latex, j)
            if not tok:
                break
            suffix += tok
            j = new_j
        var = body + suffix
        # Record the accented variable (and its max observed order) so the
        # display pass can restore ``\dot{…}``/``\ddot{…}`` in subexprs.
        if captured is not None:
            captured[var] = max(captured.get(var, 0), order)
        # Build nested ``\frac{d}{d t}`` wrappers in SymPy-canonical form
        # (empty numerator, variable trails after). The seemingly-natural
        # ``\frac{d <var>}{d t}`` form *fails to parse in SymPy whenever
        # <var> carries a subscript* (``\frac{d m_{\alpha}}{d t}`` →
        # "I expected one of these: '}'"), so we always emit the shape
        # SymPy's parser handles reliably.
        frac = f"\\frac{{d}}{{d t}} {var}"
        for _ in range(order - 1):
            frac = f"\\frac{{d}}{{d t}} {frac}"
        out.append(frac)
        i = j
    return "".join(out)


# ---------------------------------------------------------------------------
# User-written ``\frac{d<body>}{d t}`` normalizer. SymPy's LaTeX parser only
# handles this form when <body> is a single letter (``\frac{dp}{dt}``); any
# subscripted form (``\frac{dm_{\text{exhaust}}}{dt}``) fails with a
# cryptic brace-mismatch error. Rewrite the user's input to the canonical
# ``\frac{d}{d t} <body>`` form *before* handing it to SymPy, so authoring
# either shape is safe.
# ---------------------------------------------------------------------------
def _normalize_frac_derivatives(latex: str) -> str:
    """Rewrite ``\\frac{d<body>}{d t}`` → ``\\frac{d}{d t} <body>`` so the
    SymPy parser accepts subscripted/complex numerators.

    Only fires when the numerator starts with ``d`` immediately followed by
    a variable body (optionally with a trailing ``_{…}`` or ``^{…}``). Does
    NOT populate the dotted-vars capture — the author explicitly wrote a
    fraction, so we want to preserve that shape in display subexprs rather
    than collapsing it to ``\\dot{X}`` notation.
    """
    if not isinstance(latex, str) or "\\frac" not in latex:
        return latex

    def find_matching_brace(s: str, open_idx: int) -> int | None:
        if open_idx >= len(s) or s[open_idx] != "{":
            return None
        depth = 1
        j = open_idx + 1
        while j < len(s):
            c = s[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return j
            j += 1
        return None

    out: list[str] = []
    i = 0
    n = len(latex)
    while i < n:
        if not latex.startswith("\\frac{", i):
            out.append(latex[i])
            i += 1
            continue
        num_open = i + len("\\frac")
        num_close = find_matching_brace(latex, num_open)
        if num_close is None or num_close + 1 >= n or latex[num_close + 1] != "{":
            out.append(latex[i])
            i += 1
            continue
        den_open = num_close + 1
        den_close = find_matching_brace(latex, den_open)
        if den_close is None:
            out.append(latex[i])
            i += 1
            continue
        numerator = latex[num_open + 1:num_close].strip()
        denominator = latex[den_open + 1:den_close].strip()
        # Only rewrite when numerator looks like ``d<body>`` AND denominator
        # is ``d t`` (optionally with a superscript for higher-order, though
        # those are rare in practice and we leave them alone for safety).
        if (numerator.startswith("d") and len(numerator) > 1
                and numerator[1] != "d"
                and denominator.replace(" ", "") == "dt"):
            body = numerator[1:].lstrip()
            # Recurse into body so nested fracs (``\frac{d(\frac{dx}{dt})}{dt}``
            # and the like) get normalized too, though such cases are rare.
            body = _normalize_frac_derivatives(body)
            out.append(f"\\frac{{d}}{{d t}} {body}")
            i = den_close + 1
            continue
        # Not a derivative-shaped fraction — keep it verbatim but still
        # recurse into the numerator/denominator so nested matches fire.
        out.append("\\frac{")
        out.append(_normalize_frac_derivatives(latex[num_open + 1:num_close]))
        out.append("}{")
        out.append(_normalize_frac_derivatives(latex[den_open + 1:den_close]))
        out.append("}")
        i = den_close + 1
    return "".join(out)


# ---------------------------------------------------------------------------
# Display-layer restore. After SymPy re-renders a subexpression, a first-
# order time derivative comes back as ``\frac{d}{d t} X`` and higher orders
# as ``\frac{d^{n}}{d t^{n}} X``. For any variable the user originally
# wrote with overhead-dot notation, rewrite those patterns back to the
# compact ``\dot{X}``/``\ddot{X}`` form the author chose — without touching
# the underlying graph semantics (still a ``Derivative`` node behind it).
# ---------------------------------------------------------------------------
_ORDER_TO_ACCENT: dict[int, str] = {1: "dot", 2: "ddot", 3: "dddot", 4: "ddddot"}


def _restore_dot_notation(
    latex: str,
    dotted_vars: dict[str, int],
) -> str:
    """Collapse SymPy's ``\\frac{d[...]}{d t[...]} X`` output back to the
    user's original ``\\dot{X}`` form, for any X listed in *dotted_vars*.
    """
    if not isinstance(latex, str) or not dotted_vars or "\\frac" not in latex:
        return latex
    # Process highest-order vars first so ``\ddot{x}`` doesn't get eaten by
    # an earlier ``\dot`` pattern matching ``\frac{d}{d t}`` of the nested
    # second-order form.
    for var, order in sorted(dotted_vars.items(), key=lambda kv: -kv[1]):
        if order not in _ORDER_TO_ACCENT:
            continue
        accent = _ORDER_TO_ACCENT[order]
        escaped_var = re.escape(var)
        if order == 1:
            # Two shapes to restore:
            #   • SymPy canonical:  ``\frac{d}{d t} <var>``
            #   • Rewrite literal:  ``\frac{d <var>}{d t}``   (our own output
            #     that survives in the equals node's subexpr, which stores
            #     the raw rewritten input rather than SymPy's re-render).
            patterns = [
                rf"\\frac\{{d\}}\{{d\s*t\}}\s*{escaped_var}",
                rf"\\frac\{{d\s*{escaped_var}\}}\{{d\s*t\}}",
            ]
        else:
            patterns = [
                rf"\\frac\{{d\^\{{{order}\}}\}}"
                rf"\{{d\s*t\^\{{{order}\}}\}}\s*{escaped_var}"
            ]
        for pattern in patterns:
            latex = re.sub(pattern, rf"\\{accent}{{{var}}}", latex)
    return latex


def _restore_dot_notation_in_graph(
    graph: dict,
    dotted_vars: dict[str, int],
) -> None:
    """Walk every node's ``subexpr`` (and top-level ``latex`` when the node
    itself represents a dotted variable) and restore ``\\dot`` notation.
    """
    if not isinstance(graph, dict) or not dotted_vars:
        return
    for node in graph.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        sub = node.get("subexpr")
        if isinstance(sub, str) and "\\frac" in sub:
            node["subexpr"] = _restore_dot_notation(sub, dotted_vars)


def _strip_accent_commands(
    latex: str,
    accent_map: dict[str, str] | None = None,
) -> str:
    """Peel ``\\vec{X}``/``\\hat{X}``/``\\mathbf{X}``/... → ``X``.

    Walks the string once, tracking brace depth for the decorator's body so
    nested braces inside (``\\vec{F_{abc}}``) are handled correctly. When
    *accent_map* is provided, every stripped ``\\accent{body}`` is recorded
    as ``{body: accent}`` so callers can restore the decoration in the
    produced graph's display latex (via :func:`_restore_accents_in_graph`).
    """
    if not isinstance(latex, str) or "\\" not in latex:
        return latex
    out: list[str] = []
    i = 0
    n = len(latex)
    while i < n:
        if latex[i] != "\\":
            out.append(latex[i])
            i += 1
            continue
        # Try to match one of our known accent commands at this position.
        matched_cmd: str | None = None
        for cmd in _ACCENT_COMMANDS:
            end = i + 1 + len(cmd)
            if latex.startswith(cmd, i + 1) and end < n:
                # The next char must be ``{`` (body) and must not be another
                # identifier char (so ``\vec`` matches but ``\vector`` doesn't).
                nxt = latex[end]
                if nxt == "{":
                    matched_cmd = cmd
                    break
        if matched_cmd is None:
            out.append(latex[i])
            i += 1
            continue
        body_start = i + 1 + len(matched_cmd) + 1  # skip '\cmd{'
        depth = 1
        j = body_start
        while j < n and depth > 0:
            c = latex[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        raw_body = latex[body_start:j]
        # Recurse on body so nested accents peel too (``\vec{\hat{F}}`` → ``F``).
        clean_body = _strip_accent_commands(raw_body, accent_map)
        if accent_map is not None and clean_body and "\\" not in clean_body:
            # Skip layout-only wrappers (``\mathrm`` on ``sin``, etc.) and
            # only remember genuine accents that produce a visual mark.
            if matched_cmd in {
                "vec", "hat", "bar", "tilde", "dot", "ddot", "dddot", "ddddot",
                "overline", "widehat", "widetilde", "check", "breve",
                "mathring", "acute", "grave",
            }:
                accent_map.setdefault(clean_body, matched_cmd)
        out.append(clean_body)
        i = j + 1
    return "".join(out)


def _restore_accents_in_graph(
    graph: dict | None,
    accent_map: dict[str, str],
) -> None:
    """Re-wrap stripped accents in each node's display ``latex`` field.

    For every ``{body: accent}`` in *accent_map*, find nodes whose latex is
    a bare ``body`` or ``body`` plus a subscript/superscript, and restore
    ``\\accent{body}`` at the front so the graph still shows ``\\vec{F}``
    rather than a plain ``F``.
    """
    if not graph or not accent_map:
        return
    nodes = graph.get("nodes") or []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") in ("operator", "relation"):
            continue
        latex = node.get("latex")
        if not isinstance(latex, str) or not latex:
            continue
        for body, accent in accent_map.items():
            # Match either ``body`` exactly or ``body<boundary>...`` where
            # boundary is ``_``/``^`` (subscript / superscript). Skip if the
            # accent is already present (e.g. authored graphs).
            if f"\\{accent}{{{body}}}" in latex:
                continue
            if latex == body:
                node["latex"] = f"\\{accent}{{{body}}}"
                if accent == "vec":
                    node["type"] = "vector"
                break
            if latex.startswith(body) and len(latex) > len(body):
                tail = latex[len(body):]
                if tail[0] in "_^":
                    node["latex"] = f"\\{accent}{{{body}}}{tail}"
                    if accent == "vec":
                        node["type"] = "vector"
                    break


def _substitute_multichar_subscripts(latex: str) -> tuple[str, dict[str, str]]:
    """Replace multi-character subscript bodies with Greek placeholders.

    Returns ``(rewritten_latex, greek_to_original_latex)``. The mapping keys
    are plain names like ``"xi"``; values are the original body (e.g.
    ``"\\text{prop}"`` or ``"sp"``).
    """
    mapping: dict[str, str] = {}
    greek_iter = iter(_GREEK_POOL)

    def allocate(original: str) -> str | None:
        # Re-use the same placeholder if we've already seen this body, so that
        # repeated occurrences map to the same symbol in the graph.
        for k, v in mapping.items():
            if v == original:
                return k
        try:
            k = next(greek_iter)
        except StopIteration:
            return None
        mapping[k] = original
        return k

    # 1) Substitute every \text{BODY} first — doesn't matter where it sits;
    #    as a standalone symbol it still becomes an atomic placeholder.
    def _sub_text(m: re.Match) -> str:
        body = m.group(1)
        k = allocate(f"\\text{{{body}}}")
        return f"\\{k}" if k else m.group(0)
    latex = re.sub(r"\\text\{([^{}]+)\}", _sub_text, latex)

    # 2) Substitute any remaining multi-letter subscripts: _{foo} or _{abc1}.
    def _sub_sub(m: re.Match) -> str:
        body = m.group(1)
        # Single-char bodies and numeric-only bodies are fine as-is.
        if len(body) == 1 or body.isdigit():
            return m.group(0)
        # Numeric suffix preserved: I_{sp2} → _{ξ_{2}}? Skip numeric — just
        # replace the whole alphabetic run; SymPy can handle `_{ξ}` either
        # way, but it can't recover the original text. We take the simple
        # path: only substitute when the body is purely alphabetic, keeping
        # the "sp" → "ξ" round-trip trivial.
        if not body.isalpha():
            return m.group(0)
        k = allocate(body)
        return f"_{{\\{k}}}" if k else m.group(0)
    latex = re.sub(r"_\{([^{}]+)\}", _sub_sub, latex)

    return latex, mapping


def _restore_subscripts_in_graph(graph: dict, mapping: dict[str, str]) -> None:
    """Walk *graph* and swap each Greek placeholder back to the original body.

    Modifies ``graph`` in-place. Touches ``id``, ``label``, ``latex``, and
    ``subexpr`` on every node, and the ``from``/``to`` refs on every edge.
    """
    if not mapping:
        return
    # Sort keys so longer placeholders win (avoid partial clobber — though
    # Greek names never share prefixes in our pool, this is defensive).
    items = sorted(mapping.items(), key=lambda kv: -len(kv[0]))

    def rewrite(s: str) -> str:
        if not isinstance(s, str):
            return s
        for greek_name, original in items:
            # latex form: \xi → original
            s = s.replace(f"\\{greek_name}", original)
            # sympy id form: bare name → original. Scope to subscript
            # context to avoid matching unrelated substrings in operator
            # subexprs.
            s = s.replace(f"{{{greek_name}}}", f"{{{original}}}")
        return s

    for node in graph.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        for field in ("id", "label", "latex", "subexpr"):
            if field in node and isinstance(node[field], str):
                node[field] = rewrite(node[field])
    for edge in graph.get("edges") or []:
        if not isinstance(edge, dict):
            continue
        for field in ("from", "to"):
            if field in edge and isinstance(edge[field], str):
                edge[field] = rewrite(edge[field])


_CHAIN_RELATION_COMMANDS = ("\\approx", "\\simeq", "\\equiv")


def _split_equation_chain_sides(latex: str) -> list[str]:
    """Split *latex* on top-level equality-like operators.

    Splits on bare ``=`` and the relational commands ``\\approx``,
    ``\\simeq``, ``\\equiv``. Returns the ordered list of sides (trimmed).
    A non-chained expression returns a single-element list.
    """
    if not isinstance(latex, str) or not latex:
        return []
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    L = len(latex)
    while i < L:
        c = latex[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth = max(0, depth - 1)
        split_adv = 0
        if depth == 0:
            for cmd in _CHAIN_RELATION_COMMANDS:
                if latex.startswith(cmd, i):
                    split_adv = len(cmd)
                    break
            if split_adv == 0 and c == '=':
                prev = latex[i - 1] if i > 0 else ''
                nxt = latex[i + 1] if i + 1 < L else ''
                if prev != '\\' and nxt != '=':
                    split_adv = 1
        if split_adv:
            parts.append(''.join(buf).strip())
            buf = []
            i += split_adv
            continue
        buf.append(c)
        i += 1
    parts.append(''.join(buf).strip())
    return [p for p in parts if p]


def _derive_equation_chain_graph(latex: str) -> dict | None:
    """Derive a semantic graph for a possibly-chained equation.

    For ``a = b = c = d`` each side is parsed as its own expression sub-graph,
    then all sub-graphs are merged into a single graph whose roots converge
    on one central ``__equals_1`` operator node. Repeated variables (e.g.
    ``v_e`` appearing in two sides) share the same node so the graph captures
    the cross-links naturally.

    For a single expression or a plain ``a = b`` equation, delegates to the
    ordinary single-expression derivation.
    """
    if not isinstance(latex, str) or not latex:
        return None
    sides = _split_equation_chain_sides(latex)
    if len(sides) <= 1:
        return _derive_semantic_graph(latex)
    if len(sides) == 2:
        return _derive_semantic_graph(f"{sides[0]} = {sides[1]}")

    try:
        l2g = _load_script_module("scripts/latex_to_graph.py", "latex_to_graph")
    except Exception as e:
        print(f"   ⚠️  chain derivation: could not load latex_to_graph: {e}")
        return None
    if l2g is None:
        return None

    merged_nodes: dict[str, dict] = {}
    merged_edges: list[dict] = []
    roots: list[str] = []
    # Shared across sides: the RHS of one step commonly contains vars
    # dot-accented on a previous side, and the display restore pass needs
    # to know about all of them regardless of which side introduced them.
    dotted_vars: dict[str, int] = {}

    for si, side in enumerate(sides):
        # Lift ``\dot{m}`` → ``\frac{d m}{d t}`` (SymPy doesn't understand
        # overhead-dot notation natively but does produce ``Derivative``
        # nodes from the fraction form). Then peel visual accents
        # (\vec, \hat, \mathbf, …) so SymPy sees ``F_{action}`` rather
        # than an unknown ``\vec`` token. Track what got stripped so we
        # can restore the display latex post-parse.
        deriv_side = _rewrite_dot_derivatives(side, dotted_vars)
        deriv_side = _normalize_frac_derivatives(deriv_side)
        accent_map: dict[str, str] = {}
        clean_side = _strip_accent_commands(deriv_side, accent_map)
        rewritten, mapping = _substitute_multichar_subscripts(clean_side)
        try:
            sub = l2g.latex_to_semantic_graph(rewritten)
        except Exception as e:
            print(f"   ⚠️  chain side parse failed ({side!r}): {e}")
            return None
        if not isinstance(sub, dict) or not sub.get("nodes"):
            return None
        _restore_subscripts_in_graph(sub, mapping)
        _restore_accents_in_graph(sub, accent_map)
        _restore_dot_notation_in_graph(sub, dotted_vars)

        prefix = f"s{si}_"
        def _rename(nid: str, p: str = prefix) -> str:
            return p + nid if nid.startswith("__") else nid

        # Merge nodes. Variables (no ``__`` prefix) collapse by id; operators
        # are scoped per-side so we don't collide across sub-graphs.
        for n in sub.get("nodes") or []:
            if not isinstance(n, dict):
                continue
            nid = n.get("id")
            if not isinstance(nid, str):
                continue
            new_id = _rename(nid)
            cloned = dict(n)
            cloned["id"] = new_id
            if new_id not in merged_nodes:
                merged_nodes[new_id] = cloned
            else:
                # Variable already present — keep existing richness, fill gaps.
                existing = merged_nodes[new_id]
                for k, v in cloned.items():
                    existing.setdefault(k, v)

        for e in sub.get("edges") or []:
            merged_edges.append({
                "from": _rename(e.get("from", "")),
                "to": _rename(e.get("to", "")),
            })

        # Identify this side's root (node with no outgoing edge in its own
        # sub-graph). Fallback: the sole node if the side is atomic.
        out_set = {e.get("from") for e in sub.get("edges") or []}
        root_candidates = [
            n.get("id") for n in sub.get("nodes") or []
            if isinstance(n, dict) and n.get("id") not in out_set
        ]
        if root_candidates:
            roots.append(_rename(root_candidates[0]))
        else:
            roots.append(_rename(sub["nodes"][0].get("id", "")))

    # Central equals node — every side points into it.
    equals_id = "__equals_1"
    merged_nodes[equals_id] = {
        "id": equals_id,
        "type": "operator",
        "op": "equals",
        "subexpr": " = ".join(sides),
    }
    for r in roots:
        if r:
            merged_edges.append({"from": r, "to": equals_id})

    return {
        "nodes": list(merged_nodes.values()),
        "edges": merged_edges,
        "classification": {"kind": "algebraic"},
    }


def _derive_semantic_graph(
    math_src: str,
    domain: str | None = None,
) -> dict | None:
    """Parse *math_src* and return a semantic-graph dict, or None on failure.

    Results are memoized — scenes often repeat the same subexpression, and
    sympy's LaTeX parser is not cheap. The cache key includes *domain* so
    domain-specific labelling doesn't leak between calls.
    """
    if not isinstance(math_src, str):
        return None
    key = (math_src, domain) if domain else math_src
    if key in _latex_graph_cache:
        return _latex_graph_cache[key]
    # Rewrite ``\dot{m}`` → ``\frac{d m}{d t}`` first so SymPy sees a real
    # derivative. Capture the dotted variables so the display pass can
    # restore ``\dot{m}`` notation in subexprs after SymPy has emitted
    # canonical ``\frac{d}{d t} m`` text. Then peel purely-visual accents
    # (\vec, \hat, \mathbf, …) that SymPy can't parse, then swap multi-char
    # subscripts (\text{prop}, _{sp}, …) with Greek placeholders so SymPy
    # treats them as atomic symbols, then restore.
    dotted_vars: dict[str, int] = {}
    deriv_src = _rewrite_dot_derivatives(math_src, dotted_vars)
    deriv_src = _normalize_frac_derivatives(deriv_src)
    accent_map: dict[str, str] = {}
    stripped = _strip_accent_commands(deriv_src, accent_map)
    rewritten, mapping = _substitute_multichar_subscripts(stripped)
    try:
        l2g = _load_script_module("scripts/latex_to_graph.py", "latex_to_graph")
        if l2g is None:
            graph = None
        elif domain:
            graph = l2g.latex_to_semantic_graph(rewritten, domain=domain)
        else:
            graph = l2g.latex_to_semantic_graph(rewritten)
    except Exception as e:  # pragma: no cover — parser errors, keep scene loadable
        print(f"   ⚠️  auto-graph failed for {math_src!r}: {e}")
        graph = None
    # Reject degenerate graphs that come back as a single ``__expr_*`` node —
    # that's what SymPy emits when it collapses a chained equality into a
    # Boolean. Returning None lets the caller fall through and show the
    # "no graph" empty state instead of a confusing pseudo-node.
    if isinstance(graph, dict):
        nodes = graph.get('nodes') or []
        if (len(nodes) == 1 and isinstance(nodes[0], dict)
                and isinstance(nodes[0].get('id'), str)
                and nodes[0]['id'].startswith('__expr_')):
            graph = None
        else:
            _restore_subscripts_in_graph(graph, mapping)
            _restore_accents_in_graph(graph, accent_map)
            _restore_dot_notation_in_graph(graph, dotted_vars)
    _latex_graph_cache[key] = graph
    return graph


def _extract_htmlclass_pairs(latex: str) -> list[tuple[str, str]]:
    """Return ``[(class_key, body_latex), ...]`` for every ``\\htmlClass`` span.

    ``class_key`` drops the ``hl-`` prefix so it matches the keys in a step's
    ``highlights`` dict. Nested ``\\htmlClass`` wrappers are reported at the
    outer level only (the inner body still appears verbatim as the body).
    """
    if not isinstance(latex, str) or "\\htmlClass" not in latex:
        return []
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(latex):
        # Look for \htmlClass{class}{body}
        if latex.startswith("\\htmlClass{", i):
            j = i + len("\\htmlClass{")
            # class token
            k = latex.find("}", j)
            if k == -1:
                break
            class_name = latex[j:k]
            # body — find matching brace
            if k + 1 >= len(latex) or latex[k + 1] != '{':
                i = k + 1
                continue
            b_start = k + 2
            depth = 1
            b = b_start
            while b < len(latex) and depth > 0:
                c = latex[b]
                if c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0:
                        break
                b += 1
            body = latex[b_start:b]
            key = class_name[3:] if class_name.startswith("hl-") else class_name
            out.append((key, body.strip()))
            i = b + 1
        else:
            i += 1
    return out


def _apply_highlights_to_graph(
    graph: dict,
    hl_pairs: list[tuple[str, str]],
    highlights_meta: dict,
) -> None:
    """Overlay step-level highlight metadata onto matching graph nodes.

    For each ``(class_key, body)`` pair harvested from the raw math, find the
    node whose latex/id matches ``body`` and annotate it with the highlight's
    ``color``, human ``label``, and the original ``hl_class`` tag.
    """
    if not graph or not hl_pairs or not isinstance(highlights_meta, dict):
        return
    nodes = graph.get("nodes") or []

    def _normalize(s: str) -> str:
        """Normalize LaTeX for comparison — peel visual accents (``\\vec``,
        ``\\hat``, ``\\mathbf``, …) *and* dot-derivative wrappers
        (``\\dot``/``\\ddot``/...) so ``\\htmlClass{hl-mdot}{\\dot{m}}``
        still matches the graph's ``m`` variable node after the dot→frac
        pre-parse rewrite. Braces single-char subscripts (``v_e`` →
        ``v_{e}``) and strips spaces so both authoring forms match.
        """
        if not isinstance(s, str):
            return ""
        s = _strip_accent_commands(s)
        # Repeatedly peel ``\dot{X}``/``\ddot{X}``/... → ``X`` (loop handles
        # nested cases like ``\ddot{\vec{p}}`` after the accent strip above).
        prev = None
        while prev != s:
            prev = s
            for cmd in _DOT_ACCENT_ORDERS:
                s = re.sub(rf"\\{cmd}\{{([^{{}}]*)\}}", r"\1", s)
        s = re.sub(r"_([A-Za-z0-9])(?![A-Za-z0-9_{])", r"_{\1}", s)
        return s.replace(" ", "")

    def _keys_for_node(n: dict) -> list[str]:
        keys: list[str] = []
        for f in ("latex", "id"):
            v = n.get(f)
            if isinstance(v, str):
                keys.append(_normalize(v))
        return keys

    # Also normalize body latex (strip surrounding whitespace; keep \text{}
    # wrappers — restored subscripts should match).
    for class_key, body in hl_pairs:
        body = _normalize(body)
        meta = highlights_meta.get(class_key)
        if not isinstance(meta, dict):
            continue
        matched: dict | None = None
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if node.get("type") in ("operator", "relation"):
                continue
            if body in _keys_for_node(node):
                matched = node
                break
        if matched is None:
            continue
        # Attach highlight metadata. Respect existing fields so hand-authored
        # richness wins over auto-derived overlays.
        if "color" in meta and not matched.get("color"):
            matched["color"] = meta["color"]
        if meta.get("label") and not matched.get("description"):
            matched["description"] = meta["label"]
        matched.setdefault("hl_class", f"hl-{class_key}")


# Match any `\htmlClass{...}{body}` wrapper (may be nested) and peel it off.
_HTML_CLASS_RE = re.compile(r"\\htmlClass\{[^}]*\}\{")

def _strip_html_class(latex: str) -> str:
    """Remove `\\htmlClass{...}{...}` wrappers, keeping only the inner body.

    AlgeBench scenes annotate math with `\\htmlClass{hl-X}{...}` for
    step-highlighting. These cannot be parsed by SymPy's LaTeX parser, so we
    strip them before handing the expression off to the graph builder.
    """
    if not isinstance(latex, str) or "\\htmlClass" not in latex:
        return latex
    out = []
    i = 0
    while i < len(latex):
        m = _HTML_CLASS_RE.match(latex, i)
        if not m:
            out.append(latex[i])
            i += 1
            continue
        # We're at `\htmlClass{class}{` — find matching `}` for the body.
        i = m.end()
        depth = 1
        while i < len(latex) and depth > 0:
            c = latex[i]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    break
            out.append(c)
            i += 1
        i += 1  # skip closing `}`
    return ''.join(out)


def _autofill_semantic_graphs(scene: dict) -> dict:
    """Walk a scene spec and populate missing ``semanticGraph`` fields in-place.

    For each proof step that has ``math`` but no ``semanticGraph``, attempt to
    derive a graph via ``scripts/latex_to_graph.py`` and attach it under the
    standard ``{"graph": {...}}`` wrapper.

    Returns the same dict for chaining. Silently skips anything that doesn't
    look like a scene with proofs — safe to call on any JSON.
    """
    if not isinstance(scene, dict):
        return scene
    scenes_list = scene.get('scenes')
    if not isinstance(scenes_list, list):
        return scene
    filled = 0
    for sc in scenes_list:
        if not isinstance(sc, dict):
            continue
        proof = sc.get('proof')
        if not isinstance(proof, dict):
            continue
        steps = proof.get('steps')
        if not isinstance(steps, list):
            continue
        for step in steps:
            if not isinstance(step, dict):
                continue
            if step.get('semanticGraph'):
                continue
            math_src = step.get('math')
            if not math_src:
                continue
            # Capture highlight bindings (\htmlClass{hl-X}{body}) BEFORE the
            # wrappers are stripped so we can map the class back to a node.
            hl_pairs = _extract_htmlclass_pairs(math_src)
            cleaned = _strip_html_class(math_src)
            # Full-chain derivation: every side becomes part of the graph,
            # converging on a single central ``__equals_1`` operator node.
            graph = _derive_equation_chain_graph(cleaned)
            if graph:
                _apply_highlights_to_graph(
                    graph, hl_pairs, step.get('highlights') or {},
                )
                step['semanticGraph'] = {'graph': graph, 'autoDerived': True}
                filled += 1
    if filled:
        title = scene.get('title') or '(scene)'
        print(f"   ✨ auto-derived {filled} semantic graph(s) for {title}")
    return scene

try:
    from gemini_live_tools import GeminiLiveAPI, pcm_to_wav_bytes, get_static_content as _glt_static, _split_sentences
    TTS_AVAILABLE = True
except ImportError:
    _glt_static = None
    TTS_AVAILABLE = False
static_dir   = script_dir / "static"
chat_js_path = static_dir / "chat.js"

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
GEMINI_MODEL   = os.environ.get('GEMINI_MODEL', 'gemini-3-flash-preview')

DEFAULT_PORT = 8785

index_html_path = static_dir / "index.html"
style_css_path  = static_dir / "style.css"

# ---------------------------------------------------------------------------
# Agent session memory — persists across turns within one server session.
# Stores eval_math results (and anything else) under agent-chosen keys.
# Cleared on server start; agents control what's stored via store_as param.
# ---------------------------------------------------------------------------
_agent_memory: dict = {}


def print(*args, **kwargs):
    """Best-effort logging: detached stdout/stderr should not break request handling."""
    try:
        return builtins.print(*args, **kwargs)
    except BrokenPipeError:
        return None
    except OSError as e:
        if getattr(e, "errno", None) == 32:
            return None
        raise


def _memory_summary(key: str, value) -> str:
    """Human-readable one-liner describing a stored value."""
    if isinstance(value, list):
        if value and isinstance(value[0], list):
            return f"list of {len(value)} lists (e.g. {len(value[0])}-element)"
        return f"list [{len(value)} items]"
    if isinstance(value, (int, float)):
        return f"scalar {value}"
    return str(type(value).__name__)


def _resolve_memory_refs(obj):
    """Recursively replace '$key' strings with values from _agent_memory."""
    if isinstance(obj, str) and obj.startswith('$'):
        key = obj[1:]
        if key in _agent_memory:
            return _agent_memory[key]
        return obj  # unknown key — leave as-is
    if isinstance(obj, dict):
        return {k: _resolve_memory_refs(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_resolve_memory_refs(item) for item in obj]
    return obj


def kill_server_on_port(port):
    """Kill any process using the specified port."""
    try:
        result = subprocess.run(
            ['lsof', '-ti', f':{port}'],
            capture_output=True, text=True
        )
        if result.stdout.strip():
            pids = result.stdout.strip().split('\n')
            for pid in pids:
                try:
                    os.kill(int(pid), signal.SIGTERM)
                    print(f"Stopped previous server (PID: {pid})")
                except (ProcessLookupError, ValueError):
                    pass
            elapsed = 0
            while elapsed < 3:
                check = subprocess.run(['lsof', '-ti', f':{port}'],
                                       capture_output=True, text=True)
                if not check.stdout.strip():
                    break
                time.sleep(0.1)
                elapsed += 0.1
    except Exception:
        pass


def list_builtin_scenes():
    """Return list of built-in scene names."""
    if not scenes_dir.exists():
        return []
    return sorted([
        f.stem for f in scenes_dir.glob("*.json")
    ])


def load_builtin_scene(name):
    """Load a built-in scene JSON by name."""
    path = (scenes_dir / f"{name}.json").resolve()
    try:
        path.relative_to(scenes_dir.resolve())
    except ValueError:
        return None
    if path.exists():
        with open(path, 'r') as f:
            return json.load(f)
    return None


def resolve_scene_path(scene_arg):
    """Resolve scene path from CLI/API input."""
    if not scene_arg:
        return None
    raw = str(scene_arg)
    candidate = Path(raw).expanduser()
    candidates = [candidate]
    if not candidate.is_absolute():
        candidates = [Path.cwd() / candidate, script_dir / candidate, scenes_dir / candidate]
    for path in candidates:
        if path.exists() and path.is_file():
            return path.resolve()
    return None


FAVICON_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="15" fill="#1a1a2e"/>
<line x1="20" y1="75" x2="80" y2="75" stroke="#ff4444" stroke-width="4"/>
<line x1="20" y1="75" x2="20" y2="15" stroke="#44ff44" stroke-width="4"/>
<line x1="20" y1="75" x2="55" y2="50" stroke="#4488ff" stroke-width="4"/>
<line x1="20" y1="75" x2="70" y2="30" stroke="#ffaa00" stroke-width="5" stroke-linecap="round"/>
<circle cx="70" cy="30" r="4" fill="#ffaa00"/>
</svg>'''


def generate_html(debug=False):
    """Read index.html and inject the debug flag."""
    debug_mode_js = "true" if debug else "false"
    with open(index_html_path, 'r') as f:
        return f.read().replace('__DEBUG_MODE__', debug_mode_js)

from agent_tools import (
    ALL_TOOL_DECLS, _make_tools, build_system_prompt,
    NAVIGATE_TOOL_DECL, SET_CAMERA_TOOL_DECL, ADD_SCENE_TOOL_DECL,
    SET_SLIDERS_TOOL_DECL, EVAL_MATH_TOOL_DECL,
    MEM_GET_TOOL_DECL, MEM_SET_TOOL_DECL,
    SET_PRESET_PROMPTS_TOOL_DECL, SET_INFO_OVERLAY_TOOL_DECL,
)
from gemini_live_tools import safe_eval_math, eval_math_sweep, MATH_NAMES, HAS_NUMPY


# Lazy-initialized Gemini client
_gemini_client = None

def get_gemini_client():
    global _gemini_client
    if _gemini_client is None and GEMINI_API_KEY:
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    return _gemini_client


def _detect_navigation(message, context):
    """Detect simple navigation commands and return (scene, step, direction) or None."""
    msg = message.strip().lower()
    nav_next = msg in ('next', 'next step', 'continue', 'go on', 'forward', 'n')
    nav_prev = msg in ('previous', 'prev', 'back', 'go back', 'previous step', 'p')
    if not nav_next and not nav_prev:
        return None

    scene_num = context.get('sceneNumber', 1)
    runtime = context.get('runtime', {})
    current_step = runtime.get('stepNumber', 0)  # 0=root, 1=first step
    scene = context.get('currentScene', {})
    total_steps = len(scene.get('steps', []))

    if nav_next:
        target_step = current_step + 1
        if target_step > total_steps:
            # At last step — try next scene
            total_scenes = context.get('totalScenes', 1)
            if scene_num < total_scenes:
                return (scene_num + 1, 0, 'next_scene')
            return None  # nowhere to go
        return (scene_num, target_step, 'next')
    else:  # nav_prev
        target_step = current_step - 1
        if target_step < 0:
            # At root — try previous scene
            if scene_num > 1:
                return (scene_num - 1, 0, 'prev_scene')
            return None
        return (scene_num, target_step, 'prev')


def _extract_inline_preset_prompts(text, tool_calls):
    """Detect {"prompts": [...]} JSON embedded in text by Gemini instead of a tool call.
    Strips it from the text and appends a synthetic set_preset_prompts tool call entry."""
    import re
    match = re.search(r'\{[^{}]*"prompts"\s*:\s*\[[^\]]*\][^{}]*\}', text, re.DOTALL)
    if not match:
        return text
    try:
        obj = json.loads(match.group(0))
        prompts = obj.get('prompts')
        if not isinstance(prompts, list):
            return text
    except (json.JSONDecodeError, ValueError):
        return text
    print(f"   ⚠️  Gemini wrote set_preset_prompts as inline JSON — recovering: {prompts}")
    tool_calls.append({
        "name": "set_preset_prompts",
        "rawArgs": {"prompts": prompts},
        "args": {"prompts": prompts},
        "result": {"status": "success", "count": len(prompts),
                   "message": f"Set {len(prompts)} preset prompt{'s' if len(prompts) != 1 else ''}."},
    })
    cleaned = (text[:match.start()] + text[match.end():]).strip()
    return cleaned


def call_gemini_chat(message, history, context):
    """Call Gemini API using google-genai SDK. Returns (response_text, tool_calls_list, debug_info)."""
    client = get_gemini_client()
    if not client:
        return "AI chat is not available (no API key configured).", [], {}

    # Handle simple navigation deterministically — don't rely on the agent
    nav = _detect_navigation(message, context)
    if nav:
        scene_num, step_num, direction = nav
        current_scene = context.get('currentScene', {})

        # For same-scene navigation, use current scene data.
        # For cross-scene, look up the target scene from the scene tree.
        scene_tree = context.get('sceneTree', [])
        if direction in ('next_scene', 'prev_scene'):
            # Get target scene info from scene tree
            target_idx = scene_num - 1
            if 0 <= target_idx < len(scene_tree):
                tree_entry = scene_tree[target_idx]
                step_title = tree_entry.get('title', '')
                step_desc = ''
                steps = tree_entry.get('steps', [])
            else:
                step_title = ''
                step_desc = ''
                steps = []
        else:
            steps = current_scene.get('steps', [])
            if step_num == 0:
                step_title = current_scene.get('title', '')
                step_desc = current_scene.get('description', '')
            elif 1 <= step_num <= len(steps):
                s = steps[step_num - 1]
                step_title = s.get('title', '')
                step_desc = s.get('description', '')
            else:
                step_title = ''
                step_desc = ''

        tc_result = {"status": "success", "navigated": True,
                     "scene": scene_num, "step": step_num}
        tool_calls = [{"name": "navigate_to", "args": {"scene": scene_num, "step": step_num}, "result": tc_result}]

        # Update context to reflect the navigation target so the system prompt is current
        context['sceneNumber'] = scene_num
        if 'runtime' not in context:
            context['runtime'] = {}
        context['runtime']['stepNumber'] = step_num

        # Rewrite navigation command into an explanation request.
        # The agent sees the updated Current State and knows what step it's on.
        explain_prompt = "What am I looking at now?"

        # Build system prompt with updated context
        system_prompt = build_system_prompt(context, agent_memory=_agent_memory)
        contents = []
        for msg in (history or []):
            role = 'user' if msg.get('role') == 'user' else 'model'
            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=msg.get('text', ''))]))
        contents.append(types.Content(role='user', parts=[types.Part.from_text(text=explain_prompt)]))

        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            tools=_make_tools('navigate_to'),
            temperature=0.7,
        )
        print(f"   ⏩ Auto-navigation: scene {scene_num}, step {step_num} ({direction})")

        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=contents,
                config=config,
            )
            text = ""
            if response.candidates and response.candidates[0].content.parts:
                text = "".join(p.text for p in response.candidates[0].content.parts if p.text)
            debug_info = {"systemPrompt": system_prompt, "contents": [c.to_json_dict() for c in contents]}
            return text.strip() or "Let me walk you through this step.", tool_calls, debug_info
        except Exception as e:
            return f"Navigated to step {step_num}.", tool_calls, {}

    system_prompt = build_system_prompt(context, agent_memory=_agent_memory)

    # Build contents list
    contents = []
    for msg in (history or []):
        role = 'user' if msg.get('role') == 'user' else 'model'
        contents.append(types.Content(role=role, parts=[types.Part.from_text(text=msg.get('text', ''))]))

    # Add current user message
    contents.append(types.Content(role='user', parts=[types.Part.from_text(text=message)]))

    # Log history summary
    if DEBUG_MODE:
        for i, msg in enumerate(history or []):
            preview = (msg.get('text', '') or '')[:80].replace('\n', ' ')
            print(f"   💬 history[{i}] {msg.get('role','?')}: {preview}")
        print(f"   💬 current: {message[:80]}")

    tool_calls = []
    added_scenes_count = 0
    max_turns = 10

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=_make_tools(),
        temperature=0.7,
    )

    # Build debug payload — the full picture of what Gemini sees
    debug_info = {
        "systemPrompt": system_prompt,
        "contents": [c.to_json_dict() for c in contents],
    }

    # Log request summary
    if DEBUG_MODE:
        tool_names = [d.name for d in config.tools[0].function_declarations] if config.tools else []
        print(f"   🤖 Gemini request: model={GEMINI_MODEL}, {len(contents)} messages, tools=[{', '.join(tool_names)}], system_prompt={len(system_prompt)} chars")

    if DEBUG_MODE:
        print(f"\n🤖 GEMINI REQUEST: {json.dumps({'model': GEMINI_MODEL, **debug_info})}\n")

    for turn in range(max_turns):
        if turn > 0:
            print(f"   🔄 Gemini turn {turn + 1}/{max_turns} ({len(contents)} messages)")
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=contents,
                config=config,
            )
        except Exception as e:
            return f"Gemini API error: {str(e)}", [], debug_info

        # Log finish reason for debugging
        finish = None
        if response.candidates:
            candidate = response.candidates[0]
            finish = getattr(candidate, 'finish_reason', None)
            if DEBUG_MODE and finish:
                print(f"   Gemini finish_reason: {finish}")
            if str(finish) not in ('MAX_TOKENS', 'STOP', 'FinishReason.MAX_TOKENS', 'FinishReason.STOP'):
                print(f"   ⚠️  Unexpected finish_reason: {finish}")

        if not response.candidates:
            return "", tool_calls, debug_info

        parts = response.candidates[0].content.parts
        if not parts:
            print(f"   ⚠️  Empty parts (Gemini returned STOP with no content) — nudging to respond")
            contents.append(types.Content(role='model', parts=[types.Part.from_text(text="(no response)")]))
            contents.append(types.Content(role='user', parts=[types.Part.from_text(
                text="Please respond to my request.")]))
            continue

        # Log all response parts for debugging
        if DEBUG_MODE:
            for i, p in enumerate(parts):
                if p.text:
                    print(f"   📝 part[{i}].text: {p.text}")
                if p.function_call:
                    fc = p.function_call
                    print(f"   🔧 part[{i}].function_call: {fc.name}({json.dumps(dict(fc.args) if fc.args else {}, default=str)[:300]})")
                if not p.text and not p.function_call:
                    print(f"   ❓ part[{i}] unknown: {str(p)[:300]}")

        # Handle malformed function call — retry
        if str(finish) in ('MALFORMED_FUNCTION_CALL', 'FinishReason.MALFORMED_FUNCTION_CALL'):
            print(f"   ❌ Malformed function call — asking Gemini to retry")
            contents.append(types.Content(role='model', parts=parts))
            contents.append(types.Content(role='user', parts=[types.Part.from_text(
                text="Your previous function call was malformed. Please respond with plain text instead, or retry the tool call with valid JSON arguments.")]))
            continue

        # Check for function calls vs text. Gemini may return multiple function calls
        # in a single turn; execute all of them in order.
        function_calls = []
        text_response = ""
        for part in parts:
            if part.function_call:
                function_calls.append(part.function_call)
            if part.text:
                text_response += part.text

        if function_calls:
            # Preserve the model response (including thought_signature) once.
            contents.append(types.Content(role='model', parts=parts))
            must_continue = False

            for fc in function_calls:
                tc_name = fc.name

                # Convert args to plain Python dict (handle proto objects)
                tc_args = {}
                if fc.args:
                    # Try multiple conversion strategies for proto Struct/MapComposite
                    raw_args = fc.args
                    if hasattr(raw_args, 'model_dump'):
                        tc_args = raw_args.model_dump()
                    elif hasattr(raw_args, 'to_json_dict'):
                        tc_args = raw_args.to_json_dict()
                    elif isinstance(raw_args, dict):
                        tc_args = dict(raw_args)
                    else:
                        tc_args = dict(raw_args)

                    # Deep-convert any remaining proto objects to plain Python types
                    def _to_plain(obj):
                        if isinstance(obj, (str, int, float, bool, type(None))):
                            return obj
                        if isinstance(obj, dict):
                            return {k: _to_plain(v) for k, v in obj.items()}
                        if isinstance(obj, (list, tuple)):
                            return [_to_plain(v) for v in obj]
                        # Proto MapComposite, RepeatedComposite, etc.
                        if hasattr(obj, 'items'):
                            return {k: _to_plain(v) for k, v in obj.items()}
                        if hasattr(obj, '__iter__'):
                            return [_to_plain(v) for v in obj]
                        return str(obj)

                    tc_args = _to_plain(tc_args)
                raw_tc_args = json.loads(json.dumps(tc_args, default=str))

                # Log the full tool call JSON
                if DEBUG_MODE:
                    print(f"\n🔧 TOOL CALL: {tc_name}")
                    try:
                        print(json.dumps(tc_args, indent=2, ensure_ascii=True, default=str))
                    except Exception as log_err:
                        print(f"   (could not serialize args: {log_err})")
                        print(f"   args keys: {list(tc_args.keys())}")

                # For add_scene: the scene properties are now top-level args (not nested under "scene")
                if tc_name == 'add_scene':
                    # Resolve $key memory references in element fields before building the scene
                    tc_args = _resolve_memory_refs(tc_args)
                    # Unwrap if agent nested the scene under a "scene" key (common hallucination)
                    if isinstance(tc_args.get('scene'), dict) and 'title' in tc_args.get('scene', {}):
                        print(f"   ⚠️  add_scene: agent wrapped scene under 'scene' key — unwrapping")
                        tc_args = {**tc_args['scene']}
                    # Build scene object from top-level args
                    scene_obj = {k: v for k, v in tc_args.items() if k not in ('_parseError',)}
                    # Normalize misplaced top-level sliders into the first step.
                    # Renderer only registers sliders from step.sliders.
                    normalized_root_sliders = False
                    root_sliders = scene_obj.get('sliders')
                    if isinstance(root_sliders, list) and len(root_sliders) > 0:
                        steps = scene_obj.get('steps')
                        if not isinstance(steps, list):
                            steps = []
                        if len(steps) == 0 or not isinstance(steps[0], dict):
                            steps.insert(0, {
                                "title": "Interactive Controls",
                                "description": "Adjust sliders to explore the scene interactively.",
                                "sliders": root_sliders
                            })
                        else:
                            first = steps[0]
                            existing = first.get('sliders')
                            if not isinstance(existing, list):
                                first['sliders'] = list(root_sliders)
                            else:
                                seen = {s.get('id') for s in existing if isinstance(s, dict)}
                                for s in root_sliders:
                                    if isinstance(s, dict) and s.get('id') not in seen:
                                        existing.append(s)
                        scene_obj['steps'] = steps
                        scene_obj.pop('sliders', None)
                        normalized_root_sliders = True
                        print(f"   ⚠️  add_scene: normalized {len(root_sliders)} root-level sliders into step 1")
                    tc_args['parsedScene'] = scene_obj
                    if normalized_root_sliders:
                        tc_args['_normalizedRootSliders'] = True
                    if DEBUG_MODE:
                        print(f"   ✅ scene object — {len(scene_obj.get('elements', []))} elements, "
                              f"{len(scene_obj.get('steps', []))} steps, title: {scene_obj.get('title', '?')}")
                # Track add_scene calls so navigate_to validation accounts for newly added scenes
                if tc_name == 'add_scene':
                    added_scenes_count = added_scenes_count + 1

                # Build tool result with context
                scene_count = len(context.get('sceneTree', [])) + added_scenes_count
                if tc_name == 'add_scene':
                    new_scene_num = scene_count  # 1-based number of the newly added scene
                    tc_result = {"status": "success", "newSceneNumber": new_scene_num,
                                 "message": f"Scene added as scene {new_scene_num}. The client will auto-navigate to it. Do NOT call navigate_to."}
                    if tc_args.get('_normalizedRootSliders'):
                        tc_result["note"] = "Moved top-level sliders into step 1 (renderer expects step.sliders)."
                elif tc_name == 'navigate_to':
                    # Agent sends 1-based scene numbers
                    req_scene = int(tc_args.get('scene', 0))  # 1-based
                    req_step = int(tc_args.get('step', 0))
                    # Validate scene (1-based: valid range is 1 to scene_count)
                    if req_scene < 1 or req_scene > scene_count:
                        tc_result = {"status": "error",
                                     "error": f"Scene {req_scene} out of range. Valid: 1-{scene_count}. Check Lesson Structure in system prompt."}
                        print(f"   ❌ navigate_to: scene {req_scene} out of bounds (1-{scene_count})")
                    elif req_step < 0:
                        tc_result = {"status": "error",
                                     "error": f"Step {req_step} invalid. Use 0 for root, 1 for first step, etc."}
                        print(f"   ❌ navigate_to: step {req_step} is negative")
                    else:
                        # Get step count for validation
                        scene_tree = context.get('sceneTree', [])
                        scene_idx_0 = req_scene - 1  # convert to 0-based for lookup
                        target_scene_steps = 0
                        if 0 <= scene_idx_0 < len(scene_tree):
                            target_scene_steps = len(scene_tree[scene_idx_0].get('steps', []))
                        if target_scene_steps > 0 and req_step > target_scene_steps:
                            tc_result = {"status": "error",
                                         "error": f"Step {req_step} out of range for scene {req_scene}. Has {target_scene_steps} steps. Valid: 0 (root) to {target_scene_steps}."}
                            print(f"   ❌ navigate_to: step {req_step} > max {target_scene_steps} for scene {req_scene}")
                        else:
                            tc_result = {"status": "success", "navigated": True,
                                         "scene": req_scene, "step": req_step}
                            # Include target step content so the agent can explain it
                            scene_data = context.get('currentScene', {})
                            if req_scene == context.get('sceneNumber'):
                                # Same scene — use currentScene directly
                                target_scene = scene_data
                            else:
                                # Different scene — look up from scene tree (limited info)
                                target_scene = {}
                            steps = target_scene.get('steps', [])
                            if req_step == 0:
                                tc_result["stepDescription"] = target_scene.get('description', '')
                                tc_result["stepTitle"] = target_scene.get('title', '')
                            elif 1 <= req_step <= len(steps):
                                step = steps[req_step - 1]
                                tc_result["stepDescription"] = step.get('description', '')
                                tc_result["stepTitle"] = step.get('title', '')
                elif tc_name == 'set_sliders':
                    values = tc_args.get('values', {})
                    available = context.get('runtime', {}).get('sliders', {})
                    results = {}
                    for sid, target in values.items():
                        if sid not in available:
                            results[sid] = {"status": "error", "error": f"Unknown slider '{sid}'"}
                        else:
                            s = available[sid]
                            clamped = max(s['min'], min(s['max'], float(target)))
                            results[sid] = {"status": "ok", "from": s['value'], "to": clamped}
                    tc_result = {"status": "success", "sliders": results}
                elif tc_name == 'eval_math':
                    expr = tc_args.get('expression', '')
                    raw_vars = tc_args.get('variables') or {}
                    # Strip spurious surrounding quotes from variable names (agent sometimes double-quotes keys)
                    variables = {k.strip("\"'"): v for k, v in raw_vars.items()}
                    # Convert new flat sweep shape {var, start, end, steps} or {var, values}
                    # into the internal format {var_name: spec} expected by eval_math_sweep
                    sweep_raw = tc_args.get('sweep') or None
                    sweep_var = tc_args.get('sweep_var') or None
                    if sweep_var:
                        if tc_args.get('sweep_values'):
                            sweep = {sweep_var: tc_args['sweep_values']}
                        elif 'sweep_start' in tc_args and 'sweep_end' in tc_args:
                            sweep = {sweep_var: {
                                'start': tc_args['sweep_start'],
                                'end':   tc_args['sweep_end'],
                                'steps': tc_args.get('sweep_steps', 64),
                            }}
                        else:
                            sweep = None
                    else:
                        sweep = None
                    store_as = tc_args.get('store_as') or None
                    # Auto-inject slider values and all agent memory keys as variables
                    for sid, s in context.get('runtime', {}).get('sliders', {}).items():
                        if sid not in variables:
                            variables[sid] = s['value']
                    for mem_key, mem_val in _agent_memory.items():
                        if mem_key not in variables:
                            variables[mem_key] = mem_val
                    if sweep:
                        result, error = eval_math_sweep(expr, variables, sweep)
                    else:
                        result, error = safe_eval_math(expr, variables)
                    if error:
                        tc_result = {"status": "error", "expression": expr, "error": error,
                                     "hint": "Fix the expression and call eval_math again, or call add_scene if you have enough data."}
                        print(f"   ❌ eval_math: {error}")
                    elif store_as:
                        _agent_memory[store_as] = result
                        summary = _memory_summary(store_as, result)
                        tc_result = {"status": "success", "stored_as": store_as, "summary": summary,
                                     "hint": f"Stored. Reference as variable '{store_as}' in eval_math, or as '${store_as}' in add_scene fields."}
                        if DEBUG_MODE:
                            print(f"   ✅ eval_math → memory['{store_as}']: {summary}")
                    else:
                        n = f"{len(result)}-point sweep" if isinstance(result, list) and sweep else result
                        tc_result = {"status": "success", "expression": expr, "result": result,
                                     "hint": "Tip: use store_as to save large arrays to memory instead of returning inline."}
                        if DEBUG_MODE:
                            print(f"   ✅ eval_math: {expr} = {n}")
                elif tc_name == 'mem_get':
                    key = tc_args.get('key', '')
                    if key == '?':
                        listing = {k: _memory_summary(k, v) for k, v in _agent_memory.items()}
                        tc_result = {"status": "success", "keys": listing if listing else "(empty)"}
                        if DEBUG_MODE:
                            print(f"   🗂️  mem_get(?): {list(_agent_memory.keys())}")
                    elif key in _agent_memory:
                        val = _agent_memory[key]
                        tc_result = {"status": "success", "key": key, "value": val,
                                     "summary": _memory_summary(key, val)}
                        if DEBUG_MODE:
                            print(f"   🗂️  mem_get('{key}'): {_memory_summary(key, val)}")
                    else:
                        tc_result = {"status": "error", "key": key,
                                     "error": f"Key '{key}' not found.",
                                     "available_keys": list(_agent_memory.keys())}
                        print(f"   ❌ mem_get('{key}'): not found")
                elif tc_name == 'mem_set':
                    key = tc_args.get('key', '')
                    value = tc_args.get('value')
                    if not key:
                        tc_result = {"status": "error", "error": "key is required"}
                    else:
                        _agent_memory[key] = value
                        summary = _memory_summary(key, value)
                        tc_result = {"status": "success", "stored_as": key, "summary": summary,
                                     "hint": f"Stored. Reference as variable '{key}' in eval_math, or as '${key}' in add_scene fields."}
                        if DEBUG_MODE:
                            print(f"   💾 mem_set['{key}']: {summary}")
                elif tc_name == 'set_preset_prompts':
                    prompts = tc_args.get('prompts', [])
                    tc_result = {
                        "status": "success",
                        "count": len(prompts),
                        "message": f"{'Set' if prompts else 'Cleared'} {len(prompts)} preset prompt{'s' if len(prompts) != 1 else ''}.",
                    }
                    if DEBUG_MODE:
                        print(f"   💬 set_preset_prompts: {prompts}")
                elif tc_name == 'set_info_overlay':
                    if tc_args.get('clear'):
                        tc_result = {"status": "success", "message": "Cleared all info overlays."}
                        if DEBUG_MODE:
                            print(f"   🖼️  set_info_overlay: cleared all")
                    else:
                        overlay_id = tc_args.get('id', '')
                        content = tc_args.get('content', '')
                        position = tc_args.get('position', 'top-left')
                        tc_result = {
                            "status": "success",
                            "id": overlay_id,
                            "position": position,
                            "message": f"Overlay '{overlay_id}' set at {position}.",
                        }
                        if DEBUG_MODE:
                            print(f"   🖼️  set_info_overlay['{overlay_id}'] @ {position}: {content[:60]}{'…' if len(content) > 60 else ''}")
                elif tc_name == 'navigate_proof':
                    proof_step = int(tc_args.get('step', 0))
                    reason = tc_args.get('reason', '')
                    tc_result = {
                        "action": "navigate_proof",
                        "step": proof_step,
                        "reason": reason,
                    }
                    if DEBUG_MODE:
                        print(f"   📐 navigate_proof: step={proof_step} reason={reason}")
                else:
                    tc_result = {"status": "success"}
                tool_calls.append({
                    "name": tc_name,
                    "rawArgs": raw_tc_args,
                    "args": tc_args,
                    "result": tc_result,
                })

                # navigate_to: update context, rebuild system prompt, and strip navigate_to
                # from tools so the agent explains instead of double-navigating.
                if tc_name == 'navigate_to' and tc_result.get('status') == 'success':
                    # Update context to reflect new position (same as deterministic path)
                    req_scene = int(tc_args.get('scene', 0))
                    req_step = int(tc_args.get('step', 0))
                    context['sceneNumber'] = req_scene
                    if 'runtime' not in context:
                        context['runtime'] = {}
                    context['runtime']['stepNumber'] = req_step
                    # Rebuild system prompt with updated state
                    updated_prompt = build_system_prompt(context, agent_memory=_agent_memory)

                    tc_result["message"] = "Navigation done. Now explain what the user is seeing."
                    config = types.GenerateContentConfig(
                        system_instruction=updated_prompt,
                        tools=_make_tools('navigate_to'),
                        temperature=config.temperature,
                    )
                    must_continue = True

                # set_sliders: update context with new values, rebuild prompt, strip tool.
                if tc_name == 'set_sliders' and tc_result.get('status') == 'success':
                    if 'runtime' not in context:
                        context['runtime'] = {}
                    if 'sliders' not in context['runtime']:
                        context['runtime']['sliders'] = {}
                    for sid, res in tc_result.get('sliders', {}).items():
                        if res.get('status') == 'ok' and sid in context['runtime']['sliders']:
                            context['runtime']['sliders'][sid]['value'] = res['to']
                    updated_prompt = build_system_prompt(context, agent_memory=_agent_memory)
                    tc_result["message"] = "Sliders animated. Now explain what changed in the visualization."
                    remaining_decls = [d for d in config.tools[0].function_declarations if d.name != 'set_sliders']
                    config = types.GenerateContentConfig(
                        system_instruction=updated_prompt,
                        tools=[types.Tool(function_declarations=remaining_decls)] if remaining_decls else [],
                        temperature=config.temperature,
                    )
                    must_continue = True

                # eval_math with store_as requires another model turn so the agent can
                # use the stored value in subsequent calls or explanation.
                if tc_name == 'eval_math' and tc_args.get('store_as'):
                    must_continue = True

                # Feed each tool response back to Gemini in call order.
                contents.append(types.Content(role='user', parts=[
                    types.Part.from_function_response(name=tc_name, response=tc_result)
                ]))

            if text_response.strip() and not must_continue:
                text_response = _extract_inline_preset_prompts(text_response, tool_calls)
                return text_response, tool_calls, debug_info
            continue
        else:
            text_response = _extract_inline_preset_prompts(text_response, tool_calls)
            return text_response or "I'm not sure how to respond to that.", tool_calls, debug_info

    text_response = _extract_inline_preset_prompts(text_response, tool_calls)
    return text_response, tool_calls, debug_info


DEBUG_MODE = False

def serve_and_open(initial_scene_path=None, port=DEFAULT_PORT, json_output=False, debug=False,
                   tts_parallelism=None, tts_min_buffer=None, tts_min_sentence_chars=None,
                   tts_min_sentence_chars_growth=None, tts_chunk_timeout=None,
                   tts_max_retries=None, tts_retry_delay=None, tts_style=None,
                   tts_live=True, tts_output_file=None, tts_realtime=False,
                   server_only=False):
    """Serve the AlgeBench viewer and optionally open in browser."""
    global DEBUG_MODE
    DEBUG_MODE = debug

    # Build TTS streaming kwargs
    tts_stream_kwargs = {}
    if tts_parallelism is not None:
        tts_stream_kwargs['parallelism'] = tts_parallelism
    if tts_min_buffer is not None:
        tts_stream_kwargs['min_buffer_seconds'] = tts_min_buffer
    if tts_min_sentence_chars is not None:
        tts_stream_kwargs['min_sentence_chars'] = tts_min_sentence_chars
    if tts_min_sentence_chars_growth is not None:
        tts_stream_kwargs['min_sentence_chars_growth'] = tts_min_sentence_chars_growth
    if tts_chunk_timeout is not None:
        tts_stream_kwargs['chunk_timeout'] = tts_chunk_timeout
    if tts_max_retries is not None:
        tts_stream_kwargs['max_retries'] = tts_max_retries
    if tts_retry_delay is not None:
        tts_stream_kwargs['retry_delay'] = tts_retry_delay
    if tts_style is not None:
        tts_stream_kwargs['style'] = tts_style
    if tts_live:
        tts_stream_kwargs['use_live'] = True
    if tts_output_file is not None:
        tts_stream_kwargs['output_path'] = tts_output_file

    current_spec = [None]

    # ---- Pydantic request models ----

    class ChatRequest(BaseModel):
        message: str = ''
        history: list = []
        context: dict = {}

    class ContextRequest(BaseModel):
        context: dict = {}

    class TtsRequest(BaseModel):
        text: str = ''
        character: str = 'joker'
        voice: str = 'Charon'
        mode: str = 'read'

    # ---- FastAPI app ----

    fastapp = FastAPI(docs_url=None, redoc_url=None)

    # -- GET routes --

    @fastapp.get("/")
    @fastapp.get("/index.html")
    async def get_index():
        # Read fresh on each request so edits to index.html are picked up
        # without a server restart (same pattern as /style.css, /*.js).
        return HTMLResponse(
            content=generate_html(debug=debug),
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Content-Security-Policy":
                    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-eval' 'unsafe-inline'",
            }
        )

    @fastapp.get("/chat.js")
    async def get_chat_js():
        with open(chat_js_path, 'r') as f:
            js = f.read()
        return Response(content=js.encode('utf-8'), media_type="application/javascript",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    @fastapp.get("/gemini-live-tools/js/voice-character-selector.js")
    async def get_voice_character_selector():
        try:
            js = _glt_static('voice-character-selector.js')
            return Response(content=js.encode('utf-8'), media_type="application/javascript",
                            headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
        except Exception:
            print("⚠ voice-character-selector.js not found in gemini-live-tools package")
            return Response(status_code=404)

    @fastapp.get("/gemini-live-tools/js/tts-audio-player.js")
    async def get_tts_audio_player():
        try:
            js = _glt_static('tts-audio-player.js')
            return Response(content=js.encode('utf-8'), media_type="application/javascript",
                            headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
        except Exception:
            print("⚠ tts-audio-player.js not found in gemini-live-tools package")
            return Response(status_code=404)

    @fastapp.get("/style.css")
    async def get_style_css():
        with open(style_css_path, 'r') as f:
            css = f.read()
        return Response(content=css.encode('utf-8'), media_type="text/css",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    @fastapp.get("/objects/{filename:path}")
    async def get_objects_js(filename: str):
        """Serve ES module files from static/objects/ subdirectory."""
        safe = filename.replace('..', '').lstrip('/')
        path = static_dir / "objects" / safe
        if not path.is_file() or not path.suffix == '.js':
            return Response(status_code=404)
        with open(path, 'r') as f:
            js = f.read()
        return Response(content=js.encode('utf-8'), media_type="application/javascript",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    _TOP_LEVEL_MODULES = {
        'state', 'expr', 'trust', 'coords', 'labels', 'follow-cam', 'camera',
        'sliders', 'overlay', 'context-browser', 'scene-loader', 'ui',
        'json-browser', 'main', 'proof', 'graph-view',
    }

    @fastapp.get("/api/graph/themes")
    async def get_graph_themes():
        """List available semantic-graph theme presets from themes/semantic-graph/.

        Each entry is ``{name, mode}`` — ``mode`` is read from the theme's
        declared ``mode`` field (``"dark"`` or ``"light"``) so the picker UI
        can group themes by backdrop.
        """
        try:
            g2m = _load_script_module("scripts/graph_to_mermaid.py", "graph_to_mermaid")
            names = g2m.list_themes()
            themes = []
            for name in names:
                try:
                    t = g2m.load_theme(name)
                    themes.append({"name": name, "mode": t.get("mode", "light")})
                except Exception:
                    themes.append({"name": name, "mode": "light"})
            return JSONResponse({"themes": themes})
        except Exception as e:
            return JSONResponse({"error": str(e), "themes": []}, status_code=500)

    class MermaidRenderRequest(BaseModel):
        graph: dict = {}
        theme: str = "default-light"
        direction: str | None = None
        # Optional list of fields to display on node labels.
        # Valid values: "emoji", "label", "unit", "role", "quantity", "dimension".
        # Example: ["emoji","label"] -> "🏹 F (force)"
        show: list[str] | None = None

    class LatexToGraphRequest(BaseModel):
        latex: str
        domain: str | None = None

    @fastapp.post("/api/graph/from-latex")
    async def post_graph_from_latex(req: LatexToGraphRequest):
        """Derive a semantic graph from a LaTeX math string.

        Used by the Graph tab to auto-populate diagrams for proof steps that
        do not ship an explicit ``semanticGraph`` field. Delegates to
        :func:`_derive_semantic_graph` so visual accents, dot-derivative
        rewrites, and multichar-subscript handling all run on this path too.
        """
        try:
            graph = _derive_semantic_graph(req.latex, domain=req.domain)
            return JSONResponse({"graph": graph})
        except Exception as e:
            import traceback
            print(f"   ❌ /api/graph/from-latex: {e}\n{traceback.format_exc()}")
            return JSONResponse({"error": str(e)}, status_code=400)

    @fastapp.post("/api/graph/mermaid")
    async def post_graph_mermaid(req: MermaidRenderRequest):
        """Regenerate Mermaid source from a semantic graph with the given theme/direction."""
        try:
            g2m = _load_script_module("scripts/graph_to_mermaid.py", "graph_to_mermaid")
            theme = g2m.load_theme(req.theme or "default-light")
            if req.direction:
                theme = dict(theme)
                theme["direction"] = req.direction
            show_set = set(req.show) if req.show else None
            mermaid_src = g2m.semantic_graph_to_mermaid(
                req.graph or {}, theme=theme, show=show_set,
            )
            return JSONResponse({"mermaid": mermaid_src, "theme": req.theme,
                                 "direction": theme.get("direction"),
                                 "mode": theme.get("mode", "dark")})
        except FileNotFoundError as e:
            return JSONResponse({"error": str(e)}, status_code=404)
        except Exception as e:
            import traceback
            print(f"   ❌ /api/graph/mermaid: {e}\n{traceback.format_exc()}")
            return JSONResponse({"error": str(e)}, status_code=500)

    @fastapp.get("/graph-panel/{filename:path}")
    async def get_graph_panel_file(filename: str):
        """Serve files from static/graph-panel/ subdirectory."""
        safe = filename.replace('..', '').lstrip('/')
        path = static_dir / "graph-panel" / safe
        if not path.is_file():
            return Response(status_code=404)
        suffix = path.suffix
        if suffix == '.js':
            media_type = "application/javascript"
        elif suffix == '.css':
            media_type = "text/css"
        else:
            media_type = "application/octet-stream"
        with open(path, 'rb') as f:
            content = f.read()
        return Response(content=content, media_type=media_type,
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    @fastapp.get("/{name}.js")
    async def get_module_js(name: str):
        """Serve any top-level ES module from the static directory."""
        if name not in _TOP_LEVEL_MODULES:
            return Response(status_code=404)
        path = static_dir / f"{name}.js"
        if not path.is_file():
            return Response(status_code=404)
        with open(path, 'r') as f:
            js = f.read()
        return Response(content=js.encode('utf-8'), media_type="application/javascript",
                        headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

    @fastapp.get("/favicon.ico")
    async def get_favicon():
        return Response(content=FAVICON_SVG.encode('utf-8'), media_type="image/svg+xml",
                        headers={"Cache-Control": "public, max-age=86400"})

    @fastapp.get("/api/chat/available")
    async def get_chat_available():
        return JSONResponse({"available": bool(GEMINI_API_KEY)})

    @fastapp.get("/api/health")
    async def get_health():
        return JSONResponse({"status": "ok"})

    @fastapp.get("/api/memory")
    async def get_memory():
        payload = {
            k: {"summary": _memory_summary(k, v), "value": v}
            for k, v in _agent_memory.items()
        }
        return JSONResponse(payload)

    @fastapp.post("/api/debug/system_prompt")
    async def get_debug_system_prompt(req: ContextRequest):
        if not DEBUG_MODE:
            return JSONResponse({"error": "Debug mode is disabled."}, status_code=404)
        context = req.context or {}
        prompt = build_system_prompt(context, agent_memory=_agent_memory)
        return JSONResponse({
            "systemPrompt": prompt,
            "charCount": len(prompt),
        })

    @fastapp.get("/api/scenes")
    async def get_scenes():
        return JSONResponse({"scenes": list_builtin_scenes()})

    @fastapp.get("/api/scene_file")
    async def get_scene_file(request: Request):
        requested = request.query_params.get('path', '')
        resolved_path = resolve_scene_path(requested)
        if not resolved_path:
            return JSONResponse({"error": "Scene file not found"}, status_code=404)
        try:
            with open(resolved_path, 'r') as f:
                scene = json.load(f)
            _autofill_semantic_graphs(scene)
            return JSONResponse({"spec": scene, "path": str(resolved_path),
                                 "label": resolved_path.name})
        except json.JSONDecodeError:
            return JSONResponse({"error": "Invalid JSON in scene file"}, status_code=400)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    @fastapp.get("/api/domains")
    async def get_domains():
        domains_dir = static_dir / 'domains'
        result = []
        if domains_dir.is_dir():
            for d in sorted(domains_dir.iterdir()):
                if d.is_dir():
                    docs_path = d / 'docs.json'
                    entry = {'name': d.name}
                    if docs_path.exists():
                        try:
                            with open(docs_path, 'r') as f:
                                docs = json.load(f)
                            entry['description'] = docs.get('description', '')
                            entry['functions'] = list(docs.get('functions', {}).keys())
                        except Exception:
                            pass
                    result.append(entry)
        return JSONResponse(result)

    @fastapp.get("/api/domains/{name}")
    async def get_domain_docs(name: str):
        domains_root = (static_dir / 'domains').resolve()
        docs_path = (static_dir / 'domains' / name / 'docs.json').resolve()
        try:
            docs_path.relative_to(domains_root)
            safe = True
        except ValueError:
            safe = False
        if safe and docs_path.exists():
            with open(docs_path, 'rb') as f:
                return Response(content=f.read(), media_type="application/json")
        return Response(content=b'Domain not found', status_code=404)

    @fastapp.get("/domains/{path:path}")
    async def get_domain_file(path: str):
        domains_root = (static_dir / 'domains').resolve()
        domain_path = (static_dir / 'domains' / path).resolve()
        try:
            domain_path.relative_to(domains_root)
            safe = True
        except ValueError:
            safe = False
        if safe and domain_path.exists() and domain_path.is_file():
            with open(domain_path, 'rb') as f:
                return Response(content=f.read(), media_type="application/javascript")
        return Response(content=b'Domain not found', status_code=404)

    @fastapp.get("/scenes/{name:path}")
    async def get_scene(name: str):
        scene = load_builtin_scene(name)
        if scene:
            _autofill_semantic_graphs(scene)
            return JSONResponse(scene)
        return Response(content=b'Scene not found', status_code=404)

    @fastapp.get("/api/scene")
    async def get_current_scene():
        return JSONResponse(current_spec[0] if current_spec[0] else {})

    @fastapp.get("/shutdown")
    async def shutdown():
        threading.Thread(target=lambda: (time.sleep(0.5), os._exit(0))).start()
        return Response(content=b'Shutting down...')

    # -- POST routes --

    @fastapp.post("/api/chat")
    async def api_chat(req: ChatRequest):
        if not req.message.strip():
            return JSONResponse({"error": "Empty message"}, status_code=400)
        try:
            loop = asyncio.get_running_loop()
            response_text, tool_calls, debug_info = await loop.run_in_executor(
                None, lambda: call_gemini_chat(req.message, req.history, req.context)
            )
            if DEBUG_MODE:
                print(f"   💬 Response ({len(response_text)} chars): {response_text}")
            return JSONResponse({"response": response_text, "toolCalls": tool_calls,
                                 "debug": debug_info})
        except Exception as e:
            import traceback
            print(f"   ❌ /api/chat error: {e}\n{traceback.format_exc()}")
            return JSONResponse({"error": str(e)}, status_code=500)

    @fastapp.post("/api/tts/stream")
    async def api_tts_stream(req: TtsRequest, request: Request):
        if not TTS_AVAILABLE or not GEMINI_API_KEY:
            return JSONResponse({"error": "TTS not available"}, status_code=503)
        text = req.text.strip()
        if not text:
            return JSONResponse({"error": "Empty text"}, status_code=400)

        import time as _time
        if DEBUG_MODE:
            print(f"\n🔊 TTS stream: character={req.character}, voice={req.voice}, "
                  f"mode={req.mode}, realtime={tts_realtime}, {len(text)} chars")
            print(f"🔊 TTS original text: {text}")

        api = GeminiLiveAPI(api_key=GEMINI_API_KEY, client=get_gemini_client())

        if req.mode == 'perform':
            t0 = _time.monotonic()
            loop = asyncio.get_running_loop()
            tts_text = await loop.run_in_executor(
                None, lambda: api.prepare_text(text, character_name=req.character)
            )
            if DEBUG_MODE:
                print(f"🔊 TTS prepared ({_time.monotonic()-t0:.2f}s): {tts_text}")
        else:
            tts_text = text

        if tts_realtime:
            # Realtime mode: single Live API session, stream raw PCM chunks
            est_duration = GeminiLiveAPI.estimate_audio_duration(tts_text)

            async def generate_rt():
                async for pcm_chunk in api.astream_realtime_pcm(
                    text=tts_text,
                    voice_name=req.voice,
                    character_name=req.character,
                    style=tts_stream_kwargs.get('style'),
                ):
                    if await request.is_disconnected():
                        break
                    yield pcm_chunk

            headers = {
                "Cache-Control": "no-cache",
                "X-Content-Type-Options": "nosniff",
                "X-Audio-Sample-Rate": "24000",
                "X-Audio-Channels": "1",
                "X-Audio-Format": "s16le",
                "X-TTS-Est-Duration": f"{est_duration:.1f}",
            }
            if tts_output_file:
                headers["X-TTS-Has-Output-File"] = "1"

            return StreamingResponse(generate_rt(), media_type="audio/pcm", headers=headers)

        sentences = _split_sentences(
            tts_text,
            min_chars=tts_stream_kwargs.get('min_sentence_chars', 100),
            growth=tts_stream_kwargs.get('min_sentence_chars_growth', 1.2),
        )
        chunk_count = len(sentences)

        async def generate():
            async for chunk in api.astream_parallel_wav(
                text=tts_text,
                voice_name=req.voice,
                character_name=req.character,
                **tts_stream_kwargs
            ):
                if await request.is_disconnected():
                    break
                yield chunk

        headers = {
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "X-TTS-Chunk-Count": str(chunk_count),
        }
        if tts_output_file:
            headers["X-TTS-Has-Output-File"] = "1"

        return StreamingResponse(generate(), media_type="audio/wav", headers=headers)

    @fastapp.get("/api/tts/download")
    async def api_tts_download():
        if not tts_output_file or not os.path.exists(tts_output_file):
            return JSONResponse({"error": "No output file available"}, status_code=404)
        filename = os.path.basename(tts_output_file)
        return FileResponse(tts_output_file, media_type="audio/wav",
                            filename=filename, headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    @fastapp.post("/api/load")
    async def api_load(request: Request):
        body = await request.body()
        try:
            new_spec = json.loads(body)
            _autofill_semantic_graphs(new_spec)
            current_spec[0] = new_spec
            return JSONResponse({"status": "loaded"})
        except json.JSONDecodeError:
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    # ---- Start uvicorn in a background thread ----

    config = uvicorn.Config(fastapp, host="0.0.0.0", port=port, log_level="error")
    uvicorn_server = uvicorn.Server(config)

    def _run_server():
        uvicorn_server.run()

    server_thread = threading.Thread(target=_run_server, daemon=False)
    server_thread.start()
    time.sleep(0.5)

    url = f"http://localhost:{port}/"
    if initial_scene_path:
        url = f"{url}?scene={quote(str(initial_scene_path))}"

    if json_output:
        result = {
            "status": "success",
            "url": url,
            "port": port,
            "pid": os.getpid()
        }
        print(json.dumps(result, indent=2))
        try:
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            pass
    elif server_only:
        print(f"AlgeBench server running at {url}")
        print(f"\nPress 'q' or Ctrl+C to stop the server")
    else:
        webbrowser.open(url)
        print(f"Opened AlgeBench in browser")
        print(f"\nDrag & drop JSON files onto the viewport to load scenes")
        print(f"\nPress 'q' or Ctrl+C to stop the server")

    if not json_output:
        if sys.stdin.isatty():
            old_settings = termios.tcgetattr(sys.stdin)
            try:
                tty.setcbreak(sys.stdin.fileno())
                while True:
                    if sys.stdin in select.select([sys.stdin], [], [], 0.1)[0]:
                        char = sys.stdin.read(1)
                        if char.lower() == 'q':
                            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
                            print(f"\nServer stopped")
                            uvicorn_server.should_exit = True
                            sys.exit(0)
                    time.sleep(0.1)
            except KeyboardInterrupt:
                termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
                print(f"\n\nServer stopped")
                uvicorn_server.should_exit = True
                sys.exit(0)
            finally:
                try:
                    termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
                except Exception:
                    pass
        else:
            def signal_handler(signum, frame):
                uvicorn_server.should_exit = True
                sys.exit(0)
            signal.signal(signal.SIGTERM, signal_handler)
            signal.signal(signal.SIGINT, signal_handler)
            try:
                while True:
                    time.sleep(1)
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser(
        description='AlgeBench - Interactive 3D Linear Algebra Visualizer',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  algebench                                      Launch empty viewer
  algebench scene.json                           Launch with scene
  algebench scenes/vector-addition.json          Load built-in scene
  algebench --port 9000                          Use custom port
  algebench --no-tts-live                        Use standard TTS instead of Gemini Live
  algebench --tts-parallelism 4                  Max concurrent TTS sentence synthesis (default: 3)
  algebench --tts-min-buffer 60.0                Seconds of audio buffered before playback (default: 30)
  algebench --tts-min-sentence-chars 150         Merge short sentences to this char count (default: 100)
  algebench --tts-min-sentence-chars-growth 1.5  Sentence char growth factor (default: 1.2)
  algebench --tts-chunk-timeout 30               Seconds before chunk timeout (default: 30)
  algebench --tts-max-retries 5                  Max retries per sentence (default: library default)
  algebench --tts-retry-delay 2.0                Seconds between retries (default: library default)
  algebench --tts-style "speak slowly"           Additional style guidance for TTS
  algebench --tts-output-file out.wav            Save TTS audio to WAV file
  algebench --tts-buffered                       Buffer sentences before playback (legacy TTS mode)
  algebench -rt scene.json                       Launch scene (realtime TTS is default)
        '''
    )
    parser.add_argument('scene', nargs='?', help='Path to scene JSON file')
    parser.add_argument('--json', action='store_true', help='Output JSON (for MCP integration)')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help=f'Port (default: {DEFAULT_PORT})')
    parser.add_argument('--debug', action='store_true', help='Dump full Gemini API requests to console')
    parser.add_argument('--tts-parallelism', type=int, default=3, choices=range(1, 5),
                        metavar='N (1-4)',
                        help='Max concurrent TTS sentence synthesis calls (default: 3, max: 4)')
    parser.add_argument('--tts-min-buffer', type=float, default=30.0,
                        help='Seconds of audio to buffer before first playback (default: 30.0)')
    parser.add_argument('--tts-min-sentence-chars', type=int, default=100,
                        help='Merge short sentences up to this char count (default: 100)')
    parser.add_argument('--tts-min-sentence-chars-growth', type=float, default=1.2,
                        help='Sentence char limit growth factor for merging (default: 1.2)')
    parser.add_argument('--tts-chunk-timeout', type=float, default=30.0,
                        help='Seconds to wait for next chunk before timing out (default: 30.0)')
    parser.add_argument('--tts-max-retries', type=int, default=None,
                        help='Max retries per sentence on TTS failure (default: library default)')
    parser.add_argument('--tts-retry-delay', type=float, default=None,
                        help='Seconds to wait between retries (default: library default)')
    parser.add_argument('--tts-style', type=str, default=None,
                        help='Additional style guidance for TTS synthesis')
    parser.add_argument('--tts-live', action='store_true', default=True,
                        help='Use Gemini Live API for TTS synthesis instead of standard TTS (default: enabled)')
    parser.add_argument('--no-tts-live', action='store_false', dest='tts_live',
                        help='Disable Gemini Live API for TTS synthesis')
    parser.add_argument('--tts-output-file', '--output-file', type=str, default=None,
                        dest='tts_output_file',
                        help='Save all TTS audio to this WAV file in addition to playing')
    parser.add_argument('--tts-buffered', action='store_true', default=False,
                        help='Buffer full sentences before playback instead of realtime streaming')
    parser.add_argument('--tts-realtime', '-rt', action='store_true', default=False,
                        help='(deprecated, no-op) Realtime streaming is now the default; this flag will be removed in a future release')
    parser.add_argument('--server-only', action='store_true', default=False,
                        help='Start the server without opening a browser window')

    args = parser.parse_args()

    # Auto-enable buffered mode when flags require it
    if not args.tts_buffered:
        if not args.tts_live:
            args.tts_buffered = True
            print("ℹ️  --no-tts-live requires buffered mode; enabling --tts-buffered automatically.",
                  file=sys.stderr)
        elif args.tts_output_file:
            args.tts_buffered = True
            print("ℹ️  --tts-output-file requires buffered mode; enabling --tts-buffered automatically.",
                  file=sys.stderr)

    # Warn if buffered-only tuning flags are used without --tts-buffered
    if not args.tts_buffered:
        buffered_only = ['--tts-parallelism', '--tts-min-buffer',
                         '--tts-min-sentence-chars', '--tts-min-sentence-chars-growth',
                         '--tts-chunk-timeout', '--tts-max-retries', '--tts-retry-delay']
        used = [
            f
            for f in buffered_only
            if any(arg == f or arg.startswith(f + '=') for arg in sys.argv)
        ]
        if used:
            print(f"⚠️  Warning: {', '.join(used)} only apply in buffered mode (--tts-buffered). "
                  f"Ignoring in realtime mode.", file=sys.stderr)

    if not args.json:
        print(f"Checking port {args.port}...")
    kill_server_on_port(args.port)
    time.sleep(0.5)

    initial_scene_path = None
    if args.scene:
        scene_path = resolve_scene_path(args.scene)
        if not scene_path:
            print(f"Error: Scene file not found: {args.scene}", file=sys.stderr)
            sys.exit(1)
        if not args.json:
            print(f"Loading scene: {scene_path}")
        initial_scene_path = str(scene_path)

    serve_and_open(
        initial_scene_path,
        port=args.port,
        json_output=args.json,
        debug=args.debug,
        tts_parallelism=args.tts_parallelism,
        tts_min_buffer=args.tts_min_buffer,
        tts_min_sentence_chars=args.tts_min_sentence_chars,
        tts_min_sentence_chars_growth=args.tts_min_sentence_chars_growth,
        tts_chunk_timeout=args.tts_chunk_timeout,
        tts_max_retries=args.tts_max_retries,
        tts_retry_delay=args.tts_retry_delay,
        tts_style=args.tts_style,
        tts_live=args.tts_live,
        tts_output_file=args.tts_output_file,
        tts_realtime=not args.tts_buffered,
        server_only=args.server_only,
    )


if __name__ == "__main__":
    main()
