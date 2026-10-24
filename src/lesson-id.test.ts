import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessonIdFrom } from '/lesson-id.js';

test('a lesson is named by its path under scenes/, without .json; the title only when there is no path', () => {
    assert.equal(lessonIdFrom('/scenes/conditional-probability.json', 'Conditional Probability'), 'conditional-probability');
    assert.equal(lessonIdFrom('/Users/me/algebench/scenes/draft/graph-algorithms.json', 'Graph algorithms'), 'draft/graph-algorithms');
    assert.equal(lessonIdFrom('scenes/draft/graph-algorithms.json', 'Graph algorithms'), 'draft/graph-algorithms', 'a relative path too');
    assert.equal(lessonIdFrom('my-lesson.json', 'Mine'), 'my-lesson');
    assert.equal(lessonIdFrom('', 'Uploaded'), 'Uploaded');
});
