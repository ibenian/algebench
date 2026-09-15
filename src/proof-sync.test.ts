import test from 'node:test';
import assert from 'node:assert/strict';

import { findProofSceneStepMatch } from './proof-sync.js';

test('scene navigation switches from the active proof to a proof linked to the new step', () => {
    const proofs = [
        { sceneIndex: 0, proof: { steps: [{ sceneStep: 6 }] } },
        { sceneIndex: 3, proof: { sceneStep: 3, steps: [{ sceneStep: 3 }] } },
        { sceneIndex: 3, proof: { sceneStep: 6, steps: [{ sceneStep: 6 }, { sceneStep: 6 }] } },
    ];

    assert.deepEqual(findProofSceneStepMatch(proofs, 1, 3, 6), {
        proofIndex: 2,
        stepIndex: 0,
    });
});

test('the active proof wins when several proofs link to the same scene step', () => {
    const proofs = [
        { sceneIndex: 0, proof: { steps: [{ sceneStep: 2 }] } },
        { sceneIndex: 0, proof: { steps: [{ sceneStep: 2 }] } },
    ];

    assert.deepEqual(findProofSceneStepMatch(proofs, 1, 0, 2), {
        proofIndex: 1,
        stepIndex: 0,
    });
});

test('cross-scene links and proof-level goal links are supported', () => {
    const proofs = [
        { proof: { sceneStep: '2:4' } },
        { proof: { steps: [{ sceneStep: '1:4' }] } },
    ];

    assert.deepEqual(findProofSceneStepMatch(proofs, 1, 2, 4), {
        proofIndex: 0,
        stepIndex: -1,
    });
});

test('a proof the learner cannot see yet is not matched', () => {
    // proofSpec carries every entry in the file, not only the ones visible at
    // this position, so the matcher has to ask the visibility question itself.
    // A step-level proof declared on step 5 must not be switched to at step 2
    // just because it links there.
    const proofs = [
        { level: 'step', sceneIndex: 0, stepIndex: 5, proof: { steps: [{ sceneStep: 2 }] } },
        { level: 'step', sceneIndex: 0, stepIndex: 1, proof: { steps: [{ sceneStep: 2 }] } },
    ];

    assert.deepEqual(findProofSceneStepMatch(proofs, 0, 0, 2), { proofIndex: 1, stepIndex: 0 });

    // The filter is about reachability, not about hiding the proof forever: a
    // step-level proof linking to the step it is declared on still matches.
    const declaredHere = [{ level: 'step', sceneIndex: 0, stepIndex: 5, proof: { steps: [{ sceneStep: 5 }] } }];
    assert.deepEqual(findProofSceneStepMatch(declaredHere, -1, 0, 5), { proofIndex: 0, stepIndex: 0 });
    assert.equal(findProofSceneStepMatch(declaredHere, -1, 0, 2), null);
});

test('visibility follows the declaring level, and an entry without one is not judged', () => {
    const fileLevel = { level: 'file', proof: { steps: [{ sceneStep: '0:2' }] } };
    const otherScene = { level: 'scene', sceneIndex: 7, proof: { steps: [{ sceneStep: 2 }] } };
    const otherSceneHere = { level: 'scene', sceneIndex: 0, proof: { steps: [{ sceneStep: 2 }] } };

    // A file-level proof is visible everywhere, including from another scene.
    assert.deepEqual(findProofSceneStepMatch([fileLevel], -1, 0, 2), { proofIndex: 0, stepIndex: 0 });

    // A scene-level proof declared in scene 7 is not visible in scene 0.
    assert.equal(findProofSceneStepMatch([otherScene], -1, 0, 2), null);
    assert.deepEqual(findProofSceneStepMatch([otherScene], -1, 7, 2), { proofIndex: 0, stepIndex: 0 });
    assert.deepEqual(findProofSceneStepMatch([otherSceneHere], -1, 0, 2), { proofIndex: 0, stepIndex: 0 });

    // No level at all: unchanged behaviour, so an unvalidated proof from the
    // expert is not filtered out of its own sync.
    assert.deepEqual(findProofSceneStepMatch([{ sceneIndex: 0, proof: { steps: [{ sceneStep: 2 }] } }], -1, 0, 2),
        { proofIndex: 0, stepIndex: 0 });
});

test('an active proof that is no longer visible does not keep its place at the front', () => {
    // activeProofIndex is an index into the FULL spec; once it is filtered out
    // the reordering must not reinstate it (or shuffle the wrong candidate to
    // the front, which an index-based splice would).
    const proofs = [
        { level: 'step', sceneIndex: 0, stepIndex: 9, proof: { steps: [{ sceneStep: 2 }] } },
        { level: 'file', proof: { steps: [{ sceneStep: '0:2' }] } },
    ];

    assert.deepEqual(findProofSceneStepMatch(proofs, 0, 0, 2), { proofIndex: 1, stepIndex: 0 });
});

test('a bare step number is scoped to its own scene, never to every scene', () => {
    // proofSpec holds every entry in the file, so a root-level proof carrying a
    // plain number would otherwise match step 2 of EVERY scene and take the
    // active proof away from the scene-scoped proof that really links there.
    // docs/proofs-model.md 6.1: a root-level link uses "sceneIdx:stepIdx".
    const rootNumeric = { level: 'file', proof: { steps: [{ sceneStep: 2 }] } };
    assert.equal(findProofSceneStepMatch([rootNumeric], -1, 0, 2), null);
    assert.equal(findProofSceneStepMatch([rootNumeric], -1, 5, 2), null);

    // Spelled the documented way, it links to exactly one scene.
    const rootScoped = { level: 'file', proof: { steps: [{ sceneStep: '5:2' }] } };
    assert.deepEqual(findProofSceneStepMatch([rootScoped], -1, 5, 2), { proofIndex: 0, stepIndex: 0 });
    assert.equal(findProofSceneStepMatch([rootScoped], -1, 0, 2), null);

    // And a scene-scoped entry is unaffected: the number means its own scene.
    const scoped = { level: 'scene', sceneIndex: 3, proof: { steps: [{ sceneStep: 2 }] } };
    assert.deepEqual(findProofSceneStepMatch([scoped], -1, 3, 2), { proofIndex: 0, stepIndex: 0 });
    assert.equal(findProofSceneStepMatch([scoped], -1, 1, 2), null);
});
