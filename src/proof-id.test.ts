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
