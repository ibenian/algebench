// ============================================================
// cy-view.ts — the Cytoscape VIEW: renders a GraphViewModel and turns user
// gestures into view-model calls. It is the only module that touches
// Cytoscape, and Cytoscape is never the source of truth: every element it
// holds is derived from the engine through the view model, and is re-derived
// when the view is rebuilt.
//
// Cytoscape is bundled by Vite (never loaded from a CDN) and imported lazily
// here, so it becomes its own chunk that downloads only when a graph is first
// shown.
//
// Sync is incremental: a ViewPatch adds/removes/updates exactly the elements
// it names inside one cy.batch(). New nodes are placed around the node they
// grew from (ringPlacement) and existing nodes never move unless the user asks
// for a re-layout.
// ============================================================

import type { Core, ElementDefinition, NodeSingular, StylesheetJson } from 'cytoscape';
import type { GraphViewModel, ViewPatch } from '/graph-explorer/view-model.js';
import type { GraphTypeAdapter } from '/graph-explorer/graph-type.js';
import { displayLabel, ringPlacement, toCyEdge, toCyNode } from '/graph-explorer/cy-elements.js';

type CytoscapeFactory = typeof import('cytoscape');

/** Fit never zooms in past this, so a handful of nodes isn't drawn huge. */
const FIT_MAX_ZOOM = 1.5;
let cytoscapePromise: Promise<CytoscapeFactory> | null = null;

/** Load Cytoscape once (a separate bundle chunk). */
export function loadCytoscape(): Promise<CytoscapeFactory> {
    if (!cytoscapePromise) {
        cytoscapePromise = import('cytoscape').then((m) => (m as unknown as { default: CytoscapeFactory }).default ?? m);
        cytoscapePromise.catch(() => { cytoscapePromise = null; });
    }
    return cytoscapePromise;
}

export interface CyViewOptions {
    reducedMotion?: () => boolean;
    /** Zoom changed (percent, rounded) — drives the toolbar's live zoom label. */
    onZoom?: (percent: number) => void;
    /** Called once the first render (and layout) is done. */
    onReady?: () => void;
}

/** Resolve the app's theme tokens into concrete colours Cytoscape can use. */
function themeColors(el: HTMLElement): Record<string, string> {
    const cs = getComputedStyle(el);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    return {
        text: v('--text-color', '#e8e6da'),
        muted: v('--muted-color', '#97a29a'),
        panel: v('--panel-bg', '#1e2621'),
        page: v('--page-bg', '#161c19'),
        accent: v('--accent-color', '#d9a441'),
        problem: v('--code-keyword', '#d9a441'),
        ds: v('--code-builtin', '#8fb8c9'),
        technique: v('--code-function', '#a9c47f'),
        invariant: v('--code-decorator', '#c49bd8'),
        analysis: v('--code-constant', '#d48f6a'),
        font: v('--font-body', 'sans-serif'),
        // The neon "tube": the accent pushed most of the way to white, so the
        // core reads as lit even on the light theme.
        neon: mixHex(v('--accent-color', '#d9a441'), '#ffffff', 0.6),
        // Neon text: on dark, light text with an accent glow; on paper that
        // washes out, so dark accent text with a light glow instead.
        ...(document.documentElement.dataset.theme === 'light'
            ? { neonText: v('--accent-color', '#9a6d1c'), neonTextGlow: mixHex(v('--accent-color', '#9a6d1c'), '#ffffff', 0.75) }
            : { neonText: mixHex(v('--accent-color', '#d9a441'), '#ffffff', 0.6), neonTextGlow: v('--accent-color', '#d9a441') }),
    };
}

/** Mix two #rrggbb colours (t = share of `b`). Falls back to `a` on anything else. */
function mixHex(a: string, b: string, t: number): string {
    const p = (h: string) => /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null;
    const x = p(a), y = p(b);
    if (!x || !y) return a;
    return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('');
}

