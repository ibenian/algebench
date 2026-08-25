#!/usr/bin/env python3
"""Check the hand-written mirrors against their sources of truth.

Two mirrors, each maintained by hand, each able to drift silently:

  * `backend/model/lesson.py` mirrors `schemas/lesson.schema.json` so a builder's
    output can be typed before it reaches the browser.
  * `backend/experts/contracts.py` mirrors `src/placement.ts` so the wire contract
    means the same thing on both sides.

Neither is generated, so nothing fails when they fall behind. This is what does.

Usage:
    ./run.sh scripts/validate_model_parity.py            # all checks
    ./run.sh scripts/validate_model_parity.py -v         # per-check detail

Exit codes:
    0  All checks passed
    1  One or more checks failed

The checks live here rather than only in pytest so they follow the house pattern
for validation (see validate_schema.py, validate_content.py, audit_expressions.py)
and can be run directly while editing. `tests/` imports these functions rather
than restating them, so there is one implementation and two entry points.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "schemas" / "lesson.schema.json"
PLACEMENT_TS = ROOT / "src" / "placement.ts"
SCENES = ROOT / "scenes"

sys.path.insert(0, str(ROOT))


class CheckFailure(Exception):
    """One named check failed, with a human-readable reason."""


# ── the model against the schema ─────────────────────────────────────────────

def identical(a, b) -> bool:
    """Structural equality that also compares NUMERIC TYPE.

    `==` cannot do this job: Python holds `0 == 0.0`, and that reaches inside
    lists and dicts, so `[0, 0, 10]` compares equal to `[0.0, 0.0, 10.0]`.
    Measured — with a plain `==`, annotating a coordinate as `float` (which
    rewrites every integer in every published lesson) passed the whole suite.
    """
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return type(a) is type(b) and a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(identical(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(identical(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b


def check_corpus_round_trips(verbose: bool = False) -> None:
    """Every published lesson survives the model unchanged.

    The strongest of these checks, and self-maintaining: each lesson added to the
    repo extends coverage, and any type too narrow fails against real content
    rather than against my reading of the schema.
    """
    from backend.model.lesson import Scene

    files = sorted(SCENES.glob("*.json"))
    if len(files) < 10:
        raise CheckFailure(f"expected the published corpus, found {len(files)} files")

    for path in files:
        raw = json.loads(path.read_text())
        for i, original in enumerate(raw.get("scenes") or [raw]):
            dumped = Scene.model_validate(original).model_dump(
                mode="json", by_alias=True, exclude_none=True
            )
            if not identical(dumped, original):
                raise CheckFailure(
                    f"{path.name} scene {i} ({original.get('title')!r}) did not round-trip — "
                    f"the model is lossy or a type is too narrow"
                )
        if verbose:
            print(f"   ✅ {path.name}")


def check_model_fields_exist_in_schema(verbose: bool = False) -> None:
    """No model field names a property the schema does not have.

    jsonschema cannot catch this: `$defs.element` is `additionalProperties: true`,
    so a stale field validates happily and simply never does anything.
    """
    from backend.model.lesson import (
        Camera, Element, InfoOverlay, Proof, RemoveDirective, Scene, Slider, Step, View,
    )

    schema = json.loads(SCHEMA.read_text())
    pairs = [
        (Scene, "scene"), (Step, "step"), (Element, "element"), (Slider, "slider"),
        (Camera, "camera"), (View, "view"), (RemoveDirective, "removeDirective"),
        (InfoOverlay, "infoOverlay"), (Proof, "proof"),
    ]
    for model, defn in pairs:
        allowed = set(schema["$defs"][defn]["properties"])
        declared = {f.alias or name for name, f in model.model_fields.items()}
        extra = declared - allowed
        if extra:
            raise CheckFailure(
                f"{model.__name__} declares field(s) absent from $defs.{defn}: {sorted(extra)}"
            )
        if verbose:
            print(f"   ✅ {model.__name__} ⊆ $defs.{defn}")


def check_model_imports_nothing_heavy(verbose: bool = False) -> None:
    """The canonical model must be usable without the LM stack.

    A design requirement, not tidiness: scripts and light CI jobs import it, and a
    stray `import dspy` would make every one of them slow.
    """
    code = (
        "import sys; import backend.model.lesson, backend.experts.contracts; "
        "print(','.join(m for m in ('dspy','litellm','sympy','fastapi','torch') if m in sys.modules))"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT,
                         capture_output=True, text=True, check=True)
    heavy = out.stdout.strip()
    if heavy:
        raise CheckFailure(f"the model/contract pulled in heavy deps: {heavy}")
    if verbose:
        print("   ✅ no heavy imports")


# ── the contract against its TypeScript twin ─────────────────────────────────

def _ts_interface_fields(src: str, name: str) -> set[str]:
    m = re.search(rf"export interface {name} \{{(.*?)\n\}}", src, re.S)
    if not m:
        raise CheckFailure(f"interface {name} not found in placement.ts")
    return set(re.findall(r"^\s*(\w+)\??:", m.group(1), re.M))


def check_contract_matches_typescript(verbose: bool = False) -> None:
    """The wire contract means the same thing in both languages."""
    from backend.experts import contracts
    from backend.experts.contracts import NODE_KINDS, SUPPORTED_KINDS, BuildResult, Placement

    src = PLACEMENT_TS.read_text()

    if _ts_interface_fields(src, "Placement") != set(Placement.model_fields):
        raise CheckFailure("Placement fields disagree between placement.ts and contracts.py")

    ts_optional = set()
    m = re.search(r"export interface Placement \{(.*?)\n\}", src, re.S)
    if m:
        ts_optional = {n for n, q in re.findall(r"^\s*(\w+)(\??):", m.group(1), re.M) if q == "?"}
    py_optional = {n for n, f in Placement.model_fields.items() if not f.is_required()}
    if ts_optional != py_optional:
        raise CheckFailure(
            f"Placement optionality disagrees: TS optional {sorted(ts_optional)}, "
            f"Python optional {sorted(py_optional)}"
        )

    if _ts_interface_fields(src, "BuildResult") != set(BuildResult.model_fields):
        raise CheckFailure("BuildResult fields disagree between the two mirrors")

    kinds = set(re.findall(r"'([^']+)'", re.search(r"export type NodeKind =(.*?);", src, re.S).group(1)))
    if kinds != set(NODE_KINDS) or set(contracts.NodeKind.__args__) != kinds:
        raise CheckFailure(f"NodeKind disagrees: TS {sorted(kinds)}, Python {sorted(NODE_KINDS)}")

    sup = re.search(r"export type SupportedKind = Extract<NodeKind, (.*?)>;", src, re.S)
    if not sup or set(re.findall(r"'([^']+)'", sup.group(1))) != set(SUPPORTED_KINDS):
        raise CheckFailure("SupportedKind disagrees between the two mirrors")

    if "PlacementField" in src or "field" in Placement.model_fields:
        raise CheckFailure(
            "a placement `field` was reintroduced — the container is derived from `kind`, "
            "and having both made illegal kind/field pairs representable"
        )

    if verbose:
        print("   ✅ placements, outcomes and kinds agree")


def check_builder_context_matches_typescript(verbose: bool = False) -> None:
    """The builder context is assembled on the client and validated here.

    That makes it a wire shape like any other: the two declarations must agree, or
    the backend rejects a context the client considers well-formed.
    """
    from backend.experts.handlers.build_scene.context import (
        MAX_INTENT_CHARS, MAX_SCENES_SUMMARISED, MAX_SUMMARY_CHARS, BuilderContext,
    )

    src = (ROOT / "src" / "builder-context.ts").read_text()

    ts_fields = _ts_interface_fields(src, "BuilderContext")
    py_fields = set(BuilderContext.model_fields)
    if ts_fields != py_fields:
        raise CheckFailure(
            f"BuilderContext fields disagree: only in TS {sorted(ts_fields - py_fields)}, "
            f"only in Python {sorted(py_fields - ts_fields)}"
        )

    for name, value in (
        ("MAX_SCENES_SUMMARISED", MAX_SCENES_SUMMARISED),
        ("MAX_SUMMARY_CHARS", MAX_SUMMARY_CHARS),
        ("MAX_INTENT_CHARS", MAX_INTENT_CHARS),
    ):
        m = re.search(rf"export const {name} = (\d+);", src)
        if not m or int(m.group(1)) != value:
            raise CheckFailure(
                f"{name} disagrees: TypeScript {m.group(1) if m else 'missing'}, Python {value}"
            )

    if verbose:
        print("   ✅ builder context fields and bounds agree")


CHECKS = [
    ("corpus round-trips through the model", check_corpus_round_trips),
    ("model fields exist in the schema", check_model_fields_exist_in_schema),
    ("model and contract import nothing heavy", check_model_imports_nothing_heavy),
    ("contract matches src/placement.ts", check_contract_matches_typescript),
    ("builder context matches src/builder-context.ts", check_builder_context_matches_typescript),
]


def main() -> None:
    ap = argparse.ArgumentParser(description="Check hand-written mirrors against their sources")
    ap.add_argument("-v", "--verbose", action="store_true", help="show per-item detail")
    args = ap.parse_args()

    failed = 0
    for label, fn in CHECKS:
        try:
            fn(verbose=args.verbose)
            print(f"✅ {label}")
        except CheckFailure as e:
            print(f"❌ {label}\n   {e}")
            failed += 1

    print()
    if failed:
        print(f"❌ {failed} of {len(CHECKS)} check(s) failed.")
        sys.exit(1)
    print(f"✅ All {len(CHECKS)} checks passed.")
    sys.exit(0)


if __name__ == "__main__":
    main()
