import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTree, treeShape } from '/objects/tree-layout.js';

// 0 ─┬─ 1 ─┬─ 3
//    │     └─ 4
//    └─ 2 ─── 5
const parents = [-1, 0, 0, 1, 1, 2];
const of = (list: number[]) => (i: number) => list[i]!;
const round = (p: number[]) => p.map(v => Math.round(v * 1000) / 1000);

test('tree shape: children, roots and depths, with cycles and bad parents cut loose', () => {
    const s = treeShape(6, of(parents));
    assert.deepEqual(s.children, [[1, 2], [3, 4], [5], [], [], []]);
    assert.deepEqual(s.roots, [0]);
    assert.deepEqual(s.depth, [0, 1, 1, 2, 2, 2]);
    const loop = treeShape(4, of([1, 2, 1, 99]));
    assert.deepEqual(loop.roots, [1, 3], 'the 1 ⇄ 2 cycle is broken at 1; the out-of-range parent makes 3 a root');
    assert.deepEqual(loop.parent, [1, -1, 1, -1], 'node 0, hanging off the cycle, keeps its parent');
});

test('tidy: leaves evenly spaced, parents centred over their children, one row per depth', () => {
    const p = layoutTree('tidy', 6, of(parents), {spacing: 1, levelGap: 1}).map(round);
    // Leaves 3, 4, 5 at -1, 0, 1; node 1 over 3–4 (-0.5); node 2 over 5 (1); root over 1–2 (0.25).
    assert.deepEqual(p.map(q => q[0]), [0.25, -0.5, 1, -1, 0, 1]);
    assert.deepEqual(p.map(q => q[1]), [0, -1, -1, -2, -2, -2]);
});

test('binary: inorder left to right, so left subtrees sit left of their parent', () => {
    // A BST of 5, 3, 8, 1, 4: sides from the values.
    const values = [5, 3, 8, 1, 4], par = [-1, 0, 0, 1, 1];
    const side = (i: number) => values[i]! > values[par[i]!]! ? 1 : 0;
    const p = layoutTree('binary', 5, of(par), {spacing: 1}, side);
    const byX = [0, 1, 2, 3, 4].sort((a, b) => p[a]![0] - p[b]![0]).map(i => values[i]);
    assert.deepEqual(byX, [1, 3, 4, 5, 8], 'left to right is sorted order');
    // A lone right child still sits right of its parent.
    const q = layoutTree('binary', 2, of([-1, 0]), {}, () => 1);
    assert.ok(q[1]![0] > q[0]![0]);
});

test('complete: heap slots spread level by level across the width', () => {
    const p = layoutTree('complete', 4, () => -1, {width: 4, levelGap: 1}).map(round);
    assert.deepEqual(p, [[0, 0, 0], [-1, -1, 0], [1, -1, 0], [-1.5, -2, 0]]);
});

test('radial: the root at the centre, each depth on its own ring', () => {
    const p = layoutTree('radial', 6, of(parents), {origin: [1, 1, 0], levelGap: 2});
    assert.deepEqual(round(p[0]!), [1, 1, 0]);
    for (const [i, ring] of [[1, 2], [2, 2], [3, 4], [5, 4]] as const) assert.equal(Math.round(Math.hypot(p[i]![0] - 1, p[i]![1] - 1) * 1000) / 1000, ring);
});

test('indented: one row per node in preorder, indented by depth', () => {
    const p = layoutTree('indented', 6, of(parents), {spacing: 0.5, levelGap: 1}).map(round);
    // Preorder 0, 1, 3, 4, 2, 5.
    assert.deepEqual(p.map(q => q[1]), [0, -1, -4, -2, -3, -5]);
    assert.deepEqual(p.map(q => q[0]), [0, 0.5, 0.5, 1, 1, 1]);
});

test('a forest lays its trees side by side', () => {
    const p = layoutTree('tidy', 4, of([-1, 0, -1, 2]), {spacing: 1});
    assert.ok(p[2]![0] > p[0]![0] && p[3]![0] > p[1]![0], 'the second tree is to the right of the first');
    assert.equal(p[0]![1], p[2]![1], 'both roots on the top row');
});

test('horizontal turns a tidy tree to grow left to right: one column per depth, leaves down the rows', () => {
    const p = layoutTree('tidy', 6, of(parents), {spacing: 1, levelGap: 2, orientation: 'horizontal'}).map(round);
    assert.deepEqual(p.map(q => q[0]), [0, 2, 2, 4, 4, 4], 'x is the depth');
    assert.deepEqual(p.map(q => q[1]), [-0.25, 0.5, -1, 1, 0, -1], 'y runs down the leaves: the first leaf on top');
});