export function buildStylesheet(c: Record<string, string>): StylesheetJson {
    return [
        // Compact filled shapes with the label underneath: dense enough to stay
        // readable in a narrow embedded panel, and the shape carries the
        // category for colour-blind readers (legend in the details panel).
        { selector: 'node', style: {
            'shape': 'ellipse', 'width': 20, 'height': 20,
            // Halo (underlay) and highlight (overlay) follow the node's own
            // outline — Cytoscape offers only ellipse or round-rectangle, so
            // the round-ish shapes get ellipse and problem nodes (below) get
            // round-rectangle; never an oval around a box or a box around a dot.
            'overlay-shape': 'ellipse', 'underlay-shape': 'ellipse',
            'background-color': c.muted!, 'border-width': 2, 'border-color': c.page!,
            'label': 'data(display)', 'color': c.text!, 'font-family': c.font!, 'font-size': 11,
            'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 4,
            'text-wrap': 'wrap', 'text-max-width': '110px',
            'text-background-color': c.page!, 'text-background-opacity': 0.7, 'text-background-padding': '1px',
            'min-zoomed-font-size': 5,
            'transition-property': 'border-color, border-width, background-color', 'transition-duration': 160,
        } },
        { selector: 'node.cat-problem', style: { 'background-color': c.problem!, 'shape': 'round-rectangle', 'width': 24, 'height': 18,
            'overlay-shape': 'round-rectangle', 'underlay-shape': 'round-rectangle' } as never },
        { selector: 'node.cat-data-structure', style: { 'background-color': c.ds! } },
        { selector: 'node.cat-technique', style: { 'background-color': c.technique!, 'shape': 'round-triangle' } },
        { selector: 'node.cat-invariant', style: { 'background-color': c.invariant!, 'shape': 'diamond', 'width': 22, 'height': 22 } },
        { selector: 'node.cat-analysis', style: { 'background-color': c.analysis!, 'shape': 'round-pentagon' as never } },
        { selector: 'node.runtime', style: { 'border-style': 'dashed', 'border-color': c.accent!, 'border-width': 2 } },
        { selector: 'node.expanded', style: { 'border-color': c.text!, 'border-width': 2 } },
        // The focus reads as a lit neon tube: a near-white core (border), a
        // crisp accent ring around it (outline) and a wide soft bloom
        // (underlay), with a glowing label. Cytoscape has no canvas blur, so
        // the glow is these three stacked layers; updateFocusGlow() pulses the
        // ring and bloom. Selection uses the TEXT colour, so "where I am"
        // (focus) and "what I'm inspecting" (selection) never look alike.
        { selector: 'node.focus', style: {
            'width': 34, 'height': 34, 'border-width': 3, 'border-color': c.neon!,
            'outline-color': c.accent!, 'outline-width': 4, 'outline-offset': 0, 'outline-opacity': 0.9,
            'underlay-color': c.accent!, 'underlay-opacity': 0.3, 'underlay-padding': 14,
            'color': c.neonText!, 'text-outline-color': c.neonTextGlow!, 'text-outline-width': 1.6, 'text-outline-opacity': 0.75,
            'text-background-opacity': 0,
            'font-weight': 'bold', 'font-size': 13, 'text-margin-y': 9, 'z-index': 10,
        } as never },
        { selector: 'node.cat-problem.focus', style: { 'width': 42, 'height': 30 } },
        { selector: 'node.selected', style: { 'border-color': c.text!, 'border-width': 3,
            'overlay-color': c.text!, 'overlay-opacity': 0.1, 'overlay-padding': 6 } },
        { selector: 'node.focus.selected', style: { 'border-color': c.neon!, 'border-width': 4 } },
        { selector: 'node.just-added', style: { 'overlay-color': c.accent!, 'overlay-opacity': 0.3, 'overlay-padding': 12 } },
        { selector: 'edge', style: {
            'width': 1.5, 'line-color': c.muted!, 'target-arrow-color': c.muted!, 'target-arrow-shape': 'triangle',
            'arrow-scale': 1, 'curve-style': 'bezier', 'label': 'data(label)', 'font-size': 9,
            'color': c.muted!, 'text-rotation': 'autorotate', 'text-background-color': c.page!,
            'text-background-opacity': 0.85, 'text-background-padding': '2px', 'font-family': c.font!,
            'min-zoomed-font-size': 7,
            'transition-property': 'line-color, width', 'transition-duration': 160,
        } },
        { selector: 'edge.kind-analysis', style: { 'line-style': 'dashed' } },
        { selector: 'edge.kind-association', style: { 'line-style': 'dotted', 'target-arrow-shape': 'none' } },
        { selector: 'edge.kind-structural', style: { 'target-arrow-shape': 'triangle-backcurve' } },
        { selector: 'edge.runtime', style: { 'line-color': c.accent!, 'target-arrow-color': c.accent! } },
        { selector: 'edge.incident', style: { 'line-color': c.text!, 'target-arrow-color': c.text!, 'width': 2.2, 'color': c.text! } },
        { selector: 'edge.selected', style: { 'line-color': c.accent!, 'target-arrow-color': c.accent!, 'width': 3, 'color': c.accent! } },
    ] as StylesheetJson;
}

