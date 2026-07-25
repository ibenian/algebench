// ============================================================
// fa-page.js — Function Analysis page.
//
// A full-page, expert-generated apparatus shown IN PLACE of the semantic
// graph view (inside #graph-viewport). Triggered from a semantic-graph
// node's ƒ button; the resulting artifact `{id, title, characteristics,
// proposal}` attaches to the CURRENT proof step (session-only,
// `step.functionAnalyses`) and is listed as a child of that step in the
// Math tab tree.
//
// Trust model: every curve and annotation position evaluated here comes
// from a SymPy-generated mathjs script (characteristics.chartScript,
// view.plots[].script, annotation.at/to.script) compiled through the
// expr.js sandbox — LM output contributes *expressions and prose*, never
// code. AI-written prose gets a hover-revealed ask button
// (makeAiAskButton) so the learner can interrogate any of it in chat.
// ============================================================

import { invokeExpert } from '/expert-client.js';
import { compileExpr, evalExpr } from '/expr.js';
import { AI_ICON, BRACES_ICON, TRASH_ICON } from '/icons.js';
import { makeAiAskButton, renderKaTeX } from '/labels.js';
import { loadChartJs } from '/graph-panel/sg-chart.js';

const REQUEST_TIMEOUT_MS = 180_000;   // LM proposal is ~5-10s; generous ceiling
const NUM_POINTS = 220;

const SERIES_COLORS = ['#42a5f5', '#ffa726', '#66bb6a', '#ab47bc'];
const ANNOTATION_COLOR = 'rgba(239, 83, 80, 0.75)';
const BAND_FILL = 'rgba(66, 165, 245, 0.10)';

// Session cache: request shape -> response, so re-analyzing the same node
// with the same context never re-bills the LM (mirrors sg-proof's cache).
const _FA_CACHE = new Map();
const _cacheKey = (p) => JSON.stringify({ l: p.latex, v: p.variable || '', c: p.context || '' });

let _idCounter = 0;

/** Greek-ish LaTeX → readable text for plain contexts (axis labels, chips). */
function detex(s) {
    return String(s || '')
        .replace(/\\(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Pi|Sigma|Phi|Psi|Omega)/g,
            (_, name) => ({
                alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
                zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
                lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
                sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ',
                psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ',
                Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ',
                Omega: 'Ω',
            }[name] || name))
        .replace(/[{}$]/g, '');
}

export class FunctionAnalysisManager {
    /**
     * @param {Object} opts
     *   getViewport      () => #graph-viewport element
     *   katex            window.katex
     *   onArtifactsChanged (step) => void   — rebuild the Math tab tree
     *   onPageClosed     () => void         — restore the graph view
     *   buildContext     (step) => string   — lesson/step context for the expert
     */
    constructor(opts = {}) {
        this.katex = opts.katex || (typeof window !== 'undefined' && window.katex);
        this.getViewport = opts.getViewport ||
            (() => document.getElementById('graph-viewport'));
        this.onArtifactsChanged = opts.onArtifactsChanged || (() => {});
        this.onPageClosed = opts.onPageClosed || (() => {});
        this.buildContext = opts.buildContext || (() => '');
        this.pageEl = null;            // lazily created #fa-page-container
        this.activeArtifact = null;
        this._charts = [];             // live Chart.js instances (destroyed per render)
        this._hiddenEls = [];          // graph elements hidden while page shows
        this._hiddenGroups = new Set();// annotation groups toggled off (per render)
        // Artifacts are kept OFF the step objects on purpose: steps are
        // serialized wholesale into chat context and proof saves, and an
        // artifact both back-references its step (a JSON cycle) and carries
        // kilobytes of analysis data. Session-only side storage instead.
        this._byStep = new WeakMap();  // step -> artifact[]
    }

    /** Artifacts attached to a step (render order). */
    listFor(step) {
        return (step && this._byStep.get(step)) || [];
    }

    /* ------------------------------------------------------------------ */
    /* Artifact lifecycle                                                 */
    /* ------------------------------------------------------------------ */

    /** Start a new analysis for a node's subexpr, attached to `step`.
     *  Re-clicking a node whose analysis already exists re-focuses it
     *  (same dedup contract as SgProofManager) — multiple artifacts per
     *  step are for DIFFERENT expressions, not accidental double-clicks. */
    open(nodeData, step) {
        if (!step) return;
        const latex = nodeData.subexpr || nodeData.latex;
        if (!latex) return;
        const existing = this.listFor(step).find(a =>
            a.nodeId === nodeData.id && a.latex === latex);
        if (existing) {
            this.show(existing);
            return;
        }
        const artifact = {
            id: `fa-pending-${++_idCounter}`,
            title: '',
            status: 'loading',
            latex,
            nodeId: nodeData.id,
            step,
            data: null,
            error: null,
        };
        const list = this._byStep.get(step) || [];
        list.push(artifact);
        this._byStep.set(step, list);
        this.onArtifactsChanged(step);
        this.show(artifact);
        this._run(artifact);
    }

