// ============================================================
// explorer.ts — the reusable Graph Explorer component: toolbar, search,
// canvas, details panel and status line around ONE GraphViewModel.
//
// One implementation serves every presentation mode. The host decides where
// the explorer's root element lives (an embedded slot in a lesson, a floating
// popup, the fullscreen layer) and moves it with mount(); the view model —
// and, while mounted, the Cytoscape instance itself — come along untouched,
// so switching modes keeps focus, selection, expansions, history, node
// positions and viewport.
//
// Graph-type specifics come from a GraphTypeAdapter; nothing here knows what
// a concept is.
// ============================================================

import type { GraphTypeAdapter, DetailsActions, DetailsContext, VisibleGraph } from '/graph-explorer/graph-type.js';
import type { GraphViewModel, PresentationMode } from '/graph-explorer/view-model.js';
import { CytoscapeGraphView } from '/graph-explorer/cy-view.js';

const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON = {
    back: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    forward: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    overview: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="4.5" cy="6" r="2"/><circle cx="19.5" cy="6" r="2"/><circle cx="12" cy="20.5" r="2"/><path d="M6.3 7l3.6 3.2M17.7 7l-3.6 3.2M12 15v3.5"/></svg>',
    fit: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    // A centre node with nodes laid out on a ring around it: "arrange around the focus".
    layout: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="7.5" stroke-dasharray="2.5 2.5"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><circle cx="12" cy="4.5" r="2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="15.8" r="2" fill="currentColor" stroke="none"/><circle cx="5.5" cy="15.8" r="2" fill="currentColor" stroke="none"/></svg>',
    popup: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="11" y="11" width="8" height="8" rx="1"/></svg>',
    full: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path d="M9 9l-5-5M15 9l5-5M9 15l-5 5M15 15l5 5"/></svg>',
    dock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

export interface ExplorerOptions<N, E> {
    vm: GraphViewModel<N, E>;
    adapter: GraphTypeAdapter<N, E>;
    /** Accessible name: "Knowledge Graph — all lessons". */
    label: string;
    /** Modes this explorer may switch to; each gets a toolbar button. */
    modes: PresentationMode[];
    /** The host moves the explorer; the explorer only asks. */
    onRequestMode: (mode: PresentationMode) => void;
    actions?: DetailsActions;
    /** Offer an "overview" button (global graph). */
    overview?: () => void;
    /** Shown when nothing is visible. */
    emptyText?: string | (() => string);
    /** Extra toolbar controls supplied by the host. */
    toolbarExtras?: HTMLElement[];
    /** Scope switch (e.g. Local / Global). The host owns what each scope means
     *  and applies it with vm.setScope(); the explorer only shows the choice. */
    scopes?: { id: string; label: string; title: string }[];
    onScope?: (id: string) => void;
    /** Host context for the details panel (e.g. the open lesson, to mark external references). */
    detailsContext?: () => DetailsContext;
    /** Builds an "Ask AI" button (the host owns the chat); omitted = no button. */
    makeAskButton?: (title: string, getMessage: () => string) => HTMLElement;
}

const MODE_META: Record<PresentationMode, { icon: string; title: string }> = {
    embedded: { icon: ICON.dock, title: 'Back to the lesson panel' },
    popup: { icon: ICON.popup, title: 'Compact popup' },
    fullscreen: { icon: ICON.full, title: 'Expand to fullscreen' },
    closed: { icon: ICON.close, title: 'Close the graph' },
};

export class GraphExplorer<N, E> {
    readonly root: HTMLElement;
    readonly vm: GraphViewModel<N, E>;
    private readonly adapter: GraphTypeAdapter<N, E>;
    private readonly opts: ExplorerOptions<N, E>;
    private view: CytoscapeGraphView<N, E> | null = null;
    private viewInit: Promise<void> | null = null;
    private readonly canvas: HTMLElement;
    private readonly details: HTMLElement;
    private readonly status: HTMLElement;
    private readonly overlay: HTMLElement;
    private readonly searchInput: HTMLInputElement;
    private readonly results: HTMLElement;
    private readonly depthLabel: HTMLElement;
    private readonly unsubs: (() => void)[] = [];
    private resizeObs: ResizeObserver | null = null;
    private themeObs: MutationObserver | null = null;
    private resizeFrame = 0;
    /** Until this time (ms), every size change refits — set by a mode switch,
     *  so the fit tracks the popup/fullscreen size transition to its end. */
    private fitUntil = 0;
    private statusExtra = '';
    private lastMountedMode: PresentationMode | null = null;
    private searchHits: string[] = [];
    private searchIndex = -1;
    private readonly reducedMotion = (): boolean =>
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    constructor(opts: ExplorerOptions<N, E>) {
        this.opts = opts;
        this.vm = opts.vm;
        this.adapter = opts.adapter;
        const root = document.createElement('div');
        root.className = 'kg-explorer';
        root.setAttribute('role', 'region');
        root.setAttribute('aria-label', opts.label);
        root.dataset.graphType = opts.vm.graphType;
        root.innerHTML = `
            <div class="kg-toolbar" role="toolbar" aria-label="Graph controls">
                <div class="kg-search">
                    <input type="search" class="kg-search-input" placeholder="Search concepts…" autocomplete="off"
                           aria-label="Search concepts" aria-autocomplete="list" aria-expanded="false" role="combobox">
                    <ul class="kg-search-results hidden" role="listbox" aria-label="Matching concepts"></ul>
                </div>
                ${opts.scopes?.length ? `<span class="kg-scope" role="radiogroup" aria-label="Scope">${opts.scopes.map((sc) =>
                    `<button type="button" class="kg-scope-btn" role="radio" aria-checked="false" data-kg-scope="${esc(sc.id)}" title="${esc(sc.title)}">${esc(sc.label)}</button>`).join('')}</span>` : ''}
                <button type="button" class="kg-tb-btn" data-kg-tb="back" title="Previous focus (Alt+←)" aria-label="Previous focus">${ICON.back}</button>
                <button type="button" class="kg-tb-btn" data-kg-tb="forward" title="Next focus (Alt+→)" aria-label="Next focus">${ICON.forward}</button>
                ${opts.overview ? `<button type="button" class="kg-tb-btn" data-kg-tb="overview" title="Overview of the best-connected concepts" aria-label="Overview">${ICON.overview}</button>` : ''}
                <button type="button" class="kg-tb-btn" data-kg-tb="layout" title="Arrange nodes in rings around the focus" aria-label="Arrange around the focus">${ICON.layout}</button>
                <span class="kg-depth" role="group" aria-label="Neighbourhood depth">
                    <button type="button" class="kg-tb-btn" data-kg-tb="depth-" title="Fewer hops around the focus" aria-label="Decrease depth">−</button>
                    <span class="kg-depth-label" aria-live="polite">1-hop</span>
                    <button type="button" class="kg-tb-btn" data-kg-tb="depth+" title="More hops around the focus" aria-label="Increase depth">+</button>
                </span>
                <span class="kg-tb-sep"></span>
                <span class="kg-zoom" role="group" aria-label="Zoom">
                    <button type="button" class="kg-tb-btn" data-kg-tb="zoom-" title="Zoom out (−)" aria-label="Zoom out">−</button>
                    <span class="kg-zoom-level" title="Double-click to fit" aria-live="polite">100%</span>
                    <button type="button" class="kg-tb-btn" data-kg-tb="zoom+" title="Zoom in (+)" aria-label="Zoom in">+</button>
                    <button type="button" class="kg-tb-btn" data-kg-tb="fit" title="Zoom to fit (F, or double-click the background)" aria-label="Zoom to fit">${ICON.fit}</button>
                </span>
                <span class="kg-tb-extras"></span>
                <span class="kg-tb-spacer"></span>
                <span class="kg-tb-modes"></span>
            </div>
            <div class="kg-body">
                <div class="kg-canvas-wrap">
                    <div class="kg-canvas" tabindex="0" aria-label="Graph canvas. Click a concept to inspect it; double-click to expand. The details panel lists every relationship as a button."></div>
                    <div class="kg-overlay" aria-live="polite"></div>
                </div>
                <aside class="kg-details" aria-label="Details" aria-live="polite"></aside>
            </div>
            <div class="kg-statusline" aria-live="polite"></div>`;
        this.root = root;
        this.canvas = root.querySelector('.kg-canvas')!;           // ! — created by the template above
        this.details = root.querySelector('.kg-details')!;
        this.status = root.querySelector('.kg-statusline')!;
        this.overlay = root.querySelector('.kg-overlay')!;
        this.searchInput = root.querySelector('.kg-search-input')!;
        this.results = root.querySelector('.kg-search-results')!;
        this.depthLabel = root.querySelector('.kg-depth-label')!;
        const extras = root.querySelector('.kg-tb-extras')!;
        for (const el of opts.toolbarExtras ?? []) extras.appendChild(el);
        this.renderModeButtons();
        this.wire();
        this.unsubs.push(this.vm.events.on('state', () => this.renderChrome()));
        this.unsubs.push(this.vm.events.on('view', () => this.renderChrome()));
        this.renderChrome();
    }

    get cyView(): CytoscapeGraphView<N, E> | null { return this.view; }

    /** Put the explorer into `host` (moving it if it lives elsewhere) and make sure it renders. */
    async mount(host: HTMLElement, mode: PresentationMode): Promise<void> {
        if (this.root.parentElement !== host) host.appendChild(this.root);
        this.root.dataset.mode = mode;
        this.vm.setPresentation(mode);
        this.renderModeButtons();
        this.observe();
        if (!this.view) {
            this.overlay.innerHTML = '<div class="kg-loading"><span class="kg-spinner" aria-hidden="true"></span>Loading graph…</div>';
            const zoomLabel = this.root.querySelector<HTMLElement>('.kg-zoom-level')!; // ! — in the template
            this.view = new CytoscapeGraphView(this.canvas, this.vm, this.adapter, {
                reducedMotion: this.reducedMotion,
                onZoom: (pct) => { zoomLabel.textContent = `${pct}%`; },
            });
            this.viewInit = this.view.init().catch((err) => {
                console.error('[graph-explorer] failed to start the renderer', err);
                this.view = null;
                this.overlay.innerHTML = '<div class="kg-error" role="alert">The graph renderer failed to load.</div>';
            });
            await this.viewInit;
            this.renderChrome();
        } else {
            await this.viewInit;
            // Same Cytoscape instance, new box. A different mode means a very
            // different box (fullscreen → popup), so fit the graph to it —
            // keeping the old zoom would leave it overflowing. The panel
            // animates its size, so keep refitting until that settles.
            const modeChanged = this.lastMountedMode !== null && this.lastMountedMode !== mode;
            if (modeChanged) this.fitUntil = performance.now() + 600;
            requestAnimationFrame(() => { this.view?.resize(); if (modeChanged) this.view?.fit(false); });
        }
        this.lastMountedMode = mode;
        // Popup / fullscreen take keyboard focus so the graph's keys work right
        // away (the status-bar entry then moves it on to the search box).
        if (mode !== 'embedded' && !this.root.contains(document.activeElement)) {
            this.canvas.focus({ preventScroll: true });
        }
    }

    /** Tear down the renderer (closing). The view model keeps all exploration state. */
    unmount(): void {
        this.view?.destroy();
        this.view = null;
        this.viewInit = null;
        this.resizeObs?.disconnect(); this.resizeObs = null;
        this.themeObs?.disconnect(); this.themeObs = null;
        this.root.remove();
        this.vm.setPresentation('closed');
    }

    /** Permanently dispose (explorer + its listeners). */
    dispose(): void {
        this.unmount();
        for (const u of this.unsubs.splice(0)) u();
    }

    /** Enable/disable one scope choice (e.g. Local when the lesson has no graph). */
    setScopeAvailable(id: string, available: boolean, title?: string): void {
        const b = this.root.querySelector<HTMLButtonElement>(`[data-kg-scope="${CSS.escape(id)}"]`);
        if (!b) return;
        b.disabled = !available;
        if (title) b.title = title;
    }

    setStatusExtra(html: string): void { this.statusExtra = html; this.renderChrome(); }

    focusSearch(): void { this.searchInput.focus(); this.searchInput.select(); }

    private observe(): void {
        if (!this.resizeObs && typeof ResizeObserver === 'function') {
            this.resizeObs = new ResizeObserver(() => {
                cancelAnimationFrame(this.resizeFrame);
                this.resizeFrame = requestAnimationFrame(() => {
                    this.view?.resize();
                    if (performance.now() < this.fitUntil) this.view?.fit(false);
                });
            });
            this.resizeObs.observe(this.canvas);
        }
        if (!this.themeObs) {
            this.themeObs = new MutationObserver(() => this.view?.restyle());
            this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
        }
    }

    private renderModeButtons(): void {
        const box = this.root.querySelector('.kg-tb-modes')!;
        const cur = this.vm.presentation;
        box.innerHTML = this.opts.modes.filter((m) => m !== cur).map((m) =>
            `<button type="button" class="kg-tb-btn" data-kg-mode="${m}" title="${esc(MODE_META[m].title)}" aria-label="${esc(MODE_META[m].title)}">${MODE_META[m].icon}</button>`,
        ).join('');
    }

    // ---------- rendering ----------

    private renderChrome(): void {
        const vm = this.vm;
        const back = this.root.querySelector<HTMLButtonElement>('[data-kg-tb="back"]')!;
        back.disabled = !vm.canGoBack;
        for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-kg-scope]')) {
            const on = b.dataset.kgScope === vm.scopeId;
            b.classList.toggle('active', on);
            b.setAttribute('aria-checked', String(on));
        }
        this.root.querySelector<HTMLButtonElement>('[data-kg-tb="forward"]')!.disabled = !vm.canGoForward;
        const depthBox = this.root.querySelector<HTMLElement>('.kg-depth')!;
        depthBox.classList.toggle('kg-disabled', vm.focus === null);
        this.depthLabel.textContent = vm.focus === null ? 'overview' : `${vm.focusDepth}-hop`;
        this.renderDetails();
        const shown = vm.visibleNodes.size;
        const total = vm.engine.nodeCount;
        let s = `${shown} of ${total} concept${total === 1 ? '' : 's'} shown · ${vm.visibleEdges.size} relationship${vm.visibleEdges.size === 1 ? '' : 's'}`;
        if (vm.truncated) s += ` · <span class="kg-warn">limited to ${vm.maxVisible} — focus or search to see more</span>`;
        if (this.statusExtra) s += ` · ${this.statusExtra}`;
        this.status.innerHTML = s;
        if (this.view?.isReady) {
            this.overlay.innerHTML = shown ? ''
                : `<div class="kg-empty">${esc((typeof this.opts.emptyText === 'function' ? this.opts.emptyText() : this.opts.emptyText)
                    ?? 'Nothing to show yet. Search for a concept to start exploring.')}</div>`;
        }
    }

    private renderDetails(): void {
        const vm = this.vm;
        const sel = vm.selection;
        if (sel?.kind === 'node') {
            const n = vm.engine.getNode(sel.id);
            if (n) {
                this.details.innerHTML = this.adapter.nodeDetailsHtml(n, vm.engine,
                    { ...this.opts.detailsContext?.(), expanded: vm.isExpanded(sel.id), isFocus: vm.focus === sel.id, hidden: vm.hiddenNeighborCount(sel.id) });
                this.details.dataset.kgFor = sel.id;
                const ask = this.adapter.askPrompt;
                // Read at click time, so the question matches what is on screen then.
                if (ask) this.addAskButton(`Ask AI about ${this.adapter.nodeLabel(n)}`, () => ask(n, vm.engine, this.visibleGraph()));
                return;
            }
        } else if (sel?.kind === 'edge') {
            const e = vm.engine.getEdge(sel.id);
            if (e) {
                this.details.innerHTML = this.adapter.edgeDetailsHtml(e, vm.engine, this.opts.detailsContext?.());
                this.details.dataset.kgFor = sel.id;
                const ask = this.adapter.askEdgePrompt;
                if (ask) this.addAskButton('Ask AI about this relationship', () => ask(e, vm.engine, this.visibleGraph()));
                return;
            }
        }
        delete this.details.dataset.kgFor;
        this.details.innerHTML = `<p class="kg-details-hint">Select a concept or relationship to see its details.</p>`
            + `<p class="kg-details-hint kg-kbd-hint">Keys: <kbd>/</kbd> search · <kbd>Enter</kbd> focus selected · `
            + `<kbd>]</kbd>/<kbd>[</kbd> or double-click: show/hide neighbours (＋N = hidden) · <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> back/forward · <kbd>F</kbd> fit</p>`
            + this.legendHtml();
    }

    private visibleGraph(): VisibleGraph {
        return { focus: this.vm.focus, nodes: this.vm.visibleNodes, edges: this.vm.visibleEdges };
    }

    private addAskButton(title: string, getMessage: () => string): void {
        const head = this.details.querySelector('.kg-details-head');
        if (!head || !this.opts.makeAskButton) return;
        head.appendChild(this.opts.makeAskButton(title, getMessage));
    }

    private legendHtml(): string {
        const lg = this.adapter.legend();
        return `<div class="kg-legend"><div class="kg-legend-title">Legend</div>`
            + lg.nodes.map(([cls, label]) => `<div class="kg-legend-row"><span class="kg-swatch kg-swatch-node ${esc(cls)}"></span>${esc(label)}</div>`).join('')
            + lg.edges.map(([cls, label]) => `<div class="kg-legend-row"><span class="kg-swatch kg-swatch-edge ${esc(cls)}"></span>${esc(label)}</div>`).join('')
            + `</div>`;
    }

    // ---------- interaction ----------

    private wire(): void {
        const root = this.root;
        root.addEventListener('click', (ev) => {
            const t = ev.target as HTMLElement;
            const tb = t.closest<HTMLElement>('[data-kg-tb]');
            if (tb) { this.toolbarAction(tb.dataset.kgTb!); return; }          // ! — selector guarantees it
            const scope = t.closest<HTMLButtonElement>('[data-kg-scope]');
            if (scope) { if (!scope.disabled) this.opts.onScope?.(scope.dataset.kgScope!); return; }
            const mode = t.closest<HTMLElement>('[data-kg-mode]');
            if (mode) { this.opts.onRequestMode(mode.dataset.kgMode as PresentationMode); return; }
            const hit = t.closest<HTMLElement>('.kg-search-results [data-kg-hit]');
            if (hit) { this.pickSearch(hit.dataset.kgHit!); return; }
            if (!t.closest('.kg-details')) return;
            const nodeBtn = t.closest<HTMLElement>('[data-kg-node]');
            if (nodeBtn) { this.selectAndShow(nodeBtn.dataset.kgNode!); return; }
            const edgeBtn = t.closest<HTMLElement>('[data-kg-edge]');
            if (edgeBtn) { this.vm.select({ kind: 'edge', id: edgeBtn.dataset.kgEdge! }); return; }
            const nav = t.closest<HTMLElement>('[data-kg-lesson]');
            if (nav) {
                this.opts.actions?.openLesson?.(nav.dataset.kgLesson!, Number(nav.dataset.kgScene), Number(nav.dataset.kgStep));
                return;
            }
            const act = t.closest<HTMLElement>('[data-kg-action]');
            if (act) this.detailsAction(act.dataset.kgAction!);
        });
        this.root.querySelector('.kg-zoom-level')!.addEventListener('dblclick', () => this.view?.fit());
        this.searchInput.addEventListener('input', () => this.runSearch());
        this.searchInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                if (!this.searchHits.length) return;
                const d = ev.key === 'ArrowDown' ? 1 : -1;
                this.searchIndex = (this.searchIndex + d + this.searchHits.length) % this.searchHits.length;
                this.renderSearch();
            } else if (ev.key === 'Enter') {
                ev.preventDefault();
                const id = this.searchHits[Math.max(0, this.searchIndex)];
                if (id) this.pickSearch(id);
            } else if (ev.key === 'Escape') {
                if (this.searchInput.value) { ev.stopPropagation(); this.searchInput.value = ''; this.runSearch(); }
            }
        });
        this.searchInput.addEventListener('blur', () => setTimeout(() => this.hideSearch(), 150));
        root.addEventListener('keydown', (ev) => this.onKey(ev));
        // Clicking the canvas must give the graph keyboard focus, or its keys
        // fall through to the app's own single-letter shortcuts (C opens chat).
        // Cytoscape's mousedown handler deliberately blurs the active element
        // (blurActiveDomElement), so focusing on press is undone — take focus
        // on RELEASE, after Cytoscape has run.
        this.canvas.addEventListener('pointerup', () => {
            if (document.activeElement !== this.canvas) this.canvas.focus({ preventScroll: true });
        });
        // The keys work anywhere in the panel, not just on the canvas: a click on
        // a non-control part (details text, toolbar gaps, status line) also
        // hands keyboard focus to the graph. Controls keep their own focus (the
        // keys work from them too), and a text selection is never disturbed.
        root.addEventListener('pointerup', (ev) => {
            const t = ev.target as Element;
            if (this.canvas.contains(t)) return;                         // handled above
            if (t.closest('input, textarea, select, button, a, [tabindex], [contenteditable]')) return;
            if (this.root.contains(document.activeElement) && document.activeElement !== document.body) return;
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && this.root.contains(sel.anchorNode)) return;
            this.canvas.focus({ preventScroll: true });
        });
    }

    private onKey(ev: KeyboardEvent): void {
        const t = ev.target as HTMLElement;
        if (t.closest('input, textarea, select')) return;
        if (ev.metaKey || ev.ctrlKey) return;
        const vm = this.vm;
        const sel = vm.selection?.kind === 'node' ? vm.selection.id : null;
        let handled = true;
        // Fall back to the physical key for layouts whose ev.key differs.
        const key = ev.key && ev.key !== 'Unidentified' ? ev.key
            : ({ Slash: '/', Minus: '-', Equal: '=', NumpadAdd: '+', NumpadSubtract: '-', BracketRight: ']', BracketLeft: '[' } as Record<string, string>)[ev.code] ?? ev.key;
        switch (key) {
            case '/': this.focusSearch(); break;
            case 'ArrowLeft': if (ev.altKey) vm.back(); else handled = false; break;
            case 'ArrowRight': if (ev.altKey) vm.forward(); else handled = false; break;
            case 'Backspace': vm.back(); break;
            case '+': case '=': this.view?.zoomBy(1.2); break;
            case '-': case '_': this.view?.zoomBy(1 / 1.2); break;
            case 'f': case 'F': this.view?.fit(); break;
            case ']': if (sel) vm.expand(sel); break;      // more neighbours
            case '[': if (sel) vm.collapse(sel); break;    // fewer
            // Enter on a focused button activates the button; anywhere else in the graph it focuses the selection.
            case 'Enter': if (sel && !t.closest('button, a')) { vm.focusOn(sel); } else handled = false; break;
            default: handled = false;
        }
        if (handled) { ev.preventDefault(); ev.stopPropagation(); }
    }

    private toolbarAction(action: string): void {
        const vm = this.vm;
        switch (action) {
            case 'back': vm.back(); break;
            case 'forward': vm.forward(); break;
            case 'overview': this.opts.overview?.(); break;
            case 'depth-': vm.setFocusDepth(vm.focusDepth - 1); break;
            case 'depth+': vm.setFocusDepth(vm.focusDepth + 1); break;
            case 'zoom-': this.view?.zoomBy(1 / 1.2); break;
            case 'zoom+': this.view?.zoomBy(1.2); break;
            case 'fit': this.view?.fit(); break;
            case 'layout': this.view?.runLayout(); break;
        }
    }

    private detailsAction(action: string): void {
        const sel = this.vm.selection;
        if (sel?.kind !== 'node') return;
        if (action === 'focus') this.vm.focusOn(sel.id);
        else if (action === 'expand') this.vm.expand(sel.id);
        else if (action === 'collapse') this.vm.collapse(sel.id);
    }

    /** Select a node; if it is not on screen, bring it in by focusing it. */
    selectAndShow(id: string): void {
        if (!this.vm.visibleNodes.has(id)) { this.vm.focusOn(id); }
        else { this.vm.select({ kind: 'node', id }); this.view?.centerOn(id); }
    }

    private runSearch(): void {
        this.searchHits = this.vm.search(this.searchInput.value);
        this.searchIndex = this.searchHits.length ? 0 : -1;
        this.renderSearch();
    }

    private renderSearch(): void {
        const q = this.searchInput.value.trim();
        if (!q) { this.hideSearch(); return; }
        const items = this.searchHits.map((id, i) => {
            const n = this.vm.engine.getNode(id)!; // ! — hits come from the engine this tick
            return `<li role="option" class="kg-hit${i === this.searchIndex ? ' active' : ''}" data-kg-hit="${esc(id)}" aria-selected="${i === this.searchIndex}">`
                + `<span class="kg-hit-label">${esc(this.adapter.nodeLabel(n))}</span>`
                + `<span class="kg-hit-sub">${esc(this.adapter.nodeSubtitle(n))}</span></li>`;
        });
        this.results.innerHTML = items.length ? items.join('') : '<li class="kg-hit-none">No matching concept</li>';
        this.results.classList.remove('hidden');
        this.searchInput.setAttribute('aria-expanded', 'true');
    }

    private hideSearch(): void {
        this.results.classList.add('hidden');
        this.searchInput.setAttribute('aria-expanded', 'false');
    }

    private pickSearch(id: string): void {
        this.vm.focusOn(id);
        this.searchInput.value = '';
        this.hideSearch();
        this.canvas.focus();
    }
}
