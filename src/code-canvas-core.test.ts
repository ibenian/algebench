import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpan, spanBox, layoutMarks, remapLine, remapMarks, translatePath, describeMark } from '/code-canvas-core.js';
import type { CanvasMetrics } from '/code-canvas-core.js';

const CODE = ['def power(x, n):', '    if n == 0:', '        return 1', '    half = power(x, n // 2)'];
const m: CanvasMetrics = {charWidth: 10, row: k => k >= 0 && k < 40 ? {left: 8, top: 4 + k * 20, height: 20} : null};

test('a mark names a line, a run of lines, or text on a line', () => {
    assert.deepEqual(resolveSpan(CODE, 2), {fromLine: 1, fromCol: 4, toLine: 1, toCol: 14});
    assert.deepEqual(resolveSpan(CODE, 2, 3), {fromLine: 1, fromCol: 4, toLine: 2, toCol: 16});
    assert.deepEqual(resolveSpan(CODE, 4, 0, 'n // 2'), {fromLine: 3, fromCol: 20, toLine: 3, toCol: 26});
    assert.deepEqual(resolveSpan(CODE, 1, 0, 'power'), {fromLine: 0, fromCol: 4, toLine: 0, toCol: 9}, 'a function name');
    assert.equal(resolveSpan(CODE, 99), null, 'no such line');
    assert.deepEqual(resolveSpan(CODE, 3, 0, 'not there'), {fromLine: 2, fromCol: 8, toLine: 2, toCol: 16}, 'text not found: the line it named');
    assert.equal(resolveSpan(CODE, 0, 0, 'not there'), null);
});

test('a box takes in every line of its span', () => {
    const box = spanBox(resolveSpan(CODE, 2, 3)!, CODE, m)!;
    assert.deepEqual([box.left, box.top, box.width, box.height], [48, 24, 120, 40]);
});

test('a moved stroke keeps its arc radii and flags', () => {
    assert.equal(translatePath('M1 2 L3 4', 10, 20), 'M11 22 L13 24');
    assert.equal(translatePath('M1 2 A5 6 0 1 1 3 4', 10, 20), 'M11 22 A5 6 0 1 1 13 24');
    assert.equal(translatePath('M2 5 Q 7 8 12 4', 1, 1), 'M3 6 Q8 9 13 5');
});

test('marks lay out on the code; what names nothing is left out', () => {
    const laid = layoutMarks([{kind: 'box', line: 2, end_line: 3}, {kind: 'circle', line: 4, text: 'n // 2'}, {kind: 'check', line: 1}, {kind: 'underline', line: 99}], CODE, m);
    assert.equal(laid.marks.length, 3);
    assert.ok(laid.marks[0]!.fill);
    assert.equal(laid.firstTop, 24);
});

test('a cross is red and a note goes after the code on its line', () => {
    const [cross, note] = layoutMarks([{kind: 'cross', line: 3}, {kind: 'note', line: 3, label: 'always 1?'}], CODE, m).marks;
    assert.equal(cross!.color, 'red');
    assert.equal(note!.text!.x, 8 + 16 * 10 + 20);
    assert.equal(note!.text!.words, 'always 1?');
});

test('two notes on a line stand side by side', () => {
    const [a, b] = layoutMarks([{kind: 'note', line: 3, label: 'one'}, {kind: 'note', line: 3, label: 'two'}], CODE, m).marks;
    assert.ok(b!.text!.x >= a!.text!.x + 3 * 10 * .82, 'past the first');
});

test('shapes stand to the right of the code, and arrows find them', () => {
    const laid = layoutMarks([{kind: 'arrow', line: 4, text: 'half', to_id: 's'}, {kind: 'shape', id: 's', label: 'x^(n//2)', line: 4}], CODE, m);
    const [arrow, shape] = laid.marks;
    assert.ok(shape!.text!.x > 8 + 27 * 10, 'past the longest line');
    assert.equal(arrow!.paths.length, 2, 'a shaft and a head');
    assert.ok(laid.width > shape!.text!.x);
    assert.equal(layoutMarks([{kind: 'arrow', line: 1, to_id: 'nope'}], CODE, m).marks.length, 0);
});

test('an arrow joins two lines', () => {
    assert.equal(layoutMarks([{kind: 'arrow', line: 1, text: 'power', to_line: 4, to_text: 'power'}], CODE, m).marks.length, 1);
});

test('the agent is told what is on the board by name', () => {
    assert.equal(describeMark({mid: 'm1', kind: 'circle', line: 4, text: 'half'}), 'm1: circle line 4 "half"');
    assert.equal(describeMark({mid: 'm2', kind: 'box', line: 2, end_line: 3}), 'm2: box line 2-3');
    assert.equal(describeMark({mid: 'm3', kind: 'arrow', line: 4, to_id: 's'}), 'm3: arrow line 4 to shape s');
    assert.equal(describeMark({mid: 'm4', kind: 'shape', shape: 'diamond', id: 's', label: 'even?', line: 5}), 'm4: diamond shape s line 5 "even?"');
});

test('a check or a cross goes when the code it judged changes', () => {
    const fixed = ['def power(x, n):', '    if n == 1:', '        return 1', '    half = power(x, n // 2)'];
    const marks = [{kind: 'cross', line: 2}, {kind: 'check', line: 3}, {kind: 'circle', line: 2}] as const;
    assert.deepEqual(remapMarks(marks, CODE, fixed).map(x => x.kind), ['check', 'circle'], 'only the verdict on the edited line');
    assert.deepEqual(remapMarks([{kind: 'cross', line: 2}], CODE, ['# top', ...CODE]), [{kind: 'cross', line: 3}], 'moved, not changed: it stays');
    assert.deepEqual(remapMarks([{kind: 'cross', line: 2, end_line: 3}], CODE, fixed), [], 'any line of a run');
});

test('marks follow their lines through an edit', () => {
    const after = ['# note', ...CODE];
    assert.equal(remapLine(CODE, after, 3), 4, 'moved down');
    assert.equal(remapLine(CODE, ['def power(x, n):', '    if n == 1:', '        return 1', '    half = power(x, n // 2)'], 2), 2, 'being edited in place');
    assert.equal(remapLine(CODE, CODE.slice(1), 1), null, 'deleted');
    assert.deepEqual(remapMarks([{kind: 'box', line: 2, end_line: 3}, {kind: 'check', line: 1}], CODE, CODE.slice(1)), [{kind: 'box', line: 1, end_line: 2}]);
});
