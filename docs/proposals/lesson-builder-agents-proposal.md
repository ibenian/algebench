# AlgeBench Lesson Builder — Multi-Agent Architecture Proposal

**Date**: 2026-03-29
**Branch**: `feat/lesson-builder-agents`
**Status**: Draft

---

## Motivation

The `algebench-scene-builder` skill gives a single agent full knowledge of the scene JSON format and produces correct scenes. However, building a *complete lesson* — a multi-scene, pedagogically sound, progressively structured learning experience — requires expertise that spans research, pedagogy, visual design, and technical implementation. No single agent prompt can cover all of these well.

This proposal introduces a **hierarchical multi-agent system** where specialized agents collaborate through an orchestrator. Each agent focuses on one concern, enabling parallel execution, targeted context windows, and iterative refinement.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              algebench-lesson-builder                │
│                  (Orchestrator)                      │
│                                                     │
│  Inputs: topic, optional existing JSON, constraints  │
│  Output: complete lesson JSON in scenes/             │
└───────┬──────────┬──────────┬───────────────────────┘
        │          │          │
   Phase 1 (parallel)    Phase 2 (sequential)    Phase 3 (parallel)
        │          │          │
   ┌────▼───┐ ┌───▼────┐ ┌───▼──────────────┐
   │Research│ │Pedagogy│ │  Lesson Designer  │
   │ Agent  │ │ Expert │ │  (uses outputs    │
   └────┬───┘ └───┬────┘ │   from Phase 1)   │
        │         │       └───┬──────────────┘
        ▼         ▼           │
   research    pedagogical    │
   brief       framework      ▼
                          scene outlines
                          (all steps per scene)
                              │
                    Phase 3   │  (parallel per scene)
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
              ┌──────────┐┌──────────┐┌──────────┐
              │  Scene   ││  Scene   ││  Scene   │
              │ Builder  ││ Builder  ││ Builder  │
              │ Scene 1  ││ Scene 2  ││ Scene N  │
              │(all steps││(all steps││(all steps│
              │ in pass) ││ in pass) ││ in pass) │
              └────┬─────┘└────┬─────┘└────┬─────┘
                   │           │           │
                   ▼           ▼           ▼
              complete scene JSONs
                   │
              Phase 4 (sequential)
                   ▼
           ┌───────────────┐
           │Syntax Validator│──fix──▶ (self-repair loop)
           └───────┬───────┘
                   │
              Phase 5
                   ▼
           ┌───────────────────┐
           │Pedagogical        │──feedback──▶ Scene Builder(s)
           │Evaluator          │             (targeted fixes)
           └───────┬───────────┘
                   │
                   ▼
            Final lesson JSON
