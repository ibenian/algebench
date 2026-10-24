"""Names the learner's Python uses but never defines, where the reference does define them.

Renaming is fine, but only everywhere: a parameter renamed to ``adj_list`` while a
later line still reads ``adj`` leaves that line reading a name nothing in the code
defines. The model, told to review only the changed lines, misses that when the
broken line is an old one, so it is found here, by the symbol table, and handed to
the coach. Only for Python; other languages return nothing.
"""
from __future__ import annotations

import ast
import builtins
import symtable

_BUILTINS = frozenset(dir(builtins))


def _parse(code: str) -> tuple[ast.Module, str] | None:
    """The code's tree, tolerating an unfinished last few lines (a header waiting for its body)."""
    lines = code.rstrip().split("\n")
    for cut in range(0, min(4, len(lines))):
        text = "\n".join(lines[:len(lines) - cut])
        for attempt in (text, text + "\n" + " " * 64 + "pass"):
            try:
                return ast.parse(attempt), attempt
            except (SyntaxError, ValueError):
                continue
    return None


def _free_names(tree_and_text: tuple[ast.Module, str]) -> dict[str, int]:
    """Names read inside functions that no enclosing scope defines (globals by default), with the first line
    each is read on."""
    tree, text = tree_and_text
    free: set[str] = set()

    def walk(table: symtable.SymbolTable) -> None:
        if table.get_type() == "function":
            for sym in table.get_symbols():
                if sym.is_referenced() and sym.is_global() and not sym.is_declared_global():
                    free.add(sym.get_name())
        for child in table.get_children():
            walk(child)

    try:
        walk(symtable.symtable(text, "<typed>", "exec"))
    except SyntaxError:
        return {}
    module_defined = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
    first: dict[str, int] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id in free - module_defined:
            first[node.id] = min(first.get(node.id, node.lineno), node.lineno)
    return first


def undefined_names(typed: str, expected: str, language: str) -> list[tuple[int, str]]:
    """``(line, message)`` for each name the typed code reads but never defines, which the reference code
    doesn't leave undefined: a rename not carried through, or a variable that was never set."""
    if language.strip().lower() not in ("python", "py", "python3"):
        return []
    mine, theirs = _parse(typed), _parse(expected)
    if not mine or not theirs:
        return []
    allowed = set(_free_names(theirs)) | _BUILTINS
    return sorted((line, f"`{name}` is read here, but nothing in this code defines it")
                  for name, line in _free_names(mine).items() if name not in allowed)