    async _run(artifact) {
        const payload = {
            latex: artifact.latex,
            context: String(this.buildContext(artifact.step) || '').slice(0, 2000),
        };
        const key = _cacheKey(payload);
        artifact.cacheKey = key;      // so delete can evict it (see remove)
        try {
            let data = _FA_CACHE.get(key);
            if (!data) {
                data = await invokeExpert('expression_analysis', payload,
                                          { timeoutMs: REQUEST_TIMEOUT_MS });
                if (data && data.characteristics && !data.characteristics.error) {
                    _FA_CACHE.set(key, data);
                }
            }
            if (data && data.characteristics && data.characteristics.error) {
                throw new Error(data.characteristics.error);
            }
            artifact.status = 'ready';
            artifact.data = data;
            artifact.id = data.id || artifact.id;
            artifact.title = data.title ||
                (data.proposal && data.proposal.title) || 'Function analysis';
        } catch (e) {
            artifact.status = 'error';
            artifact.error = (e && e.message) || 'Analysis failed.';
        }
        this.onArtifactsChanged(artifact.step);
        if (this.activeArtifact === artifact) this.show(artifact);
    }

    retry(artifact) {
        artifact.status = 'loading';
        artifact.error = null;
        this.onArtifactsChanged(artifact.step);
        this.show(artifact);
        this._run(artifact);
    }

    /** Delete an artifact: drop it from its step, evict its cached response
     *  (so re-triggering the same node genuinely re-analyzes), and close
     *  the page if it is the one showing. */
    remove(artifact) {
        const list = this._byStep.get(artifact.step);
        if (Array.isArray(list)) {
            const i = list.indexOf(artifact);
            if (i >= 0) list.splice(i, 1);
        }
        if (artifact.cacheKey) _FA_CACHE.delete(artifact.cacheKey);
        if (this.activeArtifact === artifact) this.close();
        this.onArtifactsChanged(artifact.step);
    }

    /* ------------------------------------------------------------------ */
    /* Page hosting (swap in place of the graph)                          */
    /* ------------------------------------------------------------------ */

    _ensurePage() {
        if (this.pageEl && this.pageEl.isConnected) return this.pageEl;
        const vp = this.getViewport();
        if (!vp) return null;
        const el = document.createElement('div');
        el.id = 'fa-page-container';
        vp.appendChild(el);
        this.pageEl = el;
        return el;
    }

    /** Show the page for an artifact (loading, error, or ready). */
    show(artifact) {
        const page = this._ensurePage();
        if (!page) return;
        this.activeArtifact = artifact;
        this._hideGraphChrome();
        page.classList.add('open');
        this._render(artifact);
        this.onArtifactsChanged(artifact.step);   // tree highlight follows
    }

    /** Close the page and restore the graph view. */
    close() {
        this.activeArtifact = null;
        this._destroyCharts();
        if (this.pageEl) this.pageEl.classList.remove('open');
        this._restoreGraphChrome();
        this.onPageClosed();
    }

    isOpen() {
        return !!(this.pageEl && this.pageEl.classList.contains('open'));
    }

    _hideGraphChrome() {
        if (this._hiddenEls.length) return;   // already hidden
        const vp = this.getViewport();
        if (!vp) return;
        for (const child of vp.children) {
            if (child === this.pageEl) continue;
            if (!child.classList.contains('hidden')) {
                child.classList.add('fa-hidden');
                this._hiddenEls.push(child);
            }
        }
    }

    _restoreGraphChrome() {
        for (const el of this._hiddenEls) el.classList.remove('fa-hidden');
        this._hiddenEls = [];
    }

    _destroyCharts() {
        for (const c of this._charts) { try { c.destroy(); } catch (_e) {} }
        this._charts = [];
    }

    /* ------------------------------------------------------------------ */
    /* Rendering                                                          */
    /* ------------------------------------------------------------------ */

    _render(artifact) {
        const page = this.pageEl;
        this._destroyCharts();
        this._hiddenGroups = new Set();
        page.innerHTML = '';

        page.appendChild(this._renderHeader(artifact));

        if (artifact.status === 'loading') {
            page.appendChild(this._renderLoading(artifact));
            return;
        }
        if (artifact.status === 'error') {
            page.appendChild(this._renderErrorCard(artifact));
            return;
        }

        const proposal = (artifact.data && artifact.data.proposal) || {};
        const chars = (artifact.data && artifact.data.characteristics) || {};

        if (proposal.abstain) {
            const card = document.createElement('div');
            card.className = 'fa-card fa-abstain';
            card.textContent = 'The expert found nothing behaviorally ' +
                'interesting to visualize for this expression.';
            page.appendChild(card);
            return;
        }

        if (proposal.story) page.appendChild(this._renderStory(artifact, proposal));
        page.appendChild(this._renderViews(artifact, chars, proposal));
        page.appendChild(this._renderQuiz(artifact, chars, proposal));
        page.appendChild(this._renderJsonPanel(artifact));
    }

    _renderHeader(artifact) {
        const head = document.createElement('div');
        head.className = 'fa-header';

        const back = document.createElement('button');
        back.className = 'fa-btn fa-back';
        back.title = 'Back to semantic graph';
        back.innerHTML = '&#8592;';
        back.addEventListener('click', () => this.close());

        const title = document.createElement('span');
        title.className = 'fa-title';
        title.textContent = artifact.title || 'Function analysis';

        const expr = document.createElement('span');
        expr.className = 'fa-expr';
        this._katex(expr, artifact.latex);

        head.append(back, title, expr);

        if (artifact.status === 'ready') {
            const jsonBtn = document.createElement('button');
            jsonBtn.className = 'fa-btn fa-json-btn';
            jsonBtn.title = 'Show the raw analysis JSON';
            jsonBtn.innerHTML = BRACES_ICON;   // shared { } glyph (matches toolbar)
            jsonBtn.addEventListener('click', () => {
                const overlay = this.pageEl.querySelector('.fa-json-overlay');
                if (overlay) overlay.classList.toggle('open');
            });
            head.appendChild(jsonBtn);
        }

        // Discard: drops the artifact from the step + tree and evicts its
        // cached response, so re-running the node is a genuine re-analysis.
        const del = document.createElement('button');
        del.className = 'fa-btn fa-delete-btn';
        del.title = 'Delete this analysis';
        del.innerHTML = TRASH_ICON;
        del.addEventListener('click', () => this.remove(artifact));
        head.appendChild(del);
        return head;
    }