```

---

## Agent Definitions

### 1. Orchestrator (`algebench-lesson-builder`)

**Role**: Top-level entry point. Manages the full pipeline, passes context between phases, merges outputs, and reports progress via TTS.

**Inputs**:
- `topic` (required) — the math concept to teach (e.g., "eigenvalues", "Fourier series")
- `existing_json` (optional) — path to an existing lesson JSON to enhance/extend
- `target_audience` (optional) — e.g., "undergraduate", "high school", "graduate"
- `num_scenes` (optional) — suggested scene count (default: agent decides)
- `constraints` (optional) — e.g., "no unsafe JS", "2D only", "include proofs"

**Responsibilities**:
1. Parse inputs and determine mode (new lesson vs. enhance existing)
2. Spawn Phase 1 agents in parallel (Research + Pedagogy Expert)
3. Collect Phase 1 outputs, spawn Lesson Designer (Phase 2)
4. Distribute scene outlines to Step Builders in parallel (Phase 3)
5. Run Syntax Validator on assembled JSON (Phase 4)
6. Run Pedagogical Evaluator (Phase 5)
7. Apply fixes if needed (max 1 feedback round to Step Builders)
8. Write final JSON to `scenes/`
9. Announce completion via TTS

**Progress reporting**: The orchestrator announces each phase transition via TTS and prints a status line to the conversation.

**File**: `.agents/skills/algebench-lesson-builder/SKILL.md`

---

### 2. Research Agent

**Role**: Gathers mathematical facts, definitions, theorems, proofs, real-world applications, and **citations** for the topic. Produces a structured research brief with source references that flow into the lesson's markdown documentation.

**Execution**: Phase 1, parallel with Pedagogy Expert.

**Inputs from Orchestrator**:
- Topic name
- Target audience level
- Any user-specified constraints or focus areas

**Output** (structured text/JSON):
```json
{
  "topic": "Eigenvalues & Eigenvectors",
  "prerequisites": ["matrix multiplication", "determinants", "linear independence"],
  "core_definitions": [...],
  "key_theorems": [...],
  "proofs_and_derivations": [
    {
      "name": "Characteristic equation derivation",
      "technique": "direct",
      "importance": "essential",
      "steps_summary": "Av=λv → (A-λI)v=0 → det(A-λI)=0",
      "prerequisite_concepts": ["determinants", "null space"]
    },
    {
      "name": "Eigenvalues of symmetric matrices are real",
      "technique": "direct",
      "importance": "enrichment",
      "steps_summary": "Use complex conjugate transpose argument",
      "prerequisite_concepts": ["complex numbers", "transpose"]
    }
  ],
  "worked_examples": [...],
  "geometric_intuitions": [...],
  "real_world_applications": [...],
  "common_misconceptions": [...],
  "related_topics": [...],
  "citations": [
    {
      "key": "strang2016",
      "type": "textbook",
      "text": "Strang, G. (2016). *Introduction to Linear Algebra*, 5th ed. Wellesley-Cambridge Press.",
      "relevance": "Standard reference for eigenvalue definitions and characteristic equation derivation (Ch. 6)"
    },
    {
      "key": "3b1b-eigen",
      "type": "video",
      "text": "3Blue1Brown. \"Eigenvectors and Eigenvalues | Chapter 14, Essence of Linear Algebra.\" YouTube.",
      "relevance": "Geometric intuition for eigenvectors as directions preserved under transformation"
    }
  ]
}
```

**Skills used**: Web search (if available), internal knowledge, existing scene analysis.

**Citations**: The Research Agent produces a `citations` array with keyed references (textbooks, papers, videos, online resources). These are passed through the pipeline and rendered as a "References" section at the bottom of each scene's `markdown` panel. For now, citations are embedded as plain markdown text. A future structured citation system (see `docs/proposals/citations-proposal.md`) will provide machine-readable references with per-use overrides.

**File**: `.agents/skills/lesson-builder-research/SKILL.md`

---

### 3. Pedagogy Expert

**Role**: Designs the pedagogical approach — how to structure the learning journey for maximum comprehension. Focuses on cognitive load, scaffolding, and engagement.

**Execution**: Phase 1, parallel with Research Agent.

**Inputs from Orchestrator**:
- Topic name
- Target audience level
- Existing lesson JSON (if enhancing)

**Output** (structured text/JSON):
```json
{
  "pedagogical_approach": "concrete-to-abstract with geometric grounding",
  "learning_objectives": [
    "Recognize eigenvectors geometrically as directions preserved by a transformation",
    "Compute eigenvalues from the characteristic equation",
    "Connect eigenvalues to geometric scaling factors"
  ],
  "scaffolding_strategy": "Start with visual observation, then name the concept, then derive the algebra",
  "engagement_hooks": [
    "Show a vector that 'magically' doesn't rotate — ask why",
    "Let students drag vectors to discover eigendirections"
  ],
  "scene_arc": [
    {"theme": "Observation", "goal": "See that most vectors rotate, some don't"},
    {"theme": "Definition", "goal": "Name the phenomenon: eigenvectors"},
    {"theme": "Computation", "goal": "Derive eigenvalues algebraically", "proof": "characteristic equation derivation"},
    {"theme": "Exploration", "goal": "Interactive sliders to build intuition"}
  ],
  "proof_strategy": {
    "placement": "Include a scene-level derivation in the Computation scene, synced to step-by-step visualization",
    "technique_choices": "Direct proof for characteristic equation — matches the algebraic build-up approach",
    "scaffolding": "Progressive reveal mode — one proof step at a time, with highlights on the changing terms",
    "audience_calibration": "Undergrad: show full algebraic derivation. High school: skip to result with geometric motivation."
  },
  "difficulty_progression": "linear with optional deep-dive steps",
  "estimated_duration_minutes": 15
}
```

**File**: `.agents/skills/lesson-builder-pedagogy/SKILL.md`

---

### 4. Lesson Designer

**Role**: Synthesizes the research brief and pedagogical framework into a concrete scene-by-scene outline. Decides what visual elements, steps, sliders, and markdown content each scene needs.

**Execution**: Phase 2, sequential (depends on Phase 1 outputs).

**Inputs from Orchestrator**:
- Research brief (from Research Agent)
- Pedagogical framework (from Pedagogy Expert)
- Constraints (audience, scene count, etc.)
- Existing lesson JSON (if enhancing)

**Output** (structured JSON):
```json
{
  "lesson_title": "Eigenvalues & Eigenvectors",
  "scenes": [
    {
      "scene_index": 0,
      "title": "Vectors That Don't Rotate",
      "purpose": "Visual hook — show the contrast between generic and eigen directions",
      "learning_objective": "Recognize that eigenvectors maintain their direction under transformation",
      "visual_strategy": "2D face-on view, matrix A applied to several vectors, eigenvectors highlighted",
      "step_outline": [
        {"step": 1, "title": "The Matrix", "action": "Show axes, grid, and state the matrix A", "elements": ["axes", "grid", "text"]},
        {"step": 2, "title": "A Generic Vector", "action": "Show v and Av, highlight direction change", "elements": ["vector", "vector"]},
        {"step": 3, "title": "An Eigenvector!", "action": "Show v1 and Av1 — same direction, different length", "elements": ["vector", "vector"]},
        {"step": 4, "title": "Explore", "action": "Slider to rotate input vector, observe when direction is preserved", "elements": ["animated_vector", "slider"]}
      ],
      "slider_plan": [
        {"id": "theta", "purpose": "Rotate input vector to discover eigendirections"}
      ],
      "proof_plan": [
        {
          "embedding_level": "scene",
          "proof_id": "char-eq-derivation",
          "title": "Deriving the Characteristic Equation",
          "technique": "direct",
          "goal": "Show that eigenvalues satisfy $\\det(A - \\lambda I) = 0$",
          "step_skeleton": [
            {"type": "given", "label": "Eigenvalue definition", "sync_to_step": 1},
            {"type": "step", "label": "Rearrange to $(A-\\lambda I)\\mathbf{v} = 0$", "sync_to_step": 2},
            {"type": "step", "label": "Nontrivial solution requires singular matrix", "sync_to_step": 2},
            {"type": "conclusion", "label": "Characteristic equation", "sync_to_step": 3}
          ],
          "highlight_strategy": "Highlight λ terms as they appear, color-code A vs λI"
        }
      ],
      "markdown_topics": ["eigenvalue equation", "matrix A definition", "geometric interpretation"],
      "camera": "2D face-on",
      "prompt_hints": "Guide student to discover eigendirections by dragging theta"
    }
  ]
}
```

**File**: `.agents/skills/lesson-builder-designer/SKILL.md`

---

### 5. Scene Builder

**Role**: Takes a single scene outline and produces the **complete scene JSON including all steps**. Expert on AlgeBench scene format, element types, expression syntax, sliders, animations, info overlays, and markdown. Builds all steps sequentially within one agent call, naturally tracking cumulative element state (what has been added/removed) across steps.

**Execution**: Phase 3, one instance per scene, **parallel across scenes**.

> **Why per-scene, not per-step?** Steps are cumulative — Step 3 depends on what Steps 1-2 added to the scene. A single agent building all steps in one pass naturally tracks this state without inter-agent coordination. The parallelism sweet spot is per-scene (scenes are independent), not per-step (steps are sequential within a scene).

**Inputs from Orchestrator**:
- Full scene outline with all step outlines (from Lesson Designer — one scene only)
- Summary of prior scenes (for continuity — what concepts were introduced, naming/color conventions used)
- Full `algebench-scene-builder` skill knowledge (embedded in its prompt)
- Research brief excerpt relevant to this scene

**Output**: Complete scene JSON object (one entry in the `scenes` array), including:
- Base `elements` (axes, grid, initial objects)
- All `steps` with cumulative add/remove, sliders, info overlays
- `markdown` panel content
- `prompt` field with agent teaching hints
- `camera` and `views`

**Key behaviors**:
- Builds steps **sequentially** within the scene, maintaining a mental model of the current element state
- Each step knows what elements exist from previous steps (cumulative add/remove tracking)
- Computes exact coordinates before writing JSON
- Uses math.js expressions (never native JS unless explicitly required)
- Includes axes, grid, proper camera, views
- Writes step titles, descriptions (narration), and markdown
- Adds `prompt` field with agent teaching hints
- Follows the scene builder checklist

**Skills used**: `algebench-scene-builder` knowledge is embedded in this agent's prompt. It also has access to the `audit-expressions` skill for self-checking.

**File**: `.agents/skills/lesson-builder-scene-builder/SKILL.md`

---

### 6. Syntax Validator

**Role**: Validates the assembled lesson JSON for correctness. Checks structural integrity, expression safety, and rendering feasibility. Fixes errors in-place.

**Execution**: Phase 4, sequential.

**Inputs**:
- Complete assembled lesson JSON

**Current checks**:
1. **JSON structure** — valid JSON, required fields present, correct nesting via `scripts/validate_schema.py`
2. **Element validity** — schema-level field/type validation for recognized element structures
3. **Expression safety** — flags JavaScript-style expressions such as `Math.*`, `.toFixed()`, arrow functions, and JS keywords
4. **Slider consistency** — warns on likely undefined slider references in expressions
5. **Remove targets** — checks that `remove` targets reference active IDs
6. **Range consistency** — warns when ranges and slider-driven values appear inconsistent
7. **Camera validity** — warns when camera positions are far outside scene bounds
8. **LaTeX escaping** — catches common escaping mistakes during content validation
9. **Info overlay placeholders** — checks `{{id}}` references against active sliders / valid expressions
10. **Proof highlights** — checks that `\\htmlClass{hl-NAME}` usage matches the `highlights` map
11. **Basic proof structure** — requires proof titles and non-empty step arrays; warns on unlabeled proof steps

**Required validator extensions before relying on this phase as a hard gate**:
1. **ID uniqueness** — detect duplicate element IDs within a scene
2. **Proof field completeness** — explicitly validate proof `id`, `goal`, and other required semantics beyond the schema pass
3. **Proof step validity** — validate proof-step `type` values and stronger per-step invariants
4. **Proof technique validation** — verify `technique` values against the supported proof-technique set
5. **Proof sceneStep refs** — validate that `sceneStep` references point to real scene steps and that root-level `"sceneIdx:stepIdx"` refs are well-formed
6. **Proof conclusion checks** — enforce conclusion-step expectations for derivations that claim a final result
7. **Expanded self-repair** — implement the broader auto-fix behavior assumed elsewhere in this proposal

**Output**: Validated JSON (with fixes applied) + validation report.

**Self-repair**: Today the validator can auto-fix a limited set of content issues (for example `Math.sin` → `sin`, common LaTeX escaping mistakes, and orphan proof highlights). For structural or semantic issues outside that set, it should call back to the relevant Scene Builder. Broader self-repair is future work.

**Tooling**: Uses the `algebench-validate-lesson` skill which provides:
1. `scripts/validate_schema.py` — JSON Schema validation (structural checks)
2. `scripts/validate_content.py` — deep content checks (expressions, slider refs, proofs, camera, overlays)
3. A limited auto-fix table for common errors (Math.sin→sin, bad LaTeX escaping, orphan highlights)

**Note**: The validation skill checks JSON against the schema and content rules only. It does NOT investigate whether fields are implemented in code — that's the schema generator's job.

**File**: `.agents/skills/lesson-builder-validator/SKILL.md`

---

### 7. Pedagogical Evaluator

**Role**: Reviews the complete lesson from a teaching perspective. Checks flow, consistency, cognitive load, and completeness. May request targeted modifications.

**Execution**: Phase 5, sequential.

**Inputs**:
- Complete validated lesson JSON
- Original pedagogical framework (from Pedagogy Expert)
- Research brief (from Research Agent)

**Evaluation criteria**:
1. **Progressive disclosure** — does each step build on the previous? No concept jumps?
2. **Cognitive load** — is any single step trying to convey too much?
3. **Consistency** — are colors, labels, and conventions maintained across scenes?
4. **Completeness** — are all learning objectives addressed?
5. **Engagement** — are there interactive elements (sliders, animations) at appropriate moments?
6. **Narration quality** — are step descriptions clear, concise, and pedagogically sound?
7. **Markdown quality** — does the Doc panel provide sufficient depth without being overwhelming?
8. **Mathematical accuracy** — are formulas, coordinates, and derivations correct?

**Output**:
```json
{
  "verdict": "pass" | "needs_revision",
  "score": 0.0-1.0,
  "issues": [
    {
      "severity": "critical" | "important" | "minor",
      "scene_index": 0,
      "step_index": 2,
      "category": "cognitive_load",
      "description": "Step 3 introduces both eigenvectors AND eigenvalues simultaneously",
      "suggestion": "Split into two steps: first show the geometric property, then name lambda"
    }
  ],
  "strengths": [...]
}
```

**Feedback loop**: If `verdict == "needs_revision"` and there are `critical` or `important` issues, the orchestrator sends targeted fix requests to the relevant Step Builder(s). This happens **at most once** (1 feedback round). Minor issues are logged but not acted upon.

**File**: `.agents/skills/lesson-builder-evaluator/SKILL.md`

---

## Execution Phases

| Phase | Agents | Parallelism | Depends On |
|-------|--------|-------------|------------|
| 0 | Orchestrator | — | User input |
| 1 | Research Agent + Pedagogy Expert | **Parallel** | Topic, audience |
| 2 | Lesson Designer | Sequential | Phase 1 outputs |
| 3 | Scene Builder × N (all steps per scene) | **Parallel** (one per scene) | Phase 2 outlines |
| 4 | Syntax Validator | Sequential | Phase 3 assembled JSON |
| 5 | Pedagogical Evaluator | Sequential | Phase 4 validated JSON |
| 5b | Scene Builder (targeted) | Parallel if multiple | Phase 5 feedback (optional) |
| 6 | Syntax Validator (re-run) | Sequential | Phase 5b fixes (if any) |

**Estimated wall-clock**: Phases 1 and 3 run in parallel, so the critical path is:
`Phase 1 (parallel) → Phase 2 → Phase 3 (parallel) → Phase 4 → Phase 5 → [optional 5b+6]`

---

## JSON Schema as Source of Truth

The lesson JSON format is formally defined in **`schemas/lesson.schema.json`** — a JSON Schema (draft-2020-12) with `description` annotations on every field. This schema is:

- **Generated from the codebase** by the `algebench-schema-generator` skill, which analyzes existing scenes, `app.js` renderer code, scene-builder skill docs, and proof model documentation
- **The single source of truth** for what constitutes valid lesson JSON
- **Referenced by agents** — the Scene Builder, Syntax Validator, and Evaluator all point to this schema rather than embedding format knowledge in prose
- **User-triggered** — run `/algebench-schema-generator` independently to regenerate after format changes

### How agents use the schema

| Agent | Schema Usage |
|-------|-------------|
| **Scene Builder** | Reads schema to know every field, type, and constraint. `description` annotations guide what to put in each field. |
| **Syntax Validator** | Validates assembled JSON against the schema. Checks required fields, enum values, type correctness. |
| **Pedagogical Evaluator** | References schema descriptions to assess whether fields are used effectively (e.g., is `prompt` populated with useful agent hints?). |
| **Lesson Designer** | Reads schema to know what element types and proof structures are available when designing scene outlines. |

### Schema validation script

Two validation scripts under `scripts/`:

```bash
# Schema validation — structure, types, required fields
./run.sh scripts/validate_schema.py scenes/eigenvalues.json
./run.sh scripts/validate_schema.py scenes/*.json
./run.sh scripts/validate_schema.py -v scenes/eigenvalues.json    # verbose sub-errors
./run.sh scripts/validate_schema.py --check-schema                # check schema itself

# Content validation — expressions, sliders, proofs, camera, overlays
./run.sh scripts/validate_content.py scenes/eigenvalues.json
./run.sh scripts/validate_content.py scenes/*.json
```

The `jsonschema` dependency is included in `requirements.txt`. All scripts run through `./run.sh` which handles venv setup automatically. The Syntax Validator agent runs both scripts as part of Phase 4.

**Separation of concerns**: The schema generator investigates code vs JSON discrepancies (reporting unimplemented fields). The validation skill only checks JSON against the schema and content rules — it does not investigate code.

### Intermediate vs. final JSON formats

The pipeline uses **two distinct JSON formats**:

1. **Intermediate formats** (agent-to-agent) — custom structured JSON for passing research briefs, pedagogical frameworks, and scene outlines between agents. These are **internal contracts** documented in each agent's skill file. They do NOT follow AlgeBench scene format.

2. **Final output** — valid AlgeBench lesson JSON conforming to `schemas/lesson.schema.json`. Only the Scene Builder produces this format. Only the orchestrator writes it to `scenes/`.

---

## File Layout

```
run.sh                                 # Run any project Python script through .venv

schemas/
└── lesson.schema.json                 # JSON Schema — generated by schema-generator skill

scripts/
├── validate_schema.py                 # Validate scene JSON files against the schema
├── validate_content.py                # Deep content checks (expressions, sliders, proofs, camera)
└── extract_structure.py               # Extract structural skeleton from scenes (for schema discovery)

.agents/skills/
├── algebench-schema-generator/        # Schema generator (user-invocable, run independently)
│   └── SKILL.md
├── algebench-validate-lesson/         # Lesson validator (user-invocable, used by Syntax Validator agent)
│   └── SKILL.md
├── algebench-lesson-builder/          # Orchestrator (user-invocable skill)
│   └── SKILL.md
├── lesson-builder-research/           # Research Agent
│   └── SKILL.md
├── lesson-builder-pedagogy/           # Pedagogy Expert
│   └── SKILL.md
├── lesson-builder-designer/           # Lesson Designer
│   └── SKILL.md
├── lesson-builder-scene-builder/      # Scene Builder (all steps in one pass)
│   └── SKILL.md
├── lesson-builder-validator/          # Syntax Validator
│   └── SKILL.md
└── lesson-builder-evaluator/          # Pedagogical Evaluator
    └── SKILL.md

.claude/skills/
├── algebench-schema-generator -> ../../.agents/skills/algebench-schema-generator
├── algebench-validate-lesson -> ../../.agents/skills/algebench-validate-lesson
├── algebench-lesson-builder -> ../../.agents/skills/algebench-lesson-builder
├── lesson-builder-research -> ../../.agents/skills/lesson-builder-research
├── lesson-builder-pedagogy -> ../../.agents/skills/lesson-builder-pedagogy
├── lesson-builder-designer -> ../../.agents/skills/lesson-builder-designer
├── lesson-builder-scene-builder -> ../../.agents/skills/lesson-builder-scene-builder
├── lesson-builder-validator -> ../../.agents/skills/lesson-builder-validator
└── lesson-builder-evaluator -> ../../.agents/skills/lesson-builder-evaluator
```

---

## Implementation Model

### Skill files = prompt libraries + standalone tools

Each agent in the pipeline is defined by a **SKILL.md file** that serves two purposes:

1. **Prompt library** — the orchestrator reads the skill file and passes its content as the `prompt` parameter to a Claude Code `Agent` tool call, along with phase-specific inputs (topic, research brief, scene outline, etc.)
2. **Standalone invocation** — users can invoke any skill directly (e.g., `/lesson-builder-scene-builder`) to run that agent independently without the full pipeline

There are **no separate agent files or runtime configurations** — just SKILL.md files under `.agents/skills/`. The Agent tool in Claude Code spawns real subprocesses with their own context windows.

### How the orchestrator spawns agents

The orchestrator SKILL.md instructs Claude Code to use the `Agent` tool at each phase. The pattern:

```
Phase 1 (parallel):
┌──────────────────────────────────────────────────────────────┐
│ Claude reads orchestrator SKILL.md                           │
│ → Agent tool call #1:                                        │
│     prompt = [lesson-builder-research/SKILL.md] + topic      │
│     description = "Research: {topic}"                        │
│     model = sonnet                                           │
│ → Agent tool call #2 (same message = parallel):              │
│     prompt = [lesson-builder-pedagogy/SKILL.md] + topic      │
│     description = "Pedagogy: {topic}"                        │
│     model = opus                                             │
└──────────────────────────────────────────────────────────────┘
                         ↓ both return
Phase 2 (sequential):
┌──────────────────────────────────────────────────────────────┐
│ → Agent tool call:                                           │
│     prompt = [lesson-builder-designer/SKILL.md]              │
│           + research brief (from Phase 1 agent #1)           │
│           + pedagogical framework (from Phase 1 agent #2)    │
│     description = "Design: {topic} lesson"                   │
│     model = opus                                             │
└──────────────────────────────────────────────────────────────┘
                         ↓ returns scene outlines
Phase 3 (parallel, one per scene):
┌──────────────────────────────────────────────────────────────┐
│ → Agent tool call per scene (all in one message = parallel): │
│     prompt = [lesson-builder-scene-builder/SKILL.md]         │
│           + scene outline + prior scene summaries             │
│           + schemas/lesson.schema.json                       │
│     description = "Build: Scene {i} - {title}"               │
│     model = opus                                             │
└──────────────────────────────────────────────────────────────┘
```

The orchestrator **reads each skill file** at execution time and embeds its content in the Agent prompt. This means skill files can be updated independently and the orchestrator always uses the latest version.

### Context passing between phases

Each agent receives its inputs as part of the prompt text. The orchestrator extracts the relevant output from each agent's result and includes it in the next agent's prompt. Pure message passing — no shared state, no files (until the final write).

### Model selection

| Agent | Model | Rationale |
|-------|-------|-----------|
| Orchestrator | `opus` | Coordination, context management |
| Research Agent | `sonnet` | Factual retrieval, fast |
| Pedagogy Expert | `opus` | Creative pedagogical design |
| Lesson Designer | `opus` | Structural decisions |
| Scene Builder | `opus` | Complex JSON + math accuracy |
| Syntax Validator | `sonnet` | Rule-based, uses scripts |
| Pedagogical Evaluator | `opus` | Nuanced quality assessment |

### Schema as agent input

The Scene Builder and Syntax Validator agents receive `schemas/lesson.schema.json` as part of their prompt context. This means:
- Scene Builder knows exactly what fields to produce and their constraints
- Syntax Validator can check against the schema programmatically via `scripts/validate_schema.py`
- When the schema is updated (via `/algebench-schema-generator`), all agents automatically use the new version on next run

---

## Modes of Operation

### 1. Full Pipeline (default)
```
/algebench-lesson-builder topic="Cross Product" audience="undergraduate"
```
Runs all phases end-to-end, produces a complete lesson JSON.

### 2. Enhance Existing Lesson
```
/algebench-lesson-builder existing="scenes/eigenvalues.json" enhance="add interactive exploration scene"
```
Reads existing JSON, runs Research + Pedagogy with the existing content as context, then extends/modifies.

### 3. Individual Agent Invocation
Each skill can be called directly for targeted work:
```
/lesson-builder-scene-builder scene_outline=<full scene outline with steps> context=<prior scenes>
/lesson-builder-research topic="Cross Product"
/lesson-builder-evaluator lesson="scenes/cross-product.json"
```
Useful for rebuilding a single scene, re-running research, or evaluating an existing lesson without the full pipeline.

---

## Progress Reporting

The orchestrator uses TTS announcements at each phase boundary:

| Event | TTS Message |
|-------|-------------|
| Start | "Starting lesson builder for {topic}. Running research and pedagogy analysis." |
| Phase 1 complete | "Research and pedagogy phases complete. Designing lesson structure." |
| Phase 2 complete | "Lesson design ready with {N} scenes. Building scene JSON in parallel." |
| Phase 3 complete | "All {N} scenes built. Running syntax validation." |
| Phase 4 complete | "Validation passed. Running pedagogical evaluation." |
| Phase 5 — pass | "Lesson complete! {N} scenes written to scenes/{filename}.json" |
| Phase 5 — revision | "Evaluator found {N} issues. Applying targeted fixes." |
| Final | "Lesson builder finished. {topic} lesson ready with {N} scenes and {M} total steps." |

The orchestrator also prints a concise status table to the conversation after each phase:

```
Phase 1 ✓  Research (12 definitions, 5 theorems) + Pedagogy (4 objectives, 3 scene arc)
Phase 2 ✓  Lesson Design: 4 scenes, 16 steps total
Phase 3 ✓  Scene JSON: 4/4 built (2847 lines total)
Phase 4 ✓  Validation: 2 auto-fixed (Math.sin→sin), 0 errors remaining
Phase 5 ✓  Evaluation: score 0.92, 0 critical, 1 minor (logged)
```

---

## Error Handling

| Failure | Recovery |
|---------|----------|
| Research agent returns sparse results | Orchestrator proceeds; Pedagogy Expert + Designer compensate with built-in knowledge |
| Scene Builder produces invalid JSON | Syntax Validator auto-repairs; if unfixable, re-runs that Scene Builder once |
| Evaluator returns `needs_revision` | Orchestrator sends targeted fixes to affected Scene Builders (max 1 round) |
| Second evaluation still fails | Orchestrator logs warnings, writes the best-effort JSON output, and emits a sidecar validation/report artifact plus conversation/TTS warnings describing the remaining issues |
| Agent timeout | Orchestrator retries once, then proceeds with available results |

---

## Design Decisions

### Why hierarchical, not flat?
A flat architecture (all agents at the same level) would require the orchestrator to manage complex inter-agent dependencies. The hierarchical phased approach makes dependencies explicit and enables natural parallelism points.

### Why separate Research and Pedagogy?
These are genuinely different expertise domains. A research expert prioritizes completeness and accuracy; a pedagogy expert prioritizes cognitive scaffolding and engagement. Separating them prevents one concern from dominating the other.

### Why per-scene Scene Builders (all steps in one pass)?
Each scene is self-contained enough to build independently, and the JSON generation is the most token-intensive part. Parallel execution across scenes provides the biggest wall-clock speedup. Within a scene, steps are built sequentially in a single agent call because steps are cumulative — Step N depends on knowing what Steps 1 through N-1 added/removed. A single agent naturally tracks this state without inter-agent coordination overhead.

### Why only 1 feedback round?
Diminishing returns: the first feedback round catches structural issues. A second round would primarily catch stylistic preferences, which aren't worth the latency. The evaluator should be calibrated to flag only genuinely important issues.

### Why skills instead of hardcoded prompts?
Skills are versioned with the repo, discoverable, and individually testable. A user can invoke `/lesson-builder-scene-builder` directly to rebuild one scene. Skills also benefit from Claude Code's skill loading mechanism.

---

## Proofs as a First-Class Concern

Mathematical proofs and derivations are central to effective math lessons. AlgeBench has a [rich proof system](../proofs-model.md) supporting structured step-by-step proofs with LaTeX, highlights, scene sync, and AI integration. The lesson builder must treat proofs as a first-class output, not an afterthought.

### How Proofs Flow Through the Pipeline

| Phase | Agent | Proof Responsibility |
|-------|-------|---------------------|
| 1 | **Research Agent** | Identifies key theorems, derivations, and proof techniques relevant to the topic. Outputs proof candidates with their type (direct, contradiction, induction, etc.) and prerequisite chain. |
| 1 | **Pedagogy Expert** | Decides *which* proofs to include, *when* in the lesson arc, and *how* to scaffold them (progressive reveal vs. full). Specifies proof placement level (root, scene, or step). |
| 2 | **Lesson Designer** | For each scene outline, specifies which proofs belong where: which embedding level (root/scene/step), which proof technique, which scene steps they sync to, and the proof step skeleton (labels + justifications). |
| 3 | **Scene Builder** | Produces the full `proof` JSON alongside elements and steps. Computes exact LaTeX, `\htmlClass` highlight regions, `sceneStep` sync links, justifications, explanations, and `prompt` hints for each proof step. Ensures cumulative scene state matches the proof's `sceneStep` references. |
| 4 | **Syntax Validator** | Validates proof structure: required fields (`id`, `title`, `goal`, `steps`), step types (`given`/`step`/`conclusion`/`remark`), valid `technique` keys, LaTeX escaping in `math` fields, `\htmlClass` region names matching `highlights` keys, and `sceneStep` references pointing to existing scene steps. |
| 5 | **Pedagogical Evaluator** | Evaluates proof quality: Are justifications clear? Are highlight regions meaningful? Does the scene sync enhance understanding? Is the proof scaffolded appropriately for the audience? Are `prompt` hints useful for the AI agent? |

### Proof-Specific Knowledge in the Scene Builder

The Scene Builder agent prompt must embed full knowledge of the proof schema (from `docs/proofs-model.md`):

- **Proof object structure**: `id`, `title`, `technique`, `techniqueHint`, `goal`, `prompt`, `sceneStep`, `steps`
- **Proof step structure**: `id`, `type`, `label`, `math`, `highlights`, `justification`, `explanation`, `prompt`, `sceneStep`, `tags`
- **Highlight mechanism**: `\htmlClass{hl-name}{...}` in LaTeX with corresponding `highlights` map entries
- **Embedding levels**: Root (lesson-wide), scene-level, step-level — and when to use each
- **Scene sync**: Bidirectional linking via `sceneStep` (integer for scene-level, `"sceneIdx:stepIdx"` for root-level)
- **Proof techniques**: All 16 technique keys and when to use them
- **Agent integration**: `prompt` fields at proof and step level for AI teaching hints

### Proof Design Patterns

The Lesson Designer should follow these patterns when placing proofs:

| Pattern | When to Use | Embedding Level |
|---------|-------------|-----------------|
| **Scene-spanning derivation** | A proof that unfolds across multiple scene steps (e.g., quadratic formula derivation synced to geometric visualization) | Scene-level proof with `sceneStep` links |
| **Step-local mini-proof** | A quick justification within one step (e.g., "why is det(A-λI) = 0?") | Step-level proof |
| **Lesson-wide theorem** | A foundational result referenced throughout (e.g., spectral theorem in an eigenvalue lesson) | Root-level proof with cross-scene `sceneStep` links |
| **Proof by exploration** | Interactive proof where sliders let students verify each step geometrically | Scene-level proof synced to slider steps |

### Proof Quality Checklist (for Evaluator)

- [ ] Every proof has a clear `goal` in LaTeX
- [ ] Proof `technique` matches the actual reasoning strategy used
- [ ] Every step has both `math` and `justification` (except `remark` type)
- [ ] Highlights mark pedagogically meaningful regions, not arbitrary subexpressions
- [ ] `sceneStep` links point to scene steps where the relevant visualization is visible
- [ ] Proof steps follow a logical chain — each step follows from previous steps and the justification
- [ ] `conclusion` step's `math` matches the proof's `goal`
- [ ] `prompt` hints guide the AI to explain the *why*, not just restate the *what*
- [ ] For audience-appropriate proofs: rigor matches target level (e.g., skip ε-δ for undergrad intro)

---

## Future Extensions

1. **Visual preview integration** — after generating JSON, spawn the `debug-chrome` skill to render the lesson and capture screenshots for the evaluator
2. **Student simulation** — an agent that "plays through" the lesson as a student, noting confusion points
3. **Adaptive difficulty** — the designer branches the lesson based on audience level
4. **Multi-lesson curriculum** — an upper orchestrator that designs a series of lessons building on each other
5. **In-app generation** — expose the lesson builder through the AlgeBench AI chat agent, enabling teachers to generate lessons from within the app

---

## Next Steps

1. **Review this proposal** — get feedback on the architecture before implementing
2. **Implement orchestrator skill** (`.agents/skills/algebench-lesson-builder/SKILL.md`)
3. **Implement leaf agents** (research, pedagogy, designer, step-builder, validator, evaluator)
4. **Create symlinks** in `.claude/skills/`
5. **Test with a known topic** (e.g., "Cross Product") end-to-end
6. **Update AGENTS.md** with the new skills table entries
