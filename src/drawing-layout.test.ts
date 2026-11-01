import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutDrawing, shapeStroke, edgePoint, smoothPath, type DrawSpec } from '/drawing-layout.js';

const node = (id: string, extra: Partial<DrawSpec> = {}): DrawSpec => ({type: 'ellipse', id, label: id, ...extra});
const link = (start: string, end: string): DrawSpec => ({type: 'arrow', start, end});

const sized = {box: {w: 600, h: 400}, sizeOf: (e: DrawSpec) => ({w: (e.label ?? '').length * 10 + 20, h: 30})};
const boxOf = (laid: ReturnType<typeof layoutDrawing>, els: DrawSpec[], id: string) => laid.boxes.get(els.find(e => e.id === id)!)!;
const mid = (r: {x: number; y: number; w: number; h: number}) => ({x: r.x + r.w / 2, y: r.y + r.h / 2});
const apart = (a: {x: number; y: number; w: number; h: number}, b: typeof a) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

test('a tree puts parents over the middle of their children, a level per row', () => {
    const els = [node('r'), node('a'), node('b'), node('c'), link('r', 'a'), link('r', 'b'), link('a', 'c')];
    const laid = layoutDrawing(els, 'tree', sized), at = (id: string) => mid(boxOf(laid, els, id));
    assert.ok(at('r').y < at('a').y && at('a').y < at('c').y);
    assert.equal(at('a').y, at('b').y);
    assert.ok(at('a').x < at('b').x);
    assert.equal(at('r').x, (at('a').x + at('b').x) / 2);
    assert.equal(at('a').x, at('c').x);
});

test('a flow goes left to right a column per step, and wide shapes never overlap', () => {
    const els = [node('k', {label: 'Key'}), node('h', {label: 'Hash function'}), node('i', {label: 'Bucket index'}), node('n', {label: 'Modulo (bucket count)'}),
        link('k', 'h'), link('h', 'i'), link('n', 'i')];
    const laid = layoutDrawing(els, '', sized), b = (id: string) => boxOf(laid, els, id);
    assert.ok(mid(b('k')).x < mid(b('h')).x && mid(b('h')).x < mid(b('i')).x);
    for (const x of 'khin') for (const y of 'khin') if (x < y) assert.ok(apart(b(x), b(y)), `${x} and ${y} overlap`);
});

test('a group is placed by the one it sits in: a row of a box and a column of buckets', () => {
    const els: DrawSpec[] = [{type: 'group', id: 'pipe', layout: 'row'}, node('key', {group: 'pipe'}), node('hash', {group: 'pipe'}),
        {type: 'group', id: 'buckets', layout: 'column'}, node('b0', {group: 'buckets'}), node('b1', {group: 'buckets'}), node('b2', {group: 'buckets'})];
    const laid = layoutDrawing(els, 'row', sized), b = (id: string) => boxOf(laid, els, id);
    assert.equal(mid(b('key')).y, mid(b('hash')).y);
    assert.equal(mid(b('b0')).x, mid(b('b1')).x);
    assert.ok(mid(b('b0')).y < mid(b('b1')).y && mid(b('b1')).y < mid(b('b2')).y);
    assert.ok(b('hash').x + b('hash').w <= b('buckets').x, 'the buckets come after the row');
    for (const id of ['b0', 'b1', 'b2']) { const g = b('buckets'), x = b(id);assert.ok(x.x >= g.x && x.y >= g.y && x.x + x.w <= g.x + g.w + 1e-9 && x.y + x.h <= g.y + g.h + 1e-9); }
    assert.equal(laid.w, b('buckets').x + b('buckets').w);
});

test('in a free group places are relative to the group; links between groups make them a flow', () => {
    const els: DrawSpec[] = [{type: 'group', id: 'face', layout: 'free', w: 40, h: 50}, node('eye', {group: 'face', x: 25, y: 30}),
        node('other'), link('face', 'other'), link('eye', 'other')];
    const laid = layoutDrawing(els, '', sized), face = boxOf(laid, els, 'face'), eye = mid(boxOf(laid, els, 'eye'));
    assert.deepEqual({w: face.w, h: face.h}, {w: 240, h: 200});
    assert.deepEqual(eye, {x: face.x + 60, y: face.y + 60});
    assert.ok(boxOf(laid, els, 'other').x > face.x + face.w);
});

test('a picture with no layout keeps its places on the board; a group never sits in itself', () => {
    const laid = layoutDrawing([node('f', {x: 50, y: 50}), node('e', {x: 40, y: 40})], '', sized);
    assert.deepEqual([laid.w, laid.h], [600, 400]);
    const loop: DrawSpec[] = [{type: 'group', id: 'g', group: 'h'}, {type: 'group', id: 'h', group: 'g'}, node('a', {group: 'g'})];
    assert.equal(layoutDrawing(loop, '', sized).boxes.size, 3);
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



test('linked shapes are never placed by hand, even in a free layout', () => {
    const els = [node('a', {x: 90, y: 10}), node('b', {x: 10, y: 90}), link('a', 'b')];
    const laid = layoutDrawing(els, 'free', sized);
    assert.ok(mid(boxOf(laid, els, 'a')).x < mid(boxOf(laid, els, 'b')).x, 'a flow: a before b');
    assert.equal(mid(boxOf(laid, els, 'a')).y, mid(boxOf(laid, els, 'b')).y);
});

test('a graph with a cycle is laid out with no two boxes overlapping, the same way each time', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const els = [...ids.map(id => node(id, {label: `node ${id}`})), link('a', 'b'), link('b', 'c'), link('c', 'a'), link('c', 'd'), link('d', 'e'), link('e', 'b')];
    const laid = layoutDrawing(els, 'graph', sized), b = (id: string) => boxOf(laid, els, id);
    for (const x of ids) for (const y of ids) if (x < y) assert.ok(apart(b(x), b(y)), `${x} and ${y} overlap`);
    assert.deepEqual(layoutDrawing(els, 'graph', sized).boxes.get(els[0]!), laid.boxes.get(els[0]!));
});
