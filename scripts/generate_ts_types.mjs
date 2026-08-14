#!/usr/bin/env node
//
// generate_ts_types.mjs — Generate TypeScript declarations from the JSON Schemas.
//
// Usage:
//   npm run types:generate     # write src/types/*.d.ts
//   npm run types:check        # regenerate into memory and fail on drift (CI)
//
// The schemas in schemas/ are the single source of truth for the lesson data
// model. This script projects them into .d.ts so the frontend can be typed
// against the same definitions the Python validator enforces
// (tests/test_scene_schemas.py), rather than against a hand-written copy that
// silently drifts.
//
// Output is COMMITTED. Nothing here runs at request time or at deploy time —
// Node is a dev-time-only dependency.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from 'json-schema-to-typescript';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(REPO_ROOT, 'schemas');
const OUT_DIR = join(REPO_ROOT, 'src', 'types');

// Each entry: the schema to read, and the .d.ts to emit beside it.
//
// Only the lesson schema is projected today. semantic-graph.schema.json is
// deliberately NOT included yet — the graph shapes are typed in phase 3,
// alongside the modules that actually consume them. semantic-graph-theme is
// Python-side theme-authoring input (scripts/graph_to_mermaid.py) and is not a
// frontend shape at all.
const TARGETS = [
  { schema: 'lesson.schema.json', out: 'lesson.d.ts', name: 'Lesson' },
];

// `bannerComment` replaces the library's own banner. Keep it explicit about
// provenance so a hand-edit is obviously wrong, and name the exact command.
function banner(schemaFile) {
  return [
    '/* eslint-disable */',
    '/**',
    ` * GENERATED FILE — DO NOT EDIT BY HAND.`,
    ` *`,
    ` * Source:    schemas/${schemaFile}`,
    ` * Generator: scripts/generate_ts_types.mjs`,
    ` * Regenerate: npm run types:generate`,
    ` *`,
    ` * Edit the schema, then regenerate. CI fails if this file is out of date.`,
    ' */',
  ].join('\n');
}

const COMPILE_OPTIONS = {
  // The schemas are the contract; a stricter surface here would silently
  // diverge from what the Python validator accepts.
  additionalProperties: false,
  // Schema `description` fields become JSDoc — the lesson schema carries ~294
  // of them, which is most of this file's value in an editor.
  bannerComment: '',
  style: { singleQuote: true },
  // Resolve $refs relative to schemas/ so sibling schema files can be
  // referenced if a target ever needs to span more than one file.
  cwd: SCHEMA_DIR,
};

/** Compile one target and return its .d.ts source text. */
async function render({ schema, name }) {
  const raw = await readFile(join(SCHEMA_DIR, schema), 'utf8');
  const parsed = JSON.parse(raw);
  const body = await compile(parsed, name, COMPILE_OPTIONS);
  return `${banner(schema)}\n\n${body.trimStart()}`;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  await mkdir(OUT_DIR, { recursive: true });

  let drifted = false;
  for (const target of TARGETS) {
    const next = await render(target);
    const outPath = join(OUT_DIR, target.out);

    if (checkOnly) {
      let current = null;
      try {
        current = await readFile(outPath, 'utf8');
      } catch {
        // Missing output is drift, reported below like any other mismatch.
      }
      if (current !== next) {
        drifted = true;
        console.error(
          `✗ src/types/${target.out} is out of date with schemas/${target.schema}`,
        );
      } else {
        console.log(`✓ src/types/${target.out}`);
      }
      continue;
    }

    await writeFile(outPath, next, 'utf8');
    console.log(`wrote src/types/${target.out}  (from schemas/${target.schema})`);
  }

  if (drifted) {
    console.error('\nRun `npm run types:generate` and commit the result.');
    process.exit(1);
  }
}

await main();
