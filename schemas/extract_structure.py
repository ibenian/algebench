#!/usr/bin/env python3
"""Extract structural skeleton from AlgeBench scene JSON files.

Reads scene files and outputs a compact structural summary suitable for
schema discovery — field names, types, nesting, enum values, and sample
values. Long strings are truncated, repeated array items are collapsed.

Usage:
    # Extract structure from all scenes
    ./run.sh schemas/extract_structure.py scenes/*.json

    # Extract with higher string truncation limit
    ./run.sh schemas/extract_structure.py --max-string 80 scenes/*.json

    # Output as JSON (for programmatic use)
    ./run.sh schemas/extract_structure.py --json scenes/*.json

Exit codes:
    0  Success
    1  No files found or parse error
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


def type_name(val):
    """Return a human-readable type name for a JSON value."""
    if val is None:
        return "null"
    if isinstance(val, bool):
        return "boolean"
    if isinstance(val, int):
        return "integer"
    if isinstance(val, float):
        return "number"
    if isinstance(val, str):
        return "string"
    if isinstance(val, list):
        return "array"
    if isinstance(val, dict):
        return "object"
    return type(val).__name__


def truncate_string(s, max_len):
    """Truncate string and indicate original length."""
    if len(s) <= max_len:
        return s
    return s[:max_len] + f"... ({len(s)} chars)"


def extract_skeleton(val, max_string=40, max_array_samples=3, depth=0):
    """Recursively extract structural skeleton from a JSON value."""
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val
    if isinstance(val, str):
        return truncate_string(val, max_string)
    if isinstance(val, list):
        if not val:
            return []
        # Group items by structural signature
        seen_signatures = []
        samples = []
        for item in val:
            sig = _signature(item)
            if sig not in seen_signatures:
                seen_signatures.append(sig)
                samples.append(extract_skeleton(item, max_string, max_array_samples, depth + 1))
                if len(samples) >= max_array_samples:
                    break
        suffix = f" /* {len(val)} items, {len(seen_signatures)} unique shapes */"
        return {"__array__": samples, "__meta__": suffix}
    if isinstance(val, dict):
        result = {}
        for k, v in val.items():
            result[k] = extract_skeleton(v, max_string, max_array_samples, depth + 1)
        return result
    return str(val)


def _signature(val):
    """Compute a structural signature for deduplication."""
    if isinstance(val, dict):
        # Signature is the sorted set of keys + type of "type" field if present
        keys = tuple(sorted(val.keys()))
        type_val = val.get("type", "")
        return ("object", keys, type_val)
    if isinstance(val, list):
        return ("array", len(val))
    return type_name(val)


def format_skeleton(skeleton, indent=0):
    """Format skeleton as readable text output."""
    lines = []
    _format_recursive(skeleton, lines, indent, "")
    return "\n".join(lines)


def _format_recursive(val, lines, indent, prefix):
    pad = "  " * indent
    if isinstance(val, dict):
        if "__array__" in val:
            # Array summary
            meta = val.get("__meta__", "")
            lines.append(f"{pad}{prefix}[]{meta}")
            for i, sample in enumerate(val["__array__"]):
                _format_recursive(sample, lines, indent + 1, f"[{i}] ")
            return
        if not val:
            lines.append(f"{pad}{prefix}{{}}")
            return
        lines.append(f"{pad}{prefix}{{")
        for k, v in val.items():
            _format_recursive(v, lines, indent + 1, f"{k}: ")
        lines.append(f"{pad}}}")
    elif isinstance(val, list):
        if not val:
            lines.append(f"{pad}{prefix}[]")
        else:
            lines.append(f"{pad}{prefix}[{len(val)} items]")
    elif isinstance(val, str):
        # Show type + truncated value
        lines.append(f"{pad}{prefix}\"{val}\"")
    elif isinstance(val, bool):
        lines.append(f"{pad}{prefix}{str(val).lower()}")
    elif isinstance(val, (int, float)):
        lines.append(f"{pad}{prefix}{val}")
    elif val is None:
        lines.append(f"{pad}{prefix}null")
    else:
        lines.append(f"{pad}{prefix}{val}")


def merge_field_catalog(all_skeletons):
    """Merge skeletons from multiple files into a unified field catalog."""
    catalog = defaultdict(lambda: {"types": set(), "samples": [], "count": 0, "files": []})

    def _walk(val, path, filename):
        key = ".".join(path) or "(root)"
        entry = catalog[key]
        entry["count"] += 1
        if filename not in entry["files"]:
            entry["files"].append(filename)

        if isinstance(val, dict):
            if "__array__" in val:
                entry["types"].add("array")
                for sample in val["__array__"]:
                    _walk(sample, path + ["[]"], filename)
            else:
                entry["types"].add("object")
                for k, v in val.items():
                    _walk(v, path + [k], filename)
        elif isinstance(val, str):
            entry["types"].add("string")
            if len(entry["samples"]) < 3 and val not in entry["samples"]:
                entry["samples"].append(val)
        elif isinstance(val, bool):
            entry["types"].add("boolean")
        elif isinstance(val, int):
            entry["types"].add("integer")
        elif isinstance(val, float):
            entry["types"].add("number")
        elif val is None:
            entry["types"].add("null")

    for filename, skeleton in all_skeletons:
        _walk(skeleton, [], filename)

    return catalog


def format_catalog(catalog):
    """Format the merged field catalog as readable text."""
    lines = []
    lines.append("=" * 70)
    lines.append("📋 FIELD CATALOG (merged from all files)")
    lines.append("=" * 70)
    lines.append("")

    for path in sorted(catalog.keys()):
        entry = catalog[path]
        types = ", ".join(sorted(entry["types"]))
        files = f"({len(entry['files'])} file{'s' if len(entry['files']) != 1 else ''})"
        lines.append(f"  {path}")
        lines.append(f"    types: {types}  {files}")
        if entry["samples"]:
            samples_str = " | ".join(entry["samples"][:3])
            lines.append(f"    samples: {samples_str}")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Extract structural skeleton from scene JSON files")
    parser.add_argument("files", nargs="*", type=Path, help="Scene JSON files to analyze")
    parser.add_argument("--max-string", type=int, default=40, help="Max string length before truncation (default: 40)")
    parser.add_argument("--max-samples", type=int, default=3, help="Max unique array item shapes to show (default: 3)")
    parser.add_argument("--json", action="store_true", help="Output as JSON instead of text")
    parser.add_argument("--catalog", action="store_true", help="Show merged field catalog across all files")
    args = parser.parse_args()

    if not args.files:
        parser.print_help()
        sys.exit(0)

    all_skeletons = []

    for path in args.files:
        if not path.exists():
            print(f"⏭️  {path} (not found)", file=sys.stderr)
            continue

        try:
            with open(path) as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"❌ {path}: {e}", file=sys.stderr)
            continue

        skeleton = extract_skeleton(data, args.max_string, args.max_samples)
        all_skeletons.append((path.name, skeleton))

        if args.json:
            continue

        if not args.catalog:
            print(f"{'=' * 70}")
            print(f"📄 {path}")
            print(f"{'=' * 70}")
            print(format_skeleton(skeleton))
            print()

    if args.json:
        output = {name: skel for name, skel in all_skeletons}
        print(json.dumps(output, indent=2, default=str))
    elif args.catalog:
        catalog = merge_field_catalog(all_skeletons)
        print(format_catalog(catalog))

    if all_skeletons:
        print(f"✅ Extracted structure from {len(all_skeletons)} file(s).", file=sys.stderr)
    else:
        print("❌ No files processed.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
