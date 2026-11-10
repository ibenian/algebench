// ============================================================
// DEVELOPMENT / TEST FIXTURE — never imported by application code, so it is
// not in the production bundle (src/graph-explorer/runtime-update.test.ts
// checks static/dist for it).
//
// A runtime Knowledge Graph update of the kind a future tutor / Expert
// integration would propose: a learner studying Sliding Window Maximum asks
// about Sliding Window Minimum, and the new concept plus its relations join
// the graph without any change to lesson JSON or the lesson schema.
//
// Manual check in a running app (DevTools console, any lesson):
//   algebenchKnowledgeGraph.applyUpdate(<this payload as JSON>)
// ============================================================

import type { RuntimeUpdate } from '/graph-explorer/knowledge-model.js';

export const SLIDING_WINDOW_MINIMUM_UPDATE = {
    concepts: [
        {
            id: 'dsa.sliding-window-minimum',
            label: 'Sliding Window Minimum',
            category: 'problem',
            definition: 'The mirror problem: the minimum of every length-$k$ window. The same deque works '
                + 'with the order reversed (values increasing from front to back).',
        },
    ],
    relations: [
        { source: 'dsa.monotonic-deque', target: 'dsa.sliding-window-minimum', type: 'solves',
          description: 'Keep values increasing instead of decreasing.' },
        { source: 'dsa.sliding-window-minimum', target: 'dsa.sliding-window', type: 'uses' },
        { source: 'dsa.sliding-window-minimum', target: 'dsa.sliding-window-maximum', type: 'related-to',
          description: 'Mirror image: negate every value to turn one into the other.' },
    ],
} satisfies RuntimeUpdate;
