// ============================================================
// view-model.ts — the graph VIEW MODEL: exploration and presentation state
// for one explorer context (the global knowledge graph, one lesson's graph…).
//
// It owns WHAT is shown — focus, expanded neighbourhoods, the visible
// subgraph, selection, history, filters — and HOW it was last presented
// (mode, viewport, node positions). It does not own the graph data (the
// GraphEngine does) and it never touches a renderer: it publishes ViewPatches
// that a view (the Cytoscape adapter) applies.
//
// Because it is independent of any container, the same instance survives
// moving the explorer between embedded, popup and fullscreen hosts, and even
// the renderer being destroyed and re-created: a new view re-renders from
// `visibleNodes` / `positions` / `viewport` exactly where the user left off.
//
// Data vs presentation: engine patches (data mutations) change the visible
// subgraph; everything else here is presentation state and never mutates the
// engine.
// ============================================================

import type { GraphEngine, GraphPatch, GraphNode } from '/graph-explorer/graph-engine.js';
import { Emitter } from '/graph-explorer/emitter.js';

export type PresentationMode = 'embedded' | 'popup' | 'fullscreen' | 'closed';
export interface Viewport { zoom: number; pan: { x: number; y: number } }
export interface Selection { kind: 'node' | 'edge'; id: string }
export interface Point { x: number; y: number }

/** An incremental change to the visible subgraph. */
export interface ViewPatch {
    nodesAdded: string[];
    nodesRemoved: string[];
    nodesUpdated: string[];
    edgesAdded: string[];
    edgesRemoved: string[];
    edgesUpdated: string[];
    /** The node the change grew from — a view places new nodes around it. */
    anchor?: string;
}

export interface ViewModelEvents extends Record<string, unknown> {
    /** The visible subgraph changed. */
    view: ViewPatch;
    /** Focus, selection, expansion, history, filter or presentation changed. */
    state: { reason: StateReason };
}
export type StateReason = 'focus' | 'selection' | 'expansion' | 'history' | 'presentation' | 'filter' | 'data';

interface Snapshot { focus: string | null; roots: [string, number][]; selection: Selection | null }

export interface ViewModelOptions<N> {
    /** Which graph type this context shows ("knowledge"); future: "expression", "code". */
    graphType: string;
    /** A stable name for the context ("global", "lesson:draft/sliding-window-maximum"). */
    contextId: string;
    /** Hop radius used by focusOn() unless told otherwise. Default 1. */
    defaultDepth?: number;
    /** Hard cap on visible nodes, so a dense graph is never drawn whole. Default 250. */
    maxVisible?: number;
    /** Text a search matches against (lower-case). */
    searchText?: (node: GraphNode<N>) => string;
}

const HISTORY_MAX = 50;

export class GraphViewModel<N, E> {
    readonly graphType: string;
    readonly contextId: string;
    readonly events = new Emitter<ViewModelEvents>();

    focus: string | null = null;
    selection: Selection | null = null;
    presentation: PresentationMode = 'closed';
    /** Last viewport a view reported; null until one did. Presentation-only. */
    viewport: Viewport | null = null;
    /** Last node positions a view reported. Presentation-only. */
    readonly positions = new Map<string, Point>();
    /** Expanded neighbourhoods: node id → hop radius. The focus is one of them. */
    readonly roots = new Map<string, number>();
    readonly hiddenRelationTypes = new Set<string>();
    /** Active scope name ("global", "local", …) — which part of the graph may be shown. */
    scopeId = 'global';
    /** Scope membership; null = everything. Re-evaluated on every recompute, so
     *  data added at runtime is classified as it arrives. */
    private scopeFn: ((id: string) => boolean) | null = null;
    defaultDepth: number;
    maxVisible: number;
    /** The cap cut the last visible set short. */
    truncated = false;

    private _visibleNodes = new Set<string>();
    private _visibleEdges = new Set<string>();
    private readonly history: Snapshot[] = [];
    /** Views left by back(); cleared by any new focus/overview, like a browser. */
    private readonly future: Snapshot[] = [];
    private readonly unsubscribe: () => void;
    private readonly searchText: (node: GraphNode<N>) => string;

    readonly engine: GraphEngine<N, E>;

