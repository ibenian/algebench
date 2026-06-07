// SgProofManager — docks on-the-fly proof animations on the semantic graph.
//
// Mirrors SgChartManager's docking model (anchor a floating box to a node,
// track the renderer's pan/zoom transform so it stays put, resolve collisions
// between concurrent boxes) but mounts a ProofAnimator instead of a Chart.js
// canvas. Each Derive click opens one box keyed by nodeId; multiple boxes can
// derive and play at once. Concurrency/abuse is capped server-side by the
// shared per-IP rate limiter — this manager just renders state.

import { ProofAnimator } from '/proof-animation/proof-animation.js';
import { invokeExpert } from '/expert-client.js';

const BOX_W = 360;   // fixed dock width (the animator measures against this)

export class SgProofManager {
    constructor(container, opts = {}) {
        this.container = container;
        this.katex = opts.katex || (typeof window !== 'undefined' && window.katex);
        this.boxes = new Map();      // boxId -> entry
        this._byNode = new Map();    // nodeId -> boxId (dedup / re-focus)
        this._transform = { x: 0, y: 0, k: 1 };
        this._renderer = null;
        this._rafId = null;
        this._resizeObserver = null;
        this._destroyed = false;
        this._seq = 0;
        this._z = 30;                // proof boxes sit above charts (z 20)
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
        this._resizeObserver = new ResizeObserver(() => this._updatePositions());
        this._resizeObserver.observe(this._card());
    }

