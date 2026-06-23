/**
 * D3SemanticGraphRenderer — renders a semantic graph model directly with D3.
 *
 * Consumes the flat {nodes, edges} semantic graph model and uses dagre for
 * DAG layout (shared nodes appear once with multiple edges). Renders with
 * D3 keyed joins (enter/update/exit), supporting collapse/expand, KaTeX
 * labels via foreignObject, and edge-semantic coloring.
 *
 * This renderer does NOT touch the Mermaid path — it exists as an alternative.
 */

import { makeAiAskButton } from '/labels.js';

const D3_CDN_URL = 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
const DAGRE_CDN_URL = 'https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1.1.4/dist/dagre.min.js';

const SUPERSCRIPT_MAP = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻', '−': '⁻', 'n': 'ⁿ', 'i': 'ⁱ',
};
function toSuperscript(s) {
    return String(s).split('').map(c => SUPERSCRIPT_MAP[c] || c).join('');
}

let _d3 = null;
let _d3LoadPromise = null;

function loadD3() {
    if (_d3) return Promise.resolve(_d3);
    if (_d3LoadPromise) return _d3LoadPromise;
    _d3LoadPromise = import(D3_CDN_URL).then(mod => {
        _d3 = mod;
        return mod;
    });
    _d3LoadPromise.catch(() => { _d3LoadPromise = null; });
    return _d3LoadPromise;
}

let _dagre = null;
let _dagreLoadPromise = null;

function loadDagre() {
    if (_dagre) return Promise.resolve(_dagre);
    if (_dagreLoadPromise) return _dagreLoadPromise;
    _dagreLoadPromise = new Promise((resolve, reject) => {
        if (typeof window !== 'undefined' && window.dagre) {
            _dagre = window.dagre;
            resolve(_dagre);
            return;
        }
        const script = document.createElement('script');
        script.src = DAGRE_CDN_URL;
        script.onload = () => { _dagre = window.dagre; resolve(_dagre); };
        script.onerror = reject;
        document.head.appendChild(script);
    });
    _dagreLoadPromise.catch(() => { _dagreLoadPromise = null; });
    return _dagreLoadPromise;
}

// Default edge styles (fallback when theme has no edgeStyles)
const DEFAULT_EDGE_COLORS = {
    direct: '#e74c3c',
    inverse: '#5b8fc7',
    neutral: '#7e8aa3',
};

const EDGE_SEMANTIC_LABELS = [
    ['direct',  'Proportional'],
    ['inverse', 'Inversely proportional'],
    ['neutral', 'Structural'],
];

const DEFAULT_EDGE_WIDTHS = {
    direct: 2.5,
    inverse: 1.8,
    neutral: 1.4,
};

