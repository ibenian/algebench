// SgProofManager — docks on-the-fly proof animations on the semantic graph.
//
// Mirrors SgChartManager: a floating box anchored to a node that tracks the
// renderer's pan/zoom, snap-to-grid resize, and a dock button that shares the
// SAME overlay panel as pinned charts (so charts and proofs dock side by side).
// It reuses the chart's CSS classes verbatim (.sgc-chart-box / .sgc-chart-header
// / .sgc-btn / .sgc-resize-handle / .sgc-pinned) so borders and buttons match
// the charts exactly; only the body hosts a ProofAnimator instead of a canvas.

import { ProofAnimator } from '/proof-animation/proof-animation.js';
import { invokeExpert } from '/expert-client.js';
import { nextDockSeq } from '/proof-animation/dock-seq.js';
import { makeAiAskButton } from '/labels.js';

// Session-persistent cache of derivation results, keyed by the FULL request
// shape (everything that affects the derivation — target/start/domain plus
// goal/givens/intent/context), so different givens or lesson context never reuse
// a wrong derivation. Cleared on a new lesson (see clearDeriveCache).
const _DERIVE_CACHE = new Map();
const _cacheKey = (p) => JSON.stringify({
    t: p.target_latex || '', s: p.start_latex || '', d: p.domain || '',
    g: p.goal || '', gv: p.givens || [], i: p.intent || '', c: p.context || null,
});

/** Drop all cached derivations (call on a new lesson — step keys/context change). */
export function clearDeriveCache() {
    _DERIVE_CACHE.clear();
}

// A derivation is an LM call (sometimes retried server-side); a hard goal can
// run long, but past this it's almost certainly stuck — fail with a retryable
// error rather than spin the "Deriving proof…" pill forever.
const DERIVE_TIMEOUT_MS = 90_000;

const GRID_COLS = 8;          // same grid as SgChartManager
const GRID_ROWS = 8;
const GRID_GAP = 8;
const DEFAULT_COLSPAN = 4;
const DEFAULT_ROWSPAN = 3;

export class SgProofManager {
    constructor(container, opts = {}) {
        this.container = container;
        this.katex = opts.katex || (typeof window !== 'undefined' && window.katex);
        this.boxes = new Map();      // boxId -> entry
        this._byKey = new Map();     // `${stepKey}|${nodeId}` -> boxId (dedup / re-focus)
        this._transform = { x: 0, y: 0, k: 1 };
        this._renderer = null;
        this._rafId = null;
        this._resizeObserver = null;
        this._destroyed = false;
        this._seq = 0;
        this._z = 30;                // proof boxes sit above charts (z 20)
        this._stepKey = null;        // boxes belong to the step they were derived in
    }

    // ── Renderer wiring (identical contract to SgChartManager) ───────────────
    setTransform(t) {
        this._transform = t || { x: 0, y: 0, k: 1 };
        this._updatePositions();
    }

    setRenderer(renderer) {
        this._renderer = renderer;
        this._startTransformPolling();
        this._observeResize();
    }

    _card() {
        return this.container.querySelector('.d3-graph-card') || this.container;
    }

    // A derivation belongs to the step it was created on. ``setCurrentStep`` is
    // called on every (re)render with the active step's key; only that step's
    // boxes are shown — others are detached (kept in memory) and re-shown when
    // their step is revisited. Their position/scale/dock are per-box, so docking
    // on one step never carries over to another.
    setCurrentStep(stepKey) {
        this._stepKey = stepKey;
        this._syncStep();
    }

    // Show this step's boxes (re-attaching to the freshly-recreated card / shared
    // panel), detach all others.
    _syncStep() {
        if (this._destroyed) return;
        const card = this._card();
        if (!card) return;
        for (const entry of this.boxes.values()) {
            if (entry.stepKey === this._stepKey) {
                const dest = entry.docked ? this._sharedPinnedPanel() : card;
                if (entry.box.parentNode !== dest) dest.appendChild(entry.box);
            } else if (entry.box.parentNode) {
                entry.box.parentNode.removeChild(entry.box);   // hide (keep in memory)
            }
        }
        // Re-observe the fresh card for resize, then re-snap positions.
        if (this._resizeObserver) {
            try { this._resizeObserver.disconnect(); } catch (_e) {}
            this._resizeObserver = null;
        }
        this._observeResize();
        this._updatePositions();
    }

