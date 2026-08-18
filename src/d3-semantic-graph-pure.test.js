// Covers the side-effect-free label helpers exported by
// src/graph-panel/d3-semantic-graph.ts. These mirror ``node_short_label`` /
// ``node_long_label`` / ``_OPERATOR_KINDS`` in scripts/latex_to_graph.py, so
// they are the pieces most likely to drift away from the Python parser.
//
// The module imports /labels.js, which reaches for `document` while defining
// its module-level helpers, so a minimal DOM stub is installed before the
// dynamic import. Nothing below touches the DOM, d3 or dagre — the CDN
// loaders are lazy and only run inside render().
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = {
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} },
};

const { operatorKind, nodeShortLabel, nodeLongLabel } =
  await import('/graph-panel/d3-semantic-graph.js');

test('operatorKind classifies only operator/relation/function nodes', () => {
  // Data nodes are never operators, whatever `op` says.
  assert.equal(operatorKind({ type: 'scalar', op: 'multiply' }), null);
  assert.equal(operatorKind({ type: 'number' }), null);
  assert.equal(operatorKind(null), null);
  assert.equal(operatorKind(undefined), null);

  // Known ops map to their kind, across every kind in the table.
  assert.equal(operatorKind({ type: 'operator', op: 'multiply' }), 'arithmetic');
  assert.equal(operatorKind({ type: 'operator', op: 'power' }), 'arithmetic');
  assert.equal(operatorKind({ type: 'function', op: 'sqrt' }), 'function');
  assert.equal(operatorKind({ type: 'relation', op: 'equals' }), 'comparison');
  assert.equal(operatorKind({ type: 'operator', op: 'implies' }), 'logical');
  assert.equal(operatorKind({ type: 'operator', op: 'union' }), 'set');
  assert.equal(operatorKind({ type: 'operator', op: 'integral' }), 'aggregate');
  assert.equal(operatorKind({ type: 'operator', op: 'inner_product' }), 'quantum');

  // Unknown / absent op falls back BY TYPE: functions are their own kind,
  // everything else lands in arithmetic.
  assert.equal(operatorKind({ type: 'function', op: 'zeta' }), 'function');
  assert.equal(operatorKind({ type: 'function' }), 'function');
  assert.equal(operatorKind({ type: 'operator', op: 'nonesuch' }), 'arithmetic');
  assert.equal(operatorKind({ type: 'relation' }), 'arithmetic');
});

test('nodeShortLabel prefers latex, then the operator glyph, then op/id', () => {
  assert.equal(nodeShortLabel(null), '');
  assert.equal(nodeShortLabel(undefined), '');

  // Data nodes: latex → label → id.
  assert.equal(nodeShortLabel({ type: 'scalar', latex: '\\psi', label: 'wave', id: 'psi' }), '\\psi');
  assert.equal(nodeShortLabel({ type: 'scalar', label: 'mass', id: 'm' }), 'mass');
  assert.equal(nodeShortLabel({ type: 'scalar', id: 'm' }), 'm');
  assert.equal(nodeShortLabel({ type: 'scalar' }), '');

  // Operators fall back to the glyph table when they carry no latex.
  assert.equal(nodeShortLabel({ type: 'operator', op: 'multiply' }), '×');
  assert.equal(nodeShortLabel({ type: 'relation', op: 'greater_equal' }), '≥');
  assert.equal(nodeShortLabel({ type: 'operator', op: 'integral' }), '∫');

  // `power` synthesises its glyph from the exponent, with -1 special-cased.
  assert.equal(nodeShortLabel({ type: 'operator', op: 'power', exponent: '2' }), '(·)²');
  assert.equal(nodeShortLabel({ type: 'operator', op: 'power', exponent: '-3' }), '(·)⁻³');
  assert.equal(nodeShortLabel({ type: 'operator', op: 'power', exponent: '-1' }), '1/(·)');
  assert.equal(nodeShortLabel({ type: 'operator', op: 'power' }), '(·)˙');

  // An op with no glyph entry degrades to the raw op name, then the id.
  assert.equal(nodeShortLabel({ type: 'operator', op: 'nonesuch', id: 'x' }), 'nonesuch');
  assert.equal(nodeShortLabel({ type: 'operator', id: '__op_1' }), '__op_1');
});

test('nodeShortLabel appends arity dots to function nodes', () => {
  // Arity comes from the child count the layout pass folds in; a function
  // with no children still reads as unary.
  assert.equal(nodeShortLabel({ type: 'function', latex: '\\cos' }), '\\cos(·)');
  assert.equal(
    nodeShortLabel({ type: 'function', latex: 'f', _childIds: ['a', 'b'] }),
    'f(·, ·)',
  );
  // A conditional probability separates its LAST argument with a bar.
  assert.equal(
    nodeShortLabel({ type: 'function', latex: 'P', _childIds: ['a', 'b'], _hasConditionEdge: true }),
    'P(·|·)',
  );
  // An assertion-form argument is an arbitrary predicate, shown as an ellipsis.
  assert.equal(
    nodeShortLabel({ type: 'function', latex: 'P', _childIds: ['a'], _hasAssertionEdge: true }),
    'P(…)',
  );
  // Latex that already spells out its own argument dots is left alone.
  assert.equal(nodeShortLabel({ type: 'function', latex: '\\lvert\\cdot\\rvert' }), '\\lvert\\cdot\\rvert');
  // Same rule applies to the op-name path (no latex at all).
  assert.equal(nodeShortLabel({ type: 'function', op: 'zeta' }), 'zeta(·)');
});

test('nodeLongLabel prefers subexpr, then latex, then the short label', () => {
  assert.equal(nodeLongLabel(null), '');
  assert.equal(
    nodeLongLabel({ type: 'operator', subexpr: '\\cos(\\theta/2)', latex: '\\cos' }),
    '\\cos(\\theta/2)',
  );
  assert.equal(nodeLongLabel({ type: 'scalar', latex: '\\psi', label: 'wave' }), '\\psi');
  // With neither, it falls through to nodeShortLabel — which for a bare
  // operator is the glyph, not the op name.
  assert.equal(nodeLongLabel({ type: 'operator', op: 'multiply' }), '×');
  assert.equal(nodeLongLabel({ type: 'scalar', label: 'mass' }), 'mass');
});
