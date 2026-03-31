---
name: algebench-schema-generator
description: Generate or update the AlgeBench lesson JSON Schema by analyzing existing scenes, renderer code, scene-builder skill docs, and proof model documentation. Produces schemas/lesson.schema.json.
args: "[--scan-json <glob>]"
---

# AlgeBench Schema Generator

Generate or update the **JSON Schema** for AlgeBench lesson files by analyzing the actual codebase. The schema is the single source of truth for lesson JSON structure — referenced by scene builders, validators, and other agents.

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `--scan-json <glob>` | No | *(none — no scan)* | Glob pattern for JSON files to scan for structure extraction. When omitted, **skip Step 1 entirely** — work only from application code analysis and the existing schema. When provided, run the extraction script against the given glob. Prefer recursive globs so nested fixtures are included. Examples: `--scan-json "scenes/**/*.json"`, `--scan-json "tests/fixtures/**/*.json"`. |

### Caller guidance

Before invoking this skill, check whether `schemas/lesson.schema.json` exists and ask the user:
- **Schema does NOT exist** → tell the user no schema exists yet and recommend `--scan-json "scenes/**/*.json"` to bootstrap from existing scene files, including nested test/proof fixtures. Ask for confirmation or an alternative glob before proceeding.
- **Schema exists** → tell the user a schema already exists and recommend updating from code only (no `--scan-json`). Ask if they want to re-scan scene files anyway.

---

## What You Produce

A single file: **`schemas/lesson.schema.json`**