    _renderLoading(artifact) {
        const wrap = document.createElement('div');
        wrap.className = 'fa-card fa-status';
        wrap.innerHTML =
            '<span class="sgp-dots"><span></span><span></span><span></span></span>';
        const label = document.createElement('span');
        label.className = 'fa-status-label';
        label.appendChild(document.createTextNode('Analyzing '));
        const m = document.createElement('span');
        this._katex(m, artifact.latex);
        label.appendChild(m);
        label.appendChild(document.createTextNode('…'));
        wrap.appendChild(label);
        return wrap;
    }

    _renderErrorCard(artifact) {
        const wrap = document.createElement('div');
        wrap.className = 'fa-card fa-error';
        const msg = document.createElement('div');
        msg.textContent = artifact.error || 'Analysis failed.';
        const retry = document.createElement('button');
        retry.className = 'fa-btn fa-retry';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => this.retry(artifact));
        wrap.append(msg, retry);
        return wrap;
    }

    _renderStory(artifact, proposal) {
        const card = document.createElement('div');
        card.className = 'fa-card fa-story';
        const badge = document.createElement('span');
        badge.className = 'fa-ai-badge';
        badge.title = 'AI-generated';
        badge.innerHTML = AI_ICON;
        const text = document.createElement('span');
        this._inlineMath(text, ' ' + proposal.story);
        card.append(badge, text);
        this._attachHoverAsk(card, () =>
            `About $${artifact.latex}$ — the analysis says: "${proposal.story}". ` +
            'Can you explain this behavior in more depth?');
        return card;
    }

    /* ---------------- views + charts ---------------------------------- */

    _renderViews(artifact, chars, proposal) {
        const card = document.createElement('div');
        card.className = 'fa-card fa-views';
        const views = (proposal.views || []).filter(v => !v.unknown_symbols);
        if (!views.length) {
            card.textContent = 'No renderable viewport was proposed.';
            return card;
        }

        const tabs = document.createElement('div');
        tabs.className = 'fa-view-tabs';
        const rationale = document.createElement('div');
        rationale.className = 'fa-view-rationale';
        const legend = document.createElement('div');
        legend.className = 'fa-ann-legend';
        const canvasWrap = document.createElement('div');
        canvasWrap.className = 'fa-canvas-wrap';
        const exprPanel = document.createElement('div');
        exprPanel.className = 'fa-expr-panel';
        const sliders = document.createElement('div');
        sliders.className = 'fa-sliders';

        // Toggle revealing exactly what each curve plots — the LaTeX and the
        // CAS-generated script actually evaluated (LM proposes expressions;
        // SymPy writes the code).
        const exprBtn = document.createElement('button');
        exprBtn.className = 'fa-btn fa-expr-btn';
        exprBtn.title = 'Show the expressions plotted in this chart';
        exprBtn.textContent = 'ƒ(x)';
        exprBtn.addEventListener('click', () => {
            exprPanel.classList.toggle('open');
            exprBtn.classList.toggle('open');
        });

        card.append(tabs, rationale, legend, canvasWrap, exprPanel, sliders);

        const state = { viewIdx: 0, pins: {} };

        const activate = (idx) => {
            state.viewIdx = idx;
            const view = views[idx];
            state.pins = { ...(view.pinned || {}) };
            this._hiddenGroups = new Set();
            [...tabs.querySelectorAll('.fa-view-tab')].forEach((b, i) =>
                b.classList.toggle('active', i === idx));
            this._renderExprPanel(exprPanel, chars, view);
            if (view.rationale) {
                rationale.innerHTML = '';
                const badge = document.createElement('span');
                badge.className = 'fa-ai-badge';
                badge.title = 'AI-generated';
                badge.innerHTML = AI_ICON;
                const rtext = document.createElement('span');
                this._inlineMath(rtext, ' ' + view.rationale);
                rationale.append(badge, rtext);
                this._attachHoverAsk(rationale, () =>
                    `For $${artifact.latex}$, the analysis chose this view: ` +
                    `"${view.rationale}". Why is this range interesting?`);
            } else {
                rationale.textContent = '';
            }
            // Build the chart ONCE per view; slider moves update data in
            // place (no destroy/recreate, no animation — no flicker).
            const chart = this._renderChart(artifact, chars, view, canvasWrap, legend, state);
            const update = () => this._updateChartData(chart, chars, view, state);
            this._renderSliders(artifact, chars, proposal, view, sliders, state, update);
        };

        views.forEach((view, i) => {
            const b = document.createElement('button');
            b.className = 'fa-btn fa-view-tab';
            const xv = this._varText(chars, view.x_var);
            b.textContent = `View ${i + 1}: ${xv} ∈ [${(view.x_range || []).join(', ')}]`;
            b.addEventListener('click', () => activate(i));
            tabs.appendChild(b);
        });
        tabs.appendChild(exprBtn);      // after the view tabs, right-aligned

        loadChartJs().then(() => activate(0)).catch(() => {
            canvasWrap.textContent = 'Chart library failed to load.';
        });
        return card;
    }

    /** What this chart actually plots: each curve's expression (LaTeX) and
     *  the mathjs script evaluated for it, plus any annotation positions.
     *  Every script here is SymPy-generated server-side. */
    _renderExprPanel(host, chars, view) {
        host.innerHTML = '';
        const row = (color, label, latex, script) => {
            const r = document.createElement('div');
            r.className = 'fa-expr-row';
            const swatch = document.createElement('span');
            swatch.className = 'fa-expr-swatch';
            if (color) swatch.style.background = color;
            else swatch.classList.add('fa-expr-swatch-ann');
            const name = document.createElement('span');
            name.className = 'fa-expr-label';
            // Labels are AI-written prose that may carry inline $…$ math.
            this._inlineMath(name, label);
            const math = document.createElement('span');
            math.className = 'fa-expr-math';
            // Positions/expressions are bare LaTeX, but an LM-written plot
            // label can arrive $-wrapped — route those through _inlineMath.
            if (/\$/.test(latex)) this._inlineMath(math, latex);
            else this._katex(math, latex);
            const code = document.createElement('code');
            code.className = 'fa-expr-code';
            code.textContent = script;
            r.append(swatch, name, math, code);
            host.appendChild(r);
        };

        const main = chars.chartScript;
        if (main && main.script) {
            row(SERIES_COLORS[0], 'curve', chars.expression || '', main.script);
        }
        (view.plots || []).forEach((p, i) => {
            if (!p.script) return;
            row(SERIES_COLORS[(i + 1) % SERIES_COLORS.length],
                p.label || 'companion', p.latex || '', p.script);
        });
        for (const a of view.annotations || []) {
            const at = a.at && a.at.latex ? a.at.latex : '';
            const to = a.to && a.to.latex ? ` … ${a.to.latex}` : '';
            row(null, a.label || a.kind, at + to,
                (a.at && a.at.script ? a.at.script : '') +
                (a.to && a.to.script ? `  …  ${a.to.script}` : ''));
        }
        if (!host.children.length) {
            host.textContent = 'No evaluable expression for this view.';
        }
    }

    /** All evaluable series for a view: main curve + companion plots. */
    _seriesFor(chars, view) {
        const out = [];
        const main = chars.chartScript;
        if (main && main.script) {
            out.push({ label: 'f', script: main.script, main: true });
        }
        for (const p of view.plots || []) {
            if (p.script) out.push({ label: p.label || p.latex, script: p.script });
        }
        return out;
    }

    _scopeFor(chars, view, pins, xValue) {
        const scope = {};
        for (const name of chars.variables || []) scope[name] = 1;
        Object.assign(scope, pins);
        scope[view.x_var] = xValue;
        return scope;
    }

    _renderChart(artifact, chars, view, canvasWrap, legend, state) {
        this._destroyCharts();
        canvasWrap.innerHTML = '';
        const canvas = document.createElement('canvas');
        canvasWrap.appendChild(canvas);
        // Annotation labels live in an HTML layer over the canvas so they
        // render as KaTeX — canvas fillText can only draw raw LaTeX source.
        const labelLayer = document.createElement('div');
        labelLayer.className = 'fa-chart-labels';
        canvasWrap.appendChild(labelLayer);

        const [xa, xb] = (view.x_range && view.x_range.length === 2)
            ? view.x_range : [-5, 5];
        const series = this._seriesFor(chars, view);
        const compiled = series.map(s => {
            try { return compileExpr(s.script); } catch (_e) { return null; }
        });

        const xs = [];
        for (let i = 0; i <= NUM_POINTS; i++) {
            xs.push(xa + (xb - xa) * i / NUM_POINTS);
        }
        const datasets = series.map((s, si) => ({
            label: detex(s.label),
            data: xs.map(x => {
                if (!compiled[si]) return null;
                try {
                    const y = evalExpr(compiled[si], 0,
                        { overrideScope: this._scopeFor(chars, view, state.pins, x) });
                    return Number.isFinite(y) ? y : null;
                } catch (_e) { return null; }
            }),
            borderColor: SERIES_COLORS[si % SERIES_COLORS.length],
            backgroundColor: SERIES_COLORS[si % SERIES_COLORS.length] + '22',
            borderWidth: s.main ? 2 : 1.5,
            borderDash: s.main ? [] : [6, 4],
            pointRadius: 0,
            pointHitRadius: 6,
            fill: false,
            tension: 0.25,
            spanGaps: false,
        }));

        // Evaluate annotation positions under the current pins (slider-reactive).
        const annotations = this._evalAnnotations(chars, view, state.pins);
        const marks = new Set(view.mark || []);
        // The plugin reads LIVE state off chart.$fa so in-place updates
        // (sliders, group toggles) re-draw overlays without a rebuild.
        const featurePlugin = {
            id: 'faFeatures',
            afterDraw: (chart) => {
                const fa = chart.$fa;
                if (!fa) return;
                this._drawOverlays(chart, chart.data.datasets[0], fa.xs,
                                   fa.marks, fa.anns);
            },
        };

        const xv = this._varText(chars, view.x_var);
        const chart = new Chart(canvas, {
            type: 'line',
            plugins: [featurePlugin],
            data: { labels: xs.map(x => +x.toFixed(6)), datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,      // slider-driven updates must not flicker
                plugins: {
                    legend: {
                        display: datasets.length > 1,
                        labels: { color: '#aebbd1', boxWidth: 18 },
                    },
                    tooltip: {
                        backgroundColor: 'rgba(10, 12, 26, 0.9)',
                        titleColor: '#dde6ff',
                        bodyColor: '#aebbd1',
                        callbacks: {
                            title: (items) =>
                                `${xv} = ${items[0] ? (+items[0].label).toFixed(4) : ''}`,
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: xv, color: '#8fa8c8' },
                        ticks: { color: '#7e8aa3', maxTicksLimit: 9,
                                 callback: v => +Number(v).toFixed(3) },
                        // The zero axis draws clearly stronger than the grid.
                        grid: {
                            color: (c) => c.tick && c.tick.value === 0
                                ? 'rgba(174, 187, 209, 0.85)'
                                : 'rgba(110, 124, 180, 0.12)',
                            lineWidth: (c) => c.tick && c.tick.value === 0 ? 1.6 : 1,
                        },
                    },
                    y: {
                        ticks: { color: '#7e8aa3', maxTicksLimit: 7,
                                 callback: v => +Number(v).toFixed(3) },
                        grid: {
                            color: (c) => c.tick && c.tick.value === 0
                                ? 'rgba(174, 187, 209, 0.85)'
                                : 'rgba(110, 124, 180, 0.12)',
                            lineWidth: (c) => c.tick && c.tick.value === 0 ? 1.6 : 1,
                        },
                    },
                },
                interaction: { mode: 'index', intersect: false },
            },
        });
        // Sticky y-bounds: computed from the initial data and only ever
        // EXPANDED by slider moves — a shrinking auto-scale re-derives its
        // ticks every tick of the drag, which reads as axis flicker.
        const yb = this._yBounds(datasets);
        chart.options.scales.y.min = yb.min;
        chart.options.scales.y.max = yb.max;
        chart.$fa = {
            xs,
            marks,
            compiled,
            yb,
            anns: annotations.filter(a => !this._hiddenGroups.has(a.group || '')),
        };
        this._renderAnnLegend(legend, view, annotations,
            () => this._updateChartData(chart, chars, view, state));
        this._charts.push(chart);
        return chart;
    }

    /** In-place data refresh for slider moves / group toggles — no rebuild. */
    _updateChartData(chart, chars, view, state) {
        const fa = chart && chart.$fa;
        if (!fa) return;
        chart.data.datasets.forEach((ds, si) => {
            ds.data = fa.xs.map(x => {
                if (!fa.compiled[si]) return null;
                try {
                    const y = evalExpr(fa.compiled[si], 0,
                        { overrideScope: this._scopeFor(chars, view, state.pins, x) });
                    return Number.isFinite(y) ? y : null;
                } catch (_e) { return null; }
            });
        });
        const annotations = this._evalAnnotations(chars, view, state.pins);
        fa.anns = annotations.filter(a => !this._hiddenGroups.has(a.group || ''));
        // Expand-only y-bounds (see _renderChart) — never shrink mid-drag.
        const b = this._yBounds(chart.data.datasets);
        if (b.min < fa.yb.min || b.max > fa.yb.max) {
            fa.yb.min = Math.min(fa.yb.min, b.min);
            fa.yb.max = Math.max(fa.yb.max, b.max);
            chart.options.scales.y.min = fa.yb.min;
            chart.options.scales.y.max = fa.yb.max;
        }
        chart.update('none');
    }

    /** Place annotation labels as KaTeX-rendered HTML over the canvas.
     *  Called from the draw plugin, so positions follow every slider move
     *  and resize. Canvas text can't render math; this layer can. */
    _syncLabels(chart, labels) {
        const layer = chart.canvas.parentNode &&
            chart.canvas.parentNode.querySelector('.fa-chart-labels');
        if (!layer) return;
        layer.innerHTML = '';
        for (const l of labels) {
            const el = document.createElement('span');
            el.className = 'fa-chart-label' + (l.band ? ' band' : '');
            el.style.left = `${l.left}px`;
            el.style.top = `${l.top}px`;
            this._inlineMath(el, l.text);
            layer.appendChild(el);
        }
    }

    /** Padded finite y-extent across all datasets. */
    _yBounds(datasets) {
        const ys = [];
        for (const ds of datasets) {
            for (const y of ds.data) if (Number.isFinite(y)) ys.push(y);
        }
        if (!ys.length) return { min: -1, max: 1 };
        let min = Math.min(...ys), max = Math.max(...ys);
        if (min === max) { min -= 1; max += 1; }
        const pad = (max - min) * 0.06;
        return { min: min - pad, max: max + pad };
    }

    _evalAnnotations(chars, view, pins) {
        const out = [];
        for (const ann of view.annotations || []) {
            const val = this._evalPos(chars, view, pins, ann.at);
            if (val == null) continue;
            const entry = { ...ann, atValue: val };
            if (ann.kind === 'band') {
                const to = this._evalPos(chars, view, pins, ann.to);
                if (to == null) continue;
                entry.toValue = to;
            }
            out.push(entry);
        }
        return out;
    }

    _evalPos(chars, view, pins, pos) {
        if (!pos || !pos.script) return null;
        try {
            const compiled = compileExpr(pos.script);
            const scope = this._scopeFor(chars, view, pins, 1);
            const v = evalExpr(compiled, 0, { overrideScope: scope });
            return Number.isFinite(v) ? v : null;
        } catch (_e) { return null; }
    }

    _renderAnnLegend(legend, view, annotations, redraw) {
        legend.innerHTML = '';
        const groups = new Map();   // group label -> count
        for (const a of annotations) {
            const g = a.group || '';
            groups.set(g, (groups.get(g) || 0) + 1);
        }
        if (!annotations.length) return;
        for (const [g] of groups) {
            const chip = document.createElement('button');
            chip.className = 'fa-btn fa-ann-chip' +
                (this._hiddenGroups.has(g) ? ' off' : '');
            chip.textContent = g || 'markers';
            chip.title = 'Toggle these markers';
            chip.addEventListener('click', () => {
                if (this._hiddenGroups.has(g)) this._hiddenGroups.delete(g);
                else this._hiddenGroups.add(g);
                redraw();
            });
            legend.appendChild(chip);
        }
    }

    /** Numeric feature markers (from the main dataset) + AI annotations. */
    _drawOverlays(chart, mainDataset, xs, marks, annotations) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.x || !scales.y) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top,
                 chartArea.right - chartArea.left,
                 chartArea.bottom - chartArea.top);
        ctx.clip();

        // ── zero axes: always clearly visible when 0 is in range ─────
        ctx.strokeStyle = 'rgba(174, 187, 209, 0.7)';
        ctx.lineWidth = 1.4;
        if (scales.y.min < 0 && scales.y.max > 0) {
            const py = scales.y.getPixelForValue(0);
            ctx.beginPath();
            ctx.moveTo(chartArea.left, py);
            ctx.lineTo(chartArea.right, py);
            ctx.stroke();
        }
        if (scales.x.min < 0 && scales.x.max > 0) {
            const px = scales.x.getPixelForValue(0);
            ctx.beginPath();
            ctx.moveTo(px, chartArea.top);
            ctx.lineTo(px, chartArea.bottom);
            ctx.stroke();
        }
        ctx.lineWidth = 1;

        // ── AI annotations: vline / hline / band ─────────────────────
        // Lines are drawn on the canvas; their labels are collected and
        // rendered as KaTeX in the HTML layer above it (see _syncLabels).
        const labels = [];
        for (const a of annotations) {
            if (a.kind === 'vline') {
                const px = scales.x.getPixelForValue(a.atValue);
                ctx.strokeStyle = ANNOTATION_COLOR;
                ctx.setLineDash([5, 4]);
                ctx.beginPath();
                ctx.moveTo(px, chartArea.top);
                ctx.lineTo(px, chartArea.bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                if (a.label) {
                    labels.push({ text: a.label, left: px + 5, top: chartArea.top + 3 });
                }
            } else if (a.kind === 'hline') {
                const py = scales.y.getPixelForValue(a.atValue);
                ctx.strokeStyle = ANNOTATION_COLOR;
                ctx.setLineDash([5, 4]);
                ctx.beginPath();
                ctx.moveTo(chartArea.left, py);
                ctx.lineTo(chartArea.right, py);
                ctx.stroke();
                ctx.setLineDash([]);
                if (a.label) {
                    labels.push({ text: a.label, left: chartArea.left + 6, top: py - 17 });
                }
            } else if (a.kind === 'band') {
                const p0 = scales.x.getPixelForValue(Math.min(a.atValue, a.toValue));
                const p1 = scales.x.getPixelForValue(Math.max(a.atValue, a.toValue));
                ctx.fillStyle = BAND_FILL;
                ctx.fillRect(p0, chartArea.top, p1 - p0,
                             chartArea.bottom - chartArea.top);
                if (a.label) {
                    labels.push({ text: a.label, left: p0 + 5,
                                  top: chartArea.bottom - 20, band: true });
                }
            }
        }
        this._syncLabels(chart, labels);

        // ── numeric feature markers on the main curve ────────────────
        if (mainDataset) {
            const ys = mainDataset.data;
            if (marks.has('zeros')) {
                ctx.fillStyle = '#dde6ff';
                for (let i = 1; i < ys.length; i++) {
                    if (ys[i - 1] == null || ys[i] == null) continue;
                    if (Math.sign(ys[i - 1]) !== Math.sign(ys[i]) &&
                        Math.abs(ys[i - 1]) < 1e6) {
                        const x = (xs[i - 1] + xs[i]) / 2;
                        ctx.beginPath();
                        ctx.arc(scales.x.getPixelForValue(x),
                                scales.y.getPixelForValue(0), 3.5, 0, 7);
                        ctx.fill();
                    }
                }
            }
            if (marks.has('extrema')) {
                ctx.fillStyle = '#ffa726';
                for (let i = 2; i < ys.length - 2; i++) {
                    const w = ys.slice(i - 2, i + 3);
                    if (w.some(y => y == null)) continue;
                    const c = ys[i];
                    const isMax = w.every(y => y <= c) && ys[i - 2] < c && ys[i + 2] < c;
                    const isMin = w.every(y => y >= c) && ys[i - 2] > c && ys[i + 2] > c;
                    if (isMax || isMin) {
                        ctx.beginPath();
                        ctx.arc(scales.x.getPixelForValue(xs[i]),
                                scales.y.getPixelForValue(c), 4, 0, 7);
                        ctx.fill();
                    }
                }
            }
            if (marks.has('singularities')) {
                ctx.strokeStyle = ANNOTATION_COLOR;
                ctx.setLineDash([3, 3]);
                for (let i = 1; i < ys.length; i++) {
                    if ((ys[i - 1] == null) !== (ys[i] == null)) {
                        const x = (xs[i - 1] + xs[i]) / 2;
                        const px = scales.x.getPixelForValue(x);
                        ctx.beginPath();
                        ctx.moveTo(px, chartArea.top);
                        ctx.lineTo(px, chartArea.bottom);
                        ctx.stroke();
                    }
                }
                ctx.setLineDash([]);
            }
        }
        ctx.restore();
    }

    /* ---------------- sliders ------------------------------------------ */

    _renderSliders(artifact, chars, proposal, view, host, state, onChange) {
        host.innerHTML = '';
        const pins = view.pinned || {};
        const names = Object.keys(pins);
        if (!names.length) return;

        for (const name of names) {
            const row = document.createElement('div');
            row.className = 'fa-slider-row';

            const sym = document.createElement('span');
            sym.className = 'fa-var';
            this._katex(sym, this._varLatex(chars, name));
            const desc = (proposal.variable_glossary || {})[name];
            if (desc) this._attachVarTooltip(sym, desc);
            // Ask button anchored at the variable's top-right corner,
            // revealed while hovering anywhere on the slider row.
            const ask = makeAiAskButton('ai-ask-btn fa-hover-ask fa-var-ask',
                'Ask the AI about this variable', () =>
                `In $${artifact.latex}$, what does the variable ` +
                `$${this._varLatex(chars, name)}$ represent` +
                (desc ? ` — the analysis says "${desc}"` : '') +
                '? Why does it matter here?');
            sym.appendChild(ask);
            row.classList.add('fa-askable');

            const v0 = Number(pins[name]) || 0;
            const lo = v0 === 0 ? -10 : Math.min(0, v0 * 3);
            const hi = v0 === 0 ? 10 : Math.max(v0 * 3, 0.001);
            const input = document.createElement('input');
            input.type = 'range';
            input.min = lo; input.max = hi; input.step = (hi - lo) / 200;
            input.value = state.pins[name] != null ? state.pins[name] : v0;

            const val = document.createElement('span');
            val.className = 'fa-slider-val';
            val.textContent = (+input.value).toFixed(2);

            input.addEventListener('input', () => {
                state.pins[name] = parseFloat(input.value);
                val.textContent = (+input.value).toFixed(2);
                onChange();
            });

            row.append(sym, input, val);
            host.appendChild(row);
        }
    }

    /* ---------------- quiz --------------------------------------------- */

    _renderQuiz(artifact, chars, proposal) {
        const card = document.createElement('div');
        card.className = 'fa-card fa-quiz';
        const label = document.createElement('div');
        label.className = 'fa-sect-label';
        label.textContent = 'Quiz';
        card.appendChild(label);

        const list = document.createElement('div');
        list.className = 'fa-quiz-list';
        card.appendChild(list);

        const appendProbes = (probes) => {
            const startIdx = list.querySelectorAll('.fa-probe').length;
            probes.forEach((p, i) => {
                list.appendChild(this._renderProbe(artifact, p, startIdx + i + 1));
            });
        };
        appendProbes(proposal.probes || []);

        // "More…" — same expert, more_probes verb, excluding asked questions.
        const more = document.createElement('button');
        more.className = 'fa-btn fa-more';
        more.textContent = 'More…';
        const moreStatus = document.createElement('span');
        moreStatus.className = 'fa-more-status';
        more.addEventListener('click', async () => {
            more.disabled = true;
            moreStatus.innerHTML =
                '<span class="sgp-dots"><span></span><span></span><span></span></span>';
            const asked = [...list.querySelectorAll('.fa-probe .fa-probe-q')]
                .map(el => el.dataset.question || '');
            try {
                const res = await invokeExpert('expression_analysis', {
                    verb: 'more_probes',
                    latex: artifact.latex,
                    characteristics: chars,
                    context: String(this.buildContext(artifact.step) || '').slice(0, 2000),
                    asked,
                }, { timeoutMs: REQUEST_TIMEOUT_MS });
                const probes = (res && res.probes) || [];
                if (probes.length) {
                    appendProbes(probes);
                    // The artifact's in-memory JSON is the single source of
                    // truth: fold the new probes in so re-opening the page
                    // re-renders them and the { } popup shows them.
                    proposal.probes = [...(proposal.probes || []), ...probes];
                    const pre = this.pageEl.querySelector('.fa-json-modal pre');
                    if (pre) pre.textContent = JSON.stringify(artifact.data, null, 2);
                }
                moreStatus.textContent = probes.length ? '' : 'No new questions.';
            } catch (e) {
                moreStatus.textContent = (e && e.message) || 'Failed.';
            }
            more.disabled = false;
        });
        card.append(more, moreStatus);
        return card;
    }

    _renderProbe(artifact, probe, number) {
        const div = document.createElement('div');
        div.className = 'fa-probe';
        const q = document.createElement('div');
        q.className = 'fa-probe-q';
        q.dataset.question = probe.question || '';
        const badge = document.createElement('span');
        badge.className = 'fa-ai-badge';
        badge.title = 'AI-generated';
        badge.innerHTML = AI_ICON;
        q.appendChild(badge);
        q.appendChild(document.createTextNode(`${number}. `));
        this._inlineMath(q, probe.question || '');
        // Pre-answer ask: hints ONLY — revealing the answer would destroy the
        // predict-before-reveal value of the quiz. The post-answer button
        // (added on click) is the one that discusses the actual answer.
        this._attachHoverAsk(q, () =>
            `I'm working on a quiz question about $${artifact.latex}$ and I ` +
            `have NOT answered it yet.\nQuestion: "${probe.question}"\n` +
            `IMPORTANT: do NOT tell me the answer and do NOT identify or hint ` +
            `at which option is correct. Give me ONE guiding hint or a leading ` +
            `question that helps me reason it out myself — think Socratic tutor.`);
        div.appendChild(q);

        const opts = document.createElement('div');
        opts.className = 'fa-probe-opts';
        const exp = document.createElement('div');
        exp.className = 'fa-probe-exp';
        this._inlineMath(exp, probe.explanation || '');

        (probe.options || []).forEach((o, i) => {
            const b = document.createElement('button');
            b.className = 'fa-btn fa-probe-chip';
            this._inlineMath(b, o);
            b.addEventListener('click', () => {
                for (const c of opts.children) c.disabled = true;
                const right = i === probe.correct_index;
                b.classList.add(right ? 'right' : 'wrong');
                if (!right && opts.children[probe.correct_index]) {
                    opts.children[probe.correct_index].classList.add('right');
                }
                exp.classList.add('show');
                // Post-answer ask button: the tutor gets the full outcome —
                // question, options, the learner's pick, the correct answer,
                // and whether they got it — so it can celebrate or encourage.
                const correct = (probe.options || [])[probe.correct_index] || '';
                const ask = makeAiAskButton('ai-ask-btn fa-hover-ask',
                    'Talk to the AI about your answer', () =>
                    `I just answered a quiz question about $${artifact.latex}$.\n` +
                    `Question: "${probe.question}"\n` +
                    `Options: ${(probe.options || []).join(' | ')}\n` +
                    `The correct answer is "${correct}". I chose "${o}" — ` +
                    (right ? 'I got it RIGHT.' : 'I got it WRONG.') + '\n' +
                    (probe.explanation ? `The given explanation: "${probe.explanation}"\n` : '') +
                    (right
                        ? 'Congratulate me briefly, then deepen my understanding ' +
                          'with one extra insight about this behavior.'
                        : 'Encourage me — no scolding — and help me see why the ' +
                          'correct answer is right, building from what my choice ' +
                          'got partially right if anything.') + '\n' +
                    'First verify the quiz against the expression itself: if the ' +
                    'marked correct answer is mathematically wrong for this ' +
                    'expression, say so plainly and teach the true answer instead.');
                exp.appendChild(ask);
                div.classList.add('fa-askable');
            }, { once: true });
            opts.appendChild(b);
        });
        div.append(opts, exp);
        return div;
    }

    /* ---------------- raw JSON ---------------------------------------- */

    _renderJsonPanel(artifact) {
        // Popup over the view (backdrop click or × closes it).
        const overlay = document.createElement('div');
        overlay.className = 'fa-json-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('open');
        });

        const modal = document.createElement('div');
        modal.className = 'fa-json-modal';
        const head = document.createElement('div');
        head.className = 'fa-json-modal-head';
        const label = document.createElement('span');
        label.textContent = 'Function analysis — raw JSON';
        const copy = document.createElement('button');
        copy.className = 'fa-btn fa-json-copy';
        copy.textContent = 'Copy';
        const close = document.createElement('button');
        close.className = 'fa-btn fa-json-close';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '×';
        close.addEventListener('click', () => overlay.classList.remove('open'));
        head.append(label, copy, close);

        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(artifact.data, null, 2);
        // Same copy affordance as the JSON browser: clipboard + brief "Copied!".
        copy.addEventListener('click', () => {
            navigator.clipboard.writeText(pre.textContent).then(() => {
                copy.textContent = 'Copied!';
                setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
            }).catch(() => { copy.textContent = 'Copy failed'; });
        });
        modal.append(head, pre);
        overlay.appendChild(modal);
        return overlay;
    }

    /* ---------------- helpers ------------------------------------------ */

    _varLatex(chars, name) {
        return (chars.variables_latex || {})[name] || name;
    }

    _varText(chars, name) {
        return detex(this._varLatex(chars, name));
    }

    _katex(el, latex) {
        if (this.katex) {
            try {
                this.katex.render(String(latex), el,
                                  { throwOnError: false, displayMode: false });
                return;
            } catch (_e) { /* fall through */ }
        }
        el.textContent = String(latex);
    }

    /** Render text with inline $…$ math the same way as the rest of the
     *  app (labels.js renderKaTeX — used by tree labels, proof titles). */
    _inlineMath(el, text) {
        const span = document.createElement('span');
        span.innerHTML = renderKaTeX(String(text || ''), false);
        el.appendChild(span);
    }

    /** Instant styled tooltip with the variable's AI-written description
     *  (native `title` is too slow/subtle for a teaching surface). */
    _attachVarTooltip(el, desc) {
        el.addEventListener('mouseenter', () => {
            let tip = this.pageEl.querySelector('.fa-tooltip');
            if (!tip) {
                tip = document.createElement('div');
                tip.className = 'fa-tooltip';
                this.pageEl.appendChild(tip);
            }
            tip.innerHTML = `<span class="fa-ai-badge">${AI_ICON}</span> ` +
                renderKaTeX(desc, false);
            const r = el.getBoundingClientRect();
            const host = this.pageEl.getBoundingClientRect();
            tip.style.left = `${r.left - host.left}px`;
            tip.style.top = `${r.top - host.top + this.pageEl.scrollTop - 8}px`;
            tip.classList.add('show');
        });
        el.addEventListener('mouseleave', () => {
            const tip = this.pageEl.querySelector('.fa-tooltip');
            if (tip) tip.classList.remove('show');
        });
    }

    /** Hover-revealed AI ask button beside the element (app-wide pattern). */
    _attachHoverAsk(el, getMessage) {
        const btn = makeAiAskButton('ai-ask-btn fa-hover-ask',
                                    'Ask the AI about this', getMessage);
        el.classList.add('fa-askable');
        el.appendChild(btn);
    }

    destroy() {
        this._destroyCharts();
        if (this.pageEl && this.pageEl.parentNode) {
            this.pageEl.parentNode.removeChild(this.pageEl);
        }
        this.pageEl = null;
        this.activeArtifact = null;
        this._restoreGraphChrome();
    }
}