    constructor(engine: GraphEngine<N, E>, opts: ViewModelOptions<N>) {
        this.engine = engine;
        this.graphType = opts.graphType;
        this.contextId = opts.contextId;
        this.defaultDepth = opts.defaultDepth ?? 1;
        this.maxVisible = opts.maxVisible ?? 250;
        this.searchText = opts.searchText ?? ((n) => n.id.toLowerCase());
        this.unsubscribe = engine.subscribe((p) => this.onEnginePatch(p));
    }

    get visibleNodes(): ReadonlySet<string> { return this._visibleNodes; }
    get visibleEdges(): ReadonlySet<string> { return this._visibleEdges; }
    get canGoBack(): boolean { return this.history.length > 0; }
    get canGoForward(): boolean { return this.future.length > 0; }

    /** Earlier foci, most recent first (deduplicated) — what the learner looked at before. */
    recentFoci(limit = 5): string[] {
        const out: string[] = [];
        for (let i = this.history.length - 1; i >= 0 && out.length < limit; i--) {
            const f = this.history[i]!.focus;
            if (f && f !== this.focus && !out.includes(f) && this.engine.hasNode(f)) out.push(f);
        }
        return out;
    }
    get historyLength(): number { return this.history.length; }

    isExpanded(id: string): boolean { return (this.roots.get(id) ?? 0) > 0; }

    /** Neighbours of `id` (through shown relation types) not currently visible —
     *  what an expand would add. Drives the "+N" affordance. */
    hiddenNeighborCount(id: string): number {
        const seen = new Set<string>();
        for (const e of this.engine.edgesOf(id)) {
            if (!this.edgeShown(e)) continue;
            const other = e.source === id ? e.target : e.source;
            if (other !== id && !this._visibleNodes.has(other)) seen.add(other);
        }
        return seen.size;
    }

    // ---------- exploration ----------

    /** Centre the view on `id` with a `depth`-hop neighbourhood. Previous view goes on the history. */
    focusOn(id: string, depth = this.defaultDepth): boolean {
        if (!this.engine.hasNode(id)) return false;
        this.pushHistory();
        this.focus = id;
        this.roots.clear();
        this.roots.set(id, Math.max(0, depth));
        this.selection = { kind: 'node', id };
        this.recompute(id);
        this.emitState('focus');
        return true;
    }

    /** Grow the neighbourhood around `id` (default: one more hop than it has). */
    expand(id: string, depth?: number): boolean {
        if (!this.engine.hasNode(id)) return false;
        const cur = this.roots.get(id) ?? 0;
        const next = Math.max(cur, depth ?? cur + 1);
        if (next === cur && this.roots.has(id)) return false;
        this.roots.set(id, next);
        this.recompute(id);
        this.emitState('expansion');
        return true;
    }

    /**
     * Undo an expansion. Nodes still reached by another expanded neighbourhood
     * (or the focus) stay — visibility is recomputed as the union, not
     * subtracted. Collapsing the focus shrinks it to depth 0 (it stays shown).
     */
    collapse(id: string): boolean {
        if (!this.roots.has(id)) return false;
        if (id === this.focus) {
            if (this.roots.get(id) === 0) return false;
            this.roots.set(id, 0);
        } else {
            this.roots.delete(id);
        }
        this.recompute(id);
        this.emitState('expansion');
        return true;
    }

    /** Change the focus neighbourhood's radius (1-hop, 2-hop, …). */
    setFocusDepth(depth: number): boolean {
        if (this.focus === null) return false;
        const d = Math.max(0, Math.min(6, Math.floor(depth)));
        if (this.roots.get(this.focus) === d) return false;
        this.defaultDepth = Math.max(1, d);
        this.roots.set(this.focus, d);
        this.recompute(this.focus);
        this.emitState('expansion');
        return true;
    }

    get focusDepth(): number { return this.focus === null ? 0 : (this.roots.get(this.focus) ?? 0); }

    /**
     * A bounded overview: the `limit` best-connected nodes (optionally only
     * those passing `filter`), with the edges between them. No focus.
     */
    showOverview(limit = 40, filter?: (node: GraphNode<N>) => boolean): void {
        this.pushHistory();
        const ranked: [string, number][] = [];
        for (const n of this.engine.allNodes()) {
            if ((filter && !filter(n)) || !this.inScope(n.id)) continue;
            ranked.push([n.id, this.engine.degree(n.id)]);
        }
        ranked.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
        this.focus = null;
        this.selection = null;
        this.roots.clear();
        for (const [id] of ranked.slice(0, Math.min(limit, this.maxVisible))) this.roots.set(id, 0);
        this.recompute();
        this.emitState('focus');
    }

