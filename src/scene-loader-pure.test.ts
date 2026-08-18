// Covers the two side-effect-free exports of src/scene-loader.ts:
// isLessonFormat() and proofFileToLesson().
//
// scene-loader pulls in the whole render stack, which expects two browser
// globals at module-eval time — `math` (the math.js CDN bundle, instantiated by
// expr.ts) and `window` (scene-loader publishes its element-toggle shims on it).
// Both are stubbed before the import so the module can load under `node --test`;
// nothing below touches the DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathjs from 'mathjs';
import type { LessonSpec, SceneSpec } from '/scene-loader.js';
import type { Proof } from '/proof.js';

// `math` is declared as a CDN `const` global (src/globals.d.ts), which types
// readers but not writers — so installing the stub casts globalThis once here.
(globalThis as unknown as { math: typeof mathjs }).math = mathjs;
// Under node there is no `window`; globalThis stands in for it. It carries none
// of the DOM surface `Window` declares, but scene-loader only assigns its
// element-toggle shims onto it, so the cast is at the install site.
globalThis.window ??= globalThis as unknown as Window & typeof globalThis;

const { isLessonFormat, proofFileToLesson } = await import('/scene-loader.js');

/**
 * The one scene proofFileToLesson builds, carrying its one proof.
 *
 * SceneSpec is the schema-wide type: `scenes` is optional on a LessonSpec, and
 * a scene's `proof` may be an array, because an authored lesson can carry
 * several. proofFileToLesson's contract is strictly narrower — exactly one
 * scene holding exactly one Proof — so that narrowing lives here rather than
 * being restated at every assertion below.
 */
type ProofScene = Omit<SceneSpec, 'proof'> & { proof: Proof };

function soleScene(lesson: LessonSpec): ProofScene {
  return lesson.scenes![0] as ProofScene;
}

test('isLessonFormat only accepts a spec with a non-empty scenes array', () => {
  assert.ok(isLessonFormat({ scenes: [{ title: 'one' }] }));
  assert.ok(!isLessonFormat({ scenes: [] }));
  assert.ok(!isLessonFormat({ elements: [] }));   // a bare scene is not a lesson
  assert.ok(!isLessonFormat({}));
  assert.ok(!isLessonFormat(null));
  assert.ok(!isLessonFormat(undefined));
});

test('proofFileToLesson wraps a proof file in a one-scene lesson', () => {
  const lesson = proofFileToLesson({
    title: 'Gaussian integral',
    goal: '$\\int e^{-x^2}\\,dx$',
    steps: [
      { operation: 'Square the integral', plain: 'I^2', justification: 'trick' },
      { operation: 'Polar coordinates', input_latex: 'r\\,dr\\,d\\theta' },
    ],
  }, 'analysis/gaussian');

  assert.equal(lesson.title, 'Gaussian integral');
  assert.equal(lesson.scenes!.length, 1);

  const scene = soleScene(lesson);
  // An empty scene: the proof is the whole content, so no 3D elements.
  assert.equal(scene.elements, undefined);
  assert.equal(scene.markdown, '$\\int e^{-x^2}\\,dx$');
  assert.equal(scene.proof.id, 'analysis/gaussian');
  assert.equal(scene.proof.technique, 'derivation');

  // First step is the premise; the rest are ordinary steps.
  assert.deepEqual(scene.proof.steps!.map(s => s.type), ['given', 'step']);
  assert.deepEqual(scene.proof.steps!.map(s => s.id), ['step-0', 'step-1']);
  assert.deepEqual(scene.proof.steps!.map(s => s.label),
                   ['Square the integral', 'Polar coordinates']);
  // `plain` (the CAS-normalized form the animation renders) wins over
  // input_latex; input_latex is only the fallback.
  assert.deepEqual(scene.proof.steps!.map(s => s.math), ['I^2', 'r\\,dr\\,d\\theta']);
  // Every step syncs to the single scene step.
  assert.deepEqual(scene.proof.steps!.map(s => s.sceneStep), [0, 0]);
});

test('proofFileToLesson falls back to the id and generic labels', () => {
  const lesson = proofFileToLesson({ steps: [{}] }, 'algebra/quadratic');
  assert.equal(lesson.title, 'quadratic');      // second path segment
  assert.equal(soleScene(lesson).proof.steps![0]!.label, 'Step 1');
  assert.equal(soleScene(lesson).proof.steps![0]!.math, '');
  assert.equal(soleScene(lesson).markdown, '');  // no goal -> empty markdown
});

test('proofFileToLesson tolerates a proof file with no steps', () => {
  const lesson = proofFileToLesson({ title: 'Empty' }, 'x/y');
  assert.deepEqual(soleScene(lesson).proof.steps, []);
});
