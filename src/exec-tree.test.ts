import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execTree, callsOn } from '/exec-tree.js';
import type { ExecTree } from '/exec-tree.js';
import { loopName } from '/exec-tree-view.js';

const shape = (t: ExecTree, id = 0): string => {
    const n = t.nodes[id]!;
    const kids = n.children.map(c => shape(t, c)).join(' ');
    const own = n.kind === 'loop' ? `${n.label} ×${n.iterations}` : n.label;
    return kids ? `${own} [${kids}]` : own;
};

const FIB = `def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)`;
// fib(2) as the recorders write it: a call's return line is recorded after its call site is popped.
const FIB_FRAMES = [
    { line: 2, calls: [] }, { line: 4, calls: [] },
    { line: 2, calls: [4] }, { line: 3, calls: [] },
    { line: 4, calls: [] },
    { line: 2, calls: [4] }, { line: 3, calls: [] },
    { line: 4, calls: [] },
];

test('calls nest under their caller; a second call from the same site is a sibling, written as the code writes it', () => {
    const t = execTree(FIB, FIB_FRAMES, FIB_FRAMES.length - 1);
    assert.equal(shape(t), 'fib(n) [fib(n - 1) fib(n - 2)]');
    assert.equal(t.calls, 3);
    assert.equal(t.maxDepth, 1);
    assert.ok(t.nodes.slice(1).every(n => n.done), 'both calls returned');
    assert.equal(t.current, 0);
});

test('the tree grows with the run; a return line recorded after the pop still belongs to the call returning', () => {
    assert.equal(shape(execTree(FIB, FIB_FRAMES, 1)), 'fib(n)');
    const entered = execTree(FIB, FIB_FRAMES, 2);
    assert.equal(shape(entered), 'fib(n) [fib(n - 1)]');
    assert.equal(entered.current, 1);
    const returning = execTree(FIB, FIB_FRAMES, 3);
    assert.equal(returning.current, 1, 'line 3 is fib(n - 1) returning');
    assert.equal(execTree(FIB, FIB_FRAMES, 4).current, 0);
});

const DFS = `def dfs_order(n, adj):
    order = []

    def dfs(u):
        order.append(u)
        for v in adj[u]:
            dfs(v)

    dfs(0)
    return order`;

test('a loop is a node counting its iterations; calls made in it hang under it, with their iteration', () => {
    const frames = [
        { line: 2, calls: [] }, { line: 9, calls: [] },
        { line: 5, calls: [9] }, { line: 6, calls: [9] }, { line: 7, calls: [9] },
        { line: 5, calls: [9, 7] }, { line: 6, calls: [9, 7] },
        { line: 6, calls: [9] }, { line: 7, calls: [9] },
        { line: 5, calls: [9, 7] },
        { line: 10, calls: [] },
    ];
    const t = execTree(DFS, frames, frames.length - 1, (call, f) => f >= 7 ? call.replace('v', '2') : call.replace('v', '1'));
    assert.equal(shape(t), 'dfs_order(n, adj) [dfs(0) [for v in adj[u] ×2 [dfs(1) [for v in adj[u] ×1] dfs(2)]]]');
    const [, , loop, first, , second] = t.nodes;
    assert.equal(loop!.kind, 'loop');
    assert.deepEqual([first!.iteration, second!.iteration], [1, 2]);
    assert.equal(t.iterations, 3);
    assert.ok(loop!.done, 'line 10 is past the loop and its call');
});

test('a run without calls is one call with its loops; leaving a loop ends it, a new entry opens another', () => {
    const src = `def f(xs):
    for x in xs:
        pass
    while xs:
        xs.pop()
    return 0`;
    const frames = [2, 3, 2, 3, 4, 5, 4, 5, 4, 6].map(line => ({ line }));
    const t = execTree(src, frames, frames.length - 1);
    assert.equal(shape(t), 'f(xs) [for x in xs ×2 while xs ×3]');
    assert.equal(t.current, 0);
    assert.equal(execTree(src, frames, 6).current, 2, 'in the while loop');
});

test('callsOn finds each call on a line, parentheses balanced', () => {
    assert.deepEqual(callsOn('return fib(n - 1) + fib(n - 2)', 'fib'), ['fib(n - 1)', 'fib(n - 2)']);
    assert.deepEqual(callsOn('half = power(x, n // 2)', 'power'), ['power(x, n // 2)']);
    assert.deepEqual(callsOn('if not dfs(v, max(a, b)):', 'dfs'), ['dfs(v, max(a, b))']);
    assert.deepEqual(callsOn('self.dfs(v)', 'dfs'), [], 'a method of another object is not this function');
});

test('a loop is named by what it walks, short enough for its pill', () => {
    assert.equal(loopName('for i, num in enumerate(nums)'), 'for i, num');
    assert.equal(loopName('for v in adj[u]'), 'for v');
    assert.equal(loopName('while k'), 'while k');
    assert.equal(loopName('while left < right'), 'while');
});

const KMP = `def build_lps(p):
    for i in p:
        pass
    return 0

def search(text, p):
    lps = build_lps(p)
    for ch in text:
        pass
    return 1

def other():
    return 2`;

test('without a calls column, a function that calls the one that ran first becomes its caller; an unrelated one a new root', () => {
    const frames = [2, 3, 2, 3, 4, 7, 8, 9, 8, 10, 13].map(line => ({ line }));
    const t = execTree(KMP, frames, frames.length - 1);
    const roots = t.nodes.filter(n => n.parent == null).map(n => shape(t, n.id));
    assert.deepEqual(roots, ['search(text, p) [build_lps(p) [for i in p ×2] for ch in text ×2]', 'other()']);
    assert.equal(t.nodes.find(n => n.label === 'build_lps(p)')!.site, 7);
    assert.equal(t.maxDepth, 1);
});

const TRIE = `def build(words):
    root = {}
    for word in words:
        node = root
        for ch in word:
            node = node.setdefault(ch, {})
        node['$'] = True
    return root`;

test('a run that never stops on a loop header still shows its loops: going back in the body is the next iteration', () => {
    // Two words of two and one letters: the run records body lines only.
    const frames = [2, 4, 6, 6, 7, 4, 6, 7, 8].map(line => ({ line }));
    const t = execTree(TRIE, frames, frames.length - 1);
    assert.equal(shape(t), 'build(words) [for word in words ×2 [for ch in word ×1 for ch in word ×1]]');
    const mid = execTree(TRIE, frames, 3);
    assert.equal(shape(mid), 'build(words) [for word in words ×1 [for ch in word ×1]]', 'line 6 twice is one line, recorded twice');
});
