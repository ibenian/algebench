// ============================================================
// DEVELOPMENT / TEST FIXTURE — never imported by application code, so it is
// not in the production bundle (src/graph-explorer/runtime-update.test.ts
// checks static/dist for it).
//
// A runtime Knowledge Graph update of the kind a future tutor / Expert
// integration would propose: a learner studying Parenthesis validation asks
// how HTML checks its tags, and the new concept plus its relations join the
// graph without any change to lesson JSON or the lesson schema.
//
// Manual check in a running app (DevTools console, any lesson):
//   algebenchKnowledgeGraph.applyUpdate(<this payload as JSON>)
// ============================================================

import type { RuntimeUpdate } from '/graph-explorer/knowledge-model.js';

export const HTML_TAG_MATCHING_UPDATE = {
    concepts: [
        {
            id: 'dsa.html-tag-matching',
            label: 'HTML Tag Matching',
            category: 'problem',
            definition: 'Check that every opening tag such as `<p>` is closed by its own `</p>`, innermost first. '
                + 'It is the bracket check with tag names as the bracket types.',
        },
    ],
    relations: [
        { source: 'dsa.html-tag-matching', target: 'dsa.stack', type: 'uses',
          description: 'An opening tag pushes its name; a closing tag pops and compares.' },
        { source: 'dsa.html-tag-matching', target: 'dsa.lifo-order', type: 'uses' },
        { source: 'dsa.html-tag-matching', target: 'dsa.balanced-brackets', type: 'related-to',
          description: 'The same scan, with an unbounded set of bracket types instead of three.' },
    ],
} satisfies RuntimeUpdate;
