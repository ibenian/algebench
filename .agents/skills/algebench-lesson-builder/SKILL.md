---
name: algebench-lesson-builder
description: Orchestrator for the multi-agent lesson builder pipeline. Coordinates research, pedagogy, design, scene building, validation, and evaluation to produce complete AlgeBench lesson JSON.
args: "topic=<string> [audience=<string>] [num_scenes=<int>] [constraints=<string>] [existing=<path>] [enhance=<string>]"
---

# AlgeBench Lesson Builder — Orchestrator

You are the **Orchestrator** of the AlgeBench lesson builder pipeline. You coordinate specialized agents across 5 phases to produce a complete, pedagogically sound, validated lesson JSON file.

---

## Parameters

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `topic` | Yes | — | Math concept to teach (e.g., "eigenvalues", "cross product", "Fourier series") |
| `audience` | No | `"undergraduate"` | Target audience: `"high school"`, `"undergraduate"`, `"graduate"` |
| `num_scenes` | No | Agent decides | Suggested number of scenes |
| `constraints` | No | — | Free-text constraints (e.g., "2D only", "include proofs", "no unsafe JS") |
| `existing` | No | — | Path to existing lesson JSON to enhance/extend |
| `enhance` | No | — | Free-text enhancement request when modifying an existing lesson (e.g., "add an interactive exploration scene", "improve the proof scaffolding") |

---

## Pipeline Overview

```
Phase 1 (parallel)  → Research Agent + Pedagogy Expert
Phase 2 (sequential) → Lesson Designer
Phase 3 (parallel)  → Scene Builder × N (one per scene)
Phase 4 (sequential) → Syntax Validator
Phase 5 (sequential) → Pedagogical Evaluator
Phase 5b (optional) → Targeted Scene Builder fixes + re-validation
```

---

## Execution Instructions

### Before Starting

1. **Announce via TTS**: "Starting lesson builder for {topic}. Running research and pedagogy analysis."
2. **Check prerequisites**:
   - Verify `schemas/lesson.schema.json` exists. If not, tell the user to run `/algebench-schema-generator` first and stop.
3. **Read skill files** — you will embed these in Agent prompts:
   - `.agents/skills/lesson-builder-research/SKILL.md`
   - `.agents/skills/lesson-builder-pedagogy/SKILL.md`
   - `.agents/skills/lesson-builder-designer/SKILL.md`
   - `.agents/skills/lesson-builder-scene-builder/SKILL.md`
   - `.agents/skills/lesson-builder-validator/SKILL.md`
   - `.agents/skills/lesson-builder-evaluator/SKILL.md`
4. **Read supporting files**:
   - `schemas/lesson.schema.json` — the schema (pass to Scene Builder and Validator)
   - `.agents/skills/algebench-scene-builder/SKILL.md` — scene format reference (pass to Scene Builder)

### Phase 1: Research + Pedagogy (parallel)

Spawn **two agents in the same message** (parallel execution):

**Agent 1 — Research**:
```
description: "Research: {topic}"
model: sonnet
prompt: [contents of lesson-builder-research/SKILL.md]

Your task:
- topic: {topic}
- audience: {audience}
- constraints: {constraints}

Produce the research brief JSON as described in your instructions.
```

**Agent 2 — Pedagogy**:
```
description: "Pedagogy: {topic}"
model: opus
prompt: [contents of lesson-builder-pedagogy/SKILL.md]

Your task:
- topic: {topic}
- audience: {audience}
- existing_json: {existing, if provided}

Produce the pedagogical framework JSON as described in your instructions.
```

After both return:
- **Print status**: `Phase 1 ✓  Research ({N} definitions, {M} theorems) + Pedagogy ({K} objectives, {J} scene arc)`
- **Announce via TTS**: "Research and pedagogy phases complete. Designing lesson structure."

### Phase 2: Lesson Design (sequential)

Spawn **one agent**:

```
description: "Design: {topic} lesson"
model: opus
prompt: [contents of lesson-builder-designer/SKILL.md]

Your task:
- research_brief: {Phase 1 research output}
- pedagogical_framework: {Phase 1 pedagogy output}
- constraints: {constraints}
- existing_json: {existing, if provided}

Produce the lesson blueprint JSON as described in your instructions.
```

