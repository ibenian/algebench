import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBox, isClick } from '/objects/node-click.js';

const box = (index: number, minX: number, minY: number, maxX: number, maxY: number, depth = 0.5) => ({index, minX, minY, maxX, maxY, depth});

test('a point picks the box it falls in, the nearest when boxes overlap, and nothing between boxes', () => {
    const boxes = [box(0, 0, 0, 10, 10, 0.6), box(1, 5, 5, 15, 15, 0.4), box(2, 20, 0, 30, 10)];
    assert.equal(pickBox(boxes, 2, 2), 0);
    assert.equal(pickBox(boxes, 7, 7), 1, 'the overlap goes to the nearer box');
    assert.equal(pickBox(boxes, 25, 5), 2);
    assert.equal(pickBox(boxes, 17, 2), null);
    assert.equal(pickBox([], 1, 1), null);
});

test('a press released where it started is a click; one dragged away is not', () => {
    assert.equal(isClick({x: 10, y: 10}, {x: 13, y: 12}), true);
    assert.equal(isClick({x: 10, y: 10}, {x: 30, y: 10}), false, 'orbiting the view');
    assert.equal(isClick(null, {x: 0, y: 0}), false, 'no press on the canvas');
});
