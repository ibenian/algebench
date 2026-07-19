"""The compact wire format must reassemble into exactly what the server built.

The client never receives a proof — it receives shared step ops plus a small
per-variant descriptor, and reconstructs the candidate locally. If that
reconstruction diverges from the server's rebuilt proof by even one field, the
user is looking at something the CAS never graded.

This module reimplements the client's assembly in Python so the contract is
pinned on both sides. Keep it in step with ``assembleVariant`` in
``static/proof-edit-tool.js``.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.experts.handlers.proof_edit.variants import build_variant, to_payload

PROOFS = Path(__file__).resolve().parents[3] / "proofs" / "domains"
FIXTURE = PROOFS / "algebra" / "quadratic-formula.json"

STEP_FIELDS = ("operation", "justification", "input_latex", "latex", "plain",
               "confidence")


@pytest.fixture
def proof() -> dict:
    return json.loads(FIXTURE.read_text())


def assemble(original: dict, payload: dict, variant: dict) -> dict:
    """Mirror of the client's ``assembleVariant`` — splice, update, renumber."""
    at, take = variant["at"], variant["take"]
    delete_count = variant["delete_count"]

    steps = list(original["steps"])
    head = [dict(s) for s in steps[:at + 1]]
    inserted = [dict(s) for s in payload["new_steps"][:take]]
    tail = [dict(s) for s in steps[at + 1 + delete_count:]]

    # ``step_updates`` is keyed by ORIGINAL index, so apply before renumbering.
    for key, changed in (variant.get("step_updates") or {}).items():
        orig_i = int(key)
        if orig_i <= at:
            head[orig_i].update(changed)
        else:
            pos = orig_i - (at + 1 + delete_count)
            if 0 <= pos < len(tail):
                tail[pos].update(changed)

    out = dict(original)
    out["steps"] = head + inserted + tail
    for i, s in enumerate(out["steps"]):
        s["index"] = i
    out["terms"] = {**(original.get("terms") or {}),
                    **(variant.get("terms_added") or {})}
    out["overall_confidence"] = variant["overall_confidence"]
    return out


def _step(latex: str, op: str = "test op") -> dict:
    return {"operation": op, "justification": "because", "input_latex": latex}


@pytest.mark.parametrize("supersede", [0, 2])
def test_assembled_variant_matches_server_rebuild(proof, supersede):
    """Every variant the client can assemble equals what the server built.

    Deliberately driven off ``model_dump()`` rather than the model: that is
    literally the JSON the browser receives, so a field renamed on the model but
    not in the client would fail here.
    """
    at = 2
    base = proof["steps"][at]["input_latex"]
    new = [_step(base), _step(base)]
    built_payload = to_payload(proof, proof["domain"], at, new, supersede_count=supersede)
    assert built_payload is not None
    payload = built_payload.model_dump()

    for variant in payload["variants"]:
        client = assemble(proof, payload, variant)
        server = build_variant(proof, proof["domain"], at,
                               new[:variant["take"]], variant["delete_count"])

        assert len(client["steps"]) == len(server["steps"]), variant["kind"]
        for i, (c, s) in enumerate(zip(client["steps"], server["steps"])):
            for f in STEP_FIELDS:
                assert c.get(f) == s.get(f), (
                    f"{variant['kind']}: step {i} field {f!r} diverged")
            assert c["index"] == i
        assert client["overall_confidence"] == server["overall_confidence"]


def test_patch_stays_small_when_ids_are_stable(proof):
    """The payload scales with the EDIT, not with the proof.

    Node ids are reassigned by a chain-wide rebase, so a downstream step's
    ``latex`` *could* shift even when its math did not — which is why the server
    diffs rather than hand-authoring the delta. Untouched steps are restored
    wholesale, so in practice the only updates are around the insertion point.
    """
    at = 2
    payload = to_payload(proof, proof["domain"], at,
                         [_step(proof["steps"][at]["input_latex"])])
    assert payload is not None
    insert = next(v for v in payload.variants if v.kind == "insert")

    touched = {int(k) for k in insert.step_updates}
    # Only the step whose predecessor changed may be updated.
    assert touched <= {at + 1}, f"unexpectedly wide patch: {sorted(touched)}"


def test_step_updates_are_keyed_by_original_index(proof):
    """Keys index the proof the client already has, not the rebuilt one."""
    at = 2
    payload = to_payload(proof, proof["domain"], at,
                         [_step(proof["steps"][at]["input_latex"])])
    assert payload is not None
    n = len(proof["steps"])
    for variant in payload.variants:
        for key in variant.step_updates:
            assert 0 <= int(key) < n
