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

const DEFAULT_EDGE_WIDTHS = {
    direct: 2.5,
    inverse: 1.8,
    neutral: 1.4,
};

// Default node styles (fallback when theme has no nodeStyles)
const DEFAULT_NODE_STYLES = {
    scalar:   { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
    vector:   { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
    constant: { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
    number:   { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
    operator: { fill: '#0f2540', stroke: '#42a5f5', color: '#bbdefb' },
    function: { fill: '#0f2540', stroke: '#42a5f5', color: '#bbdefb' },
    relation: { fill: '#2e1b33', stroke: '#ab47bc', color: '#e1bee7' },
    expression: { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
    text:     { fill: '#1b3a1e', stroke: '#66bb6a', color: '#c8e6c9' },
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

/**
 * Get the display label for a node, respecting label detail level.
 * @param {Object} node
 * @param {'minimal'|'description'|'full'} labelMode
 */
function getNodeLabel(node, labelMode) {
    if (node.type === 'operator' || node.type === 'relation' || node.type === 'function') {
        return operatorGlyph(node);
    }
    const base = (labelMode === 'minimal')
        ? (node.emoji || node.latex || node.label || node.id)
        : (node.latex || node.label || node.id);
    if (node.emoji && base !== node.emoji) return node.emoji + ' ' + base;
    return base;
}

function operatorGlyph(node) {
    const glyphs = {
        equals: '=', multiply: '×', add: '+', subtract: '−',
        divide: '÷', integral: '∫',
        implies: '⇒', iff: '⇔', negate: '¬', conjunction: '∧',
        disjunction: '∨', sum: '∑', product: '∏', limit: 'lim',
        factorial: '!', sqrt: '√(·)', log: 'log', logarithm: 'log',
        exp: 'exp', sin: 'sin', cos: 'cos', tan: 'tan',
        Abs: '|·|', abs: '|·|', function: 'f',
    };
    if (node.op === 'derivative') {
        if (node.with_respect_to && (!node._childIds || node._childIds.length <= 1))
            return `d·/d${node.with_respect_to}`;
        return 'd·/d·';
    }
    if (node.op === 'power') {
        const exp = node.exponent || 'n';
        return `(·)${toSuperscript(exp)}`;
    }
    return glyphs[node.op] || node.op || node.label || '?';
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

        this._graph = null;
        this._theme = null;
        this._collapsed = new Set();
        this._svg = null;
        this._d3 = null;
        this._dagre = null;
        this._positionById = new Map();
        this._lastInteractionId = null;
        this._activeNodeId = null;
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
        this._applyHighlight();
    }

    clearSelection() {
        this._activeNodeId = null;
        this._applyHighlight();
    }

    get activeNode() {
        return this._activeNodeId;
    }

    saveState() {
        return {
            collapsed: new Set(this._collapsed),
            activeNodeId: this._activeNodeId,
            positionById: new Map(this._positionById),
        };
    }

    restoreState(snapshot) {
        if (!snapshot) return;
        this._collapsed = new Set(snapshot.collapsed);
        this._activeNodeId = snapshot.activeNodeId;
        this._positionById = new Map(snapshot.positionById);
        if (this._svg) this._applyHighlight();
    }

    destroy() {
        this._destroyed = true;
        this.container.innerHTML = '';
        this._svg = null;
        this._graph = null;
        this._positionById.clear();
    }

    // ─── Theme helpers ─────────────────────────────────────────────────

    _nodeStyle(nodeType) {
        const ts = this._theme?.nodeStyles;
        if (ts && ts[nodeType]) return ts[nodeType];
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
        this.container.appendChild(card);

        this._svg = d3.select(card)
            .append('svg')
            .attr('class', 'd3-semantic-graph')
            .attr('width', '100%')
            .attr('height', '100%')
            .attr('preserveAspectRatio', 'xMidYMid meet');

        this._linkLayer = this._svg.append('g').attr('class', 'd3sg-links');
        this._labelLayer = this._svg.append('g').attr('class', 'd3sg-edge-labels');
        this._nodeLayer = this._svg.append('g').attr('class', 'd3sg-nodes');

        // Background click
        this._svg.on('click', (event) => {
            if (event.target === this._svg.node() || event.target.tagName === 'svg') {
                this._activeNodeId = null;
                this._applyHighlight();
                if (this.onBackgroundClick) this.onBackgroundClick();
            }
        });
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
        for (const e of edges) {
            if (!childrenOf[e.to]) childrenOf[e.to] = [];
            childrenOf[e.to].push(e.from);
        }

        // BFS from roots to find visible nodes (stop at collapsed)
        const hasOutgoing = new Set(edges.map(e => e.from));
        const roots = nodes.filter(n => !hasOutgoing.has(n.id));

        const visible = new Set();
        const queue = roots.map(r => r.id);
        while (queue.length) {
            const id = queue.shift();
            if (visible.has(id)) continue;
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

        const nodeWrappers = Object.create(null);
        const layoutNodes = [];
        for (const id of g.nodes()) {
            const pos = g.node(id);
            const wrapper = {
                data: {
                    ...nodeById[id],
                    _collapsed: this._collapsed.has(id),
                    _childIds: childrenOf[id] || [],
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

        const xs = nodes.map(n => n.x);
        const ys = nodes.map(n => n.y);
        const minX = Math.min(...xs) - 100;
        const maxX = Math.max(...xs) + 100;
        const minY = Math.min(...ys) - 60;
        const maxY = Math.max(...ys) + 60;
        const width = Math.max(maxX - minX, 300);
        const height = Math.max(maxY - minY, 200);

        this._svg.attr('viewBox', `${minX} ${minY} ${width} ${height}`);

        const duration = 360;
        const transition = this._svg.transition().duration(duration).ease(d3.easeCubicOut);

        this._renderLinks(links, transition, d3);
        this._renderEdgeLabels(links, transition, d3);
        this._renderNodes(nodes, transition, d3);

        for (const n of nodes) this._positionById.set(n.data.id, { x: n.x, y: n.y });
    }

    _nodeShape(d) {
        if (!d || !d.data) return { type: 'circle', r: 26 };
        const style = this._nodeStyle(d.data.type);
        const invisible = (!style.fill || style.fill === 'none') &&
                           (!style.stroke || style.stroke === 'none');
        if (d.data._collapsed) {
            const label = d.data.subexpr || d.data.label || d.data.id || '';
            const w = Math.max(100, Math.min(260, label.length * 7 + 30));
            return { type: 'rect', hw: w / 2, hh: 24 };
        }
        if (invisible) return { type: 'rect', hw: 28, hh: 18 };
        const kind = d.data.type;
        if (kind === 'operator' || kind === 'relation' || kind === 'function') return { type: 'circle', r: 28 };
        return { type: 'circle', r: 26 };
    }

    _boundaryPoint(center, other, shape) {
        const dx = other.x - center.x;
        const dy = other.y - center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return { x: center.x, y: center.y };

        if (shape.type === 'rect') {
            const nx = dx / dist, ny = dy / dist;
            const tx = shape.hw / Math.max(Math.abs(nx), 1e-6);
            const ty = shape.hh / Math.max(Math.abs(ny), 1e-6);
            const t = Math.min(tx, ty);
            return { x: center.x + nx * t, y: center.y + ny * t };
        }
        const ratio = shape.r / dist;
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
        const link = this._linkLayer.selectAll('path.d3sg-link')
            .data(links, d => d.id);

        link.enter()
            .append('path')
            .attr('class', d => `d3sg-link d3sg-edge-${d.semantic}`)
            .attr('fill', 'none')
            .attr('stroke', d => this._edgeColor(d.semantic))
            .attr('stroke-width', d => this._edgeWidth(d.semantic))
            .attr('stroke-linecap', 'round')
            .attr('d', d => {
                const p = this._startPos(d.target.data.id);
                return this._diagonal(d3, p, p, null, null);
            })
            .style('opacity', 0)
            .transition(transition)
            .style('opacity', 1)
            .attr('d', d => this._diagonal(d3, d.source, d.target, d.source, d.target));

        link.transition(transition)
            .attr('class', d => `d3sg-link d3sg-edge-${d.semantic}`)
            .attr('stroke', d => this._edgeColor(d.semantic))
            .attr('stroke-width', d => this._edgeWidth(d.semantic))
            .style('opacity', 1)
            .attr('d', d => this._diagonal(d3, d.source, d.target, d.source, d.target));

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
        const labeled = links.filter(d => d.semantic && d.semantic !== 'neutral');

        const label = this._labelLayer.selectAll('text.d3sg-edge-label')
            .data(labeled, d => d.id);

        label.enter()
            .append('text')
            .attr('class', 'd3sg-edge-label')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('x', d => this._startPos(d.target.data.id).x)
            .attr('y', d => this._startPos(d.target.data.id).y)
            .style('opacity', 0)
            .text(d => d.semantic)
            .transition(transition)
            .style('opacity', 1)
            .attr('x', d => (d.source.x + d.target.x) / 2)
            .attr('y', d => (d.source.y + d.target.y) / 2 - 8);

        label.transition(transition)
            .style('opacity', 1)
            .attr('x', d => (d.source.x + d.target.x) / 2)
            .attr('y', d => (d.source.y + d.target.y) / 2 - 8)
            .text(d => d.semantic);

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
                self._handleNodeClick(d);
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

    _nodeClass(d) {
        const kind = d.data.type;
        const isOp = kind === 'operator' || kind === 'relation' || kind === 'function';
        const base = isOp ? 'op' : 'var';
        const collapsed = d.data._collapsed ? ' collapsed' : '';
        const active = d.data.id === this._activeNodeId ? ' active' : '';
        return `d3sg-node d3sg-${base}${collapsed}${active}`;
    }

    _isCollapsible(d) {
        const kind = d.data.type;
        return (kind === 'operator' || kind === 'relation' || kind === 'function') &&
            (d.data._childIds && d.data._childIds.length > 0);
    }

    _handleNodeClick(d) {
        const nodeId = d.data.id;
        if (this._activeNodeId === nodeId) {
            this._activeNodeId = null;
        } else {
            this._activeNodeId = nodeId;
        }
        this._applyHighlight();
        if (this.onNodeClick) this.onNodeClick(nodeId, d.data);
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
        if (shape.type === 'rect') {
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

    _drawNode(group, d) {
        group.selectAll('*').remove();
        const data = d.data;
        const isOp = data.type === 'operator' || data.type === 'relation' || data.type === 'function';
        const style = this._nodeStyle(data.type);

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

            this._renderLabel(group, data, estimatedWidth, true, style);

            this._appendChevron(group, d, true);
            return;
        }

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
        } else if (isOp) {
            const r = 28;
            const points = Array.from({ length: 6 }, (_, i) => {
                const angle = (Math.PI / 3) * i - Math.PI / 6;
                return `${r * Math.cos(angle)},${r * Math.sin(angle)}`;
            }).join(' ');
            group.append('polygon')
                .attr('class', 'd3sg-op-bg')
                .attr('points', points)
                .attr('fill', style.fill || '')
                .attr('stroke', style.stroke || '');
        } else {
            group.append('circle')
                .attr('class', 'd3sg-var-bg')
                .attr('r', 26)
                .attr('fill', style.fill || '')
                .attr('stroke', style.stroke || '');
        }

        this._renderLabel(group, data, invisible ? 56 : (isOp ? 56 : 52), false, style);

        if (isOp && data._childIds && data._childIds.length > 0) {
            this._appendChevron(group, d, false);
        }
    }

    _renderLabel(group, data, maxWidth, isCollapsed, style = {}) {
        const latex = isCollapsed
            ? (data.subexpr || data.latex || null)
            : (data.latex || null);
        const textColor = style.color || null;

        if (latex && this.katex) {
            const fo = group.append('foreignObject')
                .attr('x', -maxWidth / 2)
                .attr('y', -14)
                .attr('width', maxWidth)
                .attr('height', 28)
                .attr('class', 'd3sg-label-fo');

            const div = fo.append('xhtml:div')
                .attr('class', 'd3sg-katex-host')
                .style('display', 'flex')
                .style('justify-content', 'center')
                .style('align-items', 'center')
                .style('width', '100%')
                .style('height', '100%')
                .style('overflow', 'hidden');
            if (textColor) div.style('color', textColor);

            const span = document.createElement('span');
            try {
                this.katex.render(latex, span, { throwOnError: false, displayMode: false });
                if (data.emoji) {
                    const emojiSpan = document.createElement('span');
                    emojiSpan.textContent = data.emoji;
                    emojiSpan.style.marginRight = '4px';
                    div.node().appendChild(emojiSpan);
                }
                div.node().appendChild(span);
            } catch (_) {
                div.text(data.label || data.id);
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
        }
    }

    _applyHighlight() {
        if (!this._svg) return;
        const activeId = this._activeNodeId;

        if (!activeId) {
            // Clear all dimming
            this._nodeLayer.selectAll('g.d3sg-node').style('opacity', 1);
            this._linkLayer.selectAll('path.d3sg-link').style('opacity', 1);
            this._labelLayer.selectAll('text.d3sg-edge-label').style('opacity', 1);
            return;
        }

        // Find upstream nodes from active
        const upstream = this._getUpstream(activeId);

        this._nodeLayer.selectAll('g.d3sg-node').style('opacity', d =>
            upstream.has(d.data.id) ? 1 : 0.15
        );

        this._linkLayer.selectAll('path.d3sg-link').style('opacity', d =>
            upstream.has(d.source.data.id) && upstream.has(d.target.data.id) ? 1 : 0.1
        );

        this._labelLayer.selectAll('text.d3sg-edge-label').style('opacity', d =>
            upstream.has(d.source.data.id) && upstream.has(d.target.data.id) ? 1 : 0.1
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