    /** Return to the view before the last focusOn / showOverview. */
    back(): boolean {
        const snap = this.history.pop();
        if (!snap) return false;
        this.future.push(this.snapshot());
        this.restore(snap);
        return true;
    }

    /** Undo a back(): return to the view back() left. */
    forward(): boolean {
        const snap = this.future.pop();
        if (!snap) return false;
        this.history.push(this.snapshot());
        this.restore(snap);
        return true;
    }

    private snapshot(): Snapshot {
        return { focus: this.focus, roots: [...this.roots], selection: this.selection };
    }

    private restore(snap: Snapshot): void {
        this.focus = snap.focus && this.engine.hasNode(snap.focus) ? snap.focus : null;
        this.roots.clear();
        for (const [id, d] of snap.roots) if (this.engine.hasNode(id)) this.roots.set(id, d);
        this.selection = this.validSelection(snap.selection);
        this.recompute(this.focus ?? undefined);
        this.emitState('history');
    }

    select(sel: Selection | null): void {
        const next = this.validSelection(sel);
        if (next?.kind === this.selection?.kind && next?.id === this.selection?.id) return;
        this.selection = next;
        this.emitState('selection');
    }

    setRelationTypeVisible(type: string, visible: boolean): void {
        if (visible ? !this.hiddenRelationTypes.delete(type) : this.hiddenRelationTypes.has(type)) return;
        if (!visible) this.hiddenRelationTypes.add(type);
        this.recompute();
        this.emitState('filter');
    }

    /**
     * Restrict what may be shown to a scope (e.g. "local" = the open lesson's
     * concepts). Presentation-only: the engine is untouched and switching back
     * restores the full neighbourhoods. Roots outside the scope stay recorded
     * but contribute nothing until the scope includes them again.
     */
    setScope(id: string, predicate: ((nodeId: string) => boolean) | null): void {
        if (id === this.scopeId && predicate === this.scopeFn) return;
        this.scopeId = id;
        this.scopeFn = predicate;
        if (this.selection?.kind === 'node' && !this.inScope(this.selection.id)) this.selection = null;
        this.recompute(this.focus ?? undefined);
        this.emitState('filter');
    }

    /** Case-insensitive substring search, best (prefix) matches first. */
    search(query: string, limit = 12): string[] {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const hits: [string, number][] = [];
        for (const n of this.engine.allNodes()) {
            if (!this.inScope(n.id)) continue;
            const text = this.searchText(n);
            const at = text.indexOf(q);
            if (at >= 0) hits.push([n.id, at === 0 ? 0 : 1]);
        }
        hits.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
        return hits.slice(0, limit).map(([id]) => id);
    }

    // ---------- presentation (never touches graph data) ----------

    setPresentation(mode: PresentationMode): void {
        if (mode === this.presentation) return;
        this.presentation = mode;
        this.emitState('presentation');
    }

    saveViewport(v: Viewport): void {
        this.viewport = { zoom: v.zoom, pan: { x: v.pan.x, y: v.pan.y } };
    }

    savePosition(id: string, p: Point): void {
        this.positions.set(id, { x: p.x, y: p.y });
    }

    /** Stop listening to the engine. The instance is unusable afterwards. */
    dispose(): void {
        this.unsubscribe();
        this.events.clear();
    }

    // ---------- internals ----------

    private validSelection(sel: Selection | null): Selection | null {
        if (!sel) return null;
        if (sel.kind === 'node' ? !this.engine.hasNode(sel.id) : !this.engine.hasEdge(sel.id)) return null;
        return { kind: sel.kind, id: sel.id };
    }

    /** A new navigation: remember the current view and drop the forward trail. */
    private pushHistory(): void {
        this.future.length = 0;
        if (this.focus === null && this.roots.size === 0) return;
        this.history.push(this.snapshot());
        if (this.history.length > HISTORY_MAX) this.history.shift();
    }

    private emitState(reason: StateReason): void {
        this.events.emit('state', { reason });
    }

