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
const TAU = Math.PI * 2;              // full circle, for the marker dots

const SERIES_COLORS = ['#42a5f5', '#ffa726', '#66bb6a', '#ab47bc'];
const ANNOTATION_COLOR = 'rgba(239, 83, 80, 0.75)';
const BAND_FILL = 'rgba(66, 165, 245, 0.10)';

// Session cache: request shape -> response, so re-analyzing the same node
// with the same context never re-bills the LM (mirrors sg-proof's cache).
// Bounded and lesson-scoped: a long session opening many analyses would
// otherwise accumulate response payloads that can never be hit again.
const _FA_CACHE = new Map();
const _FA_CACHE_MAX = 32;
const _cacheKey = (p) => JSON.stringify({ l: p.latex, v: p.variable || '', c: p.context || '' });

/** Insert with oldest-first eviction (Map preserves insertion order). */
function _cacheSet(key, data) {
    _FA_CACHE.set(key, data);
    while (_FA_CACHE.size > _FA_CACHE_MAX) {
        _FA_CACHE.delete(_FA_CACHE.keys().next().value);
    }
}

/** Drop every cached analysis — call on a new lesson, whose steps and
 *  context no longer match anything stored (see clearDeriveCache). */
export function clearAnalysisCache() {
    _FA_CACHE.clear();
}

let _idCounter = 0;

/** Greek-ish LaTeX → readable text for the PLAIN contexts only: view-tab
 *  captions, `title` tooltips, and the Chart.js `dataset.label` fallback.
 *  Anything that must LOOK like math goes through KaTeX instead (the HTML
 *  legend, tooltip, axis titles) — this is a degradation, not a renderer.
 *  Text-ish wrappers are unwrapped BEFORE braces are stripped, or
 *  `\text{rad/s}` degrades into the literal `\text rad/s`. */
