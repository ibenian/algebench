import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphEdgeCurve } from '/label-wire-path.js';

test('a graph edge runs from node edge to node edge and bows away from the graph centre', () => {
    const a = {centre: {x: 0, y: 0}, hw: 10, hh: 10, round: true}, b = {centre: {x: 100, y: 0}, hw: 10, hh: 10, round: true};
    const below = graphEdgeCurve(a, b, .2, {x: 50, y: -40});   // centre above the edge: it bows down
    assert.ok(below.arrive.y > 0, 'control point on the side away from the centre');
    const [sx, sy] = below.d.split(' ').slice(1, 3).map(Number);
    assert.ok(Math.abs(Math.hypot(sx!, sy!) - 12) < 1e-9, 'leaves the disc 2px out, heading for the bend');
    assert.ok(Math.abs(Math.hypot(below.end.x - 100, below.end.y) - 12) < 1e-9, 'arrives 2px off the target disc');
    const back = graphEdgeCurve(b, a, .2, {x: 50, y: -40});
    assert.ok(back.arrive.y > 0, 'both directions bow the same side of the centre');
});

test('a node linked to itself gets a loop over its top, and a rect node is left at its edge', () => {
    const n = {centre: {x: 0, y: 0}, hw: 10, hh: 8};
    const loop = graphEdgeCurve(n, n, .2, {x: 0, y: 0});
    assert.ok(loop.end.y === -10 && loop.arrive.y < -10, 'ends on the top edge, arriving from above');
    const side = graphEdgeCurve(n, {centre: {x: 100, y: 0}, hw: 10, hh: 8}, 0, {x: 0, y: -50});
    assert.match(side.d, /^M 12 0 /, 'a block is left at its side, 2px out');
});

test('an arc edge follows the circle round its centre, the short way, trimmed at both nodes', async () => {
    const { graphArcCurve } = await import('/label-wire-path.js');
    const node = (x: number, y: number) => ({centre: {x, y}, hw: 10, hh: 10});
    const arc = graphArcCurve(node(100, 0), node(0, 100), {x: 0, y: 0});   // a quarter turn, clockwise on screen
    assert.match(arc.d, /^M [\d.]+ [\d.]+ A 100 100 0 0 1 /, 'radius from the centre, short arc, positive sweep');
    assert.ok(Math.abs(Math.hypot(arc.end.x, arc.end.y) - 100) < 1e-9, 'ends on the circle');
    assert.ok(arc.end.x > 0 && arc.end.y < 100, 'stops short of the target node');
});
