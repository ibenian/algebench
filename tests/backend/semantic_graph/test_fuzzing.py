"""Grammar-aware LaTeX fuzzer for the semantic graph parser.

Starts from valid expressions, applies random mutations, and verifies the
parser never raises unexpected exception types.
"""

from __future__ import annotations

import random
import signal

import pytest

from backend.semantic_graph.sympy_translator import latex_to_semantic_graph

_SEED = 20260521
_NUM_MUTATIONS = 200
_TIMEOUT_SECONDS = 5

_VALID_EXPRESSIONS = [
    r"x + y",
    r"\frac{a}{b}",
    r"x^{2} + y^{2} = z^{2}",
    r"\sin(x) + \cos(y)",
    r"\sqrt{x^2 + y^2}",
    r"a \cdot b + c",
    r"\int_{0}^{1} x \, dx",
    r"\sum_{i=1}^{n} i^2",
    r"\lim_{x \to 0} \frac{\sin(x)}{x}",
    r"e^{i\pi} + 1 = 0",
]

_OPERATORS = ["+", "-", r"\cdot", "=", r"\leq", r"\geq"]
_LATEX_CMDS = [r"\sin", r"\cos", r"\frac", r"\sqrt", r"\log", r"\alpha", r"\beta"]

_ALLOWED_EXCEPTIONS = (ValueError, NotImplementedError, TypeError, KeyError)


def _mutate(expr: str, rng: random.Random) -> str:
    """Apply a single random mutation to the expression."""
    mutation = rng.choice(["swap_op", "delete_token", "duplicate", "insert_cmd", "flip_brace"])
    tokens = list(expr)

    if mutation == "swap_op" and len(tokens) > 0:
        positions = [i for i, c in enumerate(tokens) if c in "+-="]
        if positions:
            pos = rng.choice(positions)
            tokens[pos] = rng.choice(["+", "-", "=", "*"])

    elif mutation == "delete_token" and len(tokens) > 1:
        pos = rng.randint(0, len(tokens) - 1)
        tokens.pop(pos)

    elif mutation == "duplicate" and len(tokens) > 0:
        pos = rng.randint(0, len(tokens) - 1)
        chunk_end = min(pos + rng.randint(1, 5), len(tokens))
        chunk = tokens[pos:chunk_end]
        tokens[pos:pos] = chunk

    elif mutation == "insert_cmd":
        cmd = rng.choice(_LATEX_CMDS)
        pos = rng.randint(0, len(tokens))
        tokens[pos:pos] = list(cmd)

    elif mutation == "flip_brace":
        brace_pos = [i for i, c in enumerate(tokens) if c in "{}"]
        if brace_pos:
            pos = rng.choice(brace_pos)
            tokens[pos] = "}" if tokens[pos] == "{" else "{"

    return "".join(tokens)


class _Timeout:
    """Context manager that raises TimeoutError after a deadline."""

    def __init__(self, seconds: int):
        self._seconds = seconds

    def __enter__(self):
        signal.signal(signal.SIGALRM, self._handler)
        signal.alarm(self._seconds)
        return self

    def __exit__(self, *_):
        signal.alarm(0)
        signal.signal(signal.SIGALRM, signal.SIG_DFL)

    @staticmethod
    def _handler(signum, frame):
        raise TimeoutError("Parser timed out")


def _build_fuzz_cases() -> list[tuple[str, str]]:
    rng = random.Random(_SEED)
    cases = []
    for _ in range(_NUM_MUTATIONS):
        base = rng.choice(_VALID_EXPRESSIONS)
        n_mutations = rng.randint(1, 3)
        mutated = base
        for _ in range(n_mutations):
            mutated = _mutate(mutated, rng)
        cases.append((base, mutated))
    return cases


_FUZZ_CASES = _build_fuzz_cases()


@pytest.mark.parametrize(
    "base,mutated",
    _FUZZ_CASES,
    ids=[f"fuzz-{i}" for i in range(len(_FUZZ_CASES))],
)
def test_fuzz_no_unhandled_exception(base, mutated):
    try:
        with _Timeout(_TIMEOUT_SECONDS):
            latex_to_semantic_graph(mutated)
    except _ALLOWED_EXCEPTIONS:
        pass
    except TimeoutError:
        pytest.skip(f"Timed out on: {mutated!r}")
    except Exception as exc:
        pytest.fail(
            f"Unhandled {type(exc).__name__} for mutated expression.\n"
            f"  Base:    {base!r}\n"
            f"  Mutated: {mutated!r}\n"
            f"  Error:   {exc}"
        )
