/**
 * SgChartManager — interactive Chart.js plots for semantic graph nodes.
 *
 * Expression evaluation is handled by the backend (SymPy→mathjs pipeline)
 * and evaluated client-side via expr.js.  Chart.js renders the results.
 *
 * Slider panel sits bottom-left, legend bottom-right (matching the 3D
 * viewport layout convention).
 */

import { SgChartScript } from './sg-chart-script.js';
import { compileExpr, evalExpr } from '/expr.js';

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
const NUM_POINTS = 200;

const CHART_PALETTE = [
    '#42a5f5', '#66bb6a', '#ef5350', '#ab47bc',
    '#ffa726', '#26c6da', '#ec407a', '#8d6e63',
];

const GRID_COLS = 6;
const GRID_ROWS = 4;
const GRID_GAP = 8;

// Greek letter & math symbol names → Unicode characters for plain-text
// contexts (dropdown options, axis titles, tooltips).
const _GREEK_UNICODE = new Map([
    ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'],
    ['delta', 'δ'], ['epsilon', 'ε'], ['zeta', 'ζ'],
    ['eta', 'η'], ['theta', 'θ'], ['iota', 'ι'],
    ['kappa', 'κ'], ['lambda', 'λ'], ['mu', 'μ'],
    ['nu', 'ν'], ['xi', 'ξ'], ['pi', 'π'],
    ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'],
    ['upsilon', 'υ'], ['phi', 'φ'], ['chi', 'χ'],
    ['psi', 'ψ'], ['omega', 'ω'],
    ['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'],
    ['Lambda', 'Λ'], ['Pi', 'Π'], ['Sigma', 'Σ'],
    ['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω'],
    // Common math symbols emitted by parse_latex
    ['nabla', '∇'], ['partial', '∂'], ['infty', '∞'],
    ['hbar', 'ℏ'], ['ell', 'ℓ'],
]);

// Greek letter & math symbol names → LaTeX commands for KaTeX rendering.
const _GREEK_LATEX = new Map([
    ['alpha', '\\alpha'], ['beta', '\\beta'], ['gamma', '\\gamma'],
    ['delta', '\\delta'], ['epsilon', '\\epsilon'], ['zeta', '\\zeta'],
    ['eta', '\\eta'], ['theta', '\\theta'], ['iota', '\\iota'],
    ['kappa', '\\kappa'], ['lambda', '\\lambda'], ['mu', '\\mu'],
    ['nu', '\\nu'], ['xi', '\\xi'], ['pi', '\\pi'],
    ['rho', '\\rho'], ['sigma', '\\sigma'], ['tau', '\\tau'],
    ['upsilon', '\\upsilon'], ['phi', '\\phi'], ['chi', '\\chi'],
    ['psi', '\\psi'], ['omega', '\\omega'],
    ['Gamma', '\\Gamma'], ['Delta', '\\Delta'], ['Theta', '\\Theta'],
    ['Lambda', '\\Lambda'], ['Pi', '\\Pi'], ['Sigma', '\\Sigma'],
    ['Phi', '\\Phi'], ['Psi', '\\Psi'], ['Omega', '\\Omega'],
    // Common math symbols emitted by parse_latex
    ['nabla', '\\nabla'], ['partial', '\\partial'], ['infty', '\\infty'],
    ['hbar', '\\hbar'], ['ell', '\\ell'],
    ['vec', '\\vec{v}'],
]);

// Convert sanitized variable names back to display-friendly form.
// u_prime → u', u_dprime → u'', gamma → γ, mu_0 → μ₀ (Unicode).
// Used for plain-text contexts (dropdowns, axis titles, tooltips).
function _displayVar(name) {
    let out = name
        .replace(/_tprime$/, "'''")
        .replace(/_dprime$/, "''")
        .replace(/_prime$/, "'");
    // Exact match first (e.g. "gamma" → "γ")
    if (_GREEK_UNICODE.has(out)) return _GREEK_UNICODE.get(out);
    // Subscripted Greek: "mu_0" → "μ₀", "epsilon_0" → "ε₀"
    const uIdx = out.indexOf('_');
    if (uIdx > 0) {
        const base = out.slice(0, uIdx);
        const sub = out.slice(uIdx + 1);
        const greek = _GREEK_UNICODE.get(base);
        if (greek) return `${greek}_${sub}`;
    }
    return out;
}