    // Reposition every unpinned box from its stored graph-space anchor, re-clamp
    // to the card, and nudge apart any that overlap (mirrors chart docking).
    _updatePositions() {
        const rect = this._card().getBoundingClientRect();
        const { x: tx, y: ty, k } = this._transform;
        const placed = [];
        for (const entry of this.boxes.values()) {
            if (entry.pinned) continue;
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

        // Dedup: a node already has a box → re-focus (and retry if it errored).
        const existingId = this._byNode.get(nodeId);
        if (existingId && this.boxes.has(existingId)) {
            const e = this.boxes.get(existingId);
            e.box.style.zIndex = String(++this._z);
            if (e.state === 'error') this._runDerivation(e, payload);
            return;
        }

        const card = this._card();
        const box = document.createElement('div');
        box.className = 'sgp-proof-box';
        box.style.width = `${BOX_W}px`;

        const header = document.createElement('div');
        header.className = 'sgp-header';
        const titleEl = document.createElement('span');
        titleEl.className = 'sgp-title';
        titleEl.textContent = 'Derivation';
        const dockBtn = document.createElement('button');
        dockBtn.className = 'sgp-dock-btn';
        dockBtn.type = 'button';
        dockBtn.title = 'Dock to overlay';
        dockBtn.setAttribute('aria-label', 'Dock');
        dockBtn.innerHTML = '\u{1F4CC}';   // 📌
        const closeBtn = document.createElement('button');
        closeBtn.className = 'sgp-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.innerHTML = '&times;';
        header.append(titleEl, dockBtn, closeBtn);

        const body = document.createElement('div');
        body.className = 'sgp-body';

        box.append(header, body);
        card.appendChild(box);

        // Anchor next to the node button, then store the graph-space coords so
        // the box tracks pan/zoom (same math as SgChartManager.openChart).
        const cardRect = card.getBoundingClientRect();
        let left = 4, top = 4;
        if (anchorEl) {
            const r = anchorEl.getBoundingClientRect();
            left = r.right - cardRect.left + 8;
            top = r.top - cardRect.top;
        }
        const w = box.offsetWidth || BOX_W;
        const h = box.offsetHeight || 120;
        left = Math.max(4, Math.min(left, cardRect.width - w - 4));
        top = Math.max(4, Math.min(top, cardRect.height - h - 4));
        box.style.position = 'absolute';
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.zIndex = String(++this._z);

        const { x: tx, y: ty, k } = this._transform;
        const boxId = `proof_${++this._seq}`;
        const entry = {
            boxId, nodeId, box, body, titleEl, header, dockBtn,
            graphX: (left - tx) / k,
            graphY: (top - ty) / k,
            pinned: false,
            docked: false,
            scale: 1,
            state: 'loading',
            animator: null,
        };
        this.boxes.set(boxId, entry);
        this._byNode.set(nodeId, boxId);

        closeBtn.addEventListener('click', () => this.closeBox(boxId));
        dockBtn.addEventListener('click', () => this._toggleDock(boxId));
        this._makeDraggable(entry, header);
        this._addResizeHandle(entry);

        this._runDerivation(entry, payload);
        this._updatePositions();
    }

    async _runDerivation(entry, payload) {
        entry.state = 'loading';
        this._renderLoading(entry);
        const pill = this._showPill();
        try {
            const data = await invokeExpert('proof_animation', payload);
            if (this._destroyed || !this.boxes.has(entry.boxId)) return;
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
        if (!data || !Array.isArray(data.steps) || data.steps.length === 0) {
            this._renderError(entry, new Error('The derivation produced no steps.'));
            return;
        }
        try {
            entry.animator = new ProofAnimator(entry.body, data, { katex: this.katex });
        } catch (e) {
            this._renderError(entry, e);
            return;
        }
        // Re-apply any user zoom, then re-resolve overlaps (height changed).
        if (entry.scale && entry.scale !== 1) this._applyScale(entry, entry.scale);
        this._updatePositions();
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

    _renderLoading(entry) {
        entry.body.innerHTML =
            '<div class="sgp-status"><span class="sgp-dots"><span></span><span></span><span></span></span>'
            + '<span>Deriving proof…</span></div>';
    }

    _renderError(entry, err, payload) {
        const msg = (err && err.message) || 'Derivation failed.';
        entry.body.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'sgp-error';
        const m = document.createElement('div');
        m.className = 'sgp-error-msg';
        m.textContent = msg;
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
        this._updatePositions();
    }

    closeBox(boxId) {
        const entry = this.boxes.get(boxId);
        if (!entry) return;
        try { entry.animator && entry.animator.destroy && entry.animator.destroy(); } catch (_e) {}
        if (entry.box.parentNode) entry.box.parentNode.removeChild(entry.box);
        this.boxes.delete(boxId);
        if (this._byNode.get(entry.nodeId) === boxId) this._byNode.delete(entry.nodeId);
    }

    // Drag the box by its header; update the stored graph anchor so it stays put
    // under subsequent pan/zoom. Dragging marks the box "pinned" only while the
    // pointer is down (so transform polling doesn't fight the drag).
    _makeDraggable(entry, handle) {
        handle.style.cursor = 'grab';
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
            entry.pinned = false;
            const { x: tx, y: ty, k } = this._transform;
            entry.graphX = (parseFloat(entry.box.style.left) - tx) / k;
            entry.graphY = (parseFloat(entry.box.style.top) - ty) / k;
            handle.style.cursor = 'grab';
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        handle.addEventListener('pointerdown', (ev) => {
            if (entry.docked) return;                       // docked boxes flow in the panel
            if (ev.target.closest('button')) return;        // not from header buttons
            ev.preventDefault();
            entry.pinned = true;                            // freeze transform-driven moves
            entry.box.style.zIndex = String(++this._z);
            startX = ev.clientX; startY = ev.clientY;
            baseLeft = parseFloat(entry.box.style.left) || 0;
            baseTop = parseFloat(entry.box.style.top) || 0;
            handle.style.cursor = 'grabbing';
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
    }

    // ── Resize corner — drag to zoom the animation (scale the .pa-root) ──────
    _addResizeHandle(entry) {
        const handle = document.createElement('div');
        handle.className = 'sgp-resize-handle';
        handle.title = 'Resize';
        entry.box.appendChild(handle);
        let startX = 0, startScale = 1;
        const onMove = (ev) => {
            const s = Math.max(0.6, Math.min(2.4, startScale + (ev.clientX - startX) / BOX_W));
            this._applyScale(entry, s);
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        handle.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            entry.box.style.zIndex = String(++this._z);
            startX = ev.clientX;
            startScale = entry.scale || 1;
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        });
    }

    // Zoom the animation content. ProofAnimator turns the body into the
    // `.pa-root`, so we CSS-`zoom` that element (zoom reflows, so the box sizes
    // to the scaled content with no gaps); the box width tracks the scale.
    _applyScale(entry, s) {
        entry.scale = s;
        const pa = entry.box.querySelector('.pa-root') || entry.body;
        pa.style.zoom = s;
        entry.box.style.width = `${Math.round(BOX_W * s)}px`;
        if (!entry.docked) this._updatePositions();
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
        entry.pinned = true;                  // skip transform-driven repositioning
        entry.box.classList.add('sgp-pinned');
        entry.box.style.position = '';
        entry.box.style.left = '';
        entry.box.style.top = '';
        entry.box.style.zIndex = '';
        this._sharedPinnedPanel().appendChild(entry.box);
        if (entry.dockBtn) { entry.dockBtn.classList.add('sgp-dock-active'); entry.dockBtn.title = 'Undock'; }
    }

    _undock(entry) {
        entry.docked = false;
        entry.pinned = false;
        entry.box.classList.remove('sgp-pinned');
        this._card().appendChild(entry.box);
        entry.box.style.position = 'absolute';
        entry.box.style.zIndex = String(++this._z);
        if (entry.dockBtn) { entry.dockBtn.classList.remove('sgp-dock-active'); entry.dockBtn.title = 'Dock to overlay'; }
        this._updatePositions();          // re-anchor from stored graphX/graphY
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
