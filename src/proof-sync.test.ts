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
        { proof: { steps: [{ sceneStep: 2 }] } },
        { proof: { steps: [{ sceneStep: 2 }] } },
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