    _startTransformPolling() {
        if (this._rafId) return;
        const poll = () => {
            this._rafId = requestAnimationFrame(poll);
            if (!this._renderer) return;
            const rt = this._renderer._currentTransform;
            if (!rt) return;
            const cur = this._transform;
            if (rt.x !== cur.x || rt.y !== cur.y || rt.k !== cur.k) {
                this._transform = { x: rt.x, y: rt.y, k: rt.k };
                this._updatePositions();
            }
        };
        this._rafId = requestAnimationFrame(poll);
    }

    _observeResize() {
        if (this._resizeObserver) return;
        this._resizeObserver = new ResizeObserver(() => {
            // Grid steps depend on the card size — re-snap every box, then refit.
            for (const entry of this.boxes.values()) {
                this._applyGridSize(entry);
                this._fit(entry);
            }
            this._updatePositions();
        });
        this._resizeObserver.observe(this._card());
    }

    // ── Grid sizing (copied from SgChartManager so it snaps identically) ─────
    _getGridSteps() {
        const rect = this._card().getBoundingClientRect();
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
    }

    // The box CSS (.sgp-pa height:100% + the flex zones) makes the animator fill
    // the grid cell, and the animator re-fits its own expression on size change
    // (its ResizeObserver reacts to width AND height in fitHeight mode). We just
    // force an immediate relayout so resize/dock feels instant instead of waiting
    // for the animator's debounced observer.
    _fit(entry) {
        const a = entry && entry.animator;
        if (a && typeof a._relayout === 'function') a._relayout();
    }

    _updatePositions() {
        const rect = this._card().getBoundingClientRect();
        const { x: tx, y: ty, k } = this._transform;
        const placed = [];
        for (const entry of this.boxes.values()) {
            if (entry.docked || entry.stepKey !== this._stepKey) continue;  // only current step
            const w = entry.box.offsetWidth;
            const h = entry.box.offsetHeight;
            let left = entry.graphX * k + tx;
            let top = entry.graphY * k + ty;
            left = Math.max(4, Math.min(left, rect.width - w - 4));
            top = Math.max(4, Math.min(top, rect.height - h - 4));
            for (let attempt = 0; attempt < 4; attempt++) {
                let collision = false;
                for (const p of placed) {
                    if (left < p.right && left + w > p.left &&
                        top < p.bottom && top + h > p.top) {
                        collision = true;
                        top = p.bottom + 4;
                        if (top + h > rect.height - 4) { top = 4; left = p.right + 4; }
                        break;
                    }
                }
                if (!collision) break;
                left = Math.max(4, Math.min(left, rect.width - w - 4));
                top = Math.max(4, Math.min(top, rect.height - h - 4));
            }
            placed.push({ left, top, right: left + w, bottom: top + h });
            entry.box.style.left = `${left}px`;
            entry.box.style.top = `${top}px`;
        }
    }

