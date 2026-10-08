import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cellEdgeAnchor} from './cell-attachment.js';

test('cell connection and index anchors use the projected bottom center even after rotation and zoom', () => {
    const corners = [{x: 10, y: 20}, {x: 70, y: 25}, {x: 65, y: 55}, {x: 5, y: 50}];
    assert.deepEqual(cellEdgeAnchor(corners, 'bottom'), {x: 37.5, y: 55});
    assert.deepEqual(cellEdgeAnchor(corners.map(p => ({x:p.x * 2, y:p.y * 2})), 'bottom'), {x:75, y:110});
    assert.deepEqual(cellEdgeAnchor(corners, 'top', 8), {x:37.5, y:12});
});