export class CytoscapeGraphView<N, E> {
    private cy: Core | null = null;
    private readonly unsubs: (() => void)[] = [];
    private destroyed = false;
    private viewportTimer: ReturnType<typeof setTimeout> | null = null;
    private flashTimer: ReturnType<typeof setTimeout> | null = null;
    private wheelHandler: ((ev: WheelEvent) => void) | null = null;
    private currentLayout: { stop(): unknown } | null = null;
    /** The node currently glowing as the focus, and a token that ends its pulse loop. */
    private glowNode: NodeSingular | null = null;
    private glowGen = 0;
    /** Work deferred while the container has no size (e.g. the Doc tab is hidden). */
    private pendingLayout = false;
    private pendingFit = false;
    private readonly container: HTMLElement;
    private readonly vm: GraphViewModel<N, E>;
    private readonly adapter: GraphTypeAdapter<N, E>;
    private readonly opts: CyViewOptions;
    /** Last applied patch counts — read by tests and the perf harness. */
    lastPatchStats = { added: 0, removed: 0, updated: 0, ms: 0 };

    constructor(container: HTMLElement, vm: GraphViewModel<N, E>, adapter: GraphTypeAdapter<N, E>, opts: CyViewOptions = {}) {
        this.container = container;
        this.vm = vm;
        this.adapter = adapter;
        this.opts = opts;
    }

    get core(): Core | null { return this.cy; }
    get isReady(): boolean { return !!this.cy; }

    private motion(): boolean { return !(this.opts.reducedMotion?.() ?? false); }