function detex(s) {
    return String(s || '')
        .replace(/\\(?:text|textrm|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1')
        .replace(/\\(?:quad|qquad)|\\[,;:! ]/g, ' ')
        .replace(/\\cdot(?![a-zA-Z])/g, '·')
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
        .replace(/[{}$]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export class FunctionAnalysisManager {
    /**
     * @param {Object} opts
     *   getViewport      () => #graph-viewport element
     *   katex            window.katex
     *   onArtifactsChanged (step) => void   — rebuild the Math tab tree
     *   onPageClosed     () => void         — restore the graph view
     *   onActiveChanged  () => void         — the shown artifact (or its id) changed
     *   buildContext     (step) => string   — lesson/step context for the expert
     */
    constructor(opts = {}) {
        this.katex = opts.katex || (typeof window !== 'undefined' && window.katex);
        this.getViewport = opts.getViewport ||
            (() => document.getElementById('graph-viewport'));
        this.onArtifactsChanged = opts.onArtifactsChanged || (() => {});
        this.onPageClosed = opts.onPageClosed || (() => {});
        // Fires whenever the page opens on a different artifact, closes, or the
        // active artifact's id settles (pending -> expert-assigned). The host uses
        // it to keep the `?fa=` deeplink in sync. Receives `{replace}` — true when
        // the visible artifact did not change (an id settling, a retry), so the
        // host rewrites the current history entry instead of pushing a new one.
        this.onActiveChanged = opts.onActiveChanged || (() => {});
        this.buildContext = opts.buildContext || (() => '');
        this.pageEl = null;            // lazily created #fa-page-container
        this.activeArtifact = null;
        this._charts = [];             // live Chart.js instances (destroyed per render)
        this._hiddenEls = [];          // graph elements hidden while page shows
        this._hiddenGroups = new Set();// annotation groups toggled off (per render)
        this._hiddenMarks = new Set(); // CAS feature kinds toggled off
        this._hiddenSeries = new Set();// dataset indices toggled off in the legend
        this._pinnedTip = null;        // hover readout pinned as a sticky note
        this._pinnedChart = null;      // the chart it was pinned on
        this._pinnedPoints = null;     // its markers, drawn by the plugin
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

    /** The artifact with `id` on `step`, or null. Ids are session-scoped: the
     *  expert assigns one on success, replacing the `fa-pending-N` placeholder
     *  the artifact was born with. BOTH stay matchable (the placeholder is kept
     *  as `pendingId`) so a URL captured mid-analysis still resolves after the
     *  id settles. */
    findById(step, id) {
        if (!id) return null;
        return this.listFor(step).find(
            (a) => a.id === id || a.pendingId === id) || null;
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
        const pendingId = `fa-pending-${++_idCounter}`;
        const artifact = {
            id: pendingId,
            // Kept after `_run` overwrites `id` with the expert's, so a URL
            // captured while the analysis was still running keeps resolving
            // (see findById). Counter-derived, so it never collides.
            pendingId,
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
                    _cacheSet(key, data);
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
        // `replace`: the page was already showing this artifact — only its id
        // settled (pending -> expert-assigned). That is the SAME view, so the
        // host must rewrite the current URL, not push a second history entry
        // (which would cost an extra Back press and strand the first one on the
        // superseded pending id).
        if (this.activeArtifact === artifact) this.show(artifact, { replace: true });
    }

    retry(artifact) {
        artifact.status = 'loading';
        artifact.error = null;
        this.onArtifactsChanged(artifact.step);
        this.show(artifact, { replace: true });   // same artifact, same view
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

    /** Show the page for an artifact (loading, error, or ready).
     *  `opts.replace` marks this as a re-show of the artifact already on screen
     *  (an id settling, a retry) rather than a new view — see onActiveChanged. */
    show(artifact, opts = {}) {
        const page = this._ensurePage();
        if (!page) return;
        this.activeArtifact = artifact;
        this._hideGraphChrome();
        page.classList.add('open');
        this._render(artifact);
        this.onArtifactsChanged(artifact.step);   // tree highlight follows
        this.onActiveChanged({ replace: !!opts.replace });   // ?fa= deeplink follows
    }

    /** Close the page and restore the graph view. */
    close() {
        this.activeArtifact = null;
        this._destroyCharts();
        if (this.pageEl) this.pageEl.classList.remove('open');
        this._restoreGraphChrome();
        this.onPageClosed();
        this.onActiveChanged({ replace: false });   // closing IS a new view
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
        // The pinned note lives in the chart's wrapper and holds a document
        // listener — drop both before the wrapper goes.
        this._unpinTip();
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
        this._hiddenMarks = new Set();
        this._hiddenSeries = new Set();
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
            // A failed LM call must not masquerade as "nothing to see here".
            if (proposal.failed) {
                artifact.error = 'The analysis request failed before a ' +
                    'proposal could be made.';
                page.appendChild(this._renderErrorCard(artifact));
                return;
            }
            const card = document.createElement('div');
            card.className = 'fa-card fa-abstain';
            const badge = document.createElement('span');
            badge.className = 'fa-ai-badge';
            badge.title = 'AI-generated';
            badge.innerHTML = AI_ICON;
            const text = document.createElement('span');
            // Prefer the AI's own reason; the generic line is the fallback.
            this._inlineMath(text, ' ' + (proposal.abstain_reason ||
                'Nothing behaviorally interesting to visualize here.'));
            card.append(badge, text);
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
        const featPanel = document.createElement('div');
        featPanel.className = 'fa-feat-panel';
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

        // The CAS report itself, one row per finding. The chart draws only
        // roots, extrema and singularities — everything else the analysis
        // found (asymptotes, period, parity, domain) has nowhere else to go.
        const featBtn = document.createElement('button');
        featBtn.className = 'fa-btn fa-feat-btn';
        featBtn.title = 'Show every feature the analysis detected';
        featBtn.textContent = 'features';
        featBtn.addEventListener('click', () => {
            featPanel.classList.toggle('open');
            featBtn.classList.toggle('open');
        });

        card.append(tabs, rationale, legend, canvasWrap, exprPanel, featPanel,
                    sliders);

        const state = { viewIdx: 0, pins: {} };

        const activate = (idx) => {
            state.viewIdx = idx;
            const view = views[idx];
            state.pins = { ...(view.pinned || {}) };
            this._hiddenGroups = new Set();
            this._hiddenMarks = new Set();
            this._hiddenSeries = new Set();
            [...tabs.querySelectorAll('.fa-view-tab')].forEach((b, i) =>
                b.classList.toggle('active', i === idx));
            this._renderExprPanel(exprPanel, chars, view);
            const nFeat = this._renderFeaturePanel(featPanel, artifact, chars,
                                                   view, state);
            featBtn.textContent = nFeat ? `features (${nFeat})` : 'features';
            if (view.rationale) {
                rationale.innerHTML = '';
                const badge = document.createElement('span');
                badge.className = 'fa-ai-badge';
                badge.title = 'AI-generated';
                badge.innerHTML = AI_ICON;
                const rtext = document.createElement('span');
                this._inlineMath(rtext, ' ' + view.rationale);
                rationale.append(badge, rtext);
                // Built at CLICK time so the features and curves quoted are
                // the ones currently switched on in the legend.
                this._attachHoverAsk(rationale, () =>
                    `For $${artifact.latex}$, the analysis chose this view: ` +
                    `"${view.rationale}". Walk me through the whole chart: why ` +
                    `this range is interesting, and what its features mean.\n` +
                    this._configSummary(chars, view, state));
            } else {
                rationale.textContent = '';
            }
            // Build the chart ONCE per view; slider moves update data in
            // place (no destroy/recreate, no animation — no flicker).
            const chart = this._renderChart(artifact, chars, view, canvasWrap, legend, state);
            this._renderAxisTitles(canvasWrap, chars, proposal, view, state);
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
        // Kept together in one right-aligned group, so a narrow panel wraps
        // them as a pair instead of stranding one below the tabs.
        const actions = document.createElement('div');
        actions.className = 'fa-view-actions';
        actions.append(exprBtn, featBtn);
        tabs.appendChild(actions);

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
            // For a definition, show it as it was written: name = formula.
            const shown = chars.dependentLatex
                ? `${chars.dependentLatex} = ${chars.expression}`
                : (chars.expression || '');
            row(SERIES_COLORS[0], 'curve', shown, main.script);
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

    /** All evaluable series for a view: main curve + companion plots.
     *
     *  `label` is a DISPLAY SOURCE in the app's inline-math convention —
     *  prose with `$…$` spans, which is how the LM writes plot labels
     *  ("Faster spin ($\omega = 0.2\ \text{rad/s}$)"). A bare LaTeX
     *  expression is `$`-wrapped here so one renderer (labels.js
     *  renderKaTeX) covers both the LM's prose and the CAS's expressions. */
    _seriesFor(chars, view) {
        const out = [];
        const main = chars.chartScript;
        if (main && main.script) {
            const f = chars.dependentLatex || chars.expression || 'f';
            out.push({ label: `$${f}$`, script: main.script, main: true });
        }
        for (const p of view.plots || []) {
            if (!p.script) continue;
            out.push({
                label: p.label || (p.latex ? `$${p.latex}$` : 'companion'),
                script: p.script,
            });
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
            // Plain-text fallback only — the canvas legend is off (see below).
            label: detex(s.label),
            // Display source for the HTML legend and tooltip, both of which
            // run it through KaTeX.
            $faLabel: s.label,
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
        const marks = this._marksFor(chars, view);
        // Markers start OFF: the curve reads clearly on its own, and the
        // legend keys are the switch. (They are also drawn by numeric
        // re-detection over the plotted window, so a feature the CAS found
        // outside the current range legitimately draws nothing — showing
        // them on by default made that look like a bug.)
        this._hiddenMarks = new Set(marks);
        // The plugin reads LIVE state off chart.$fa so in-place updates
        // (sliders, group toggles) re-draw overlays without a rebuild.
        const featurePlugin = {
            id: 'faFeatures',
            afterDraw: (chart) => {
                const fa = chart.$fa;
                if (!fa) return;
                // Feature markers are read off the main curve — hiding that
                // curve from the legend must take its markers with it.
                const visible = chart.isDatasetVisible(0)
                    ? new Set([...fa.marks].filter(k => !this._hiddenMarks.has(k)))
                    : new Set();
                this._drawOverlays(chart, chart.data.datasets[0], fa.xs,
                                   visible, fa.anns);
                // Chart.js drops its own hover points the moment the pointer
                // leaves, which is exactly when a note gets pinned — draw
                // them ourselves so the note keeps pointing at something.
                if (this._pinnedPoints) {
                    this._drawPinnedPoints(chart, this._pinnedPoints);
                }
            },
        };

        const chart = new Chart(canvas, {
            type: 'line',
            plugins: [featurePlugin],
            data: { labels: xs.map(x => +x.toFixed(6)), datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,      // slider-driven updates must not flicker
                plugins: {
                    // Canvas fillText can't render KaTeX, so series labels
                    // painted here leak raw LaTeX — see _renderSeriesLegend
                    // for the HTML replacement (same reason as the
                    // annotation labels and the external tooltip below).
                    legend: { display: false },
                    // Canvas tooltips can't render math — use an HTML one.
                    tooltip: {
                        enabled: false,
                        external: this._makeTooltipHandler(artifact, chars,
                                                           view, state),
                    },
                },
                // Left reserves the rotated y-title's band; right is just
                // enough that the last x tick isn't clipped.
                layout: { padding: { left: 20, right: 6, top: 4, bottom: 14 } },
                scales: {
                    x: {
                        type: 'linear',
                        // Axis titles are HTML (KaTeX) in the label layer.
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
                                 // The y bounds are the data extent plus 6%
                                 // breathing room (_yBounds), and Chart.js
                                 // labels an explicit min/max. Those two
                                 // ticks are padding, not data: they read as
                                 // noise (`4.24`?) and, sitting outside every
                                 // curve's range by construction, a y-axis
                                 // snap can never land on them. Unlabelled.
                                 callback: function (v) {
                                     if (v === this.min || v === this.max) return null;
                                     return +Number(v).toFixed(3);
                                 } },
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
        // Click the chart to pin the hover readout as a sticky note; click it
        // again — anywhere but the note itself, which swallows its own clicks
        // — to put the note away.
        canvas.addEventListener('click', (e) => {
            // An axis tick is a jump-to, not a pin/unpin — it answers first.
            if (this._snapFromAxisClick(e, chart, artifact, chars, view, state)) {
                return;
            }
            if (this._pinnedTip) { this._unpinTip(); return; }
            const tip = canvasWrap.querySelector('.fa-chart-tip');
            if (tip && tip.classList.contains('show')) {
                this._pinTip(tip, chart, artifact, chars, view, state);
            }
        });
        // Clickable tick labels are an invisible affordance without this.
        canvas.addEventListener('mousemove', (e) => {
            canvas.style.cursor = this._overAxisTick(e, chart) ? 'pointer' : '';
        });
        this._renderSeriesLegend(legend, chart);
        this._renderMarkerLegend(legend, marks, chart);
        chart.$fa = {
            xs,
            marks,
            compiled,
            yb,
            xLatex: this._varLatex(chars, view.x_var),
            exprLatex: chars.dependentLatex || chars.expression || 'f',
            anns: annotations.filter(a => !this._hiddenGroups.has(a.group || '')),
        };
        this._renderAnnLegend(legend, view, annotations,
            () => this._updateChartData(chart, chars, view, state));
        // The constructor already painted once, before `$fa` and the sticky
        // y-bounds existed — the plugin bailed out and the markers were
        // missing until some unrelated redraw (a resize, a slider) happened
        // to run. Paint again now that the state is in place.
        chart.update('none');
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
        if (this._pinnedTip) this._refreshPinnedValues(chart);
        chart.update('none');
    }

    /** Axis titles as KaTeX: the swept variable under the x-axis, the
     *  analyzed expression rotated along the y-axis. Both carry the AI's
     *  glossary description on hover where one exists. */
    _renderAxisTitles(canvasWrap, chars, proposal, view, state) {
        for (const el of canvasWrap.querySelectorAll('.fa-axis-title')) el.remove();
        const expr = chars.expression || '';
        const xLatex = this._varLatex(chars, view.x_var);
        const range = (view.x_range || []).join(' to ');

        const xTitle = document.createElement('div');
        xTitle.className = 'fa-axis-title fa-axis-x';
        this._katex(xTitle, xLatex);
        const xDesc = (proposal.variable_glossary || {})[view.x_var];
        if (xDesc) this._attachVarTooltip(xTitle, xDesc);
        this._attachHoverAsk(xTitle, () =>
            `In $${expr}$, the chart sweeps $${xLatex}$ across ${range}` +
            (xDesc ? ` (${xDesc})` : '') +
            '. What should I notice about how the expression responds to it?\n' +
            this._configSummary(chars, view, state));

        const yTitle = document.createElement('div');
        yTitle.className = 'fa-axis-title fa-axis-y';
        // A definition names its output (g_{feet} = ω²R) — label the axis
        // with that name; otherwise the plotted expression itself.
        this._katex(yTitle, chars.dependentLatex || expr || 'f');
        // Hover shows the analysis' own AI-written title — no invented prose.
        if (proposal.title) this._attachVarTooltip(yTitle, proposal.title);
        this._attachHoverAsk(yTitle, () =>
            `The vertical axis of this chart plots $${expr}$` +
            (proposal.title ? ` ("${proposal.title}")` : '') +
            `. What does this quantity mean physically, and what is the ` +
            `most important thing its shape reveals?\n` +
            this._configSummary(chars, view, state));

        canvasWrap.append(xTitle, yTitle);
    }

    /** HTML hover tooltip (Chart.js `external`) so the hovered x-value and
     *  every series label render as KaTeX rather than canvas text. Clicking
     *  it pins it — see `_pinTip`. */
    _makeTooltipHandler(artifact, chars, view, state) {
        const xLatex = this._varLatex(chars, view.x_var);
        return (ctx) => {
            const { chart, tooltip } = ctx;
            const wrap = chart.canvas.parentNode;
            if (!wrap) return;
            let el = wrap.querySelector('.fa-chart-tip');
            if (!el) {
                el = document.createElement('div');
                el.className = 'fa-chart-tip';
                this._wireTip(el);
                wrap.appendChild(el);
            }
            // A pinned note belongs to the learner, not to the pointer.
            if (el.classList.contains('pinned')) return;
            if (!tooltip || tooltip.opacity === 0) {
                el.classList.remove('show');
                return;
            }
            this._fillTip(el, chart, chars, view, state,
                          +(tooltip.dataPoints?.[0]?.parsed?.x ?? 0));
            el.style.left = `${tooltip.caretX}px`;
            el.style.top = `${tooltip.caretY}px`;
            el.classList.add('show');
        };
    }

    /** One series' value at an arbitrary x, off the same compiled script the
     *  curve itself was plotted from — so a readout is not limited to the
     *  NUM_POINTS samples. Falls back to the plotted array before the chart's
     *  `$fa` state exists. */
    _seriesValueAt(chart, chars, view, state, di, x) {
        const compiled = (chart.$fa || {}).compiled;
        if (compiled && compiled[di]) {
            try {
                const y = evalExpr(compiled[di], 0, {
                    overrideScope: this._scopeFor(chars, view, state.pins, x) });
                if (Number.isFinite(y)) return y;
            } catch (_e) { /* fall through to the plotted samples */ }
            return null;
        }
        const i = this._indexNearestX(chart, x);
        const y = chart.data.datasets[di].data[i];
        return Number.isFinite(y) ? y : null;
    }

    /** The readout's contents at an exact x: every visible series with its
     *  value there. Shared by the pointer (hover) and by an axis-label snap,
     *  so the two can never build a different-looking note.
     *
     *  Keyed by the x VALUE, not a sample index: a y-axis snap solves for a
     *  crossing that almost never falls on a sample, and rounding it to the
     *  nearest one would quietly answer a slightly different question. */
    _fillTip(el, chart, chars, view, state, x) {
        el.innerHTML = '';
        const xLatex = this._varLatex(chars, view.x_var);
        // What this readout is showing, for the pinned note's ask button.
        const values = [], datasets = [];

        const head = document.createElement('div');
        head.className = 'fa-tip-head';
        // The readout is one span so the head can be a flex row with the
        // pinned note's ask button pushed to the far right.
        const xv = document.createElement('span');
        xv.className = 'fa-tip-x';
        this._katex(xv, xLatex);
        const xValue = (+x).toPrecision(4);
        xv.appendChild(document.createTextNode(' = ' + xValue));
        head.appendChild(xv);
        el.appendChild(head);

        chart.data.datasets.forEach((ds, di) => {
            if (!chart.isDatasetVisible(di)) return;
            const row = document.createElement('div');
            row.className = 'fa-tip-row';
            const sw = document.createElement('span');
            sw.className = 'fa-tip-swatch';
            sw.style.background = ds.borderColor;
            const name = document.createElement('span');
            name.className = 'fa-tip-name';
            // Same display source as the HTML legend: LM prose with inline
            // math, or a $-wrapped expression (see _seriesFor).
            const label = ds.$faLabel || ds.label || '';
            name.innerHTML = renderKaTeX(label, false);
            const val = document.createElement('span');
            val.className = 'fa-tip-val';
            const y = this._seriesValueAt(chart, chars, view, state, di, x);
            val.textContent = Number.isFinite(y) ? (+y).toPrecision(5) : '—';
            row.append(sw, name, val);
            el.appendChild(row);
            values.push({ label, value: val.textContent });
            // Which rows to keep drawn on the curves for a pinned note.
            datasets.push(di);
        });

        el.$fa = { xLatex, xValue, values, datasets, x, chars, view, state };
    }

    /** Drag, wired once per tip element. Pinning itself is a click on the
     *  CHART (see `_renderChart`); an unpinned tip is pointer-transparent, so
     *  that click reaches the canvas even though the tip is sitting over it.
     *  Once pinned the tip takes pointer events, which is both what makes it
     *  draggable and what stops a click on the note counting as a click on
     *  the chart — so the note is never its own dismiss target. */
    _wireTip(el) {
        el.addEventListener('mousedown', (e) => {
            if (!el.classList.contains('pinned')) return;
            if (e.target.closest('.ai-ask-btn')) return;   // let the ask fire
            e.preventDefault();                            // no text selection
            const wrapR = el.parentNode.getBoundingClientRect();
            const r = el.getBoundingClientRect();
            const dx = e.clientX - r.left, dy = e.clientY - r.top;
            const move = (ev) => {
                el.style.left = `${ev.clientX - wrapR.left - dx}px`;
                el.style.top = `${ev.clientY - wrapR.top - dy}px`;
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
    }

    /* ---------------- axis-label snapping ------------------------------ */

    /** The tick value nearest `pixel` along `scale`, or null if the click
     *  landed between ticks. `TICK_TOL` is generous: tick labels are wider
     *  than the tick itself, and the learner is aiming at the number. */
    _nearestTick(scale, pixel, tol = 18) {
        let best = null, bestD = Infinity;
        (scale.ticks || []).forEach((t, i) => {
            // Skip ticks the axis draws no label for — there is nothing there
            // to aim at, so a click near one belongs to its labelled neighbour.
            if (t.label == null || t.label === '') return;
            const d = Math.abs(scale.getPixelForTick(i) - pixel);
            if (d < bestD) { bestD = d; best = t.value; }
        });
        return bestD <= tol ? best : null;
    }

    /** The main curve: dataset 0 when it is showing, else the first that is.
     *  A y-axis snap solves against whatever curve the learner can see. */
    _mainDatasetIndex(chart) {
        if (chart.isDatasetVisible(0)) return 0;
        return chart.data.datasets.findIndex((_d, i) => chart.isDatasetVisible(i));
    }

    /** Sample index whose x is nearest `value`. */
    _indexNearestX(chart, value) {
        let best = 0, bestD = Infinity;
        chart.data.labels.forEach((x, i) => {
            const d = Math.abs(x - value);
            if (d < bestD) { bestD = d; best = i; }
        });
        return best;
    }

    /** The x where the ANALYZED curve reaches `value` — the inverse question
     *  the y axis asks ("where is $a = 3$?").
     *
     *  Only the main curve answers. The axis is shared with the companions,
     *  but the learner clicking `3` means "put $a$ at 3"; solving against a
     *  companion instead would land on a point where the note reads
     *  `a = 0.75` next to a companion reading 3, which looks like a bug.
     *  Everything else in the note is then read FORWARD at the x this
     *  returns — x is the shared coordinate, so a y-axis click is inverted
     *  once and every other series follows from it.
     *
     *  The plotted samples only bracket the crossing; the answer is refined
     *  against the compiled expression so the note reads `1.0000` rather
     *  than whichever nearby sample happened to be closest. Null when the
     *  curve does not reach that value in this window — see `_saySnapFailed`
     *  for what the chart says instead. */
    _solveForY(chart, chars, view, state, value) {
        const di = this._mainDatasetIndex(chart);
        if (di < 0) return null;
        const data = chart.data.datasets[di].data;
        const xs = chart.data.labels;
        const brackets = [];
        for (let i = 0; i < data.length; i++) {
            const y = data[i];
            if (!Number.isFinite(y)) continue;
            // An exact hit counts wherever it lands, including the last
            // sample — a curve that only reaches the value at the very end
            // of the window still reaches it.
            if (y === value) { brackets.push([xs[i], xs[i]]); continue; }
            const next = data[i + 1];
            if (Number.isFinite(next) && (y - value) * (next - value) < 0) {
                brackets.push([xs[i], xs[i + 1]]);
            }
        }
        if (!brackets.length) return null;
        // A curve can cross more than once; prefer the crossing nearest
        // whatever is already pinned, so repeated clicks stay local.
        const from = this._pinnedTip && this._pinnedTip.$fa
            ? this._pinnedTip.$fa.x : null;
        const [lo, hi] = from == null ? brackets[0] : brackets.reduce((p, c) =>
            Math.abs(c[0] - from) < Math.abs(p[0] - from) ? c : p);
        return this._refineCrossing(chart, chars, view, state, di, lo, hi, value);
    }

    /** Bisect `[lo, hi]` — one plotted sample apart, straddling the crossing
     *  — down to float precision on the compiled expression. Fifty steps is
     *  nothing next to the redraw it precedes, and it is what turns "works
     *  approximately" into an exact answer. */
    _refineCrossing(chart, chars, view, state, di, lo, hi, value) {
        if (lo === hi) return lo;
        const f = (x) => {
            const y = this._seriesValueAt(chart, chars, view, state, di, x);
            return Number.isFinite(y) ? y - value : null;
        };
        let a = lo, b = hi;
        const fa = f(a);
        if (fa == null) return (lo + hi) / 2;
        if (fa === 0) return a;
        for (let i = 0; i < 50 && b - a > Math.abs(hi - lo) * 1e-12; i++) {
            const m = (a + b) / 2, fm = f(m);
            if (fm == null) break;
            if (fm === 0) return m;
            if ((fa < 0) === (fm < 0)) a = m; else b = m;
        }
        return (a + b) / 2;
    }

    /** A y-axis click the curve cannot answer, said out loud and briefly.
     *  Reports the range the curve actually covers, so the learner can see
     *  how far off the ask was — and, since the pins are live, that moving a
     *  slider may well bring the value into reach. */
    _saySnapFailed(chart, chars, view, value) {
        const wrap = chart.canvas.parentNode;
        let el = wrap.querySelector('.fa-snap-miss');
        if (!el) {
            el = document.createElement('div');
            el.className = 'fa-snap-miss';
            wrap.appendChild(el);
        }
        const di = this._mainDatasetIndex(chart);
        const ys = di < 0 ? [] : chart.data.datasets[di].data.filter(Number.isFinite);
        const y = chars.dependentLatex || chars.expression || 'f';
        el.innerHTML = renderKaTeX(
            `$${y}$ does not reach ${this._fmt(value)} here` +
            (ys.length ? ` — it runs from ${this._fmt(Math.min(...ys))} to ` +
                         `${this._fmt(Math.max(...ys))} over this range.` : '.'),
            false);
        el.classList.add('show');
        clearTimeout(this._snapMissTimer);
        this._snapMissTimer = setTimeout(() => el.classList.remove('show'), 2600);
    }

    /** Is the pointer over a tick label? Drives the cursor only. */
    _overAxisTick(e, chart) {
        const area = chart.chartArea;
        if (!area || !chart.scales.x || !chart.scales.y) return false;
        const r = chart.canvas.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        if (py > area.bottom) return this._nearestTick(chart.scales.x, px) != null;
        if (px < area.left) return this._nearestTick(chart.scales.y, py) != null;
        return false;
    }

    /** A click in an axis's tick band snaps the note to that value: the x
     *  axis reads forwards ("put me at $R = 40$"), the y axis backwards
     *  ("put me where $a = 3$"). Returns whether it handled the click. */
    _snapFromAxisClick(e, chart, artifact, chars, view, state) {
        const area = chart.chartArea;
        if (!area || !chart.scales.x || !chart.scales.y) return false;
        const r = chart.canvas.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        let x = null;
        if (py > area.bottom) {                       // under the plot: x ticks
            // The tick value IS the answer — no need to round it to a sample.
            x = this._nearestTick(chart.scales.x, px);
            if (x == null) return false;
        } else if (px < area.left) {                  // left of it: y ticks
            const v = this._nearestTick(chart.scales.y, py);
            if (v == null) return false;
            x = this._solveForY(chart, chars, view, state, v);
            if (x == null) {
                // The curve never reaches that value here. Snapping anywhere
                // would put a number in the note the curve never takes — but
                // silence reads as a broken control, so say why.
                this._saySnapFailed(chart, chars, view, v);
                return true;
            }
        } else {
            return false;
        }
        const el = chart.canvas.parentNode.querySelector('.fa-chart-tip');
        if (!el) return false;
        this._unpinTip();
        this._fillTip(el, chart, chars, view, state, x);
        // Park it over the point, the same way the pointer would have.
        const di = this._mainDatasetIndex(chart);
        const y = di < 0 ? null
            : this._seriesValueAt(chart, chars, view, state, di, x);
        el.style.left = `${chart.scales.x.getPixelForValue(x)}px`;
        el.style.top = `${Number.isFinite(y)
            ? chart.scales.y.getPixelForValue(y) : area.top + 20}px`;
        el.classList.add('show');
        this._pinTip(el, chart, artifact, chars, view, state);
        return true;
    }

    /** Pin the hover readout as a sticky note: it stops following the
     *  pointer, can be dragged anywhere, and grows an ask button for the
     *  exact set of values it froze. Clicking off it puts it away. */
    _pinTip(el, chart, artifact, chars, view, state) {
        this._unpinTip();
        const wrapR = el.parentNode.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        // Freeze it where it already sits, THEN drop the hover transform, so
        // left/top become plain coordinates a drag can update directly.
        // A point near an edge — or an end-of-axis tick — would park it half
        // outside the chart, where the card clips it, so it lands clamped
        // inside. The learner can drag it back out if they want to.
        el.style.left = `${Math.max(0, Math.min(r.left - wrapR.left,
                                                wrapR.width - r.width))}px`;
        el.style.top = `${Math.max(0, r.top - wrapR.top)}px`;
        el.classList.add('pinned');
        this._pinnedTip = el;
        this._pinnedChart = chart;
        this._pinnedPoints = el.$fa && el.$fa.datasets ? el.$fa : null;
        chart.update('none');           // paint the markers we now own

        const head = el.querySelector('.fa-tip-head');
        if (head) {
            head.appendChild(makeAiAskButton('ai-ask-btn fa-tip-ask',
                'Ask the AI about these values', () => {
                    const d = el.$fa || { values: [] };
                    const vals = d.values
                        .map(v => `${v.label} = ${v.value}`).join(', ');
                    return `On the chart of $${artifact.latex}$ I have ` +
                        `pinned the point where $${d.xLatex} = ${d.xValue}$` +
                        (vals ? `, where the curves read ${vals}` : '') +
                        `. What do these values tell me, and how do they ` +
                        `relate to each other here?\n` +
                        this._configSummary(chars, view, state);
                }));
        }
    }

    /** Put the sticky note away and hand the tip back to the pointer. */
    _unpinTip() {
        const el = this._pinnedTip;
        const chart = this._pinnedChart;
        this._pinnedTip = null;
        this._pinnedChart = null;
        this._pinnedPoints = null;
        if (chart) { try { chart.update('none'); } catch (_e) {} }
        if (!el) return;
        el.classList.remove('pinned', 'show');
        el.style.left = '';
        el.style.top = '';
        const ask = el.querySelector('.fa-tip-ask');
        if (ask) ask.remove();
    }

    /** The hovered points, kept on screen for a pinned note. Positions are
     *  recomputed from the LIVE data each draw, so a slider move slides the
     *  markers along with the curves instead of stranding them. */
    _drawPinnedPoints(chart, pinned) {
        const { ctx, scales, chartArea } = chart;
        if (!chartArea || !scales.x || !scales.y) return;
        const { x, datasets, chars, view, state } = pinned;
        ctx.save();
        for (const di of datasets) {
            if (!chart.isDatasetVisible(di)) continue;
            const ds = chart.data.datasets[di];
            const y = this._seriesValueAt(chart, chars, view, state, di, x);
            if (!Number.isFinite(y)) continue;
            const px = scales.x.getPixelForValue(x);
            const py = scales.y.getPixelForValue(y);
            if (px < chartArea.left || px > chartArea.right) continue;
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, TAU);
            ctx.fillStyle = '#0a0c1a';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = ds.borderColor;
            ctx.stroke();
        }
        ctx.restore();
    }

    /** A pinned note is pinned in x, not frozen in time: when a slider moves
     *  the curves, its numbers follow, or it would sit there quoting values
     *  that no longer match the curve underneath it. */
    _refreshPinnedValues(chart) {
        const el = this._pinnedTip;
        const d = el && el.$fa;
        if (!d || !d.datasets) return;
        const cells = el.querySelectorAll('.fa-tip-row .fa-tip-val');
        d.datasets.forEach((di, i) => {
            const y = this._seriesValueAt(chart, d.chars, d.view, d.state, di, d.x);
            const text = Number.isFinite(y) ? (+y).toPrecision(5) : '—';
            if (cells[i]) cells[i].textContent = text;
            if (d.values[i]) d.values[i].value = text;
        });
    }

    _fmt(v) {
        return Number.isFinite(+v) ? String(+(+v).toPrecision(4)) : '?';
    }

    /** Which CAS feature kinds this view draws. Roots, extrema and
     *  singularities are CAS facts, not AI opinions: draw them whenever the
     *  report found any. `view.mark` stays as an additive hint (the LM
     *  regularly forgets to list them, and a learner asking "where are the
     *  roots" deserves an answer). */
    _marksFor(chars, view) {
        const marks = new Set(view.mark || []);
        for (const kind of ['zeros', 'extrema', 'singularities']) {
            const f = (chars.features || {})[kind];
            if (f && (f.points || []).length) marks.add(kind);
        }
        return marks;
    }

    /** Every finding in the CAS report, flattened to one row each, in the
     *  order the chart reads. One walk of the report shape feeds BOTH the
     *  ask messages (`_featureSummary`) and the expandable panel
     *  (`_renderFeaturePanel`), so the two can never drift apart.
     *
     *  Each row: `{kind, group, label, math, detail, off, family, prose}`
     *    kind    report key — 'zeros' … 'domain'
     *    group   plural name of the kind ('roots', 'critical points')
     *    label   what THIS row is ('root', 'maximum', 'vertical asymptote')
     *    math    LaTeX for the location/value, without `$`
     *    detail  secondary LaTeX — an extremum's value, a limit's direction
     *    off     the point lies outside the swept range, so nothing is drawn
     *    family  `math` is a solution SET, not a single point
     *    prose   the row as a sentence fragment, for prompts
     *  Point lists are bounded server-side (features.MAX_POINTS). */
    _featureRows(chars, view) {
        const feats = chars.features || {};
        // The report is in terms of the ANALYZED variable, which is not
        // always the one a view sweeps (this expression is analyzed in $R$;
        // its second view sweeps $\omega$). Label locations with the variable
        // they actually belong to.
        const fv = chars.variable || view.x_var;
        const xL = this._varLatex(chars, fv);
        const [xa, xb] = (view.x_range || []).length === 2
            ? view.x_range : [-Infinity, Infinity];
        const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
        // Markers are re-detected numerically over the plotted window, so a
        // CAS point outside it draws nothing however the legend key is set.
        // The window only means anything when the view sweeps that variable.
        const sameAxis = fv === view.x_var;
        const isOff = (p) => sameAxis && !(p && Number.isFinite(p.approx) &&
                                           p.approx >= lo && p.approx <= hi);
        const rows = [];
        const push = (r) => {
            // "a maximum at $x = 1$ (value $2$) (off-chart)" / "period $2\pi$"
            // `at` marks a located point; `article` names a thing that reads
            // with one ("a horizontal asymptote", but plain "period").
            const head = (r.at || r.article)
                ? `${/^[aeiou]/i.test(r.label) ? 'an' : 'a'} ${r.label}`
                : r.label;
            if (r.family) {
                r.prose = `${r.group} form the set $${r.math}$`;
            } else if (!r.math) {
                r.prose = r.label;                       // "odd symmetry"
            } else if (r.at) {
                r.prose = `${head} at $${r.math}$` +
                    (r.detail ? ` (value $${r.detail}$)` : '') +
                    (r.off ? ' (off-chart)' : '');
            } else {
                r.prose = `${head} $${r.math}$` +
                    (r.detail ? ` as $${r.detail}$` : '');
            }
            rows.push(r);
        };
        const points = (kind, group, describe) => {
            const f = feats[kind] || {};
            for (const p of f.points || []) push({ kind, group, at: true, ...describe(p) });
            // `family` is what the CAS returns when the solution set is not a
            // finite list ($\pi n$, $\mathbb{R}$) — say so, rather than phrase
            // a whole set as if it were a handful of marker dots.
            if (!(f.points || []).length && f.family) {
                push({ kind, group, label: group, math: f.family, family: true });
            }
        };
        points('zeros', 'roots', (p) => ({
            label: 'root', math: `${xL} = ${p.latex}`, off: isOff(p) }));
        points('extrema', 'critical points', (p) => ({
            // The CAS labels a point it could not classify `critical`, which
            // is an adjective — taking it verbatim reads "a critical at".
            label: (!p.kind || p.kind === 'critical') ? 'critical point' : p.kind,
            math: `${xL} = ${p.location.latex}`,
            detail: (p.value && p.value.latex) || '',
            off: isOff(p.location) }));
        points('singularities', 'singularities', (p) => ({
            label: p.vertical_asymptote ? 'vertical asymptote' : 'singularity',
            math: `${xL} = ${p.location.latex}`,
            off: isOff(p.location) }));
        points('inflections', 'inflection points', (p) => ({
            label: 'inflection point', math: `${xL} = ${p.latex}`, off: isOff(p) }));

        for (const d of (feats.limits_at_infinity || {}).directions || []) {
            const to = `${xL} \\to ${d.direction === '-inf' ? '-' : '+'}\\infty`;
            const kind = 'limits_at_infinity', group = 'limits at infinity';
            const o = d.oblique_asymptote;
            if (o && o.slope && o.intercept) {
                const b = String(o.intercept.latex || '').trim();
                const term = b.startsWith('-') ? `- ${b.slice(1)}` : `+ ${b}`;
                push({ kind, group, label: 'oblique asymptote', article: true,
                       math: `y = ${o.slope.latex} ${xL} ${term}`, detail: to });
            } else if (d.horizontal_asymptote && d.limit) {
                push({ kind, group, label: 'horizontal asymptote', article: true,
                       math: `y = ${d.limit.latex}`, detail: to });
            } else if (d.limit) {
                // Infinite limits arrive as bare LaTeX, finite ones as points.
                const lim = typeof d.limit === 'string' ? d.limit : d.limit.latex;
                push({ kind, group, label: 'limit', math: lim, detail: to });
            }
        }
        if (feats.periodicity && feats.periodicity.latex) {
            push({ kind: 'periodicity', group: 'period', label: 'period',
                   math: feats.periodicity.latex });
        }
        if (typeof feats.parity === 'string') {
            push({ kind: 'parity', group: 'symmetry',
                   label: `${feats.parity} symmetry` });
        }
        if (typeof feats.domain === 'string') {
            push({ kind: 'domain', group: 'domain', label: 'domain',
                   math: feats.domain });
        }
        return rows;
    }

    /** Feature kinds the CAS ran out of time on. The guard returns
     *  `{status: 'unresolved'}` per kind rather than failing the whole
     *  report, and those carry no points — so without this they are
     *  indistinguishable from "the curve has none", which is a different
     *  and much stronger claim. */
    _unresolvedKinds(chars) {
        const feats = chars.features || {};
        const NAMES = {
            zeros: 'roots', extrema: 'critical points',
            singularities: 'singularities', inflections: 'inflection points',
            limits_at_infinity: 'limits at infinity',
            periodicity: 'periodicity', parity: 'symmetry', domain: 'domain',
        };
        return Object.keys(NAMES)
            .filter(k => feats[k] && feats[k].status === 'unresolved')
            .map(k => NAMES[k]);
    }

    /** The CAS report opened up: every detected feature as its own row, with
     *  a hover-revealed ask button on each so any single finding can be taken
     *  to chat on its own. Returns the row count for the toggle's caption. */
    _renderFeaturePanel(host, artifact, chars, view, state) {
        host.innerHTML = '';
        const rows = this._featureRows(chars, view);
        const stalled = this._unresolvedKinds(chars);
        if (!rows.length) {
            host.textContent = stalled.length
                ? `The CAS ran out of time on ${stalled.join(', ')}, so this ` +
                  'expression has no resolved features to show.'
                : 'The analysis detected no features for this expression.';
            return 0;
        }
        if (stalled.length) {
            const note = document.createElement('div');
            note.className = 'fa-feat-row fa-feat-stalled';
            note.textContent =
                `The CAS ran out of time on ${stalled.join(', ')} — those are ` +
                'unknown here, not absent.';
            host.appendChild(note);
        }
        for (const r of rows) {
            const row = document.createElement('div');
            row.className = 'fa-feat-row';
            const label = document.createElement('span');
            label.className = 'fa-feat-label';
            label.textContent = r.label;
            row.append(label);
            if (r.family) {
                // A solution SET, not a point — say so beside the math.
                const note = document.createElement('span');
                note.className = 'fa-feat-note';
                note.textContent = 'solution set';
                row.append(note);
            }
            if (r.math) {
                const math = document.createElement('span');
                math.className = 'fa-feat-math';
                this._katex(math, r.math);
                row.append(math);
            }
            if (r.detail) {
                const detail = document.createElement('span');
                detail.className = 'fa-feat-detail';
                // An extremum's value reads as "= y"; a limit's is a direction.
                this._katex(detail, r.at ? `= ${r.detail}` : r.detail);
                row.append(detail);
            }
            if (r.off) {
                // Honest about why this one has no dot on the curve.
                const tag = document.createElement('span');
                tag.className = 'fa-feat-off';
                tag.textContent = 'outside this view';
                tag.title = 'This point lies outside the plotted range, so ' +
                            'nothing is drawn for it here.';
                row.append(tag);
            }
            this._attachHoverAsk(row, () =>
                // "reports:" so a set ("roots form the set …") reads as
                // naturally as a point ("a root at …") after the lead-in.
                `In $${artifact.latex}$, the analysis reports: ${r.prose}. ` +
                `What does this feature mean here, and how would I find it ` +
                `myself?\n` + this._configSummary(chars, view, state));
            host.appendChild(row);
        }
        return rows.length;
    }

    /** The CAS report in words, for the ask messages.
     *
     *  Nothing is dropped: the tutor needs the WHOLE report to explain the
     *  chart, so every finding is listed and the ones the learner cannot
     *  currently see are flagged instead — `(hidden)` for a legend key
     *  switched off, `(off-chart)` for a point outside the swept range. */
    _featureSummary(chars, view) {
        const rows = this._featureRows(chars, view);
        const marked = ['zeros', 'extrema', 'singularities'];
        const drawn = [], extra = [];

        // Rows arrive grouped by kind; fold each run into one clause.
        for (let i = 0; i < rows.length;) {
            const kind = rows[i].kind;
            const run = [];
            while (i < rows.length && rows[i].kind === kind) run.push(rows[i++]);
            const { group } = run[0];
            // Rows whose label is just the group's singular collapse to
            // "roots at A, B". Where the wording carries more than the group
            // name does (a maximum vs a minimum, a value) each stands alone.
            const uniform = !run[0].family && !run.some(r => r.detail) &&
                run.every(r => r.group === r.label + 's');
            const body = uniform
                ? run.map(r => `$${r.math}$` + (r.off ? ' (off-chart)' : '')).join(', ')
                : run.map(r => r.prose).join(', ');
            if (!marked.includes(kind)) {
                extra.push(uniform ? `${group} at ${body}` : body);
            } else if (this._hiddenMarks.has(kind)) {
                // A hidden group is qualified UP FRONT — trailing it would
                // read as if it belonged to the last row alone.
                drawn.push(`${group} (hidden): ${body}`);
            } else {
                drawn.push(uniform ? `${group} at ${body}` : body);
            }
        }

        const out = [];
        if (drawn.length) out.push(`Marked on the chart: ${drawn.join('; ')}.`);
        if (extra.length) out.push(`Also detected (not drawn): ${extra.join('; ')}.`);
        // A kind the view asked to mark that the report found nothing for
        // says so rather than silently vanishing.
        const found = new Set(rows.map(r => r.kind));
        const feats = chars.features || {};
        const empty = [...this._marksFor(chars, view)].filter(k =>
            // A kind the CAS timed out on is unknown, not empty — it belongs
            // in the `stalled` clause below, not in a "none were found" claim.
            !found.has(k) && (feats[k] || {}).status !== 'unresolved');
        if (empty.length) out.push(`No ${empty.join(' or ')} were found.`);
        // Never let the tutor read a CAS timeout as "the curve has none".
        const stalled = this._unresolvedKinds(chars);
        if (stalled.length) {
            out.push(`The CAS ran out of time on ${stalled.join(', ')}, so ` +
                     'those are unknown here rather than absent.');
        }
        return out.join(' ');
    }

    /** Everything else drawn beside the main curve — companion plots and the
     *  annotation lines, by the labels the learner reads in the legend. All
     *  of them, with the ones switched off flagged `(hidden)`. */
    _overlaySummary(chars, view) {
        const parts = [];
        // Dataset order is `_seriesFor`'s: the main curve (when there is one)
        // then each plot that has a script — the same index the legend chips
        // and `_hiddenSeries` use.
        const offset = (chars.chartScript && chars.chartScript.script) ? 1 : 0;
        const plots = (view.plots || []).filter(p => p.script).map((p, i) =>
            // Same fallback chain as `_seriesFor`: a plot with neither a
            // label nor an expression is still a curve on the chart, and
            // `$$` in the tutor's context is worse than naming it.
            ((p.label && p.latex) ? `${p.label} — $${p.latex}$`
                                  : (p.label || (p.latex ? `$${p.latex}$`
                                                         : 'companion'))) +
            (this._hiddenSeries.has(i + offset) ? ' (hidden)' : ''));
        if (plots.length) parts.push(`companion curves: ${plots.join('; ')}`);
        const anns = (view.annotations || []).map(a =>
            (a.label || a.kind) +
            (a.at && a.at.latex ? ` at $${a.at.latex}$` : '') +
            (this._hiddenGroups.has(a.group || '') ? ' (hidden)' : ''));
        if (anns.length) parts.push(`marker lines: ${anns.join('; ')}`);
        return parts.length
            ? `Other curves and markers on this view — ${parts.join(', and ')}.`
            : '';
    }

    /** The chart's current state in words, appended to every ask so the
     *  tutor answers about what the learner is actually looking at rather
     *  than the expression in the abstract — the full CAS report and every
     *  extra curve, with whatever is currently off-screen flagged. */
    _configSummary(chars, view, state) {
        const pins = Object.entries(state.pins || {})
            .map(([k, v]) => `$${this._varLatex(chars, k)}$ = ${this._fmt(v)}`);
        const range = (view.x_range || []).map(v => this._fmt(v)).join(' to ');
        const parts = [`the chart sweeps $${this._varLatex(chars, view.x_var)}$` +
                       (range ? ` from ${range}` : '')];
        if (pins.length) parts.push(`with ${pins.join(', ')}`);
        return [`(Current chart settings: ${parts.join(', ')}.`,
                this._featureSummary(chars, view),
                this._overlaySummary(chars, view)].filter(Boolean).join(' ') + ')';
    }

    /** Hovering an annotation reports the values AT that marker — the same
     *  readout the plot hover gives, but pinned to the point of interest. */
    _showAnnotationTip(chart, l) {
        const wrap = chart.canvas.parentNode;
        if (!wrap) return;
        let el = wrap.querySelector('.fa-chart-tip');
        if (!el) {
            el = document.createElement('div');
            el.className = 'fa-chart-tip';
            wrap.appendChild(el);
        }
        el.innerHTML = '';
        const a = l.ann;
        const fa = chart.$fa || {};
        const num = (v) => Number.isFinite(v) ? +(+v).toPrecision(5) : '—';

        const head = document.createElement('div');
        head.className = 'fa-tip-head';
        if (a.kind === 'vline') {
            const sym = document.createElement('span');
            this._katex(sym, fa.xLatex || 'x');
            head.append(sym, document.createTextNode(' = ' + num(a.atValue)));
        } else {
            this._inlineMath(head, a.label || a.kind);
        }
        el.appendChild(head);

        const row = (name, value, color) => {
            const r = document.createElement('div');
            r.className = 'fa-tip-row';
            const sw = document.createElement('span');
            sw.className = 'fa-tip-swatch';
            sw.style.background = color || ANNOTATION_COLOR;
            const n = document.createElement('span');
            n.className = 'fa-tip-name';
            if (typeof name === 'string') this._katex(n, name);
            else n.appendChild(name);
            const v = document.createElement('span');
            v.className = 'fa-tip-val';
            v.textContent = value;
            r.append(sw, n, v);
            el.appendChild(r);
        };

        if (a.kind === 'vline') {
            // Nearest sampled x, so the readout matches the drawn curve.
            const xs = fa.xs || [];
            let idx = 0, best = Infinity;
            xs.forEach((x, i) => {
                const d = Math.abs(x - a.atValue);
                if (d < best) { best = d; idx = i; }
            });
            for (const ds of chart.data.datasets) {
                row(ds.label === 'f' ? (fa.exprLatex || 'f') : ds.label,
                    num(ds.data[idx]), ds.borderColor);
            }
        } else if (a.kind === 'hline') {
            row('y', num(a.atValue));
        } else if (a.kind === 'band') {
            const sym = fa.xLatex || 'x';
            row(sym, `${num(Math.min(a.atValue, a.toValue))} … ` +
                     `${num(Math.max(a.atValue, a.toValue))}`);
        }

        el.style.left = `${l.left}px`;
        el.style.top = `${l.top}px`;
        el.classList.add('show');
    }

    /** Place annotation labels as KaTeX-rendered HTML over the canvas.
     *  Called from the draw plugin, so positions follow every slider move
     *  and resize. Canvas text can't render math; this layer can. */
    _syncLabels(chart, labels) {
        const layer = chart.canvas.parentNode &&
            chart.canvas.parentNode.querySelector('.fa-chart-labels');
        if (!layer) return;
        layer.innerHTML = '';
        const placed = [];
        for (const l of labels) {
            const el = document.createElement('span');
            el.className = 'fa-chart-label' + (l.band ? ' band' : '');
            el.style.left = `${l.left}px`;
            el.style.top = `${l.top}px`;
            this._inlineMath(el, l.text);
            // An annotation marks a point of interest — hovering it reports
            // the curve values there, the same way hovering the plot does.
            if (l.ann) {
                el.classList.add('probe');
                el.addEventListener('mouseenter',
                    () => this._showAnnotationTip(chart, l));
                el.addEventListener('mouseleave', () => {
                    const tip = chart.canvas.parentNode
                        .querySelector('.fa-chart-tip');
                    if (tip) tip.classList.remove('show');
                });
            }
            layer.appendChild(el);
            placed.push({ el, l });
        }
        // Keep labels inside the canvas: a marker near the right edge flips
        // to the left of its line, and stacked labels step down so they
        // don't overprint each other.
        const wide = layer.clientWidth;
        const rows = [];
        for (const { el, l } of placed) {
            const w = el.offsetWidth, h = el.offsetHeight || 14;
            let left = l.left;
            if (left + w > wide - 3) left = Math.max(3, l.left - w - 8);
            let top = l.top;
            while (rows.some(r => Math.abs(r.top - top) < h &&
                                  left < r.right && left + w > r.left)) {
                top += h + 2;
            }
            el.style.left = `${left}px`;
            el.style.top = `${top}px`;
            rows.push({ top, left, right: left + w });
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

    /** Which curve is which, as HTML so the labels render as KaTeX —
     *  Chart.js paints its own legend with canvas fillText, which leaves
     *  `\text{rad/s}` on screen as source (same constraint that put the
     *  annotation labels and the tooltip in HTML layers).
     *
     *  Behaviour matches the built-in legend it replaces: one chip per
     *  dataset, clicking toggles that dataset, an off chip is struck
     *  through, and the swatch carries the curve's real stroke — solid for
     *  the analyzed expression, dashed for a companion plot. */
    _renderSeriesLegend(legend, chart) {
        for (const el of legend.querySelectorAll('.fa-series-key')) el.remove();
        this._hiddenSeries.clear();         // a fresh chart shows everything
        const datasets = chart.data.datasets;
        if (datasets.length < 2) return;    // a lone curve is the y-axis title
        datasets.forEach((ds, i) => {
            const source = ds.$faLabel || ds.label || '';
            const chip = document.createElement('button');
            chip.className = 'fa-btn fa-series-key';
            chip.title = `Show or hide ${detex(source)}`;
            const swatch = document.createElement('span');
            swatch.className = 'fa-series-swatch' +
                ((ds.borderDash || []).length ? ' dashed' : '');
            swatch.style.borderTopColor = ds.borderColor;
            const text = document.createElement('span');
            text.innerHTML = renderKaTeX(source, false);
            chip.append(swatch, text);
            chip.addEventListener('click', () => {
                const wasVisible = chart.isDatasetVisible(i);
                if (wasVisible) chart.hide(i); else chart.show(i);
                chip.classList.toggle('off', wasVisible);
                // Mirrored so the ask messages describe what is on screen.
                if (wasVisible) this._hiddenSeries.add(i);
                else this._hiddenSeries.delete(i);
            });
            legend.appendChild(chip);
        });
    }

    /** Legend for the drawn markers — and the switch that hides them.
     *  Lists only the kinds this chart actually has. */
    _renderMarkerLegend(legend, marks, chart) {
        for (const el of legend.querySelectorAll('.fa-mark-key')) el.remove();
        const keys = [
            ['zeros', 'fa-key-zero', 'roots'],
            ['extrema', 'fa-key-extremum', 'max / min'],
            ['singularities', 'fa-key-sing', 'singularity'],
        ];
        for (const [kind, cls, label] of keys) {
            if (!marks.has(kind)) continue;
            const chip = document.createElement('button');
            chip.className = 'fa-btn fa-mark-key' +
                (this._hiddenMarks.has(kind) ? ' off' : '');
            chip.title = `Show or hide the ${label} markers`;
            const glyph = document.createElement('span');
            glyph.className = `fa-key-glyph ${cls}`;
            chip.append(glyph, document.createTextNode(label));
            chip.addEventListener('click', () => {
                if (this._hiddenMarks.has(kind)) this._hiddenMarks.delete(kind);
                else this._hiddenMarks.add(kind);
                chip.classList.toggle('off', this._hiddenMarks.has(kind));
                chart.update('none');      // afterDraw re-reads the hidden set
            });
            legend.appendChild(chip);
        }
    }

    _renderAnnLegend(legend, view, annotations, redraw) {
        // Keep the marker keys; only the annotation chips are rebuilt.
        for (const el of legend.querySelectorAll('.fa-ann-chip')) el.remove();
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
                    labels.push({ text: a.label, left: px + 5, top: chartArea.top + 3, ann: a });
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
                    labels.push({ text: a.label, left: chartArea.left + 6, top: py - 17, ann: a });
                }
            } else if (a.kind === 'band') {
                const p0 = scales.x.getPixelForValue(Math.min(a.atValue, a.toValue));
                const p1 = scales.x.getPixelForValue(Math.max(a.atValue, a.toValue));
                ctx.fillStyle = BAND_FILL;
                ctx.fillRect(p0, chartArea.top, p1 - p0,
                             chartArea.bottom - chartArea.top);
                if (a.label) {
                    labels.push({ text: a.label, left: p0 + 5,
                                  top: chartArea.bottom - 20, band: true, ann: a });
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
                                scales.y.getPixelForValue(0), 3.5, 0, TAU);
                        ctx.fill();
                    }
                }
            }
            if (marks.has('extrema')) {
                for (let i = 2; i < ys.length - 2; i++) {
                    const w = ys.slice(i - 2, i + 3);
                    if (w.some(y => y == null)) continue;
                    const c = ys[i];
                    const isMax = w.every(y => y <= c) && ys[i - 2] < c && ys[i + 2] < c;
                    const isMin = w.every(y => y >= c) && ys[i - 2] > c && ys[i + 2] > c;
                    if (!isMax && !isMin) continue;
                    const px = scales.x.getPixelForValue(xs[i]);
                    const py = scales.y.getPixelForValue(c);
                    ctx.fillStyle = '#ffa726';
                    ctx.beginPath();
                    ctx.arc(px, py, 4, 0, TAU);
                    ctx.fill();
                    // Name it: an unlabelled dot is a puzzle, not a lesson.
                    ctx.fillStyle = '#ffcc80';
                    ctx.font = '10px ui-monospace, Menlo, monospace';
                    ctx.fillText(isMax ? 'max' : 'min', px + 6,
                                 isMax ? py - 6 : py + 14);
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
            // Built at CLICK time, so the values quoted are wherever the
            // learner has actually dragged the sliders.
            const ask = makeAiAskButton('ai-ask-btn fa-hover-ask fa-var-ask',
                'Ask the AI about this variable', () =>
                `In $${artifact.latex}$, what does the variable ` +
                `$${this._varLatex(chars, name)}$ represent` +
                (desc ? ` — the analysis says "${desc}"` : '') +
                `? I currently have it set to ${this._fmt(state.pins[name])}. ` +
                `Why does it matter here, and what changes as I move it?\n` +
                this._configSummary(chars, view, state));
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