After it returns:
- **Extract scene outlines** from the blueprint
- **Print status**: `Phase 2 ✓  Lesson Design: {N} scenes, {M} steps total`
- **Announce via TTS**: "Lesson design ready with {N} scenes. Building scene JSON in parallel."

### Phase 3: Scene Building (parallel)

Spawn **one agent per scene, all in the same message** (parallel execution):

For each scene `i` in the blueprint:
```
description: "Build: Scene {i} - {title}"
model: opus
prompt: [contents of lesson-builder-scene-builder/SKILL.md]

=== SCENE BUILDER REFERENCE ===
[contents of algebench-scene-builder/SKILL.md]

=== JSON SCHEMA ===
[contents of schemas/lesson.schema.json]

=== YOUR SCENE OUTLINE ===
{scene outline for scene i from the blueprint}

=== PRIOR SCENES SUMMARY ===
{summary of what earlier scenes established — concepts, colors, naming conventions}

=== RESEARCH EXCERPT ===
{relevant portion of research brief for this scene's topic}

=== COLOR CONVENTIONS ===
{color_conventions from the blueprint}

=== NAMING CONVENTIONS ===
{naming_conventions from the blueprint}

Produce a complete scene JSON object as described in your instructions.
Output ONLY the JSON — no surrounding text.
```

After each scene builder returns:
- **Check if the scene uses unsafe JS**: If the scene has `"unsafe": true`, note it — the orchestrator must propagate this to the lesson root later.
- **Write the output** to a temporary file (e.g., `scenes/{topic-slug}/scene-{i}.json`)
- **Lint the scene** using the lint script:
  ```bash
  ./run.sh scripts/lint_scene.py --fix scenes/{topic-slug}/scene-{i}.json
  ```
  This checks and auto-fixes: nested props (flattens), Math.sin→sin, invalid element types, missing fields.
  Scenes with `"unsafe": true` skip expression checks (JS is intentional).
  If lint fails after --fix (unfixable errors remain), fix manually or retry the scene builder once.

After all scenes pass review:
- **If ANY scene has `"unsafe": true`**: Add `"unsafe": true` and `"unsafeExplanation"` to the lesson root. The explanation should list which scenes use JS and why (collected from scene builders). Move `"unsafe"` off individual scenes — it belongs at the lesson root in multi-scene format.
- **Assemble using the assembly script**:
  ```bash
  # For new lessons: create the lesson shell first, then add scenes
  echo '{"title": "{lesson_title}", "scenes": []}' > scenes/{topic-slug}.json
  ./run.sh scripts/assemble_scene.py scenes/{topic-slug}.json --add scenes/{topic-slug}/scene-0.json
  ./run.sh scripts/assemble_scene.py scenes/{topic-slug}.json --add scenes/{topic-slug}/scene-1.json
  # ... for each scene

  # For enhance mode: add/replace scenes in the existing lesson
  ./run.sh scripts/assemble_scene.py {existing} --add scenes/{topic-slug}/scene-N.json
  ./run.sh scripts/assemble_scene.py {existing} --replace {index} scenes/{topic-slug}/scene-N.json

  # List scenes in a lesson
  ./run.sh scripts/assemble_scene.py {existing} --list
  ```
  Validate separately in Phase 4 using `./run.sh scripts/validate_content.py`.
  If the blueprint includes root-level proofs, add them manually to the lesson root before assembly.
- **Print status**: `Phase 3 ✓  Scene JSON: {N}/{N} built ({lines} lines total)`
- **Announce via TTS**: "All {N} scenes built. Running syntax validation."

### Phase 4: Syntax Validation (sequential)

Spawn **one agent**:

```
description: "Validate: {topic} lesson"
model: sonnet
prompt: [contents of lesson-builder-validator/SKILL.md]

Your task:
- lesson: {path to the assembled JSON file}

Run full validation (schema + content). Auto-fix what you can. Report remaining errors.
```

After it returns:
- **Parse the validation report**
- If **pass** (0 remaining errors):
  - **Print status**: `Phase 4 ✓  Validation: {N} auto-fixed, 0 errors remaining`
  - Proceed to Phase 5
- If **fail** with remaining errors:
  - Check if errors are `fixable_by: scene_builder`
  - If yes, send targeted fix requests to affected Scene Builders (one retry)
  - If no, log errors as warnings and proceed (best-effort)
