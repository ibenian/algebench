// Submission-id rules — every branch says something SPECIFIC.
//
// The point of these is not that invalid names are rejected (the server does
// that anyway) but that the reader is told WHICH rule they broke. The dialog
// previously rendered every failure — bad character, wrong length, reserved
// word, genuine collision — as "taken or reserved".
//
// Run: node --test static/proof-id.test.js

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ID_NAME_MAX, ID_RESERVED, MAX_PROOF_BYTES,
    formatBytes, idProblem, proofBytes,
} from './proof-id.js';

test('a well-formed id has no problem', () => {
    assert.equal(idProblem('algebra/quadratic-roots'), '');
    assert.equal(idProblem('physics/e-mc2'), '');       // digits and inner hyphens
    assert.equal(idProblem('ab/abc'), '');              // exactly at the minimums
});

test('a missing domain names the domain, not "taken"', () => {
    const msg = idProblem('quadratic-roots');
    assert.match(msg, /include the domain/i);
});

test('more than one slash is called out', () => {
    assert.match(idProblem('a/b/c'), /exactly one/i);
});

test('disallowed characters are listed back', () => {
    // The whole point: say WHICH characters, so a stray one is findable in a
    // long name.
    assert.match(idProblem('algebra/my_proof'), /aren't allowed: “_”/);
    assert.match(idProblem('Algebra/x'), /Domain has characters that aren't allowed: “A”/);
});

test('invisible characters are NAMED, not printed', () => {
    // A pasted "my proof" used to report its offending character as a blank gap
    // — precisely the case where the user cannot see what is wrong.
    assert.match(idProblem('algebra/my proof'), /aren't allowed: space/);
    assert.match(idProblem('algebra/my\tproof'), /aren't allowed: tab/);
    assert.match(idProblem('algebra/my proof'), /non-breaking space/);
});

test('several bad characters are listed together, comma-separated', () => {
    const msg = idProblem('algebra/my_bad name');
    assert.match(msg, /“_”/);
    assert.match(msg, /space/);
});

test('length failures state the bound and the actual length', () => {
    assert.match(idProblem('a/abc'), /Domain is too short — at least 2/);
    assert.match(idProblem('algebra/ab'), /Name is too short — at least 3/);

    const long = 'x'.repeat(ID_NAME_MAX + 1);
    const msg = idProblem(`algebra/${long}`);
    assert.match(msg, /Name is too long — at most 64/);
    assert.match(msg, new RegExp(`yours is ${ID_NAME_MAX + 1}`));
});

test('a leading or trailing hyphen is distinguished from a bad character', () => {
    // `-` IS an allowed character, so the generic message would be wrong here.
    assert.match(idProblem('algebra/-roots'), /can't start or end with a hyphen/);
    assert.match(idProblem('algebra/roots-'), /can't start or end with a hyphen/);
    assert.match(idProblem('-algebra/roots'), /Domain can't start or end with a hyphen/);
});

test('every reserved name is reported as reserved', () => {
    for (const word of ID_RESERVED) {
        assert.match(idProblem(`algebra/${word}`), /reserved name/,
                     `${word} should be reported as reserved`);
    }
});

test('an empty segment is not reported as a character problem', () => {
    assert.match(idProblem('/roots'), /Domain is empty/);
    assert.match(idProblem('algebra/'), /Name is empty/);
});

test('proofBytes measures UTF-8, not code units', () => {
    // A LaTeX-heavy proof can carry multi-byte characters; measuring `.length`
    // would under-count them against a byte limit.
    const bytes = proofBytes({ title: '√2 ≈ 1.41' });
    assert.ok(bytes > JSON.stringify({ title: '√2 ≈ 1.41' }).length);
});

test('proofBytes survives an unserializable proof', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    assert.equal(proofBytes(circular), 0);
});

test('the cap renders as a round 2 MB', () => {
    // Decimal units on purpose — binary would show the limit as "1.91 MB".
    assert.equal(formatBytes(MAX_PROOF_BYTES), '2.00 MB');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1500), '1.5 KB');
});

// A bare single-scene file (elements, no scenes) stands in for its own scene,
// so its root `proof` is the same object at both levels. Listing it twice put
// a duplicate in the Math tab and disagreed with the prebaker's traversal,
// which reports it once.
test('collectAllProofs lists a bare scene\'s root proof once, not twice', async () => {
    const { collectAllProofs } = await import('/proof.js');
    const proof = { id: 'p', steps: [{ label: 'L', math: 'x = 1' }] };
    const bare = { title: 'bare', elements: [], proof, steps: [] } as never;
    const levels = collectAllProofs(bare).map((e: { level: string }) => e.level);
    assert.deepEqual(levels, ['file']);

    // a real lesson still reports its scene-level proof
    const lesson = { title: 'l', scenes: [{ id: 's', proof, steps: [] }] } as never;
    assert.deepEqual(collectAllProofs(lesson).map((e: { level: string }) => e.level), ['scene']);
});

// REACHABILITY, not traversal. A bare file never takes scene-loader's lesson
// path -- `isLessonFormat` demands a non-empty `scenes` -- so it loads with
// `currentSceneIndex = -1` and `loadProof(spec, -1, …)`. When collectAllProofs
// numbered that stand-in scene 0, `_isProofInContext` compared 0 === -1 and
// every step-level proof was invisible from the moment the file loaded. The
// traversal test above still passed throughout, because the entries were there
// -- they just could never be in context. This asserts the real predicate.
test('a bare scene\'s step proofs are reachable at the index the loader uses', async () => {
    const { collectAllProofs, _isProofInContext, BARE_SCENE_INDEX } = await import('/proof.js');
    const sp = { id: 'sp', steps: [{ label: 'L', math: 'y = 2' }] };
    const bare = { title: 'bare', elements: [], steps: [{ proof: sp }, {}] } as never;

    const entries = collectAllProofs(bare);
    const step = entries.find((e: { level: string }) => e.level === 'step');
    assert.ok(step, 'a step-level proof is collected');
    assert.equal(step.sceneIndex, BARE_SCENE_INDEX);
    assert.equal(BARE_SCENE_INDEX, -1, 'matches scene-loader\'s bare-file index');

    // At the index the loader actually passes, the proof is in context once its
    // step is reached -- and was not, before the fix.
    assert.equal(_isProofInContext(step, BARE_SCENE_INDEX, 0), true);
    // Still gated on the step being reached.
    assert.equal(_isProofInContext(step, BARE_SCENE_INDEX, -1), false);
    // And a real lesson is untouched: scene 0 stays 0.
    const lessonStep = collectAllProofs(
        { title: 'l', scenes: [{ id: 's', steps: [{ proof: sp }] }] } as never,
    ).find((e: { level: string }) => e.level === 'step');
    assert.equal(lessonStep.sceneIndex, 0);
    assert.equal(_isProofInContext(lessonStep, 0, 0), true);
});
