"""LaTeX preprocessing — cleans raw LaTeX into a form SymPy can parse."""

from __future__ import annotations

import re

from .constants import (
    _ACCENT_COMMANDS,
    _DOT_ACCENT_ORDERS,
    _GREEK_POOL,
)
from .preprocess_result import PreprocessResult

# LaTeX spacing commands, longest-first so endswith() strips the longest match.
_SPACING_COMMANDS = ("\\qquad", "\\quad", "\\,", "\\;", "\\!", "\\:")


def strip_trailing_spacing(s: str) -> str:
    r"""Remove trailing whitespace and LaTeX spacing commands, in linear time.

    Equivalent to matching ``(?:\s|\\quad|\\qquad|\\,|\\;|\\!|\\:)*`` at the end
    of *s*, but implemented as a shrinking-index scan so it cannot exhibit the
    polynomial backtracking (ReDoS, CWE-1333) that an unanchored regular
    expression of that shape suffers on long whitespace runs.
    """
    end = len(s)
    changed = True
    while changed:
        changed = False
        while end > 0 and s[end - 1].isspace():
            end -= 1
            changed = True
        for cmd in _SPACING_COMMANDS:
            if end >= len(cmd) and s.endswith(cmd, 0, end):
                end -= len(cmd)
                changed = True
                break
    return s[:end]