    /** Create the Cytoscape instance from the view model's current state. */
    async init(): Promise<void> {
        const cytoscape = await loadCytoscape();
        if (this.destroyed) return;
        const vm = this.vm;
        const engine = vm.engine;
        const missing: string[] = [];
        const elements: ElementDefinition[] = [];
        for (const id of vm.visibleNodes) {
            const n = engine.getNode(id);
            if (!n) continue;
            const pos = vm.positions.get(id);
            if (!pos) missing.push(id);
            elements.push(toCyNode(n, this.adapter, pos) as ElementDefinition);
        }
        for (const id of vm.visibleEdges) {
            const e = engine.getEdge(id);
            if (e) elements.push(toCyEdge(e, this.adapter) as ElementDefinition);
        }
        const cy = cytoscape({
            container: this.container,
            elements,
            style: buildStylesheet(themeColors(this.container)),
            layout: { name: 'preset' },
            // Same range and gestures as the semantic-graph view
            // (src/graph-panel/d3-semantic-graph.ts): wheel handling is ours.
            minZoom: 0.15,
            maxZoom: 5,
            userZoomingEnabled: false,
            boxSelectionEnabled: false,
            selectionType: 'single',
            autounselectify: true,      // selection is the VIEW MODEL's, drawn via classes
        });
        this.cy = cy;
        this.wireEvents(cy);
        this.unsubs.push(vm.events.on('view', (p) => this.applyPatch(p)));
        this.unsubs.push(vm.events.on('state', () => { this.syncState(); this.followFocus(); }));
        let relaidOut = false;
        if (vm.focus !== null && vm.focus !== vm.layoutFocus && cy.nodes().nonempty()) {
            // The focus moved while this view was closed (lesson navigation, a
            // tutor call): arrange around the new focus instead of reusing the
            // old picture.
            relaidOut = true;
        } else if (missing.length === cy.nodes().length) {
            relaidOut = true;                                   // nothing placed yet
        } else if (missing.length) {
            // Some nodes have never been placed: put only those around the
            // focus, keep the placed ones where the user left them.
            this.placeAround(missing, vm.focus ?? undefined);
        }
        if (relaidOut) this.runLayout(false);                   // ends with its own fit
        else if (vm.viewport) cy.viewport({ zoom: vm.viewport.zoom, pan: vm.viewport.pan });
        else this.fit(false);
        this.syncState();
        this.opts.onZoom?.(Math.round(cy.zoom() * 100));
        this.opts.onReady?.();
    }

