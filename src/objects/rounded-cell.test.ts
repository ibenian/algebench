import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundedCellUnit } from '/objects/rounded-cell.js';

test('a rounded cell is unit-sized, round at the corners, and shaded by face', () => {
    const {positions, normals} = roundedCellUnit(1.25, .68, .2);
    assert.equal(positions.length, normals.length);
    assert.equal(positions.length % 9, 0, 'whole triangles');
    const xs = positions.filter((_, i) => i % 3 === 0), ys = positions.filter((_, i) => i % 3 === 1);
    assert.ok(Math.max(...xs.map(Math.abs)) <= .5 + 1e-9 && Math.max(...ys.map(Math.abs)) <= .5 + 1e-9, 'fits the unit cell');
    // No vertex at a sharp corner: the corner is cut by the radius.
    for (let i = 0; i < positions.length; i += 3) assert.ok(!(Math.abs(positions[i]!) > .49 && Math.abs(positions[i + 1]!) > .49));
    const nz = normals.filter((_, i) => i % 3 === 2);
    assert.ok(nz.includes(1) && nz.includes(-1), 'front and back caps');
    // The top wall faces up (the array lights up-facing rims).
    assert.ok(normals.some((v, i) => i % 3 === 1 && v > .99));
});
