/**
 * D3SemanticGraphRenderer — renders a semantic graph model directly with D3.
 *
 * Consumes the flat {nodes, edges} semantic graph model and converts it to a
 * tree for layout. Renders with D3 keyed joins (enter/update/exit), supporting
 * collapse/expand, KaTeX labels via foreignObject, and edge-semantic coloring.
 *
 * This renderer does NOT touch the Mermaid path — it exists as an alternative.
 */

const D3_CDN_URL = 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

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

/**
 * Convert flat {nodes, edges} to a rooted tree for d3.hierarchy.
 * Finds the root (node with no incoming edges, or the first relation/equals
 * operator), then builds children arrays by following edges.
 */
function graphToTree(graph) {
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    if (!nodes.length) return null;

    const nodeById = Object.create(null);
    for (const n of nodes) nodeById[n.id] = { ...n, children: [] };

    // Edges flow from operands → operator (leaf → root), so the root is the
    // node that never appears as an edge source (no outgoing edges).
    const hasOutgoing = new Set();
    for (const e of edges) hasOutgoing.add(e.from);

    let rootId = null;
    const candidates = nodes.filter(n => !hasOutgoing.has(n.id));
    if (candidates.length) {
        const relNode = candidates.find(n =>
            n.type === 'relation' || n.op === 'equals' || n.op === 'implies' || n.op === 'iff');
        rootId = relNode ? relNode.id : candidates[0].id;
    } else {
        const eq = nodes.find(n => n.op === 'equals');
        rootId = eq ? eq.id : nodes[0].id;
    }

    // Build parent→child from edges (from→to means "from" is child of "to"
    // in our model: edges point from operands toward the operator/root).
    // So the children of a node are those that have edges pointing TO that node.
    const childrenOf = Object.create(null);
    const edgeSemanticMap = Object.create(null);
    for (const e of edges) {
        if (!childrenOf[e.to]) childrenOf[e.to] = [];
        childrenOf[e.to].push(e.from);
        edgeSemanticMap[`${e.from}->${e.to}`] = inferEdgeSemantic(e, nodeById);
    }

    const visited = new Set();
    function buildTree(id) {
        if (visited.has(id)) return null;
        visited.add(id);
        const node = nodeById[id];
        if (!node) return null;
        const treeNode = { ...node, children: [], _edgeSemantic: null };
        const kids = childrenOf[id] || [];
        for (const kid of kids) {
            const child = buildTree(kid);
            if (child) {
                child._edgeSemantic = edgeSemanticMap[`${kid}->${id}`] || 'neutral';
                treeNode.children.push(child);
            }
        }
        return treeNode;
    }

    return buildTree(rootId);
}

/**
 * Get the display label for a node, respecting label detail level.
 * @param {Object} node
 * @param {'minimal'|'description'|'full'} labelMode
 */
function getNodeLabel(node, labelMode) {
    if (node.type === 'operator' || node.type === 'relation' || node.type === 'function') {
        const glyph = operatorGlyph(node);
        if (labelMode === 'minimal') return glyph;
        if (node.description && labelMode !== 'minimal') return glyph;
        return glyph;
    }
    if (labelMode === 'minimal') {
        return node.emoji || node.latex || node.label || node.id;
    }
    return node.latex || node.label || node.id;
}