    // ── Public entry: derive + dock a proof animation for a node ─────────────
    openProof(nodeId, anchorEl, payload) {
        if (this._destroyed) return;

        const dedupKey = `${this._stepKey}|${nodeId}`;   // one box per node PER STEP
        const existingId = this._byKey.get(dedupKey);
        if (existingId && this.boxes.has(existingId)) {
            const e = this.boxes.get(existingId);
            e.box.style.zIndex = String(++this._z);
            if (e.state === 'error') this._runDerivation(e, payload);
            return;
        }

        const card = this._card();
        const box = document.createElement('div');
        box.className = 'sgc-chart-box sgp-proof-box';
        box.dataset.dockOrder = String(nextDockSeq());   // stable shared dock order

        const header = document.createElement('div');
        header.className = 'sgc-chart-header';
        const titleEl = document.createElement('span');
        titleEl.className = 'sgc-chart-title';
        titleEl.textContent = 'Derivation';
        const controls = document.createElement('div');
        controls.className = 'sgc-chart-controls';
        const dockBtn = document.createElement('button');
        dockBtn.className = 'sgc-btn sgc-pin-btn';
        dockBtn.type = 'button';
        dockBtn.title = 'Pin to overlay';
        dockBtn.innerHTML = '&#x1F4CC;';   // 📌
        const closeBtn = document.createElement('button');
        closeBtn.className = 'sgc-btn sgc-close-btn';
        closeBtn.type = 'button';
        closeBtn.title = 'Close';
        closeBtn.textContent = '×';
        controls.append(dockBtn, closeBtn);
        header.append(titleEl, controls);

        const body = document.createElement('div');
        body.className = 'sgp-body';
        box.append(header, body);
        card.appendChild(box);

        const entry = {
            boxId: `proof_${++this._seq}`, nodeId, stepKey: this._stepKey, box, body, titleEl, header, dockBtn,
            paWrap: null,
            colSpan: DEFAULT_COLSPAN, rowSpan: DEFAULT_ROWSPAN,
            graphX: 0, graphY: 0,
            pinned: false, docked: false,
            state: 'loading', animator: null,
        };
        this._applyGridSize(entry);

        // Anchor next to the node button, then store graph-space coords so the
        // box tracks pan/zoom (same math as SgChartManager.openChart).
        const cardRect = card.getBoundingClientRect();
        let left = 4, top = 4;
        if (anchorEl) {
            const r = anchorEl.getBoundingClientRect();
            left = r.right - cardRect.left + 8;
            top = r.top - cardRect.top;
        }
        const w = box.offsetWidth || 300;
        const h = box.offsetHeight || 200;
        left = Math.max(4, Math.min(left, cardRect.width - w - 4));
        top = Math.max(4, Math.min(top, cardRect.height - h - 4));
        box.style.position = 'absolute';
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.zIndex = String(++this._z);
        const { x: tx, y: ty, k } = this._transform;
        entry.graphX = (left - tx) / k;
        entry.graphY = (top - ty) / k;

        this.boxes.set(entry.boxId, entry);
        this._byKey.set(dedupKey, entry.boxId);

        closeBtn.addEventListener('click', () => this.closeBox(entry.boxId));
        dockBtn.addEventListener('click', () => this._toggleDock(entry.boxId));
        this._makeDraggable(entry, header);
        this._addResizeHandle(entry);

        this._runDerivation(entry, payload);
        this._updatePositions();
    }

    async _runDerivation(entry, payload) {
        // Guard non-derivable nodes (operators / structural nodes with no
        // expression) — fire nothing, just explain.
        if (!payload || !payload.target_latex || !String(payload.target_latex).trim()) {
            entry.state = 'error';
            this._renderError(entry, new Error('This node has no expression to derive.'));
            return;
        }
        // Session cache: a previously-derived expression mounts instantly and is
        // never recomputed (persists across navigation/re-renders).
        const key = _cacheKey(payload);
        const cached = _DERIVE_CACHE.get(key);
        if (cached) {
            if (cached.title) this._renderInlineMath(entry.titleEl, cached.title);
            this._mountAnimator(entry, cached);
            entry.state = 'ready';
            return;
        }
        entry.state = 'loading';
        this._renderLoading(entry, payload);
        const pill = this._showPill();
        try {
            const data = await invokeExpert('proof_animation', payload, { timeoutMs: DERIVE_TIMEOUT_MS });
            if (this._destroyed || !this.boxes.has(entry.boxId)) return;
            _DERIVE_CACHE.set(key, data);
            if (data && data.title) this._renderInlineMath(entry.titleEl, data.title);
            this._mountAnimator(entry, data);
            entry.state = 'ready';
        } catch (err) {
            if (this._destroyed || !this.boxes.has(entry.boxId)) return;
            entry.state = 'error';
            this._renderError(entry, err, payload);
        } finally {
            this._removePill(pill);
        }
    }

    _mountAnimator(entry, data) {
        entry.body.innerHTML = '';
        entry.paWrap = null;
        if (!data || !Array.isArray(data.steps) || data.steps.length === 0) {
            this._renderError(entry, new Error('The derivation produced no steps.'));
            return;
        }
        // Mount into a full-width wrapper (.sgp-pa is width:100%): the animator
        // fills the box width and its responsive _fit scales the expression to
        // it; _fit() here only zooms down if the height would overflow.
        const paWrap = document.createElement('div');
        paWrap.className = 'sgp-pa';
        entry.body.appendChild(paWrap);
        entry.paWrap = paWrap;
        try {
            // fitHeight: the animator fills this fixed-size box and scales its
            // expression to fit (the box CSS owns the layout — see .sgp-pa). No
            // host-side transform, so the nav bar stays anchored to the bottom.
            entry.animator = new ProofAnimator(paWrap, data, {
                katex: this.katex,
                aiAskButton: makeAiAskButton,
                fitHeight: true,
            });
        } catch (e) {
            entry.paWrap = null;
            this._renderError(entry, e);
            return;
        }
        this._fit(entry);
        this._updatePositions();
    }