// Convert variable name to LaTeX for KaTeX rendering.
// gamma → \gamma, u_prime → u', mu_0 → \mu_{0}, etc.
function _latexVar(name) {
    let out = name
        .replace(/_tprime$/, "'''")
        .replace(/_dprime$/, "''")
        .replace(/_prime$/, "'");
    // Exact match first (e.g. "gamma" → "\\gamma")
    if (_GREEK_LATEX.has(out)) return _GREEK_LATEX.get(out);
    // Subscripted Greek: "mu_0" → "\\mu_{0}", "epsilon_0" → "\\epsilon_{0}"
    const uIdx = out.indexOf('_');
    if (uIdx > 0) {
        const base = out.slice(0, uIdx);
        const sub = out.slice(uIdx + 1);
        const greek = _GREEK_LATEX.get(base);
        if (greek) return `${greek}_{${sub}}`;
    }
    return out;
}

// Relation operators that trigger LHS−RHS conversion in the backend.
const _RELATION_RE = /(?:^|[^\\])=|\\(?:leq|geq|neq|lt|gt|le|ge)\b|[<>]/;

// Convert an equation LaTeX into "LHS − (RHS)" display form.
function _relationToLhsMinusRhs(latex) {
    // Find the first top-level relation operator using the same matcher as
    // detection (_RELATION_RE) so escaped operators (e.g. "\=") are ignored.
    // Capture the operator separately to know how much to slice off.
    const splitRe = /(?:^|[^\\])(=)|\\(leq|geq|neq|lt|gt|le|ge)\b|([<>])/;
    const m = splitRe.exec(latex);
    if (m) {
        const op = m[0];
        const opIdx = m.index;
        // m[1] = bare '=', m[2] = LaTeX word op, m[3] = bare '<'/'>'.
        // For the '=' branch the match may include a leading non-backslash char.
        let sepStart = opIdx;
        let sepEnd = opIdx + op.length;
        if (m[1] && op.length > 1) {
            // Leading char captured before '='; keep it on the LHS.
            sepStart = opIdx + op.length - 1;
        }
        const lhs = latex.slice(0, sepStart).trim();
        const rhs = latex.slice(sepEnd).trim();
        if (lhs && rhs) return `${lhs} - \\left(${rhs}\\right)`;
    }
    return latex;
}

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
        this._renderer = null;
        this._rafId = null;
        this._resizeObserver = null;
        this._destroyed = false;

        this._scriptService = new SgChartScript(graph);
        this._compiledScripts = new Map();

        // Cross-chart hover synchronization plugin
        this._crosshairPlugin = this._createCrosshairPlugin();

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

    /**
     * Connect to a D3SemanticGraphRenderer so the chart manager can poll
     * its _currentTransform on every animation frame.  This catches ALL
     * transform sources (drag-pan, trackpad, scrollbar, zoomToFit, …)
     * regardless of whether the callback chain fires.
     */
    setRenderer(renderer) {
        this._renderer = renderer;
        this._startTransformPolling();
        this._observeContainerResize();
    }

    _startTransformPolling() {
        if (this._rafId) return;             // already running
        const poll = () => {
            this._rafId = requestAnimationFrame(poll);
            if (!this._renderer) return;
            const rt = this._renderer._currentTransform;
            if (!rt) return;
            const cur = this._transform;
            if (rt.x !== cur.x || rt.y !== cur.y || rt.k !== cur.k) {
                this._transform = { x: rt.x, y: rt.y, k: rt.k };
                this._updateUnpinnedPositions();
            }
        };
        this._rafId = requestAnimationFrame(poll);
    }

    _stopTransformPolling() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    /** Watch the graph card for size changes and realign all charts. */
    _observeContainerResize() {
        if (this._resizeObserver) return;    // already observing
        const card = this.container.querySelector('.d3-graph-card') || this.container;
        this._resizeObserver = new ResizeObserver(() => {
            // Reflow pinned charts (grid steps depend on viewport size)
            for (const entry of this.charts.values()) {
                if (entry.pinned) {
                    this._applyGridSize(entry);
                    entry.chart.resize();
                }
            }
            // Reclamp unpinned charts to the new container bounds
            this._updateUnpinnedPositions();
        });
        this._resizeObserver.observe(card);
    }

    _updateUnpinnedPositions() {
        const card = this.container.querySelector('.d3-graph-card') || this.container;
        const rect = card.getBoundingClientRect();
        const { x: tx, y: ty, k } = this._transform;
        const placed = [];
        for (const entry of this.charts.values()) {
            if (entry.pinned) continue;
            const boxW = entry.box.offsetWidth;
            const boxH = entry.box.offsetHeight;
            let left = entry.graphX * k + tx;
            let top = entry.graphY * k + ty;
            left = Math.max(4, Math.min(left, rect.width - boxW - 4));
            top = Math.max(4, Math.min(top, rect.height - boxH - 4));
            // Resolve collisions with previously placed charts
            for (let attempt = 0; attempt < 4; attempt++) {
                let collision = false;
                for (const p of placed) {
                    if (left < p.right && left + boxW > p.left &&
                        top < p.bottom && top + boxH > p.top) {
                        collision = true;
                        top = p.bottom + 4;
                        if (top + boxH > rect.height - 4) {
                            top = 4;
                            left = p.right + 4;
                        }
                        break;
                    }
                }
                if (!collision) break;
                left = Math.max(4, Math.min(left, rect.width - boxW - 4));
                top = Math.max(4, Math.min(top, rect.height - boxH - 4));
            }
            placed.push({ left, top, right: left + boxW, bottom: top + boxH });
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
        return this._scriptService.canChart(nodeId);
    }

    canChart(nodeId) {
        return this._scriptService.canChart(nodeId);
    }

    /** Return all chart entries belonging to a given node. */
    _chartsForNode(nodeId) {
        const result = [];
        for (const entry of this.charts.values()) {
            if (entry.nodeId === nodeId) result.push(entry);
        }
        return result;
    }

    async openChart(nodeId, anchorEl) {
        if (!this._ready) await this.init();
        if (this._destroyed) return;

        const n = this._nodeById[nodeId];
        if (!n) return;

        // ── Fetch mathjs script from backend (or pre-computed) ───────
        const result = await this._scriptService.getScript(nodeId);
        if (this._destroyed) return;
        const hasError = !result || result.error;
        const vars = hasError ? [] : result.variables;
        const scriptText = hasError ? null : result.script;

        // Compile the mathjs script via expr.js
        let compiled = null;
        if (scriptText) {
            try {
                compiled = compileExpr(scriptText);
                this._compiledScripts.set(nodeId, compiled);
            } catch (e) {
                console.warn(`[SgChart] compile error for "${nodeId}":`, e);
            }
        }

        const chartId = `sgc-${++_chartIdCounter}`;
        const xVar = vars.length > 0 ? vars[0] : null;

        // ── Dedup: skip if a chart for this node already uses xVar ───
        // Each node can have at most one chart per independent variable.
        // Clicking the chart button again only adds a new chart if the
        // default x-variable is not already taken by an existing chart.
        const existing = this._chartsForNode(nodeId);
        if (existing.some(e => e.xVar === xVar)) return;

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
        let exprLabel = n.subexpr || n.latex || n.label || n.id;
        // If the backend converted a relation (=, ≤, ≥, …) to LHS−RHS,
        // reflect that in the chart title so it matches what is plotted.
        const isRelation = (n.subexpr || n.latex) && _RELATION_RE.test(exprLabel);
        if (isRelation) {
            exprLabel = _relationToLhsMinusRhs(exprLabel);
        }
        this._renderTitle(title, exprLabel, xVar, isRelation);

        const controls = document.createElement('div');
        controls.className = 'sgc-chart-controls';

        const xSelect = document.createElement('select');
        xSelect.className = 'sgc-x-select';
        xSelect.title = 'X-axis variable';
        for (const v of vars) {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = _displayVar(v);
            if (v === xVar) opt.selected = true;
            xSelect.appendChild(opt);
        }

        // ── { } code button ─────────────────────────────────────────
        const codeBtn = document.createElement('button');
        codeBtn.className = 'sgc-btn sgc-code-btn';
        codeBtn.title = 'Show mathjs script';
        codeBtn.textContent = '{ }';
        codeBtn.addEventListener('click', () => this._toggleScriptTooltip(chartId, codeBtn));

        const pinBtn = document.createElement('button');
        pinBtn.className = 'sgc-btn sgc-pin-btn';
        pinBtn.title = 'Pin chart to overlay';
        pinBtn.innerHTML = '&#x1F4CC;';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'sgc-btn sgc-close-btn';
        closeBtn.title = 'Close chart';
        closeBtn.textContent = '×';

        controls.appendChild(xSelect);
        controls.appendChild(codeBtn);
        controls.appendChild(pinBtn);
        controls.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(controls);
        box.appendChild(header);

        const canvasWrap = document.createElement('div');
        canvasWrap.className = 'sgc-canvas-wrap';

        // ── Error state or canvas ────────────────────────────────────
        let chart = null;
        if (hasError || !compiled) {
            canvasWrap.classList.add('sgc-chart-error');
            const errMsg = document.createElement('div');
            errMsg.className = 'sgc-error-message';
            errMsg.textContent = result?.error || result?.detail || 'Could not generate expression';
            canvasWrap.appendChild(errMsg);
            xSelect.style.display = 'none';
            codeBtn.style.display = 'none';
        } else {
            const canvas = document.createElement('canvas');
            canvasWrap.appendChild(canvas);

            const { data } = this._computeData(nodeId, xVar, vars);

            const colorIdx = _chartIdCounter % CHART_PALETTE.length;
            const chartColor = CHART_PALETTE[colorIdx];

            chart = new Chart(canvas, {
                type: 'line',
                plugins: [this._crosshairPlugin],
                data: {
                    labels: data.map(p => p.x),
                    datasets: [{
                        label: exprLabel,
                        data: data.map(p => p.y),
                        borderColor: chartColor,
                        backgroundColor: chartColor + '22',
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHitRadius: 6,
                        fill: true,
                        tension: 0.3,
                        spanGaps: false,
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
                                title: (items) => `${_displayVar(xVar)} = ${items[0]?.parsed.x?.toFixed(4)}`,
                            },
                        },
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            title: { display: true, text: _displayVar(xVar), color: '#8fa8c8' },
                            ticks: { color: '#7e8aa3', maxTicksLimit: 8, callback: v => +v.toFixed(3) },
                            grid: { color: 'rgba(110, 124, 180, 0.12)' },
                        },
                        y: {
                            title: { display: true, text: isRelation ? 'LHS − RHS' : 'f(' + _displayVar(xVar) + ')', color: '#8fa8c8' },
                            ticks: { color: '#7e8aa3', maxTicksLimit: 6, callback: v => +v.toFixed(3) },
                            grid: { color: 'rgba(110, 124, 180, 0.12)' },
                        },
                    },
                    interaction: { mode: 'index', intersect: false },
                },
            });
        }

        box.appendChild(canvasWrap);
        card.appendChild(box);

        const step = this._getGridSteps();
        const boxW = 2 * step.w + GRID_GAP;
        const boxH = 2 * step.h + GRID_GAP;
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

        const entry = {
            chartId,
            nodeId,
            chart,
            box,
            canvas: box.querySelector('canvas'),
            titleEl: title,
            exprLabel,
            xVar,
            vars,
            scriptText,
            color: chartColor,
            pinned: false,
            graphX: _graphX,
            graphY: _graphY,
            colSpan: 2,
            rowSpan: 2,
            isRelation,
        };
        this.charts.set(chartId, entry);

        this._applyGridSize(entry);
        this._makeDraggable(entry);
        this._addResizeHandle(entry);

        xSelect.addEventListener('change', () => {
            entry.xVar = xSelect.value;
            this._updateChart(entry);
            this._updateSliders();
        });

        pinBtn.addEventListener('click', () => {
            const e = this.charts.get(chartId);
            if (!e) return;
            if (e.pinned) {
                this._unpinAndRestore(chartId);
            } else {
                this._pinChart(chartId);
            }
        });
        closeBtn.addEventListener('click', () => this.closeChart(chartId));

        this._updateSliders();
        this._updateLegend();
    }

    // ── Script tooltip ──────────────────────────────────────────────

    _toggleScriptTooltip(chartId, btnEl) {
        // Close any existing tooltip
        const existing = btnEl.parentElement?.querySelector('.sgc-script-tooltip');
        if (existing) { existing.remove(); return; }

        const entry = this.charts.get(chartId);
        const text = entry?.scriptText || '(no script)';

        const tip = document.createElement('div');
        tip.className = 'sgc-script-tooltip';
        tip.textContent = text;

        // Position below the button
        btnEl.parentElement.appendChild(tip);

        // Auto-close when clicking elsewhere
        const close = (e) => {
            if (!tip.contains(e.target) && e.target !== btnEl) {
                tip.remove();
                document.removeEventListener('click', close, true);
            }
        };
        setTimeout(() => document.addEventListener('click', close, true), 0);
    }

    closeChart(chartId) {
        const entry = this.charts.get(chartId);
        if (!entry) return;
        if (entry._dragCleanup) entry._dragCleanup();
        if (entry._resizeCleanup) entry._resizeCleanup();
        if (entry.chart) entry.chart.destroy();
        entry.box.remove();
        this.charts.delete(chartId);
        // Only delete compiled script if no other charts for the same node
        if (this._chartsForNode(entry.nodeId).length === 0) {
            this._compiledScripts.delete(entry.nodeId);
        }
        this._unpinChart(chartId);
        this._rebuildVariableSet();
        this._updateSliders();
        this._updateLegend();
    }

    _pinChart(chartId) {
        const entry = this.charts.get(chartId);
        if (!entry || entry.pinned) return;
        entry.pinned = true;

        if (entry._dragCleanup) { entry._dragCleanup(); entry._dragCleanup = null; }

        entry.box.classList.add('sgc-pinned');
        entry.box.style.position = '';
        entry.box.style.left = '';
        entry.box.style.top = '';
        entry.box.style.zIndex = '';

        this._pinnedPanel.appendChild(entry.box);
        this._applyGridSize(entry);
        this._addResizeHandle(entry);

        const pinBtn = entry.box.querySelector('.sgc-pin-btn');
        if (pinBtn) {
            pinBtn.innerHTML = '&#x1F4CC;';
            pinBtn.title = 'Unpin from overlay';
            pinBtn.classList.add('sgc-pin-active');
        }

        this.pinnedCharts.push(chartId);
        if (entry.chart) entry.chart.resize();
    }

    _unpinChart(chartId) {
        const idx = this.pinnedCharts.indexOf(chartId);
        if (idx >= 0) this.pinnedCharts.splice(idx, 1);
    }

    _unpinAndRestore(chartId) {
        const entry = this.charts.get(chartId);
        if (!entry) return;
        entry.pinned = false;
        entry.box.classList.remove('sgc-pinned');

        const card = this.container.querySelector('.d3-graph-card') || this.container;
        card.appendChild(entry.box);

        entry.box.style.position = 'absolute';
        entry.box.style.zIndex = '20';
        this._applyGridSize(entry);

        const rect = card.getBoundingClientRect();
        const boxW = entry.box.offsetWidth;
        const boxH = entry.box.offsetHeight;
        const { x: tx, y: ty, k } = this._transform;
        let left = entry.graphX * k + tx;
        let top = entry.graphY * k + ty;
        left = Math.max(4, Math.min(left, rect.width - boxW - 4));
        top = Math.max(4, Math.min(top, rect.height - boxH - 4));
        entry.box.style.left = `${left}px`;
        entry.box.style.top = `${top}px`;

        const pinBtn = entry.box.querySelector('.sgc-pin-btn');
        if (pinBtn) {
            pinBtn.innerHTML = '&#x1F4CC;';
            pinBtn.title = 'Pin chart to overlay';
            pinBtn.classList.remove('sgc-pin-active');
        }

        this._unpinChart(chartId);
        this._makeDraggable(entry);
        if (entry.chart) entry.chart.resize();
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

    _applyGridSize(entry) {
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
                this._applyGridSize(entry);
                if (entry.chart) entry.chart.resize();
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

    /**
     * Render the chart header title as ``f(xVar) = expression`` so the
     * user can see what the vertical axis represents.  Uses KaTeX when
     * available.
     */
    _renderTitle(el, exprLabel, xVar, _isRelation) {
        const xLatex = _latexVar(xVar);
        const fullLatex = `f(${xLatex}) = ${exprLabel}`;
        if (this.katex) {
            try {
                this.katex.render(fullLatex, el, { throwOnError: false, displayMode: false });
                return;
            } catch (_) { /* fall through */ }
        }
        // Plain-text fallback
        const xDisp = _displayVar(xVar);
        el.textContent = `f(${xDisp}) = ${exprLabel}`;
    }

    _computeData(nodeId, xVar, _vars) {
        const compiled = this._compiledScripts.get(nodeId);
        if (!compiled) return { data: [], xLabel: xVar };

        const range = autoRange(xVar);
        const points = [];
        const step = (range.max - range.min) / NUM_POINTS;

        for (let i = 0; i <= NUM_POINTS; i++) {
            const xVal = range.min + step * i;
            const scope = { ...this.sliderValues };
            scope[xVar] = xVal;

            try {
                const y = evalExpr(compiled, 0, { extraScope: scope });
                if (Number.isFinite(y)) {
                    points.push({ x: +xVal.toFixed(6), y: +y.toFixed(6) });
                } else {
                    // Insert null to break the line at discontinuities
                    // (asymptotes, division by zero, etc.)
                    points.push({ x: +xVal.toFixed(6), y: null });
                }
            } catch (_) {
                points.push({ x: +xVal.toFixed(6), y: null });
            }
        }

        return { data: points, xLabel: xVar };
    }

    _updateChart(entry) {
        if (!entry.chart) return;
        const { data } = this._computeData(entry.nodeId, entry.xVar, entry.vars);
        entry.chart.data.labels = data.map(p => p.x);
        entry.chart.data.datasets[0].data = data.map(p => p.y);
        const dv = _displayVar(entry.xVar);
        entry.chart.options.scales.x.title.text = dv;
        entry.chart.options.scales.y.title.text = entry.isRelation ? 'LHS − RHS' : `f(${dv})`;
        entry.chart.options.plugins.tooltip.callbacks.title =
            (items) => `${dv} = ${items[0]?.parsed.x?.toFixed(4)}`;
        entry.chart.update('none');
        // Refresh the header title to reflect the current x-variable.
        if (entry.titleEl) {
            this._renderTitle(entry.titleEl, entry.exprLabel, entry.xVar, entry.isRelation);
        }
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
                    this.katex.render(_latexVar(v), label, { throwOnError: false, displayMode: false });
                } catch (_) {
                    label.textContent = _displayVar(v);
                }
            } else {
                label.textContent = _displayVar(v);
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

    // ── Cross-chart hover synchronization ────────────────────────────

    _createCrosshairPlugin() {
        const mgr = this;
        return {
            id: 'sgcCrosshair',
            afterEvent(chart, args) {
                const event = args.event;
                if (event.type === 'mousemove') {
                    const elements = chart.getElementsAtEventForMode(
                        event, 'index', { intersect: false }, false,
                    );
                    if (elements.length > 0) {
                        mgr._syncCrosshair(chart, elements[0].index);
                    }
                } else if (event.type === 'mouseout') {
                    mgr._clearCrosshair(chart);
                }
            },
            afterDraw(chart) {
                if (chart._sgcSyncIndex == null) return;
                const meta = chart.getDatasetMeta(0);
                if (!meta || !meta.data) return;
                const point = meta.data[chart._sgcSyncIndex];
                if (!point) return;
                const { top, bottom } = chart.chartArea;
                const ctx = chart.ctx;
                ctx.save();
                ctx.strokeStyle = 'rgba(150, 170, 220, 0.4)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(point.x, top);
                ctx.lineTo(point.x, bottom);
                ctx.stroke();
                ctx.restore();
            },
        };
    }

    _syncCrosshair(sourceChart, index) {
        // Find the source chart's x-axis variable so we only sync charts
        // that share the same independent variable.
        let sourceXVar = null;
        for (const entry of this.charts.values()) {
            if (entry.chart === sourceChart) { sourceXVar = entry.xVar; break; }
        }
        for (const entry of this.charts.values()) {
            if (!entry.chart || entry.chart === sourceChart) continue;
            // Only sync charts with the same x-axis variable
            if (entry.xVar !== sourceXVar) continue;
            const dsLen = entry.chart.data.datasets[0]?.data?.length || 0;
            if (index >= dsLen) continue;
            entry.chart._sgcSyncIndex = index;
            entry.chart.setActiveElements([{ datasetIndex: 0, index }]);
            entry.chart.tooltip.setActiveElements(
                [{ datasetIndex: 0, index }],
                { x: 0, y: 0 },
            );
            entry.chart.update('none');
        }
    }

    _clearCrosshair(sourceChart) {
        for (const entry of this.charts.values()) {
            if (!entry.chart || entry.chart === sourceChart) continue;
            if (entry.chart._sgcSyncIndex == null) continue;
            entry.chart._sgcSyncIndex = null;
            entry.chart.setActiveElements([]);
            entry.chart.tooltip.setActiveElements([], { x: 0, y: 0 });
            entry.chart.update('none');
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
        this._destroyed = true;
        this._stopTransformPolling();
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        for (const entry of this.charts.values()) {
            if (entry._dragCleanup) entry._dragCleanup();
            if (entry._resizeCleanup) entry._resizeCleanup();
            if (entry.chart) entry.chart.destroy();
            entry.box.remove();
        }
        this.charts.clear();
        this._compiledScripts.clear();
        this.pinnedCharts = [];
        if (this._sliderPanel) this._sliderPanel.remove();
        if (this._pinnedPanel) this._pinnedPanel.remove();
        if (this._legendPanel) this._legendPanel.remove();
    }
}
