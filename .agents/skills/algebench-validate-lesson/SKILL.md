---
name: algebench-validate-lesson
description: Validate an AlgeBench lesson or scene JSON file against the lesson schema. Reports structural errors, missing fields, invalid types, bad expressions, and proof issues. Fixes errors when possible.
---

# AlgeBench Lesson Validator

Validate lesson/scene JSON files against `schemas/lesson.schema.json` and perform deep content checks beyond what JSON Schema can catch.

---

## When to Use

- Before committing a new or modified scene file
- As Phase 4 of the lesson builder pipeline (Syntax Validator agent calls this)
- After manually editing a scene JSON
- To diagnose why a scene doesn't render correctly

---

## Validation Process

### Step 1: Schema Validation (automated)

Run the validation script against the target file:

```bash
./run.sh scripts/validate_schema.py -v <file>
```

If the schema file `schemas/lesson.schema.json` does not exist, tell the user to run `/algebench-schema-generator` first and stop.

If schema validation **passes**, proceed to Step 2.

If schema validation **fails**, read the error output and:
1. Report each error with its JSON path and description
2. For auto-fixable errors (see table below), fix them directly
3. Re-run validation to confirm fixes
4. If errors remain that can't be auto-fixed, report them and stop

### Step 2: Content Validation (automated)

Run the content validation script:

```bash
./run.sh scripts/validate_content.py <file>
```

If it passes, proceed to Step 3. If it fails, report the errors and apply auto-fixes where possible.

These checks go beyond structural schema validation:

#### Expression Safety
- Scan all `expr`, `fromExpr`, `x`, `y`, `z`, `fx`, `fy`, `fz`, `expression` fields
- Flag any JavaScript patterns: `Math.`, `.toFixed(`, `=>`, `function`, `let `, `const `, `return `, `for(`, `while(`
- Unless the scene has `"unsafe": true`, these are errors
- Auto-fix: replace `Math.sin` → `sin`, `Math.cos` → `cos`, `Math.PI` → `pi`, `Math.sqrt` → `sqrt`, `Math.abs` → `abs`, `Math.pow(x,n)` → `pow(x,n)`, `Math.E` → `e`, `t**n` → `t^n`

#### Slider-Expression Consistency
- For each scene/step, collect all active slider IDs (cumulative from previous steps, minus removed)
- Check that expression fields only reference known slider IDs and `t`
- Flag references to undefined sliders

#### Range Consistency
- Check that axis element ranges match the scene `range`
- Check that slider max values don't produce element positions outside the scene range
- Warning (not error) — sometimes intentional for zoom effects

#### Remove Target Validity
- Track cumulative element IDs through steps
- Check that `remove` targets reference IDs that exist at that point
- Flag `remove` of an ID that was never added or already removed

#### Info Overlay Placeholders
- Check `{{id}}` placeholders in info overlay `content` fields
- Each placeholder must reference an active slider ID or be a valid math.js expression

#### Proof Checks
- Every proof has `id`, `title`, `goal`, `steps` (non-empty)
- Every proof step has `id`, `label`, `math`
- `technique` values are valid keys (see proofs-model.md §3.2)
- `\htmlClass{hl-NAME}` regions in `math` match keys in `highlights` map
- `sceneStep` values reference valid step indices
- Root-level proof `sceneStep` uses `"sceneIdx:stepIdx"` string format
- Scene/step-level proof `sceneStep` uses integer format
- At least one step has `type: "conclusion"` for proofs (not required for derivations)

#### LaTeX Escaping
- Check that LaTeX in `label`, `title`, `description`, `math`, `markdown` fields has properly doubled backslashes in JSON
- Common error: single `\vec` instead of `\\vec`

#### Camera Sanity
- Camera `position` and `target` should be within reasonable bounds of the scene `range`
- Warning if camera is more than 5x the range extent away

### Step 3: Report

Print a summary:

```
Validated: scenes/eigenvalues.json

Schema:      PASS
Expressions: PASS (14 checked, 0 issues)
Sliders:     PASS (6 checked, 0 undefined refs)
Ranges:      WARN (1 warning: axis Y range [-3,3] but slider max produces y=4.2)
Remove IDs:  PASS (3 checked)
Overlays:    PASS (2 checked)
Proofs:      PASS (1 proof, 8 steps, all highlights matched)
LaTeX:       PASS
Camera:      PASS

Result: VALID (1 warning)
```

If auto-fixes were applied:
```
Auto-fixed 2 issues:
  - elements[3].expr[0]: Math.sin(t) → sin(t)
  - elements[3].expr[2]: Math.PI → pi
```

### Step 4: Fix Mode

When called with the intent to fix (by the Syntax Validator agent or user), after reporting:
1. Apply all auto-fixable changes using the Edit tool
2. Re-run `./run.sh scripts/validate_schema.py -v <file>` to confirm
3. Report remaining issues that need manual attention

---

## Auto-Fix Table

| Pattern | Fix | Category |
|---------|-----|----------|
| `Math.sin(x)` | `sin(x)` | Expression |
| `Math.cos(x)` | `cos(x)` | Expression |
| `Math.tan(x)` | `tan(x)` | Expression |
| `Math.sqrt(x)` | `sqrt(x)` | Expression |
| `Math.abs(x)` | `abs(x)` | Expression |
| `Math.pow(x,n)` | `pow(x,n)` | Expression |
| `Math.PI` | `pi` | Expression |
| `Math.E` | `e` | Expression |
| `Math.min(a,b)` | `min(a,b)` | Expression |
| `Math.max(a,b)` | `max(a,b)` | Expression |
| `Math.floor(x)` | `floor(x)` | Expression |
| `Math.ceil(x)` | `ceil(x)` | Expression |
| `Math.round(x)` | `round(x)` | Expression |
| `x.toFixed(n)` | `toFixed(x,n)` | Expression |
| `t**n` | `t^n` | Expression |
| `x**n` | `x^n` | Expression |
| `\vec` (single backslash in JSON) | `\\vec` | LaTeX |
| `\frac` (single backslash in JSON) | `\\frac` | LaTeX |
| Missing `id` on element targeted by `remove` | Generate ID from type + index | Structure |
| `highlights` key with no matching `\htmlClass` | Remove orphan key | Proof |
| `\htmlClass` with no matching `highlights` key | Add stub entry `{"color":"yellow","label":""}` | Proof |

---

## Usage Examples

User invocation:
```
/algebench-validate-lesson scenes/eigenvalues.json
```

From Syntax Validator agent (Phase 4):
```
Spawn agent with: "Validate and fix the lesson JSON at scenes/{topic}.json using the algebench-validate-lesson skill."
```

Validate all scenes:
```
/algebench-validate-lesson scenes/*.json
```
