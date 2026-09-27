import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLesson } from './lesson-picker.ts';
import type { LessonSummary } from './lesson-picker.ts';

const lesson = (over: Partial<LessonSummary>): LessonSummary => ({
    id: 'eigenvalues', title: 'Eigenvalues & Eigenvectors',
    description: 'Most vectors change direction under a matrix $A$.',
    sceneCount: 4, stepCount: 14, domains: [], draft: false, ...over,
});

test('an empty query matches everything', () => {
    assert.ok(scoreLesson(lesson({}), '  ') > 0);
});

test('every query word has to match', () => {
    assert.ok(scoreLesson(lesson({}), 'eigen matrix') > 0);
    assert.equal(scoreLesson(lesson({}), 'eigen orbit'), 0);
});

test('a title word prefix outranks a description hit', () => {
    const inTitle = scoreLesson(lesson({}), 'eigen');
    const inDesc = scoreLesson(lesson({ title: 'Linear Maps', id: 'maps' }), 'direction');
    assert.ok(inTitle > inDesc);
});

test('drafts match "draft", built-ins match "built-in"', () => {
    assert.ok(scoreLesson(lesson({ draft: true }), 'draft') > 0);
    assert.equal(scoreLesson(lesson({ draft: false }), 'draft'), 0);
    assert.ok(scoreLesson(lesson({ draft: false }), 'built-in') > 0);
});

test('domains and ids are searchable', () => {
    assert.ok(scoreLesson(lesson({ domains: ['astrodynamics'] }), 'astro') > 0);
    assert.ok(scoreLesson(lesson({ id: 'draft/chart-demo', title: 'Charts' }), 'chart-demo') > 0);
});

test('LaTeX markers in the title do not block a match', () => {
    assert.ok(scoreLesson(lesson({ title: 'Vector Addition: $\\vec{a}$' }), 'vec') > 0);
});

test('scene descriptions are searchable', () => {
    const l = lesson({ searchText: 'The Characteristic Polynomial Solving det(A - λI) = 0' });
    assert.ok(scoreLesson(l, 'polynomial') > 0);
    assert.ok(scoreLesson(l, 'polynomial') < scoreLesson(l, 'eigen'));
    assert.equal(scoreLesson(lesson({}), 'polynomial'), 0);
});

test('glossary terms are searchable, above a description hit', () => {
    const l = lesson({ title: 'Outliers', id: 'anomaly', description: 'mad hatters',
        glossary: ['MAD', 'median absolute deviation', 'z-score'] });
    assert.ok(scoreLesson(l, 'median') > 0);
    assert.ok(scoreLesson(l, 'absolute') > 0);
    assert.ok(scoreLesson(l, 'z-score') > 0);
    assert.ok(scoreLesson(l, 'mad') > scoreLesson(lesson({ title: 'x', id: 'y', description: 'mad hatters' }), 'mad'));
});

test('scene titles are searchable, above glossary and description hits', () => {
    const l = lesson({ title: 'Reentry', id: 'reentry', description: '',
        sceneTitles: ['The Forces of Reentry', 'Aerodynamic Heating and Bow Shock'] });
    assert.ok(scoreLesson(l, 'bow shock') > 0);
    const inScene = scoreLesson(l, 'heating');
    assert.ok(inScene > scoreLesson(lesson({ title: 'x', id: 'y', glossary: ['heating'] }), 'heating'));
    assert.ok(inScene > scoreLesson(lesson({ title: 'x', id: 'y', searchText: 'heating' }), 'heating'));
    assert.ok(inScene < scoreLesson(lesson({ title: 'Heating', id: 'y' }), 'heating'));
});