    /** An edge is walkable/drawn when its type is shown and both ends are in scope. */
    private edgeShown = (e: { type: string; source: string; target: string }): boolean =>
        !this.hiddenRelationTypes.has(e.type) && this.inScope(e.source) && this.inScope(e.target);

    inScope(id: string): boolean { return !this.scopeFn || this.scopeFn(id); }

    /** The visible node set: union of every root's neighbourhood, capped. */
    private computeVisibleNodes(): Set<string> {
        const vis = new Set<string>();
        this.truncated = false;
        // Deepest roots first, focus before all: when the cap bites, the focus's
        // own neighbourhood is what survives.
        const roots = [...this.roots].sort((a, b) =>
            (a[0] === this.focus ? -1 : b[0] === this.focus ? 1 : 0) || b[1] - a[1]);
        // Seeds first so every root is shown even when another root's
        // neighbourhood would exhaust the cap.
        for (const [id] of roots) {
            if (!this.inScope(id)) continue;
            if (vis.size >= this.maxVisible) { this.truncated = true; break; }
            vis.add(id);
        }
        for (const [id, depth] of roots) {
            if (depth <= 0 || !this.inScope(id)) continue;
            // Bounded BFS: never walks more than the cap, however dense the graph.
            const { nodes, truncated } = this.engine.neighborhood([id], depth,
                { limit: this.maxVisible, edgeFilter: this.edgeShown });
            for (const n of nodes.keys()) {
                if (vis.has(n)) continue;
                if (vis.size >= this.maxVisible) { this.truncated = true; break; }
                vis.add(n);
            }
            if (truncated) this.truncated = true;
        }
        return vis;
    }

    private computeVisibleEdges(nodes: Set<string>): Set<string> {
        const out = new Set<string>();
        for (const id of nodes) {
            for (const e of this.engine.edgesOf(id, 'out')) {
                if (nodes.has(e.target) && this.edgeShown(e)) out.add(e.id);
            }
        }
        return out;
    }

    /** Recompute the visible subgraph and publish the difference. */
    private recompute(anchor?: string, updatedNodes: string[] = [], updatedEdges: string[] = []): void {
        const nodes = this.computeVisibleNodes();
        const edges = this.computeVisibleEdges(nodes);
        const patch: ViewPatch = {
            nodesAdded: [...nodes].filter((n) => !this._visibleNodes.has(n)),
            nodesRemoved: [...this._visibleNodes].filter((n) => !nodes.has(n)),
            nodesUpdated: updatedNodes.filter((n) => nodes.has(n) && this._visibleNodes.has(n)),
            edgesAdded: [...edges].filter((e) => !this._visibleEdges.has(e)),
            edgesRemoved: [...this._visibleEdges].filter((e) => !edges.has(e)),
            edgesUpdated: updatedEdges.filter((e) => edges.has(e) && this._visibleEdges.has(e)),
        };
        if (anchor !== undefined) patch.anchor = anchor;
        this._visibleNodes = nodes;
        this._visibleEdges = edges;
        for (const n of patch.nodesRemoved) this.positions.delete(n);
        if (patch.nodesAdded.length || patch.nodesRemoved.length || patch.nodesUpdated.length
            || patch.edgesAdded.length || patch.edgesRemoved.length || patch.edgesUpdated.length) {
            this.events.emit('view', patch);
        }
    }

    /** A data mutation: keep focus/roots/selection valid, then re-derive the view. */
    private onEnginePatch(p: GraphPatch<N, E>): void {
        let stateChanged = false;
        for (const n of p.nodesRemoved) {
            if (this.roots.delete(n.id)) stateChanged = true;
            if (this.focus === n.id) { this.focus = null; stateChanged = true; }
        }
        if (this.selection && !this.validSelection(this.selection)) { this.selection = null; stateChanged = true; }
        // Anchor new material on the first visible endpoint of a new edge, so a
        // node added next to something on screen appears beside it.
        let anchor: string | undefined;
        for (const id of p.edgesAdded) {
            const e = this.engine.getEdge(id);
            if (!e) continue;
            if (this._visibleNodes.has(e.source)) { anchor = e.source; break; }
            if (this._visibleNodes.has(e.target)) { anchor = e.target; break; }
        }
        this.recompute(anchor, p.nodesUpdated, p.edgesUpdated);
        if (stateChanged || p.nodesUpdated.length || p.edgesUpdated.length) this.emitState('data');
    }
}
