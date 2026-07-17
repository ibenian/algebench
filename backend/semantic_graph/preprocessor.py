"""LaTeX preprocessing — cleans raw LaTeX into a form SymPy can parse."""

from __future__ import annotations

import re

from .constants import (
    _ACCENT_COMMANDS,
    _DOT_ACCENT_ORDERS,
    _GREEK_POOL,
    _LATEX_FUNCS,
)
from .preprocess_result import PreprocessResult

# LaTeX spacing commands, longest-first so endswith() strips the longest match.
_SPACING_COMMANDS = ("\\qquad", "\\quad", "\\,", "\\;", "\\!", "\\:")

# Math-mode delimiter pairs, longest opener first so ``$$`` beats ``$``.
_MATH_DELIMITERS = (("$$", "$$"), ("\\[", "\\]"), ("\\(", "\\)"), ("$", "$"))


def strip_math_delimiters(s):
    r"""Peel surrounding math-mode delimiters off *s* (``$…$``, ``\(…\)``, …).

    LM-proposed and hand-authored LaTeX sometimes arrives already wrapped in the
    delimiters that put TeX into math mode — ``$…$`` / ``$$…$$`` (inline /
    display) or ``\(…\)`` / ``\[…\]``.  SymPy's ``parse_latex`` wants the bare
    body, so a wrapped expression fails to parse outright, and re-wrapping it for
    display yields doubled ``$$…$$``.  Strip one or more balanced layers, but
    ONLY when a pair genuinely encloses the whole string — ``$a$ + $b$`` (where
    the leading ``$`` closes mid-string) is left untouched.

    Stripping is deliberately conservative: a pair is peeled only when its
    delimiter does NOT recur inside the body.  This safely strips *distinguishable*
    nestings (mixed pairs like ``$$\(x\)$$``, or odd dollar runs like ``$$$x$$$``),
    but leaves *ambiguous* same-delimiter doubling untouched — ``$$$$x$$$$`` is
    indistinguishable from an inline-wrapped ``$$x$$``, and ``\(\(x\)\)`` from a
    body that genuinely starts with ``\(``, so we refuse rather than over-strip.

    Non-string inputs (e.g. ``None``) are returned unchanged.
    """
    if not isinstance(s, str):
        return s
    s = s.strip()
    changed = True
    while changed:
        changed = False
        for open_d, close_d in _MATH_DELIMITERS:
            if (len(s) >= len(open_d) + len(close_d)
                    and s.startswith(open_d) and s.endswith(close_d)):
                body = s[len(open_d):len(s) - len(close_d)]
                # If the delimiter still appears inside, the outer pair does not
                # actually enclose the whole string (e.g. ``$a$ + $b$``).
                if open_d in body or close_d in body:
                    continue
                s = body.strip()
                changed = True
                break
    return s


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
        src = self.normalize_func_call_braces(src)
        src = self.normalize_applied_symbol_braces(src)
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
    def normalize_func_call_braces(latex: str) -> str:
        r"""Rewrite ``\fn{ARG}`` → ``\fn(ARG)`` for named functions.

        SymPy's ``parse_latex`` only bounds a function's argument when it is in
        round parens: ``\cos(x^2)·2·x`` parses correctly, but ``\cos{x^2}·2·x``
        (or the bare ``\cos x^2·2·x``) makes ``\cos`` greedily swallow the whole
        trailing product → ``cos(x²·2·x)``.  A ``{…}`` brace group is NOT the
        parser's delimited-argument form.  The cruel part: SymPy's own *printer*
        emits ``\cos{\left(x^{2}\right)}`` — exactly the shape its parser
        misreads — so re-parsing printed LaTeX corrupts itself (only harmless
        when the function is the last factor, with nothing after to swallow).

        We rewrite the outer brace group for known function names so the parser
        takes its bounded branch: when ARG is already a single delimiter group the
        braces are simply dropped (``\cos{\left(x^2\right)}`` → ``\cos\left(x^2\right)``,
        the common printer case — no doubled delimiters); otherwise ARG is wrapped
        in parens (``\cos{x^2}`` → ``\cos(x^2)``).  Either way the string is
        parser-internal (display LaTeX is re-rendered from the graph), so no
        cosmetic artifact reaches the UI.

        Only the whitelisted names in :data:`_LATEX_FUNCS` are touched; braces on
        ``\frac``/``\sqrt``/``\hat``/superscripts/etc. are left alone.  An
        optional ``^{…}``/``_{…}`` between the name and the argument (SymPy prints
        powers of trig as ``\sin^{2}{\left(x\right)}``) is skipped so the brace
        that gets rewritten is the *argument* group, not the exponent.
        """
        if not isinstance(latex, str) or "{" not in latex or "\\" not in latex:
            return latex

        def find_matching_brace(s: str, open_idx: int) -> int | None:
            depth = 0
            j = open_idx
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

        def whole_is_delimited(a: str) -> bool:
            r"""True if *a* is a single ``\left(…\right)`` or ``(…)`` group that
            spans all of *a* — then the braces can simply be dropped (no added
            parens), keeping ``\cos{\left(x\right)}`` → ``\cos\left(x\right)``."""
            a = a.strip()
            if a.startswith(r"\left(") and a.endswith(r"\right)"):
                depth, k, L = 0, 0, len(a)
                while k < L:
                    if a.startswith(r"\left(", k):
                        depth += 1
                        k += 6
                    elif a.startswith(r"\right)", k):
                        depth -= 1
                        k += 7
                        if depth == 0:
                            return k == L
                    else:
                        k += 1
                return False
            if (a.startswith("(") and a.endswith(")")
                    and r"\left" not in a and r"\right" not in a):
                depth = 0
                for k, c in enumerate(a):
                    if c == "(":
                        depth += 1
                    elif c == ")":
                        depth -= 1
                        if depth == 0:
                            return k == len(a) - 1
                return False
            return False

        out: list[str] = []
        i = 0
        n = len(latex)
        while i < n:
            if latex[i] != "\\":
                out.append(latex[i])
                i += 1
                continue
            name = None
            for fn in _LATEX_FUNCS:      # longest-first: \sinh before \sin
                end = i + 1 + len(fn)
                # require a word boundary so \sin doesn't match \sine / \singular
                if latex.startswith(fn, i + 1) and (end >= n or not latex[end].isalpha()):
                    name = fn
                    break
            if name is None:
                out.append(latex[i])
                i += 1
                continue
            j = i + 1 + len(name)
            # copy the function token, then skip any run of ^{…}/_{…} exponents
            prefix = latex[i:j]
            while j < n and latex[j] in "_^":
                op_end = j + 1
                if op_end < n and latex[op_end] == "{":
                    close = find_matching_brace(latex, op_end)
                    if close is None:
                        break
                    prefix += latex[j:close + 1]
                    j = close + 1
                else:                     # single-token sup/sub, e.g. \sin^2
                    prefix += latex[j:op_end + 1]
                    j = op_end + 1
            # now: is the argument a brace group?  If so, swap it to parens.
            if j < n and latex[j] == "{":
                close = find_matching_brace(latex, j)
                if close is not None:
                    arg = latex[j + 1:close]
                    # If the argument is already one delimiter group, just drop
                    # the braces; otherwise wrap it in parens so the parser bounds
                    # exactly this argument and not the trailing product.
                    if whole_is_delimited(arg):
                        out.append(prefix + arg)
                    else:
                        out.append(prefix + "(" + arg + ")")
                    i = close + 1
                    continue
            out.append(prefix)
            i = j
        return "".join(out)

    @staticmethod
    def normalize_applied_symbol_braces(latex: str) -> str:
        r"""Rewrite ``f{\left(ARG\right)}`` → ``f\left(ARG\right)`` for bare symbols.

        Companion to :meth:`normalize_func_call_braces`, which fixes the SymPy
        printer's brace-wrapped argument for *whitelisted* ``\``-functions. The
        printer emits the very same shape for an **undefined** function
        application — ``sympy.latex(Function('f')(x))`` is ``f{\left(x \right)}``
        — and there the brace group makes the parser read *implicit
        multiplication*: the derivation finale ``f{\left(x\right)} = …`` came
        back as ``f·x = …``. Dropping the braces restores the application parse
        (``f\left(x\right)`` and ``f(x)`` both yield a ``function`` node).

        Deliberately narrow: only a single bare ASCII letter (optionally with a
        subscript, ``f_{1}``/``f_c`` — the printer's spelling for indexed
        functions), not preceded by ``\``, a letter, or ``}``, and only when the
        brace group is exactly one ``\left(…\right)``/``(…)`` group. Structural
        commands (``\frac{…}``, ``\sqrt{…}``) and ordinary brace groups are
        untouched.
        """
        if not isinstance(latex, str) or r"{\left(" not in latex and "{(" not in latex:
            return latex

        def find_matching_brace(s: str, open_idx: int) -> int | None:
            depth = 0
            j = open_idx
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

        def whole_is_delimited(a: str) -> bool:
            a = a.strip()
            if a.startswith(r"\left(") and a.endswith(r"\right)"):
                depth, k, L = 0, 0, len(a)
                while k < L:
                    if a.startswith(r"\left(", k):
                        depth += 1
                        k += 6
                    elif a.startswith(r"\right)", k):
                        depth -= 1
                        k += 7
                        if depth == 0:
                            return k == L
                    else:
                        k += 1
                return False
            if (a.startswith("(") and a.endswith(")")
                    and r"\left" not in a and r"\right" not in a):
                depth = 0
                for k, c in enumerate(a):
                    if c == "(":
                        depth += 1
                    elif c == ")":
                        depth -= 1
                        if depth == 0:
                            return k == len(a) - 1
                return False
            return False

        out: list[str] = []
        i = 0
        n = len(latex)
        while i < n:
            c = latex[i]
            # candidate: bare letter at a token boundary (not part of a \command,
            # an identifier run, or a just-closed brace group)
            if not c.isascii() or not c.isalpha() or (
                    i > 0 and (latex[i - 1] == "\\" or latex[i - 1].isalpha()
                               or latex[i - 1] == "}")):
                out.append(c)
                i += 1
                continue
            j = i + 1
            token = c
            # optional subscript: f_{1} / f_c (printer spelling for indexed fns)
            if j < n and latex[j] == "_":
                if j + 1 < n and latex[j + 1] == "{":
                    close = find_matching_brace(latex, j + 1)
                    if close is not None:
                        token += latex[j:close + 1]
                        j = close + 1
                elif j + 1 < n:
                    token += latex[j:j + 2]
                    j += 2
            if j < n and latex[j] == "{":
                close = find_matching_brace(latex, j)
                if close is not None:
                    arg = latex[j + 1:close]
                    if whole_is_delimited(arg):
                        out.append(token + arg)
                        i = close + 1
                        continue
            out.append(token)
            i = j
        return "".join(out)

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
        # Match a trailing ``(...)`` with no nested parens using a single
        # ``[^()]*`` — the old ``[^()]*…[^()]*`` body is a polynomial-ReDoS
        # shape (CWE-1333) that scanners flag. Whether the parenthetical is an
        # annotation is a separate, unambiguous containment check. Trailing
        # spacing left before the matched paren is removed in linear time by
        # ``strip_trailing_spacing`` below.
        trailing_paren = re.compile(r"\(([^()]*)\)\s*$")
        text_cmd = re.compile(r"\\text\{[^{}]+\}")
        while True:
            m = trailing_paren.search(latex)
            if not m:
                break
            inner_raw = m.group(1)
            head = latex[:m.start()].rstrip()
            # A trailing parenthetical is an annotation when it carries prose
            # (``\text{…}``) or when it is a side condition — set off from the
            # main expression by ``\quad``/``\qquad`` and containing its own
            # ``=`` (e.g. ``T_0 = h \qquad (c = 1)``).  A genuine math factor
            # can never contain ``=``, so real parens like ``(a+b)^2`` are
            # never stripped.
            is_prose = bool(text_cmd.search(inner_raw))
            is_side_condition = "=" in inner_raw and (
                head.endswith("\\quad") or head.endswith("\\qquad")
            )
            if not (is_prose or is_side_condition):
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
