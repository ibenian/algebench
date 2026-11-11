// node:test — the Knowledge Graph snapshot sent to the AI tutor (CTX).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GraphViewModel } from '/graph-explorer/view-model.js';
import { CONTEXT_MAX_CONCEPTS, snapshotKnowledgeView } from '/graph-explorer/agent-context.js';
import {
    createKnowledgeGraph, mergeIntoGraph, parseLessonKnowledgeGraph, type ConceptData, type RelationData,
} from '/graph-explorer/knowledge-model.js';

function store() {
    const kg = createKnowledgeGraph();
    mergeIntoGraph(kg, parseLessonKnowledgeGraph({
        concepts: [
            { id: 'md', label: 'Monotonic Deque', category: 'data-structure', definition: 'D'.repeat(500) },
            { id: 'dq', label: 'Deque', category: 'data-structure', definition: 'double-ended queue' },
            { id: 'st', label: 'Stack' },
            { id: 'swm', label: 'Sliding Window Maximum', category: 'problem' },
        ],
        relations: [
            { source: 'md', target: 'dq', type: 'specializes', description: 'ordered deque' },
            { source: 'st', target: 'dq', type: 'specializes' },
            { source: 'md', target: 'swm', type: 'solves' },
        ],
    }, { lessonId: 'draft/swm', lessonTitle: 'SWM' }));
    return kg;
}

const vmOf = (kg: ReturnType<typeof store>) =>
    new GraphViewModel<ConceptData, RelationData>(kg, { graphType: 'knowledge', contextId: 'global' });

test('snapshot: focus, selection, visible concepts and relations as sentences', () => {
    const kg = store();
    const vm = vmOf(kg);
    vm.setPresentation('popup');
    vm.focusOn('st');
    vm.focusOn('md');
    vm.expand('dq');
    vm.select({ kind: 'node', id: 'dq' });
    const s = snapshotKnowledgeView(vm, true, new Date('2026-11-10T00:00:00Z'));
    assert.equal(s.open, true);
    assert.equal(s.presentation, 'popup');
    assert.equal(s.focus!.label, 'Monotonic Deque');
    assert.equal(s.focus!.definition!.length, 300, 'definitions are capped');
    assert.deepEqual(s.focus!.lessons, ['SWM']);
    assert.equal((s.selected as { label: string }).label, 'Deque');
    assert.equal((s.selected as { definition: string }).definition, 'double-ended queue');
    assert.equal(s.visibleConcepts[0]!.label, 'Monotonic Deque', 'focus first');
    assert.equal(s.visibleConcepts[0]!.role, 'focus');
    assert.ok(s.visibleConcepts.some((c) => c.label === 'Deque' && c.expanded && c.role === 'selected'));
    assert.ok(s.visibleConcepts.some((c) => c.label === 'Stack'), 'neighbour of the expanded concept is visible');
    assert.deepEqual(s.visibleRelations, ['Monotonic Deque solves Sliding Window Maximum',
        'Monotonic Deque specializes Deque', 'Stack specializes Deque']);
    assert.deepEqual(s.recentFoci, ['Stack'], 'earlier foci, most recent first');
    assert.equal(s.totalConcepts, 4);
    assert.equal(s.at, '2026-11-10T00:00:00.000Z');
});

test('snapshot: a selected relationship is a sentence with its description; scope is reported', () => {
    const kg = store();
    const vm = vmOf(kg);
    vm.focusOn('md');
    vm.select({ kind: 'edge', id: 'md|specializes|dq' });
    vm.setScope('local', (id) => id !== 'swm');
    const s = snapshotKnowledgeView(vm, false);
    assert.equal(s.open, false, 'closed explorer: the last view is still reported');
    assert.deepEqual(s.selected, { kind: 'relation', sentence: 'Monotonic Deque specializes Deque', description: 'ordered deque' });
    assert.equal(s.scope, 'local');
    assert.ok(!s.visibleConcepts.some((c) => c.label === 'Sliding Window Maximum'), 'out-of-scope concepts are not reported');
});

test('snapshot: bounded for large views, with the remainder counted', () => {
    const kg = createKnowledgeGraph();
    const concepts = [{ id: 'hub', label: 'Hub' }, ...Array.from({ length: 80 }, (_, i) => ({ id: `c${i}`, label: `C${i}` }))];
    const relations = concepts.slice(1).map((c) => ({ source: 'hub', target: c.id, type: 'uses' }));
    mergeIntoGraph(kg, parseLessonKnowledgeGraph({ concepts, relations }, { lessonId: 'l', lessonTitle: 'L' }));
    const vm = vmOf(kg);
    vm.focusOn('hub');
    const s = snapshotKnowledgeView(vm, true);
    assert.equal(s.visibleConcepts.length, CONTEXT_MAX_CONCEPTS);
    assert.equal(s.conceptsOmitted, 81 - CONTEXT_MAX_CONCEPTS);
    assert.equal(s.visibleRelations.length, 60);
    assert.equal(s.relationsOmitted, 20);
    assert.ok(JSON.stringify(s).length < 8000, 'stays small enough for every chat turn');
});