class LaTeXPreprocessor:
    """Stateless preprocessor: each method takes raw strings and returns results."""

    # ------------------------------------------------------------------
    # Public orchestrator
    # ------------------------------------------------------------------

    def preprocess(self, latex: str) -> PreprocessResult:
        src = latex
        src, annotations = self.extract_parenthetical_annotations(src)
        dotted_vars: dict[str, int] = {}
        src = self.rewrite_dot_derivatives(src, dotted_vars)
        src = self.normalize_frac_derivatives(src)
        src = self.normalize_bare_sums(src)
        accent_map: dict[str, str] = {}
        src = self.strip_accent_commands(src, accent_map)
        src, subscript_map = self.substitute_multichar_subscripts(src)
        return PreprocessResult(
            cleaned_latex=src,
            dotted_vars=dotted_vars,
            accent_map=accent_map,
            subscript_map=subscript_map,
            annotations=annotations,
        )

    # ------------------------------------------------------------------
    # Individual passes
    # ------------------------------------------------------------------

    @staticmethod
    def rewrite_dot_derivatives(
        latex: str,
        captured: dict[str, int] | None = None,
    ) -> str:
        r"""Rewrite ``\dot{X}``/``\ddot{X}``/... into ``\frac{dX}{dt}`` form."""
        if not isinstance(latex, str) or "\\" not in latex:
            return latex
        if not any(f"\\{cmd}{{" in latex for cmd in _DOT_ACCENT_ORDERS):
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

        def consume_sub_sup(s: str, pos: int) -> tuple[str, int]:
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
            body = LaTeXPreprocessor.rewrite_dot_derivatives(body, captured)
            j = body_close + 1
            suffix = ""
            while True:
                tok, new_j = consume_sub_sup(latex, j)
                if not tok:
                    break
                suffix += tok
                j = new_j
            var = body + suffix
            if captured is not None:
                captured[var] = max(captured.get(var, 0), order)
            frac = f"\\frac{{d}}{{d t}} {var}"
            for _ in range(order - 1):
                frac = f"\\frac{{d}}{{d t}} {frac}"
            out.append(frac)
            i = j
        return "".join(out)

    @staticmethod
    def normalize_frac_derivatives(latex: str) -> str:
        r"""Rewrite ``\frac{d<body>}{d t}`` → ``\frac{d}{d t} <body>``."""
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
            if (numerator.startswith("d") and len(numerator) > 1
                    and numerator[1] != "d"
                    and denominator.replace(" ", "") == "dt"):
                body = numerator[1:].lstrip()
                body = LaTeXPreprocessor.normalize_frac_derivatives(body)
                out.append(f"\\frac{{d}}{{d t}} {body}")
                i = den_close + 1
                continue
            out.append("\\frac{")
            out.append(LaTeXPreprocessor.normalize_frac_derivatives(
                latex[num_open + 1:num_close]
            ))
            out.append("}{")
            out.append(LaTeXPreprocessor.normalize_frac_derivatives(
                latex[den_open + 1:den_close]
            ))
            out.append("}")
            i = den_close + 1
        return "".join(out)

    # Pool of dummy index names for completely bare ``\sum``/``\prod``.
    # These are valid LaTeX commands that SymPy can parse but are
    # extremely unlikely to appear in real expressions.  The translator
    # checks this set to suppress them entirely from the graph.
    BARE_SUM_DUMMIES = ("iota", "varrho", "varkappa")

    @staticmethod
    def normalize_bare_sums(
        latex: str,
        captured: set[str] | None = None,
    ) -> str:
        r"""Add default bounds to bare ``\sum_i`` / ``\prod_j`` notation.

        SymPy's ``parse_latex`` requires explicit bounds, e.g.
        ``\sum_{i=0}^{\infty}``.  This pass rewrites shorthand forms:

        * ``\sum_i …``    → ``\sum_{i=0}^{\infty} …``
        * ``\sum_{i} …``  → ``\sum_{i=0}^{\infty} …``
        * ``\sum …``      → ``\sum_{\iota=0}^{\infty} …``  (dummy index)
        * ``\prod_j …``   → ``\prod_{j=0}^{\infty} …``

        Only bare subscripts (no ``=`` inside) without a following ``^``
        are rewritten — fully bounded forms are left untouched.

        If *captured* is provided, index variable names that were
        normalised are added to the set so the translator can suppress
        the synthetic bound nodes.  Completely bare forms use names
        from ``BARE_SUM_DUMMIES`` — the translator suppresses these
        entirely (no node, no wrt edge).
        """
        if not isinstance(latex, str):
            return latex
        # --- Pass 1: bare subscript without bounds ---
        sub_pattern = re.compile(
            r"(\\(?:sum|prod))"               # \sum or \prod
            r"_"                               # subscript marker
            r"(?:\{([A-Za-z](?:[A-Za-z0-9]*)?)\}"  # {i} or {idx} — braced, no '='
            r"|([A-Za-z]))"                    # or bare single char: i
            r"(?!\s*\^)"                       # NOT followed by ^
        )

        def _repl_sub(m: re.Match) -> str:
            cmd = m.group(1)
            idx = m.group(2) or m.group(3)
            if captured is not None:
                captured.add(idx)
            return rf"{cmd}_{{{idx}=0}}^{{\infty}}"

        latex = sub_pattern.sub(_repl_sub, latex)

        # --- Pass 2: completely bare (no subscript or superscript) ---
        bare_pattern = re.compile(
            r"(\\(?:sum|prod))"               # \sum or \prod
            r"(?!\s*[_^])"                     # NOT followed by _ or ^
        )
        dummies = LaTeXPreprocessor.BARE_SUM_DUMMIES
        _counter = [0]

        def _repl_bare(m: re.Match) -> str:
            cmd = m.group(1)
            dummy = dummies[min(_counter[0], len(dummies) - 1)]
            _counter[0] += 1
            if captured is not None:
                captured.add(dummy)
            return rf"{cmd}_{{\{dummy}=0}}^{{\infty}}"

        return bare_pattern.sub(_repl_bare, latex)

    @staticmethod
    def strip_accent_commands(
        latex: str,
        accent_map: dict[str, str] | None = None,
    ) -> str:
        r"""Peel ``\vec{X}``/``\hat{X}``/``\mathbf{X}``/... → ``X``."""
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
            matched_cmd: str | None = None
            for cmd in _ACCENT_COMMANDS:
                end = i + 1 + len(cmd)
                if latex.startswith(cmd, i + 1) and end < n:
                    nxt = latex[end]
                    if nxt == "{":
                        matched_cmd = cmd
                        break
            if matched_cmd is None:
                out.append(latex[i])
                i += 1
                continue
            body_start = i + 1 + len(matched_cmd) + 1
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
            clean_body = LaTeXPreprocessor.strip_accent_commands(raw_body, accent_map)
            if accent_map is not None and clean_body and "\\" not in clean_body:
                if matched_cmd in {
                    "vec", "hat", "bar", "tilde", "dot", "ddot", "dddot", "ddddot",
                    "overline", "widehat", "widetilde", "check", "breve",
                    "mathring", "acute", "grave",
                }:
                    accent_map.setdefault(clean_body, matched_cmd)
            if out and out[-1] and out[-1][-1].isalpha() and clean_body and clean_body[0].isalpha():
                out.append(" ")
            out.append(clean_body)
            i = j + 1
        return "".join(out)

    @staticmethod
    def substitute_multichar_subscripts(latex: str) -> tuple[str, dict[str, str]]:
        r"""Replace multi-character subscript bodies with Greek placeholders."""
        mapping: dict[str, str] = {}
        greek_iter = iter(_GREEK_POOL)

        def allocate(original: str) -> str | None:
            for k, v in mapping.items():
                if v == original:
                    return k
            try:
                k = next(greek_iter)
            except StopIteration:
                return None
            mapping[k] = original
            return k

        def _sub_text(m: re.Match) -> str:
            body = m.group(1)
            k = allocate(f"\\text{{{body}}}")
            return f"\\{k}" if k else m.group(0)
        latex = re.sub(r"\\text\{([^{}]+)\}", _sub_text, latex)

        def _sub_sub(m: re.Match) -> str:
            body = m.group(1)
            if len(body) == 1 or body.isdigit():
                return m.group(0)
            if not body.isalpha():
                return m.group(0)
            k = allocate(body)
            return f"_{{\\{k}}}" if k else m.group(0)
        latex = re.sub(r"_\{([^{}]+)\}", _sub_sub, latex)

        return latex, mapping

    @staticmethod
    def extract_parenthetical_annotations(
        latex: str,
    ) -> tuple[str, list[dict[str, str]]]:
        r"""Strip trailing parenthetical annotations from LaTeX."""
        annotations: list[dict[str, str]] = []
        # The literal ``\text{`` inside the group anchors the match, so we no
        # longer need a leading spacing/whitespace quantifier — that prefix was
        # a polynomial-time ReDoS (CWE-1333) on attacker-supplied whitespace.
        # Trailing spacing left before the matched paren is removed in linear
        # time by ``strip_trailing_spacing`` below.
        pattern = re.compile(
            r"\(([^()]*\\text\{[^{}]+\}[^()]*)\)\s*$"
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
            latex = strip_trailing_spacing(latex[:m.start()])
        annotations.reverse()
        return latex, annotations
