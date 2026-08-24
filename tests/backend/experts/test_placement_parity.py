"""Pin `backend/experts/contracts.py` against `src/placement.ts`.

The wire contract is declared twice — pydantic on the way out, TypeScript on the
way in — because there is no Node at runtime to share one implementation. This
test is what stops the two drifting, the same job
`tests/backend/experts/test_proof_edit_patch.py` does for the proof-edit payload.

It reads the TypeScript SOURCE rather than the built bundle: these are types, and
types are erased by the build, so `static/dist` has nothing to compare against.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from pydantic import TypeAdapter

from backend.experts.contracts import (
    NODE_KINDS, BuilderOutcome, BuildOp, BuildResult, Placement, SceneOp, StepOp,
    dump_outcome,
)

OP = TypeAdapter(BuildOp)

REPO_ROOT = Path(__file__).parent.parent.parent.parent
PLACEMENT_TS = REPO_ROOT / "src" / "placement.ts"


@pytest.fixture(scope="module")
def ts_source() -> str:
    return PLACEMENT_TS.read_text()


def _ts_interface_fields(src: str, name: str) -> set[str]:
    """Field names of one `export interface Name { ... }` block."""
    m = re.search(rf"export interface {name} \{{(.*?)\n\}}", src, re.S)
    assert m, f"interface {name} not found in placement.ts"
    return set(re.findall(r"^\s*(\w+)\??:", m.group(1), re.M))


def _ts_union_members(src: str, name: str) -> set[str]:
    m = re.search(rf"export type {name} =(.*?);", src, re.S)
    assert m, f"type {name} not found in placement.ts"
    return set(re.findall(r"'([^']+)'", m.group(1)))


# ---- the shapes agree -------------------------------------------------------

def test_placement_fields_match(ts_source: str) -> None:
    assert _ts_interface_fields(ts_source, "Placement") == set(Placement.model_fields)


def test_node_kinds_match(ts_source: str) -> None:
    assert _ts_union_members(ts_source, "NodeKind") == set(NODE_KINDS)


def test_op_classes_are_a_subset_of_the_declared_kinds() -> None:
    """Op classes are added per iteration (proof kinds land in iteration 5), so
    this is a subset — but every op class MUST name a declared kind."""
    implemented = {c.model_fields["kind"].default for c in (SceneOp, StepOp)}
    assert implemented <= set(NODE_KINDS)


def test_placement_carries_no_field(ts_source: str) -> None:
    """The container is DERIVED from `kind`, never named by the placement.

    An earlier revision had a `field` on both sides, which made kind and field
    independent axes: `{kind: "scene", field: "steps"}` validated in both
    languages and would have spliced a Scene into a Step array. Neither side may
    reintroduce it without the other.
    """
    assert "field" not in Placement.model_fields
    assert "PlacementField" not in ts_source, "src/placement.ts reintroduced a placement field"


def test_all_four_outcomes_exist_on_both_sides(ts_source: str) -> None:
    """A builder answers with exactly one of four shapes, and both sides must
    agree on which four — the Python mirror previously stopped at the success
    case, so a handler had no way to validate a question or a refusal."""
    ts = set(re.findall(r"kind: '(result|question|refused|passthrough)'", ts_source))
    py = {m.model_fields["kind"].default for m in BuilderOutcome.__origin__.__args__}
    assert ts == {"result", "question", "refused", "passthrough"}
    assert py == ts, f"outcome kinds disagree: TypeScript {ts}, Python {py}"


def test_build_result_fields_match(ts_source: str) -> None:
    assert _ts_interface_fields(ts_source, "BuildResult") == set(BuildResult.model_fields)


def test_op_verbs_match(ts_source: str) -> None:
    """Exactly three ops, no more: insert, replace, delete."""
    verbs = set(re.findall(r"op: '(\w+)'", ts_source))
    assert verbs == {"insert", "replace", "delete"}
    assert set(SceneOp.model_fields["op"].annotation.__args__) == verbs


def test_kind_selects_the_node_type() -> None:
    """The discriminator must tie `kind` to `node`. A smart union did not: a
    `kind="step"` op whose node carried only a title parsed as a Scene."""
    step = OP.validate_python(
        {"op": "insert", "kind": "step", "at": {"scene": 0, "index": 0},
         "node": {"title": "T"}})
    scene = OP.validate_python(
        {"op": "insert", "kind": "scene", "at": {"index": 0},
         "node": {"title": "T"}})
    assert type(step).__name__ == "StepOp" and type(step.node).__name__ == "Step"
    assert type(scene).__name__ == "SceneOp" and type(scene.node).__name__ == "Scene"


def test_insert_and_replace_require_a_node_and_delete_refuses_one() -> None:
    """An op claiming to insert nothing reaches the client as a successful build
    that renders an empty scene."""
    for op in ("insert", "replace"):
        with pytest.raises(Exception):
            OP.validate_python({"op": op, "kind": "scene", "at": {"field": "scenes", "index": 0}})
    with pytest.raises(Exception):
        OP.validate_python({"op": "delete", "kind": "scene",
                            "at": {"index": 0}, "node": {"title": "x"}})


# ---- a real payload survives the boundary -----------------------------------

def test_serialized_op_is_exactly_what_the_client_expects() -> None:
    """Absent fields must stay absent: the client's parser rejects unknown keys,
    and a `null` where it expects nothing is the kind of mismatch that only shows
    up in the browser."""
    result = BuildResult(
        ops=[OP.validate_python({
            "op": "insert", "kind": "scene",
            "at": {"index": 6},
            "node": {"title": "Vector Addition"},
        })],
        summary="Added a scene.",
        focus=Placement(index=6),
    )
    # NOTE: dump_outcome(), not model_dump_json(exclude_none=True). An earlier
    # version of this test applied exclude_none ITSELF, so it validated a
    # serialization the transport never performs and hid the mismatch it was
    # written to catch — the transport calls a bare model_dump(), which shipped
    # `node: null` on deletes and null scene/step/id on every placement.
    dumped = dump_outcome(result)
    assert dumped == {
        "ops": [{
            "op": "insert", "kind": "scene",
            "at": {"index": 6},
            "node": {"title": "Vector Addition"},
        }],
        "summary": "Added a scene.",
        "focus": {"index": 6},
    }


def test_delete_op_carries_no_node() -> None:
    op = OP.validate_python({"op": "delete", "kind": "scene", "at": {"index": 1}})
    assert "node" not in json.loads(op.model_dump_json(exclude_none=True))


def test_unknown_field_is_refused() -> None:
    """extra='forbid' both sides: a typo must fail loudly at the boundary, not
    silently do nothing (the schema's additionalProperties:true would allow it)."""
    with pytest.raises(Exception):
        Placement.model_validate({"index": 0, "indx": 1})


def test_the_wire_shape_carries_no_nulls_the_client_does_not_declare() -> None:
    """The TypeScript delete variant has no `node` at all, and `Placement`'s
    optional members are absent rather than null. A bare `model_dump()` emits
    every Optional as an explicit null, so handlers must serialize through
    `dump_outcome`."""
    op = OP.validate_python({"op": "delete", "kind": "scene", "at": {"index": 1}})
    result = BuildResult(ops=[op], summary="s", focus=None)

    raw = result.model_dump()
    assert "node" in raw["ops"][0] and raw["ops"][0]["node"] is None, (
        "precondition: a bare model_dump does emit the null this guards against"
    )

    wire = dump_outcome(result)
    assert "node" not in wire["ops"][0], "a delete must not ship `node: null`"
    assert set(wire["ops"][0]["at"]) == {"index"}, (
        f"placement shipped keys the client does not declare: {sorted(wire['ops'][0]['at'])}"
    )


def test_build_result_fields_are_required_like_the_typescript_interface() -> None:
    """Defaults on the Python side would let the backend emit a shape the client
    rejects — the same drift that had `Placement.field` optional here and
    required there."""
    with pytest.raises(Exception):
        BuildResult()                       # ops/summary/focus all missing
    with pytest.raises(Exception):
        BuildResult(ops=[], summary="s")    # focus must be passed, even as None
