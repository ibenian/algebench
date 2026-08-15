// validate-proof.test.js — the grading inputs a proof must carry through.
//
// `validateProofData` is a whitelist, and a submitted proof is exactly its
// output: anything it drops never reaches the store. `change_type` and the
// judge-provenance marker are baked per step so the file can be re-graded
// offline later (issue #542), so dropping them here would reinstate the bug one
// layer out — the server would persist a proof whose claims were already gone.

import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { origin: 'http://localhost' };   // cleanDeeplink reads it

const { validateProofData } = await import('./proof-animation/validate-proof.js');

const step = (extra = {}) => ({
    index: 0, operation: 'op', justification: 'why',
    input_latex: 'x = 1', latex: 'x = 1', plain: 'x = 1', ...extra,
});

test('a step keeps its declared change_type', () => {
    const out = validateProofData({ steps: [step({ change_type: 'solve' })] });
    assert.equal(out.steps[0].change_type, 'solve');
});

test('an unknown change_type is dropped, not passed through', () => {
    const out = validateProofData({ steps: [step({ change_type: 'nonsense' })] });
    assert.equal('change_type' in out.steps[0], false);
    const none = validateProofData({ steps: [step()] });
    assert.equal('change_type' in none.steps[0], false);
});

test('the judge-provenance marker survives, and only as a true boolean', () => {
    const conf = (judged) => ({ tier: 'domain', label: 'Domain', judged });
    const yes = validateProofData({ steps: [step({ confidence: conf(true) })] });
    assert.equal(yes.steps[0].confidence.judged, true);
    const spoofed = validateProofData({ steps: [step({ confidence: conf('yes') })] });
    assert.equal('judged' in spoofed.steps[0].confidence, false);
    const cas = validateProofData({ steps: [step({ confidence: { tier: 'grounded' } })] });
    assert.equal('judged' in cas.steps[0].confidence, false);
});
