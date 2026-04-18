#!/usr/bin/env python3
"""Validate AlgeBench JSON files against a schema.

Usage:
    # Validate scene files against lesson schema (default)
    ./run.sh scripts/validate_schema.py scenes/eigenvalues.json

    # Validate all scenes
    ./run.sh scripts/validate_schema.py scenes/*.json

    # Validate a semantic graph against the semantic-graph schema
    ./run.sh scripts/validate_schema.py --schema semantic-graph graph.json

    # Pipe from latex_to_graph
    ./run.sh scripts/latex_to_graph.py "E = mc^2" | ./run.sh scripts/validate_schema.py --schema semantic-graph -

    # Validate with verbose output
    ./run.sh scripts/validate_schema.py -v scenes/eigenvalues.json

    # Just check the schema itself is valid
    ./run.sh scripts/validate_schema.py --check-schema
    ./run.sh scripts/validate_schema.py --check-schema --schema semantic-graph

Exit codes:
    0  All files valid
    1  One or more files invalid
    2  Schema file missing or invalid
"""

import argparse
import json
import sys
from pathlib import Path

try:
    import jsonschema
    from jsonschema import Draft202012Validator, ValidationError
except ImportError:
    print("❌ Missing dependency: pip install jsonschema", file=sys.stderr)
    print("   Or run: ./run.sh scripts/validate_schema.py (handles venv automatically)", file=sys.stderr)
    sys.exit(2)

SCHEMAS_DIR = Path(__file__).parent.parent / "schemas"

SCHEMA_ALIASES: dict[str, str] = {
    "lesson": "lesson.schema.json",
    "semantic-graph": "semantic-graph.schema.json",
}


def load_schema(name: str = "lesson") -> dict:
    filename = SCHEMA_ALIASES.get(name, f"{name}.schema.json")
    path = SCHEMAS_DIR / filename
    if not path.exists():
        available = sorted(p.stem.removesuffix(".schema") for p in SCHEMAS_DIR.glob("*.schema.json"))
        print(f"❌ Schema not found: {path}", file=sys.stderr)
        print(f"   Available: {', '.join(available)}", file=sys.stderr)
        sys.exit(2)
    with open(path) as f:
        return json.load(f)


def check_schema(schema: dict) -> bool:
    try:
        Draft202012Validator.check_schema(schema)
        return True
    except jsonschema.SchemaError as e:
        print(f"❌ Schema is invalid: {e.message}", file=sys.stderr)
        return False


def validate_file(path: Path, validator: Draft202012Validator, verbose: bool) -> list[str]:
    try:
        with open(path) as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        return [f"Invalid JSON: {e}"]

    errors = []
    for error in sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path)):
        location = " > ".join(str(p) for p in error.absolute_path) or "(root)"
        errors.append(f"  [{location}] {error.message}")
        if verbose and error.context:
            for sub in error.context:
                sub_loc = " > ".join(str(p) for p in sub.absolute_path) or "(root)"
                errors.append(f"    └ [{sub_loc}] {sub.message}")

    return errors


def validate_data(data: dict, validator: Draft202012Validator, verbose: bool) -> list[str]:
    errors = []
    for error in sorted(validator.iter_errors(data), key=lambda e: list(e.absolute_path)):
        location = " > ".join(str(p) for p in error.absolute_path) or "(root)"
        errors.append(f"  [{location}] {error.message}")
        if verbose and error.context:
            for sub in error.context:
                sub_loc = " > ".join(str(p) for p in sub.absolute_path) or "(root)"
                errors.append(f"    └ [{sub_loc}] {sub.message}")
    return errors


def main():
    parser = argparse.ArgumentParser(description="Validate JSON files against an AlgeBench schema")
    parser.add_argument(
        "files", nargs="*",
        help="JSON files to validate, or '-' for stdin",
    )
    parser.add_argument(
        "--schema", "-s", default="lesson",
        help="Schema name: 'lesson' (default), 'semantic-graph', or any basename in schemas/",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Show sub-errors for oneOf/anyOf")
    parser.add_argument("-e", "--errors-only", action="store_true", help="Only show files with errors (suppress passing files)")
    parser.add_argument("--check-schema", action="store_true", help="Only validate the schema itself")
    args = parser.parse_args()

    schema = load_schema(args.schema)

    if args.check_schema:
        if check_schema(schema):
            print(f"✅ Schema '{args.schema}' is valid.")
            sys.exit(0)
        else:
            sys.exit(2)

    if not args.files:
        parser.print_help()
        sys.exit(0)

    if not check_schema(schema):
        sys.exit(2)

    validator = Draft202012Validator(schema)
    failed = 0
    total = 0

    for entry in args.files:
        if entry == "-":
            total += 1
            try:
                data = json.load(sys.stdin)
            except json.JSONDecodeError as e:
                print(f"❌ (stdin)")
                print(f"  Invalid JSON: {e}")
                failed += 1
                continue
            errors = validate_data(data, validator, args.verbose)
            if errors:
                print(f"❌ (stdin)")
                for e in errors:
                    print(e)
                failed += 1
            elif not args.errors_only:
                print(f"✅ (stdin)")
        else:
            path = Path(entry)
            total += 1
            if not path.exists():
                print(f"⏭️  {path} (not found)")
                continue
            errors = validate_file(path, validator, args.verbose)
            if errors:
                print(f"❌ {path}")
                for e in errors:
                    print(e)
                failed += 1
            elif not args.errors_only:
                print(f"✅ {path}")

    if failed:
        print(f"\n❌ {failed} file(s) failed validation.")
        sys.exit(1)
    elif not args.errors_only:
        print(f"\n✅ All {total} file(s) valid.")
        sys.exit(0)


if __name__ == "__main__":
    main()