    _renderLoading(entry, payload) {
        entry.paWrap = null;
        entry.body.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'sgp-status';
        wrap.innerHTML =
            '<span class="sgp-dots"><span></span><span></span><span></span></span>';
        const label = document.createElement('span');
        label.className = 'sgp-status-label';
        const target = payload && payload.target_latex;
        if (target && String(target).trim()) {
            // Qualify with the expression being derived, e.g. "Deriving $a = …$".
            label.appendChild(document.createTextNode('Deriving '));
            const m = document.createElement('span');
            try { this.katex.render(String(target), m, { throwOnError: false, displayMode: false }); }
            catch (_e) { m.textContent = String(target); }
            label.appendChild(m);
            label.appendChild(document.createTextNode('…'));
        } else {
            label.textContent = 'Deriving proof…';
        }
        wrap.appendChild(label);
        entry.body.appendChild(wrap);
    }

    _renderError(entry, err, payload) {
        entry.paWrap = null;
        const msg = (err && err.message) || 'Derivation failed.';
        entry.body.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'sgp-error';
        const m = document.createElement('div');
        m.className = 'sgp-error-msg';
        this._renderInlineMath(m, msg);   // render any $…$ expressions as KaTeX
        wrap.appendChild(m);
        if (payload) {
            const retry = document.createElement('button');
            retry.className = 'sgp-retry';
            retry.type = 'button';
            retry.textContent = 'Retry';
            retry.addEventListener('click', () => this._runDerivation(entry, payload));
            wrap.appendChild(retry);
        }
        entry.body.appendChild(wrap);
    }

    closeBox(boxId) {
        const entry = this.boxes.get(boxId);
        if (!entry) return;
        try { entry.animator && entry.animator.destroy && entry.animator.destroy(); } catch (_e) {}
        if (entry.box.parentNode) entry.box.parentNode.removeChild(entry.box);
        this.boxes.delete(boxId);
        const k = `${entry.stepKey}|${entry.nodeId}`;
        if (this._byKey.get(k) === boxId) this._byKey.delete(k);
    }

