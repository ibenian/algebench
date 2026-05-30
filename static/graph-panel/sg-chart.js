/**
 * SgChartManager — interactive Chart.js plots for semantic graph nodes.
 *
 * Evaluates sub-expressions by walking the semantic graph DAG, renders
 * Chart.js line charts with variable selection, and supports pinning
 * charts to a floating overlay at the top of the viewport.
 *
 * Slider panel sits bottom-left, legend bottom-right (matching the 3D
 * viewport layout convention).
 */

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
const NUM_POINTS = 200;

const CHART_PALETTE = [
    '#42a5f5', '#66bb6a', '#ef5350', '#ab47bc',
    '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];

const GRID_COLS = 6;
const GRID_ROWS = 4;
const GRID_GAP = 8;

let _chartJsLoaded = false;
let _chartJsPromise = null;
function loadChartJs() {
    if (_chartJsLoaded) return Promise.resolve();
    if (_chartJsPromise) return _chartJsPromise;
    _chartJsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = CHART_JS_CDN;
        s.onload = () => { _chartJsLoaded = true; resolve(); };
        s.onerror = reject;
        document.head.appendChild(s);
    });
    _chartJsPromise.catch(() => { _chartJsPromise = null; });
    return _chartJsPromise;
}

// ── Expression evaluator via graph DAG walk ──────────────────────────

const MATH_OPS = {
    add:       (a, b) => a + b,
    subtract:  (a, b) => a - b,
    multiply:  (a, b) => a * b,
    divide:    (a, b) => b === 0 ? NaN : a / b,
    power:     (a, b) => Math.pow(a, b),
    negation:  (a) => -a,
    sin:       (a) => Math.sin(a),
    cos:       (a) => Math.cos(a),
    tan:       (a) => Math.tan(a),
    sqrt:      (a) => a < 0 ? NaN : Math.sqrt(a),
    abs:       (a) => Math.abs(a),
    Abs:       (a) => Math.abs(a),
    log:       (a) => a <= 0 ? NaN : Math.log(a),
    logarithm: (a) => a <= 0 ? NaN : Math.log(a),
    exp:       (a) => Math.exp(a),
    factorial: (a) => {
        if (a < 0 || !Number.isInteger(a)) return NaN;
        let r = 1; for (let i = 2; i <= a; i++) r *= i; return r;
    },
};

const KNOWN_CONSTANTS = {
    pi: Math.PI, 'π': Math.PI,
    e: Math.E,
    i: NaN,
    phi: (1 + Math.sqrt(5)) / 2,
    tau: 2 * Math.PI,
    inf: Infinity,
};

function extractVariables(graph, rootId) {
    const nodeById = Object.create(null);
    for (const n of graph.nodes) nodeById[n.id] = n;
    const childrenOf = Object.create(null);
    const edgeRoles = Object.create(null);
    for (const e of graph.edges) {
        if (!childrenOf[e.to]) childrenOf[e.to] = [];
        childrenOf[e.to].push(e.from);
        edgeRoles[`${e.from}->${e.to}`] = e;
    }

    const vars = new Set();
    const visited = new Set();
    const queue = [rootId];
    while (queue.length) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        const n = nodeById[id];
        if (!n) continue;
        const isOp = n.type === 'operator' || n.type === 'relation' || n.type === 'function';
        if (!isOp && n.type !== 'number' && n.type !== 'constant') {
            if (n.value == null || typeof n.value === 'string') {
                const name = n.label || n.latex || n.id;
                if (name && !KNOWN_CONSTANTS[name]) vars.add(name);
            }
        }
        for (const child of (childrenOf[id] || [])) queue.push(child);
    }
    return [...vars];
}

