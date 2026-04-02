#!/usr/bin/env python3
"""Assemble scenes into AlgeBench lesson JSON files.

Adds, replaces, or removes scenes in a multi-scene lesson file.

Usage:
    ./run.sh scripts/assemble_scene.py lesson.json --add scene.json
    ./run.sh scripts/assemble_scene.py lesson.json --add scene.json --at 3
    ./run.sh scripts/assemble_scene.py lesson.json --replace 2 scene.json
    ./run.sh scripts/assemble_scene.py lesson.json --remove 4
    ./run.sh scripts/assemble_scene.py lesson.json --list

Exit codes:
    0  Success
    1  Error (invalid JSON, index out of range, etc.)
"""

import argparse
import json
import sys
from pathlib import Path


def load_json(path):
    """Load and parse a JSON file."""
    try:
        with open(path) as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f'Error: Invalid JSON in {path}: {e}')
        sys.exit(1)
    except FileNotFoundError:
        print(f'Error: File not found: {path}')
        sys.exit(1)


def save_json(path, data):
    """Write JSON with 2-space indent and trailing newline."""
    with open(path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')


def print_summary(lesson):
    """Print a summary of the lesson structure."""
    scenes = lesson.get('scenes', [])
    total_steps = sum(len(s.get('steps', [])) for s in scenes)
    lines = len(json.dumps(lesson, indent=2).split('\n'))
    print(f'\n  Title: {lesson.get("title", "(no title)")}')
    print(f'  Scenes: {len(scenes)}, Steps: {total_steps}, Lines: {lines}')
    for i, scene in enumerate(scenes):
        steps = len(scene.get('steps', []))
        print(f'    [{i}] {scene.get("title", "(untitled)")} ({steps} steps)')


def require_lesson(lesson):
    """Exit if not a multi-scene lesson."""
    if 'scenes' not in lesson:
        print('Error: Not a multi-scene lesson (no "scenes" array)')
        sys.exit(1)


def strip_unsafe_reason(scene):
    """Strip _unsafe_reason signal field from a scene. Returns the reason or None."""
    reason = scene.pop('_unsafe_reason', None)
    if reason:
        print(f'  Note: Scene uses native JS — {reason}')
    return reason


def cmd_list(args):
    """List scenes in a lesson."""
    lesson = load_json(args.lesson)
    require_lesson(lesson)
    print_summary(lesson)


def cmd_add(args):
    """Add a scene to a lesson."""
    lesson = load_json(args.lesson)
    require_lesson(lesson)

    scene = load_json(args.scene_file)

    if 'scenes' in scene:
        print('Error: Scene file contains a "scenes" array — pass a single scene object, not a lesson')
        sys.exit(1)

    if 'title' not in scene:
        print('Warning: Scene has no "title" field')

    strip_unsafe_reason(scene)

    idx = args.at if args.at is not None else len(lesson['scenes'])
    if idx < 0 or idx > len(lesson['scenes']):
        print(f'Error: Index {idx} out of range (0..{len(lesson["scenes"])})')
        sys.exit(1)

    lesson['scenes'].insert(idx, scene)
    save_json(args.lesson, lesson)

    print(f'Added "{scene.get("title", "(untitled)")}" at index {idx}')
    print_summary(lesson)


def cmd_replace(args):
    """Replace a scene in a lesson."""
    lesson = load_json(args.lesson)
    require_lesson(lesson)

    idx = args.index
    if idx < 0 or idx >= len(lesson['scenes']):
        print(f'Error: Index {idx} out of range (0..{len(lesson["scenes"]) - 1})')
        sys.exit(1)

    scene = load_json(args.scene_file)
    if 'scenes' in scene:
        print('Error: Scene file contains a "scenes" array — pass a single scene object')
        sys.exit(1)

    strip_unsafe_reason(scene)

    old_title = lesson['scenes'][idx].get('title', '(untitled)')
    lesson['scenes'][idx] = scene
    save_json(args.lesson, lesson)

    print(f'Replaced [{idx}] "{old_title}" with "{scene.get("title", "(untitled)")}"')
    print_summary(lesson)


def cmd_remove(args):
    """Remove a scene from a lesson."""
    lesson = load_json(args.lesson)
    require_lesson(lesson)

    idx = args.index
    if idx < 0 or idx >= len(lesson['scenes']):
        print(f'Error: Index {idx} out of range (0..{len(lesson["scenes"]) - 1})')
        sys.exit(1)

    removed = lesson['scenes'].pop(idx)
    save_json(args.lesson, lesson)

    print(f'Removed [{idx}] "{removed.get("title", "(untitled)")}"')
    print_summary(lesson)


def main():
    parser = argparse.ArgumentParser(
        description='Assemble scenes into AlgeBench lesson JSON files'
    )
    parser.add_argument('lesson', type=Path, help='Lesson JSON file')

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--add', dest='scene_file', type=Path,
                       help='Scene JSON file to add')
    group.add_argument('--replace', dest='replace_index', type=int, metavar='INDEX',
                       help='Scene index to replace (use with positional scene file)')
    group.add_argument('--remove', dest='remove_index', type=int, metavar='INDEX',
                       help='Scene index to remove')
    group.add_argument('--list', action='store_true',
                       help='List scenes in the lesson')

    parser.add_argument('--at', type=int, default=None,
                        help='Insert position for --add (default: append)')
    parser.add_argument('scene_for_replace', nargs='?', type=Path,
                        help='Scene JSON file (used with --replace)')

    args = parser.parse_args()

    if args.list:
        cmd_list(args)
    elif args.scene_file:
        cmd_add(args)
    elif args.replace_index is not None:
        if not args.scene_for_replace:
            parser.error('--replace requires a scene file argument')
        args.index = args.replace_index
        args.scene_file = args.scene_for_replace
        cmd_replace(args)
    elif args.remove_index is not None:
        args.index = args.remove_index
        cmd_remove(args)


if __name__ == '__main__':
    main()
