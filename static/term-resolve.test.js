// Tests for graph-panel/term-resolve.js — resolving proof-animation terms
// against an independently-derived semantic graph.
//
// The regression scenario is real data from the statistics/normal-distribution-pdf
// proof docked over the app's graph of its start equation: the animation's
// `__power_7` is √π, but the graph's `__power_7` is the Gaussian exponential
// (two parses, two counters — same id string by coincidence). The resolver
// used to trust the raw id hit and confidently select the wrong node.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apprSkeleton, contentAgrees, resolveTermId } from './graph-panel/term-resolve.js';

// The app-side graph of the proof's start equation (subexprs abridged to the
// fields the resolver reads). Ids match a real parse of the plain state-0 latex.
const APP_GRAPH = {
    nodes: [
        { id: '__equals_1' },
        { id: '__multiply_2', subexpr: 'C \\cdot \\int_{-\\infty}^{\\infty} \\frac{1}{e^{...}} dx' },
        { id: 'C', latex: 'C' },
        { id: '__power_6', subexpr: '\\frac{1}{e^{\\frac{1 \\cdot \\frac{1}{2}}{\\sigma^{2}} \\left(- \\mu + x\\right)^{2}}}' },
        { id: '__power_7', subexpr: 'e^{\\frac{1 \\cdot \\frac{1}{2}}{\\sigma^{2}} \\left(- \\mu + x\\right)^{2}}' },
        { id: 'e', latex: 'e' },
        { id: '__power_9', subexpr: '\\left(- \\mu + x\\right)^{2}' },
        { id: 'mu', latex: '\\mu' },
        { id: 'x', latex: 'x' },
        { id: 'sigma', latex: '\\sigma' },
        { id: '__num_13', label: '2' },
    ],
};

test('named-symbol ids are trusted across parses', () => {
    assert.equal(resolveTermId(APP_GRAPH, 'sigma', 'σ'), 'sigma');
    assert.equal(resolveTermId(APP_GRAPH, 'C', 'C'), 'C');
    // occurrence suffix strips back to the canonical symbol
    assert.equal(resolveTermId(APP_GRAPH, 'x____add_10', 'x'), 'x');
});

test('REGRESSION: structural-id counter collision is rejected, not selected', () => {
    // animation √π carries __power_7; the graph's __power_7 is the exponential
    assert.equal(resolveTermId(APP_GRAPH, '__power_7', '√π'), null);
    // animation √2 carries _r4___power_9 → strips to __power_9 = (−μ+x)²
    assert.equal(resolveTermId(APP_GRAPH, '_r4___power_9', '√2'), null);
});

// NB: KaTeX DOM textContent renders exponents as plain digits — the rendered
// text of $(x-\mu)^2$ is "(x−μ)2", not "(x−μ)²" — so that's what these use.
test('structural id accepted when the content agrees', () => {
    // same id AND same content (the genuinely-shared-parse case)
    assert.equal(
        resolveTermId(APP_GRAPH, '__power_9', '(−μ+x)2'), '__power_9');
    // rebase prefix on a matching spine node strips and verifies
    assert.equal(
        resolveTermId(APP_GRAPH, '_r1___power_9', '(x−μ)2'), '__power_9');
});

test('rendered-text safety net still resolves unmatched positional ids', () => {
    // a term whose id differs entirely but whose skeleton names a node
    assert.equal(resolveTermId(APP_GRAPH, '__power_42', '(−μ+x)2'), '__power_9');
    // purely numeric appearance stays ambiguous → no match
    assert.equal(resolveTermId(APP_GRAPH, '__num_99', '2'), null);
});

test('apprSkeleton is order-insensitive and layout-blind', () => {
    // sympy reorders products; ordering must not matter
    assert.equal(apprSkeleton('C·√2·σ·√π'), apprSkeleton('\\sqrt{\\pi} \\sigma C \\sqrt{2}'));
    // \left(…\right) and \cdot are layout noise; unicode superscripts tolerated
    assert.equal(apprSkeleton('\\left(- \\mu + x\\right)^{2}'), apprSkeleton('(−μ+x)²'));
});

test('contentAgrees separates √π from the exponential', () => {
    const exp = APP_GRAPH.nodes.find(n => n.id === '__power_7');
    assert.equal(contentAgrees(exp, '√π'), false);
    assert.equal(contentAgrees({ subexpr: '\\sqrt{\\pi}' }, '√π'), true);
});

test('empty term text cannot verify a structural id', () => {
    assert.equal(resolveTermId(APP_GRAPH, '__power_7', ''), null);
    assert.equal(contentAgrees({ subexpr: '\\sqrt{\\pi}' }, ''), false);
});