function operatorGlyph(node) {
    const glyphs = {
        equals: '=', multiply: '×', add: '+', subtract: '−',
        divide: '÷', power: '^', derivative: 'd/d', integral: '∫',
        implies: '⇒', iff: '⇔', negate: '¬', conjunction: '∧',
        disjunction: '∨', sum: '∑', product: '∏', limit: 'lim',
        factorial: '!', sqrt: '√', logarithm: 'log', function: 'f',
    };
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
     * @param {Function} [opts.onNodeHover] — callback(nodeId|null, nodeData|null, event)
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
        this._tree = null;
        this._theme = null;
        this._collapsed = new Set();
        this._svg = null;
        this._d3 = null;
        this._positionById = new Map();
        this._lastInteractionId = null;
        this._activeNodeId = null;
        this._destroyed = false;
    }

    async render(graph) {
        if (this._destroyed) return;
        this._graph = graph;
        this._d3 = await loadD3();
        if (this._destroyed) return;
        this._theme = await fetchTheme(this.themeName);
        if (this._destroyed) return;

        this._tree = graphToTree(graph);
        if (!this._tree) {
            this.container.innerHTML = '<div style="color:#7e8aa3;padding:2rem;text-align:center;">No renderable tree structure.</div>';
            return;
        }
        this._lastInteractionId = this._tree.id;
        this._setupSvg();
        this._renderTree();
    }

    async update(opts = {}) {
        if (opts.direction) this.direction = opts.direction;
        if (opts.labels) this.labels = opts.labels;
        if (opts.theme && opts.theme !== this.themeName) {
            this.themeName = opts.theme;
            this._theme = await fetchTheme(this.themeName);
        }
        if (this._d3 && this._tree) {
            this._renderTree();
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

    destroy() {
        this._destroyed = true;
        this.container.innerHTML = '';
        this._svg = null;
        this._graph = null;
        this._tree = null;
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

    _cloneVisible(node) {
        const isCollapsed = this._collapsed.has(node.id);
        return {
            ...node,
            _collapsed: isCollapsed,
            children: isCollapsed ? [] : (node.children || []).map(c => this._cloneVisible(c)),
        };
    }

    _isHorizontal() {
        return this.direction === 'left-right' || this.direction === 'right-left';
    }

    _isReversed() {
        return this.direction === 'right-left' || this.direction === 'bottom-up';
    }

    _renderTree(interactionId) {
        const d3 = this._d3;
        if (interactionId) this._lastInteractionId = interactionId;

        const visibleRoot = this._cloneVisible(this._tree);
        const root = d3.hierarchy(visibleRoot);

        const horizontal = this._isHorizontal();
        const nodeSpacing = horizontal ? [80, 180] : [160, 100];
        const layout = d3.tree()
            .nodeSize(nodeSpacing)
            .separation((a, b) => a.parent === b.parent ? 1 : 1.15);
        layout(root);

        const nodes = root.descendants();
        const links = root.links().map(link => ({
            ...link,
            id: `${link.source.data.id}--${link.target.data.id}`,
            semantic: link.target.data._edgeSemantic || 'neutral',
        }));

        // Flip axes for horizontal layout and compute bounding box
        if (horizontal) {
            for (const n of nodes) { const tmp = n.x; n.x = n.y; n.y = tmp; }
        }

        // Center the graph within a viewBox
        const xs = nodes.map(n => n.x);
        const ys = nodes.map(n => n.y);
        const minX = Math.min(...xs) - 100;
        const maxX = Math.max(...xs) + 100;
        const minY = Math.min(...ys) - 60;
        const maxY = Math.max(...ys) + 60;
        const width = Math.max(maxX - minX, 300);
        const height = Math.max(maxY - minY, 200);

        if (this._isReversed()) {
            const midX = (minX + maxX) / 2;
            for (const n of nodes) n.x = midX - (n.x - midX);
        }

        this._svg.attr('viewBox', `${minX} ${minY} ${width} ${height}`);

        const duration = 360;
        const transition = this._svg.transition().duration(duration).ease(d3.easeCubicOut);

        this._renderLinks(links, transition, d3);
        this._renderEdgeLabels(links, transition, d3);
        this._renderNodes(nodes, transition, d3);

        // Store positions for enter/exit animations
        for (const n of nodes) this._positionById.set(n.data.id, { x: n.x, y: n.y });
    }

    _diagonal(d3, source, target) {
        const horizontal = this._isHorizontal();
        if (horizontal) {
            const midX = (source.x + target.x) / 2;
            return `M${source.x},${source.y} C${midX},${source.y} ${midX},${target.y} ${target.x},${target.y}`;
        }
        const midY = (source.y + target.y) / 2;
        return `M${source.x},${source.y} C${source.x},${midY} ${target.x},${midY} ${target.x},${target.y}`;
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
                return this._diagonal(d3, p, p);
            })
            .style('opacity', 0)
            .transition(transition)
            .style('opacity', 1)
            .attr('d', d => this._diagonal(d3, d.source, d.target));

        link.transition(transition)
            .attr('class', d => `d3sg-link d3sg-edge-${d.semantic}`)
            .attr('stroke', d => this._edgeColor(d.semantic))
            .attr('stroke-width', d => this._edgeWidth(d.semantic))
            .style('opacity', 1)
            .attr('d', d => this._diagonal(d3, d.source, d.target));

        link.exit()
            .transition(transition)
            .style('opacity', 0)
            .attr('d', () => {
                const p = this._startPos(this._lastInteractionId);
                return this._diagonal(d3, p, p);
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
                if (self.onNodeHover) self.onNodeHover(d.data.id, d.data, event);
            })
            .on('mouseleave', function (event) {
                if (self.onNodeHover) self.onNodeHover(null, null, event);
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
            (d.data.children && d.data.children.length > 0);
    }

    _handleNodeClick(d) {
        const nodeId = d.data.id;

        // Toggle collapse for operator nodes
        if (this._isCollapsible(d) || d.data._collapsed) {
            if (this._collapsed.has(nodeId)) {
                this._collapsed.delete(nodeId);
            } else {
                this._collapsed.add(nodeId);
            }
            this._renderTree(nodeId);
        }

        // Selection
        if (this._activeNodeId === nodeId) {
            this._activeNodeId = null;
        } else {
            this._activeNodeId = nodeId;
        }
        this._applyHighlight();
        if (this.onNodeClick) this.onNodeClick(nodeId, d.data);
    }

    _drawNode(group, d) {
        group.selectAll('*').remove();
        const data = d.data;
        const isOp = data.type === 'operator' || data.type === 'relation' || data.type === 'function';
        const style = this._nodeStyle(data.type);

        if (data._collapsed) {
            const label = data.subexpr || data.label || data.id;
            const estimatedWidth = Math.max(100, Math.min(260, label.length * 7 + 30));
            group.append('rect')
                .attr('class', 'd3sg-tile-bg')
                .attr('x', -estimatedWidth / 2)
                .attr('y', -24)
                .attr('width', estimatedWidth)
                .attr('height', 48)
                .attr('rx', 6)
                .attr('fill', style.fill || '')
                .attr('stroke', style.stroke || '');

            this._renderLabel(group, data, estimatedWidth, true, style);

            group.append('text')
                .attr('class', 'd3sg-chevron')
                .attr('x', estimatedWidth / 2 - 14)
                .attr('y', -12)
                .attr('font-size', '11px')
                .text('▶');
            return;
        }

        if (isOp) {
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

        this._renderLabel(group, data, isOp ? 56 : 52, false, style);

        if (isOp && data.children && data.children.length > 0) {
            group.append('text')
                .attr('class', 'd3sg-chevron')
                .attr('x', 20)
                .attr('y', -16)
                .attr('font-size', '11px')
                .text('▼');
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
                .attr('font-size', isCollapsed ? '12px' : '14px')
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