function evaluateNode(graph, nodeId, vars, cache) {
    if (cache.has(nodeId)) return cache.get(nodeId);

    const nodeById = Object.create(null);
    for (const n of graph.nodes) nodeById[n.id] = n;
    const childrenOf = Object.create(null);
    const edgeDetails = Object.create(null);
    for (const e of graph.edges) {
        if (!childrenOf[e.to]) childrenOf[e.to] = [];
        childrenOf[e.to].push(e.from);
        edgeDetails[`${e.from}->${e.to}`] = e;
    }

    function _eval(id) {
        if (cache.has(id)) return cache.get(id);
        const n = nodeById[id];
        if (!n) { cache.set(id, NaN); return NaN; }

        const isOp = n.type === 'operator' || n.type === 'relation' || n.type === 'function';

        if (!isOp) {
            if (n.value != null && typeof n.value === 'number') {
                cache.set(id, n.value);
                return n.value;
            }
            if (n.type === 'number') {
                const v = parseFloat(n.label || n.latex || n.id);
                cache.set(id, isNaN(v) ? 0 : v);
                return cache.get(id);
            }
            if (n.type === 'constant') {
                const name = n.label || n.latex || n.id;
                if (KNOWN_CONSTANTS[name] != null) {
                    cache.set(id, KNOWN_CONSTANTS[name]);
                    return cache.get(id);
                }
                if (vars[name] != null) {
                    cache.set(id, vars[name]);
                    return vars[name];
                }
                cache.set(id, NaN);
                return NaN;
            }
            const name = n.label || n.latex || n.id;
            if (vars[name] != null) {
                cache.set(id, vars[name]);
                return vars[name];
            }
            cache.set(id, NaN);
            return NaN;
        }

        const children = childrenOf[id] || [];
        const op = n.op || '';

        if (op === 'equals' || op === 'greater_than' || op === 'less_than' ||
            op === 'greater_equal' || op === 'less_equal' || op === 'not_equal') {
            if (children.length >= 2) {
                const sorted = sortChildrenByRole(children, id, edgeDetails);
                const lhs = _eval(sorted[0]);
                const rhs = _eval(sorted[1]);
                cache.set(id, lhs - rhs);
                return lhs - rhs;
            }
        }

        if (op === 'power') {
            if (n.exponent != null) {
                const expVal = parseFloat(n.exponent);
                if (children.length >= 1) {
                    const base = _eval(children[0]);
                    const result = Math.pow(base, isNaN(expVal) ? 2 : expVal);
                    cache.set(id, result);
                    return result;
                }
            }
            if (children.length >= 2) {
                const sorted = sortChildrenByRole(children, id, edgeDetails);
                const base = _eval(sorted[0]);
                const exp = _eval(sorted[1]);
                const result = Math.pow(base, exp);
                cache.set(id, result);
                return result;
            }
        }

        const fn = MATH_OPS[op];
        if (fn) {
            const childVals = children.map(c => _eval(c));
            if (fn.length === 1 && childVals.length >= 1) {
                const result = fn(childVals[0]);
                cache.set(id, result);
                return result;
            }
            if (fn.length === 2 && childVals.length >= 2) {
                let result = childVals[0];
                for (let i = 1; i < childVals.length; i++) {
                    result = fn(result, childVals[i]);
                }
                cache.set(id, result);
                return result;
            }
            if (childVals.length === 1) {
                cache.set(id, childVals[0]);
                return childVals[0];
            }
        }

        if (children.length === 1) {
            const v = _eval(children[0]);
            cache.set(id, v);
            return v;
        }

        cache.set(id, NaN);
        return NaN;
    }

    function sortChildrenByRole(children, parentId, edges) {
        const withRole = children.map(c => {
            const e = edges[`${c}->${parentId}`];
            return { id: c, role: e?.role };
        });
        withRole.sort((a, b) => {
            if (a.role === 'base' || a.role === 'lhs') return -1;
            if (b.role === 'base' || b.role === 'lhs') return 1;
            if (a.role === 'exp' || a.role === 'rhs') return 1;
            if (b.role === 'exp' || b.role === 'rhs') return -1;
            return 0;
        });
        return withRole.map(w => w.id);
    }

    return _eval(nodeId);
}

// ── Auto-range heuristics ────────────────────────────────────────────

function autoRange(varName) {
    const lower = varName.toLowerCase();
    if (lower.includes('angle') || lower === 'θ' || lower === 'theta' ||
        lower === 'φ' || lower === 'phi' || lower === 'α' || lower === 'β') {
        return { min: 0, max: 2 * Math.PI, step: 0.01, default: Math.PI / 4 };
    }
    if (lower === 't' || lower === 'time') {
        return { min: 0, max: 10, step: 0.01, default: 1 };
    }
    if (lower === 'r' || lower === 'radius') {
        return { min: 0, max: 5, step: 0.01, default: 1 };
    }
    if (lower === 'n' || lower === 'k') {
        return { min: 0, max: 20, step: 1, default: 1 };
    }
    return { min: -5, max: 5, step: 0.01, default: 1 };
}

