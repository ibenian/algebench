import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarity, alignLines, scorePractice, focusSection, isNeutral, PEEK_FACTOR } from '/code-practice-core.js';

const REF = ['def f(n):', '    # sum it', '    total = 0', '    for i in range(n):', '        total += i', '', '    return total'].join('\n');
const sections = [{id: 'init', title: 'Start at zero', from: 11, to: 12}, {id: 'loop', title: 'Add each', from: 13, to: 14}, {id: 'ret', title: 'Answer', from: 16, to: 16}];

test('the same code is an exact match, whatever its spacing; other text costs its edits', () => {
    assert.equal(similarity('    total = 0  ', '    total = 0'), 1);
    assert.equal(similarity('    total=0', '    total = 0'), 1);
    assert.equal(similarity('total = 0', '    total = 0'), 1, 'indentation too');
    assert.ok(similarity('    totl = 0', '    total = 0') < .95);
    assert.equal(similarity('', 'x'), 0);
    assert.equal(similarity('    state = [0] * n', '    state = [0] * n  # 0 new, 1 open'), 1, 'a trailing comment is not typed');
    assert.equal(similarity('    state = [0] * n  #', '    state = [0] * n'), 1, 'a comment just begun is a comment already');
});

test('a line typed right at another depth is not exact, so out-of-place code earns no check', () => {
    const ref = ['def dfs(u):', '    for v in adj[u]:', '        if state[v] == 1:', '            return True', '    return False'];
    const typed = ['def dfs(u):', '    for v in adj[u]:', '        if state[v] == 2:', '            return False'];
    const pairs = alignLines(ref, typed);
    const last = pairs.find(p => p.typed === 3)!;
    assert.ok(last.similarity < 1, 'return False inside the if is not the return False after the loop');
    assert.equal(alignLines(['def f():', '    x = 1', '    if x:', '        y'], ['def f():', '  x = 1', '  if x:', '    y']).every(p => p.similarity === 1), true,
        'two-space indentation nests the same way');
});

test('blank and comment lines are neutral', () => {
    assert.ok(isNeutral('   ') && isNeutral('  # note') && isNeutral('// note') && !isNeutral('x = 1  # set'));
});

test('alignment keeps order, so a skipped line costs only itself', () => {
    const pairs = alignLines(REF.split('\n'), ['def f(n):', '    for i in range(n):', '        total += i', '    return total']);
    assert.deepEqual(pairs.map(p => [p.typed, p.reference]), [[0, 0], [1, 3], [2, 4], [3, 6]]);
    assert.deepEqual(alignLines(['a = 1'], ['completely different text here']), [], 'too unlike to pair');
});

test('a fully typed block, unseen, scores 100 in every section', () => {
    const score = scorePractice(REF, 10, REF.replace('    # sum it\n', ''), new Set());
    assert.equal(score.total, 100);
    assert.ok(score.typedAll);
    const s = scorePractice(REF, 10, REF, new Set(), sections);
    assert.deepEqual(s.sections.map(x => [x.id, x.score, x.lines]), [['init', 100, 1], ['loop', 100, 2], ['ret', 100, 1]]);
});

test('a line seen in the Code panel scores at most PEEK_FACTOR, even typed exactly', () => {
    const score = scorePractice(REF, 10, REF, new Set([12]), sections);
    assert.equal(score.lines.find(l => l.line === 12)!.score, 100 * PEEK_FACTOR);
    assert.ok(score.typedAll && score.total < 100);
    assert.equal(score.sections[0]!.score, 50);
});

test('typed lines know their reference line and whether they are exact', () => {
    const score = scorePractice(REF, 10, 'def f(n):\n\n    total=0\n    xyz', new Set());
    assert.deepEqual(score.typed.map(t => [t.reference, t.exact, t.neutral]), [[10, true, false], [null, false, true], [12, true, false], [null, false, false]]);
    assert.equal(score.lines.filter(l => l.typed == null).length, 3, 'loop and return not typed yet');
});

test('the focus section follows the cursor, else the next one to type', () => {
    const typed = 'def f(n):\n    total = 0\n    for i in range(n):\n';
    const score = scorePractice(REF, 10, typed, new Set(), sections);
    assert.equal(focusSection(score, 1, sections)?.id, 'init');
    assert.equal(focusSection(score, 2, sections)?.id, 'loop');
    assert.equal(focusSection(score, 3, sections)?.id, 'loop', 'a blank line after the loop header: the loop goes on');
    assert.equal(focusSection(scorePractice(REF, 10, '', new Set(), sections), 0, sections)?.id, 'init');
});
