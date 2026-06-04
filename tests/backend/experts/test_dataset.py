"""Tests for the sympy dataset generator (no LLM)."""

from __future__ import annotations

import os
import tempfile

from backend.experts.proof_completion import dataset as D
from backend.experts.proof_completion.graph_ops import apply, canonical_equal


def test_generate_is_deterministic():
    a = D.generate(n=8, seed=42, max_steps=1)
    b = D.generate(n=8, seed=42, max_steps=1)
    assert len(a) == len(b)
    assert [len(x.gold_ops) for x in a] == [len(y.gold_ops) for y in b]


def test_gold_is_self_consistent():
    exs = D.generate(n=15, seed=7, max_steps=1)
    assert exs, "generator produced nothing"
    for ex in exs:
        result = apply(ex.context.start, ex.gold_ops)
        assert canonical_equal(result, ex.context.target)


def test_gold_ops_respect_cap():
    exs = D.generate(n=15, seed=3, max_steps=1, max_ops=25)
    for ex in exs:
        assert len(ex.gold_ops) <= 25


def test_jsonl_roundtrip_preserves_consistency():
    exs = D.generate(n=10, seed=5, max_steps=1)
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "ds.jsonl")
        D.save_jsonl(exs, path)
        back = D.load_jsonl(path)
    assert len(back) == len(exs)
    for ex in back:
        assert canonical_equal(apply(ex.context.start, ex.gold_ops), ex.context.target)
        assert set(ex.inputs().keys()) == {
            "context", "context_id", "lesson_context", "instruction"
        }