// ── Chart manager ────────────────────────────────────────────────────

let _chartIdCounter = 0;

export class SgChartManager {
    constructor(container, graph, opts = {}) {
        this.container = container;
        this.graph = graph;
        this.katex = opts.katex || (typeof window !== 'undefined' && window.katex);
        this.charts = new Map();
        this.pinnedCharts = [];
        this.sliderValues = {};
        this._allVariables = new Set();
        this._ready = false;
        this._sliderPanel = null;
        this._pinnedPanel = null;
        this._legendPanel = null;
        this._transform = { x: 0, y: 0, k: 1 };

        this._buildNodeIndex();
    }

    _buildNodeIndex() {
        this._nodeById = Object.create(null);
        for (const n of this.graph.nodes) this._nodeById[n.id] = n;
        this._childrenOf = Object.create(null);
        for (const e of this.graph.edges) {
            if (!this._childrenOf[e.to]) this._childrenOf[e.to] = [];
            this._childrenOf[e.to].push(e.from);
        }
    }

    setTransform(t) {
        this._transform = t || { x: 0, y: 0, k: 1 };
        this._updateUnpinnedPositions();
    }

    _updateUnpinnedPositions() {
        const card = this.container.querySelector('.d3-graph-card') || this.container;
        const rect = card.getBoundingClientRect();
        const { x: tx, y: ty, k } = this._transform;
        for (const entry of this.charts.values()) {
            if (entry.pinned) continue;
            const screenX = entry.graphX * k + tx;
            const screenY = entry.graphY * k + ty;
            const left = Math.max(4, Math.min(screenX, rect.width - entry.box.offsetWidth - 4));
            const top = Math.max(4, Math.min(screenY, rect.height - entry.box.offsetHeight - 4));
            entry.box.style.left = `${left}px`;
            entry.box.style.top = `${top}px`;
        }
    }

    async init() {
        await loadChartJs();
        this._ready = true;
        this._ensureOverlays();
    }

    _ensureOverlays() {
        const card = this.container.querySelector('.d3-graph-card') || this.container;

        if (!this._sliderPanel) {
            this._sliderPanel = document.createElement('div');
            this._sliderPanel.className = 'sgc-slider-panel';
            card.appendChild(this._sliderPanel);
        }

        if (!this._pinnedPanel) {
            this._pinnedPanel = document.createElement('div');
            this._pinnedPanel.className = 'sgc-pinned-panel';
            card.appendChild(this._pinnedPanel);
        }

        if (!this._legendPanel) {
            this._legendPanel = document.createElement('div');
            this._legendPanel.className = 'sgc-legend-panel';
            card.appendChild(this._legendPanel);
        }
    }

    hasExpression(nodeId) {
        const n = this._nodeById[nodeId];
        if (!n) return false;
        const isOp = n.type === 'operator' || n.type === 'relation' || n.type === 'function';
        if (isOp) {
            const children = this._childrenOf[nodeId] || [];
            return children.length > 0;
        }
        return false;
    }

    canChart(nodeId) {
        if (!this._nodeById[nodeId]) return false;
        const vars = extractVariables(this.graph, nodeId);
        return vars.length > 0;
    }

