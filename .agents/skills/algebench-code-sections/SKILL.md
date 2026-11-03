---
name: algebench-code-sections
description: Add code sections (the teaching structure of a scene's code file) and code annotations (docs on names, expressions and blocks) to a scene of a lesson built by a TypeScript lesson builder, such as scripts/lesson_builders/common-algorithm-patterns. Use when asked to "add sections", "add annotations", "annotation + sections" for a scene or its code.
---

# Code sections and annotations for a scene

A scene that runs code (`pattern({...})` in a lesson builder's `build.ts`) can carry two things for its file:

- **`sections`**: the code split into a few named steps. They drive the Code panel's titles-only views
  (Blocks, Outline), its section colours and ✦ asks, and Type along's per-section score chips.
- **`annotations`**: docs shown on hover in the Code panel: a name file-wide, an expression on one line, or a
  block of lines.

The lesson `common-algorithm-patterns` is the reference: the monotonic-stack, monotonic-queue and top-k
(heap) scenes have both.

## 1. Find the scene

- If the user doesn't name the scene, use the one on screen: the `sc=` in the preview URL.
- In `build.ts`, find `id: '<scene-id>'`. Its `source:` names the code constant, for example
  `TOP_K_SOURCE` in `algorithms.ts`. Read that source.

## 2. Sections

Add `sections: [...]` right after the pattern's `input`/`trace` line, one `section(...)` per step:

```ts
section(SOURCE, 'heap-trim', 'One too many: drop the smallest', 'if len(heap) > k', 'heapq.heappop(heap)', {
    hint: 'With k + 1 values, the root is the smallest of them, so it cannot be among the k largest.',
    prompt: 'Explain why popping the root keeps exactly the k largest numbers seen so far.' }),
```

- **Arguments:** source, a short id with the scene's prefix (`mq-`, `heap-`, `mono-`), the title, the text of
  the first line, and the text of the last line (`null` for a one-line section). Line texts are found with
  `lineOf`, so they must be unique enough to hit the intended line.
- **Coverage:** `coverLines` runs on the list. The first section starts at line 1 (it takes the imports), each
  runs on over the blank lines after it, and a code line in no section is a build error. Cover every line.
- **Shape:** 3–5 sections, each one idea of the algorithm: setup, the main move, a second move, the result.
  - Titles say what the step *does*, in plain words: "A warmer day answers the days waiting below it", not
    "while loop".
  - A `hint` is one or two sentences, given in Type along's hints. It says what the step achieves and why,
    without giving the code away.
  - A `prompt` goes only on the section that carries the insight, the one a learner would ask about. It is
    what the tutor is asked when its ✦ is pressed.

## 3. Annotations

Add `annotations: [...]` after `sections`:

- **`doc(name, text)`** for every name the code introduces: the function (what it returns, its complexity),
  each parameter, each variable, and a library module (`heapq`, `deque`).
- **`docExpr(SOURCE, lineText, snippet, text)`** for the few expressions that carry meaning:
  - a condition that decides a branch;
  - an index that means something (`stack[-1]`, `nums[dq[0]]`);
  - a call with a cost (`heapq.heappush(...)`: O(log k)).

  `snippet` must appear on that line exactly.
- **`docBlock(SOURCE, startText, endText, text)`** for a loop whose cost isn't obvious, usually the amortized
  O(n) or O(n log k) argument.

Write in the lesson's voice: short, present tense, values in backticks, no "this line…". About 10–15
annotations a scene; don't document every token.

## 4. Build and check

1. Regenerate the scene JSON:

   ```bash
   ./run.sh scripts/lesson_builders/common-algorithm-patterns/build.py
   ```

   A wrong line text or an uncovered line fails here.
2. Run the builder's tests:

   ```bash
   node --experimental-strip-types --import ./scripts/register-test-resolver.mjs --test scripts/lesson_builders/common-algorithm-patterns/algorithms.test.ts
   ```

3. In the preview, open the scene (`/?builtin=draft%2Fcommon-algorithm-patterns&sc=<scene-id>&st=run`).
   Check that the Code tab shows every section head, and that Type along shows a chip per section. Hover a
   few names to see their docs.
4. Commit `build.ts` together with the regenerated `scenes/draft/<lesson>.json`.