This is a [JSON Schema (draft-2020-12)](https://json-schema.org/draft/2020-12/schema) that formally describes the complete AlgeBench lesson format. Every field must have a `description` annotation explaining its purpose, valid values, and any gotchas. These descriptions serve as documentation for both humans and AI agents.

---

## Sources to Analyze

The schema is derived from **two authoritative sources**: scene files and application code. Do not depend on documentation — it may be stale.

### 1. Existing scene files (what actually exists)
```
scenes/**/*.json
```

**Do NOT read scene files directly** — they can be large and will waste context. Instead, use the structure extraction script:

```bash
# Merged field catalog across all scenes (recommended first step)
./run.sh scripts/extract_structure.py --catalog scenes/**/*.json

# Per-file skeleton with truncated strings
./run.sh scripts/extract_structure.py scenes/**/*.json

# JSON output for programmatic use
./run.sh scripts/extract_structure.py --json scenes/**/*.json
```

The `--catalog` mode merges all scenes into a unified field inventory showing path, types, occurrence count, and sample values. This gives you everything needed for schema discovery without loading full file contents.

Only read a specific scene file directly if you need to inspect a particular pattern more closely (e.g., a proof structure or unusual element type flagged in the catalog).

### 2. Application code (what the app actually consumes)

These are the **authoritative sources** — the code defines what fields exist, their types, and defaults.

```
static/app.js       — 3D renderer, scene loader, element dispatch, sliders, steps, camera
static/objects/     — element renderer implementations, per-type field consumption, defaults, aliases
static/chat.js      — AI chat, TTS, UI tool responses
static/proof.js     — proof panel rendering, proof-step fields, highlights, scene sync, proof chat context
server.py           — scene file loading, WebSocket handler, agent tools
agent_tools.py      — system prompt assembly, scene/step/proof prompt context exposed to the AI
```

Search for:
- Property access on scene/element/step/proof objects (e.g., `el.type`, `step.add`, `proof.steps`)
- Element type dispatch (switch/if chains on `type`) — discovers all supported types
- Default values applied when fields are missing (e.g., `el.width || 3`)
- Proof rendering and navigation logic (proof steps, highlights, scene sync)
- Slider evaluation and expression sandbox setup

---

## Schema Requirements

The schema structure must be **discovered from scene files and code**. Documentation may be stale — do not depend on it. The two authoritative sources are:
1. **Scene files** (via `extract_structure.py`) — what actually exists
2. **Application code** (`app.js`, `chat.js`, `proof.js`, `server.py`, `agent_tools.py`) — what the app actually consumes, with defaults and types

The only hard constraints on the schema itself:
- **JSON Schema draft-2020-12** format
- **Root must accept both** single-scene and multi-scene (lesson) formats — discover the distinction from existing files
- **Use `$defs`** for reusable type definitions to keep the schema DRY — the agent decides the decomposition based on what it finds
- **Every field gets a `description`** (see quality standards below)

---

## Description Quality Standards

Every `description` field must be:
- **Actionable** — tells the agent what to put there, not just what it is
- **Complete** — includes valid values, defaults, and edge cases
- **Example-bearing** — short inline examples for non-obvious fields

Good:
```json
"description": "Tip position in data space as [x,y,z]. Required. Example: [2,1,0] for a 2D vector in the XY plane."
```

Bad:
```json
"description": "The position."
```

For expression fields, always note:
```json
"description": "Array of 3 math.js expression strings for [x,y,z]. Use slider IDs and 't' (time). Example: [\"k*2\", \"k*1\", \"0\"]. Use math.js syntax (sin, cos, pi) NOT JavaScript (Math.sin, Math.PI)."
```

---

## Generation Process

### Step 1: Extract structure from JSON files (only if `--scan-json` provided)

**Skip this step entirely if `--scan-json` was not provided.** Proceed directly to Step 2.
When scanning scenes, prefer recursive globs such as `scenes/**/*.json` so nested directories like `scenes/test/` are not missed.

When `--scan-json <glob>` is provided, run the extraction script to get a complete field inventory without reading raw JSON:

```bash
./run.sh scripts/extract_structure.py --catalog <glob>
```

This gives you every field path, its observed types, how many files use it, and sample values. This is your **primary input** for schema generation — it tells you what actually exists in the wild.

If a field in the catalog looks ambiguous (e.g., appears as both `integer` and `string`), inspect that specific scene:
```bash
./run.sh scripts/extract_structure.py scenes/specific-file.json
```

### Step 2: Analyze application code

Read `static/app.js`, `static/objects/index.js`, the `static/objects/*.js` renderers, `static/chat.js`, `static/proof.js`, `server.py`, and `agent_tools.py`. These are the **authoritative sources** for what fields the app consumes, their types, and defaults. Search for:
- Property access on scene/element/step/proof objects
- Element type dispatch (switch/if on `type`) — discover this in `static/objects/index.js`
- Per-element renderer field access in `static/objects/*.js` — this is where most element-specific properties, aliases, and defaults are defined
- Default values applied when fields are missing (e.g., `el.width || 3`)
- Proof rendering, highlight, and navigation logic
- Slider evaluation and expression sandbox setup
- Fields consumed but not present in any existing scene (supported but unused)

### Step 3: Cross-reference catalog vs code

Compare **catalog** (what exists in scenes) vs **code** (what's consumed by the app). This is **investigation, not validation** — the goal is to understand what should go in the schema.

| Finding | Action | Report as |
|---------|--------|-----------|
| Field in catalog AND in code | Include in schema | *(normal — no flag)* |
| Field in code but not in any scene | Include in schema (supported, just unused) | `ℹ️ Code-only field` |
| Field in catalog but NOT in code | **Do NOT include in schema.** The JSON has it but the app ignores it. | `⚠️ Unimplemented field` |
| Type mismatch between catalog and code | **Trust the code** | `⚠️ Type mismatch` |
| Default in code | Include the default in the schema | *(normal)* |

**The schema only includes fields that the code actually consumes.** Fields found in JSON but not implemented in code are reported as discrepancies but excluded from the schema.

### Step 4: Build the schema

Using code as the authority and catalog for additional context:
- Only include fields that the code actually reads
- Mark fields as required vs optional based on code behavior (does it check for existence? use a fallback?)
- Add enums where the code dispatches on a closed set of values (e.g., element `type`, proof `technique`)
- Add defaults from code analysis
- Write `description` annotations derived from code context (see quality standards above)

### Step 5: Write to `schemas/lesson.schema.json`

### Step 6: Validate

Use the `algebench-validate-lesson` skill to validate all `scenes/**/*.json` files. If any valid scene fails, the schema is too strict — fix the schema and re-validate until all scenes pass.

### Step 7: Report

Summary including:
- Total element types and fields documented
- `⚠️ Unimplemented fields` — fields found in scene JSON but not consumed by code (with file and path)
- `ℹ️ Code-only fields` — fields consumed by code but not found in any scene
- `⚠️ Type mismatches` — where catalog type differs from code expectation
- Validation results (N scenes tested, all passed / M failures fixed)

---

## Update Mode

If `schemas/lesson.schema.json` already exists:
1. Read the existing schema
2. If `--scan-json` was provided, run `./run.sh scripts/extract_structure.py --catalog <glob>` to get current field inventory. Otherwise skip scanning.
3. Diff the catalog against the existing schema — identify new fields, removed fields, changed types
4. Read docs/code only for fields that changed or were added
5. Update the schema in place
6. Use the `algebench-validate-lesson` skill to validate all `scenes/**/*.json` — if any scene fails, fix the schema and re-validate
7. Report what changed (added N fields, updated M descriptions, removed K deprecated fields, validation results)

---

## Output Checklist

- [ ] Valid JSON Schema draft-2020-12
- [ ] Every field from every element type documented
- [ ] All proof fields documented (proof object + proof step + highlights)
- [ ] Both single-scene and lesson formats supported at root
- [ ] `description` on every field (no empty descriptions)
- [ ] Expression fields note math.js syntax requirement
- [ ] Default values documented where applicable
- [ ] Cross-referenced against all scenes — no false rejections
- [ ] Written to `schemas/lesson.schema.json`
- [ ] `algebench-validate-lesson` skill passes for ALL existing `scenes/**/*.json`