    /**
     * Wheel gestures, matching the semantic-graph view: a trackpad two-finger
     * scroll (pixel deltas, no Ctrl) PANS; a pinch (Ctrl+wheel), Ctrl+scroll
     * or a mouse wheel (line/page deltas) ZOOMS around the cursor.
     */
    private wireWheel(cy: Core): void {
        this.wheelHandler = (ev: WheelEvent) => {
            ev.preventDefault();
            if (!ev.ctrlKey && ev.deltaMode === 0) {
                cy.panBy({ x: -ev.deltaX, y: -ev.deltaY });
                return;
            }
            // d3-zoom's default wheelDelta, so both views zoom at the same rate.
            const delta = -ev.deltaY * (ev.deltaMode === 1 ? 0.05 : ev.deltaMode ? 1 : 0.002) * (ev.ctrlKey ? 10 : 1);
            const rect = this.container.getBoundingClientRect();
            const level = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * Math.pow(2, delta)));
            cy.zoom({ level, renderedPosition: { x: ev.clientX - rect.left, y: ev.clientY - rect.top } });
        };
        this.container.addEventListener('wheel', this.wheelHandler, { passive: false });
    }

    private wireEvents(cy: Core): void {
        this.wireWheel(cy);
        // Double-click the background → fit, as in the semantic-graph view.
        cy.on('dbltap', (ev) => { if (ev.target === cy) this.fit(); });
        cy.on('zoom', () => { this.opts.onZoom?.(Math.round(cy.zoom() * 100)); });
        cy.on('tap', 'node', (ev) => { this.vm.select({ kind: 'node', id: ev.target.id() }); });
        cy.on('tap', 'edge', (ev) => { this.vm.select({ kind: 'edge', id: ev.target.id() }); });
        cy.on('tap', (ev) => { if (ev.target === cy) this.vm.select(null); });
        cy.on('dbltap', 'node', (ev) => {
            const id = ev.target.id();
            if (this.vm.isExpanded(id)) this.vm.collapse(id); else this.vm.expand(id);
        });
        // Discoverability: pointer cursor + a native tooltip saying what a
        // double-click will do on THIS concept.
        cy.on('mouseover', 'node', (ev) => {
            this.hoverHint('pointer', this.dblClickHint(ev.target.id()));
        });
        cy.on('mouseover', 'edge', () => this.hoverHint('pointer', 'Click for relationship details'));
        cy.on('mouseout', 'node, edge', () => this.hoverHint('', ''));
        cy.on('dragfree', 'node', (ev) => { this.vm.savePosition(ev.target.id(), ev.target.position()); });
        cy.on('viewport', () => {
            if (this.viewportTimer) clearTimeout(this.viewportTimer);
            this.viewportTimer = setTimeout(() => {
                if (this.cy) this.vm.saveViewport({ zoom: this.cy.zoom(), pan: this.cy.pan() });
            }, 120);
        });
    }

    private savePositions(nodes = this.cy?.nodes()): void {
        nodes?.forEach((n) => { this.vm.savePosition(n.id(), n.position()); });
    }

    /** Apply one incremental change. Never rebuilds the graph. */
    applyPatch(p: ViewPatch): void {
        const cy = this.cy;
        if (!cy) return;
        const t0 = performance.now();
        const engine = this.vm.engine;
        const added: string[] = [];
        cy.batch(() => {
            for (const id of p.edgesRemoved) cy.getElementById(id).remove();
            for (const id of p.nodesRemoved) cy.getElementById(id).remove();
            const defs: ElementDefinition[] = [];
            for (const id of p.nodesAdded) {
                const n = engine.getNode(id);
                if (!n || cy.getElementById(id).nonempty()) continue;
                defs.push(toCyNode(n, this.adapter, this.vm.positions.get(id)) as ElementDefinition);
                added.push(id);
            }
            for (const id of p.edgesAdded) {
                const e = engine.getEdge(id);
                if (!e || cy.getElementById(id).nonempty()) continue;
                defs.push(toCyEdge(e, this.adapter) as ElementDefinition);
            }
            if (defs.length) cy.add(defs);
            for (const id of p.nodesUpdated) {
                const n = engine.getNode(id);
                const el = cy.getElementById(id);
                if (!n || el.empty()) continue;
                const def = toCyNode(n, this.adapter);
                el.data(def.data);
                el.classes(def.classes);
            }
            for (const id of p.edgesUpdated) {
                const e = engine.getEdge(id);
                const el = cy.getElementById(id);
                if (!e || el.empty()) continue;
                const def = toCyEdge(e, this.adapter);
                el.data({ label: def.data.label });
                el.classes(def.classes);
            }
        });
        const unplaced = added.filter((id) => !this.vm.positions.has(id));
        if (unplaced.length) this.placeAround(unplaced, p.anchor);
        this.syncState();
        if (added.length) this.reveal(added, p.anchor);
        this.lastPatchStats = { added: added.length, removed: p.nodesRemoved.length,
                                updated: p.nodesUpdated.length, ms: performance.now() - t0 };
    }

    /** Position `ids` around `anchor` (or the graph's centre) without moving anything else. */
    private placeAround(ids: string[], anchor?: string): void {
        const cy = this.cy;
        if (!cy) return;
        const set = new Set(ids);
        const occupied: { x: number; y: number }[] = [];
        cy.nodes().forEach((n) => { if (!set.has(n.id())) occupied.push(n.position()); });
        let center = { x: 0, y: 0 };
        const a = anchor ? cy.getElementById(anchor) : null;
        if (a && a.nonempty() && !set.has(anchor!)) center = (a as NodeSingular).position();
        else if (occupied.length) {
            const bb = cy.nodes().filter((n) => !set.has(n.id())).boundingBox();
            center = { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 };
        }
        const pts = ringPlacement(center, ids.length, occupied);
        cy.batch(() => {
            ids.forEach((id, i) => {
                const el = cy.getElementById(id);
                if (el.nonempty()) (el as NodeSingular).position(pts[i]!);
            });
        });
        for (const id of ids) {
            const el = cy.getElementById(id);
            if (el.nonempty()) this.vm.savePosition(id, (el as NodeSingular).position());
        }
    }

    /** Briefly mark new nodes and make sure they are on screen. */
    private reveal(ids: string[], anchor?: string): void {
        const cy = this.cy;
        if (!cy) return;
        // A focus change is under way: followFocus re-lays out and fits, and a
        // second, earlier fit here would race it.
        if (this.vm.focus !== null && this.vm.focus !== this.vm.layoutFocus) return;
        const els = cy.collection();
        for (const id of ids) els.merge(cy.getElementById(id));
        els.addClass('just-added');
        if (this.flashTimer) clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => { this.cy?.nodes('.just-added').removeClass('just-added'); }, 1400);
        const target = anchor ? els.union(cy.getElementById(anchor)) : els;
        const ext = cy.extent();
        const bb = target.boundingBox();
        const inside = bb.x1 >= ext.x1 && bb.x2 <= ext.x2 && bb.y1 >= ext.y1 && bb.y2 <= ext.y2;
        if (inside) return;
        this.fit();
    }

    /** Reflect focus / selection / expansion as classes. */
    syncState(): void {
        const cy = this.cy;
        if (!cy) return;
        const vm = this.vm;
        cy.batch(() => {
            cy.elements('.selected, .focus, .expanded, .incident').removeClass('selected focus expanded incident');
            if (vm.focus) cy.getElementById(vm.focus).addClass('focus');
            for (const [id, d] of vm.roots) if (d > 0) cy.getElementById(id).addClass('expanded');
            const sel = vm.selection;
            if (sel) {
                const el = cy.getElementById(sel.id);
                el.addClass('selected');
                if (sel.kind === 'node') el.connectedEdges().addClass('incident');
            }
            this.updateFocusGlow();
            // "+N" badge: how many neighbours a double-click would reveal.
            cy.nodes().forEach((n) => {
                const node = vm.engine.getNode(n.id());
                if (!node) return;
                const text = displayLabel(this.adapter.nodeLabel(node), vm.hiddenNeighborCount(n.id()));
                if (n.data('display') !== text) n.data('display', text);
            });
        });
    }

    /**
     * The focus glows like the app's other "look here" cue (style.css
     * `plan-guide-glow`): the accent halo fades from nothing to full and back
     * every 2.2 s. Cytoscape draws on a canvas, so CSS animations can't reach a
     * node — the halo's opacity/size are animated here instead. With reduced
     * motion only the brightness pulses (no size change).
     */
    private updateFocusGlow(): void {
        const cy = this.cy;
        if (!cy) return;
        const focus = this.vm.focus;
        const el = focus ? cy.getElementById(focus) : null;
        const node = el && el.nonempty() ? (el as NodeSingular) : null;
        // Same live element already glowing: nothing to do (an element removed
        // and re-added under the same id is a new element and glows afresh).
        if (node && node === this.glowNode && !node.removed()) return;
        // Retire the previous glow: end its loop and drop the animated values.
        this.glowGen++;
        const old = this.glowNode;
        if (old && !old.removed()) { old.stop(false, false); old.removeStyle('underlay-opacity underlay-padding outline-opacity outline-width'); }
        this.glowNode = node;
        if (!node) return;
        // Reduced motion: the halo keeps a fixed size and only its brightness
        // breathes (a fade, not movement), so the focus still stands out.
        const still = !this.motion();
        if (still) node.style({ 'underlay-padding': 16, 'outline-width': 4 });
        const gen = this.glowGen;
        const HALF = 1100;                         // 2.2 s per cycle, like plan-guide-glow
        const pulse = (up: boolean): void => {
            if (gen !== this.glowGen || this.destroyed || node.removed()) return;
            // Bright: ring at full strength, bloom wide and strong. Dim: the tube
            // stays lit (the ring never goes out), only the bloom recedes.
            const style = still
                ? (up ? { 'underlay-opacity': 0.5, 'outline-opacity': 1 } : { 'underlay-opacity': 0.14, 'outline-opacity': 0.55 })
                : (up ? { 'underlay-opacity': 0.48, 'underlay-padding': 20, 'outline-opacity': 1, 'outline-width': 5 }
                      : { 'underlay-opacity': 0.12, 'underlay-padding': 11, 'outline-opacity': 0.55, 'outline-width': 3 });
            node.animate({ style } as never,
                { duration: HALF, easing: 'ease-in-out-sine', queue: false, complete: () => pulse(!up) } as never);
        };
        pulse(true);
    }

    /**
     * Cursor + tooltip for what's under the pointer. Set on the container's
     * PARENT: Cytoscape watches its own container's attributes (a
     * MutationObserver that calls cy.resize()), so touching them on every
     * hover made it resize and redraw for nothing.
     */
    private hoverHint(cursor: string, title: string): void {
        const host = this.container.parentElement ?? this.container;
        host.style.cursor = cursor;
        host.title = title;
    }

    /**
     * Draw now, inside this task. Resizing the canvas element clears it and
     * Cytoscape only redraws on its next frame, so without this every resize
     * shows one blank frame — continuous resizing (dragging the grip, a mode
     * transition) flickers. Uses the renderer's own render(); harmless if a
     * future Cytoscape drops it.
     */
    private renderNow(): void {
        try {
            // renderer() is public at runtime but missing from Cytoscape's typings.
            const r = (this.cy as unknown as { renderer?: () => { render?: (o?: object) => void } } | null)?.renderer?.();
            r?.render?.({});
        } catch { /* the next frame will draw */ }
    }

    /** What a double-click on `id` will do, for the hover hint. */
    private dblClickHint(id: string): string {
        const vm = this.vm;
        const hidden = vm.hiddenNeighborCount(id);
        if (vm.isExpanded(id)) return 'Click to inspect · double-click to hide its neighbours';
        if (hidden > 0) return `Click to inspect · double-click to show ${hidden} more concept${hidden === 1 ? '' : 's'}`;
        return 'Click to inspect · all neighbours are already shown';
    }

    /** Full layout of what is visible (explicit user action, or first render). */
    /**
     * The focus changed (navigation, search, Focus here, Back/Forward, a tutor
     * call): re-arrange the visible nodes in rings around the new focus and
     * bring it to the centre, animated unless reduced motion is on. Expanding
     * or collapsing keeps the focus and never triggers this, so incremental
     * exploration stays stable.
     */
    private followFocus(): void {
        const vm = this.vm;
        if (!this.cy || vm.focus === vm.layoutFocus) return;
        if (vm.focus === null) { vm.layoutFocus = null; return; }   // overview: keep its layout
        this.runLayout();
    }

    runLayout(animate = this.motion()): void {
        const cy = this.cy;
        if (!cy || cy.nodes().empty()) return;
        const focus = this.vm.focus;
        this.vm.layoutFocus = focus;
        const dist = new Map<string, number>();
        if (focus && cy.getElementById(focus).nonempty()) {
            cy.elements().bfs({ roots: cy.getElementById(focus), directed: false,
                visit: (v, _e, _u, _i, depth) => { dist.set(v.id(), depth); } });
        }
        // A zero-size box (graph in a hidden tab) would lay everything out on a
        // point and fit to nothing: do it when the box has a size again.
        if (!this.hasSize()) { this.pendingLayout = true; return; }
        // A new focus supersedes any layout or viewport animation still running
        // (fast navigation), so a stale fit can never land after this one.
        this.currentLayout?.stop();
        cy.stop(true, false);
        const layout = cy.layout({
            name: 'concentric',
            concentric: (n: NodeSingular) => (focus ? 100 - (dist.get(n.id()) ?? 50) : n.degree(false)),
            levelWidth: () => 1,
            minNodeSpacing: 70,
            spacingFactor: 1.05,
            avoidOverlap: true,
            animate,
            animationDuration: 320,
            fit: false,
        } as never);
        this.currentLayout = layout;
        layout.one('layoutstop', () => {
            if (this.currentLayout === layout) this.currentLayout = null;
            this.savePositions();
            this.fit(animate);
        });
        layout.run();
    }

    /** The fit viewport: whole graph, 40px padding (as the semantic-graph
     *  view), but never above FIT_MAX_ZOOM so a small graph isn't blown up. */
    private fitViewport(): { zoom: number; pan: { x: number; y: number } } | null {
        const cy = this.cy;
        if (!cy || cy.elements().empty()) return null;
        const bb = cy.elements().boundingBox();
        const w = cy.width(), h = cy.height(), pad = 40;
        const zoom = Math.max(cy.minZoom(), Math.min((w - pad * 2) / Math.max(bb.w, 1), (h - pad * 2) / Math.max(bb.h, 1), FIT_MAX_ZOOM));
        return { zoom, pan: { x: w / 2 - zoom * (bb.x1 + bb.w / 2), y: h / 2 - zoom * (bb.y1 + bb.h / 2) } };
    }

    private hasSize(): boolean {
        return this.container.clientWidth > 0 && this.container.clientHeight > 0;
    }

    fit(animate = this.motion()): void {
        const cy = this.cy;
        if (!cy) return;
        if (!this.hasSize()) { this.pendingFit = true; return; }
        const vp = this.fitViewport();
        if (!vp) return;
        cy.stop(true, false);
        if (animate) cy.animate(vp as never, { duration: 220 });
        else cy.viewport(vp);
    }

    zoomBy(factor: number): void {
        const cy = this.cy;
        if (!cy) return;
        const w = this.container.clientWidth, h = this.container.clientHeight;
        cy.zoom({ level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)), renderedPosition: { x: w / 2, y: h / 2 } });
    }

    /** Pan so `id` is centred (keyboard/search navigation). */
    centerOn(id: string): void {
        const cy = this.cy;
        const el = cy?.getElementById(id);
        if (!cy || !el || el.empty()) return;
        if (this.motion()) cy.animate({ center: { eles: el } } as never, { duration: 220 });
        else cy.center(el);
    }

    /** The container changed size (popup ↔ fullscreen): keep the user's view centre. */
    resize(): void {
        const cy = this.cy;
        if (!cy || !this.hasSize()) return;
        // Catch up on work deferred while the box had no size.
        if (this.pendingLayout || this.pendingFit) {
            const layoutToo = this.pendingLayout;
            this.pendingLayout = this.pendingFit = false;
            cy.resize();
            if (layoutToo) this.runLayout(false); else this.fit(false);
            this.renderNow();
            return;
        }
        const ext = cy.extent();
        cy.resize();
        const cx = (ext.x1 + ext.x2) / 2, cy0 = (ext.y1 + ext.y2) / 2;
        const z = cy.zoom();
        cy.pan({ x: this.container.clientWidth / 2 - cx * z, y: this.container.clientHeight / 2 - cy0 * z });
        this.renderNow();
    }

    /** Theme changed: rebuild the stylesheet only. */
    restyle(): void {
        this.cy?.style(buildStylesheet(themeColors(this.container)));
    }

    /** Release Cytoscape and every listener. The view model is untouched. */
    destroy(): void {
        this.destroyed = true;
        for (const u of this.unsubs.splice(0)) u();
        if (this.viewportTimer) clearTimeout(this.viewportTimer);
        if (this.flashTimer) clearTimeout(this.flashTimer);
        if (this.wheelHandler) { this.container.removeEventListener('wheel', this.wheelHandler); this.wheelHandler = null; }
        if (this.cy) {
            this.vm.saveViewport({ zoom: this.cy.zoom(), pan: this.cy.pan() });
            this.savePositions();
            this.cy.destroy();
            this.cy = null;
        }
    }
}