    // Drag the box by its header; update the stored graph anchor so it stays put
    // under subsequent pan/zoom.
    _makeDraggable(entry, handle) {
        let startX = 0, startY = 0, baseLeft = 0, baseTop = 0;
        const onMove = (ev) => {
            const card = this._card().getBoundingClientRect();
            let left = baseLeft + (ev.clientX - startX);
            let top = baseTop + (ev.clientY - startY);
            left = Math.max(4, Math.min(left, card.width - entry.box.offsetWidth - 4));
            top = Math.max(4, Math.min(top, card.height - entry.box.offsetHeight - 4));
            entry.box.style.left = `${left}px`;
            entry.box.style.top = `${top}px`;
        };
        const onUp = () => {
            const { x: tx, y: ty, k } = this._transform;
            entry.graphX = (parseFloat(entry.box.style.left) - tx) / k;
            entry.graphY = (parseFloat(entry.box.style.top) - ty) / k;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        handle.addEventListener('pointerdown', (ev) => {
            if (entry.docked) return;                  // docked boxes flow in the panel
            if (ev.target.closest('button')) return;   // not from header buttons
            ev.preventDefault();
            entry.box.style.zIndex = String(++this._z);
            startX = ev.clientX; startY = ev.clientY;
            baseLeft = parseFloat(entry.box.style.left) || 0;
            baseTop = parseFloat(entry.box.style.top) || 0;
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
    }

    // ── Resize corner — snap-to-grid (col/row spans), identical to charts ────
    _addResizeHandle(entry) {
        const handle = document.createElement('div');
        handle.className = 'sgc-resize-handle';
        handle.title = 'Resize';
        entry.box.appendChild(handle);
        let startX = 0, startY = 0, startCol = 0, startRow = 0;
        const onMove = (ev) => {
            const step = this._getGridSteps();
            const unitW = step.w + GRID_GAP;
            const unitH = step.h + GRID_GAP;
            const col = Math.max(2, Math.min(GRID_COLS, startCol + Math.round((ev.clientX - startX) / unitW)));
            const row = Math.max(2, Math.min(GRID_ROWS, startRow + Math.round((ev.clientY - startY) / unitH)));
            if (col !== entry.colSpan || row !== entry.rowSpan) {
                entry.colSpan = col;
                entry.rowSpan = row;
                this._applyGridSize(entry);
                this._fit(entry);
                if (!entry.docked) this._updatePositions();
            }
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        handle.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            entry.box.style.zIndex = String(++this._z);
            startX = ev.clientX; startY = ev.clientY;
            startCol = entry.colSpan; startRow = entry.rowSpan;
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
    }

    // ── Dock / undock — share the chart manager's pinned panel (side by side) ─
    _sharedPinnedPanel() {
        const card = this._card();
        let panel = card.querySelector('.sgc-pinned-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'sgc-pinned-panel';
            card.appendChild(panel);
        }
        return panel;
    }

    _toggleDock(boxId) {
        const entry = this.boxes.get(boxId);
        if (!entry) return;
        entry.docked ? this._undock(entry) : this._dock(entry);
    }

    _dock(entry) {
        entry.docked = true;
        entry.box.classList.add('sgc-pinned');
        entry.box.style.position = '';
        entry.box.style.left = '';
        entry.box.style.top = '';
        entry.box.style.zIndex = '';
        this._sharedPinnedPanel().appendChild(entry.box);
        this._applyGridSize(entry);
        this._fit(entry);
        if (entry.dockBtn) { entry.dockBtn.classList.add('sgc-pin-active'); entry.dockBtn.title = 'Unpin from overlay'; }
    }

    _undock(entry) {
        entry.docked = false;
        entry.box.classList.remove('sgc-pinned');
        this._card().appendChild(entry.box);
        entry.box.style.position = 'absolute';
        entry.box.style.zIndex = String(++this._z);
        this._applyGridSize(entry);
        this._fit(entry);
        if (entry.dockBtn) { entry.dockBtn.classList.remove('sgc-pin-active'); entry.dockBtn.title = 'Pin to overlay'; }
        this._updatePositions();    // re-anchor from stored graphX/graphY
    }

    // Render a caption that may contain inline $…$ LaTeX (e.g. a proof goal) into
    // an element, KaTeX-rendering the math segments and leaving prose as text.
    _renderInlineMath(el, text) {
        el.innerHTML = '';
        if (!text) { el.textContent = 'Derivation'; return; }
        for (const part of String(text).split(/(\$[^$]+\$)/g)) {
            if (part.length > 1 && part.startsWith('$') && part.endsWith('$') && this.katex) {
                const span = document.createElement('span');
                try { this.katex.render(part.slice(1, -1), span, { throwOnError: false, displayMode: false }); }
                catch (_e) { span.textContent = part; }
                el.appendChild(span);
            } else if (part) {
                el.appendChild(document.createTextNode(part));
            }
        }
    }

    // ── "Deriving proof…" pill — coexists in the enrichment indicator stack ──
    // Uses a distinct class so the enrichment step-visibility logic never hides
    // it; dispatches sgc:legend-change so graph-view re-stacks it above legends.
    _showPill() {
        const vp = document.getElementById('graph-viewport');
        if (!vp) return null;
        let stack = vp.querySelector('.graph-enrich-indicator-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'graph-enrich-indicator-stack';
            vp.appendChild(stack);
        }
        const el = document.createElement('div');
        el.className = 'sgp-derive-indicator';
        el.setAttribute('role', 'status');
        el.innerHTML = '<span class="gei-dots"><span></span><span></span><span></span></span>'
            + '<span class="gei-text">Deriving proof…</span>';
        stack.appendChild(el);
        document.dispatchEvent(new CustomEvent('sgc:legend-change'));
        return el;
    }

    _removePill(pill) {
        if (pill && pill.parentNode) {
            pill.parentNode.removeChild(pill);
            document.dispatchEvent(new CustomEvent('sgc:legend-change'));
        }
    }

    destroy() {
        this._destroyed = true;
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        if (this._resizeObserver) { try { this._resizeObserver.disconnect(); } catch (_e) {} this._resizeObserver = null; }
        for (const boxId of Array.from(this.boxes.keys())) this.closeBox(boxId);
    }
}