- **Announce via TTS**: "Validation {passed/completed with warnings}. Running pedagogical evaluation."

### Phase 5: Pedagogical Evaluation (sequential)

Spawn **one agent**:

```
description: "Evaluate: {topic} lesson"
model: opus
prompt: [contents of lesson-builder-evaluator/SKILL.md]

Your task:
- lesson: {path to the validated JSON file}
- pedagogical_framework: {Phase 1 pedagogy output}
- research_brief: {Phase 1 research output}

Evaluate the lesson and produce your assessment.
```

After it returns:
- **Parse the evaluation**
- If `verdict == "pass"`:
  - **Print status**: `Phase 5 ✓  Evaluation: score {score}, {N} critical, {M} minor`
  - Proceed to finalization
- If `verdict == "needs_revision"` with `critical` or `important` issues:
  - **Phase 5b**: Send targeted fixes to relevant Scene Builders (max 1 round)
  - Re-run validation (Phase 4 again) after fixes
  - **Print status**: `Phase 5b ✓  Fixes applied: {N} issues addressed`
- **Announce via TTS**: "Evaluation complete."

### Finalization

1. **Write final JSON** to `scenes/{topic-slug}.json` (if not already there from Phase 3)
2. **Print final status table**:
   ```
   Phase 1 ✓  Research (12 definitions, 5 theorems) + Pedagogy (4 objectives, 3 scene arc)
   Phase 2 ✓  Lesson Design: 4 scenes, 16 steps total
   Phase 3 ✓  Scene JSON: 4/4 built (2847 lines total)
   Phase 4 ✓  Validation: 2 auto-fixed (Math.sin→sin), 0 errors remaining
   Phase 5 ✓  Evaluation: score 0.92, 0 critical, 1 minor (logged)
   ```
3. **Announce via TTS**: "Lesson builder finished. {topic} lesson ready with {N} scenes and {M} total steps."

---

## Error Handling

| Failure | Recovery |
|---------|----------|
| Research agent returns sparse results | Proceed — Pedagogy Expert + Designer compensate with built-in knowledge |
| Scene Builder produces invalid JSON | Syntax Validator auto-repairs; if unfixable, re-run that Scene Builder once |
| Scene Builder agent fails/times out | Retry once; if still fails, skip that scene and warn the user |
| Evaluator returns `needs_revision` | Send targeted fixes to affected Scene Builders (max 1 round) |
| Second evaluation still fails | Log warnings, write best-effort JSON, announce remaining issues via TTS |
| Schema file missing | Stop immediately, tell user to run `/algebench-schema-generator` |
| Validator scripts missing | Stop immediately, report missing scripts |

---

## Enhance Mode

When `existing` is provided:

1. Read the existing lesson JSON (use `--list` to inspect: `./run.sh scripts/assemble_scene.py {existing} --list`)
2. Pass it to both Phase 1 agents as context
3. The Lesson Designer receives the existing structure and the `enhance` instructions
4. Scene Builders receive existing scenes they're modifying (instead of building from scratch)
5. Use the assembly script to add/replace scenes:
   - New scenes: `./run.sh scripts/assemble_scene.py {existing} --add scene.json [--at N]`
   - Modified scenes: `./run.sh scripts/assemble_scene.py {existing} --replace N scene.json`
6. Only modified/new scenes go through validation and evaluation

---

## Context Passing Rules

- **Each agent gets ONLY what it needs** — don't dump the entire pipeline state into every prompt
- **Research brief** → Designer, Scene Builders (excerpt), Evaluator
- **Pedagogy framework** → Designer, Evaluator
- **Blueprint** → Scene Builders (their scene only), Evaluator (for reference)
- **Schema** → Scene Builders, Validator
- **Scene builder knowledge** → Scene Builders only
- **Prior scene summaries** → each Scene Builder gets a summary of earlier scenes, NOT the full JSON

---

## Topic Slug Generation

Convert the topic to a filename-safe slug:
- Lowercase
- Replace spaces with hyphens
- Remove special characters
- Example: "Eigenvalues & Eigenvectors" → `eigenvalues-eigenvectors`

---

## Output

The orchestrator produces:
1. A complete lesson JSON file at `scenes/{topic-slug}.json`
2. A status table printed to the conversation
3. TTS announcements at each phase transition