// Default node styles (fallback when theme has no nodeStyles).
// Color families:
//   green  — data (scalar / vector / constant / number / expression / text)
//   blue   — computation (operator / function)
//   purple — statements (relation)
//   brown  — meta (annotation)
//
// Per-op variants (``sin`` vs ``cos``, ``inner_product`` vs ``+``,
// etc.) are not styled here — they all inherit their type's colour.
// Themes that want per-op distinction should add op-keyed entries to
// their own ``nodeStyles`` block; those theme overrides take priority
// in ``_nodeStyle``.  This keeps the default palette taxonomy-driven
// (operator vs function vs data) and avoids singling out individual
// ops in the built-in defaults.
const DEFAULT_NODE_STYLES = {
    scalar:   { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
    vector:   { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
    constant: { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
    number:   { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
    relation: { fill: '#2e1b33', stroke: '#ab47bc', color: '#e1bee7' },
    expression: { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
    text:       { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
    annotation: { fill: '#2a2518', stroke: '#8d6e63', color: '#d7ccc8' },
};

let _themeCache = Object.create(null);

async function fetchTheme(name) {
    if (_themeCache[name]) return _themeCache[name];
    try {
        const res = await fetch(`/api/graph/theme/${encodeURIComponent(name)}`);
        if (!res.ok) return null;
        const theme = await res.json();
        _themeCache[name] = theme;
        return theme;
    } catch {
        return null;
    }
}

// Infer edge semantic from graph structure when not explicitly tagged
function inferEdgeSemantic(edge, nodeById) {
    if (edge.semantic) return edge.semantic;
    const src = nodeById[edge.from];
    const dst = nodeById[edge.to];
    if (src && src.op === 'power') {
        const raw = src.exponent;
        const n = parseFloat(raw);
        if (Number.isFinite(n)) {
            if (n < 0) return 'inverse';
            if (Math.abs(n) > 1) return 'direct';
        } else if (typeof raw === 'string' && raw.trimStart().startsWith('-')) {
            return 'inverse';
        }
    }
    if (dst && dst.op === 'multiply') return 'direct';
    return 'neutral';
}

// No tree conversion needed — dagre handles DAG layout directly.

// ---------------------------------------------------------------------------
// Two-form display convention — mirrors ``node_short_label`` /
// ``node_long_label`` in ``scripts/latex_to_graph.py``.  Keep in sync.
//
// short (op/rel/fn):  node.latex →  glyph(op, …)  →  op  →  id
// short (data):       node.latex →  node.label    →  id
// long  (any):        node.subexpr → node.latex   →  short label
//
// Operator-glyph map mirrors ``_OPERATOR_GLYPHS`` in the Python parser.
// ---------------------------------------------------------------------------

const OPERATOR_GLYPHS = {
    equals: '=', congruent: '≡', divides: '∣', asymptotic: '∼',
    approximately: '≈', proportional: '∝', maps_to: '→',
    greater_than: '>', less_than: '<',
    greater_equal: '≥', less_equal: '≤', not_equal: '≠',
    multiply: '×', add: '+', subtract: '−',
    divide: '÷', integral: '∫', closed_integral: '∮',
    implies: '⇒', iff: '⇔',
    negation: '−', neg: '¬(·)', not: '¬', logical_not: '¬',
    forall: '∀(·)', exists: '∃(·)',
    conjunction: '∧', disjunction: '∨',
    intersection: '∩', union: '∪', set_difference: '∖',
    sum: '∑', product: '∏', limit: 'lim',
    factorial: '(·)!', sqrt: '√(·)',
    log: 'log(·)', logarithm: 'log(·)', exp: 'exp(·)',
    sin: 'sin(·)', cos: 'cos(·)', tan: 'tan(·)',
    Abs: '|·|', abs: '|·|',
    function: 'f(·)',
};

// LaTeX equivalents for operator glyphs — used when rendering operator
// labels through KaTeX (nodes without an explicit ``latex`` field).
const OPERATOR_LATEX = {
    equals: '=', congruent: '\\equiv', divides: '\\mid', asymptotic: '\\sim',
    approximately: '\\approx', proportional: '\\propto', maps_to: '\\to',
    greater_than: '>', less_than: '<',
    greater_equal: '\\geq', less_equal: '\\leq', not_equal: '\\neq',
    element_of: '\\in', not_element_of: '\\notin',
    multiply: '\\times', add: '+', subtract: '-',
    divide: '\\div', integral: '\\int', closed_integral: '\\oint',
    tends_to: '\\to',
    implies: '\\Rightarrow', iff: '\\Leftrightarrow',
    negation: '-', neg: '\\lnot(\\cdot)', not: '\\lnot', logical_not: '\\lnot',
    forall: '\\forall(\\cdot)', exists: '\\exists(\\cdot)',
    conjunction: '\\land', disjunction: '\\lor',
    intersection: '\\cap', union: '\\cup', set_difference: '\\setminus',
    sum: '\\sum', product: '\\prod', limit: '\\lim',
    factorial: '(\\cdot)!', sqrt: '\\sqrt{\\cdot}',
    log: '\\log(\\cdot)', logarithm: '\\log(\\cdot)', exp: '\\exp(\\cdot)',
    sin: '\\sin(\\cdot)', cos: '\\cos(\\cdot)', tan: '\\tan(\\cdot)',
    Abs: '\\lvert\\cdot\\rvert', abs: '\\lvert\\cdot\\rvert',
    function: 'f(\\cdot)',
};

const OP_KINDS = new Set(['operator', 'relation', 'function']);

// Operator-kind classification — mirrors ``_OPERATOR_KINDS`` in
// ``scripts/latex_to_graph.py``.  Each kind gets a distinct cool-palette
// tint via ``OPERATOR_KIND_STYLES`` so different semantic categories
// read at a glance while remaining recognizably "operator family".
//   arithmetic — basic combiners (+, −, ×, ÷, ^, negate)
//   function   — named functions (sin, cos, log, exp, |·|, √, !)
//   comparison — value comparators (=, ≠, <, ≤, >, ≥)
//   logical    — proposition connectives (⇒, ⇔, ¬, ∧, ∨)
//   aggregate  — variable-binding reducers (Σ, ∏, ∫, lim, d/dx, ∂/∂x)
//   quantum    — Dirac/linalg operators (⟨·|·⟩, future outer/expect.)
// Keep in sync with _OPERATOR_KINDS in scripts/latex_to_graph.py
const OPERATOR_KINDS = {
    add: 'arithmetic', subtract: 'arithmetic', multiply: 'arithmetic',
    divide: 'arithmetic', power: 'arithmetic', negation: 'arithmetic',
    Abs: 'function', abs: 'function', sqrt: 'function',
    factorial: 'function',
    sin: 'function', cos: 'function', tan: 'function',
    log: 'function', logarithm: 'function', exp: 'function',
    equals: 'comparison', not_equal: 'comparison',
    approximately: 'comparison', proportional: 'comparison', maps_to: 'comparison',
    greater_than: 'comparison', less_than: 'comparison',
    greater_equal: 'comparison', less_equal: 'comparison',
    element_of: 'comparison', not_element_of: 'comparison',
    implies: 'logical', iff: 'logical',
    neg: 'logical', not: 'logical', logical_not: 'logical',
    forall: 'logical', exists: 'logical',
    conjunction: 'logical', disjunction: 'logical',
    intersection: 'set', union: 'set', set_difference: 'set',
    sum: 'aggregate', product: 'aggregate',
    integral: 'aggregate', closed_integral: 'aggregate', limit: 'aggregate',
    derivative: 'aggregate', partial_derivative: 'aggregate',
    inner_product: 'quantum',
};

// Per-kind tint variants (cool-palette — distinct enough to
// glance-discriminate but unified as "operator").
const OPERATOR_KIND_STYLES = {
    arithmetic: { fill: '#0f2540', stroke: '#42a5f5', color: '#bbdefb' },
    function:   { fill: '#0f3340', stroke: '#29b6f6', color: '#b3e5fc' },
    comparison: { fill: '#1a2240', stroke: '#7e57c2', color: '#d1c4e9' },
    logical:    { fill: '#0f2a30', stroke: '#26c6da', color: '#b2ebf2' },
    set:        { fill: '#1a2a20', stroke: '#66bb6a', color: '#c8e6c9' },
    aggregate:  { fill: '#1d2540', stroke: '#5c6bc0', color: '#c5cae9' },
    quantum:    { fill: '#2d1530', stroke: '#ab47bc', color: '#e1bee7' },
};

export function operatorKind(node) {
    if (!node || !OP_KINDS.has(node.type)) return null;
    const op = node.op;
    if (op && OPERATOR_KINDS[op]) return OPERATOR_KINDS[op];
    // Default by type: named-function nodes → ``function`` kind,
    // everything else (operators / relations) → ``arithmetic``.
    return node.type === 'function' ? 'function' : 'arithmetic';
}

function operatorGlyph(node) {
    if (!node) return null;
    const op = node.op;
    if (!op) return null;
    if (op === 'power') {
        if (node.exponent != null && String(node.exponent) === '-1') return '1/(·)';
        return node.exponent ? `(·)${toSuperscript(node.exponent)}` : '(·)˙';
    }
    return OPERATOR_GLYPHS[op] || null;
}

/**
 * Build the arity-dot string for a function label.
 * When ``hasCondition`` is true, the last argument is separated
 * by ``|`` (conditional probability) instead of ``, ``.
 *
 * @param {number} arity  Number of arguments.
 * @param {boolean} hasCondition  Whether the function has a condition edge.
 * @param {string} dot  The dot character (``·`` for text, ``\\cdot`` for LaTeX).
 * @returns {string}
 */
function _arityDots(arity, hasCondition, hasAssertion, dot) {
    if (hasCondition && arity >= 2) {
        const sep = dot === '·' ? '|' : '\\mid ';
        const regular = Array(arity - 1).fill(dot).join(', ');
        return `${regular}${sep}${dot}`;
    }
    // Assertion-form: the assertion is an arbitrary predicate (X=k, X≥a,
    // |X−μ|≥kσ, …) fed in as a single edge.  Show ``…`` rather than
    // trying to decompose it into ``·op·``.
    if (hasAssertion) {
        return dot === '·' ? '…' : '\\ldots';
    }
    return Array(arity).fill(dot).join(', ');
}

/**
 * Compact symbol shown on the graph node itself.
 * ``\cos``, ``⟨0|·⟩``, ``|·|``, ``(·)²``, ``+``, ``=``…
 */
export function nodeShortLabel(node) {
    if (!node) return '';
    if (OP_KINDS.has(node.type)) {
        if (node.latex) {
            if (node.type === 'function' && !node.latex.includes('\\cdot') && !node.latex.includes('·')) {
                const arity = (node._childIds || []).length || 1;
                const dots = _arityDots(arity, node._hasConditionEdge, node._hasAssertionEdge, '·');
                return `${node.latex}(${dots})`;
            }
            return node.latex;
        }
        const g = operatorGlyph(node);
        if (g) return g;
        const name = node.op || node.id || '';
        if (node.type === 'function' && name && !name.includes('·')) {
            const arity = (node._childIds || []).length || 1;
            const dots = _arityDots(arity, node._hasConditionEdge, node._hasAssertionEdge, '·');
            return `${name}(${dots})`;
        }
        return name;
    }
    return node.latex || node.label || node.id || '';
}

/**
 * Full applied form shown in the details panel / hover / TTS.
 * ``\cos(θ/2)``, ``⟨0|ψ⟩``, ``|⟨0|ψ⟩|²``…
 */
export function nodeLongLabel(node) {
    if (!node) return '';
    return node.subexpr || node.latex || nodeShortLabel(node);
}

/**
 * Get the display label for a node, respecting label detail level.
 * Thin wrapper around ``nodeShortLabel`` that adds the emoji prefix
 * for ``minimal`` label mode on data nodes.
 *
 * @param {Object} node
 * @param {'minimal'|'description'|'full'} labelMode
 */
function getNodeLabel(node, labelMode) {
    const short = nodeShortLabel(node);
    if (OP_KINDS.has(node.type)) return short;
    // Data nodes show only the emoji in minimal mode.
    if (labelMode === 'minimal' && node.emoji) {
        return node.emoji;
    }
    if (node.emoji && short !== node.emoji) return node.emoji + ' ' + short;
    return short;
}

export class D3SemanticGraphRenderer {
    /**
     * @param {HTMLElement} container — the DOM element to render into
     * @param {Object} opts
     * @param {Object} [opts.katex] — KaTeX instance for label rendering
     * @param {'top-down'|'left-right'|'right-left'|'bottom-up'} [opts.direction]
     * @param {'minimal'|'description'|'full'} [opts.labels]
     * @param {Function} [opts.onNodeClick] — callback(nodeId, nodeData)
     * @param {Function} [opts.onNodeHover] — callback(nodeId|null, nodeData|null, nodeEl|null)
     * @param {Function} [opts.onBackgroundClick] — callback()
     */
    constructor(container, opts = {}) {
        this.container = container;
        this.katex = opts.katex || (typeof window !== 'undefined' && window.katex);
        this.direction = opts.direction || 'left-right';
        this.labels = opts.labels || 'description';
        this.themeName = opts.theme || 'default-dark';
        this.onNodeClick = opts.onNodeClick || null;
        this.onNodeHover = opts.onNodeHover || null;
        this.onBackgroundClick = opts.onBackgroundClick || null;

        this.onZoomChange = opts.onZoomChange || null;
        this.onTransformChange = opts.onTransformChange || null;
        this.onChartClick = opts.onChartClick || null;

        this._graph = null;
        this._theme = null;
        this._collapsed = new Set();
        this._svg = null;
        this._viewport = null;
        this._zoomBehavior = null;
        this._currentTransform = null;
        this._needsInitialFit = true;
        this._d3 = null;
        this._dagre = null;
        this._positionById = new Map();
        this._lastInteractionId = null;
        this._activeNodeId = null;
        this._selectedNodeIds = new Set();
        this._highlightTimer = null;
        this._destroyed = false;
    }

    async render(graph) {
        if (this._destroyed) return;
        this._graph = graph;
        const [d3, dagre] = await Promise.all([loadD3(), loadDagre()]);
        if (this._destroyed) return;
        this._d3 = d3;
        this._dagre = dagre;
        this._theme = await fetchTheme(this.themeName);
        if (this._destroyed) return;

        if (!graph.nodes || !graph.nodes.length) {
            this.container.innerHTML = '<div style="color:#7e8aa3;padding:2rem;text-align:center;">No renderable graph structure.</div>';
            return;
        }
        this._lastInteractionId = graph.nodes[0].id;
        this._setupSvg();
        this._renderGraph();
    }

    async update(opts = {}) {
        if (opts.direction) this.direction = opts.direction;
        if (opts.labels) this.labels = opts.labels;
        if (opts.theme && opts.theme !== this.themeName) {
            this.themeName = opts.theme;
            this._theme = await fetchTheme(this.themeName);
        }
        if (this._d3 && this._dagre && this._graph) {
            this._renderGraph();
        }
    }

    selectNode(nodeId) {
        this._activeNodeId = nodeId;
        this._selectedNodeIds.clear();
        if (nodeId) this._selectedNodeIds.add(nodeId);
        this._applyHighlight();
    }

    /**
     * Restore an ordered multi-selection (deeplink / AI jump). The last id in
     * the array becomes the active node — matching Cmd+Click semantics, where
     * the most recently added node is active. JS Set preserves insertion order.
     */
    setSelection(orderedIds) {
        const ids = (orderedIds || []).filter(Boolean);
        this._selectedNodeIds = new Set(ids);
        this._activeNodeId = ids.length ? ids[ids.length - 1] : null;
        this._applyHighlight();
        // Selection is often set right after a render whose enter/update
        // transitions are still animating opacity back to 1 (deeplink restore);
        // re-apply once they finish so the dimming actually sticks.
        this._scheduleHighlightReapply();
    }

    // Re-apply the highlight after in-flight render transitions settle, so the
    // imperative opacity dimming isn't overridden by a concurrent transition.
    _scheduleHighlightReapply(delay = 420) {
        clearTimeout(this._highlightTimer);
        this._highlightTimer = setTimeout(() => {
            if (!this._destroyed && this._selectedNodeIds.size) this._applyHighlight();
        }, delay);
    }

    clearSelection() {
        this._activeNodeId = null;
        this._selectedNodeIds.clear();
        this._applyHighlight();
    }

    get activeNode() {
        return this._activeNodeId;
    }

    get selectedNodes() {
        return new Set(this._selectedNodeIds);
    }

    saveState() {
        return {
            collapsed: new Set(this._collapsed),
            activeNodeId: this._activeNodeId,
            selectedNodeIds: new Set(this._selectedNodeIds),
            positionById: new Map(this._positionById),
            zoomTransform: this._currentTransform,
        };
    }

    restoreState(snapshot) {
        if (!snapshot) return;
        this._collapsed = new Set(snapshot.collapsed);
        this._activeNodeId = snapshot.activeNodeId;
        this._selectedNodeIds = new Set(snapshot.selectedNodeIds || []);
        this._positionById = new Map(snapshot.positionById);
        if (snapshot.zoomTransform) this._currentTransform = snapshot.zoomTransform;
        this._needsInitialFit = false;
        if (this._svg) this._applyHighlight();
    }

    destroy() {
        this._destroyed = true;
        clearTimeout(this._highlightTimer);
        if (this._svg && this._zoomBehavior) {
            this._svg.on('.zoom', null);
            if (this._wheelPanHandler) {
                this._svg.node().removeEventListener('wheel', this._wheelPanHandler);
            }
        }
        this.container.innerHTML = '';
        this._svg = null;
        this._viewport = null;
        this._zoomBehavior = null;
        this._graph = null;
        this._positionById.clear();
    }

    // ─── Theme helpers ─────────────────────────────────────────────────

    _nodeStyle(nodeOrType) {
        // Accept either a bare type string (legacy callers) or a full
        // node data object.  Precedence:
        //   1. theme.nodeStyles[op]      — theme op-specific override
        //      (most specific — wins over everything below)
        //   2. theme.nodeStyles[kind]    — theme kind-level override
        //      (kinds: arithmetic, function, comparison, logical,
        //      aggregate, quantum)
        //   3. theme.nodeStyles[type]    — theme type-level override
        //      (a theme that uniformly styles ``operator`` opts OUT
        //      of per-kind tints by setting this)
        //   4. OPERATOR_KIND_STYLES[k]   — built-in per-kind tint
        //      (gives kind variation when the theme is silent)
        //   5. DEFAULT_NODE_STYLES[type] — built-in type-level default
        //
        // Themes that want the kind variation: don't set ``operator``
        // (let levels 1–2 + 4 paint it).  Themes that want uniform
        // operator coloring: set ``operator`` to wash over kinds.
        // Themes that want both: set ``operator`` AND specific kinds.
        const isNode = nodeOrType && typeof nodeOrType === 'object';
        const nodeType = isNode ? nodeOrType.type : nodeOrType;
        const op = isNode ? nodeOrType.op : null;
        const ts = this._theme?.nodeStyles;
        if (op && ts && ts[op]) return ts[op];
        const kind = isNode ? operatorKind(nodeOrType) : null;
        if (kind && ts && ts[kind]) return ts[kind];
        if (ts && ts[nodeType]) return ts[nodeType];
        if (kind && OPERATOR_KIND_STYLES[kind]) return OPERATOR_KIND_STYLES[kind];
        return DEFAULT_NODE_STYLES[nodeType] || DEFAULT_NODE_STYLES.scalar;
    }

    _edgeColor(semantic) {
        const es = this._theme?.edgeStyles;
        if (es && es[semantic]) return es[semantic].stroke;
        const single = this._theme?.edgeStyle;
        if (single?.stroke && !this._theme?.paintBySemantic) return single.stroke;
        return DEFAULT_EDGE_COLORS[semantic] || DEFAULT_EDGE_COLORS.neutral;
    }

    _edgeWidth(semantic) {
        const es = this._theme?.edgeStyles;
        if (es && es[semantic]) return es[semantic].strokeWidth || DEFAULT_EDGE_WIDTHS.neutral;
        const single = this._theme?.edgeStyle;
        if (single?.strokeWidth && !this._theme?.paintBySemantic) return single.strokeWidth;
        return DEFAULT_EDGE_WIDTHS[semantic] || DEFAULT_EDGE_WIDTHS.neutral;
    }

    // ─── Private ──────────────────────────────────────────────────────

    _setupSvg() {
        const d3 = this._d3;
        this.container.innerHTML = '';

        const card = document.createElement('div');
        card.className = 'gv-card d3-graph-card';
        card.style.position = 'relative';
        this.container.appendChild(card);

        this._svg = d3.select(card)
            .append('svg')
            .attr('class', 'd3-semantic-graph')
            .attr('width', '100%')
            .attr('height', '100%');

        const overlay = document.createElement('div');
        overlay.className = 'd3sg-annotation-overlay';
        card.appendChild(overlay);
        this._annotationOverlay = overlay;

        const legend = document.createElement('div');
        legend.className = 'd3sg-edge-legend hidden';
        card.appendChild(legend);
        this._edgeLegend = legend;

        const defs = this._svg.append('defs');
        defs.append('marker')
            .attr('id', 'd3sg-arrow-role')
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 8).attr('refY', 5)
            .attr('markerWidth', 6).attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,0 L10,5 L0,10 Z')
            .attr('fill', 'var(--d3sg-role-arrow, #888)');

        this._viewport = this._svg.append('g').attr('class', 'd3sg-viewport');
        this._linkLayer = this._viewport.append('g').attr('class', 'd3sg-links');
        this._labelLayer = this._viewport.append('g').attr('class', 'd3sg-edge-labels');
        this._nodeLayer = this._viewport.append('g').attr('class', 'd3sg-nodes');

        this._setupZoom(d3);

        this._svg.on('contextmenu', (event) => event.preventDefault());

        // Background click — only fire when not panning
        this._svg.on('click', (event) => {
            if (event.defaultPrevented) return;
            if (event.target === this._svg.node() || event.target.tagName === 'svg') {
                this._activeNodeId = null;
                this._selectedNodeIds.clear();
                this._applyHighlight();
                if (this.onBackgroundClick) this.onBackgroundClick();
            }
        });

        // Double-click on background → zoom to fit
        this._svg.on('dblclick.zoom', null);
        this._svg.on('dblclick', (event) => {
            if (event.target === this._svg.node() || event.target.tagName === 'svg') {
                event.preventDefault();
                this.zoomToFit();
            }
        });
    }

    _setupZoom(d3) {
        const ZOOM_MIN = 0.15;
        const ZOOM_MAX = 5;

        this._zoomBehavior = d3.zoom()
            .scaleExtent([ZOOM_MIN, ZOOM_MAX])
            .filter((event) => {
                // Trackpad two-finger scroll (deltaMode 0) → handled separately as pan; let mouse wheel + pinch through
                if (event.type === 'wheel') return event.ctrlKey || event.deltaMode !== 0;
                // Allow touch/pointer events (button is 0 or undefined) and right-click (button 2)
                return !event.ctrlKey && (event.button == null || event.button === 0 || event.button === 2);
            })
            .on('zoom', (event) => {
                this._currentTransform = event.transform;
                this._viewport.attr('transform', event.transform);
                if (this.onZoomChange) {
                    this.onZoomChange(Math.round(event.transform.k * 100));
                }
                if (this.onTransformChange) {
                    this.onTransformChange(event.transform);
                }
            });

        this._svg.call(this._zoomBehavior);

        // Two-finger scroll → pan (pinch-to-zoom is handled by D3 zoom above)
        this._wheelPanHandler = (event) => {
            if (event.ctrlKey || event.deltaMode !== 0) return;
            event.preventDefault();
            const t = this._currentTransform || d3.zoomIdentity;
            const nt = d3.zoomIdentity.translate(t.x - event.deltaX, t.y - event.deltaY).scale(t.k);
            this._svg.call(this._zoomBehavior.transform, nt);
        };
        this._svg.node().addEventListener('wheel', this._wheelPanHandler, { passive: false });

        // Restore saved transform if switching back to a step that had one
        if (this._currentTransform) {
            const t = this._currentTransform;
            this._svg.call(this._zoomBehavior.transform,
                d3.zoomIdentity.translate(t.x, t.y).scale(t.k));
        }
    }

    resetZoom() {
        this._currentTransform = null;
        this._needsInitialFit = true;
    }

    zoomBy(factor) {
        if (!this._svg || !this._zoomBehavior || !this._d3) return;
        this._svg.transition().duration(200)
            .call(this._zoomBehavior.scaleBy, factor);
    }

    zoomToFit(animate = true) {
        if (!this._svg || !this._zoomBehavior || !this._d3) return;
        const d3 = this._d3;
        const svgNode = this._svg.node();
        const { width: svgW, height: svgH } = svgNode.getBoundingClientRect();
        if (!svgW || !svgH) return;

        const vpNode = this._viewport.node();
        const bbox = vpNode.getBBox();
        if (!bbox.width || !bbox.height) return;

        // Charts pinned at the top dock over the graph; reserve their vertical
        // band so the fit only uses the space left beneath them.
        const card = svgNode.parentNode;
        const pinned = card && card.querySelector('.sgc-pinned-panel');
        let topInset = 0;
        if (pinned && pinned.offsetParent !== null) {
            const cardTop = card.getBoundingClientRect().top;
            const pinnedRect = pinned.getBoundingClientRect();
            // distance from the card's top edge to the bottom of the pinned band
            topInset = Math.max(0, pinnedRect.bottom - cardTop);
        }

        const pad = 40;
        const availH = svgH - topInset;
        const scale = Math.min(
            (svgW - pad * 2) / bbox.width,
            (availH - pad * 2) / bbox.height,
            5
        );
        const tx = svgW / 2 - scale * (bbox.x + bbox.width / 2);
        // Center within the region below the pinned charts.
        const ty = topInset + availH / 2 - scale * (bbox.y + bbox.height / 2);

        const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
        if (animate) {
            this._svg.transition().duration(400).ease(d3.easeCubicOut)
                .call(this._zoomBehavior.transform, t);
        } else {
            this._svg.call(this._zoomBehavior.transform, t);
        }
    }

    get zoomLevel() {
        return this._currentTransform ? Math.round(this._currentTransform.k * 100) : 100;
    }

    _isHorizontal() {
        return this.direction === 'left-right' || this.direction === 'right-left';
    }

    _layoutGraph() {
        const dagre = this._dagre;
        const graph = this._graph;
        const nodes = graph.nodes || [];
        const edges = graph.edges || [];

        const nodeById = Object.create(null);
        for (const n of nodes) nodeById[n.id] = n;

        const childrenOf = Object.create(null);
        const conditionEdgeTargets = new Set();
        const assertionEdgeTargets = new Set();
        // Integrals whose integration variable is a first-class ``differential``
        // node reached by a ``wrt`` edge — these keep the sign glyph bare (the
        // ``dx`` shows as its own node). A legacy ``wrt`` edge from a bare
        // variable (no differential node) must NOT qualify, or the variable
        // would vanish from the glyph.
        const differentialChildTargets = new Set();
        for (const e of edges) {
            if (!childrenOf[e.to]) childrenOf[e.to] = [];
            childrenOf[e.to].push(e.from);
            if (e.role === 'condition') conditionEdgeTargets.add(e.to);
            if (e.role === 'assertion') assertionEdgeTargets.add(e.to);
            if (e.role === 'wrt' && nodeById[e.from]?.type === 'differential')
                differentialChildTargets.add(e.to);
        }

        const annoIds = new Set(nodes.filter(n => n.type === 'annotation').map(n => n.id));

        // BFS from roots to find visible nodes (stop at collapsed)
        const hasOutgoing = new Set(edges.map(e => e.from));
        const roots = nodes.filter(n => !hasOutgoing.has(n.id));

        const visible = new Set();
        const queue = roots.map(r => r.id);
        while (queue.length) {
            const id = queue.shift();
            if (visible.has(id)) continue;
            if (annoIds.has(id)) continue;
            visible.add(id);
            if (this._collapsed.has(id)) continue;
            for (const child of (childrenOf[id] || [])) queue.push(child);
        }

        const rankdir = this.direction === 'top-down' ? 'TB' :
                        this.direction === 'bottom-up' ? 'BT' :
                        this.direction === 'left-right' ? 'LR' : 'RL';

        const g = new dagre.graphlib.Graph({ multigraph: true });
        g.setGraph({ rankdir, nodesep: 60, ranksep: 80, marginx: 40, marginy: 40 });
        g.setDefaultEdgeLabel(() => ({}));

        for (const n of nodes) {
            if (!visible.has(n.id)) continue;
            if (n.type === 'annotation') continue;
            const isCollapsed = this._collapsed.has(n.id);
            const isOp = n.type === 'operator' || n.type === 'relation' || n.type === 'function';
            let w, h;
            if (isCollapsed) {
                const label = n.subexpr || n.label || n.id || '';
                w = Math.max(100, Math.min(260, label.length * 7 + 30));
                h = 48;
            } else if (isOp) {
                w = 56; h = 56;
            } else {
                w = 52; h = 52;
            }
            g.setNode(n.id, { width: w, height: h });
        }

        const edgeSemanticMap = Object.create(null);
        for (const e of edges) {
            if (!visible.has(e.from) || !visible.has(e.to)) continue;
            const key = `${e.from}->${e.to}`;
            edgeSemanticMap[key] = inferEdgeSemantic(e, nodeById);
            g.setEdge(e.to, e.from, {}, key);
        }

        dagre.layout(g);

        // Integral/sum bounds are stored as the bound NODE's id (e.g. "__num_2").
        // Resolve to that node's value so labels read ∫_0^1, not ∫_{__num_2}.
        const boundLabel = (ref) => {
            if (!ref) return '';
            const b = nodeById[ref];
            return b ? (b.latex || b.label || b.subexpr || ref) : ref;
        };

        const nodeWrappers = Object.create(null);
        const layoutNodes = [];
        for (const id of g.nodes()) {
            const pos = g.node(id);
            const src = nodeById[id];
            const wrapper = {
                data: {
                    ...src,
                    _collapsed: this._collapsed.has(id),
                    _childIds: childrenOf[id] || [],
                    _hasConditionEdge: conditionEdgeTargets.has(id),
                    _hasAssertionEdge: assertionEdgeTargets.has(id),
                    _hasDifferentialChild: differentialChildTargets.has(id),
                    _lowerBoundLabel: boundLabel(src.lower_bound),
                    _upperBoundLabel: boundLabel(src.upper_bound),
                },
                x: pos.x,
                y: pos.y,
            };
            nodeWrappers[id] = wrapper;
            layoutNodes.push(wrapper);
        }

        const layoutEdges = [];
        for (const e of edges) {
            if (!visible.has(e.from) || !visible.has(e.to)) continue;
            const src = nodeWrappers[e.to];
            const tgt = nodeWrappers[e.from];
            if (!src || !tgt) continue;
            layoutEdges.push({
                source: src,
                target: tgt,
                id: `${e.from}->${e.to}`,
                semantic: edgeSemanticMap[`${e.from}->${e.to}`] || 'neutral',
                role: e.role || null,
            });
        }

        return { nodes: layoutNodes, edges: layoutEdges };
    }

    _renderGraph(interactionId) {
        const d3 = this._d3;
        if (interactionId) this._lastInteractionId = interactionId;

        const oldPos = interactionId ? this._positionById.get(interactionId) : null;

        const layout = this._layoutGraph();
        if (!layout) return;

        const { nodes, edges: links } = layout;

        if (oldPos && interactionId) {
            const anchor = nodes.find(n => n.data.id === interactionId);
            if (anchor) {
                const dx = oldPos.x - anchor.x;
                const dy = oldPos.y - anchor.y;
                for (const n of nodes) { n.x += dx; n.y += dy; }
            }
        }

        const initialFit = this._needsInitialFit;
        if (initialFit) this._needsInitialFit = false;

        const duration = initialFit ? 0 : 360;
        const transition = this._svg.transition().duration(duration).ease(d3.easeCubicOut);

        this._renderLinks(links, transition, d3);
        this._renderEdgeLabels(links, transition, d3);
        this._renderNodes(nodes, transition, d3);
        this._renderAnnotationOverlay();
        this._renderEdgeLegend(layout.edges);

        for (const n of nodes) this._positionById.set(n.data.id, { x: n.x, y: n.y });

        // Re-apply selection emphasis: _nodeClass restores the selected/active
        // CSS classes on rebuild, but the upstream opacity dimming is imperative
        // and would otherwise be lost on every re-render (background enrichment,
        // collapse/expand, theme change, deeplink restore). The enter/update
        // transitions animate opacity back to 1 over `duration`, so also re-apply
        // once they finish, not just synchronously.
        if (this._selectedNodeIds.size) {
            this._applyHighlight();
            if (duration > 0) this._scheduleHighlightReapply(duration + 40);
        }

        if (initialFit) {
            requestAnimationFrame(() => this.zoomToFit(false));
        }
    }

    _nodeShape(d) {
        if (!d || !d.data) return { type: 'circle', r: 26 };
        const style = this._nodeStyle(d.data);
        const invisible = (!style.fill || style.fill === 'none') &&
                           (!style.stroke || style.stroke === 'none');
        if (d.data._collapsed) {
            const label = d.data.subexpr || d.data.label || d.data.id || '';
            const w = Math.max(100, Math.min(260, label.length * 7 + 30));
            return { type: 'rect', hw: w / 2, hh: 24 };
        }
        if (invisible) return { type: 'rect', hw: 28, hh: 18 };

        const isOp = d.data.type === 'operator' || d.data.type === 'relation' || d.data.type === 'function';
        const fallback = isOp ? 'hexagon' : 'circle';
        const shape = style.shape || fallback;

        switch (shape) {
            case 'rect': case 'rectangle':
                return { type: 'rect', hw: 32, hh: 22 };
            case 'stadium':
                return { type: 'stadium', hw: 36, hh: 20 };
            case 'diamond':
                return { type: 'diamond', r: 32 };
            case 'octagon':
                return { type: 'polygon', r: 28 };
            case 'hexagon':
                return { type: 'polygon', r: 28 };
            case 'circle': default:
                return { type: 'circle', r: isOp ? 28 : 26 };
        }
    }

    _boundaryPoint(center, other, shape) {
        const dx = other.x - center.x;
        const dy = other.y - center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return { x: center.x, y: center.y };

        if (shape.type === 'rect' || shape.type === 'stadium') {
            const nx = dx / dist, ny = dy / dist;
            const tx = shape.hw / Math.max(Math.abs(nx), 1e-6);
            const ty = shape.hh / Math.max(Math.abs(ny), 1e-6);
            const t = Math.min(tx, ty);
            return { x: center.x + nx * t, y: center.y + ny * t };
        }
        if (shape.type === 'diamond') {
            const nx = dx / dist, ny = dy / dist;
            const t = shape.r / Math.max(Math.abs(nx) + Math.abs(ny), 1e-6);
            return { x: center.x + nx * t, y: center.y + ny * t };
        }
        const r = shape.r || 26;
        const ratio = r / dist;
        return { x: center.x + dx * ratio, y: center.y + dy * ratio };
    }

    _diagonal(d3, source, target, sourceNode, targetNode) {
        const ss = sourceNode ? this._nodeShape(sourceNode) : null;
        const ts = targetNode ? this._nodeShape(targetNode) : null;

        const s = ss ? this._boundaryPoint(source, target, ss) : source;
        const t = ts ? this._boundaryPoint(target, source, ts) : target;

        const horizontal = this._isHorizontal();
        if (horizontal) {
            const midX = (s.x + t.x) / 2;
            return `M${s.x},${s.y} C${midX},${s.y} ${midX},${t.y} ${t.x},${t.y}`;
        }
        const midY = (s.y + t.y) / 2;
        return `M${s.x},${s.y} C${s.x},${midY} ${t.x},${midY} ${t.x},${t.y}`;
    }

    _startPos(id) {
        return this._positionById.get(id) ||
            this._positionById.get(this._lastInteractionId) ||
            { x: 0, y: 0 };
    }

    _renderLinks(links, transition, d3) {
        const showArrows = this._theme?.paintBySemantic;
        const markerEnd = d => (showArrows && d.role) ? 'url(#d3sg-arrow-role)' : null;
        // Roles whose visual arrow points outward (reversed from the
        // data-model direction). Data edges always flow inward
        // (child → parent); these roles swap source/target at render
        // time so the arrow reads naturally — e.g. "derivative →wrt→ x".
        // ── Keep in sync with VISUAL_REVERSE_ROLES in
        //    scripts/graph_to_mermaid.py ──
        const VISUAL_REVERSE_ROLES = new Set([]);
        const linkPath = d => {
            if (VISUAL_REVERSE_ROLES.has(d.role)) {
                return this._diagonal(d3, d.target, d.source, d.target, d.source);
            }
            return this._diagonal(d3, d.source, d.target, d.source, d.target);
        };

        const link = this._linkLayer.selectAll('path.d3sg-link')
            .data(links, d => d.id);

        link.enter()
            .append('path')
            .attr('class', d => `d3sg-link d3sg-edge-${d.semantic}${d.role ? ` d3sg-role-${d.role}` : ''}`)
            .attr('fill', 'none')
            .attr('stroke', d => this._edgeColor(d.semantic))
            .attr('stroke-width', d => this._edgeWidth(d.semantic))
            .attr('stroke-linecap', 'round')
            .attr('marker-end', markerEnd)
            .attr('d', d => {
                const p = this._startPos(d.target.data.id);
                return this._diagonal(d3, p, p, null, null);
            })
            .style('opacity', 0)
            .transition(transition)
            .style('opacity', 1)
            .attr('d', linkPath);

        link.transition(transition)
            .attr('class', d => `d3sg-link d3sg-edge-${d.semantic}${d.role ? ` d3sg-role-${d.role}` : ''}`)
            .attr('stroke', d => this._edgeColor(d.semantic))
            .attr('stroke-width', d => this._edgeWidth(d.semantic))
            .attr('marker-end', markerEnd)
            .style('opacity', 1)
            .attr('d', linkPath);

        link.exit()
            .transition(transition)
            .style('opacity', 0)
            .attr('d', () => {
                const p = this._startPos(this._lastInteractionId);
                return this._diagonal(d3, p, p, null, null);
            })
            .remove();
    }

    _renderEdgeLabels(links, transition, d3) {
        const showSemantic = this._theme?.paintBySemantic;
        const labeled = links.filter(d =>
            (d.semantic && d.semantic !== 'neutral') || (showSemantic && d.role)
        );
        const labelText = d => {
            const parts = [];
            if (d.role) parts.push(d.role);
            if (d.semantic && d.semantic !== 'neutral') parts.push(d.semantic);
            return parts.join(' · ');
        };

        const label = this._labelLayer.selectAll('text.d3sg-edge-label')
            .data(labeled, d => d.id);

        label.enter()
            .append('text')
            .attr('class', d => `d3sg-edge-label${d.role ? ' d3sg-role-label' : ''}`)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('x', d => this._startPos(d.target.data.id).x)
            .attr('y', d => this._startPos(d.target.data.id).y)
            .style('opacity', 0)
            .text(labelText)
            .transition(transition)
            .style('opacity', 1)
            .attr('x', d => (d.source.x + d.target.x) / 2)
            .attr('y', d => (d.source.y + d.target.y) / 2 - 8);

        label.transition(transition)
            .style('opacity', 1)
            .attr('x', d => (d.source.x + d.target.x) / 2)
            .attr('y', d => (d.source.y + d.target.y) / 2 - 8)
            .text(labelText);

        label.exit().transition(transition).style('opacity', 0).remove();
    }

    _renderNodes(nodes, transition, d3) {
        const self = this;
        const node = this._nodeLayer.selectAll('g.d3sg-node')
            .data(nodes, d => d.data.id);

        const nodeEnter = node.enter()
            .append('g')
            .attr('class', d => this._nodeClass(d))
            .attr('transform', d => {
                const p = this._startPos(d.data.id);
                return `translate(${p.x},${p.y}) scale(0.85)`;
            })
            .style('opacity', 0)
            .style('cursor', d => this._isCollapsible(d) ? 'pointer' : 'default')
            .on('click', function (event, d) {
                event.stopPropagation();
                self._handleNodeClick(d, event);
            })
            .on('mouseenter', function (event, d) {
                if (self.onNodeHover) self.onNodeHover(d.data.id, d.data, this);
            })
            .on('mouseleave', function () {
                if (self.onNodeHover) self.onNodeHover(null, null, null);
            });

        nodeEnter.each(function (d) { self._drawNode(d3.select(this), d); });

        nodeEnter.transition(transition)
            .attr('transform', d => `translate(${d.x},${d.y}) scale(1)`)
            .style('opacity', 1);

        // Update
        const nodeUpdate = node.merge(nodeEnter);
        nodeUpdate.attr('class', d => this._nodeClass(d));
        nodeUpdate.each(function (d) { self._drawNode(d3.select(this), d); });
        nodeUpdate.transition(transition)
            .attr('transform', d => `translate(${d.x},${d.y}) scale(1)`)
            .style('opacity', 1);

        // Exit
        node.exit()
            .transition(transition)
            .attr('transform', () => {
                const p = this._startPos(this._lastInteractionId);
                return `translate(${p.x},${p.y}) scale(0.85)`;
            })
            .style('opacity', 0)
            .remove();
    }

    _groupKatexWords(base) {
        const text = base.textContent;
        base.innerHTML = '';
        const parts = text.split(/(\s+)/);
        for (const part of parts) {
            if (/^\s+$/.test(part)) {
                base.appendChild(document.createTextNode(' '));
            } else if (part) {
                const span = document.createElement('span');
                span.textContent = part;
                span.style.whiteSpace = 'nowrap';
                base.appendChild(span);
            }
        }
    }

    _renderAnnotationOverlay() {
        const el = this._annotationOverlay;
        if (!el) return;
        el.innerHTML = '';
        const graph = this._graph;
        if (!graph || !graph.nodes) return;
        const annotations = graph.nodes.filter(n => n.type === 'annotation');
        if (!annotations.length) return;
        const style = this._nodeStyle('annotation');
        for (const ann of annotations) {
            const card = document.createElement('div');
            card.className = 'd3sg-anno-card';
            card.style.background = style.fill || 'rgba(42,37,24,0.85)';
            card.style.borderColor = style.stroke || '#8d6e63';
            card.style.color = style.color || '#d7ccc8';
            if (style.strokeWidth) card.style.borderWidth = style.strokeWidth + 'px';
            if (style.fontSize) card.style.fontSize = style.fontSize + 'px';
            const latex = ann.latex || ann.label || '';
            const content = document.createElement('span');
            content.className = 'd3sg-anno-content';
            if (this.katex && latex) {
                try {
                    this.katex.render(latex, content, { throwOnError: false, displayMode: false });
                } catch (_) {
                    content.textContent = latex;
                }
            } else {
                content.textContent = latex;
            }
            card.appendChild(content);
            const aiBtn = makeAiAskButton('d3sg-anno-ai-btn', 'Ask AI about this annotation',
                () => 'Can you explain this annotation:\n' + latex);
            card.appendChild(aiBtn);
            el.appendChild(card);
        }
    }

    _renderEdgeLegend(layoutEdges) {
        const el = this._edgeLegend;
        if (!el) return;
        el.innerHTML = '';

        const theme = this._theme;
        const styled = theme?.edgeStyles && typeof theme.edgeStyles === 'object'
            ? theme.edgeStyles : {};

        const present = new Set();
        for (const e of layoutEdges || []) {
            if (e.semantic) present.add(e.semantic);
        }

        const rows = [];
        for (const [semantic, label] of EDGE_SEMANTIC_LABELS) {
            const s = styled[semantic];
            if (!s) continue;
            if (present.size > 0 && !present.has(semantic)) continue;
            rows.push({ semantic, label, style: s });
        }

        if (!rows.length) {
            el.classList.add('hidden');
            return;
        }

        const title = document.createElement('div');
        title.className = 'd3sg-edge-legend-title';
        title.textContent = 'Edges';
        el.appendChild(title);

        for (const row of rows) {
            const item = document.createElement('div');
            item.className = 'd3sg-edge-legend-item';

            const swatch = document.createElement('span');
            swatch.className = 'd3sg-edge-legend-swatch';
            const stroke = row.style.stroke || 'currentColor';
            const width = Number(row.style.strokeWidth || 2);
            const arrow = row.style.arrow || '-->';
            swatch.style.setProperty('--legend-stroke', stroke);
            swatch.style.setProperty('--legend-stroke-width', `${width}px`);
            swatch.dataset.arrow = arrow;
            item.appendChild(swatch);

            const lbl = document.createElement('span');
            lbl.className = 'd3sg-edge-legend-label';
            lbl.textContent = row.label;
            item.appendChild(lbl);

            el.appendChild(item);
        }
        el.classList.remove('hidden');
    }

    _nodeClass(d) {
        const kind = d.data.type;
        const isOp = kind === 'operator' || kind === 'relation' || kind === 'function';
        const base = isOp ? 'op' : 'var';
        const collapsed = d.data._collapsed ? ' collapsed' : '';
        const selected = this._selectedNodeIds.has(d.data.id) ? ' selected' : '';
        const active = d.data.id === this._activeNodeId ? ' active' : '';
        return `d3sg-node d3sg-${base}${collapsed}${selected}${active}`;
    }

    _isCollapsible(d) {
        const kind = d.data.type;
        return (kind === 'operator' || kind === 'relation' || kind === 'function') &&
            (d.data._childIds && d.data._childIds.length > 0);
    }

    _handleNodeClick(d, event) {
        const nodeId = d.data.id;
        const multiSelect = event && (event.metaKey || event.ctrlKey);

        if (multiSelect) {
            if (this._selectedNodeIds.has(nodeId)) {
                this._selectedNodeIds.delete(nodeId);
                this._activeNodeId = this._selectedNodeIds.size
                    ? [...this._selectedNodeIds].at(-1) : null;
            } else {
                this._selectedNodeIds.add(nodeId);
                this._activeNodeId = nodeId;
            }
        } else {
            if (this._selectedNodeIds.size <= 1 && this._activeNodeId === nodeId) {
                this._activeNodeId = null;
                this._selectedNodeIds.clear();
            } else {
                this._activeNodeId = nodeId;
                this._selectedNodeIds.clear();
                this._selectedNodeIds.add(nodeId);
            }
        }

        this._applyHighlight();
        if (this.onNodeClick) {
            this.onNodeClick(nodeId, d.data, new Set(this._selectedNodeIds));
        }
    }

    _handleChevronClick(d) {
        const nodeId = d.data.id;
        if (this._collapsed.has(nodeId)) {
            this._collapsed.delete(nodeId);
        } else {
            this._collapsed.add(nodeId);
        }
        this._renderGraph(nodeId);
    }

    _chevronPos(isCollapsed, shape) {
        const glyph = isCollapsed ? '+' : '−';
        const sz = 14, half = sz / 2;
        const dir = this.direction;
        if (shape.type === 'rect' || shape.type === 'stadium') {
            if (dir === 'left-right')  return { glyph, x: shape.hw - half, y: -half };
            if (dir === 'right-left')  return { glyph, x: -shape.hw - half, y: -half };
            if (dir === 'bottom-up')   return { glyph, x: -half, y: -shape.hh - half };
            return { glyph, x: -half, y: shape.hh - half };
        }
        const r = shape.r || 26;
        if (dir === 'left-right')  return { glyph, x: r - half, y: -half };
        if (dir === 'right-left')  return { glyph, x: -r - half, y: -half };
        if (dir === 'bottom-up')   return { glyph, x: -half, y: -r - half };
        return { glyph, x: -half, y: r - half };
    }

    _appendChevron(group, d, isCollapsed) {
        const shape = this._nodeShape(d);
        const cp = this._chevronPos(isCollapsed, shape);
        const self = this;
        const sz = 14;
        const g = group.append('g')
            .attr('class', 'd3sg-chevron')
            .attr('transform', `translate(${cp.x},${cp.y})`)
            .on('click', function (event) {
                event.stopPropagation();
                self._handleChevronClick(d);
            });
        g.append('rect')
            .attr('x', 0).attr('y', 0)
            .attr('width', sz).attr('height', sz)
            .attr('rx', 2)
            .attr('fill', '#1a2440')
            .attr('stroke', '#a8c5ff')
            .attr('stroke-width', 1);
        g.append('text')
            .attr('x', sz / 2).attr('y', sz / 2 + 1)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', '11px')
            .attr('fill', '#a8c5ff')
            .text(cp.glyph);
        return g;
    }

    _chartBtnPos(shape) {
        const sz = 14, half = sz / 2;
        const dir = this.direction;
        if (shape.type === 'rect' || shape.type === 'stadium') {
            if (dir === 'left-right')  return { x: -shape.hw - half, y: -half };
            if (dir === 'right-left')  return { x: shape.hw - half, y: -half };
            if (dir === 'bottom-up')   return { x: -half, y: shape.hh - half };
            return { x: -half, y: -shape.hh - half };
        }
        const r = shape.r || 26;
        if (dir === 'left-right')  return { x: -r - half, y: -half };
        if (dir === 'right-left')  return { x: r - half, y: -half };
        if (dir === 'bottom-up')   return { x: -half, y: r - half };
        return { x: -half, y: -r - half };
    }

    _appendChartBtn(group, d) {
        const shape = this._nodeShape(d);
        const pos = this._chartBtnPos(shape);
        const self = this;
        const sz = 14;
        const g = group.append('g')
            .attr('class', 'd3sg-chart-btn')
            .attr('transform', `translate(${pos.x},${pos.y})`)
            .on('click', function (event) {
                event.stopPropagation();
                if (self.onChartClick) self.onChartClick(d.data.id, d.data, this);
            });
        g.append('rect')
            .attr('x', 0).attr('y', 0)
            .attr('width', sz).attr('height', sz)
            .attr('rx', 2)
            .attr('fill', '#1a2440')
            .attr('stroke', '#42a5f5')
            .attr('stroke-width', 1);
        g.append('path')
            .attr('d', `M3,${sz-3} L5,5 L8,8 L${sz-3},3`)
            .attr('fill', 'none')
            .attr('stroke', '#42a5f5')
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');
        return g;
    }

    _drawNode(group, d) {
        group.selectAll('*').remove();
        const data = d.data;
        const isOp = data.type === 'operator' || data.type === 'relation' || data.type === 'function';
        const style = this._nodeStyle(data);

        const invisible = (!style.fill || style.fill === 'none') &&
                           (!style.stroke || style.stroke === 'none');

        if (data._collapsed) {
            const label = data.subexpr || data.label || data.id;
            const estimatedWidth = Math.max(100, Math.min(260, label.length * 7 + 30));
            const tile = group.append('rect')
                .attr('class', invisible ? 'd3sg-hit-target' : 'd3sg-tile-bg')
                .attr('x', -estimatedWidth / 2)
                .attr('y', -24)
                .attr('width', estimatedWidth)
                .attr('height', 48)
                .attr('rx', 6);
            if (invisible) {
                tile.style('fill', 'transparent').style('stroke', 'none');
            } else {
                tile.attr('fill', style.fill || '').attr('stroke', style.stroke || '');
            }

            const measured = this._renderLabel(group, data, estimatedWidth, true, style);

            // Resize tile to fit measured KaTeX content.
            if (measured) {
                const padX = 24, padY = 16;
                const tileW = Math.max(estimatedWidth, measured.width + padX);
                const tileH = Math.max(48, measured.height + padY);
                tile.attr('x', -tileW / 2)
                    .attr('width', tileW)
                    .attr('y', -tileH / 2)
                    .attr('height', tileH);
            }

            this._appendChevron(group, d, true);
            if (data.subexpr || data.chartScript) this._appendChartBtn(group, d);
            return;
        }

        let labelWidth = 52;

        if (invisible) {
            const bw = 56, bh = 36;
            group.append('rect')
                .attr('class', 'd3sg-hit-target')
                .attr('x', -bw / 2)
                .attr('y', -bh / 2)
                .attr('width', bw)
                .attr('height', bh)
                .attr('rx', 4)
                .style('fill', 'transparent')
                .style('stroke', 'none');
            labelWidth = 56;
        } else {
            const shapeName = style.shape || (isOp ? 'hexagon' : 'circle');
            this._drawShape(group, shapeName, style, isOp);
            labelWidth = (shapeName === 'rect' || shapeName === 'rectangle') ? 60
                       : shapeName === 'stadium' ? 68
                       : 56;
        }

        this._renderLabel(group, data, labelWidth, false, style);

        if (isOp && data._childIds && data._childIds.length > 0) {
            this._appendChevron(group, d, false);
        }
        if (data.subexpr || data.chartScript) {
            this._appendChartBtn(group, d);
        }
    }

    _drawShape(group, shapeName, style, isOp) {
        const fill = style.fill || '';
        const stroke = style.stroke || '';
        const cls = isOp ? 'd3sg-op-bg' : 'd3sg-var-bg';

        switch (shapeName) {
            case 'hexagon': {
                const r = 28;
                const pts = Array.from({ length: 6 }, (_, i) => {
                    const a = (Math.PI / 3) * i - Math.PI / 6;
                    return `${r * Math.cos(a)},${r * Math.sin(a)}`;
                }).join(' ');
                group.append('polygon').attr('class', cls)
                    .attr('points', pts).attr('fill', fill).attr('stroke', stroke);
                break;
            }
            case 'octagon': {
                const r = 28;
                const pts = Array.from({ length: 8 }, (_, i) => {
                    const a = (Math.PI / 4) * i - Math.PI / 8;
                    return `${r * Math.cos(a)},${r * Math.sin(a)}`;
                }).join(' ');
                group.append('polygon').attr('class', cls)
                    .attr('points', pts).attr('fill', fill).attr('stroke', stroke);
                break;
            }
            case 'diamond': {
                const r = 32;
                const pts = `0,${-r} ${r},0 0,${r} ${-r},0`;
                group.append('polygon').attr('class', cls)
                    .attr('points', pts).attr('fill', fill).attr('stroke', stroke);
                break;
            }
            case 'rect': case 'rectangle': {
                const hw = 32, hh = 22;
                group.append('rect').attr('class', cls)
                    .attr('x', -hw).attr('y', -hh)
                    .attr('width', hw * 2).attr('height', hh * 2)
                    .attr('rx', 4)
                    .attr('fill', fill).attr('stroke', stroke);
                break;
            }
            case 'stadium': {
                const hw = 36, hh = 20;
                group.append('rect').attr('class', cls)
                    .attr('x', -hw).attr('y', -hh)
                    .attr('width', hw * 2).attr('height', hh * 2)
                    .attr('rx', hh)
                    .attr('fill', fill).attr('stroke', stroke);
                break;
            }
            case 'circle': default: {
                const r = isOp ? 28 : 26;
                group.append('circle').attr('class', cls)
                    .attr('r', r).attr('fill', fill).attr('stroke', stroke);
                break;
            }
        }
    }

    _operatorLatex(data) {
        const op = data.op;
        if (!op) return `\\text{${data.id || '?'}}`;
        if (OPERATOR_LATEX[op]) return OPERATOR_LATEX[op];
        if (op === 'power') {
            const exp = data.exponent;
            if (exp != null && String(exp) === '-1') return `\\dfrac{1}{(\\cdot)}`;
            return exp ? `(\\cdot)^{${exp}}` : `(\\cdot)^{\\cdot}`;
        }
        if (op === 'derivative' || op === 'partial_derivative') {
            const d = op === 'partial_derivative' ? '\\partial' : 'd';
            const wrt = data.with_respect_to;
            if (wrt && (!data._childIds || data._childIds.length <= 1))
                return `\\frac{${d}}{${d}${wrt}}`;
            return `\\frac{${d}}{${d}\\cdot}`;
        }
        if (op === 'integral' || op === 'closed_integral') {
            const cmd = OPERATOR_LATEX[op];
            const wrt = data.with_respect_to;
            const lb = data._lowerBoundLabel || '';   // resolved bound values
            const ub = data._upperBoundLabel || '';   // (not raw bound node ids)
            // The differential (``dx``) is its own child node, reached by the
            // ``wrt`` edge — keep the sign glyph bare (``∫`` / ``∫_a^b``) so the
            // variable isn't duplicated, mirroring the derivative ``d/d·``
            // placeholder. Only graphs without a differential node fall back to
            // embedding ``d{wrt}``.
            const diff = (!data._hasDifferentialChild && wrt) ? ` d${wrt}` : '';
            if (lb && ub) return `${cmd}_{${lb}}^{${ub}}${diff}`;
            return `${cmd}${diff}`;
        }
        if (op === 'sum' || op === 'product') {
            const cmd = OPERATOR_LATEX[op];
            const wrt = data.with_respect_to;
            if (wrt) return `${cmd}_{${wrt}}`;
            return cmd;
        }
        return `\\text{${op.replace(/\\/g, '\\\\').replace(/_/g, '\\_')}}`;
    }

    /**
     * Render a node label via KaTeX (or plain text fallback).
     *
     * Returns ``{width, height}`` of the measured KaTeX content so the
     * caller can resize the background shape to fit, or ``null`` when the
     * plain-text fallback was used.
     */
    _renderLabel(group, data, maxWidth, isCollapsed, style = {}) {
        let latex = isCollapsed
            ? (data.subexpr || data.latex || null)
            : (data.latex || null);
        const textColor = style.color || null;
        const isOp = OP_KINDS.has(data.type);

        // Operator/function nodes always render via KaTeX for consistent
        // color handling.  Use OPERATOR_LATEX for proper LaTeX commands;
        // generate dynamic LaTeX for power/derivative; fall back to the
        // plain op name wrapped in \text{} only as a last resort.
        if (!latex && isOp && this.katex) {
            latex = this._operatorLatex(data);
        }

        if (latex && data.type === 'function' && !isCollapsed
            && !latex.includes('\\cdot') && !latex.includes('·')) {
            const arity = (data._childIds || []).length || 1;
            const dots = _arityDots(arity, data._hasConditionEdge, data._hasAssertionEdge, '\\cdot');
            latex = `${latex}(${dots})`;
        }

        if (latex && this.katex) {
            const span = document.createElement('span');
            let ok = false;
            try {
                this.katex.render('\\displaystyle ' + latex, span, { throwOnError: false, displayMode: false });
                ok = true;
            } catch (_) { /* fallback below */ }

            // Measure the rendered content offscreen so we can size the
            // foreignObject (and the caller's background shape) to fit.
            let measuredW = maxWidth, measuredH = 28;
            if (ok) {
                span.style.position = 'absolute';
                span.style.visibility = 'hidden';
                span.style.whiteSpace = 'nowrap';
                document.body.appendChild(span);
                const bbox = span.getBoundingClientRect();
                measuredW = bbox.width;
                measuredH = bbox.height;
                document.body.removeChild(span);
                span.style.position = '';
                span.style.visibility = '';
                span.style.whiteSpace = '';
            }

            const foW = Math.max(maxWidth, measuredW + 8);
            const foH = Math.max(28, measuredH + 4);

            const fo = group.append('foreignObject')
                .attr('x', -foW / 2)
                .attr('y', -foH / 2)
                .attr('width', foW)
                .attr('height', foH)
                .attr('class', 'd3sg-label-fo');

            const div = fo.append('xhtml:div')
                .attr('class', 'd3sg-katex-host')
                .style('display', 'flex')
                .style('justify-content', 'center')
                .style('align-items', 'center')
                .style('width', '100%')
                .style('height', '100%');
            if (textColor) div.style('color', textColor);

            if (ok) {
                if (data.emoji && !isOp) {
                    const emojiSpan = document.createElement('span');
                    emojiSpan.textContent = data.emoji;
                    emojiSpan.style.marginRight = '4px';
                    div.node().appendChild(emojiSpan);
                }
                div.node().appendChild(span);
                return { width: measuredW, height: measuredH };
            } else {
                div.text(data.label || data.id);
                return null;
            }
        } else {
            const text = getNodeLabel(data, this.labels);
            const label = group.append('text')
                .attr('class', 'd3sg-label')
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'middle')
                .attr('font-size', isCollapsed ? '14px' : '17px')
                .text(text);
            if (textColor) label.attr('fill', textColor);
            return null;
        }
    }

    _applyHighlight() {
        if (!this._svg) return;

        this._nodeLayer.selectAll('g.d3sg-node')
            .attr('class', d => this._nodeClass(d));

        if (!this._selectedNodeIds.size) {
            this._nodeLayer.selectAll('g.d3sg-node').style('opacity', 1);
            this._linkLayer.selectAll('path.d3sg-link').style('opacity', 1);
            this._labelLayer.selectAll('text.d3sg-edge-label').style('opacity', 1);
            return;
        }

        const upstream = new Set();
        for (const id of this._selectedNodeIds) {
            for (const n of this._getUpstream(id)) upstream.add(n);
        }

        this._nodeLayer.selectAll('g.d3sg-node').style('opacity', d =>
            upstream.has(d.data.id) ? 1 : 0.30
        );

        this._linkLayer.selectAll('path.d3sg-link').style('opacity', d =>
            upstream.has(d.source.data.id) && upstream.has(d.target.data.id) ? 1 : 0.25
        );

        this._labelLayer.selectAll('text.d3sg-edge-label').style('opacity', d =>
            upstream.has(d.source.data.id) && upstream.has(d.target.data.id) ? 1 : 0.25
        );
    }

    _getUpstream(nodeId) {
        // In our tree, "upstream" = the node itself plus all its descendants
        // (since edges point from leaves to root, upstream means the subtree
        // that feeds into this node).
        const visited = new Set();
        const edges = this._graph.edges || [];
        const queue = [nodeId];
        while (queue.length) {
            const cur = queue.shift();
            if (visited.has(cur)) continue;
            visited.add(cur);
            for (const e of edges) {
                if (e.to === cur && !visited.has(e.from)) queue.push(e.from);
            }
        }
        return visited;
    }
}
