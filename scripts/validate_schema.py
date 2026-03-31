#!/usr/bin/env python3
"""Validate AlgeBench scene JSON files against the lesson schema.

Usage:
    # Validate a single file
    ./run.sh scripts/validate_schema.py scenes/eigenvalues.json

    # Validate all scenes
    ./run.sh scripts/validate_schema.py scenes/*.json

    # Validate with verbose output
    ./run.sh scripts/validate_schema.py -v scenes/eigenvalues.json

    # Just check the schema itself is valid
    ./run.sh scripts/validate_schema.py --check-schema

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

SCHEMA_PATH = Path(__file__).parent.parent / "schemas" / "lesson.schema.json"


def load_schema() -> dict:
    if not SCHEMA_PATH.exists():
        print(f"❌ Schema not found: {SCHEMA_PATH}", file=sys.stderr)
        print("   Run /algebench-schema-generator to create it.", file=sys.stderr)
        sys.exit(2)
    with open(SCHEMA_PATH) as f:
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


def main():
    parser = argparse.ArgumentParser(description="Validate scene JSON against AlgeBench schema")
    parser.add_argument("files", nargs="*", type=Path, help="Scene JSON files to validate")
    parser.add_argument("-v", "--verbose", action="store_true", help="Show sub-errors for oneOf/anyOf")
    parser.add_argument("-e", "--errors-only", action="store_true", help="Only show files with errors (suppress passing files)")
    parser.add_argument("--check-schema", action="store_true", help="Only validate the schema itself")
    args = parser.parse_args()

    schema = load_schema()

    if args.check_schema:
        if check_schema(schema):
            print("✅ Schema is valid.")
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

    for path in args.files:
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
        print(f"\n✅ All {len(args.files)} file(s) valid.")
        sys.exit(0)


if __name__ == "__main__":
    main()
