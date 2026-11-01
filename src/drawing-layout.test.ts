import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutShapes, treeLayout, shapeStroke, edgePoint, smoothPath, type DrawSpec } from '/drawing-layout.js';

const node = (id: string, extra: Partial<DrawSpec> = {}): DrawSpec => ({type: 'ellipse', id, label: id, ...extra});
const link = (start: string, end: string): DrawSpec => ({type: 'arrow', start, end});

test('a tree puts parents over the middle of their children, a level per row', () => {
    const els = [node('r'), node('a'), node('b'), node('c'), link('r', 'a'), link('r', 'b'), link('a', 'c')];
    const at = treeLayout(['r', 'a', 'b', 'c'], els);
    assert.ok(at.get('r')!.y < at.get('a')!.y && at.get('a')!.y < at.get('c')!.y);
    assert.equal(at.get('a')!.y, at.get('b')!.y);
    assert.ok(at.get('a')!.x < at.get('b')!.x);
    assert.equal(at.get('r')!.x, (at.get('a')!.x + at.get('b')!.x) / 2);
    assert.equal(at.get('a')!.x, at.get('c')!.x);
});

test('a placed shape keeps its place; the rest go in a row', () => {
    const at = layoutShapes([node('a', {x: 10, y: 20}), node('b'), node('c'), {type: 'text', label: 'hi'}]);
    assert.deepEqual(at.get('a'), {x: 10, y: 20});
    assert.equal(at.get('b')!.y, at.get('c')!.y);
    assert.ok(at.get('b')!.x < at.get('c')!.x);
    assert.equal(at.size, 3);
});

test('a cycle or a link to an unknown shape does not break the tree', () => {
    const at = treeLayout(['a', 'b'], [node('a'), node('b'), link('a', 'b'), link('b', 'a'), link('a', 'zz')]);
    assert.equal(at.size, 2);
    assert.ok([...at.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('a stroke starts where a hand starts, and a link meets each shape at its edge', () => {
    assert.match(shapeStroke('rectangle', 50, 50, 20, 10), /^M40 45 /);
    assert.match(shapeStroke('ellipse', 50, 50, 20, 10), /^M[\d.]+ [\d.]+ A10 5 /);
    const e = edgePoint('rectangle', 0, 0, 20, 10, {x: 100, y: 0}, 0);
    assert.deepEqual(e, {x: 10, y: 0});
    const c = edgePoint('ellipse', 0, 0, 20, 20, {x: 0, y: 50}, 0);
    assert.ok(Math.abs(c.y - 10) < 1e-9 && Math.abs(c.x) < 1e-9);
});

test('a free stroke runs through each point, and a closed one comes back to the start', () => {
    const open = smoothPath([{x: 0, y: 0}, {x: 10, y: 10}, {x: 20, y: 0}]);
    assert.match(open, /^M0 0 C[^C]+ 10 10 C[^C]+ 20 0$/);
    assert.match(smoothPath([{x: 0, y: 0}, {x: 10, y: 10}, {x: 20, y: 0}], true), / 0 0$/);
    assert.equal(smoothPath([{x: 1, y: 1}]), '');
});