    async openChart(nodeId, anchorEl) {
        if (!this._ready) await this.init();
        if (this.charts.has(nodeId)) return;

        const n = this._nodeById[nodeId];
        if (!n) return;

        const vars = extractVariables(this.graph, nodeId);
        if (vars.length === 0) return;

        const chartId = `sgc-${++_chartIdCounter}`;
        const xVar = vars[0];

        for (const v of vars) {
            this._allVariables.add(v);
            if (this.sliderValues[v] == null) {
                const range = autoRange(v);
                this.sliderValues[v] = range.default != null ? range.default : (range.min + range.max) / 2;
            }
        }

        const card = this.container.querySelector('.d3-graph-card') || this.container;

        const box = document.createElement('div');
        box.className = 'sgc-chart-box';
        box.id = chartId;
        box.dataset.nodeId = nodeId;

        const header = document.createElement('div');
        header.className = 'sgc-chart-header';

        const title = document.createElement('span');
        title.className = 'sgc-chart-title';
        const label = n.subexpr || n.latex || n.label || n.id;
        if (this.katex && (n.subexpr || n.latex)) {
            try {
                this.katex.render(label, title, { throwOnError: false, displayMode: false });
            } catch (_) {
                title.textContent = label;
            }
        } else {
            title.textContent = label;
        }

        const controls = document.createElement('div');
        controls.className = 'sgc-chart-controls';

        const xSelect = document.createElement('select');
        xSelect.className = 'sgc-x-select';
        xSelect.title = 'X-axis variable';
        for (const v of vars) {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            if (v === xVar) opt.selected = true;
            xSelect.appendChild(opt);
        }

        const pinBtn = document.createElement('button');
        pinBtn.className = 'sgc-btn sgc-pin-btn';
        pinBtn.title = 'Pin chart to overlay';
        pinBtn.innerHTML = '&#x1F4CC;';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'sgc-btn sgc-close-btn';
        closeBtn.title = 'Close chart';
        closeBtn.textContent = '×';

        controls.appendChild(xSelect);
        controls.appendChild(pinBtn);
        controls.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(controls);
        box.appendChild(header);

        const canvasWrap = document.createElement('div');
        canvasWrap.className = 'sgc-canvas-wrap';
        const canvas = document.createElement('canvas');
        canvasWrap.appendChild(canvas);
        box.appendChild(canvasWrap);

        card.appendChild(box);

        const boxW = 340, boxH = 248;
        let left = 4, top = 4;
        {
            const containerRect = card.getBoundingClientRect();
            if (anchorEl) {
                const rect = anchorEl.getBoundingClientRect();
                left = rect.right - containerRect.left + 8;
                top = rect.top - containerRect.top;
            }
            left = Math.max(4, Math.min(left, containerRect.width - boxW - 4));
            top = Math.max(4, Math.min(top, containerRect.height - boxH - 4));

            const occupied = [];
            for (const existing of this.charts.values()) {
                if (existing.pinned) continue;
                const er = existing.box.getBoundingClientRect();
                occupied.push({
                    left: er.left - containerRect.left,
                    top: er.top - containerRect.top,
                    right: er.right - containerRect.left,
                    bottom: er.bottom - containerRect.top,
                });
            }
            for (let attempt = 0; attempt < 6; attempt++) {
                const myRight = left + boxW;
                const myBottom = top + boxH;
                let collision = false;
                for (const o of occupied) {
                    if (left < o.right && myRight > o.left && top < o.bottom && myBottom > o.top) {
                        collision = true;
                        top = o.bottom + 4;
                        if (top + boxH > containerRect.height - 4) {
                            top = 4;
                            left = o.right + 4;
                        }
                        break;
                    }
                }
                if (!collision) break;
                left = Math.max(4, Math.min(left, containerRect.width - boxW - 4));
                top = Math.max(4, Math.min(top, containerRect.height - boxH - 4));
            }

            box.style.position = 'absolute';
            box.style.left = `${left}px`;
            box.style.top = `${top}px`;
            box.style.zIndex = '20';
        }

        const { x: tx, y: ty, k } = this._transform;
        const _graphX = (left - tx) / k;
        const _graphY = (top - ty) / k;

        const colorIdx = _chartIdCounter % CHART_PALETTE.length;
        const chartColor = CHART_PALETTE[colorIdx];

        const { data, xLabel } = this._computeData(nodeId, xVar, vars);

        const chart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: data.map(p => p.x),
                datasets: [{
                    label: label,
                    data: data.map(p => p.y),
                    borderColor: chartColor,
                    backgroundColor: chartColor + '22',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHitRadius: 6,
                    fill: true,
                    tension: 0.3,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 200 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(10, 12, 26, 0.9)',
                        titleColor: '#dde6ff',
                        bodyColor: '#aebbd1',
                        borderColor: 'rgba(110, 124, 180, 0.35)',
                        borderWidth: 1,
                        callbacks: {
                            label: (ctx) => `y = ${ctx.parsed.y?.toFixed(4)}`,
                            title: (items) => `${xVar} = ${items[0]?.parsed.x?.toFixed(4)}`,
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: xVar, color: '#8fa8c8' },
                        ticks: { color: '#7e8aa3', maxTicksLimit: 8, callback: v => +v.toFixed(3) },
                        grid: { color: 'rgba(110, 124, 180, 0.12)' },
                    },
                    y: {
                        title: { display: true, text: 'f(' + xVar + ')', color: '#8fa8c8' },
                        ticks: { color: '#7e8aa3', maxTicksLimit: 6, callback: v => +v.toFixed(3) },
                        grid: { color: 'rgba(110, 124, 180, 0.12)' },
                    },
                },
                interaction: { mode: 'index', intersect: false },
            },
        });

        const entry = {
            chartId,
            nodeId,
            chart,
            box,
            canvas,
            xVar,
            vars,
            color: chartColor,
            pinned: false,
            graphX: _graphX,
            graphY: _graphY,
            colSpan: 2,
            rowSpan: 2,
        };
        this.charts.set(nodeId, entry);

        this._makeDraggable(entry);

        xSelect.addEventListener('change', () => {
            entry.xVar = xSelect.value;
            this._updateChart(entry);
            this._updateSliders();
        });

        pinBtn.addEventListener('click', () => this._pinChart(nodeId));
        closeBtn.addEventListener('click', () => this.closeChart(nodeId));

        this._updateSliders();
        this._updateLegend();
    }

    closeChart(nodeId) {
        const entry = this.charts.get(nodeId);
        if (!entry) return;
        if (entry._dragCleanup) entry._dragCleanup();
        if (entry._resizeCleanup) entry._resizeCleanup();
        entry.chart.destroy();
        entry.box.remove();
        this.charts.delete(nodeId);
        this._unpinChart(nodeId);
        this._rebuildVariableSet();
        this._updateSliders();
        this._updateLegend();
    }

    _pinChart(nodeId) {
        const entry = this.charts.get(nodeId);
        if (!entry || entry.pinned) return;
        entry.pinned = true;

        if (entry._dragCleanup) { entry._dragCleanup(); entry._dragCleanup = null; }

        entry.box.classList.add('sgc-pinned');
        entry.box.style.position = '';
        entry.box.style.left = '';
        entry.box.style.top = '';
        entry.box.style.zIndex = '';

        this._pinnedPanel.appendChild(entry.box);
        this._applyPinnedSize(entry);
        this._addResizeHandle(entry);

        const pinBtn = entry.box.querySelector('.sgc-pin-btn');
        if (pinBtn) {
            pinBtn.innerHTML = '&#x2716;';
            pinBtn.title = 'Unpin from overlay';
            pinBtn.onclick = () => this._unpinAndRestore(nodeId);
        }

        this.pinnedCharts.push(nodeId);
        entry.chart.resize();
    }

    _unpinChart(nodeId) {
        const idx = this.pinnedCharts.indexOf(nodeId);
        if (idx >= 0) this.pinnedCharts.splice(idx, 1);
    }

    _unpinAndRestore(nodeId) {
        const entry = this.charts.get(nodeId);
        if (!entry) return;
        entry.pinned = false;
        entry.box.classList.remove('sgc-pinned');

        if (entry._resizeCleanup) { entry._resizeCleanup(); entry._resizeCleanup = null; }

        const card = this.container.querySelector('.d3-graph-card') || this.container;
        card.appendChild(entry.box);

        entry.box.style.position = 'absolute';
        entry.box.style.width = '340px';
        entry.box.style.height = '';
        entry.box.style.zIndex = '20';

        const wrap = entry.box.querySelector('.sgc-canvas-wrap');
        if (wrap) wrap.style.height = '200px';

        const rect = card.getBoundingClientRect();
        const { x: tx, y: ty, k } = this._transform;
        let left = entry.graphX * k + tx;
        let top = entry.graphY * k + ty;
        left = Math.max(4, Math.min(left, rect.width - 340 - 4));
        top = Math.max(4, Math.min(top, rect.height - 248 - 4));
        entry.box.style.left = `${left}px`;
        entry.box.style.top = `${top}px`;

        const pinBtn = entry.box.querySelector('.sgc-pin-btn');
        if (pinBtn) {
            pinBtn.innerHTML = '&#x1F4CC;';
            pinBtn.title = 'Pin chart to overlay';
            pinBtn.onclick = () => this._pinChart(nodeId);
        }

        this._unpinChart(nodeId);
        this._makeDraggable(entry);
        entry.chart.resize();
    }

    _makeDraggable(entry) {
        const header = entry.box.querySelector('.sgc-chart-header');
        if (!header) return;
        let startX, startY, startLeft, startTop;

        const onMouseDown = (e) => {
            if (e.target.closest('.sgc-chart-controls')) return;
            e.preventDefault();
            const card = this.container.querySelector('.d3-graph-card') || this.container;
            const boxRect = entry.box.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            startLeft = boxRect.left - cardRect.left;
            startTop = boxRect.top - cardRect.top;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            header.style.cursor = 'grabbing';
        };

        const onMouseMove = (e) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const card = this.container.querySelector('.d3-graph-card') || this.container;
            const cardRect = card.getBoundingClientRect();
            const boxW = entry.box.offsetWidth;
            const boxH = entry.box.offsetHeight;
            const newLeft = Math.max(4, Math.min(startLeft + dx, cardRect.width - boxW - 4));
            const newTop = Math.max(4, Math.min(startTop + dy, cardRect.height - boxH - 4));
            entry.box.style.left = `${newLeft}px`;
            entry.box.style.top = `${newTop}px`;
            const { x: tx, y: ty, k } = this._transform;
            entry.graphX = (newLeft - tx) / k;
            entry.graphY = (newTop - ty) / k;
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            header.style.cursor = '';
        };

        header.addEventListener('mousedown', onMouseDown);
        entry._dragCleanup = () => header.removeEventListener('mousedown', onMouseDown);
    }

    _getGridSteps() {
        const card = this.container.querySelector('.d3-graph-card') || this.container;
        const rect = card.getBoundingClientRect();
        const availW = rect.width - 16;
        const availH = rect.height - 16;
        return {
            w: Math.floor((availW - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS),
            h: Math.floor((availH - (GRID_ROWS - 1) * GRID_GAP) / GRID_ROWS),
        };
    }

    _applyPinnedSize(entry) {
        const step = this._getGridSteps();
        const w = entry.colSpan * step.w + (entry.colSpan - 1) * GRID_GAP;
        const h = entry.rowSpan * step.h + (entry.rowSpan - 1) * GRID_GAP;
        entry.box.style.width = `${w}px`;
        entry.box.style.height = `${h}px`;
        const header = entry.box.querySelector('.sgc-chart-header');
        const headerH = header ? header.offsetHeight : 36;
        const wrap = entry.box.querySelector('.sgc-canvas-wrap');
        if (wrap) wrap.style.height = `${h - headerH - 2}px`;
    }

    _addResizeHandle(entry) {
        if (entry.box.querySelector('.sgc-resize-handle')) return;
        const handle = document.createElement('div');
        handle.className = 'sgc-resize-handle';
        entry.box.appendChild(handle);

        let startX, startY, startColSpan, startRowSpan;

        const onMouseDown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            startX = e.clientX;
            startY = e.clientY;
            startColSpan = entry.colSpan;
            startRowSpan = entry.rowSpan;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            const step = this._getGridSteps();
            const unitW = step.w + GRID_GAP;
            const unitH = step.h + GRID_GAP;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const colSpan = Math.max(1, Math.min(GRID_COLS, startColSpan + Math.round(dx / unitW)));
            const rowSpan = Math.max(1, Math.min(GRID_ROWS, startRowSpan + Math.round(dy / unitH)));
            if (colSpan !== entry.colSpan || rowSpan !== entry.rowSpan) {
                entry.colSpan = colSpan;
                entry.rowSpan = rowSpan;
                this._applyPinnedSize(entry);
                entry.chart.resize();
            }
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        handle.addEventListener('mousedown', onMouseDown);
        entry._resizeCleanup = () => {
            handle.removeEventListener('mousedown', onMouseDown);
            handle.remove();
        };
    }

    _computeData(nodeId, xVar, vars) {
        const range = autoRange(xVar);
        const points = [];
        const step = (range.max - range.min) / NUM_POINTS;

        for (let i = 0; i <= NUM_POINTS; i++) {
            const xVal = range.min + step * i;
            const varValues = { ...this.sliderValues };
            varValues[xVar] = xVal;

            const cache = new Map();
            const y = evaluateNode(this.graph, nodeId, varValues, cache);

            if (Number.isFinite(y)) {
                points.push({ x: +xVal.toFixed(6), y: +y.toFixed(6) });
            }
        }

        return { data: points, xLabel: xVar };
    }

    _updateChart(entry) {
        const { data } = this._computeData(entry.nodeId, entry.xVar, entry.vars);
        entry.chart.data.labels = data.map(p => p.x);
        entry.chart.data.datasets[0].data = data.map(p => p.y);
        entry.chart.options.scales.x.title.text = entry.xVar;
        entry.chart.options.scales.y.title.text = `f(${entry.xVar})`;
        entry.chart.options.plugins.tooltip.callbacks.title =
            (items) => `${entry.xVar} = ${items[0]?.parsed.x?.toFixed(4)}`;
        entry.chart.update('none');
    }

    _updateAllCharts() {
        for (const entry of this.charts.values()) {
            this._updateChart(entry);
        }
    }

    _rebuildVariableSet() {
        this._allVariables.clear();
        for (const entry of this.charts.values()) {
            for (const v of entry.vars) this._allVariables.add(v);
        }
    }

    _updateSliders() {
        if (!this._sliderPanel) return;
        this._sliderPanel.innerHTML = '';

        const activeVars = new Set();
        for (const entry of this.charts.values()) {
            for (const v of entry.vars) {
                if (v !== entry.xVar) activeVars.add(v);
            }
        }

        if (activeVars.size === 0) {
            this._sliderPanel.classList.add('hidden');
            return;
        }
        this._sliderPanel.classList.remove('hidden');

        const title = document.createElement('div');
        title.className = 'sgc-slider-title';
        title.textContent = 'PARAMETERS';
        this._sliderPanel.appendChild(title);

        for (const v of [...activeVars].sort()) {
            const range = autoRange(v);
            if (this.sliderValues[v] == null) {
                this.sliderValues[v] = range.default != null ? range.default : (range.min + range.max) / 2;
            }

            const row = document.createElement('div');
            row.className = 'sgc-slider-row';

            const label = document.createElement('span');
            label.className = 'sgc-slider-label';
            if (this.katex) {
                try {
                    this.katex.render(v, label, { throwOnError: false, displayMode: false });
                } catch (_) {
                    label.textContent = v;
                }
            } else {
                label.textContent = v;
            }

            const input = document.createElement('input');
            input.type = 'range';
            input.className = 'sgc-slider';
            input.min = range.min;
            input.max = range.max;
            input.step = range.step;
            input.value = this.sliderValues[v];

            const val = document.createElement('span');
            val.className = 'sgc-slider-value';
            val.textContent = (+this.sliderValues[v]).toFixed(2);

            input.addEventListener('input', () => {
                this.sliderValues[v] = parseFloat(input.value);
                val.textContent = (+input.value).toFixed(2);
                this._updateAllCharts();
            });

            row.appendChild(label);
            row.appendChild(input);
            row.appendChild(val);
            this._sliderPanel.appendChild(row);
        }
    }

    _updateLegend() {
        if (!this._legendPanel) return;
        this._legendPanel.innerHTML = '';

        if (this.charts.size === 0) {
            this._legendPanel.classList.add('hidden');
            return;
        }

        if (this.charts.size < 2) {
            this._legendPanel.classList.add('hidden');
            return;
        }

        this._legendPanel.classList.remove('hidden');

        const title = document.createElement('div');
        title.className = 'sgc-legend-title';
        title.textContent = 'CHARTS';
        this._legendPanel.appendChild(title);

        for (const entry of this.charts.values()) {
            const item = document.createElement('div');
            item.className = 'sgc-legend-item';

            const swatch = document.createElement('span');
            swatch.className = 'sgc-legend-swatch';
            swatch.style.background = entry.color;

            const name = document.createElement('span');
            name.className = 'sgc-legend-name';
            const n = this._nodeById[entry.nodeId];
            const lbl = n?.label || n?.latex || entry.nodeId;
            if (this.katex && (n?.latex || n?.subexpr)) {
                try {
                    this.katex.render(n.latex || n.subexpr, name, { throwOnError: false, displayMode: false });
                } catch (_) {
                    name.textContent = lbl;
                }
            } else {
                name.textContent = lbl;
            }

            item.appendChild(swatch);
            item.appendChild(name);
            this._legendPanel.appendChild(item);
        }
    }

    destroy() {
        for (const entry of this.charts.values()) {
            if (entry._dragCleanup) entry._dragCleanup();
            if (entry._resizeCleanup) entry._resizeCleanup();
            entry.chart.destroy();
            entry.box.remove();
        }
        this.charts.clear();
        this.pinnedCharts = [];
        if (this._sliderPanel) this._sliderPanel.remove();
        if (this._pinnedPanel) this._pinnedPanel.remove();
        if (this._legendPanel) this._legendPanel.remove();
    }
}
